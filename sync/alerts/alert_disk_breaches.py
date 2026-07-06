"""Alert Teams when production-class disks reach their critical threshold.

Queries monitoring.disk_current for alert_status=3 (critical) disks in the
production-class environments (Production / Live Support / Shared Services) and
posts an Adaptive Card to Teams. Uses monitoring.alerts to track which
notifications have been sent, avoiding duplicate alerts for a disk that stays
critical (cooldown default 24h, configurable via DISK_ALERT_COOLDOWN_HOURS).

Resolution path: a previously-alerted disk that has since dropped below its
critical threshold (alert_status < 3) generates a "resolved" Teams card, and its
alerts row is marked resolved. A disk that recovers only as far as WARNING still
counts as resolved here because this alert is critical-only.

Designed to run independently of the 15-min sync, on a less-frequent schedule
(default every 4h during business hours via ops-alert-disk-breaches.yml).
"""

import os
import re
import sys
import logging

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (
    setup_logging, create_argument_parser, configure_verbosity,
    validate_env_vars, http_request, get_database_connection
)

logger = setup_logging('disk_breach_alert')

_TEAMS_WEBHOOK_RE = re.compile(
    r'^https://[a-zA-Z0-9.-]+\.(webhook\.office\.com|powerplatform\.com)[:/]'
)


def _validate_teams_url(url: str) -> None:
    if not url.startswith('https://'):
        raise ValueError(f"TEAMS_WEBHOOK_URL must use HTTPS — got: {url!r}")
    if not _TEAMS_WEBHOOK_RE.match(url):
        raise ValueError(
            f"TEAMS_WEBHOOK_URL must be a webhook.office.com or powerplatform.com URL — got: {url!r}"
        )


COOLDOWN_HOURS = int(os.environ.get('DISK_ALERT_COOLDOWN_HOURS', '24'))


# Scope: Group Support only - we own these servers operationally, the rest of the
# estate is paged by their respective BU teams.
ALERT_BU = 'Contoso Group Support'

# Environment scope: the production-class environments. These are the only disks
# we page on - dev/staging/UAT/etc. breaches are noise out of hours. The labels
# must match the canonical values written by sync_solarwinds_disks.py
# (_ENV_CANONICAL_MAP).
ALERT_ENVIRONMENTS = ['Production', 'Live Support', 'Shared Services']

# Non-production exclusion: some .hiscox.nonprod hosts carry a production-class
# SolarWinds Environment tag (e.g. "Shared Services") and would otherwise page.
# The DNS domain is the authoritative prod/non-prod signal, so we exclude on the
# fqdn suffix (falling back to server_name when fqdn is null - see
# sync_solarwinds_disks._derive_fqdn). Matched with ILIKE against this pattern.
NONPROD_FQDN_SUFFIX = '%.nonprod'

# Breaches: critical (status=3) production-class disks not already in an
# unresolved alert row within the cooldown window.
BREACH_QUERY = """
    SELECT
        d.server_name,
        d.disk_label,
        d.service,
        d.environment,
        d.technical_owner,
        d.percent_used,
        d.used_gb,
        d.volume_size_gb,
        d.threshold_warn_pct,
        d.threshold_crit_pct,
        d.alert_status
    FROM monitoring.disk_current d
    WHERE d.alert_status = 3
      AND d.business_unit = %s
      AND d.environment = ANY(%s)
      AND COALESCE(d.fqdn, '') NOT ILIKE %s
      AND COALESCE(d.server_name, '') NOT ILIKE %s
      AND NOT EXISTS (
          SELECT 1 FROM monitoring.alerts a
          WHERE a.server_name = d.server_name
            AND a.disk_label = d.disk_label
            AND a.notification_sent = TRUE
            AND NOT a.resolved
            AND a.notification_sent_at >= CURRENT_TIMESTAMP - (INTERVAL '1 hour' * %s)
      )
    ORDER BY d.percent_used DESC, d.server_name, d.disk_label
"""

# Resolutions: any open (unresolved) alert whose disk has since dropped below its
# critical threshold (status < 3). Because this alert is critical-only, a disk
# that recovers only to WARNING (status=2) still counts as resolved. Not scoped
# by environment so an open row always clears once its disk recovers, even if the
# disk's environment tag changed since it was alerted.
RESOLUTION_QUERY = """
    SELECT
        a.alert_id,
        a.server_name,
        a.disk_label,
        a.alert_type,
        a.percent_used_at_send,
        d.service,
        d.percent_used AS current_percent_used
    FROM monitoring.alerts a
    JOIN monitoring.disk_current d
      ON d.server_name = a.server_name
     AND d.disk_label = a.disk_label
    WHERE a.notification_sent = TRUE
      AND NOT a.resolved
      AND d.alert_status < 3
      AND d.business_unit = %s
      AND COALESCE(d.fqdn, '') NOT ILIKE %s
      AND COALESCE(d.server_name, '') NOT ILIKE %s
    ORDER BY a.server_name, a.disk_label
"""


# Card table layout - four columns shared by the critical and resolved sections:
# Server | Disk | Service | Usage. Server/Disk stretch; Service/Usage size to fit.
_COLS = (("Server", "stretch"), ("Disk", "stretch"), ("Service", "auto"), ("Usage", "auto"))


def _cell(text, width, *, bold: bool = False, color: str = None) -> dict:
    tb = {"type": "TextBlock", "text": str(text), "size": "small", "wrap": True}
    if bold:
        tb["weight"] = "bolder"
    if color:
        tb["color"] = color
    return {"type": "Column", "width": width, "items": [tb]}


def _row(server, disk, service, usage, color: str = None) -> dict:
    """One Server | Disk | Service | Usage row; only the Usage cell is coloured."""
    widths = [w for _, w in _COLS]
    return {
        "type": "ColumnSet",
        "separator": True,
        "spacing": "none",
        "columns": [
            _cell(server, widths[0]),
            _cell(disk, widths[1]),
            _cell(service or '-', widths[2]),
            _cell(usage, widths[3], color=color),
        ],
    }


def _disk_row(disk: dict) -> dict:
    pct = float(disk['percent_used'])
    used = float(disk['used_gb'])
    size = float(disk['volume_size_gb'])
    usage = f"{pct:.1f}% — {used:.0f}/{size:.0f} GB"
    color = "attention" if disk.get('alert_status') == 3 else "warning"
    return _row(disk['server_name'], disk['disk_label'], disk.get('service'), usage, color=color)


def _resolved_row(item: dict) -> dict:
    current = float(item['current_percent_used'])
    return _row(item['server_name'], item['disk_label'], item.get('service'),
                f"now {current:.1f}%", color="good")


def _dedupe_resolved(resolved: list) -> list:
    """Collapse the resolution rows to one display line per disk.

    A disk that stays breached across several cooldown windows accumulates one
    monitoring.alerts row per window (by design — that is how it re-pages). When
    it finally recovers, RESOLUTION_QUERY joins every one of those unresolved
    rows to the single disk_current row, so the same disk appears N times, each
    line identical (same server, label, and current percent_used). disk_current
    is UNIQUE on (server_name, disk_label) (idx_disk_current_pk), so two genuinely
    different disks can never share this key — only the alert-row accumulation
    can. Dedup here is therefore safe: it collapses the repeats without merging
    distinct disks. record_resolutions still marks every accumulated row
    resolved, so nothing lingers to re-fire next run.
    """
    seen = set()
    unique = []
    for r in resolved:
        key = (r['server_name'], r['disk_label'])
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique


_TABLE_HEADER = {
    "type": "ColumnSet",
    "spacing": "small",
    "columns": [_cell(label, width, bold=True) for label, width in _COLS],
}


def build_adaptive_card(crit: list, resolved: list) -> dict:
    """Build a single Teams Adaptive Card combining critical breaches and resolutions."""
    sections = []
    breach_total = len(crit)
    if breach_total > 0:
        title = f"Disk Alert: {breach_total} disk(s) at critical"
        sections.append({
            "type": "TextBlock",
            "size": "medium",
            "weight": "bolder",
            "text": title,
            "style": "heading",
            "color": "attention"
        })
        sections.append({
            "type": "TextBlock",
            "text": f"\U0001f534 **CRITICAL ({len(crit)})**",
            "weight": "bolder",
            "spacing": "medium"
        })
        sections.append(_TABLE_HEADER)
        sections.extend(_disk_row(d) for d in crit)

    if resolved:
        resolved = _dedupe_resolved(resolved)
        if breach_total == 0:
            sections.append({
                "type": "TextBlock",
                "size": "medium",
                "weight": "bolder",
                "text": f"Disk Alert: {len(resolved)} disk(s) recovered",
                "style": "heading",
                "color": "good"
            })
        sections.append({
            "type": "TextBlock",
            "text": f"✅ **RESOLVED ({len(resolved)})**",
            "weight": "bolder",
            "spacing": "medium",
            "color": "good"
        })
        sections.append(_TABLE_HEADER)
        sections.extend(_resolved_row(r) for r in resolved)

    return {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.4",
                "body": sections
            }
        }]
    }


def record_breach_alerts(conn, breaches: list):
    """Insert one row per breaching disk into monitoring.alerts."""
    with conn.cursor() as cur:
        for d in breaches:
            # Critical-only alert, so every breach row is a crit.
            alert_type = 'breach_crit'
            cur.execute("""
                INSERT INTO monitoring.alerts
                    (server_name, disk_label, alert_type, alert_status_at_send,
                     percent_used_at_send, notification_sent, notification_sent_at)
                VALUES (%s, %s, %s, %s, %s, TRUE, CURRENT_TIMESTAMP)
            """, (
                d['server_name'], d['disk_label'], alert_type,
                d['alert_status'], d['percent_used']
            ))
        conn.commit()


def record_resolutions(conn, resolved: list):
    """Mark previously-sent alerts as resolved for disks that have recovered."""
    if not resolved:
        return
    with conn.cursor() as cur:
        alert_ids = [r['alert_id'] for r in resolved]
        cur.execute("""
            UPDATE monitoring.alerts
            SET resolved = TRUE, resolved_at = CURRENT_TIMESTAMP
            WHERE alert_id = ANY(%s)
        """, (alert_ids,))
        conn.commit()


def main():
    parser = create_argument_parser(
        'Alert Teams about production-class disks reaching their critical threshold',
        include_dry_run=True
    )
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    validate_env_vars(['TEAMS_WEBHOOK_URL'])
    webhook_url = os.environ['TEAMS_WEBHOOK_URL']
    _validate_teams_url(webhook_url)

    logger.info("Cooldown: %dh (set DISK_ALERT_COOLDOWN_HOURS to change)", COOLDOWN_HOURS)
    logger.info("Scope: business_unit = %r, environments = %r, excluding fqdn/name like %r",
                ALERT_BU, ALERT_ENVIRONMENTS, NONPROD_FQDN_SUFFIX)

    conn = get_database_connection(app_name='disk_breach_alert')
    try:
        with conn.cursor() as cur:
            cur.execute(BREACH_QUERY, (
                ALERT_BU, ALERT_ENVIRONMENTS,
                NONPROD_FQDN_SUFFIX, NONPROD_FQDN_SUFFIX, COOLDOWN_HOURS
            ))
            breaches = [dict(r) for r in cur.fetchall()]
            cur.execute(RESOLUTION_QUERY, (
                ALERT_BU, NONPROD_FQDN_SUFFIX, NONPROD_FQDN_SUFFIX
            ))
            resolutions = [dict(r) for r in cur.fetchall()]

        if not breaches and not resolutions:
            logger.info("No new disk alerts and no resolutions to send")
            return

        # Every breach is critical (BREACH_QUERY filters alert_status = 3).
        crit = breaches

        # Resolutions can carry several alert rows per disk (one per cooldown
        # window the disk breached through). Report recovered disks here so the
        # count lines up with the critical disk count.
        resolved_disks = len({(r['server_name'], r['disk_label']) for r in resolutions})
        logger.warning(
            "Disk alert: %d critical breach(es), %d disk(s) recovered (%d alert row(s))",
            len(crit), resolved_disks, len(resolutions)
        )

        card = build_adaptive_card(crit, resolutions)

        if args.dry_run:
            import json
            logger.info(f"[DRY RUN] Would post to Teams:\n{json.dumps(card, indent=2, default=str)}")
            logger.info(f"[DRY RUN] Would record {len(breaches)} breach alert(s) and {len(resolutions)} resolution(s)")
            return

        http_request('POST', webhook_url, json=card, retries=2, timeout=15)
        logger.info("Teams alert sent")

        record_breach_alerts(conn, breaches)
        record_resolutions(conn, resolutions)
        logger.info(
            "Recorded %d breach alert(s); marked %d alert row(s) resolved in monitoring.alerts",
            len(breaches), len(resolutions)
        )
    finally:
        conn.close()


if __name__ == '__main__':
    main()

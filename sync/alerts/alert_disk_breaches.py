"""Alert Teams when disks breach warn/crit thresholds.

Queries monitoring.disk_current for status>=2 disks and posts an Adaptive Card
to Teams. Uses monitoring.alerts to track which notifications have been sent,
avoiding duplicate alerts for a disk that stays breached (cooldown default 24h,
configurable via DISK_ALERT_COOLDOWN_HOURS).

Resolution path: a previously-alerted disk that has since returned to
alert_status=1 generates a "resolved" Teams card, and its alerts row is marked
resolved.

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


# Breaches: status>=2 AND not in an unresolved alert row within the cooldown window.
BREACH_QUERY = """
    SELECT
        d.server_name,
        d.disk_label,
        d.environment,
        d.technical_owner,
        d.percent_used,
        d.used_gb,
        d.volume_size_gb,
        d.threshold_warn_pct,
        d.threshold_crit_pct,
        d.alert_status
    FROM monitoring.disk_current d
    WHERE d.alert_status >= 2
      AND NOT EXISTS (
          SELECT 1 FROM monitoring.alerts a
          WHERE a.server_name = d.server_name
            AND a.disk_label = d.disk_label
            AND a.notification_sent = TRUE
            AND NOT a.resolved
            AND a.notification_sent_at >= CURRENT_TIMESTAMP - (INTERVAL '1 hour' * %s)
      )
    ORDER BY d.alert_status DESC, d.percent_used DESC, d.server_name, d.disk_label
"""

# Resolutions: any open (unresolved) alert whose disk has since returned to status=1.
RESOLUTION_QUERY = """
    SELECT
        a.alert_id,
        a.server_name,
        a.disk_label,
        a.alert_type,
        a.percent_used_at_send,
        d.percent_used AS current_percent_used
    FROM monitoring.alerts a
    JOIN monitoring.disk_current d
      ON d.server_name = a.server_name
     AND d.disk_label = a.disk_label
    WHERE a.notification_sent = TRUE
      AND NOT a.resolved
      AND d.alert_status = 1
    ORDER BY a.server_name, a.disk_label
"""


def _disk_row(disk: dict) -> dict:
    server = disk['server_name']
    label = disk['disk_label']
    env = disk.get('environment') or ''
    pct = float(disk['percent_used'])
    used = float(disk['used_gb'])
    size = float(disk['volume_size_gb'])

    line = f"{server} {label}"
    if env:
        line += f" ({env})"

    status_text = f"{pct:.1f}% — {used:.0f}/{size:.0f} GB"
    color = "attention" if disk.get('alert_status') == 3 else "warning"

    return {
        "type": "ColumnSet",
        "separator": True,
        "columns": [
            {"type": "Column", "width": "stretch", "items": [
                {"type": "TextBlock", "text": line, "size": "small", "wrap": True}
            ]},
            {"type": "Column", "width": "auto", "items": [
                {"type": "TextBlock", "text": status_text, "size": "small", "color": color}
            ]}
        ],
        "spacing": "none"
    }


def _resolved_row(item: dict) -> dict:
    server = item['server_name']
    label = item['disk_label']
    current = float(item['current_percent_used'])
    line = f"{server} {label} — now {current:.1f}%"
    return {
        "type": "TextBlock",
        "text": f"✅ {line}",
        "size": "small",
        "wrap": True,
        "spacing": "small"
    }


_TABLE_HEADER = {
    "type": "ColumnSet",
    "columns": [
        {"type": "Column", "width": "stretch", "items": [
            {"type": "TextBlock", "text": "**Disk**", "weight": "bolder", "size": "small"}
        ]},
        {"type": "Column", "width": "auto", "items": [
            {"type": "TextBlock", "text": "**Usage**", "weight": "bolder", "size": "small"}
        ]}
    ],
    "spacing": "small"
}


def build_adaptive_card(crit: list, warn: list, resolved: list) -> dict:
    """Build a single Teams Adaptive Card combining breaches and resolutions."""
    sections = []
    breach_total = len(crit) + len(warn)
    if breach_total > 0:
        title = f"Disk Alert: {breach_total} disk(s) over threshold"
        sections.append({
            "type": "TextBlock",
            "size": "medium",
            "weight": "bolder",
            "text": title,
            "style": "heading",
            "color": "attention"
        })
        for icon, label, items in [
            ("\U0001f534", "CRITICAL", crit),
            ("\U0001f7e1", "WARNING", warn),
        ]:
            if items:
                sections.append({
                    "type": "TextBlock",
                    "text": f"{icon} **{label} ({len(items)})**",
                    "weight": "bolder",
                    "spacing": "medium"
                })
                sections.append(_TABLE_HEADER)
                sections.extend(_disk_row(d) for d in items)

    if resolved:
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
            alert_type = 'breach_crit' if d['alert_status'] == 3 else 'breach_warn'
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
        'Alert Teams about disks breaching warn/crit thresholds',
        include_dry_run=True
    )
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    validate_env_vars(['TEAMS_WEBHOOK_URL'])
    webhook_url = os.environ['TEAMS_WEBHOOK_URL']
    _validate_teams_url(webhook_url)

    logger.info("Cooldown: %dh (set DISK_ALERT_COOLDOWN_HOURS to change)", COOLDOWN_HOURS)

    conn = get_database_connection(app_name='disk_breach_alert')
    try:
        with conn.cursor() as cur:
            cur.execute(BREACH_QUERY, (COOLDOWN_HOURS,))
            breaches = [dict(r) for r in cur.fetchall()]
            cur.execute(RESOLUTION_QUERY)
            resolutions = [dict(r) for r in cur.fetchall()]

        if not breaches and not resolutions:
            logger.info("No new disk alerts and no resolutions to send")
            return

        crit = [b for b in breaches if b['alert_status'] == 3]
        warn = [b for b in breaches if b['alert_status'] == 2]

        logger.warning(
            "Disk alert: %d crit + %d warn breach(es), %d resolution(s)",
            len(crit), len(warn), len(resolutions)
        )

        card = build_adaptive_card(crit, warn, resolutions)

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
            "Recorded %d breach alert(s) and %d resolution(s) in monitoring.alerts",
            len(breaches), len(resolutions)
        )
    finally:
        conn.close()


if __name__ == '__main__':
    main()

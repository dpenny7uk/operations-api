"""Alert Teams when vendor licences are approaching renewal or have expired.

Queries licensing.licences for anything expiring within 6 months, computes the
highest threshold each has crossed (six_mo / three_mo / thirty_d / expired) and
posts an Adaptive Card to Teams. licensing.alerts tracks which (licence, threshold)
pairs have already fired so each threshold only alerts once per cycle; the API's
renew action clears a licence's alert rows so the next cycle re-fires cleanly.

Designed to run as a standalone daily pipeline (ops-alerts-licence.yml, 07:00 UTC),
mirroring sync/alerts/alert_cert_expiry.py.
"""

import os
import re
import logging
from datetime import datetime, timezone

from common import (
    setup_logging, create_argument_parser, configure_verbosity,
    validate_env_vars, http_request, get_database_connection
)

logger = setup_logging('licence_expiry_alert')

_TEAMS_WEBHOOK_RE = re.compile(
    r'^https://[a-zA-Z0-9.-]+\.(webhook\.office\.com|powerplatform\.com)[:/]'
)


def _validate_teams_url(url: str) -> None:
    if not url.startswith('https://'):
        raise ValueError(f"TEAMS_WEBHOOK_URL must use HTTPS - got: {url!r}")
    if not _TEAMS_WEBHOOK_RE.match(url):
        raise ValueError(
            f"TEAMS_WEBHOOK_URL must be a webhook.office.com or powerplatform.com URL - "
            f"got: {url!r}. Set TEAMS_WEBHOOK_URL to the webhook URL from your Teams channel."
        )


# Everything expiring within ~6 months; the exact threshold is computed per row
# in Python (same day-counts as the frontend getBucket).
LICENCE_QUERY = """
    SELECT
        l.licence_id,
        l.vendor,
        l.product,
        l.application_name,
        l.quantity_held,
        l.audit_owner_sam,
        l.status_flag,
        l.expires_at,
        (l.expires_at - CURRENT_DATE) AS days_until_expiry
    FROM licensing.licences l
    WHERE l.is_active
      AND l.expires_at <= CURRENT_DATE + INTERVAL '6 months'
    ORDER BY l.expires_at, l.vendor
"""

# Section ordering = most urgent first. Matches the licensing.alerts.threshold enum.
_SECTIONS = [
    ("expired",  "\U0001f534", "EXPIRED",                 "attention"),
    ("thirty_d", "\U0001f7e0", "EXPIRING WITHIN 30 DAYS",  "attention"),
    ("three_mo", "\U0001f7e1", "EXPIRING WITHIN 3 MONTHS", "warning"),
    ("six_mo",   "\U0001f7e1", "EXPIRING WITHIN 6 MONTHS", "warning"),
]
_SECTION_COLOUR = {key: colour for key, _icon, _label, colour in _SECTIONS}


def threshold_for(days: int | None) -> str | None:
    """Highest threshold crossed, mirroring the frontend getBucket day-counts."""
    if days is None:
        return None
    if days < 0:
        return 'expired'
    if days <= 30:
        return 'thirty_d'
    if days <= 90:
        return 'three_mo'
    if days <= 183:
        return 'six_mo'
    return None


def _licence_row(licence: dict) -> dict:
    vendor = licence['vendor']
    product = licence['product']
    app = licence.get('application_name') or ''
    days = licence['days_until_expiry']
    expiry = licence['expires_at'].strftime('%Y-%m-%d') if licence['expires_at'] else '?'
    qty = licence.get('quantity_held')
    owner = licence.get('audit_owner_sam') or 'unassigned'
    status_flag = licence.get('status_flag') or 'tracked'

    label = f"{vendor} {product}"
    if app:
        label += f" — {app}"
    detail = f"Qty: {qty if qty is not None else 'n/a'} · Owner: {owner} · {status_flag}"

    if days is None:
        status = "Unknown"
    elif days < 0:
        status = f"Expired {abs(days)}d ago ({expiry})"
    elif days == 0:
        status = f"Expires today ({expiry})"
    else:
        status = f"{days}d remaining ({expiry})"

    colour = _SECTION_COLOUR.get(licence['threshold'], 'default')

    return {
        "type": "ColumnSet",
        "separator": True,
        "spacing": "none",
        "columns": [
            {"type": "Column", "width": "stretch", "items": [
                {"type": "TextBlock", "text": label, "size": "small", "weight": "bolder", "wrap": True},
                {"type": "TextBlock", "text": detail, "size": "small", "isSubtle": True, "wrap": True, "spacing": "none"},
            ]},
            {"type": "Column", "width": "auto", "items": [
                {"type": "TextBlock", "text": status, "size": "small", "color": colour}
            ]},
        ],
    }


def build_adaptive_card(by_threshold: dict, base_url: str) -> dict:
    """Build a Teams Adaptive Card grouping licences by threshold section."""
    total = sum(len(v) for v in by_threshold.values())
    body = [{
        "type": "TextBlock",
        "size": "medium",
        "weight": "bolder",
        "text": f"Licence Alert: {total} licence(s) require attention",
        "style": "heading",
        "color": "attention",
    }]

    for key, icon, label, _colour in _SECTIONS:
        rows = by_threshold.get(key) or []
        if not rows:
            continue
        body.append({
            "type": "TextBlock",
            "text": f"{icon} **{label} ({len(rows)})**",
            "weight": "bolder",
            "spacing": "medium",
        })
        body.extend(_licence_row(r) for r in rows)

    return {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.4",
                "body": body,
                "actions": [{
                    "type": "Action.OpenUrl",
                    "title": "View in operations console",
                    "url": f"{base_url.rstrip('/')}/#licensing",
                }],
            },
        }],
    }


def record_alerts(conn, items: list, status_code, success: bool, error_text=None):
    """UPSERT one licensing.alerts row per (licence, threshold) we attempted to send."""
    sent_at = datetime.now(timezone.utc) if success else None
    with conn.cursor() as cur:
        for it in items:
            cur.execute("""
                INSERT INTO licensing.alerts
                    (licence_id, threshold, notification_sent, sent_at, webhook_response_status, error_text)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (licence_id, threshold)
                DO UPDATE SET
                    notification_sent = EXCLUDED.notification_sent,
                    sent_at = EXCLUDED.sent_at,
                    webhook_response_status = EXCLUDED.webhook_response_status,
                    error_text = EXCLUDED.error_text
            """, (it['licence_id'], it['threshold'], success, sent_at, status_code, error_text))
        conn.commit()


def main():
    parser = create_argument_parser(
        'Alert Teams about expiring/expired vendor licences',
        include_dry_run=True
    )
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    validate_env_vars(['TEAMS_WEBHOOK_URL'])
    webhook_url = os.environ['TEAMS_WEBHOOK_URL']
    _validate_teams_url(webhook_url)
    base_url = os.environ.get('OPS_BASE_URL', 'https://ops/')

    conn = get_database_connection(app_name='licence_expiry_alert')
    try:
        with conn.cursor() as cur:
            cur.execute(LICENCE_QUERY)
            licences = [dict(row) for row in cur.fetchall()]
            cur.execute("SELECT licence_id, threshold FROM licensing.alerts WHERE notification_sent = TRUE")
            already_sent = {(r['licence_id'], r['threshold']) for r in cur.fetchall()}

        # Keep only licences at a real threshold that hasn't already fired this cycle.
        pending = []
        for lic in licences:
            t = threshold_for(lic['days_until_expiry'])
            if t is None:
                continue
            if (lic['licence_id'], t) in already_sent:
                continue
            lic['threshold'] = t
            pending.append(lic)

        if not pending:
            logger.info("No new licence expiry alerts to send")
            return

        by_threshold: dict = {}
        for lic in pending:
            by_threshold.setdefault(lic['threshold'], []).append(lic)

        logger.warning(
            "Found %d licence(s) needing alerts: %s",
            len(pending),
            ", ".join(f"{k}={len(v)}" for k, v in by_threshold.items()),
        )
        card = build_adaptive_card(by_threshold, base_url)

        if args.dry_run:
            import json
            logger.info("[DRY RUN] Would post to Teams:\n%s", json.dumps(card, indent=2, default=str))
            logger.info("[DRY RUN] Would record %d alert(s) in licensing.alerts", len(pending))
            return

        try:
            resp = http_request('POST', webhook_url, json=card, retries=2, timeout=15)
        except Exception as e:
            # Record the failure so the row stays notification_sent=FALSE and the
            # next daily run retries it.
            status = getattr(getattr(e, 'response', None), 'status_code', None)
            record_alerts(conn, pending, status, success=False, error_text=str(e)[:1000])
            logger.error("Teams POST failed; recorded %d licence alert(s) for retry: %s", len(pending), e)
            raise

        logger.info("Teams alert sent (HTTP %s)", resp.status_code)
        record_alerts(conn, pending, resp.status_code, success=True)
        logger.info("Recorded %d alert(s) in licensing.alerts", len(pending))
    finally:
        conn.close()


if __name__ == '__main__':
    main()

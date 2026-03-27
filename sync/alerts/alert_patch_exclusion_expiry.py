"""Alert Teams when patch exclusion holds have expired.

Queries patching.patch_exclusions for active exclusions whose held_until
date has passed, and posts an Adaptive Card to Teams. Uses
patching.exclusion_alerts to track notifications and prevent duplicates.

Designed to run daily at 07:45 UTC (after maintenance, before health alert).
"""

import os
import re
import logging
from datetime import datetime

from common import (
    setup_logging, create_argument_parser, configure_verbosity,
    validate_env_vars, http_request, get_database_connection
)

logger = setup_logging('patch_exclusion_alert')

_TEAMS_WEBHOOK_RE = re.compile(
    r'^https://[a-zA-Z0-9.-]+\.(webhook\.office\.com|powerplatform\.com)[:/]'
)


def _validate_teams_url(url: str) -> None:
    if not url.startswith('https://'):
        raise ValueError(f"TEAMS_WEBHOOK_URL must use HTTPS — got: {url!r}")
    if not _TEAMS_WEBHOOK_RE.match(url):
        raise ValueError(
            f"TEAMS_WEBHOOK_URL must be a webhook.office.com or powerplatform.com URL — "
            f"got: {url!r}. Set TEAMS_WEBHOOK_URL to the webhook URL from your Teams channel."
        )


EXPIRED_EXCLUSIONS_QUERY = """
    SELECT
        pe.exclusion_id,
        pe.server_name,
        pe.reason,
        pe.held_until,
        pe.excluded_by,
        pe.excluded_at,
        s.environment
    FROM patching.patch_exclusions pe
    LEFT JOIN shared.servers s ON pe.server_id = s.server_id
    WHERE pe.is_active
      AND pe.held_until <= CURRENT_DATE
      AND pe.exclusion_id NOT IN (
          SELECT exclusion_id FROM patching.exclusion_alerts
          WHERE alert_type = 'hold_expired_teams'
            AND notification_sent = TRUE
            AND notification_sent_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
      )
    ORDER BY pe.held_until, pe.server_name
"""


def build_adaptive_card(exclusions: list) -> dict:
    """Build a Teams Adaptive Card for expired patch exclusion holds."""
    total = len(exclusions)
    title = f"Patch Exclusion Alert: {total} hold{'' if total == 1 else 's'} expired"

    body = [
        {
            "type": "TextBlock",
            "size": "medium",
            "weight": "bolder",
            "text": title,
            "style": "heading",
            "color": "attention"
        },
        {
            "type": "TextBlock",
            "text": "The following servers have passed their exclusion hold date and should "
                    "either be returned to the patching cycle or have their hold extended.",
            "wrap": True,
            "spacing": "small"
        },
        # Table header
        {
            "type": "ColumnSet",
            "columns": [
                {"type": "Column", "width": "stretch", "items": [
                    {"type": "TextBlock", "text": "**Server**", "weight": "bolder", "size": "small"}
                ]},
                {"type": "Column", "width": "auto", "items": [
                    {"type": "TextBlock", "text": "**Hold Expired**", "weight": "bolder", "size": "small"}
                ]}
            ],
            "spacing": "medium"
        }
    ]

    for e in exclusions:
        env = e.get('environment') or ''
        held_until = e['held_until'].strftime('%Y-%m-%d') if e['held_until'] else '?'
        reason = (e.get('reason') or '')[:80]
        if len(e.get('reason') or '') > 80:
            reason += '...'

        label = e['server_name']
        if env:
            label += f" ({env})"
        label += f" \u2014 {reason}"

        body.append({
            "type": "ColumnSet",
            "separator": True,
            "columns": [
                {"type": "Column", "width": "stretch", "items": [
                    {"type": "TextBlock", "text": label, "size": "small", "wrap": True}
                ]},
                {"type": "Column", "width": "auto", "items": [
                    {"type": "TextBlock", "text": held_until, "size": "small", "color": "attention"}
                ]}
            ],
            "spacing": "none"
        })

    return {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.4",
                "body": body
            }
        }]
    }


def record_alerts(conn, exclusion_ids: list):
    """Record that notifications were sent for these exclusions."""
    with conn.cursor() as cur:
        for eid in exclusion_ids:
            cur.execute("""
                INSERT INTO patching.exclusion_alerts
                    (exclusion_id, alert_type, alert_message,
                     notification_sent, notification_sent_at)
                VALUES (%s, 'hold_expired_teams',
                    'Teams notification sent', TRUE, CURRENT_TIMESTAMP)
            """, (eid,))
        conn.commit()


def main():
    parser = create_argument_parser(
        'Alert Teams about expired patch exclusion holds',
        include_dry_run=True
    )
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    validate_env_vars(['TEAMS_WEBHOOK_URL'])
    webhook_url = os.environ['TEAMS_WEBHOOK_URL']
    _validate_teams_url(webhook_url)

    conn = get_database_connection(app_name='patch_exclusion_alert')
    try:
        with conn.cursor() as cur:
            cur.execute(EXPIRED_EXCLUSIONS_QUERY)
            exclusions = [dict(row) for row in cur.fetchall()]

        if not exclusions:
            logger.info("No expired patch exclusion holds to alert on")
            return

        logger.warning(
            f"Found {len(exclusions)} expired patch exclusion hold(s) — sending alert"
        )
        card = build_adaptive_card(exclusions)

        if args.dry_run:
            import json
            logger.info(f"[DRY RUN] Would post to Teams:\n{json.dumps(card, indent=2, default=str)}")
            logger.info(f"[DRY RUN] Would record alerts for {len(exclusions)} exclusion(s)")
            return

        http_request('POST', webhook_url, json=card, retries=2, timeout=15)
        logger.info("Teams alert sent")

        exclusion_ids = [e['exclusion_id'] for e in exclusions]
        record_alerts(conn, exclusion_ids)
        logger.info(f"Recorded {len(exclusion_ids)} alert(s) in patching.exclusion_alerts")
    finally:
        conn.close()


if __name__ == '__main__':
    main()

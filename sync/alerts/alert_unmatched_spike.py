"""Alert Teams when a spike of new unmatched servers is detected.

Checks system.unmatched_servers for entries first seen in the last N hours
(default: 25, to cover a daily sync window with margin). If the count
exceeds a threshold (default: 5), posts an Adaptive Card to Teams.

Designed to run after sync pipelines that record unmatched servers
(patching, certificates, etc.).
"""

import os
import re
import logging

from common import (
    setup_logging, create_argument_parser, configure_verbosity,
    validate_env_vars, http_request, get_database_connection
)

logger = setup_logging('unmatched_spike_alert')

_TEAMS_WEBHOOK_RE = re.compile(r'^https://[a-zA-Z0-9-]+\.webhook\.office\.com/')


def _validate_teams_url(url: str) -> None:
    if not url.startswith('https://'):
        raise ValueError(
            f"TEAMS_WEBHOOK_URL must use HTTPS — got: {url!r}"
        )
    if not _TEAMS_WEBHOOK_RE.match(url):
        raise ValueError(
            f"TEAMS_WEBHOOK_URL must be an outlook.webhook.office.com URL — "
            f"got: {url!r}. Set TEAMS_WEBHOOK_URL to the webhook URL from your Teams channel."
        )


SPIKE_QUERY = """
    SELECT
        um.server_name_raw,
        um.source_system,
        um.occurrence_count,
        um.first_seen_at,
        (
            SELECT s.server_name
            FROM shared.servers s
            WHERE s.is_active
              AND similarity(system.normalize_server_name(s.server_name), um.server_name_normalized) > 0.3
            ORDER BY similarity(
                system.normalize_server_name(s.server_name),
                um.server_name_normalized
            ) DESC, s.server_name
            LIMIT 1
        ) AS suggested_match
    FROM system.unmatched_servers um
    WHERE um.status = 'pending'
      AND um.first_seen_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour' * %s
    ORDER BY um.first_seen_at DESC
"""


def build_adaptive_card(unmatched: list) -> dict:
    """Build a Teams Adaptive Card for unmatched server spike."""
    sources = {}
    for u in unmatched:
        src = u['source_system'] or 'unknown'
        sources[src] = sources.get(src, 0) + 1

    source_summary = ", ".join(f"{v} from {k}" for k, v in sorted(sources.items()))

    facts = []
    for u in unmatched[:20]:  # Cap at 20 to avoid huge cards
        label = u['server_name_raw']
        src = u['source_system'] or '?'
        suggestion = u.get('suggested_match')
        value = f"Source: {src}"
        if suggestion:
            value += f" | Closest match: {suggestion}"
        facts.append({"title": label, "value": value})

    overflow = len(unmatched) - 20
    body = [
        {
            "type": "TextBlock",
            "size": "medium",
            "weight": "bolder",
            "text": f"Unmatched Server Spike: {len(unmatched)} new entries",
            "style": "heading",
            "color": "warning"
        },
        {
            "type": "TextBlock",
            "text": f"**{source_summary}**",
            "wrap": True
        },
        {
            "type": "FactSet",
            "facts": facts
        }
    ]

    if overflow > 0:
        body.append({
            "type": "TextBlock",
            "text": f"_...and {overflow} more. Check the Operations Platform for the full list._",
            "isSubtle": True,
            "wrap": True
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


def main():
    parser = create_argument_parser(
        'Alert Teams on unmatched server spikes',
        include_dry_run=True
    )
    parser.add_argument(
        '--threshold', type=int, default=5,
        help='Minimum new unmatched servers to trigger alert (default: 5)'
    )
    parser.add_argument(
        '--hours', type=int, default=25,
        help='Look-back window in hours (default: 25)'
    )
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    if args.threshold < 1:
        parser.error("--threshold must be at least 1")

    validate_env_vars(['TEAMS_WEBHOOK_URL'])
    webhook_url = os.environ['TEAMS_WEBHOOK_URL']
    _validate_teams_url(webhook_url)

    conn = get_database_connection(app_name='unmatched_spike_alert')
    try:
        with conn.cursor() as cur:
            cur.execute(SPIKE_QUERY, (args.hours,))
            unmatched = [dict(row) for row in cur.fetchall()]

        logger.info(
            f"Found {len(unmatched)} new unmatched servers in the last {args.hours}h "
            f"(threshold: {args.threshold})"
        )

        if len(unmatched) < args.threshold:
            logger.info("Below threshold — no alert needed")
            return

        logger.warning(f"Spike detected ({len(unmatched)} >= {args.threshold}) — sending alert")
        card = build_adaptive_card(unmatched)

        if args.dry_run:
            import json
            logger.info(f"[DRY RUN] Would post to Teams:\n{json.dumps(card, indent=2, default=str)}")
            return

        http_request('POST', webhook_url, json=card, retries=2, timeout=15)
        logger.info("Teams alert sent")
    finally:
        conn.close()


if __name__ == '__main__':
    main()

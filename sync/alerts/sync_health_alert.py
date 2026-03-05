"""Check Operations Platform health and alert Teams when degraded.

Queries the /api/health endpoint and posts an Adaptive Card to a Teams
webhook when any sync is unhealthy or stale. Designed to run after all
daily syncs have completed.
"""

import os
import logging

from common import (
    setup_logging, create_argument_parser, configure_verbosity,
    validate_env_vars, http_request
)

logger = setup_logging('health_alert')

STATUS_COLOURS = {
    'error':   'attention',   # red
    'stale':   'warning',     # yellow
    'warning': 'warning',
    'healthy': 'good',        # green
}


def build_adaptive_card(summary: dict) -> dict:
    """Build a Teams Adaptive Card from health summary."""
    overall = summary['overallStatus']

    facts = []
    for sync in summary['syncStatuses']:
        status = sync['freshnessStatus']
        icon = '\U0001f534' if status in ('error', 'stale') else '\U0001f7e1' if status == 'warning' else '\U0001f7e2'
        hours = sync.get('hoursSinceSuccess')
        age = f" ({hours:.0f}h ago)" if hours else " (never)"

        detail = f"{icon} {status.upper()}{age}"
        if sync.get('lastErrorMessage'):
            detail += f" — {sync['lastErrorMessage'][:100]}"

        facts.append({"title": sync['syncName'], "value": detail})

    unreachable = summary.get('unreachableServersCount', 0)
    if unreachable > 0:
        facts.append({
            "title": "Unreachable Servers",
            "value": f"\U0001f534 {unreachable}"
        })

    unmatched = summary.get('unmatchedServersCount', 0)
    if unmatched > 0:
        facts.append({
            "title": "Unmatched Servers",
            "value": f"\U0001f7e1 {unmatched}"
        })

    return {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.4",
                "body": [
                    {
                        "type": "TextBlock",
                        "size": "medium",
                        "weight": "bolder",
                        "text": f"Operations Platform Health: {overall.upper()}",
                        "style": "heading",
                        "color": STATUS_COLOURS.get(overall, 'default')
                    },
                    {
                        "type": "FactSet",
                        "facts": facts
                    }
                ]
            }
        }]
    }


def main():
    parser = create_argument_parser(
        'Check sync health and alert Teams when degraded',
        include_dry_run=True
    )
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    validate_env_vars(['TEAMS_WEBHOOK_URL', 'OPS_API_URL'])
    webhook_url = os.environ['TEAMS_WEBHOOK_URL']
    health_url = os.environ['OPS_API_URL'].rstrip('/') + '/api/health'

    logger.info(f"Querying health endpoint: {health_url}")
    resp = http_request('GET', health_url, retries=2, timeout=30)
    summary = resp.json()

    overall = summary.get('overallStatus', 'unknown')
    logger.info(f"Overall status: {overall}")

    if overall == 'healthy':
        logger.info("All syncs healthy — no alert needed")
        return

    logger.warning(f"Health degraded ({overall}) — building Teams alert")
    card = build_adaptive_card(summary)

    if args.dry_run:
        import json
        logger.info(f"[DRY RUN] Would post to Teams:\n{json.dumps(card, indent=2)}")
        return

    http_request('POST', webhook_url, json=card, retries=2, timeout=15)
    logger.info("Teams alert sent successfully")


if __name__ == '__main__':
    main()

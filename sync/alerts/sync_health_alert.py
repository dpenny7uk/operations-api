"""Check Operations Platform health and alert Teams when degraded.

Queries the database directly for sync status and posts an Adaptive Card
to a Teams webhook when any sync is unhealthy or stale. Designed to run
after all daily syncs have completed.
"""

import os
import logging

from common import (
    setup_logging, create_argument_parser, configure_verbosity,
    validate_env_vars, http_request, get_database_connection
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


def query_health_summary() -> dict:
    """Query sync health directly from the database."""
    conn = get_database_connection(app_name='health_alert')
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    sync_name AS "syncName",
                    status,
                    last_success_at,
                    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - last_success_at)) / 3600
                        AS "hoursSinceSuccess",
                    CASE
                        WHEN last_success_at IS NULL THEN 'error'
                        WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - last_success_at)) / 3600 > max_age_hours THEN 'stale'
                        WHEN consecutive_failures > 0 THEN 'warning'
                        ELSE 'healthy'
                    END AS "freshnessStatus",
                    records_processed AS "recordsProcessed",
                    consecutive_failures AS "consecutiveFailures",
                    last_error_message AS "lastErrorMessage",
                    expected_schedule AS "expectedSchedule"
                FROM system.sync_status
                ORDER BY CASE status
                    WHEN 'error' THEN 1
                    WHEN 'warning' THEN 2
                    ELSE 3
                END
            """)
            syncs = [dict(row) for row in cur.fetchall()]

            cur.execute(
                "SELECT COUNT(*) AS cnt FROM system.unmatched_servers WHERE status = 'pending'"
            )
            unmatched = cur.fetchone()['cnt']

            cur.execute(
                "SELECT COUNT(*) AS cnt FROM system.scan_failures WHERE NOT is_resolved"
            )
            unreachable = cur.fetchone()['cnt']

        has_error = any(s['status'] == 'error' or s['freshnessStatus'] == 'error' for s in syncs)
        has_warning = any(s['status'] == 'warning' or s['freshnessStatus'] == 'stale' for s in syncs)

        return {
            'overallStatus': 'error' if has_error else 'warning' if has_warning else 'healthy',
            'syncStatuses': syncs,
            'unmatchedServersCount': unmatched,
            'unreachableServersCount': unreachable,
        }
    finally:
        conn.close()


def main():
    parser = create_argument_parser(
        'Check sync health and alert Teams when degraded',
        include_dry_run=True
    )
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    validate_env_vars(['TEAMS_WEBHOOK_URL'])
    webhook_url = os.environ['TEAMS_WEBHOOK_URL']

    logger.info("Querying database for sync health")
    summary = query_health_summary()

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

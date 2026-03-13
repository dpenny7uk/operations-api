"""Alert Teams about upcoming patch cycles.

Sends an Adaptive Card to Teams when a patch cycle is N days away
(default: 5). Includes server names grouped by patch group, scheduled
times, applications, and any linked known issues with Confluence links.

Run twice from the pipeline: --days-ahead 5 (advance warning) and
--days-ahead 0 (day-of reminder).
"""

import json
import os
import re
import logging
from collections import defaultdict

from common import (
    setup_logging, create_argument_parser, configure_verbosity,
    validate_env_vars, http_request, get_database_connection
)

logger = setup_logging('patch_cycle_alert')

_TEAMS_WEBHOOK_RE = re.compile(r'^https://[a-zA-Z0-9-]+\.webhook\.office\.com/')

CARD_SIZE_LIMIT = 28_000  # Teams Adaptive Card limit ~28KB


def _validate_teams_url(url: str) -> None:
    if not url.startswith('https://'):
        raise ValueError(
            f"TEAMS_WEBHOOK_URL must use HTTPS — got: {url!r}"
        )


UPCOMING_QUERY = """
    WITH upcoming AS (
        SELECT pc.cycle_id, pc.cycle_date
        FROM patching.patch_cycles pc
        WHERE pc.status = 'active'
          AND pc.cycle_date = CURRENT_DATE + INTERVAL '1 day' * %s
    ),
    schedule AS (
        SELECT ps.cycle_id, ps.server_name, ps.patch_group, ps.app, ps.service,
               COALESCE(pw.scheduled_time, ps.scheduled_time) AS scheduled_time
        FROM patching.patch_schedule ps
        JOIN upcoming u ON u.cycle_id = ps.cycle_id
        LEFT JOIN patching.patch_windows pw
            ON pw.patch_group = ps.patch_group AND pw.window_type = ps.server_type
    ),
    issues AS (
        SELECT DISTINCT s.server_name, ki.title, ki.severity, ki.confluence_url
        FROM schedule s
        JOIN patching.known_issues ki ON ki.is_active AND (
            s.app = ANY(ki.affected_apps) OR s.service = ANY(ki.affected_services)
        )
    )
    SELECT u.cycle_date, s.server_name, s.patch_group, s.scheduled_time, s.app,
           i.title AS issue_title, i.severity AS issue_severity, i.confluence_url
    FROM upcoming u
    JOIN schedule s ON s.cycle_id = u.cycle_id
    LEFT JOIN issues i ON i.server_name = s.server_name
    ORDER BY s.scheduled_time, s.patch_group, s.server_name
"""


def _severity_prefix(severity: str | None) -> str:
    if not severity:
        return ""
    s = severity.upper()
    if s == 'CRITICAL':
        return "\U0001f534 CRITICAL"
    if s == 'HIGH':
        return "\U0001f7e0 HIGH"
    return "\U0001f7e1 MEDIUM"


def build_adaptive_cards(rows: list, days_ahead: int) -> list[dict]:
    """Build one or more Teams Adaptive Cards for the patch cycle.

    Groups servers by patch group. If the card exceeds CARD_SIZE_LIMIT,
    splits into multiple cards by patch group.
    """
    if not rows:
        return []

    cycle_date = rows[0]['cycle_date']
    date_str = cycle_date.strftime('%d %B %Y')

    if days_ahead == 0:
        header_text = f"\U0001f6a8 Patching TODAY: {date_str}"
    else:
        day_word = "day" if days_ahead == 1 else "days"
        header_text = f"\U0001f4c5 Upcoming Patch Cycle: {date_str}"
        subtitle = f"{days_ahead} {day_word} away"

    # Group servers by patch group (deduplicate server rows from issue joins)
    groups: dict[str, dict] = {}
    seen_servers: dict[str, set] = defaultdict(set)
    all_issues: dict[str, dict] = {}

    for row in rows:
        pg = row['patch_group'] or 'unknown'
        server = row['server_name']

        if pg not in groups:
            groups[pg] = {
                'scheduled_time': row['scheduled_time'],
                'servers': []
            }

        if server not in seen_servers[pg]:
            seen_servers[pg].add(server)
            groups[pg]['servers'].append({
                'server_name': server,
                'app': row['app'] or '—'
            })

        if row.get('issue_title'):
            issue_key = row['issue_title']
            if issue_key not in all_issues:
                all_issues[issue_key] = {
                    'title': row['issue_title'],
                    'severity': row['issue_severity'],
                    'confluence_url': row.get('confluence_url')
                }

    total_servers = sum(len(g['servers']) for g in groups.values())

    # Build card body sections per group
    group_sections = []
    for pg_name, pg_data in groups.items():
        time_label = pg_data['scheduled_time'] or 'TBC'
        section = [
            {
                "type": "TextBlock",
                "text": f"\U0001f4e6 **{pg_name.upper()}** ({time_label} UTC)",
                "weight": "bolder",
                "spacing": "medium",
                "separator": True
            },
            {
                "type": "ColumnSet",
                "columns": [
                    {"type": "Column", "width": "stretch", "items": [
                        {"type": "TextBlock", "text": "\U0001f5a5\ufe0f **Server**", "weight": "bolder", "size": "small"}
                    ]},
                    {"type": "Column", "width": "stretch", "items": [
                        {"type": "TextBlock", "text": "\U0001f4cb **Application**", "weight": "bolder", "size": "small"}
                    ]}
                ],
                "spacing": "small"
            }
        ]
        for s in pg_data['servers']:
            section.append({
                "type": "ColumnSet",
                "columns": [
                    {"type": "Column", "width": "stretch", "items": [
                        {"type": "TextBlock", "text": s['server_name'], "size": "small"}
                    ]},
                    {"type": "Column", "width": "stretch", "items": [
                        {"type": "TextBlock", "text": s['app'], "size": "small"}
                    ]}
                ],
                "spacing": "none"
            })
        group_sections.append((pg_name, section))

    # Build issue section
    issue_body = []
    if all_issues:
        issue_body.append({
            "type": "TextBlock",
            "text": "\u26a0\ufe0f **KNOWN ISSUES**",
            "weight": "bolder",
            "spacing": "large",
            "separator": True,
            "color": "attention"
        })
        for issue in sorted(all_issues.values(),
                            key=lambda i: {'CRITICAL': 0, 'HIGH': 1}.get(
                                (i['severity'] or '').upper(), 2)):
            prefix = _severity_prefix(issue['severity'])
            text = f"{prefix} — {issue['title']}"
            if issue.get('confluence_url'):
                text += f" — [View Fix]({issue['confluence_url']})"
            issue_body.append({
                "type": "TextBlock",
                "text": text,
                "wrap": True,
                "spacing": "small"
            })

    # Build header
    header = [
        {
            "type": "TextBlock",
            "size": "large",
            "weight": "bolder",
            "text": header_text,
            "style": "heading",
            "color": "accent" if days_ahead > 0 else "attention"
        }
    ]
    if days_ahead > 0:
        header.append({
            "type": "TextBlock",
            "text": f"**{subtitle} \u2014 \U0001f5a5\ufe0f {total_servers} servers scheduled**",
            "wrap": True
        })
    else:
        header.append({
            "type": "TextBlock",
            "text": f"**\U0001f5a5\ufe0f {total_servers} servers scheduled for patching today**",
            "wrap": True
        })

    # Try single card first
    full_body = header[:]
    for _, section in group_sections:
        full_body.extend(section)
    full_body.extend(issue_body)

    card = _wrap_card(full_body)
    card_json = json.dumps(card, default=str)

    if len(card_json) <= CARD_SIZE_LIMIT:
        return [card]

    # Split into multiple cards by patch group
    logger.info(f"Card size {len(card_json)} exceeds limit, splitting by patch group")
    cards = []
    for i, (pg_name, section) in enumerate(group_sections):
        body = header[:] if i == 0 else [{
            "type": "TextBlock",
            "size": "medium",
            "weight": "bolder",
            "text": f"{header_text} (continued)",
            "style": "heading"
        }]
        body.extend(section)
        if i == len(group_sections) - 1:
            body.extend(issue_body)
        cards.append(_wrap_card(body))

    return cards


def _wrap_card(body: list) -> dict:
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
        'Alert Teams about upcoming patch cycles',
        include_dry_run=True
    )
    parser.add_argument(
        '--days-ahead', type=int, default=5,
        help='Number of days before cycle to alert (default: 5)'
    )
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    if args.days_ahead < 0:
        parser.error("--days-ahead must be >= 0")

    validate_env_vars(['TEAMS_PATCHING_WEBHOOK_URL'])
    webhook_url = os.environ['TEAMS_PATCHING_WEBHOOK_URL']
    _validate_teams_url(webhook_url)

    conn = get_database_connection(app_name='patch_cycle_alert')
    try:
        with conn.cursor() as cur:
            cur.execute(UPCOMING_QUERY, (args.days_ahead,))
            rows = [dict(row) for row in cur.fetchall()]

        if not rows:
            logger.info(f"No active patch cycle {args.days_ahead} days from now — no alert needed")
            return

        cycle_date = rows[0]['cycle_date']
        total_unique = len({r['server_name'] for r in rows})
        logger.info(f"Found cycle {cycle_date} with {total_unique} servers")

        cards = build_adaptive_cards(rows, args.days_ahead)

        if args.dry_run:
            for i, card in enumerate(cards):
                logger.info(f"[DRY RUN] Card {i + 1}/{len(cards)}:\n{json.dumps(card, indent=2, default=str)}")
            return

        for i, card in enumerate(cards):
            http_request('POST', webhook_url, json=card, retries=2, timeout=15)
            logger.info(f"Teams alert sent ({i + 1}/{len(cards)})")

    finally:
        conn.close()


if __name__ == '__main__':
    main()

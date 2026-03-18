"""Alert Teams about upcoming patch cycles.

Sends two Adaptive Cards to Teams when a patch cycle is approaching:
Card 1 — Services to be patched (deduplicated services with issue counts,
         plus known issues list at the bottom).
Card 2 — By Environment (services broken down by environment and domain).

Run from the pipeline on Mondays: --days-ahead 5 --weekend to capture
the full Saturday/Sunday patching window.
"""

import json
import os
import re
import logging
import time
from collections import defaultdict

from common import (
    setup_logging, create_argument_parser, configure_verbosity,
    validate_env_vars, http_request, get_database_connection
)

logger = setup_logging('patch_cycle_alert')

_TEAMS_WEBHOOK_RE = re.compile(r'^https://[a-zA-Z0-9-]+\.webhook\.office\.com/')

CARD_SIZE_LIMIT = 25_000  # Teams Adaptive Card limit ~28KB, leave margin

_ENV_CODES = {
    'dv': 'Development', 'pc': 'POC', 'pr': 'Production',
    'ss': 'Shared Services', 'st': 'Staging', 'sy': 'System Test',
    'ut': 'UAT', 'ls': 'Live Support',
}


def _parse_environment(server_name: str) -> str:
    """Extract environment from the 2-char server name prefix."""
    if server_name and len(server_name) >= 2:
        prefix = server_name[:2].lower()
        return _ENV_CODES.get(prefix, prefix.upper())
    return '\u2014'


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
          AND pc.cycle_date BETWEEN (CURRENT_DATE + INTERVAL '1 day' * %s)
                               AND (CURRENT_DATE + INTERVAL '1 day' * %s)
    ),
    schedule AS (
        SELECT ps.cycle_id, ps.server_name, ps.patch_group, ps.app, ps.service,
               ps.domain, ps.business_unit,
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
    SELECT u.cycle_date, s.server_name, s.patch_group, s.scheduled_time, s.service,
           s.domain,
           i.title AS issue_title, i.severity AS issue_severity, i.confluence_url
    FROM upcoming u
    JOIN schedule s ON s.cycle_id = u.cycle_id
    LEFT JOIN issues i ON i.server_name = s.server_name
    WHERE s.business_unit = 'Group'
    ORDER BY s.service, s.server_name
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


def _format_date_range(rows: list) -> str:
    """Format cycle dates — single date or weekend range."""
    dates = sorted({row['cycle_date'] for row in rows})
    if len(dates) == 1:
        return dates[0].strftime('%d %B %Y')
    if dates[0].month == dates[-1].month:
        return f"{dates[0].strftime('%d')} \u2013 {dates[-1].strftime('%d %B %Y')}"
    return f"{dates[0].strftime('%d %B')} \u2013 {dates[-1].strftime('%d %B %Y')}"


def build_adaptive_cards(rows: list, days_ahead: int) -> list[dict]:
    """Build two Teams Adaptive Cards for the patch cycle.

    Card 1: Services to be patched — deduplicated services with issue counts,
            plus known issues list at the bottom.
    Card 2: By Environment — services broken down by environment and domain.

    Each card may be split further if it exceeds CARD_SIZE_LIMIT.
    """
    if not rows:
        return []

    date_str = _format_date_range(rows)
    day_word = "day" if days_ahead == 1 else "days"
    subtitle = f"{days_ahead} {day_word} away"

    # Collect data (deduplicate from issue joins)
    seen_servers: set[str] = set()
    service_names: set[str] = set()
    service_issues: dict[str, set[str]] = defaultdict(set)
    env_keys: set[tuple] = set()
    env_rows: list[dict] = []
    all_issues: dict[str, dict] = {}

    for row in rows:
        server = row['server_name']
        svc = row['service'] or '\u2014'
        domain = row['domain'] or '\u2014'
        env = _parse_environment(server)

        if server not in seen_servers:
            seen_servers.add(server)

        service_names.add(svc)

        env_key = (svc, env, domain)
        if env_key not in env_keys:
            env_keys.add(env_key)
            env_rows.append({'service': svc, 'environment': env, 'domain': domain})

        if row.get('issue_title'):
            issue_key = row['issue_title']
            service_issues[svc].add(issue_key)
            if issue_key not in all_issues:
                all_issues[issue_key] = {
                    'title': row['issue_title'],
                    'severity': row['issue_severity'],
                    'confluence_url': row.get('confluence_url')
                }

    total_servers = len(seen_servers)
    services = sorted(service_names)
    env_rows.sort(key=lambda r: (r['service'], r['environment']))

    # ── Card 1: Services to be patched ───────────────────────────────────
    svc_header = [
        {
            "type": "TextBlock",
            "size": "large",
            "weight": "bolder",
            "text": f"\U0001f4c5 Services to be patched \u2014 {date_str}",
            "style": "heading",
            "color": "accent"
        },
        {
            "type": "TextBlock",
            "text": f"**{subtitle} \u2014 \u2699\ufe0f {len(services)} services**",
            "wrap": True
        },
        {
            "type": "ColumnSet",
            "columns": [
                {"type": "Column", "width": "stretch", "items": [
                    {"type": "TextBlock", "text": "**Service**", "weight": "bolder", "size": "small"}
                ]},
                {"type": "Column", "width": "auto", "items": [
                    {"type": "TextBlock", "text": "**Issues**", "weight": "bolder", "size": "small"}
                ]}
            ],
            "spacing": "small"
        }
    ]

    svc_rows = []
    for svc in services:
        issue_count = len(service_issues.get(svc, set()))
        svc_rows.append({
            "type": "ColumnSet",
            "columns": [
                {"type": "Column", "width": "stretch", "items": [
                    {"type": "TextBlock", "text": svc, "size": "small"}
                ]},
                {"type": "Column", "width": "auto", "items": [
                    {"type": "TextBlock", "text": str(issue_count) if issue_count else "\u2014", "size": "small"}
                ]}
            ],
            "spacing": "none"
        })

    # Build issue section for bottom of Card 1
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
            text = f"{prefix} \u2014 {issue['title']}"
            if issue.get('confluence_url'):
                text += f" \u2014 [View Fix]({issue['confluence_url']})"
            issue_body.append({
                "type": "TextBlock",
                "text": text,
                "wrap": True,
                "spacing": "small"
            })

    svc_cards = _split_card_body(svc_header, svc_rows,
                                 f"\U0001f4c5 Services to be patched \u2014 {date_str} (continued)",
                                 trailing=issue_body)

    # ── Card 2: By Environment ───────────────────────────────────────────
    env_header = [
        {
            "type": "TextBlock",
            "size": "large",
            "weight": "bolder",
            "text": f"\U0001f30d By Environment \u2014 {date_str}",
            "style": "heading",
            "color": "accent"
        },
        {
            "type": "TextBlock",
            "text": f"**\U0001f5a5\ufe0f {total_servers} servers across {len(services)} services**",
            "wrap": True
        },
        {
            "type": "ColumnSet",
            "columns": [
                {"type": "Column", "width": "stretch", "items": [
                    {"type": "TextBlock", "text": "**Service**", "weight": "bolder", "size": "small"}
                ]},
                {"type": "Column", "width": "stretch", "items": [
                    {"type": "TextBlock", "text": "**Environment**", "weight": "bolder", "size": "small"}
                ]},
                {"type": "Column", "width": "stretch", "items": [
                    {"type": "TextBlock", "text": "**Domain**", "weight": "bolder", "size": "small"}
                ]}
            ],
            "spacing": "small"
        }
    ]

    env_data_rows = []
    for r in env_rows:
        env_data_rows.append({
            "type": "ColumnSet",
            "columns": [
                {"type": "Column", "width": "stretch", "items": [
                    {"type": "TextBlock", "text": r['service'], "size": "small"}
                ]},
                {"type": "Column", "width": "stretch", "items": [
                    {"type": "TextBlock", "text": r['environment'], "size": "small"}
                ]},
                {"type": "Column", "width": "stretch", "items": [
                    {"type": "TextBlock", "text": r['domain'], "size": "small"}
                ]}
            ],
            "spacing": "none"
        })

    env_cards = _split_card_body(env_header, env_data_rows,
                                 f"\U0001f30d By Environment \u2014 {date_str} (continued)")

    cards = svc_cards + env_cards
    if len(cards) > 2:
        logger.info(f"Cards split into {len(cards)} parts to stay under size limit")
    return cards


def _split_card_body(header: list, rows: list, continuation_title: str,
                     trailing: list | None = None) -> list[dict]:
    """Split rows across multiple cards if they exceed CARD_SIZE_LIMIT."""
    cards = []
    current_body = header[:]

    for row in rows:
        test_body = current_body + [row]
        if len(json.dumps(_wrap_card(test_body), default=str)) > CARD_SIZE_LIMIT and len(current_body) > len(header):
            cards.append(_wrap_card(current_body))
            current_body = [{
                "type": "TextBlock",
                "size": "medium",
                "weight": "bolder",
                "text": continuation_title,
                "style": "heading"
            }]
        current_body.append(row)

    if trailing:
        test_body = current_body + trailing
        if len(json.dumps(_wrap_card(test_body), default=str)) <= CARD_SIZE_LIMIT:
            current_body.extend(trailing)
        else:
            cards.append(_wrap_card(current_body))
            current_body = [{
                "type": "TextBlock",
                "size": "medium",
                "weight": "bolder",
                "text": f"{continuation_title} \u2014 Known Issues",
                "style": "heading"
            }] + trailing

    cards.append(_wrap_card(current_body))
    return cards


def _wrap_card(body: list) -> dict:
    return {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": body
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
    parser.add_argument(
        '--weekend', action='store_true',
        help='Capture full weekend (target date + next day) in one alert'
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
        days_end = args.days_ahead + 1 if args.weekend else args.days_ahead
        with conn.cursor() as cur:
            cur.execute(UPCOMING_QUERY, (args.days_ahead, days_end))
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
            if i > 0:
                time.sleep(2)
            http_request('POST', webhook_url, json=card, retries=2, timeout=15)
            logger.info(f"Teams alert sent ({i + 1}/{len(cards)})")

    finally:
        conn.close()


if __name__ == '__main__':
    main()

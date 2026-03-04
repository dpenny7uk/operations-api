#!/usr/bin/env python3
"""Sync known issues from Confluence to PostgreSQL."""

import os
import sys
import hashlib
from html.parser import HTMLParser
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (
    setup_logging, validate_env_vars, create_argument_parser,
    configure_verbosity, SyncContext
)

logger = setup_logging('sync_confluence_issues')


class TableParser(HTMLParser):
    """Parse HTML tables from Confluence storage format."""

    def __init__(self):
        super().__init__()
        self.tables = []
        self.current_table = []
        self.current_row = []
        self.current_cell = ""
        self.in_td = False
        self.in_th = False

    def handle_starttag(self, tag, attrs):
        if tag == 'td':
            self.in_td = True
        elif tag == 'th':
            self.in_th = True
        elif tag == 'tr':
            self.current_row = []
        elif tag == 'table':
            self.current_table = []

    def handle_endtag(self, tag):
        if tag in ('td', 'th'):
            self.current_row.append(self.current_cell.strip())
            self.current_cell = ""
            self.in_td = False
            self.in_th = False
        elif tag == 'tr' and self.current_row:
            self.current_table.append(self.current_row)
        elif tag == 'table' and self.current_table:
            self.tables.append(self.current_table)

    def handle_data(self, data):
        if self.in_td or self.in_th:
            self.current_cell += data


def fetch_confluence_pages(ctx) -> list:
    """Fetch child pages from Confluence parent page."""
    validate_env_vars(['CONFLUENCE_URL', 'CONFLUENCE_TOKEN', 'CONFLUENCE_PARENT_PAGE_ID'])
    
    base_url = os.environ['CONFLUENCE_URL'].rstrip('/')
    headers = {
        "Authorization": f"Bearer {os.environ['CONFLUENCE_TOKEN']}",
        "Accept": "application/json"
    }
    parent_id = os.environ['CONFLUENCE_PARENT_PAGE_ID']

    response = requests.get(
        f"{base_url}/rest/api/content/{parent_id}/child/page",
        headers=headers,
        params={
            "limit": 100,
            "expand": "body.storage"
        },
        timeout=60
    )
    response.raise_for_status()
    
    pages = response.json().get('results', [])
    logger.info(f"Fetched {len(pages)} pages from Confluence")
    return pages


def parse_issue_page(page: dict) -> dict:
    """Parse a Confluence page into an issue dict."""
    content = page.get('body', {}).get('storage', {}).get('value', '')
    
    # Parse HTML tables
    parser = TableParser()
    parser.feed(content)
    
    issue = {
        'confluence_page_id': page['id'],
        'confluence_url': page.get('_links', {}).get('webui', ''),
        'title': page.get('title', '')[:500]
    }

    # Extract fields from key-value tables
    for table in parser.tables:
        for row in table:
            if len(row) < 2:
                continue
            
            key = row[0].lower().replace(':', '').strip()
            val = row[1].strip()
            
            if 'trigger' in key:
                issue['trigger_description'] = val
            elif 'signature' in key:
                issue['signature'] = val
            elif 'fix' in key:
                issue['fix'] = val
            elif 'category' in key and 'note' not in key:
                issue['category'] = val
            elif 'application' in key:
                issue['application'] = val
            elif 'status' in key:
                issue['status'] = val

    # Determine severity from category
    category = (issue.get('category') or '').upper()
    if category in ('CRITICAL', 'P1'):
        issue['severity'] = 'CRITICAL'
    elif category in ('HIGH', 'P2'):
        issue['severity'] = 'HIGH'
    elif category in ('LOW', 'P4', 'INFO'):
        issue['severity'] = 'LOW'
    else:
        issue['severity'] = 'MEDIUM'

    # Determine active status
    status = issue.get('status', '').upper()
    issue['is_active'] = status not in ('RESOLVED', 'CLOSED', 'INACTIVE')

    # Generate content hash for dedup
    sig_content = f"{issue.get('title', '')}{issue.get('trigger_description', '')}{issue.get('signature', '')}"
    issue['content_hash'] = hashlib.md5(sig_content.encode()).hexdigest()

    return issue


def sync_issues(ctx, issues: list):
    """Sync issues to PostgreSQL."""
    with ctx.conn.cursor() as cur:
        for issue in issues:
            ctx.stats.processed += 1
            
            try:
                cur.execute("""
                    INSERT INTO patching.known_issues (
                        title, application, category, status, severity, is_active,
                        trigger_description, signature, fix,
                        confluence_page_id, confluence_url, last_synced_at
                    )
                    VALUES (
                        %(title)s, %(application)s, %(category)s, %(status)s,
                        %(severity)s, %(is_active)s, %(trigger_description)s,
                        %(signature)s, %(fix)s, %(confluence_page_id)s,
                        %(confluence_url)s, CURRENT_TIMESTAMP
                    )
                    ON CONFLICT (confluence_page_id) DO UPDATE SET
                        title = EXCLUDED.title,
                        application = EXCLUDED.application,
                        category = EXCLUDED.category,
                        status = EXCLUDED.status,
                        severity = EXCLUDED.severity,
                        is_active = EXCLUDED.is_active,
                        trigger_description = EXCLUDED.trigger_description,
                        signature = EXCLUDED.signature,
                        fix = EXCLUDED.fix,
                        last_synced_at = CURRENT_TIMESTAMP
                """, issue)
                ctx.stats.updated += 1
                
            except Exception as e:
                ctx.stats.add_error(f"Failed to sync {issue.get('title', '?')}: {e}")
                logger.error(f"Error syncing issue: {e}")

        if not ctx.dry_run:
            ctx.conn.commit()


def main():
    parser = create_argument_parser("Sync known issues from Confluence")
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    with SyncContext("confluence_issues", "Confluence Issues Sync", dry_run=args.dry_run) as ctx:
        pages = fetch_confluence_pages(ctx)
        issues = [parse_issue_page(p) for p in pages]
        sync_issues(ctx, issues)


if __name__ == "__main__":
    main()

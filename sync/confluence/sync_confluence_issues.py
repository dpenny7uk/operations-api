#!/usr/bin/env python3
"""Sync known patching issues from Confluence to PostgreSQL.

Parses Confluence child pages that follow this template structure:
- Properties table at top: Status, Application, Category
- Heading-based sections: Trigger, Signature, Fix
- Fix section may contain service names and server roles

Populates patching.known_issues including the matching arrays
(affected_apps, affected_services) used by v_servers_with_issues
to auto-link issues to servers during patch cycles.
"""

import os
import sys
import re
import hashlib
from html.parser import HTMLParser

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (
    setup_logging, validate_env_vars, create_argument_parser,
    configure_verbosity, SyncContext, http_request
)

logger = setup_logging('sync_confluence_issues')


# ── Confluence page parser ───────────────────────────────────────────────────

class ConfluencePageParser(HTMLParser):
    """Parse Confluence storage format to extract tables and heading sections.

    Handles:
    - <table> key-value pairs (Status, Application, Category)
    - <h1>-<h6> headings followed by content (Trigger, Signature, Fix)
    - <ac:structured-macro ac:name="status"> for Confluence status labels
    - <ac:parameter ac:name="title"> for status label text
    """

    def __init__(self):
        super().__init__()
        # Table parsing
        self.tables = []
        self._table = []
        self._row = []
        self._cell = ""
        self._in_cell = False

        # Heading/section parsing
        self.sections = {}  # heading_text -> content
        self._current_heading = None
        self._in_heading = False
        self._heading_text = ""
        self._section_text = ""

        # Confluence macro parsing
        self._in_status_macro = False
        self._in_status_param = False
        self._status_text = ""

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)

        # Confluence structured macros (ac: namespace comes through as raw tags)
        if tag == 'ac:structured-macro':
            if attrs_dict.get('ac:name') == 'status':
                self._in_status_macro = True
        elif tag == 'ac:parameter':
            if self._in_status_macro and attrs_dict.get('ac:name') == 'title':
                self._in_status_param = True

        # Standard HTML
        elif tag in ('td', 'th'):
            self._in_cell = True
            self._cell = ""
        elif tag == 'tr':
            self._row = []
        elif tag == 'table':
            self._table = []
        elif tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self._flush_section()
            self._in_heading = True
            self._heading_text = ""
        elif tag == 'br':
            if self._in_cell:
                self._cell += "\n"
            elif self._current_heading:
                self._section_text += "\n"
        elif tag == 'li':
            if self._current_heading:
                self._section_text += "\n"

    def handle_endtag(self, tag):
        if tag == 'ac:structured-macro':
            self._in_status_macro = False
        elif tag == 'ac:parameter':
            if self._in_status_param:
                self._in_status_param = False
                # Inject status text into current context
                if self._in_cell:
                    self._cell += self._status_text
                elif self._current_heading:
                    self._section_text += self._status_text
                self._status_text = ""

        elif tag in ('td', 'th'):
            self._row.append(self._cell.strip())
            self._cell = ""
            self._in_cell = False
        elif tag == 'tr' and self._row:
            self._table.append(self._row)
        elif tag == 'table' and self._table:
            self.tables.append(self._table)
        elif tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self._in_heading = False
            heading = self._heading_text.strip().rstrip(':').lower()
            if heading:
                self._current_heading = heading
                self._section_text = ""

    def handle_data(self, data):
        if self._in_status_param:
            self._status_text += data
        elif self._in_cell:
            self._cell += data
        elif self._in_heading:
            self._heading_text += data
        elif self._current_heading:
            self._section_text += data

    def _flush_section(self):
        """Save the current section before starting a new one."""
        if self._current_heading and self._section_text.strip():
            self.sections[self._current_heading] = self._section_text.strip()
        self._current_heading = None
        self._section_text = ""

    def close(self):
        self._flush_section()
        super().close()


# ── Page parsing ─────────────────────────────────────────────────────────────

# Patterns for extracting Windows service names from Fix sections
SERVICE_NAME_RE = re.compile(
    r'\b([A-Z][a-zA-Z]+(?:\.[A-Z][a-zA-Z]+)+)\b'  # Dotted names: Rms.MRIService
    r'|'
    r'\b([A-Z][a-z]+(?:[A-Z][a-z]+)*?(?:Service|Host|Engine|Agent)s?)\b'  # PascalCase ending in Service/Host/Engine/Agent
)

# Category to patch type mapping
CATEGORY_MAP = {
    'windows': ('Windows O/S', True, False, False),
    'sql':     ('SQL Server',  False, True, False),
    'other':   ('Other',       False, False, True),
}

# Statuses that mean the issue is no longer active
INACTIVE_STATUSES = {'RESOLVED', 'CLOSED', 'INACTIVE', 'WITHDRAWN'}


def parse_issue_page(page: dict) -> dict:
    """Parse a Confluence page into an issue dict."""
    content = page.get('body', {}).get('storage', {}).get('value', '')

    parser = ConfluencePageParser()
    parser.feed(content)
    parser.close()

    issue = {
        'confluence_page_id': page['id'],
        'confluence_url': page.get('_links', {}).get('webui', ''),
        'title': page.get('title', '')[:500],
        'trigger_description': None,
        'signature': None,
        'fix': None,
        'category': None,
        'application': None,
        'status': None,
        'category_notes': None,
    }

    # ── Extract from properties table (first table only) ────────────────
    # Later tables (e.g. service lists inside Fix) have Status/Name columns
    # that would overwrite the page-level properties.
    if parser.tables:
        for row in parser.tables[0]:
            if len(row) < 2:
                continue
            key = row[0].lower().replace(':', '').strip()
            val = row[1].strip()
            if not val:
                continue

            if 'category' in key and 'note' not in key:
                issue['category'] = val
            elif 'application' in key:
                issue['application'] = val
            elif 'status' in key:
                issue['status'] = val

    # ── Extract from heading sections ────────────────────────────────────
    for heading, text in parser.sections.items():
        if 'trigger' in heading:
            issue['trigger_description'] = text
        elif 'signature' in heading:
            issue['signature'] = text
        elif heading == 'fix' or heading.startswith('fix'):
            issue['fix'] = text
        elif 'note' in heading and 'category' in heading:
            issue['category_notes'] = text

    # ── Derive patch type flags from category ────────────────────────────
    category_lower = (issue['category'] or '').lower()
    patch_types = []
    applies_win = applies_sql = applies_other = False

    for keyword, (ptype, w, s, o) in CATEGORY_MAP.items():
        if keyword in category_lower:
            patch_types.append(ptype)
            applies_win = applies_win or w
            applies_sql = applies_sql or s
            applies_other = applies_other or o

    if not patch_types:
        applies_other = True
        patch_types.append('Other')

    issue['patch_types'] = patch_types
    issue['applies_to_windows'] = applies_win
    issue['applies_to_sql'] = applies_sql
    issue['applies_to_other'] = applies_other

    # ── Build affected_apps from Application field ───────────────────────
    app = (issue.get('application') or '').strip()
    issue['affected_apps'] = [app] if app else []

    # ── Extract affected_services from Fix/Signature + all table cells ──
    services = set()

    # Scan free-text sections
    for text in (issue.get('fix') or '', issue.get('signature') or ''):
        for match in SERVICE_NAME_RE.finditer(text):
            svc = match.group(1) or match.group(2)
            if svc:
                services.add(svc)

    # Scan all table cells (service tables inside Fix have names in cells)
    # Skip the first table (properties) to avoid false positives
    for table in parser.tables[1:]:
        for row in table:
            for cell in row:
                for match in SERVICE_NAME_RE.finditer(cell):
                    svc = match.group(1) or match.group(2)
                    if svc:
                        services.add(svc)

    issue['affected_services'] = sorted(services)

    # ── Severity: derive from title/content since category is patch type ─
    title_lower = (issue['title'] or '').lower()
    fix_lower = (issue.get('fix') or '').lower()
    if 'outage' in title_lower or 'down' in title_lower or 'critical' in title_lower:
        issue['severity'] = 'CRITICAL'
    elif 'reboot' in fix_lower or 'restart' in fix_lower or 'service' in fix_lower:
        issue['severity'] = 'HIGH'
    else:
        issue['severity'] = 'MEDIUM'

    # ── Active status ────────────────────────────────────────────────────
    status_upper = (issue.get('status') or '').upper()
    issue['is_active'] = status_upper not in INACTIVE_STATUSES
    # DRAFT pages are not yet confirmed issues
    if status_upper == 'DRAFT':
        issue['is_active'] = False

    # ── Content hash for change detection ────────────────────────────────
    sig_content = (
        f"{issue.get('title', '')}"
        f"{issue.get('trigger_description', '')}"
        f"{issue.get('signature', '')}"
        f"{issue.get('fix', '')}"
    )
    issue['content_hash'] = hashlib.md5(sig_content.encode()).hexdigest()

    return issue


# ── Confluence API ───────────────────────────────────────────────────────────

def fetch_confluence_pages(ctx) -> list:
    """Fetch all child pages from Confluence parent page (handles pagination)."""
    validate_env_vars(['CONFLUENCE_URL', 'CONFLUENCE_TOKEN', 'CONFLUENCE_PARENT_PAGE_ID'])

    base_url = os.environ['CONFLUENCE_URL'].rstrip('/')
    headers = {
        "Authorization": f"Bearer {os.environ['CONFLUENCE_TOKEN']}",
        "Accept": "application/json"
    }
    parent_id = os.environ['CONFLUENCE_PARENT_PAGE_ID']

    pages = []
    start = 0
    page_size = 100

    while True:
        response = http_request(
            'GET',
            f"{base_url}/rest/api/content/{parent_id}/child/page",
            headers=headers,
            params={
                "limit": page_size,
                "start": start,
                "expand": "body.storage"
            },
            timeout=60
        )

        data = response.json()
        batch = data.get('results', [])
        pages.extend(batch)

        if len(batch) < page_size:
            break
        start += page_size

    logger.info(f"Fetched {len(pages)} pages from Confluence")
    return pages


# ── Database sync ────────────────────────────────────────────────────────────

def sync_issues(ctx, issues: list):
    """Sync issues to PostgreSQL."""
    with ctx.conn.cursor() as cur:
        for issue in issues:
            ctx.stats.processed += 1

            try:
                cur.execute("SAVEPOINT issue")
                cur.execute("""
                    INSERT INTO patching.known_issues (
                        title, application, category, status, severity, is_active,
                        trigger_description, signature, fix, category_notes,
                        patch_types, applies_to_windows, applies_to_sql, applies_to_other,
                        affected_apps, affected_services,
                        confluence_page_id, confluence_url, last_synced_at
                    )
                    VALUES (
                        %(title)s, %(application)s, %(category)s, %(status)s,
                        %(severity)s, %(is_active)s, %(trigger_description)s,
                        %(signature)s, %(fix)s, %(category_notes)s,
                        %(patch_types)s, %(applies_to_windows)s, %(applies_to_sql)s,
                        %(applies_to_other)s,
                        %(affected_apps)s, %(affected_services)s,
                        %(confluence_page_id)s, %(confluence_url)s, CURRENT_TIMESTAMP
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
                        category_notes = EXCLUDED.category_notes,
                        patch_types = EXCLUDED.patch_types,
                        applies_to_windows = EXCLUDED.applies_to_windows,
                        applies_to_sql = EXCLUDED.applies_to_sql,
                        applies_to_other = EXCLUDED.applies_to_other,
                        affected_apps = EXCLUDED.affected_apps,
                        affected_services = EXCLUDED.affected_services,
                        last_synced_at = CURRENT_TIMESTAMP
                """, issue)
                cur.execute("RELEASE SAVEPOINT issue")
                ctx.stats.updated += 1

            except Exception as e:
                cur.execute("ROLLBACK TO SAVEPOINT issue")
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

        logger.info(
            f"Parsed {len(issues)} issues: "
            f"{sum(1 for i in issues if i['is_active'])} active, "
            f"{sum(1 for i in issues if i.get('fix'))} with fix steps, "
            f"{sum(1 for i in issues if i.get('affected_services'))} with service names"
        )

        sync_issues(ctx, issues)


if __name__ == "__main__":
    main()

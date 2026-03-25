"""Tests for Confluence page parser and issue extraction."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'confluence'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sync_confluence_issues import ConfluencePageParser, parse_issue_page, SERVICE_NAME_RE


# ── Sample Confluence storage HTML ───────────────────────────────────────────

RISKLINK_PAGE_HTML = """\
<table>
<tr><td>Status</td><td><ac:structured-macro ac:name="status">\
<ac:parameter ac:name="title">PUBLISHED</ac:parameter></ac:structured-macro></td></tr>
<tr><td>Application</td><td>RiskLink</td></tr>
<tr><td>Category</td><td>Windows O/S Patching</td></tr>
</table>
<h2>Trigger:</h2>
<p>Reboot of any core RiskLink server following patching including:</p>
<p>Head Node</p>
<p>Compute Node</p>
<p>Core SQL Host</p>
<h2>Signature:</h2>
<p>Jobs stall.</p>
<p>New jobs do not start running.</p>
<h2>Fix:</h2>
<p>Ensure that the RMS services are running on all core RiskLink servers.</p>
<p>On the Head/Compute nodes there is a single service:</p>
<table>
<tr><th>Status</th><th>Name</th><th>DisplayName</th></tr>
<tr><td>Running</td><td>RmsEngines</td><td>RMS Engines Host</td></tr>
</table>
<p>On the SQL host there are four services:</p>
<table>
<tr><th>Status</th><th>Name</th><th>DisplayName</th></tr>
<tr><td>Running</td><td>Rms.EdmToEdmExportService</td><td>Rms.EdmToEdmExportService</td></tr>
<tr><td>Running</td><td>Rms.MRIService</td><td>Rms.MRIService</td></tr>
<tr><td>Running</td><td>Rms.TelemetryService</td><td>Rms.TelemetryService</td></tr>
<tr><td>Running</td><td>RmsEngines</td><td>RMS Engines Host</td></tr>
</table>
<h2>Note on Category</h2>
<p>Please enter one of the following:</p>
<p>Windows O/S Patching</p>
"""

DRAFT_PAGE_HTML = """\
<table>
<tr><td>Status</td><td><ac:structured-macro ac:name="status">\
<ac:parameter ac:name="title">DRAFT</ac:parameter></ac:structured-macro></td></tr>
<tr><td>Application</td><td>Sun</td></tr>
<tr><td>Category</td><td>Windows O/S Patching</td></tr>
</table>
<h2>Trigger:</h2>
<p>Unknown trigger.</p>
"""

WITHDRAWN_PAGE_HTML = """\
<table>
<tr><td>Status</td><td><ac:structured-macro ac:name="status">\
<ac:parameter ac:name="title">WITHDRAWN</ac:parameter></ac:structured-macro></td></tr>
<tr><td>Application</td><td>FCRM</td></tr>
<tr><td>Category</td><td>Windows O/S Patching</td></tr>
</table>
"""

MULTI_STATUS_HTML = """\
<table>
<tr><td>Status</td><td>\
<ac:structured-macro ac:name="status"><ac:parameter ac:name="title">DRAFT</ac:parameter></ac:structured-macro> / \
<ac:structured-macro ac:name="status"><ac:parameter ac:name="title">PUBLISHED</ac:parameter></ac:structured-macro> / \
<ac:structured-macro ac:name="status"><ac:parameter ac:name="title">WITHDRAWN</ac:parameter></ac:structured-macro>\
</td></tr>
<tr><td>Application</td><td>FCRM</td></tr>
<tr><td>Category</td><td>Windows O/S Patching</td></tr>
</table>
"""

SQL_CATEGORY_HTML = """\
<table>
<tr><td>Status</td><td><ac:structured-macro ac:name="status">\
<ac:parameter ac:name="title">PUBLISHED</ac:parameter></ac:structured-macro></td></tr>
<tr><td>Application</td><td>ReportDB</td></tr>
<tr><td>Category</td><td>SQL Server Patching</td></tr>
</table>
<h2>Trigger:</h2>
<p>SQL Server restart after patching.</p>
<h2>Fix:</h2>
<p>Restart the SQL Agent service.</p>
"""


# ── Parser tests ─────────────────────────────────────────────────────────────

class TestConfluencePageParser:
    def test_extracts_properties_table(self):
        parser = ConfluencePageParser()
        parser.feed(RISKLINK_PAGE_HTML)
        parser.close()

        # Should have the properties table + 2 service tables
        assert len(parser.tables) == 3

        # First table is the properties table
        props = parser.tables[0]
        assert ['Status', 'PUBLISHED'] in props
        assert ['Application', 'RiskLink'] in props
        assert ['Category', 'Windows O/S Patching'] in props

    def test_extracts_heading_sections(self):
        parser = ConfluencePageParser()
        parser.feed(RISKLINK_PAGE_HTML)
        parser.close()

        assert 'trigger' in parser.sections
        assert 'signature' in parser.sections
        assert 'fix' in parser.sections
        assert 'note on category' in parser.sections

    def test_trigger_content(self):
        parser = ConfluencePageParser()
        parser.feed(RISKLINK_PAGE_HTML)
        parser.close()

        trigger = parser.sections['trigger']
        assert 'Reboot' in trigger
        assert 'Head Node' in trigger
        assert 'Compute Node' in trigger

    def test_signature_content(self):
        parser = ConfluencePageParser()
        parser.feed(RISKLINK_PAGE_HTML)
        parser.close()

        sig = parser.sections['signature']
        assert 'Jobs stall' in sig
        assert 'New jobs do not start running' in sig

    def test_fix_content_includes_text_before_tables(self):
        parser = ConfluencePageParser()
        parser.feed(RISKLINK_PAGE_HTML)
        parser.close()

        fix = parser.sections['fix']
        assert 'RMS services' in fix

    def test_status_macro_extraction(self):
        parser = ConfluencePageParser()
        parser.feed(DRAFT_PAGE_HTML)
        parser.close()

        props = parser.tables[0]
        status_row = [r for r in props if r[0] == 'Status'][0]
        assert status_row[1] == 'DRAFT'

    def test_multi_status_macro(self):
        """Pages like FCRM have multiple status labels: DRAFT / PUBLISHED / WITHDRAWN."""
        parser = ConfluencePageParser()
        parser.feed(MULTI_STATUS_HTML)
        parser.close()

        props = parser.tables[0]
        status_row = [r for r in props if r[0] == 'Status'][0]
        # Should contain all three status values
        assert 'DRAFT' in status_row[1]
        assert 'PUBLISHED' in status_row[1]
        assert 'WITHDRAWN' in status_row[1]

    def test_heading_colon_stripped(self):
        """Headings like 'Trigger:' should be normalized to 'trigger'."""
        parser = ConfluencePageParser()
        parser.feed(RISKLINK_PAGE_HTML)
        parser.close()

        # Keys should not have colons
        for key in parser.sections:
            assert ':' not in key

    def test_empty_content(self):
        parser = ConfluencePageParser()
        parser.feed("")
        parser.close()

        assert parser.tables == []
        assert parser.sections == {}


# ── Issue parsing tests ──────────────────────────────────────────────────────

def _make_page(html, page_id='123', title='Test Page'):
    return {
        'id': page_id,
        'title': title,
        '_links': {'webui': '/wiki/test'},
        'body': {'storage': {'value': html}}
    }


class TestParseIssuePage:
    def test_risklink_basic_fields(self):
        issue = parse_issue_page(_make_page(
            RISKLINK_PAGE_HTML,
            title='Patching Issue - RiskLink - Windows O/S Patching'
        ))

        assert issue['application'] == 'RiskLink'
        assert issue['category'] == 'Windows O/S Patching'
        assert issue['status'] == 'PUBLISHED'

    def test_risklink_trigger_extracted(self):
        issue = parse_issue_page(_make_page(RISKLINK_PAGE_HTML))
        assert issue['trigger_description'] is not None
        assert 'Reboot' in issue['trigger_description']

    def test_risklink_signature_extracted(self):
        issue = parse_issue_page(_make_page(RISKLINK_PAGE_HTML))
        assert issue['signature'] is not None
        assert 'Jobs stall' in issue['signature']

    def test_risklink_fix_extracted(self):
        issue = parse_issue_page(_make_page(RISKLINK_PAGE_HTML))
        assert issue['fix'] is not None
        assert 'RMS services' in issue['fix']

    def test_risklink_services_extracted(self):
        issue = parse_issue_page(_make_page(RISKLINK_PAGE_HTML))
        services = issue['affected_services']
        assert 'rms.mriservice' in services
        assert 'rms.telemetryservice' in services
        assert 'rms.edmtoedmexportservice' in services
        assert 'rmsengines' in services

    def test_risklink_affected_apps(self):
        issue = parse_issue_page(_make_page(RISKLINK_PAGE_HTML))
        assert issue['affected_apps'] == ['risklink']

    def test_windows_patch_type_flags(self):
        issue = parse_issue_page(_make_page(RISKLINK_PAGE_HTML))
        assert issue['applies_to_windows'] is True
        assert issue['applies_to_sql'] is False
        assert issue['applies_to_other'] is False
        assert 'Windows O/S' in issue['patch_types']

    def test_sql_patch_type_flags(self):
        issue = parse_issue_page(_make_page(SQL_CATEGORY_HTML))
        assert issue['applies_to_sql'] is True
        assert issue['applies_to_windows'] is False
        assert 'SQL Server' in issue['patch_types']

    def test_published_is_active(self):
        issue = parse_issue_page(_make_page(RISKLINK_PAGE_HTML))
        assert issue['is_active'] is True

    def test_draft_is_inactive(self):
        issue = parse_issue_page(_make_page(DRAFT_PAGE_HTML))
        assert issue['is_active'] is False

    def test_withdrawn_is_inactive(self):
        issue = parse_issue_page(_make_page(WITHDRAWN_PAGE_HTML))
        assert issue['is_active'] is False

    def test_severity_high_when_service_in_fix(self):
        issue = parse_issue_page(_make_page(
            RISKLINK_PAGE_HTML,
            title='Patching Issue - RiskLink'
        ))
        assert issue['severity'] == 'HIGH'

    def test_severity_critical_when_outage_in_title(self):
        issue = parse_issue_page(_make_page(
            RISKLINK_PAGE_HTML,
            title='Outage after patching RiskLink'
        ))
        assert issue['severity'] == 'CRITICAL'

    def test_severity_medium_default(self):
        html = """\
        <table>
        <tr><td>Status</td><td>PUBLISHED</td></tr>
        <tr><td>Application</td><td>TestApp</td></tr>
        <tr><td>Category</td><td>Other Patching</td></tr>
        </table>
        <h2>Trigger:</h2>
        <p>Some minor thing happens.</p>
        """
        issue = parse_issue_page(_make_page(html, title='Minor Issue'))
        assert issue['severity'] == 'MEDIUM'

    def test_content_hash_changes_with_content(self):
        issue1 = parse_issue_page(_make_page(RISKLINK_PAGE_HTML, title='Page A'))
        issue2 = parse_issue_page(_make_page(RISKLINK_PAGE_HTML, title='Page B'))
        assert issue1['content_hash'] != issue2['content_hash']

    def test_content_hash_stable_for_same_content(self):
        issue1 = parse_issue_page(_make_page(RISKLINK_PAGE_HTML, title='Same'))
        issue2 = parse_issue_page(_make_page(RISKLINK_PAGE_HTML, title='Same'))
        assert issue1['content_hash'] == issue2['content_hash']

    def test_empty_page(self):
        issue = parse_issue_page(_make_page('', title='Empty'))
        assert issue['title'] == 'Empty'
        assert issue['trigger_description'] is None
        assert issue['fix'] is None
        assert issue['affected_apps'] == []
        assert issue['affected_services'] == []
        assert issue['applies_to_other'] is True

    def test_category_notes_extracted(self):
        issue = parse_issue_page(_make_page(RISKLINK_PAGE_HTML))
        assert issue['category_notes'] is not None
        assert 'Windows O/S Patching' in issue['category_notes']


# ── Service name regex tests ─────────────────────────────────────────────────

class TestServiceNameRegex:
    def test_dotted_service_name(self):
        matches = SERVICE_NAME_RE.findall('Running Rms.MRIService Rms.MRIService')
        dotted = [m[0] for m in matches if m[0]]
        assert 'Rms.MRIService' in dotted

    def test_pascal_case_service(self):
        matches = SERVICE_NAME_RE.findall('Running RmsEngines RMS Engines Host')
        pascal = [m[1] for m in matches if m[1]]
        assert 'RmsEngines' in pascal

    def test_multi_dotted(self):
        matches = SERVICE_NAME_RE.findall('Rms.EdmToEdmExportService')
        dotted = [m[0] for m in matches if m[0]]
        assert any('Rms.EdmToEdmExp' in d for d in dotted)

    def test_telemetry_service(self):
        matches = SERVICE_NAME_RE.findall('Rms.TelemetryService')
        dotted = [m[0] for m in matches if m[0]]
        assert 'Rms.TelemetryService' in dotted

    def test_no_false_positive_on_plain_words(self):
        matches = SERVICE_NAME_RE.findall('Please check the running status of all servers')
        all_matches = [m[0] or m[1] for m in matches]
        assert len(all_matches) == 0

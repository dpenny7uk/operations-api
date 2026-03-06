"""Tests for patching sync and processing scripts."""

import sys
import os
import pytest
from unittest.mock import MagicMock, patch, call
from datetime import datetime

# Add paths for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'patching'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from process_patching_schedule import parse_cycle_date as ivanti_parse_date, normalize_column, process_servers
from sync_patching_schedule import (
    parse_cycle_date as html_parse_date,
    parse_last_updated,
    parse_group_sections,
)


# ── Ivanti: parse_cycle_date ────────────────────────────────────────────────

class TestIvantiParseCycleDate:
    def test_yyyy_mm_dd(self):
        assert ivanti_parse_date("patch-2026-03-15.xlsx") == datetime(2026, 3, 15)

    def test_dd_mm_yyyy(self):
        assert ivanti_parse_date("schedule_15-03-2026.csv") == datetime(2026, 3, 15)

    def test_yyyymmdd(self):
        assert ivanti_parse_date("export20260315.xlsx") == datetime(2026, 3, 15)

    def test_no_date_raises(self):
        with pytest.raises(ValueError, match="Cannot parse date"):
            ivanti_parse_date("report.xlsx")

    def test_date_in_path(self):
        assert ivanti_parse_date("2026-01-10_servers.csv") == datetime(2026, 1, 10)


# ── Ivanti: normalize_column ────────────────────────────────────────────────

class TestNormalizeColumn:
    def test_simple(self):
        assert normalize_column("ServerName") == "servername"

    def test_spaces_to_underscore(self):
        assert normalize_column("Support Team") == "support_team"

    def test_special_chars(self):
        assert normalize_column("Patch-Group!") == "patch_group"

    def test_leading_trailing_underscores(self):
        assert normalize_column("__test__") == "test"


# ── HTML: parse_cycle_date ──────────────────────────────────────────────────

class TestHtmlParseCycleDate:
    def _soup(self, h1_text):
        from bs4 import BeautifulSoup
        return BeautifulSoup(f"<html><body><h1>{h1_text}</h1></body></html>", "html.parser")

    def test_dd_mm_yyyy(self):
        soup = self._soup("Patching Schedule 15/03/2026")
        assert html_parse_date(soup) == datetime(2026, 3, 15)

    def test_yyyy_mm_dd(self):
        soup = self._soup("Schedule 2026-03-15")
        assert html_parse_date(soup) == datetime(2026, 3, 15)

    def test_no_h1_raises(self):
        from bs4 import BeautifulSoup
        soup = BeautifulSoup("<html><body><p>No heading</p></body></html>", "html.parser")
        with pytest.raises(ValueError, match="No <h1>"):
            html_parse_date(soup)

    def test_no_date_raises(self):
        soup = self._soup("Patching Schedule TBD")
        with pytest.raises(ValueError, match="Cannot parse date"):
            html_parse_date(soup)


# ── HTML: parse_last_updated ────────────────────────────────────────────────

class TestParseLastUpdated:
    def test_found(self):
        from bs4 import BeautifulSoup
        soup = BeautifulSoup("<html><body><p>Last updated 2026-03-10</p></body></html>", "html.parser")
        assert parse_last_updated(soup) == "Last updated 2026-03-10"

    def test_not_found(self):
        from bs4 import BeautifulSoup
        soup = BeautifulSoup("<html><body><p>Hello</p></body></html>", "html.parser")
        assert parse_last_updated(soup) is None


# ── HTML: parse_group_sections ──────────────────────────────────────────────

class TestParseGroupSections:
    def _make_html(self, group_name="Shavlik_8a", servers=None):
        if servers is None:
            servers = [("SRV01", "domain.local", "AppA", "ServiceA", "TeamX")]
        rows = ""
        for s in servers:
            rows += f"<tr><td>{s[0]}</td><td>{s[1]}</td><td>{s[2]}</td><td>{s[3]}</td><td>{s[4]}</td></tr>\n"
        html = f"""
        <html><body>
        <h2 id="{group_name}">{group_name}</h2>
        <table>
            <tr><th>Server</th><th>Domain</th><th>App</th><th>Service</th><th>Support Team</th></tr>
            {rows}
        </table>
        </body></html>"""
        from bs4 import BeautifulSoup
        return BeautifulSoup(html, "html.parser")

    def test_basic_parse(self):
        soup = self._make_html()
        result = parse_group_sections(soup)
        assert len(result) == 1
        assert result[0]['server_name'] == 'SRV01'
        assert result[0]['domain'] == 'domain.local'
        assert result[0]['patch_group'] == '8a'

    def test_multiple_servers(self):
        servers = [
            ("SRV01", "d1", "A1", "S1", "T1"),
            ("SRV02", "d2", "A2", "S2", "T2"),
        ]
        soup = self._make_html(servers=servers)
        result = parse_group_sections(soup)
        assert len(result) == 2

    def test_no_shavlik_heading_skipped(self):
        from bs4 import BeautifulSoup
        html = """<html><body>
        <h2>Other Section</h2>
        <table><tr><th>Server</th></tr><tr><td>SRV01</td></tr></table>
        </body></html>"""
        soup = BeautifulSoup(html, "html.parser")
        assert parse_group_sections(soup) == []

    def test_mismatched_columns_skipped(self):
        from bs4 import BeautifulSoup
        html = """<html><body>
        <h2 id="Shavlik_1a">Shavlik_1a</h2>
        <table>
            <tr><th>Server</th><th>Domain</th></tr>
            <tr><td>SRV01</td></tr>
        </table>
        </body></html>"""
        soup = BeautifulSoup(html, "html.parser")
        result = parse_group_sections(soup)
        assert result == []

    def test_value_truncated_to_255(self):
        long_name = "A" * 300
        soup = self._make_html(servers=[(long_name, "d", "a", "s", "t")])
        result = parse_group_sections(soup)
        assert len(result[0]['server_name']) == 255


# ── Ivanti: process_servers (mocked DB) ─────────────────────────────────────

class TestProcessServers:
    def _make_ctx(self):
        ctx = MagicMock()
        from common import SyncStats
        ctx.stats = SyncStats()
        cursor = MagicMock()
        ctx.conn.cursor.return_value.__enter__ = MagicMock(return_value=cursor)
        ctx.conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        return ctx, cursor

    def test_skip_row_without_server_name(self):
        ctx, cursor = self._make_ctx()
        servers = [{"Unknown Column": "value"}]
        process_servers(ctx, 1, servers)
        assert ctx.stats.processed == 0
        # Verify no SQL was executed (no resolve, no INSERT)
        assert cursor.execute.call_count == 0

    def test_server_resolved_and_inserted(self):
        ctx, cursor = self._make_ctx()
        cursor.fetchone.side_effect = [
            {'server_id': 42},     # resolve_server_name
            {'is_insert': True},   # INSERT RETURNING
        ]
        servers = [{"ServerName": "SRV01", "App": "Portal"}]
        process_servers(ctx, 1, servers)
        assert ctx.stats.processed == 1
        assert ctx.stats.inserted == 1
        assert ctx.stats.unmatched == 0

    def test_server_unmatched(self):
        ctx, cursor = self._make_ctx()
        cursor.fetchone.side_effect = [
            None,                  # resolve_server_name -> not found
            {'is_insert': True},   # INSERT RETURNING
        ]
        servers = [{"ServerName": "UNKNOWN01"}]
        process_servers(ctx, 1, servers)
        assert ctx.stats.unmatched == 1
        assert ctx.stats.processed == 1

    def test_nan_values_normalized_to_none(self):
        ctx, cursor = self._make_ctx()
        cursor.fetchone.side_effect = [
            {'server_id': 1},
            {'is_insert': True},
        ]
        servers = [{"ServerName": "SRV01", "App": "nan", "Service": "None"}]
        process_servers(ctx, 1, servers)
        # Find the INSERT call and verify nan/None values became Python None
        insert_calls = [c for c in cursor.execute.call_args_list if c.args and 'INSERT INTO' in str(c.args[0])]
        assert len(insert_calls) == 1
        params = insert_calls[0].args[1]
        # params: (cycle_id, server_name, server_type, server_id, domain, app, service, ...)
        app_val = params[5]   # app
        svc_val = params[6]   # service
        assert app_val is None, f"Expected None for 'nan' but got {app_val!r}"
        assert svc_val is None, f"Expected None for 'None' but got {svc_val!r}"

    def test_upsert_counts_update(self):
        ctx, cursor = self._make_ctx()
        cursor.fetchone.side_effect = [
            {'server_id': 1},
            {'is_insert': False},  # existing row updated
        ]
        servers = [{"ServerName": "SRV01"}]
        process_servers(ctx, 1, servers)
        assert ctx.stats.updated == 1
        assert ctx.stats.inserted == 0

    def test_insert_error_increments_errors(self):
        ctx, cursor = self._make_ctx()

        # Track execute calls to raise on the INSERT (3rd call: resolve, SAVEPOINT, INSERT)
        call_count = [0]

        def execute_side_effect(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 3:  # INSERT INTO patch_schedule
                raise Exception("DB error")

        cursor.execute = MagicMock(side_effect=execute_side_effect)
        # resolve_server_name fetchone (only call before the INSERT raises)
        cursor.fetchone = MagicMock(return_value={'server_id': 1})

        servers = [{"ServerName": "SRV01"}]
        process_servers(ctx, 1, servers)
        assert len(ctx.stats.errors) == 1
        assert "SRV01" in ctx.stats.errors[0]
        # Verify ROLLBACK TO SAVEPOINT was called (4th call)
        rollback_call = cursor.execute.call_args_list[3]
        assert "ROLLBACK TO SAVEPOINT" in str(rollback_call)

    def test_value_truncated_to_255(self):
        ctx, cursor = self._make_ctx()
        cursor.fetchone.side_effect = [
            {'server_id': 1},
            {'is_insert': True},
        ]
        long_app = "X" * 500
        servers = [{"ServerName": "SRV01", "App": long_app}]
        process_servers(ctx, 1, servers)
        # Find the INSERT call and check app param is truncated
        insert_calls = [c for c in cursor.execute.call_args_list if c.args and len(c.args) > 1 and isinstance(c.args[1], tuple) and len(c.args[1]) > 5]
        if insert_calls:
            params = insert_calls[0].args[1]
            # app is at index 5 in the INSERT params
            app_val = params[5]
            assert app_val is None or len(app_val) <= 255

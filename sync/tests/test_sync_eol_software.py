"""Tests for sync_eol_software.py — pattern matching and per-server EOL sync."""

import sys
import os
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common import SyncStats
from eol.sync_eol_software import map_software_to_product, sync_eol_software


# ── map_software_to_product ─────────────────────────────────────────────────

class TestMapSoftwareToProduct:
    def test_sql_server_2012(self):
        assert map_software_to_product('SQL Server 2012 Database Engine Services') == ('mssqlserver', '11.0')

    def test_sql_server_2016(self):
        assert map_software_to_product('SQL Server 2016 Common Files') == ('mssqlserver', '13.0')

    def test_sql_server_2019(self):
        assert map_software_to_product('Microsoft SQL Server 2019 LocalDB') == ('mssqlserver', '15.0')

    def test_sql_server_2022(self):
        assert map_software_to_product('SQL Server 2022 Batch Parser') == ('mssqlserver', '16.0')

    def test_sql_server_case_insensitive(self):
        assert map_software_to_product('sql server 2017 database engine services') == ('mssqlserver', '14.0')

    def test_dotnet_framework_48(self):
        assert map_software_to_product('Microsoft .NET Framework 4.8 SDK') == ('dotnet-framework', '4.8')

    def test_dotnet_framework_47(self):
        assert map_software_to_product('.NET Framework 4.7 Targeting Pack') == ('dotnet-framework', '4.7')

    def test_dotnet_framework_46(self):
        assert map_software_to_product('.NET Framework 4.6.1 Developer Pack') == ('dotnet-framework', '4.6')

    def test_dotnet_framework_35(self):
        assert map_software_to_product('Microsoft .NET Framework 3.5 SP1') == ('dotnet-framework', '3.5')

    def test_iis(self):
        assert map_software_to_product('IIS 10.0 Express') == ('iis', '10.0')

    def test_iis_case_insensitive(self):
        assert map_software_to_product('Microsoft IIS Administration') == ('iis', '10.0')

    def test_unrecognised_returns_none(self):
        assert map_software_to_product('Microsoft Visual Studio 2022') is None

    def test_empty_string_returns_none(self):
        assert map_software_to_product('') is None

    def test_odbc_driver_matches_nothing(self):
        # ODBC drivers are SQL Server related but don't match our patterns
        # because they don't contain "sql server 20XX"
        assert map_software_to_product('Microsoft ODBC Driver 17 for SQL Server') is None

    def test_native_client_matches_sql_2012(self):
        # "Microsoft SQL Server 2012 Native Client" contains "sql server 2012"
        assert map_software_to_product('Microsoft SQL Server 2012 Native Client') == ('mssqlserver', '11.0')

    def test_ssms_matches_nothing(self):
        # "SQL Server Management Studio" doesn't contain a year pattern
        assert map_software_to_product('SQL Server Management Studio') is None

    def test_ssms_with_version_matches(self):
        # "Microsoft SQL Server Management Studio - 18.12.1" doesn't have a year
        assert map_software_to_product('Microsoft SQL Server Management Studio - 18.12.1') is None


# ── sync_eol_software ───────────────────────────────────────────────────────

def _make_record(**overrides):
    base = {
        'machine_name': 'WEB01',
        'ivanti_installed_software': 'SQL Server 2016 Database Engine Services',
        'ivanti_software_version': '13.0.7037.1',
    }
    base.update(overrides)
    return base


def _make_ctx(dry_run=False):
    ctx = MagicMock()
    ctx.dry_run = dry_run
    ctx.stats = SyncStats()
    cursor = MagicMock()
    cursor.fetchall.return_value = [{'is_insert': True}]
    cursor.rowcount = 0
    ctx.conn.cursor.return_value.__enter__ = MagicMock(return_value=cursor)
    ctx.conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    return ctx, cursor


@patch('eol.sync_eol_software.execute_values')
class TestSyncEolSoftware:
    def test_empty_records_logs_warning(self, mock_ev):
        ctx, _ = _make_ctx()
        sync_eol_software(ctx, [])
        ctx.conn.cursor.assert_not_called()

    def test_maps_and_deduplicates(self, mock_ev):
        ctx, cursor = _make_ctx()
        # Two different SQL Server 2016 components on same server → one row
        records = [
            _make_record(ivanti_installed_software='SQL Server 2016 Database Engine Services'),
            _make_record(ivanti_installed_software='SQL Server 2016 Common Files'),
        ]
        sync_eol_software(ctx, records)
        assert ctx.stats.processed == 1  # deduplicated to 1

    def test_different_servers_not_deduplicated(self, mock_ev):
        ctx, cursor = _make_ctx()
        cursor.fetchall.return_value = [{'is_insert': True}, {'is_insert': True}]
        records = [
            _make_record(machine_name='WEB01'),
            _make_record(machine_name='WEB02'),
        ]
        sync_eol_software(ctx, records)
        assert ctx.stats.processed == 2

    def test_unmatched_records_skipped(self, mock_ev):
        ctx, cursor = _make_ctx()
        records = [
            _make_record(ivanti_installed_software='Microsoft Visual Studio 2022'),
            _make_record(),  # valid SQL Server match
        ]
        sync_eol_software(ctx, records)
        assert ctx.stats.processed == 1

    def test_all_unmatched_raises(self, mock_ev):
        ctx, _ = _make_ctx()
        records = [
            _make_record(ivanti_installed_software='Unknown Software'),
        ]
        try:
            sync_eol_software(ctx, records)
            assert False, "Should have raised"
        except RuntimeError as e:
            assert 'No software records matched' in str(e)

    def test_empty_machine_name_skipped(self, mock_ev):
        ctx, cursor = _make_ctx()
        records = [
            _make_record(machine_name=''),
            _make_record(machine_name='WEB01'),
        ]
        sync_eol_software(ctx, records)
        assert ctx.stats.processed == 1

    def test_dry_run_does_not_commit(self, mock_ev):
        ctx, cursor = _make_ctx(dry_run=True)
        records = [_make_record()]
        sync_eol_software(ctx, records)
        ctx.conn.commit.assert_not_called()

    def test_normal_run_commits(self, mock_ev):
        ctx, cursor = _make_ctx(dry_run=False)
        records = [_make_record()]
        sync_eol_software(ctx, records)
        ctx.conn.commit.assert_called_once()

    def test_deactivation_count_recorded(self, mock_ev):
        ctx, cursor = _make_ctx()
        cursor.rowcount = 5
        records = [_make_record()]
        sync_eol_software(ctx, records)
        assert ctx.stats.deactivated == 5

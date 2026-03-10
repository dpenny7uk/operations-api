"""Tests for sync_eol_software.py — record classification and field handling."""

import sys
import os
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common import SyncStats


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_record(**overrides):
    """Create a minimal valid EOL record with optional overrides."""
    base = {
        'eol_product': 'Windows Server',
        'eol_product_version': '2019',
        'eol_end_of_life': '2029-01-09',
        'eol_end_of_extended_support': '2029-01-09',
        'eol_end_of_support': '2024-01-09',
        'asset': 'WEB01',
        'tag': None,
    }
    base.update(overrides)
    return base


def _make_ctx(dry_run=False):
    """Create a mock SyncContext with cursor support."""
    ctx = MagicMock()
    ctx.dry_run = dry_run
    ctx.stats = SyncStats()

    cursor = MagicMock()
    cursor.fetchall.return_value = [{'is_insert': True}, {'is_insert': False}]  # 1 insert, 1 update
    cursor.rowcount = 0  # deactivated count
    ctx.conn.cursor.return_value.__enter__ = MagicMock(return_value=cursor)
    ctx.conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    return ctx, cursor


# ── Import sync function ────────────────────────────────────────────────────

from eol.sync_eol_software import sync_eol_software


# ── Tests ────────────────────────────────────────────────────────────────────

@patch('eol.sync_eol_software.execute_values')
class TestSyncEolSoftware:
    def test_empty_records_logs_warning(self, mock_ev):
        ctx, _ = _make_ctx()
        sync_eol_software(ctx, [])
        ctx.conn.cursor.assert_not_called()
        mock_ev.assert_not_called()

    def test_skips_records_missing_product(self, mock_ev):
        ctx, cursor = _make_ctx()
        records = [_make_record(eol_product=''), _make_record()]
        sync_eol_software(ctx, records)
        assert ctx.stats.processed == 1
        assert ctx.stats.failed == 1

    def test_skips_records_missing_version(self, mock_ev):
        ctx, cursor = _make_ctx()
        records = [_make_record(eol_product_version='')]
        sync_eol_software(ctx, records)
        assert ctx.stats.processed == 0
        assert ctx.stats.failed == 1

    def test_truncates_long_product(self, mock_ev):
        ctx, cursor = _make_ctx()
        long_product = 'A' * 300
        records = [_make_record(eol_product=long_product)]
        sync_eol_software(ctx, records)
        assert ctx.stats.processed == 1
        # Verify the values passed to execute_values have truncated product
        args = mock_ev.call_args[0][2]  # third positional arg = values list
        assert len(args[0][0]) == 255

    def test_null_asset_becomes_none(self, mock_ev):
        ctx, cursor = _make_ctx()
        records = [_make_record(asset='')]
        sync_eol_software(ctx, records)
        assert ctx.stats.processed == 1
        args = mock_ev.call_args[0][2]
        assert args[0][5] is None  # asset field

    def test_counts_inserts_and_updates(self, mock_ev):
        ctx, cursor = _make_ctx()
        records = [_make_record(), _make_record(asset='WEB02')]
        sync_eol_software(ctx, records)
        assert ctx.stats.inserted == 1
        assert ctx.stats.updated == 1

    def test_deactivation_count_recorded(self, mock_ev):
        ctx, cursor = _make_ctx()
        cursor.rowcount = 3
        records = [_make_record()]
        sync_eol_software(ctx, records)
        assert ctx.stats.deactivated == 3

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

    def test_null_dates_preserved(self, mock_ev):
        ctx, cursor = _make_ctx()
        records = [_make_record(eol_end_of_life=None, eol_end_of_support=None)]
        sync_eol_software(ctx, records)
        assert ctx.stats.processed == 1
        args = mock_ev.call_args[0][2]
        assert args[0][2] is None  # eol_end_of_life
        assert args[0][4] is None  # eol_end_of_support

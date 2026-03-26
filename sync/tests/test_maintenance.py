"""Tests for maintenance/run_maintenance.py."""

import sys
import os
from unittest.mock import patch, MagicMock, call

_sync_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _sync_dir)
sys.path.insert(0, os.path.join(_sync_dir, 'maintenance'))

from run_maintenance import run_task, TASKS


class TestRunTask:
    """Tests for the run_task function."""

    def test_dry_run_does_not_execute(self):
        result = run_task('refresh_expiry', dry_run=True)
        assert result == 0

    def test_dry_run_purge_does_not_execute(self):
        result = run_task('purge_sync_history', retain_days=30, dry_run=True)
        assert result == 0

    @patch('run_maintenance.database_connection')
    def test_refresh_expiry_calls_function(self, mock_db_ctx):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = {'refresh_expiry_calculations': 42}
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_db_ctx.return_value.__enter__ = MagicMock(return_value=mock_conn)
        mock_db_ctx.return_value.__exit__ = MagicMock(return_value=False)

        result = run_task('refresh_expiry')

        mock_cursor.execute.assert_called_once_with(
            'SELECT certificates.refresh_expiry_calculations()'
        )
        mock_conn.commit.assert_called_once()
        assert result == 42

    @patch('run_maintenance.database_connection')
    def test_purge_sync_history_passes_retain_days(self, mock_db_ctx):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = {'purge_old_sync_history': 15}
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_db_ctx.return_value.__enter__ = MagicMock(return_value=mock_conn)
        mock_db_ctx.return_value.__exit__ = MagicMock(return_value=False)

        result = run_task('purge_sync_history', retain_days=60)

        mock_cursor.execute.assert_called_once_with(
            'SELECT system.purge_old_sync_history(%s)', (60,)
        )
        mock_conn.commit.assert_called_once()
        assert result == 15

    @patch('run_maintenance.database_connection')
    def test_purge_default_retain_days_is_90(self, mock_db_ctx):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = {'purge_old_sync_history': 0}
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_db_ctx.return_value.__enter__ = MagicMock(return_value=mock_conn)
        mock_db_ctx.return_value.__exit__ = MagicMock(return_value=False)

        run_task('purge_sync_history')

        mock_cursor.execute.assert_called_once_with(
            'SELECT system.purge_old_sync_history(%s)', (90,)
        )

    @patch('run_maintenance.database_connection')
    def test_null_result_returns_zero(self, mock_db_ctx):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = None
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_db_ctx.return_value.__enter__ = MagicMock(return_value=mock_conn)
        mock_db_ctx.return_value.__exit__ = MagicMock(return_value=False)

        result = run_task('refresh_expiry')
        assert result == 0


class TestTaskDefinitions:
    """Verify TASKS dictionary is well-formed."""

    def test_all_tasks_have_required_keys(self):
        for name, task in TASKS.items():
            assert 'sql' in task, f"Task {name} missing 'sql'"
            assert 'description' in task, f"Task {name} missing 'description'"

    def test_refresh_expiry_sql(self):
        assert 'refresh_expiry_calculations' in TASKS['refresh_expiry']['sql']

    def test_purge_sql(self):
        assert 'purge_old_sync_history' in TASKS['purge_sync_history']['sql']

"""Tests for common.py sync utilities."""

import sys
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common import (
    SyncStats, validate_env_vars, get_current_user,
    create_argument_parser, configure_verbosity, http_request,
    SyncContext, CircuitBreakerOpenError,
)


# ── SyncStats ────────────────────────────────────────────────────────────────

class TestSyncStats:
    def test_default_values(self):
        stats = SyncStats()
        assert stats.processed == 0
        assert stats.inserted == 0
        assert stats.updated == 0
        assert stats.failed == 0
        assert stats.deactivated == 0
        assert stats.unmatched == 0
        assert stats.errors == []

    def test_add_error_increments_failed(self):
        stats = SyncStats()
        stats.add_error("something broke")
        assert stats.failed == 1
        assert "something broke" in stats.errors

    def test_add_error_multiple(self):
        stats = SyncStats()
        stats.add_error("err1")
        stats.add_error("err2")
        assert stats.failed == 2
        assert len(stats.errors) == 2

    def test_to_dict_shape(self):
        stats = SyncStats()
        stats.processed = 10
        stats.inserted = 5
        d = stats.to_dict()
        assert d == {
            'processed': 10,
            'inserted': 5,
            'updated': 0,
            'failed': 0,
            'deactivated': 0,
            'unmatched': 0,
        }

    def test_errors_not_shared_between_instances(self):
        a = SyncStats()
        b = SyncStats()
        a.add_error("only in a")
        assert b.errors == []


# ── validate_env_vars ────────────────────────────────────────────────────────

class TestValidateEnvVars:
    def test_raises_on_missing(self):
        with patch.dict(os.environ, {}, clear=True):
            try:
                validate_env_vars(['MISSING_VAR'])
                assert False, "Should have raised"
            except EnvironmentError as e:
                assert 'MISSING_VAR' in str(e)

    def test_passes_when_set(self):
        with patch.dict(os.environ, {'MY_VAR': 'value'}):
            validate_env_vars(['MY_VAR'])  # should not raise

    def test_empty_string_counts_as_missing(self):
        with patch.dict(os.environ, {'MY_VAR': ''}, clear=True):
            try:
                validate_env_vars(['MY_VAR'])
                assert False, "Should have raised"
            except EnvironmentError:
                pass

    def test_multiple_missing(self):
        with patch.dict(os.environ, {}, clear=True):
            try:
                validate_env_vars(['A', 'B', 'C'])
                assert False, "Should have raised"
            except EnvironmentError as e:
                assert 'A' in str(e)
                assert 'B' in str(e)
                assert 'C' in str(e)


# ── get_current_user ─────────────────────────────────────────────────────────

class TestGetCurrentUser:
    def test_build_requestedfor_takes_priority(self):
        with patch.dict(os.environ, {
            'BUILD_REQUESTEDFOR': 'azure-user',
            'USERNAME': 'local-user',
        }):
            assert get_current_user() == 'azure-user'

    def test_falls_back_to_username(self):
        with patch.dict(os.environ, {'USERNAME': 'local-user'}, clear=True):
            assert get_current_user() == 'local-user'

    def test_falls_back_to_user(self):
        with patch.dict(os.environ, {'USER': 'unix-user'}, clear=True):
            assert get_current_user() == 'unix-user'

    def test_falls_back_to_unknown(self):
        with patch.dict(os.environ, {}, clear=True):
            assert get_current_user() == 'unknown'


# ── create_argument_parser ───────────────────────────────────────────────────

class TestCreateArgumentParser:
    def test_dry_run_flag(self):
        parser = create_argument_parser("test")
        args = parser.parse_args(['--dry-run'])
        assert args.dry_run is True

    def test_verbose_flag(self):
        parser = create_argument_parser("test")
        args = parser.parse_args(['--verbose'])
        assert args.verbose is True

    def test_defaults(self):
        parser = create_argument_parser("test")
        args = parser.parse_args([])
        assert args.dry_run is False
        assert args.verbose is False

    def test_short_verbose_flag(self):
        parser = create_argument_parser("test")
        args = parser.parse_args(['-v'])
        assert args.verbose is True


# ── http_request ─────────────────────────────────────────────────────────────

class TestHttpRequest:
    def test_200_returns_immediately(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        with patch('common.requests.request', return_value=mock_resp) as mock_req:
            result = http_request('GET', 'http://example.com')
            assert result == mock_resp
            assert mock_req.call_count == 1

    def test_500_retries_then_succeeds(self):
        fail_resp = MagicMock()
        fail_resp.status_code = 500
        fail_resp.reason = 'Internal Server Error'

        ok_resp = MagicMock()
        ok_resp.status_code = 200

        with patch('common.requests.request', side_effect=[fail_resp, ok_resp]):
            with patch('common.time.sleep'):  # skip actual sleep
                result = http_request('GET', 'http://example.com', retries=3, backoff=0.01)
                assert result == ok_resp

    def test_500_exhausts_retries(self):
        fail_resp = MagicMock()
        fail_resp.status_code = 500
        fail_resp.reason = 'Internal Server Error'

        with patch('common.requests.request', return_value=fail_resp):
            with patch('common.time.sleep'):
                import requests
                try:
                    http_request('GET', 'http://example.com', retries=3, backoff=0.01)
                    assert False, "Should have raised"
                except requests.HTTPError:
                    pass

    def test_404_raises_immediately_no_retry(self):
        fail_resp = MagicMock()
        fail_resp.status_code = 404
        fail_resp.raise_for_status.side_effect = Exception("Not Found")

        with patch('common.requests.request', return_value=fail_resp) as mock_req:
            try:
                http_request('GET', 'http://example.com', retries=3)
                assert False, "Should have raised"
            except Exception:
                pass
            assert mock_req.call_count == 1

    def test_connection_error_retries(self):
        import requests as req

        ok_resp = MagicMock()
        ok_resp.status_code = 200

        with patch('common.requests.request',
                   side_effect=[req.ConnectionError("refused"), ok_resp]):
            with patch('common.time.sleep'):
                result = http_request('GET', 'http://example.com', retries=3, backoff=0.01)
                assert result == ok_resp


# ── SyncContext.check_circuit_breaker ────────────────────────────────────────

class TestCircuitBreaker:
    """Tests for SyncContext.check_circuit_breaker() and __exit__ suppression."""

    def _make_ctx(self, dry_run=False):
        """Build a SyncContext without invoking __enter__ (no real DB connection)."""
        ctx = SyncContext.__new__(SyncContext)
        ctx.sync_name = 'test_sync'
        ctx.display_name = 'Test Sync'
        ctx.dry_run = dry_run
        ctx.conn = MagicMock()
        ctx.history_id = None
        ctx.stats = SyncStats()
        ctx.logger = MagicMock()
        ctx._error_message = None
        return ctx

    def _set_db_row(self, ctx, row):
        """Wire ctx.conn so that `with ctx.conn.cursor() as cur` yields a mock
        whose fetchone() returns row."""
        ctx.conn.cursor.return_value.__enter__.return_value.fetchone.return_value = row
        ctx.conn.cursor.return_value.__exit__.return_value = False

    # ── open / closed behaviour ──────────────────────────────────────────────

    def test_circuit_open_raises(self):
        """Breaker opens when failures >= threshold AND within timeout window."""
        ctx = self._make_ctx()
        last_failure = datetime.now(timezone.utc) - timedelta(minutes=30)
        self._set_db_row(ctx, {'consecutive_failures': 3, 'last_failure_at': last_failure})

        try:
            ctx.check_circuit_breaker()
            assert False, "Should have raised CircuitBreakerOpenError"
        except CircuitBreakerOpenError as e:
            assert e.sync_name == 'test_sync'
            assert e.consecutive_failures == 3

    def test_circuit_closed_below_threshold(self):
        """Breaker stays closed when failures < threshold."""
        ctx = self._make_ctx()
        last_failure = datetime.now(timezone.utc) - timedelta(minutes=30)
        self._set_db_row(ctx, {'consecutive_failures': 2, 'last_failure_at': last_failure})

        ctx.check_circuit_breaker()  # should not raise

    def test_circuit_closed_timeout_elapsed(self):
        """Breaker resets after the timeout window has elapsed."""
        ctx = self._make_ctx()
        last_failure = datetime.now(timezone.utc) - timedelta(hours=3)
        self._set_db_row(ctx, {'consecutive_failures': 5, 'last_failure_at': last_failure})

        ctx.check_circuit_breaker()  # should not raise

    def test_circuit_no_row_fails_open(self):
        """First run (no sync_status row yet) proceeds normally — fail-open."""
        ctx = self._make_ctx()
        self._set_db_row(ctx, None)

        ctx.check_circuit_breaker()  # should not raise

    def test_circuit_db_error_fails_open(self):
        """DB error during the check proceeds normally — fail-open with a warning."""
        ctx = self._make_ctx()
        ctx.conn.cursor.side_effect = Exception("connection lost")

        ctx.check_circuit_breaker()  # should not raise
        ctx.logger.warning.assert_called_once()

    # ── env-var overrides ────────────────────────────────────────────────────

    def test_threshold_from_env(self):
        """CIRCUIT_BREAKER_THRESHOLD env var overrides the default of 3."""
        ctx = self._make_ctx()
        last_failure = datetime.now(timezone.utc) - timedelta(minutes=30)
        self._set_db_row(ctx, {'consecutive_failures': 4, 'last_failure_at': last_failure})

        with patch.dict(os.environ, {'CIRCUIT_BREAKER_THRESHOLD': '5'}):
            ctx.check_circuit_breaker()  # 4 < 5 — should not raise

    def test_timeout_from_env(self):
        """CIRCUIT_BREAKER_TIMEOUT_SECONDS env var overrides the default 7200s."""
        ctx = self._make_ctx()
        # 90 minutes ago — outside the 1h custom timeout → breaker should open
        last_failure = datetime.now(timezone.utc) - timedelta(minutes=90)
        self._set_db_row(ctx, {'consecutive_failures': 3, 'last_failure_at': last_failure})

        with patch.dict(os.environ, {'CIRCUIT_BREAKER_TIMEOUT_SECONDS': '7200'}):
            # Default 2h window: 90m is inside — should raise
            try:
                ctx.check_circuit_breaker()
                assert False, "Should have raised CircuitBreakerOpenError"
            except CircuitBreakerOpenError:
                pass

        ctx2 = self._make_ctx()
        last_failure2 = datetime.now(timezone.utc) - timedelta(minutes=90)
        self._set_db_row(ctx2, {'consecutive_failures': 3, 'last_failure_at': last_failure2})

        with patch.dict(os.environ, {'CIRCUIT_BREAKER_TIMEOUT_SECONDS': '3600'}):
            # 1h window: 90m is outside — should not raise
            ctx2.check_circuit_breaker()

    def test_dry_run_skips_check(self):
        """In dry-run mode the circuit breaker check is skipped entirely."""
        ctx = self._make_ctx(dry_run=True)
        # If the check ran it would hit cursor() and raise — proves it is skipped
        ctx.conn.cursor.side_effect = Exception("should not be called")

        ctx.check_circuit_breaker()  # should not raise

    # ── __exit__ suppression ─────────────────────────────────────────────────

    def test_exit_suppresses_error(self):
        """__exit__ returns True for CircuitBreakerOpenError (process exits 0)."""
        ctx = self._make_ctx()
        ctx.history_id = None  # no history row — skip the DB update path
        last_failure = datetime.now(timezone.utc) - timedelta(minutes=30)
        retry_after = last_failure + timedelta(hours=2)
        err = CircuitBreakerOpenError('test_sync', 3, last_failure, retry_after)

        result = ctx.__exit__(CircuitBreakerOpenError, err, None)

        assert result is True

    def test_exit_records_cancelled(self):
        """__exit__ UPDATEs sync_history to 'cancelled' when history_id is set."""
        ctx = self._make_ctx()
        ctx.history_id = 42
        last_failure = datetime.now(timezone.utc) - timedelta(minutes=30)
        retry_after = last_failure + timedelta(hours=2)
        err = CircuitBreakerOpenError('test_sync', 3, last_failure, retry_after)

        mock_cur = MagicMock()
        ctx.conn.cursor.return_value.__enter__.return_value = mock_cur
        ctx.conn.cursor.return_value.__exit__.return_value = False

        result = ctx.__exit__(CircuitBreakerOpenError, err, None)

        assert result is True
        mock_cur.execute.assert_called_once()
        sql, params = mock_cur.execute.call_args[0]
        assert 'cancelled' in sql
        assert params[1] == 42  # history_id is the second bind parameter
        ctx.conn.commit.assert_called_once()

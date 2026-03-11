"""Tests for common.py sync utilities."""

import sys
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common import (
    SyncStats, validate_env_vars, get_current_user,
    create_argument_parser, configure_verbosity, http_request,
    SyncContext, CircuitBreakerOpenError, ALLOWED_QUERY_OVERRIDES,
    query_databricks,
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

# ── query_databricks env_var_override whitelist ─────────────────────────────

class TestQueryDatabricksOverrideWhitelist:
    def test_invalid_override_raises(self):
        """env_var_override not in ALLOWED_QUERY_OVERRIDES raises ValueError."""
        env = {
            'DATABRICKS_HOST': 'host',
            'DATABRICKS_TOKEN': 'tok',
            'DATABRICKS_WAREHOUSE_ID': 'wh',
        }
        with patch.dict(os.environ, env, clear=True):
            try:
                query_databricks("SELECT 1", env_var_override='PATH')
                assert False, "Should have raised ValueError"
            except ValueError as e:
                assert 'PATH' in str(e)
                assert 'ALLOWED' not in str(e) or 'must be one of' in str(e)

    def test_valid_override_accepted(self):
        """env_var_override in ALLOWED_QUERY_OVERRIDES proceeds (mocked HTTP)."""
        env = {
            'DATABRICKS_HOST': 'host',
            'DATABRICKS_TOKEN': 'tok',
            'DATABRICKS_WAREHOUSE_ID': 'wh',
            'DATABRICKS_QUERY': 'SELECT 2',
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            'status': {'state': 'SUCCEEDED'},
            'manifest': {'schema': {'columns': [{'name': 'id'}]}},
            'result': {'data_array': [['1']]},
        }
        with patch.dict(os.environ, env, clear=True):
            with patch('common.http_request', return_value=mock_resp):
                rows = query_databricks("SELECT 1", env_var_override='DATABRICKS_QUERY')
                assert len(rows) == 1


# ── query_databricks column validation ──────────────────────────────────────

class TestQueryDatabricksColumnValidation:
    """Validates that Databricks response columns have a 'name' key."""

    def _mock_databricks_env(self):
        return {
            'DATABRICKS_HOST': 'host',
            'DATABRICKS_TOKEN': 'tok',
            'DATABRICKS_WAREHOUSE_ID': 'wh',
        }

    def _mock_response(self, columns):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            'status': {'state': 'SUCCEEDED'},
            'manifest': {'schema': {'columns': columns}},
            'result': {'data_array': []},
        }
        return mock_resp

    def test_column_missing_name_raises(self):
        with patch.dict(os.environ, self._mock_databricks_env(), clear=True):
            with patch('common.http_request', return_value=self._mock_response([{'type': 'INT'}])):
                try:
                    query_databricks("SELECT 1")
                    assert False, "Should have raised RuntimeError"
                except RuntimeError as e:
                    assert 'index 0' in str(e)
                    assert "'name'" in str(e)

    def test_column_not_a_dict_raises(self):
        with patch.dict(os.environ, self._mock_databricks_env(), clear=True):
            with patch('common.http_request', return_value=self._mock_response(["just_a_string"])):
                try:
                    query_databricks("SELECT 1")
                    assert False, "Should have raised RuntimeError"
                except RuntimeError as e:
                    assert 'index 0' in str(e)


class TestCircuitBreakerContinued:
    """Continuation of circuit breaker tests (split by inserted test class above)."""

    def _make_ctx(self, dry_run=False):
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


# ── __exit__ sync_status recovery fallback (P0-3) ──────────────────────────

class TestExitSyncStatusRecovery:
    """Tests for the 3-level fallback when _complete_sync() fails in __exit__."""

    def _make_ctx(self):
        ctx = SyncContext.__new__(SyncContext)
        ctx.sync_name = 'test_sync'
        ctx.display_name = 'Test Sync'
        ctx.dry_run = False
        ctx.conn = MagicMock()
        ctx.history_id = 99
        ctx.stats = SyncStats()
        ctx.logger = MagicMock()
        ctx._error_message = None
        ctx.app_name = 'test_app'
        return ctx

    def test_complete_sync_fails_fallback_succeeds(self):
        """_complete_sync fails → rollback + direct UPDATE succeeds."""
        ctx = self._make_ctx()
        ctx._complete_sync = MagicMock(side_effect=Exception("tracking broke"))

        mock_cur = MagicMock()
        ctx.conn.cursor.return_value.__enter__.return_value = mock_cur
        ctx.conn.cursor.return_value.__exit__.return_value = False

        ctx.__exit__(RuntimeError, RuntimeError("sync failed"), None)

        # Rollback was called, then fallback UPDATE executed
        ctx.conn.rollback.assert_called()
        mock_cur.execute.assert_called_once()
        sql = mock_cur.execute.call_args[0][0]
        assert "status = 'error'" in sql
        ctx.conn.commit.assert_called()

    def test_complete_sync_and_fallback_fail_recovery_succeeds(self):
        """_complete_sync fails → fallback fails → fresh recovery connection succeeds."""
        ctx = self._make_ctx()
        ctx._complete_sync = MagicMock(side_effect=Exception("tracking broke"))

        # First rollback succeeds, but the fallback cursor.execute fails
        call_count = [0]
        def cursor_side_effect():
            call_count[0] += 1
            if call_count[0] <= 1:
                # First cursor call (fallback UPDATE) — commit raises
                mock_cm = MagicMock()
                mock_cm.__enter__ = MagicMock(return_value=MagicMock())
                mock_cm.__exit__ = MagicMock(return_value=False)
                return mock_cm
            raise Exception("connection dead")

        ctx.conn.cursor.side_effect = cursor_side_effect
        ctx.conn.commit.side_effect = Exception("commit failed")

        # Mock recovery connection
        recovery_cur = MagicMock()
        recovery_conn = MagicMock()
        recovery_conn.cursor.return_value.__enter__.return_value = recovery_cur
        recovery_conn.cursor.return_value.__exit__.return_value = False
        recovery_conn.__enter__ = MagicMock(return_value=recovery_conn)
        recovery_conn.__exit__ = MagicMock(return_value=False)

        with patch('common.get_database_connection', return_value=recovery_conn):
            ctx.__exit__(RuntimeError, RuntimeError("sync failed"), None)

        recovery_cur.execute.assert_called_once()
        sql = recovery_cur.execute.call_args[0][0]
        assert "status = 'error'" in sql
        recovery_conn.commit.assert_called_once()

    def test_all_three_levels_fail_logs_critical(self):
        """All 3 fallback levels fail → CRITICAL logged with manual intervention msg."""
        ctx = self._make_ctx()
        ctx._complete_sync = MagicMock(side_effect=Exception("tracking broke"))

        # Fallback UPDATE also fails
        mock_cur = MagicMock()
        mock_cur.execute.side_effect = Exception("fallback failed")
        ctx.conn.cursor.return_value.__enter__.return_value = mock_cur
        ctx.conn.cursor.return_value.__exit__.return_value = False

        # Recovery connection also fails
        with patch('common.get_database_connection', side_effect=Exception("no recovery")):
            ctx.__exit__(RuntimeError, RuntimeError("sync failed"), None)

        ctx.logger.critical.assert_called_once()
        critical_msg = ctx.logger.critical.call_args[0][0]
        assert 'MANUAL INTERVENTION REQUIRED' in critical_msg

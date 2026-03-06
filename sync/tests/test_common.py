"""Tests for common.py sync utilities."""

import sys
import os
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common import (
    SyncStats, validate_env_vars, get_current_user,
    create_argument_parser, configure_verbosity, http_request
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

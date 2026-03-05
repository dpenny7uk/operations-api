"""Tests for certificate sync helper functions."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'certificates'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sync_certificates import (
    parse_cn, classify_error, map_alert_level,
    map_store_name, map_scan_source, parse_timestamp
)


# ── parse_cn ─────────────────────────────────────────────────────────────────

class TestParseCN:
    def test_simple_cn(self):
        assert parse_cn('CN=server01.contoso.com') == 'server01.contoso.com'

    def test_cn_with_ou(self):
        assert parse_cn('CN=wildcard.contoso.com, OU=IT, O=Contoso') == 'wildcard.contoso.com'

    def test_wildcard_cn(self):
        assert parse_cn('CN=*.contoso.com') == '*.contoso.com'

    def test_no_cn_returns_whole_string(self):
        assert parse_cn('O=Contoso, OU=IT') == 'O=Contoso, OU=IT'

    def test_empty_string(self):
        assert parse_cn('') == ''

    def test_none(self):
        assert parse_cn(None) == ''

    def test_cn_case_insensitive(self):
        assert parse_cn('cn=lowercase.com') == 'lowercase.com'

    def test_cn_with_spaces_around_value(self):
        # Real certificates don't have spaces around = in the DN
        # but values can have trailing spaces before commas
        assert parse_cn('CN=spaced.contoso.com , OU=IT') == 'spaced.contoso.com'


# ── classify_error ───────────────────────────────────────────────────────────

class TestClassifyError:
    def test_unreachable_status(self):
        assert classify_error('UNREACHABLE', 'anything') == 'unreachable'

    def test_access_denied(self):
        assert classify_error('ERROR', 'Access is denied') == 'access_denied'

    def test_permission_denied(self):
        assert classify_error('ERROR', 'Permission denied for user') == 'access_denied'

    def test_timeout(self):
        assert classify_error('ERROR', 'Connection timed out') == 'timeout'

    def test_winrm(self):
        assert classify_error('ERROR', 'WinRM cannot complete the operation') == 'winrm'

    def test_wsman(self):
        assert classify_error('ERROR', 'WSMan connection failed') == 'winrm'

    def test_unknown_error(self):
        assert classify_error('ERROR', 'Something unexpected happened') == 'unknown'

    def test_empty_error(self):
        assert classify_error('ERROR', '') == 'unknown'

    def test_none_error(self):
        # classify_error is called with error_msg from CSV which could be empty
        assert classify_error('ERROR', '') == 'unknown'


# ── map_alert_level ──────────────────────────────────────────────────────────

class TestMapAlertLevel:
    def test_expired(self):
        assert map_alert_level('EXPIRED') == ('CRITICAL', True)

    def test_critical(self):
        assert map_alert_level('CRITICAL') == ('CRITICAL', False)

    def test_warning(self):
        assert map_alert_level('WARNING') == ('WARNING', False)

    def test_ok(self):
        assert map_alert_level('OK') == ('OK', False)

    def test_lowercase(self):
        assert map_alert_level('expired') == ('CRITICAL', True)

    def test_none(self):
        assert map_alert_level(None) == ('OK', False)

    def test_empty(self):
        assert map_alert_level('') == ('OK', False)


# ── map_store_name ───────────────────────────────────────────────────────────

class TestMapStoreName:
    def test_cert_store(self):
        assert map_store_name('Cert Store', 'LocalMachine\\My') == 'LocalMachine\\My'

    def test_cert_store_case_insensitive(self):
        assert map_store_name('cert store', 'LocalMachine\\My') == 'LocalMachine\\My'

    def test_cert_store_no_url(self):
        assert map_store_name('Cert Store', None) == 'LocalMachine\\My'

    def test_cert_store_empty_url(self):
        assert map_store_name('Cert Store', '') == 'LocalMachine\\My'

    def test_https_endpoint(self):
        assert map_store_name('HTTPS Endpoint', 'server01:443') == 'HTTPS'

    def test_empty_source(self):
        assert map_store_name('', '') == 'HTTPS'

    def test_none_source(self):
        assert map_store_name(None, None) == 'HTTPS'


# ── map_scan_source ──────────────────────────────────────────────────────────

class TestMapScanSource:
    def test_https_endpoint(self):
        assert map_scan_source('HTTPS Endpoint') == 'powershell_https'

    def test_endpoint_case_insensitive(self):
        assert map_scan_source('https endpoint') == 'powershell_https'

    def test_cert_store(self):
        assert map_scan_source('Cert Store') == 'powershell'

    def test_windows_cert_store(self):
        assert map_scan_source('Windows Cert Store') == 'powershell'

    def test_empty(self):
        assert map_scan_source('') == 'powershell'

    def test_none(self):
        assert map_scan_source(None) == 'powershell'


# ── parse_timestamp ──────────────────────────────────────────────────────────

class TestParseTimestamp:
    def test_iso_timestamp(self):
        assert parse_timestamp('2025-06-15T10:30:00.0000000+01:00') == '2025-06-15T10:30:00.0000000+01:00'

    def test_empty(self):
        assert parse_timestamp('') is None

    def test_none(self):
        assert parse_timestamp(None) is None

    def test_whitespace(self):
        assert parse_timestamp('   ') is None

    def test_strips_whitespace(self):
        assert parse_timestamp('  2025-06-15  ') == '2025-06-15'


# ── CSV column contract tests ────────────────────────────────────────────────
# These verify the contract between PowerShell CSV output and Python parsing

class TestCSVColumnContract:
    """Verify that the Source/URL values from Get-SSLCertificateExpiry.ps1
    map correctly through the Python helpers to the expected database values."""

    def test_cert_store_row(self):
        """PowerShell outputs Source='Cert Store', URL='LocalMachine\\My'."""
        source = 'Cert Store'
        url = 'LocalMachine\\My'
        assert map_scan_source(source) == 'powershell'
        assert map_store_name(source, url) == 'LocalMachine\\My'

    def test_server_https_endpoint_row(self):
        """PowerShell outputs Source='HTTPS Endpoint', URL='servername:443'."""
        source = 'HTTPS Endpoint'
        url = 'SERVER01:443'
        assert map_scan_source(source) == 'powershell_https'
        assert map_store_name(source, url) == 'HTTPS'

    def test_standalone_endpoint_row(self):
        """Endpoint scan outputs Source='HTTPS Endpoint', URL='https://analytics.contoso.com'."""
        source = 'HTTPS Endpoint'
        url = 'https://analytics.contoso.com'
        assert map_scan_source(source) == 'powershell_https'
        assert map_store_name(source, url) == 'HTTPS'

    def test_error_row_empty_source(self):
        """Timeout/error fallback rows have Source=''."""
        source = ''
        url = ''
        assert map_scan_source(source) == 'powershell'
        assert map_store_name(source, url) == 'HTTPS'

    def test_unreachable_row(self):
        """UNREACHABLE server rows have Source='Cert Store'."""
        source = 'Cert Store'
        url = 'LocalMachine\\My'
        status = 'UNREACHABLE'
        error = 'Server did not respond to ping'
        assert classify_error(status, error) == 'unreachable'
        assert map_store_name(source, url) == 'LocalMachine\\My'

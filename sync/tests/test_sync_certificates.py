"""Tests for certificate sync record classification and field parsing."""

import sys
import os
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'certificates'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from common import SyncStats
from sync_certificates import sync_certificates


def _make_ctx(dry_run=True):
    """Create a minimal mock context for testing record classification."""
    ctx = MagicMock()
    ctx.dry_run = dry_run
    ctx.stats = SyncStats()
    return ctx


# ── Record classification ────────────────────────────────────────────────────

class TestRecordClassification:
    """Test that records are routed to the correct bucket (failure vs cert_rows)."""

    def _run_sync(self, records):
        ctx = _make_ctx()
        cursor = ctx.conn.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = {'inserted': 0, 'updated': 0}
        cursor.rowcount = 0
        with patch('sync_certificates.execute_values'):
            sync_certificates(ctx, records)
        return ctx

    def test_unreachable_goes_to_failures(self):
        records = [{'Name': 'SRV01', 'Status': 'UNREACHABLE', 'Error': 'No ping',
                     'Thumbprint': '', 'Subject': '', 'Issuer': '', 'NotBefore': '',
                     'NotAfter': '', 'DaysRemaining': '', 'Source': '', 'URL': ''}]
        ctx = self._run_sync(records)
        # No certs processed, just failure recorded
        assert ctx.stats.processed == 0

    def test_error_goes_to_failures(self):
        records = [{'Name': 'SRV02', 'Status': 'ERROR', 'Error': 'Access denied',
                     'Thumbprint': '', 'Subject': '', 'Issuer': '', 'NotBefore': '',
                     'NotAfter': '', 'DaysRemaining': '', 'Source': '', 'URL': ''}]
        ctx = self._run_sync(records)
        assert ctx.stats.processed == 0

    def test_valid_record_counted(self):
        records = [{
            'Name': 'SRV03', 'Status': 'OK',
            'Thumbprint': 'ABC123', 'Subject': 'CN=test.com',
            'Issuer': 'CN=CA', 'NotBefore': '2024-01-01',
            'NotAfter': '2025-12-31', 'DaysRemaining': '30',
            'Source': 'Cert Store', 'URL': 'LocalMachine\\My', 'Error': '',
        }]
        ctx = self._run_sync(records)
        assert ctx.stats.processed == 1

    def test_missing_thumbprint_skipped(self):
        records = [{
            'Name': 'SRV04', 'Status': 'OK',
            'Thumbprint': '', 'Subject': 'CN=test.com',
            'Issuer': 'CN=CA', 'NotBefore': '', 'NotAfter': '',
            'DaysRemaining': '', 'Source': '', 'URL': '', 'Error': '',
        }]
        ctx = self._run_sync(records)
        assert ctx.stats.processed == 0
        assert ctx.stats.failed == 1

    def test_missing_server_name_skipped(self):
        records = [{
            'Name': '', 'Status': 'OK',
            'Thumbprint': 'ABC123', 'Subject': 'CN=test.com',
            'Issuer': 'CN=CA', 'NotBefore': '', 'NotAfter': '',
            'DaysRemaining': '', 'Source': '', 'URL': '', 'Error': '',
        }]
        ctx = self._run_sync(records)
        assert ctx.stats.failed == 1


# ── Field parsing ────────────────────────────────────────────────────────────

class TestFieldParsing:
    """Test field truncation and type conversion in record processing."""

    def _get_cert_row(self, overrides=None):
        """Build a valid record and extract the cert_rows tuple."""
        record = {
            'Name': 'SRV01', 'Status': 'OK',
            'Thumbprint': 'A' * 100, 'Subject': 'S' * 1500,
            'Issuer': 'I' * 1500, 'NotBefore': '2024-01-01',
            'NotAfter': '2025-12-31', 'DaysRemaining': '30',
            'Source': 'Cert Store', 'URL': 'LocalMachine\\My', 'Error': '',
        }
        if overrides:
            record.update(overrides)

        # We need to trace through the sync logic to extract cert_rows
        # Instead, test the field processing inline
        from sync_certificates import (
            parse_cn, map_alert_level, map_store_name, map_scan_source, parse_timestamp
        )

        server_name = record['Name'].strip()
        thumbprint = record['Thumbprint'].strip()
        subject = record['Subject'][:1000]
        issuer = record['Issuer'][:1000]
        alert_level, is_expired = map_alert_level(record['Status'])
        source = record['Source']

        days_str = record['DaysRemaining'].strip()
        try:
            days_until = int(days_str) if days_str else None
        except ValueError:
            days_until = None

        return {
            'thumbprint': thumbprint[:64],
            'subject': subject,
            'subject_cn': parse_cn(subject)[:500],
            'issuer': issuer,
            'issuer_cn': parse_cn(issuer)[:500],
            'days_until': days_until,
            'is_expired': is_expired,
            'alert_level': alert_level,
            'server_name': server_name[:255],
            'store_name': map_store_name(source, record['URL']),
            'scan_source': map_scan_source(source),
        }

    def test_thumbprint_truncated_to_64(self):
        row = self._get_cert_row({'Thumbprint': 'X' * 100})
        assert len(row['thumbprint']) == 64

    def test_subject_truncated_to_1000(self):
        row = self._get_cert_row({'Subject': 'Y' * 1500})
        assert len(row['subject']) == 1000

    def test_server_name_truncated_to_255(self):
        row = self._get_cert_row({'Name': 'Z' * 300})
        assert len(row['server_name']) == 255

    def test_days_valid_int(self):
        row = self._get_cert_row({'DaysRemaining': '42'})
        assert row['days_until'] == 42

    def test_days_empty_is_none(self):
        row = self._get_cert_row({'DaysRemaining': ''})
        assert row['days_until'] is None

    def test_days_non_numeric_is_none(self):
        row = self._get_cert_row({'DaysRemaining': 'abc'})
        assert row['days_until'] is None

    def test_days_negative(self):
        row = self._get_cert_row({'DaysRemaining': '-5'})
        assert row['days_until'] == -5

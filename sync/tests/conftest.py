"""Shared pytest fixtures for sync tests."""

import pytest
from unittest.mock import MagicMock
from dataclasses import dataclass, field
from typing import List


@pytest.fixture
def mock_sync_context():
    """Create a mock SyncContext with a fake DB connection and cursor."""
    ctx = MagicMock()
    ctx.dry_run = True

    # Create a real SyncStats so tests can inspect values
    from common import SyncStats
    ctx.stats = SyncStats()

    cursor = MagicMock()
    ctx.conn.cursor.return_value.__enter__ = MagicMock(return_value=cursor)
    ctx.conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

    return ctx


@pytest.fixture
def sample_cert_csv_row():
    """A valid certificate CSV row as returned by DictReader."""
    return {
        'Name': 'WEB01',
        'Status': 'WARNING',
        'Thumbprint': 'ABCDEF1234567890ABCDEF1234567890ABCDEF12',
        'Subject': 'CN=web01.contoso.com, OU=IT, O=Contoso',
        'Issuer': 'CN=Contoso CA, O=Contoso',
        'NotBefore': '2024-01-01T00:00:00.0000000',
        'NotAfter': '2025-06-15T00:00:00.0000000',
        'DaysRemaining': '30',
        'Source': 'Cert Store',
        'URL': 'LocalMachine\\My',
        'Error': '',
    }


@pytest.fixture
def sample_server_record():
    """A valid server record as returned from Databricks."""
    return {
        'server_name': 'SRV01',
        'fqdn': 'srv01.contoso.com',
        'ip_address': '10.0.0.1',
        'operating_system': 'Windows Server 2022',
        'environment': 'Production',
        'location': 'DC1',
        'business_unit': 'Engineering',
        'combined_service': 'Portal',
        'primary_contact': 'ops-team@contoso.com',
        'patch_group': 'Group A',
        'cmdb_id': 'CI12345',
    }

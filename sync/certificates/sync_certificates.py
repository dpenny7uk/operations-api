#!/usr/bin/env python3
"""Sync certificate scan results from PowerShell CSV to PostgreSQL."""

import csv
import glob
import os
import re
import sys
from psycopg2.extras import execute_values

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (
    setup_logging, create_argument_parser,
    configure_verbosity, SyncContext
)

logger = setup_logging('sync_certificates')


def parse_cn(distinguished_name: str) -> str:
    """Extract CN value from a distinguished name string."""
    if not distinguished_name:
        return ''
    match = re.search(r'CN=([^,]+)', distinguished_name, re.IGNORECASE)
    return match.group(1).strip() if match else distinguished_name.strip()


def classify_error(status: str, error_msg: str) -> str:
    """Map PowerShell scan status/error to a scan_failures error_category."""
    if status == 'UNREACHABLE':
        return 'unreachable'
    if not error_msg:
        return 'unknown'
    lower = error_msg.lower()
    if 'access' in lower or 'denied' in lower or 'permission' in lower:
        return 'access_denied'
    if 'timeout' in lower or 'timed out' in lower:
        return 'timeout'
    if 'winrm' in lower or 'wsman' in lower:
        return 'winrm'
    return 'unknown'


def map_alert_level(status: str) -> tuple:
    """Map PowerShell status to (alert_level, is_expired)."""
    status = (status or '').upper()
    if status == 'EXPIRED':
        return 'CRITICAL', True
    if status == 'CRITICAL':
        return 'CRITICAL', False
    if status == 'WARNING':
        return 'WARNING', False
    return 'OK', False


def map_store_name(source: str, url: str) -> str:
    """Determine store_name from the CSV Source and URL columns."""
    if 'cert store' in (source or '').lower():
        return (url or 'LocalMachine\\My')[:100]
    return 'HTTPS'[:100]


def map_scan_source(source: str) -> str:
    """Map CSV Source to scan_source value."""
    if 'endpoint' in (source or '').lower():
        return 'powershell_https'
    return 'powershell'


def parse_timestamp(value: str):
    """Parse a timestamp string, returning None if empty or invalid.

    Validates that the value looks like an ISO 8601 date (YYYY-MM-DD...) before
    accepting it. Malformed values from PowerShell scan output are rejected and
    logged rather than written to the database as bad timestamp data.
    """
    if not value or value.strip() == '':
        return None
    stripped = value.strip()
    if not re.match(r'^\d{4}-\d{2}-\d{2}', stripped):
        logger.warning(f"Rejecting malformed timestamp: {stripped!r}")
        return None
    return stripped


def read_csv(csv_path: str) -> list:
    """Read certificate scan CSV file(s) and return list of row dicts."""
    # Support glob patterns for timestamped filenames
    files = glob.glob(csv_path)
    if not files:
        raise FileNotFoundError(f"No CSV files found matching: {csv_path}")

    # Use the most recent file if multiple match
    csv_file = max(files, key=os.path.getmtime)
    logger.info(f"Reading CSV: {csv_file}")

    rows = []
    with open(csv_file, 'r', encoding='utf-8-sig', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)

    logger.info(f"Read {len(rows)} records from CSV")
    return rows


def sync_certificates(ctx, records: list):
    """Sync certificate records to PostgreSQL."""
    if not records:
        logger.warning("No certificate records to sync")
        return

    cert_rows = []
    failure_servers = set()
    success_servers = set()

    for raw in records:
        r = {k.lower(): v for k, v in raw.items()}
        status = (r.get('status') or '').strip().upper()
        server_name = (r.get('name') or '').strip()

        if not server_name:
            ctx.stats.add_error(f"Skipping record with missing server name: {r}")
            continue

        # Handle unreachable/error servers
        if status in ('UNREACHABLE', 'ERROR'):
            failure_servers.add((
                server_name,
                (r.get('error') or '')[:1000],
                classify_error(status, r.get('error') or '')
            ))
            continue

        # Valid certificate record
        success_servers.add(server_name)
        thumbprint = (r.get('thumbprint') or '').strip()
        if not thumbprint:
            ctx.stats.add_error(f"Skipping record with missing thumbprint: {r}")
            continue

        subject = (r.get('subject') or '')[:1000]
        issuer = (r.get('issuer') or '')[:1000]
        alert_level, is_expired = map_alert_level(status)
        source = r.get('source') or ''

        days_str = (r.get('daysremaining') or '').strip()
        try:
            days_until = int(days_str) if days_str else None
        except ValueError:
            days_until = None

        cert_rows.append((
            thumbprint[:64],
            subject,
            parse_cn(subject)[:500],
            issuer,
            parse_cn(issuer)[:500],
            parse_timestamp(r.get('notbefore')),
            parse_timestamp(r.get('notafter')),
            days_until,
            is_expired,
            alert_level,
            server_name[:255],
            map_store_name(source, r.get('url')),
            map_scan_source(source)[:100],
        ))

    with ctx.conn.cursor() as cur:
        # Record scan failures for unreachable servers
        for server, error_msg, category in failure_servers:
            cur.execute(
                "SELECT system.record_scan_failure(%s, 'certificate', %s, %s)",
                (server, error_msg or None, category)
            )
        if failure_servers:
            logger.info(f"Recorded {len(failure_servers)} scan failures")

        # Clear scan failures for servers that responded successfully
        for server in success_servers:
            cur.execute(
                "SELECT system.clear_scan_failure(%s, 'certificate')",
                (server,)
            )

        if not cert_rows:
            logger.warning("No valid certificate records to upsert")
            if not ctx.dry_run:
                ctx.conn.commit()
            return

        # Create temp table for bulk load
        cur.execute("""
            CREATE TEMP TABLE tmp_certificates (
                thumbprint          VARCHAR(64),
                subject             VARCHAR(1000),
                subject_cn          VARCHAR(500),
                issuer              VARCHAR(1000),
                issuer_cn           VARCHAR(500),
                valid_from          TIMESTAMP,
                valid_to            TIMESTAMP,
                days_until_expiry   INTEGER,
                is_expired          BOOLEAN,
                alert_level         VARCHAR(20),
                server_name         VARCHAR(255),
                store_name          VARCHAR(100),
                scan_source         VARCHAR(100)
            ) ON COMMIT DROP
        """)

        execute_values(cur, "INSERT INTO tmp_certificates VALUES %s", cert_rows)
        ctx.stats.processed = len(cert_rows)

        # Resolve server_id from shared.servers
        # Upsert into certificates.inventory, using xmax to distinguish inserts from updates
        cur.execute("""
            WITH upserted AS (
                INSERT INTO certificates.inventory (
                    thumbprint, subject, subject_cn, issuer, issuer_cn,
                    valid_from, valid_to, days_until_expiry, is_expired, alert_level,
                    server_id, server_name, store_name, scan_source,
                    last_seen_at, is_active
                )
                SELECT
                    t.thumbprint, t.subject, t.subject_cn, t.issuer, t.issuer_cn,
                    t.valid_from, t.valid_to, t.days_until_expiry, t.is_expired, t.alert_level,
                    s.server_id, t.server_name, t.store_name, t.scan_source,
                    CURRENT_TIMESTAMP, TRUE
                FROM tmp_certificates t
                LEFT JOIN shared.servers s
                    ON UPPER(s.server_name) = UPPER(t.server_name) AND s.is_active
                ON CONFLICT (server_name, thumbprint, store_name) DO UPDATE SET
                    subject = EXCLUDED.subject,
                    subject_cn = EXCLUDED.subject_cn,
                    issuer = EXCLUDED.issuer,
                    issuer_cn = EXCLUDED.issuer_cn,
                    valid_from = EXCLUDED.valid_from,
                    valid_to = EXCLUDED.valid_to,
                    days_until_expiry = EXCLUDED.days_until_expiry,
                    is_expired = EXCLUDED.is_expired,
                    alert_level = EXCLUDED.alert_level,
                    server_id = EXCLUDED.server_id,
                    scan_source = EXCLUDED.scan_source,
                    last_seen_at = CURRENT_TIMESTAMP,
                    is_active = TRUE
                RETURNING (xmax = 0) AS is_insert
            )
            SELECT
                COUNT(*) FILTER (WHERE is_insert) AS inserted,
                COUNT(*) FILTER (WHERE NOT is_insert) AS updated
            FROM upserted
        """)
        row = cur.fetchone()
        ctx.stats.inserted = row['inserted']
        ctx.stats.updated = row['updated']

        # Deactivate certs not seen in this scan — only on servers that were scanned
        # Use UPPER() to match case-insensitively (consistent with the INSERT join above)
        cur.execute("""
            UPDATE certificates.inventory SET
                is_active = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE scan_source IN ('powershell', 'powershell_https')
              AND is_active = TRUE
              AND UPPER(server_name) IN (SELECT DISTINCT UPPER(server_name) FROM tmp_certificates)
              AND (UPPER(server_name), thumbprint, COALESCE(store_name, '')) NOT IN (
                  SELECT UPPER(server_name), thumbprint, COALESCE(store_name, '')
                  FROM tmp_certificates
              )
        """)
        ctx.stats.deactivated = cur.rowcount

        if not ctx.dry_run:
            ctx.conn.commit()

        logger.info(
            f"Synced {ctx.stats.processed} certificates: "
            f"{ctx.stats.inserted} inserted, {ctx.stats.updated} updated, "
            f"{ctx.stats.deactivated} deactivated, "
            f"{len(failure_servers)} scan failures"
        )


def validate_csv_path(csv_path: str) -> None:
    """Reject paths that contain directory traversal sequences or absolute paths to unexpected locations."""
    # Normalise separators for consistent checking
    norm = os.path.normpath(csv_path)
    # Block absolute paths outside the working directory on non-Windows paths (e.g. /etc/passwd)
    if os.path.isabs(norm):
        # Allow Windows absolute paths to expected share/scan directories only
        allowed_prefixes = [r'C:\Scans', r'C:\CertScans', r'\\']
        if not any(norm.startswith(p) for p in allowed_prefixes):
            raise ValueError(
                f"CERT_CSV_PATH '{csv_path}' is an absolute path outside allowed directories. "
                "Expected a relative path or a path under C:\\Scans or a UNC share."
            )
    # Block traversal sequences regardless of platform
    if '..' in norm.split(os.sep):
        raise ValueError(
            f"CERT_CSV_PATH '{csv_path}' contains directory traversal sequence (..)."
        )


def main():
    parser = create_argument_parser("Sync certificate scan results from CSV to PostgreSQL")
    parser.add_argument(
        '--csv',
        default=os.environ.get('CERT_CSV_PATH', 'SSL-CertExpiry-*.csv'),
        help='Path or glob pattern to certificate scan CSV file(s)'
    )
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    validate_csv_path(args.csv)

    with SyncContext("certificate_scan", "Certificate Scan Sync", dry_run=args.dry_run) as ctx:
        ctx.check_circuit_breaker()
        records = read_csv(args.csv)
        sync_certificates(ctx, records)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Sync certificate scan results from PowerShell CSV to PostgreSQL."""

import csv
import glob
import os
import re
from psycopg2.extras import execute_values

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
    """Parse a timestamp string, returning None if empty or invalid."""
    if not value or value.strip() == '':
        return None
    return value.strip()


def read_csv(csv_path: str) -> list:
    """Read certificate scan CSV file(s) and return list of row dicts."""
    files = glob.glob(csv_path)
    if not files:
        raise FileNotFoundError(f"No CSV files found matching: {csv_path}")

    csv_file = max(files, key=os.path.getmtime)
    logger.info(f"Reading CSV: {csv_file}")

    rows = []
    with open(csv_file, 'r', encoding='utf-8-sig') as f:
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

    for r in records:
        status = (r.get('Status') or '').strip().upper()
        server_name = (r.get('Name') or '').strip()

        if not server_name:
            ctx.stats.add_error(f"Skipping record with missing server name: {r}")
            continue

        if status in ('UNREACHABLE', 'ERROR'):
            failure_servers.add((
                server_name,
                (r.get('Error') or '')[:1000],
                classify_error(status, r.get('Error') or '')
            ))
            continue

        success_servers.add(server_name)
        thumbprint = (r.get('Thumbprint') or '').strip()
        if not thumbprint:
            ctx.stats.add_error(f"Skipping record with missing thumbprint: {r}")
            continue

        subject = (r.get('Subject') or '')[:1000]
        issuer = (r.get('Issuer') or '')[:1000]
        alert_level, is_expired = map_alert_level(status)
        source = r.get('Source') or ''

        days_str = r.get('DaysRemaining') or ''
        days_until = int(days_str) if days_str.lstrip('-').isdigit() else None

        cert_rows.append((
            thumbprint[:64],
            subject,
            parse_cn(subject)[:500],
            issuer,
            parse_cn(issuer)[:500],
            parse_timestamp(r.get('NotBefore')),
            parse_timestamp(r.get('NotAfter')),
            days_until,
            is_expired,
            alert_level,
            server_name[:255],
            map_store_name(source, r.get('URL')),
            map_scan_source(source)[:100],
        ))

    with ctx.conn.cursor() as cur:
        for server, error_msg, category in failure_servers:
            cur.execute(
                "SELECT system.record_scan_failure(%s, 'certificate', %s, %s)",
                (server, error_msg or None, category)
            )
        if failure_servers:
            logger.info(f"Recorded {len(failure_servers)} scan failures")

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

        cur.execute("""
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
        """)
        ctx.stats.updated = cur.rowcount

        cur.execute("""
            UPDATE certificates.inventory SET
                is_active = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE scan_source IN ('powershell', 'powershell_https')
              AND is_active = TRUE
              AND (server_name, thumbprint, COALESCE(store_name, '')) NOT IN (
                  SELECT server_name, thumbprint, COALESCE(store_name, '')
                  FROM tmp_certificates
              )
        """)
        ctx.stats.deactivated = cur.rowcount

        if not ctx.dry_run:
            ctx.conn.commit()

        logger.info(
            f"Synced {ctx.stats.processed} certificates, "
            f"updated {ctx.stats.updated}, "
            f"deactivated {ctx.stats.deactivated}, "
            f"scan failures {len(failure_servers)}"
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

    with SyncContext("certificate_scan", "Certificate Scan Sync", dry_run=args.dry_run) as ctx:
        records = read_csv(args.csv)
        sync_certificates(ctx, records)


if __name__ == "__main__":
    main()

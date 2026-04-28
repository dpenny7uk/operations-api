#!/usr/bin/env python3
"""Sync disk snapshots from SolarWinds Orion to PostgreSQL.

Replaces the Tableau disk-monitoring dashboard. Each run inserts one row per
disk into monitoring.disk_snapshots — append-only history, never updated.

Alert thresholds replicate Tableau's calculated fields exactly:
  warn (status=2): percent_used >= DISK_WARN_PCT (default 80, no per-disk override)
  crit (status=3): percent_used >= COALESCE(Volumes.[Alert Vol], DISK_CRIT_PCT_DEFAULT)
  ok   (status=1): otherwise

If thresholds are changed via env vars, also update DiskMonitoring:WarnThresholdPct
and DiskMonitoring:CritThresholdPct in appsettings.json so the in-app alerts
feed stays consistent with the snapshots.
"""

import os
import re
import sys
from typing import Optional

import pyodbc
from psycopg2.extras import execute_values

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (
    setup_logging, create_argument_parser, configure_verbosity,
    validate_env_vars, SyncContext
)

logger = setup_logging('sync_solarwinds_disks')


WARN_PCT = float(os.environ.get('DISK_WARN_PCT', '80.0'))
CRIT_PCT_DEFAULT = float(os.environ.get('DISK_CRIT_PCT_DEFAULT', '90.0'))


# Whitelist matcher for SolarWinds queries: optional leading whitespace, line
# comments (-- ...) and block comments (/* ... */), then a SELECT. Anything
# else (INSERT/UPDATE/DELETE/EXEC/MERGE/DDL) is refused before reaching the
# wire as defence in depth on top of db_datareader account permissions.
_READONLY_RE = re.compile(
    r'^\s*(?:(?:--[^\n]*\n|/\*.*?\*/)\s*)*\s*select\b',
    re.IGNORECASE | re.DOTALL,
)


class _ReadOnlyCursor:
    """pyodbc cursor proxy that allows only SELECT statements."""

    def __init__(self, inner):
        self._inner = inner

    def execute(self, operation, *args, **kwargs):
        if not _READONLY_RE.match(operation or ''):
            preview = (operation or '').strip()[:80]
            raise RuntimeError(
                f"SolarWinds connection is read-only — refusing non-SELECT SQL: {preview!r}"
            )
        return self._inner.execute(operation, *args, **kwargs)

    def executemany(self, *_a, **_kw):
        raise RuntimeError("SolarWinds connection is read-only — executemany is forbidden")

    def callproc(self, *_a, **_kw):
        raise RuntimeError("SolarWinds connection is read-only — stored procedures are forbidden")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return self._inner.__exit__(exc_type, exc, tb)

    def __getattr__(self, name):
        return getattr(self._inner, name)


class _ReadOnlyConnection:
    """pyodbc connection proxy that yields read-only cursors."""

    def __init__(self, inner):
        self._inner = inner

    def cursor(self, *args, **kwargs):
        return _ReadOnlyCursor(self._inner.cursor(*args, **kwargs))

    def close(self):
        return self._inner.close()

    def __getattr__(self, name):
        return getattr(self._inner, name)

BYTES_PER_GB = 1073741824  # 1024**3

# Source query — joins per-disk Volumes with per-server Nodes for owner/env context.
# WHERE filters mirror typical Orion practice: only fixed disks, only managed volumes.
SOURCE_QUERY = """
SELECT
    n.NodeID,
    n.Caption        AS server_name,
    n.Service        AS service,
    n.Environment    AS environment,
    n.TechnicalOwner AS technical_owner,
    n.BusinessOwner  AS business_owner,
    n.BusinessUnit   AS business_unit,
    n.Tier           AS tier,
    v.VolumeID,
    v.Caption        AS disk_label,
    v.DeviceId       AS device_id,
    v.VolumeSize             AS size_bytes,
    v.VolumeSpaceUsed        AS used_bytes,
    v.VolumeSpaceAvailable   AS free_bytes,
    v.VolumePercentUsed      AS percent_used,
    v.[Alert Vol]            AS alert_vol_override
FROM dbo.Volumes v
INNER JOIN dbo.Nodes n ON v.NodeID = n.NodeID
WHERE v.VolumeType = 'Fixed Disk'
  AND v.UnManaged = 0
"""


def get_solarwinds_connection():
    """Connect to SolarWinds Orion via pyodbc + Trusted_Connection.

    Authenticates with the process's Windows identity (HISCOX\\SVC_Tableau on
    the dedicated solarwinds-readers ADO agent). No SOLARWINDS_USER/_PASSWORD
    env vars — pyodbc inherits the agent service account's credentials at the
    OS level. The named-instance form (host\\instance) is supported directly
    by SERVER=; SQL Browser (UDP 1434) resolves the dynamic port.

    Returns a _ReadOnlyConnection wrapper that refuses non-SELECT statements
    at code level. db_datareader on SolarWindsOrion is the strongest defence
    at the SQL Server side; the wrapper backs that up at code level.
    """
    validate_env_vars(['SOLARWINDS_HOST', 'SOLARWINDS_DATABASE'])
    raw = pyodbc.connect(
        "DRIVER={ODBC Driver 17 for SQL Server};"
        f"SERVER={os.environ['SOLARWINDS_HOST']};"
        f"DATABASE={os.environ['SOLARWINDS_DATABASE']};"
        "Trusted_Connection=yes;"
        "Encrypt=yes;TrustServerCertificate=no;",
        timeout=60,
    )
    return _ReadOnlyConnection(raw)


def _rows_as_dicts(cursor, rows):
    """Convert pyodbc tuple-rows to dicts using cursor.description column names.

    pymssql exposed `as_dict=True`; pyodbc has no equivalent flag, so we do it
    explicitly here. transform_row() uses dict-style access (row['server_name'])
    and is unchanged by the driver swap thanks to this helper.
    """
    cols = [c[0] for c in cursor.description]
    return [dict(zip(cols, r)) for r in rows]


def fetch_disks_from_solarwinds() -> list:
    """Run the source query against SolarWinds and return raw rows as dicts."""
    conn = get_solarwinds_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(SOURCE_QUERY)
            rows = cur.fetchall()
            logger.info("Fetched %d disk rows from SolarWinds", len(rows))
            return _rows_as_dicts(cur, rows)
    finally:
        conn.close()


def transform_row(row: dict) -> Optional[dict]:
    """Convert a SolarWinds row into a monitoring.disk_snapshots row.

    Returns None if the row should be skipped (e.g. zero-size volume which
    would make percent_used division-by-zero).
    """
    size_bytes = row.get('size_bytes')
    if not size_bytes or size_bytes <= 0:
        logger.debug("Skipping zero-size volume: server=%s disk=%s",
                     row.get('server_name'), row.get('disk_label'))
        return None

    volume_size_gb = round(size_bytes / BYTES_PER_GB, 2)
    used_gb = round((row.get('used_bytes') or 0) / BYTES_PER_GB, 2)
    free_gb = round((row.get('free_bytes') or 0) / BYTES_PER_GB, 2)
    percent_used = float(row.get('percent_used') or 0.0)

    # Per-disk crit threshold from SolarWinds Volumes.[Alert Vol]; fall back to global default.
    alert_vol = row.get('alert_vol_override')
    crit_pct = float(alert_vol) if alert_vol is not None else CRIT_PCT_DEFAULT

    # Alert status — replicates Tableau's calc exactly.
    if percent_used < WARN_PCT:
        alert_status = 1
    elif percent_used >= crit_pct:
        alert_status = 3
    else:
        alert_status = 2

    return {
        'server_name': row['server_name'],
        'service': row.get('service'),
        'environment': row.get('environment'),
        'technical_owner': row.get('technical_owner'),
        'business_owner': row.get('business_owner'),
        'business_unit': row.get('business_unit'),
        'tier': row.get('tier'),
        'disk_label': row['disk_label'],
        'volume_size_gb': volume_size_gb,
        'used_gb': used_gb,
        'free_gb': free_gb,
        'percent_used': percent_used,
        'alert_status': alert_status,
        'threshold_warn_pct': WARN_PCT,
        'threshold_crit_pct': crit_pct,
        'source_volume_id': row['VolumeID'],
        'source_node_id': row['NodeID'],
    }


INSERT_COLUMNS = (
    'server_name', 'service', 'environment', 'technical_owner', 'business_owner',
    'business_unit', 'tier', 'disk_label', 'volume_size_gb', 'used_gb', 'free_gb',
    'percent_used', 'alert_status', 'threshold_warn_pct', 'threshold_crit_pct',
    'source_volume_id', 'source_node_id',
)


def insert_snapshots(ctx, snapshots: list):
    """Bulk-insert snapshot rows into monitoring.disk_snapshots."""
    if not snapshots:
        logger.warning("No snapshots to insert")
        return

    values = [tuple(s[c] for c in INSERT_COLUMNS) for s in snapshots]

    with ctx.conn.cursor() as cur:
        execute_values(
            cur,
            f"""
            INSERT INTO monitoring.disk_snapshots ({', '.join(INSERT_COLUMNS)})
            VALUES %s
            """,
            values,
            page_size=500,
        )
        ctx.stats.inserted = cur.rowcount

    if not ctx.dry_run:
        ctx.conn.commit()

    by_status = {1: 0, 2: 0, 3: 0}
    for s in snapshots:
        by_status[s['alert_status']] += 1
    logger.info(
        "Inserted %d snapshots — ok=%d warn=%d crit=%d",
        ctx.stats.inserted, by_status[1], by_status[2], by_status[3]
    )


def main():
    parser = create_argument_parser("Sync disk snapshots from SolarWinds Orion to PostgreSQL")
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    logger.info("Thresholds: warn=%.1f%%, crit_default=%.1f%% (per-disk override via Volumes.[Alert Vol])",
                WARN_PCT, CRIT_PCT_DEFAULT)

    with SyncContext("solarwinds_disks", "SolarWinds Disk Sync", dry_run=args.dry_run) as ctx:
        ctx.check_circuit_breaker()

        raw_rows = fetch_disks_from_solarwinds()
        ctx.stats.processed = len(raw_rows)

        snapshots = []
        for row in raw_rows:
            transformed = transform_row(row)
            if transformed is not None:
                snapshots.append(transformed)
            else:
                ctx.stats.failed += 1

        insert_snapshots(ctx, snapshots)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Sync per-server EOL software installations from Databricks asset_inventory to PostgreSQL.

Reads installed software from asset_inventory via the Jobs API, maps entries to
known EOL products using pattern matching, and upserts per-server rows into
eol.end_of_life_software. Lifecycle dates come from sync_eol_dates.py (separate sync).
"""

import os
import re
import sys
from psycopg2.extras import execute_values

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (
    setup_logging, create_argument_parser,
    configure_verbosity, SyncContext, query_databricks,
    get_job_run_output, count_upsert_results
)

logger = setup_logging('sync_eol_software')

# Valid server name prefixes — same set used by sync_server_list.py and the
# push_server_list Databricks notebook.  Entries whose machine_name does not
# start with one of these prefixes are desktops / non-server assets.
VALID_SERVER_PREFIXES = frozenset([
    'pr', 'dv', 'sy', 'ut', 'st', 'tr', 'ls', 'ss', 'pc', 'ci',
])


def is_server(machine_name: str) -> bool:
    """Return True if the machine_name looks like a server (known env prefix)."""
    return len(machine_name) >= 2 and machine_name[:2].lower() in VALID_SERVER_PREFIXES


# Databricks query for direct SQL API access (fallback).
# The Jobs API approach uses a saved query in Databricks instead — keep this
# pre-filter aligned with the saved query so both code paths see the same
# input volume.
EOL_SOFTWARE_QUERY = """\
SELECT
    machine_name,
    ivanti_installed_software,
    ivanti_software_version
FROM prod_its_lakehouse.gold_asset_inventory.asset_inventory
WHERE drab_decomissioned IS NULL
  AND ivanti_installed_software IS NOT NULL
  AND (
    LOWER(ivanti_installed_software) LIKE '%sql server%'
    OR LOWER(ivanti_installed_software) LIKE '%.net framework%'
    OR LOWER(ivanti_installed_software) LIKE '%iis%'
    OR LOWER(ivanti_installed_software) LIKE '%management studio%'
    OR LOWER(ivanti_installed_software) LIKE '%odbc driver%'
    OR LOWER(ivanti_installed_software) LIKE '%ole db%'
  )
"""

# Pattern mapping: (regex on ivanti_installed_software, eol_product, eol_product_version)
# These map installed software names to endoflife.date product identifiers.
# Order matters — first match wins. More specific patterns should come before general ones.
#
# When adding patterns, cross-check the EOL dates against
# https://learn.microsoft.com/en-us/lifecycle/products and add the
# corresponding eol.end_of_life_software product-level row via sync_eol_dates.py
# (otherwise the per-server upsert here has no lifecycle row to join against).
SOFTWARE_PATTERNS = [
    # === SQL Server Management Studio (SSMS) ==============================
    # Place BEFORE generic "sql server" so SSMS matches first.
    (re.compile(r'sql server management studio.*\b20\b', re.IGNORECASE), 'ssms', '20'),
    (re.compile(r'sql server management studio.*\b19\b', re.IGNORECASE), 'ssms', '19'),
    (re.compile(r'sql server management studio.*\b18\b', re.IGNORECASE), 'ssms', '18'),
    (re.compile(r'sql server management studio.*\b17\b', re.IGNORECASE), 'ssms', '17'),

    # === SQL Server (engine) ==============================================
    # Match by marketing year, map to internal version for endoflife.date.
    (re.compile(r'sql server 2012', re.IGNORECASE), 'mssqlserver', '11.0'),
    (re.compile(r'sql server 2014', re.IGNORECASE), 'mssqlserver', '12.0'),
    (re.compile(r'sql server 2016', re.IGNORECASE), 'mssqlserver', '13.0'),
    (re.compile(r'sql server 2017', re.IGNORECASE), 'mssqlserver', '14.0'),
    (re.compile(r'sql server 2019', re.IGNORECASE), 'mssqlserver', '15.0'),
    (re.compile(r'sql server 2022', re.IGNORECASE), 'mssqlserver', '16.0'),

    # === ODBC Driver for SQL Server =======================================
    (re.compile(r'odbc driver 18 for sql server', re.IGNORECASE), 'mssql-odbc', '18'),
    (re.compile(r'odbc driver 17 for sql server', re.IGNORECASE), 'mssql-odbc', '17'),
    (re.compile(r'odbc driver 13 for sql server', re.IGNORECASE), 'mssql-odbc', '13'),

    # === OLE DB Driver for SQL Server (MSOLEDBSQL) ========================
    (re.compile(r'(microsoft )?ole db driver 19 for sql server', re.IGNORECASE), 'mssql-oledb', '19'),
    (re.compile(r'(microsoft )?ole db driver 18 for sql server', re.IGNORECASE), 'mssql-oledb', '18'),

    # === .NET Framework ===================================================
    (re.compile(r'\.net framework 4\.8', re.IGNORECASE), 'dotnet-framework', '4.8'),
    (re.compile(r'\.net framework 4\.7', re.IGNORECASE), 'dotnet-framework', '4.7'),
    (re.compile(r'\.net framework 4\.6', re.IGNORECASE), 'dotnet-framework', '4.6'),
    (re.compile(r'\.net framework 4\.5', re.IGNORECASE), 'dotnet-framework', '4.5'),
    (re.compile(r'\.net framework 3\.5', re.IGNORECASE), 'dotnet-framework', '3.5'),

    # === IIS ==============================================================
    (re.compile(r'\biis\b', re.IGNORECASE), 'iis', '10.0'),
]


def map_software_to_product(software_name: str):
    """Map an ivanti_installed_software value to (eol_product, eol_product_version).

    Returns (eol_product, eol_product_version) or None if no pattern matches.
    """
    for pattern, product, version in SOFTWARE_PATTERNS:
        if pattern.search(software_name):
            return product, version
    return None


def _record_unmatched(ctx, unmatched: dict):
    """Upsert unmatched software names into eol.unmatched_software.

    Best-effort: failures are logged and swallowed so they cannot abort the
    main sync transaction. The unmatched table is a work-list — losing a run
    of it just means the next sync re-records the same names.
    """
    if ctx.dry_run:
        return
    try:
        with ctx.conn.cursor() as cur:
            for software_name, (software_version, sample_machine) in unmatched.items():
                cur.execute(
                    "SELECT eol.record_unmatched_software(%s, %s, %s, %s)",
                    (software_name[:500], 'databricks',
                     (software_version or '')[:255] or None,
                     (sample_machine or '')[:255] or None)
                )
            ctx.conn.commit()
    except Exception as exc:
        logger.warning("Failed to record unmatched software (continuing): %s", exc)
        try:
            ctx.conn.rollback()
        except Exception:
            pass


def sync_eol_software(ctx, records: list):
    """Sync per-server EOL software to PostgreSQL using temp table + upsert pattern."""
    if not records:
        logger.warning("No software records to sync")
        return

    # Map raw asset_inventory records to (eol_product, eol_product_version, machine_name)
    mapped = {}  # deduplicate: (product, version, machine_name) -> True
    # Deduplicate skipped software here so we call record_unmatched_software once
    # per distinct (name, version, sample-machine) per run. The DB function still
    # increments occurrence_count atomically across runs.
    unmatched_seen = {}  # raw_software_name -> (raw_software_version, sample_machine_name)
    skipped = 0
    filtered_desktops = 0
    for r in records:
        machine_name = (r.get('machine_name') or '').strip()
        software_name = r.get('ivanti_installed_software') or ''
        software_version = r.get('ivanti_software_version') or None

        if not machine_name or not software_name:
            skipped += 1
            continue

        if not is_server(machine_name):
            filtered_desktops += 1
            continue

        match = map_software_to_product(software_name)
        if not match:
            logger.debug("No pattern match for: %s", software_name)
            skipped += 1
            # Record the unmatched software so the dashboard's work-list can
            # surface high-frequency patterns to add to SOFTWARE_PATTERNS.
            if software_name not in unmatched_seen:
                unmatched_seen[software_name] = (software_version, machine_name)
            continue

        product, version = match
        key = (product, version, machine_name)
        if key not in mapped:
            mapped[key] = True

    if filtered_desktops:
        logger.info("Filtered %d non-server records (desktop/unknown prefix)", filtered_desktops)
    if skipped:
        logger.info("Skipped %d records (no pattern match or empty fields)", skipped)
    if unmatched_seen:
        logger.info("Recording %d distinct unmatched software names to eol.unmatched_software", len(unmatched_seen))
        _record_unmatched(ctx, unmatched_seen)

    if not mapped:
        raise RuntimeError(
            "No software records matched any known EOL pattern — aborting sync. "
            "Check the Databricks query output and SOFTWARE_PATTERNS mapping."
        )

    with ctx.conn.cursor() as cur:
        cur.execute("""
            CREATE TEMP TABLE tmp_eol_software (
                eol_product         VARCHAR(255),
                eol_product_version VARCHAR(100),
                machine_name        VARCHAR(255)
            ) ON COMMIT DROP
        """)

        values = [(p, v, m) for p, v, m in mapped.keys()]
        execute_values(cur, "INSERT INTO tmp_eol_software VALUES %s", values)
        ctx.stats.processed = len(values)

        # Upsert per-server rows (no lifecycle dates — those come from sync_eol_dates)
        cur.execute("""
            INSERT INTO eol.end_of_life_software (
                eol_product,
                eol_product_version,
                machine_name,
                source_system,
                synced_at,
                is_active
            )
            SELECT
                t.eol_product,
                t.eol_product_version,
                t.machine_name,
                'databricks',
                CURRENT_TIMESTAMP,
                TRUE
            FROM tmp_eol_software t
            ON CONFLICT (eol_product, eol_product_version, COALESCE(machine_name, '')) DO UPDATE SET
                synced_at = CURRENT_TIMESTAMP,
                is_active = TRUE
            RETURNING (xmax = 0) AS is_insert
        """)
        rows = cur.fetchall()
        ctx.stats.inserted, ctx.stats.updated = count_upsert_results(rows)

        # Deactivate per-server records no longer in source
        # Only deactivate rows with machine_name (not product-level date records)
        cur.execute("""
            UPDATE eol.end_of_life_software SET
                is_active = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE source_system = 'databricks'
              AND machine_name IS NOT NULL
              AND is_active = TRUE
              AND (eol_product, eol_product_version, machine_name) NOT IN (
                  SELECT eol_product, eol_product_version, machine_name
                  FROM tmp_eol_software
              )
        """)
        ctx.stats.deactivated = cur.rowcount

        if not ctx.dry_run:
            ctx.conn.commit()

        logger.info(
            "Synced %d per-server EOL records, inserted %d, updated %d, deactivated %d",
            ctx.stats.processed, ctx.stats.inserted, ctx.stats.updated, ctx.stats.deactivated
        )


def main():
    parser = create_argument_parser("Sync per-server EOL software from Databricks to PostgreSQL")
    parser.add_argument(
        '--source', choices=['databricks', 'jobs'], default='jobs',
        help='Data source: databricks (SQL API) or jobs (Jobs API run output)'
    )
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    with SyncContext("databricks_eol_software", "Databricks EOL Software Sync", dry_run=args.dry_run) as ctx:
        ctx.check_circuit_breaker()
        if args.source == 'jobs':
            records = get_job_run_output()
        else:
            records = query_databricks(EOL_SOFTWARE_QUERY)
        sync_eol_software(ctx, records)


if __name__ == "__main__":
    main()

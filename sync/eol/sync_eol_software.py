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
# The Jobs API approach uses a saved query in Databricks instead.
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
  )
"""

# Pattern mapping: (regex on ivanti_installed_software, eol_product, eol_product_version)
# These map installed software names to endoflife.date product identifiers.
# Order matters — first match wins. More specific patterns should come before general ones.
SOFTWARE_PATTERNS = [
    # SQL Server — match by marketing year, map to internal version for endoflife.date
    (re.compile(r'sql server 2012', re.IGNORECASE), 'mssqlserver', '11.0'),
    (re.compile(r'sql server 2014', re.IGNORECASE), 'mssqlserver', '12.0'),
    (re.compile(r'sql server 2016', re.IGNORECASE), 'mssqlserver', '13.0'),
    (re.compile(r'sql server 2017', re.IGNORECASE), 'mssqlserver', '14.0'),
    (re.compile(r'sql server 2019', re.IGNORECASE), 'mssqlserver', '15.0'),
    (re.compile(r'sql server 2022', re.IGNORECASE), 'mssqlserver', '16.0'),
    # .NET Framework
    (re.compile(r'\.net framework 4\.8', re.IGNORECASE), 'dotnet-framework', '4.8'),
    (re.compile(r'\.net framework 4\.7', re.IGNORECASE), 'dotnet-framework', '4.7'),
    (re.compile(r'\.net framework 4\.6', re.IGNORECASE), 'dotnet-framework', '4.6'),
    (re.compile(r'\.net framework 4\.5', re.IGNORECASE), 'dotnet-framework', '4.5'),
    (re.compile(r'\.net framework 3\.5', re.IGNORECASE), 'dotnet-framework', '3.5'),
    # IIS
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


def sync_eol_software(ctx, records: list):
    """Sync per-server EOL software to PostgreSQL using temp table + upsert pattern."""
    if not records:
        logger.warning("No software records to sync")
        return

    # Map raw asset_inventory records to (eol_product, eol_product_version, machine_name)
    mapped = {}  # deduplicate: (product, version, machine_name) -> True
    skipped = 0
    filtered_desktops = 0
    for r in records:
        machine_name = (r.get('machine_name') or '').strip()
        software_name = r.get('ivanti_installed_software') or ''

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
            continue

        product, version = match
        key = (product, version, machine_name)
        if key not in mapped:
            mapped[key] = True

    if filtered_desktops:
        logger.info("Filtered %d non-server records (desktop/unknown prefix)", filtered_desktops)
    if skipped:
        logger.info("Skipped %d records (no pattern match or empty fields)", skipped)

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

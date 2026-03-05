#!/usr/bin/env python3
"""Sync end-of-life software data from Databricks to PostgreSQL."""

import os
import sys
import requests
from psycopg2.extras import execute_values

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (
    setup_logging, validate_env_vars, create_argument_parser,
    configure_verbosity, SyncContext
)

logger = setup_logging('sync_eol_software')

# Databricks source table - adjust catalog/schema if needed
EOL_QUERY = os.environ.get(
    'DATABRICKS_EOL_QUERY',
    """
    SELECT
        eol_product,
        eol_product_version,
        eol_end_of_life,
        eol_end_of_extended_support,
        eol_end_of_support,
        asset,
        tag
    FROM gold_asset_inventory.end_of_life_software
    """
)


def fetch_from_databricks(ctx) -> list:
    """Fetch EOL software data from Databricks SQL endpoint."""
    validate_env_vars(['DATABRICKS_HOST', 'DATABRICKS_TOKEN', 'DATABRICKS_WAREHOUSE_ID'])

    url = f"https://{os.environ['DATABRICKS_HOST']}/api/2.0/sql/statements"
    headers = {
        "Authorization": f"Bearer {os.environ['DATABRICKS_TOKEN']}",
        "Content-Type": "application/json"
    }

    response = requests.post(
        url,
        headers=headers,
        json={
            "warehouse_id": os.environ['DATABRICKS_WAREHOUSE_ID'],
            "statement": EOL_QUERY,
            "wait_timeout": "120s"
        },
        timeout=180
    )
    response.raise_for_status()
    result = response.json()

    state = result.get('status', {}).get('state')
    if state != 'SUCCEEDED':
        error_msg = result.get('status', {}).get('error', {}).get('message', 'Unknown error')
        raise Exception(f"Databricks query failed: {error_msg}")

    columns = [
        col['name'].lower()
        for col in result.get('manifest', {}).get('schema', {}).get('columns', [])
    ]

    rows = []
    for chunk in result.get('result', {}).get('data_array', []):
        rows.append(dict(zip(columns, chunk)))

    logger.info(f"Fetched {len(rows)} EOL software records from Databricks")
    return rows


def sync_eol_software(ctx, records: list):
    """Sync EOL software to PostgreSQL using temp table + upsert pattern."""
    if not records:
        logger.warning("No EOL records to sync")
        return

    with ctx.conn.cursor() as cur:
        # Create temp table for bulk load
        cur.execute("""
            CREATE TEMP TABLE tmp_eol_software (
                eol_product         VARCHAR(255),
                eol_product_version VARCHAR(100),
                eol_end_of_life     TIMESTAMP,
                eol_end_of_extended_support TIMESTAMP,
                eol_end_of_support  TIMESTAMP,
                asset               VARCHAR(255),
                tag                 VARCHAR(255)
            ) ON COMMIT DROP
        """)

        # Bulk insert to temp table
        values = []
        for r in records:
            product = (r.get('eol_product') or '').strip()
            version = (r.get('eol_product_version') or '').strip()

            if not product or not version:
                ctx.stats.add_error(f"Skipping record with missing product/version: {r}")
                continue

            values.append((
                product[:255],
                version[:100],
                r.get('eol_end_of_life') or None,
                r.get('eol_end_of_extended_support') or None,
                r.get('eol_end_of_support') or None,
                (r.get('asset') or '')[:255] or None,
                (r.get('tag') or '')[:255] or None,
            ))

        execute_values(cur, "INSERT INTO tmp_eol_software VALUES %s", values)
        ctx.stats.processed = len(values)

        # Upsert into eol.end_of_life_software
        cur.execute("""
            INSERT INTO eol.end_of_life_software (
                eol_product,
                eol_product_version,
                eol_end_of_life,
                eol_end_of_extended_support,
                eol_end_of_support,
                asset,
                tag,
                source_system,
                synced_at,
                is_active
            )
            SELECT
                t.eol_product,
                t.eol_product_version,
                t.eol_end_of_life,
                t.eol_end_of_extended_support,
                t.eol_end_of_support,
                t.asset,
                t.tag,
                'databricks',
                CURRENT_TIMESTAMP,
                TRUE
            FROM tmp_eol_software t
            ON CONFLICT (eol_product, eol_product_version, asset) DO UPDATE SET
                eol_end_of_life = EXCLUDED.eol_end_of_life,
                eol_end_of_extended_support = EXCLUDED.eol_end_of_extended_support,
                eol_end_of_support = EXCLUDED.eol_end_of_support,
                tag = EXCLUDED.tag,
                synced_at = CURRENT_TIMESTAMP,
                is_active = TRUE
        """)
        ctx.stats.updated = cur.rowcount

        # Deactivate records no longer in source
        cur.execute("""
            UPDATE eol.end_of_life_software SET
                is_active = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE source_system = 'databricks'
              AND is_active = TRUE
              AND (eol_product, eol_product_version, COALESCE(asset, '')) NOT IN (
                  SELECT eol_product, eol_product_version, COALESCE(asset, '')
                  FROM tmp_eol_software
              )
        """)
        ctx.stats.deactivated = cur.rowcount

        if not ctx.dry_run:
            ctx.conn.commit()

        logger.info(
            f"Synced {ctx.stats.processed} EOL records, "
            f"updated {ctx.stats.updated}, "
            f"deactivated {ctx.stats.deactivated}"
        )


def main():
    parser = create_argument_parser("Sync EOL software data from Databricks to PostgreSQL")
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    with SyncContext("databricks_eol", "Databricks EOL Software Sync", dry_run=args.dry_run) as ctx:
        records = fetch_from_databricks(ctx)
        sync_eol_software(ctx, records)


if __name__ == "__main__":
    main()

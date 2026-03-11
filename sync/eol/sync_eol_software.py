#!/usr/bin/env python3
"""Sync end-of-life software data from Databricks to PostgreSQL."""

import os
import sys
from psycopg2.extras import execute_values

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (
    setup_logging, create_argument_parser,
    configure_verbosity, SyncContext, query_databricks,
    count_upsert_results
)

logger = setup_logging('sync_eol_software')

# INTENT: INNER JOIN is deliberate — we only want EOL records for software that is
# actually installed on active (non-decommissioned) servers. EOL products without a
# matching asset_inventory row are excluded because they represent uninstalled software
# with no operational risk. If visibility of uninstalled EOL products is needed later,
# change to LEFT JOIN and allow NULL machine_name.
EOL_QUERY = """\
SELECT
    eol.eol_product,
    eol.eol_product_version,
    eol.eol_end_of_life,
    eol.eol_end_of_extended_support,
    eol.eol_end_of_support,
    ai.machine_name,
    eol.asset,
    eol.tag
FROM gold_asset_inventory.end_of_life_software eol
JOIN gold_asset_inventory.asset_inventory ai
    ON ai.ivanti_installed_software = eol.asset
    AND ai.ivanti_software_version = eol.eol_product_version
WHERE ai.drab_decomissioned = 'No'
"""


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
                machine_name        VARCHAR(255),
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
                (r.get('machine_name') or '')[:255] or None,
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
                machine_name,
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
                t.machine_name,
                t.asset,
                t.tag,
                'databricks',
                CURRENT_TIMESTAMP,
                TRUE
            FROM tmp_eol_software t
            ON CONFLICT (eol_product, eol_product_version, COALESCE(machine_name, '')) DO UPDATE SET
                eol_end_of_life = EXCLUDED.eol_end_of_life,
                eol_end_of_extended_support = EXCLUDED.eol_end_of_extended_support,
                eol_end_of_support = EXCLUDED.eol_end_of_support,
                asset = EXCLUDED.asset,
                tag = EXCLUDED.tag,
                synced_at = CURRENT_TIMESTAMP,
                is_active = TRUE
            RETURNING (xmax = 0) AS is_insert
        """)
        rows = cur.fetchall()
        ctx.stats.inserted, ctx.stats.updated = count_upsert_results(rows)

        # Deactivate records no longer in source
        cur.execute("""
            UPDATE eol.end_of_life_software SET
                is_active = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE source_system = 'databricks'
              AND is_active = TRUE
              AND (eol_product, eol_product_version, COALESCE(machine_name, '')) NOT IN (
                  SELECT eol_product, eol_product_version, COALESCE(machine_name, '')
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
        ctx.check_circuit_breaker()
        records = query_databricks(EOL_QUERY, env_var_override='DATABRICKS_EOL_QUERY')
        sync_eol_software(ctx, records)


if __name__ == "__main__":
    main()

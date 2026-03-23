#!/usr/bin/env python3
"""Sync end-of-life lifecycle dates from Databricks end_of_life_dates to PostgreSQL.

Syncs product-level EOL reference data (no per-server info). Per-server software
detection is handled separately by sync_eol_software.py.
"""

import os
import sys
from psycopg2.extras import execute_values

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (
    setup_logging, create_argument_parser,
    configure_verbosity, SyncContext, query_databricks,
    get_job_run_output, count_upsert_results
)

logger = setup_logging('sync_eol_dates')

EOL_DATES_QUERY = """\
SELECT
    product AS eol_product,
    cycle AS eol_product_version,
    eol AS eol_end_of_life,
    support AS eol_end_of_support,
    end_of_extended AS eol_end_of_extended_support
FROM prod_its_lakehouse.gold_asset_inventory.end_of_life_dates
"""


def sync_eol_dates(ctx, records: list):
    """Sync EOL lifecycle dates to PostgreSQL using temp table + upsert pattern."""
    if not records:
        logger.warning("No EOL date records to sync")
        return

    with ctx.conn.cursor() as cur:
        cur.execute("""
            CREATE TEMP TABLE tmp_eol_dates (
                eol_product         VARCHAR(255),
                eol_product_version VARCHAR(100),
                eol_end_of_life     TIMESTAMP,
                eol_end_of_support  TIMESTAMP,
                eol_end_of_extended_support TIMESTAMP
            ) ON COMMIT DROP
        """)

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
                r.get('eol_end_of_support') or None,
                r.get('eol_end_of_extended_support') or r.get('eol_end_of_extended') or None,
            ))

        if not values:
            raise RuntimeError("No valid EOL date records after filtering — aborting sync.")

        execute_values(cur, "INSERT INTO tmp_eol_dates VALUES %s", values)
        ctx.stats.processed = len(values)

        # Upsert into eol.end_of_life_software as product-level rows (machine_name = NULL)
        cur.execute("""
            INSERT INTO eol.end_of_life_software (
                eol_product,
                eol_product_version,
                eol_end_of_life,
                eol_end_of_support,
                eol_end_of_extended_support,
                machine_name,
                source_system,
                synced_at,
                is_active
            )
            SELECT
                t.eol_product,
                t.eol_product_version,
                t.eol_end_of_life,
                t.eol_end_of_support,
                t.eol_end_of_extended_support,
                NULL,
                'databricks',
                CURRENT_TIMESTAMP,
                TRUE
            FROM tmp_eol_dates t
            ON CONFLICT (eol_product, eol_product_version, COALESCE(machine_name, '')) DO UPDATE SET
                eol_end_of_life = EXCLUDED.eol_end_of_life,
                eol_end_of_support = EXCLUDED.eol_end_of_support,
                eol_end_of_extended_support = EXCLUDED.eol_end_of_extended_support,
                synced_at = CURRENT_TIMESTAMP,
                is_active = TRUE
            RETURNING (xmax = 0) AS is_insert
        """)
        rows = cur.fetchall()
        ctx.stats.inserted, ctx.stats.updated = count_upsert_results(rows)

        # Propagate extended support dates from service pack rows to base version rows.
        # E.g. mssqlserver 11.0-sp4 has end_of_extended=2025-07-08 → copy to 11.0 if NULL.
        # Also propagates end_of_support using the same logic.
        cur.execute("""
            UPDATE eol.end_of_life_software base SET
                eol_end_of_extended_support = family.max_extended,
                eol_end_of_support = COALESCE(base.eol_end_of_support, family.max_support),
                updated_at = CURRENT_TIMESTAMP
            FROM (
                SELECT
                    eol_product,
                    SPLIT_PART(eol_product_version, '-', 1) AS base_version,
                    MAX(eol_end_of_extended_support) AS max_extended,
                    MAX(eol_end_of_support) AS max_support
                FROM tmp_eol_dates
                WHERE eol_end_of_extended_support IS NOT NULL
                   OR eol_end_of_support IS NOT NULL
                GROUP BY eol_product, SPLIT_PART(eol_product_version, '-', 1)
            ) family
            WHERE base.eol_product = family.eol_product
              AND base.eol_product_version = family.base_version
              AND base.machine_name IS NULL
              AND base.is_active = TRUE
              AND base.eol_end_of_extended_support IS NULL
        """)
        extended_propagated = cur.rowcount
        if extended_propagated > 0:
            logger.info("Propagated extended support dates to %d base version rows", extended_propagated)

        # Deactivate product-level records no longer in source
        cur.execute("""
            UPDATE eol.end_of_life_software SET
                is_active = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE source_system = 'databricks'
              AND machine_name IS NULL
              AND is_active = TRUE
              AND (eol_product, eol_product_version) NOT IN (
                  SELECT eol_product, eol_product_version FROM tmp_eol_dates
              )
        """)
        ctx.stats.deactivated = cur.rowcount

        if not ctx.dry_run:
            ctx.conn.commit()

        logger.info(
            "Synced %d EOL date records, inserted %d, updated %d, deactivated %d",
            ctx.stats.processed, ctx.stats.inserted, ctx.stats.updated, ctx.stats.deactivated
        )


def main():
    parser = create_argument_parser("Sync EOL lifecycle dates from Databricks to PostgreSQL")
    parser.add_argument(
        '--source', choices=['databricks', 'jobs'], default='jobs',
        help='Data source: databricks (SQL API) or jobs (Jobs API run output)'
    )
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    with SyncContext("databricks_eol_dates", "Databricks EOL Dates Sync", dry_run=args.dry_run) as ctx:
        ctx.check_circuit_breaker()
        if args.source == 'jobs':
            records = get_job_run_output()
        else:
            records = query_databricks(EOL_DATES_QUERY)
        sync_eol_dates(ctx, records)


if __name__ == "__main__":
    main()

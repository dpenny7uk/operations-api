#!/usr/bin/env python3
"""Sync servers from Databricks master_server_list to PostgreSQL."""

import os
import sys
from psycopg2.extras import execute_values

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (
    setup_logging, create_argument_parser,
    configure_verbosity, SyncContext, query_databricks,
    read_dbfs_csv, get_job_run_output, count_upsert_results
)

logger = setup_logging('sync_server_list')

SERVER_QUERY = "SELECT * FROM gold.master_server_list WHERE is_active = true"

ENV_PREFIX_MAP = {
    'pr': 'Production',
    'dv': 'Development',
    'sy': 'Systest',
    'ut': 'UAT',
    'st': 'Staging',
    'tr': 'Training',
    'ls': 'Live Support',
    'ss': 'Shared Services',
    'pc': 'Proof of Concept',
    'ci': 'Continuous Integration',
}


def derive_environment(server_name: str, raw_env: str | None) -> str | None:
    """Derive environment from server name prefix if not provided by source."""
    if raw_env and raw_env.strip():
        return raw_env.strip()[:50]
    prefix = server_name[:2].lower() if len(server_name) >= 2 else ''
    return ENV_PREFIX_MAP.get(prefix)


BU_CANONICAL_MAP = {
    'uk': 'Hiscox UK',
    'hiscox uk': 'Hiscox UK',
    'uk&i': 'UK & I',
    'us': 'Hiscox US',
    'hiscox us': 'Hiscox US',
    'europe': 'Hiscox Europe',
    'hiscox europe': 'Hiscox Europe',
    'london_market': 'Hiscox London Market',
    'hiscox london market': 'Hiscox London Market',
    'hiscox_re': 'Hiscox Re & ILS',
    'hiscox re and ils': 'Hiscox Re & ILS',
    'group': 'Hiscox Group Support',
    'hiscox group support': 'Hiscox Group Support',
    'hiscox special risks': 'Hiscox Special Risks',
    'it_services': 'ITS',
    'infosec': 'Infosec',
    'no bu found': 'Unknown',
}


def derive_business_unit(raw_bu: str | None) -> str:
    """Normalise a raw business_unit value to its canonical display form.
    Unknown values return 'Unknown' and log a warning so ops can spot new BUs."""
    if not raw_bu or not str(raw_bu).strip():
        return 'Unknown'
    key = str(raw_bu).strip().lower()
    if key in BU_CANONICAL_MAP:
        return BU_CANONICAL_MAP[key]
    logger.warning("Unknown business_unit value: %r — mapping to 'Unknown'", raw_bu)
    return 'Unknown'


def sync_servers(ctx, servers: list):
    """Sync servers to PostgreSQL using temp table + upsert pattern."""
    if not servers:
        logger.warning("No servers to sync")
        return

    with ctx.conn.cursor() as cur:
        # Create temp table for bulk load
        cur.execute("""
            CREATE TEMP TABLE tmp_servers (
                server_name VARCHAR(255),
                fqdn VARCHAR(500),
                ip_address VARCHAR(50),
                operating_system VARCHAR(255),
                environment VARCHAR(50),
                location VARCHAR(100),
                business_unit VARCHAR(100),
                combined_service VARCHAR(255),
                primary_contact VARCHAR(255),
                patch_group VARCHAR(100),
                cmdb_id VARCHAR(100)
            ) ON COMMIT DROP
        """)

        # Bulk insert to temp table
        values = []
        for s in servers:
            if not s.get('server_name'):
                continue
            values.append((
                (s.get('server_name') or '')[:255],
                (s.get('fqdn') or '').strip()[:500] or None,
                (s.get('ip_address') or '').strip()[:50] or None,
                (s.get('operating_system') or '').strip()[:255] or None,
                derive_environment(s.get('server_name', ''), s.get('environment')),
                (s.get('location') or '').strip()[:100] or None,
                derive_business_unit(s.get('business_unit')),
                (s.get('combined_service') or '').strip()[:255] or None,
                (s.get('primary_contact') or '').strip()[:255] or None,
                (s.get('patch_group') or '').strip()[:100] or None,
                (s.get('cmdb_id') or '').strip()[:100] or None
            ))
        
        if not values:
            raise RuntimeError(
                "Databricks returned 0 servers — aborting sync to prevent mass deactivation. "
                "Verify the Databricks query and connection before retrying."
            )

        # Absolute floor — catches partial Databricks exports even on first deploy
        # when the 50% churn guard cannot apply (existing_count == 0).
        min_servers = max(int(os.environ.get('DATABRICKS_MIN_SERVERS', '50')), 10)
        if len(values) < min_servers:
            raise RuntimeError(
                f"Databricks returned only {len(values)} servers (minimum: {min_servers}). "
                "This looks like a partial or failed export. "
                "Set DATABRICKS_MIN_SERVERS env var to override if intentional."
            )

        execute_values(cur, "INSERT INTO tmp_servers VALUES %s", values)
        ctx.stats.processed = len(values)

        # Safety check: abort if incoming count is less than 50% of current active count,
        # which indicates a partial or failed Databricks result rather than legitimate churn.
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM shared.servers "
            "WHERE source_system = 'databricks' AND is_active = TRUE"
        )
        existing_count = cur.fetchone()['cnt']
        churn_pct = (len(values) / existing_count * 100) if existing_count > 0 else 0
        logger.info(
            "Churn guard: incoming=%d active_baseline=%d ratio=%.0f%%",
            len(values), existing_count, churn_pct
        )
        if existing_count == 0:
            logger.warning(
                "First deploy detected (0 existing servers) — "
                "50%% churn guard not applicable, using minimum threshold only (%d servers)",
                min_servers
            )
        if existing_count > 0 and len(values) < existing_count * 0.5:
            raise RuntimeError(
                f"Databricks returned {len(values)} servers but {existing_count} are currently active "
                f"({len(values) / existing_count:.0%} of baseline, threshold is 50%). "
                "Aborting sync to prevent mass deactivation — investigate the Databricks source."
            )

        # Upsert applications (create if not exists)
        cur.execute("""
            INSERT INTO shared.applications (application_name, source_system, synced_at)
            SELECT DISTINCT combined_service, 'databricks', CURRENT_TIMESTAMP
            FROM tmp_servers
            WHERE combined_service IS NOT NULL AND combined_service != ''
            ON CONFLICT (application_name) DO UPDATE SET synced_at = CURRENT_TIMESTAMP
        """)

        # Upsert servers
        cur.execute("""
            INSERT INTO shared.servers (
                server_name, fqdn, ip_address, operating_system, environment,
                location, business_unit, primary_application_id, primary_contact,
                patch_group, cmdb_id, source_system, synced_at, is_active
            )
            SELECT 
                t.server_name, t.fqdn, t.ip_address, t.operating_system, t.environment,
                t.location, t.business_unit, a.application_id, t.primary_contact,
                t.patch_group, t.cmdb_id, 'databricks', CURRENT_TIMESTAMP, TRUE
            FROM tmp_servers t
            LEFT JOIN shared.applications a ON a.application_name = t.combined_service
            ON CONFLICT (server_name) DO UPDATE SET
                fqdn = EXCLUDED.fqdn,
                ip_address = EXCLUDED.ip_address,
                operating_system = EXCLUDED.operating_system,
                environment = EXCLUDED.environment,
                location = EXCLUDED.location,
                business_unit = EXCLUDED.business_unit,
                primary_application_id = EXCLUDED.primary_application_id,
                primary_contact = EXCLUDED.primary_contact,
                patch_group = EXCLUDED.patch_group,
                cmdb_id = EXCLUDED.cmdb_id,
                synced_at = CURRENT_TIMESTAMP,
                is_active = TRUE
            RETURNING (xmax = 0) AS is_insert
        """)
        rows = cur.fetchall()
        ctx.stats.inserted, ctx.stats.updated = count_upsert_results(rows)

        # Deactivate servers missing from source for 2+ consecutive syncs.
        # Grace period: only deactivate if synced_at is >24h old (i.e. already
        # missing from the previous run). Prevents a single bad sync from
        # mass-deactivating servers.
        cur.execute("""
            UPDATE shared.servers SET
                is_active = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE source_system = 'databricks'
              AND is_active = TRUE
              AND server_name NOT IN (SELECT server_name FROM tmp_servers)
              AND synced_at < NOW() - INTERVAL '24 hours'
        """)
        ctx.stats.deactivated = cur.rowcount
        # Log servers that are missing but within the grace period
        cur.execute("""
            SELECT COUNT(*) AS cnt FROM shared.servers
            WHERE source_system = 'databricks'
              AND is_active = TRUE
              AND server_name NOT IN (SELECT server_name FROM tmp_servers)
              AND synced_at >= NOW() - INTERVAL '24 hours'
        """)
        grace_count = cur.fetchone()['cnt']
        if grace_count > 0:
            logger.info(
                "Grace period: %d server(s) missing from source but within 24h window — will deactivate on next sync if still absent",
                grace_count
            )

        if not ctx.dry_run:
            ctx.conn.commit()

        logger.info(f"Synced {ctx.stats.processed} servers, deactivated {ctx.stats.deactivated}")


def main():
    parser = create_argument_parser("Sync servers from Databricks to PostgreSQL")
    parser.add_argument(
        '--source', choices=['databricks', 'dbfs', 'jobs'], default='databricks',
        help='Data source: databricks (SQL API), dbfs (pre-exported CSV), or jobs (Jobs API run output)'
    )
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    with SyncContext("databricks_servers", "Databricks Server Sync", dry_run=args.dry_run) as ctx:
        ctx.check_circuit_breaker()
        if args.source == 'jobs':
            servers = get_job_run_output()
        elif args.source == 'dbfs':
            servers = read_dbfs_csv('/operations/server_list')
        else:
            servers = query_databricks(SERVER_QUERY, env_var_override='DATABRICKS_QUERY')
        sync_servers(ctx, servers)


if __name__ == "__main__":
    main()

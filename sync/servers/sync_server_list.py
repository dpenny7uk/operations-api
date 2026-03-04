#!/usr/bin/env python3
"""Sync servers from Databricks master_server_list to PostgreSQL."""

import os
import sys
import requests
from psycopg2.extras import execute_values

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (
    setup_logging, validate_env_vars, create_argument_parser,
    configure_verbosity, SyncContext
)

logger = setup_logging('sync_server_list')


def fetch_from_databricks(ctx) -> list:
    """Fetch server list from Databricks SQL endpoint."""
    validate_env_vars(['DATABRICKS_HOST', 'DATABRICKS_TOKEN', 'DATABRICKS_WAREHOUSE_ID'])
    
    url = f"https://{os.environ['DATABRICKS_HOST']}/api/2.0/sql/statements"
    headers = {
        "Authorization": f"Bearer {os.environ['DATABRICKS_TOKEN']}",
        "Content-Type": "application/json"
    }
    query = os.environ.get(
        'DATABRICKS_QUERY',
        "SELECT * FROM gold.master_server_list WHERE is_active = true"
    )

    response = requests.post(
        url,
        headers=headers,
        json={
            "warehouse_id": os.environ['DATABRICKS_WAREHOUSE_ID'],
            "statement": query,
            "wait_timeout": "120s"
        },
        timeout=180
    )
    response.raise_for_status()
    result = response.json()

    # Check for query errors
    state = result.get('status', {}).get('state')
    if state != 'SUCCEEDED':
        error_msg = result.get('status', {}).get('error', {}).get('message', 'Unknown error')
        raise Exception(f"Databricks query failed: {error_msg}")

    # Parse results into list of dicts
    columns = [
        col['name'].lower()
        for col in result.get('manifest', {}).get('schema', {}).get('columns', [])
    ]
    
    rows = []
    for chunk in result.get('result', {}).get('data_array', []):
        rows.append(dict(zip(columns, chunk)))
    
    logger.info(f"Fetched {len(rows)} servers from Databricks")
    return rows


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
                s.get('server_name', '')[:255],
                s.get('fqdn', '')[:500],
                s.get('ip_address', '')[:50],
                s.get('operating_system', '')[:255],
                s.get('environment', '')[:50],
                s.get('location', '')[:100],
                s.get('business_unit', '')[:100],
                s.get('combined_service', '')[:255],
                s.get('primary_contact', '')[:255],
                s.get('patch_group', '')[:100],
                s.get('cmdb_id', '')[:100]
            ))
        
        execute_values(cur, "INSERT INTO tmp_servers VALUES %s", values)
        ctx.stats.processed = len(values)

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
        """)
        ctx.stats.updated = cur.rowcount

        # Deactivate servers no longer in source
        cur.execute("""
            UPDATE shared.servers SET
                is_active = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE source_system = 'databricks'
              AND is_active = TRUE
              AND server_name NOT IN (SELECT server_name FROM tmp_servers)
        """)
        ctx.stats.deactivated = cur.rowcount

        if not ctx.dry_run:
            ctx.conn.commit()

        logger.info(f"Synced {ctx.stats.processed} servers, deactivated {ctx.stats.deactivated}")


def main():
    parser = create_argument_parser("Sync servers from Databricks to PostgreSQL")
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    with SyncContext("databricks_servers", "Databricks Server Sync", dry_run=args.dry_run) as ctx:
        servers = fetch_from_databricks(ctx)
        sync_servers(ctx, servers)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Process Ivanti patching schedule from Excel/CSV to PostgreSQL."""

import os
import sys
import re
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (
    setup_logging, create_argument_parser, configure_verbosity, SyncContext
)

logger = setup_logging('process_patching')

# Column name mappings (Ivanti export -> our schema)
COLUMN_MAP = {
    'server': 'server_name',
    'servername': 'server_name',
    'name': 'server_name',
    'machine': 'server_name',
    'application': 'app',
    'app': 'app',
    'service': 'service',
    'domain': 'domain',
    'patchgroup': 'patch_group',
    'patch_group': 'patch_group',
    'group': 'patch_group',
    'supportteam': 'support_team',
    'support_team': 'support_team',
    'team': 'support_team',
    'businessunit': 'business_unit',
    'business_unit': 'business_unit',
    'bu': 'business_unit',
    'contact': 'contact',
    'owner': 'contact',
    'resourcegroup': 'resource_group',
    'location': 'location',
    'environment': 'environment',
    'env': 'environment',
    'subscription': 'subscription',
    'powerstate': 'power_state',
    'os': 'os'
}


def parse_cycle_date(filename: str) -> datetime:
    """Extract patch date from filename."""
    patterns = [
        (r'(\d{4}-\d{2}-\d{2})', '%Y-%m-%d'),
        (r'(\d{2}-\d{2}-\d{4})', '%d-%m-%Y'),
        (r'(\d{8})', '%Y%m%d')
    ]
    
    for pattern, date_format in patterns:
        match = re.search(pattern, filename)
        if match:
            try:
                return datetime.strptime(match.group(1), date_format)
            except ValueError:
                continue
    
    raise ValueError(f"Cannot parse date from filename: {filename}")


def read_schedule_file(filepath: Path) -> tuple:
    """Read Excel or CSV file, return (onprem_servers, azure_servers)."""
    import pandas as pd
    
    suffix = filepath.suffix.lower()
    
    if suffix in ('.xlsx', '.xls'):
        xlsx = pd.ExcelFile(filepath)
        sheet_names = xlsx.sheet_names
        
        # First sheet = on-prem, second sheet = Azure
        onprem = pd.read_excel(xlsx, sheet_name=0).to_dict('records') if len(sheet_names) > 0 else []
        azure = pd.read_excel(xlsx, sheet_name=1).to_dict('records') if len(sheet_names) > 1 else []
        
    elif suffix == '.csv':
        onprem = pd.read_csv(filepath).to_dict('records')
        azure = []
        
    else:
        raise ValueError(f"Unsupported file type: {suffix}")
    
    return onprem, azure


def normalize_column(name: str) -> str:
    """Normalize column name to snake_case."""
    return re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')


def process_servers(ctx, cycle_id: int, servers: list, server_type: str):
    """Process server list into patch_schedule table."""
    with ctx.conn.cursor() as cur:
        for server in servers:
            # Normalize column names
            normalized = {}
            for key, value in server.items():
                norm_key = normalize_column(str(key))
                mapped_key = COLUMN_MAP.get(norm_key)
                
                if mapped_key:
                    # Clean value
                    str_val = str(value) if value else ''
                    if str_val.lower() in ('nan', 'none', ''):
                        normalized[mapped_key] = None
                    else:
                        normalized[mapped_key] = str_val[:255]
            
            # Skip if no server name
            if not normalized.get('server_name'):
                continue
            
            ctx.stats.processed += 1
            server_name = normalized['server_name']
            
            # Try to resolve server_id
            cur.execute(
                "SELECT server_id FROM system.resolve_server_name(%s) LIMIT 1",
                (server_name,)
            )
            row = cur.fetchone()
            server_id = row['server_id'] if row else None
            
            if not server_id:
                ctx.stats.unmatched += 1
                cur.execute(
                    "SELECT system.record_unmatched_server(%s, 'ivanti', %s)",
                    (server_name, str(cycle_id))
                )
            
            # Insert/update schedule
            try:
                cur.execute("""
                    INSERT INTO patching.patch_schedule (
                        cycle_id, server_name, server_type, server_id,
                        domain, app, service, support_team, business_unit,
                        contact, patch_group, resource_group, location,
                        environment, power_state, subscription, os
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (cycle_id, server_name, server_type) DO UPDATE SET
                        server_id = EXCLUDED.server_id,
                        app = EXCLUDED.app,
                        service = EXCLUDED.service,
                        patch_group = EXCLUDED.patch_group
                """, (
                    cycle_id,
                    server_name,
                    server_type,
                    server_id,
                    normalized.get('domain'),
                    normalized.get('app'),
                    normalized.get('service'),
                    normalized.get('support_team'),
                    normalized.get('business_unit'),
                    normalized.get('contact'),
                    normalized.get('patch_group'),
                    normalized.get('resource_group'),
                    normalized.get('location'),
                    normalized.get('environment'),
                    normalized.get('power_state'),
                    normalized.get('subscription'),
                    normalized.get('os')
                ))
                ctx.stats.inserted += 1
                
            except Exception as e:
                ctx.stats.add_error(f"Failed {server_name}: {e}")


def main():
    parser = create_argument_parser("Process Ivanti patching schedule")
    parser.add_argument('file', help='Excel or CSV file path')
    parser.add_argument('--date', help='Override cycle date (YYYY-MM-DD)')
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    filepath = Path(args.file)
    if not filepath.exists():
        logger.error(f"File not found: {filepath}")
        sys.exit(1)

    # Parse cycle date from filename or argument
    if args.date:
        cycle_date = datetime.strptime(args.date, '%Y-%m-%d')
    else:
        cycle_date = parse_cycle_date(filepath.name)

    with SyncContext("ivanti_patching", "Ivanti Patching Schedule", dry_run=args.dry_run) as ctx:
        # Create or get patch cycle
        with ctx.conn.cursor() as cur:
            cur.execute("""
                INSERT INTO patching.patch_cycles (cycle_date, file_name)
                VALUES (%s, %s)
                ON CONFLICT (cycle_date) DO UPDATE SET
                    file_name = EXCLUDED.file_name,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING cycle_id
            """, (cycle_date.date(), filepath.name))
            cycle_id = cur.fetchone()['cycle_id']
            
            # Clear existing schedule for this cycle
            cur.execute(
                "DELETE FROM patching.patch_schedule WHERE cycle_id = %s",
                (cycle_id,)
            )

        # Read and process file
        onprem, azure = read_schedule_file(filepath)
        logger.info(f"Processing {len(onprem)} on-prem, {len(azure)} Azure servers for {cycle_date.date()}")

        process_servers(ctx, cycle_id, onprem, 'onprem')
        process_servers(ctx, cycle_id, azure, 'azure')

        # Update cycle counts
        with ctx.conn.cursor() as cur:
            cur.execute("""
                UPDATE patching.patch_cycles SET
                    servers_onprem = %s,
                    servers_azure = %s
                WHERE cycle_id = %s
            """, (len(onprem), len(azure), cycle_id))

        if not ctx.dry_run:
            ctx.conn.commit()


if __name__ == "__main__":
    main()

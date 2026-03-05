# Operations API - Sync Scripts

Data sync scripts for the GES Operations Platform. These scripts pull data from Databricks and PowerShell certificate scans into the Operations API PostgreSQL database.

## Scripts

| Script | Source | Schedule | Sync Name |
|--------|--------|----------|-----------|
| `sync_server_list.py` | Databricks `gold.master_server_list` | Daily 05:00 | `databricks_servers` |
| `sync_eol_software.py` | Databricks `gold_asset_inventory.end_of_life_software` | Daily 05:30 | `databricks_eol` |
| `sync_certificates.py` | PowerShell CSV from `Get-SSLCertificateExpiry.ps1` | Daily 06:00 | `certificate_scan` |

## Setup

### 1. Install Python dependencies

```bash
cd operations-api/scripts
pip install -r requirements.txt
```

### 2. Configure environment variables

Set these as system variables on the server, or in the `operations-sync-secrets` Azure DevOps variable group:

**Database (required for all scripts):**
- `OPS_DB_HOST` - PostgreSQL host (e.g. `localhost`)
- `OPS_DB_PORT` - PostgreSQL port (default: `5432`)
- `OPS_DB_NAME` - Database name (e.g. `ops_platform`)
- `OPS_DB_USER` - Database user (e.g. `ops_sync`)
- `OPS_DB_PASSWORD` - Database password

**Databricks (required for server and EOL syncs):**
- `DATABRICKS_HOST` - Workspace URL (e.g. `your-workspace.azuredatabricks.net`)
- `DATABRICKS_TOKEN` - Personal access token
- `DATABRICKS_WAREHOUSE_ID` - SQL warehouse ID

### 3. Test with dry run

```bash
python sync_server_list.py --dry-run --verbose
python sync_eol_software.py --dry-run --verbose
python sync_certificates.py --csv "path/to/SSL-CertExpiry-*.csv" --dry-run --verbose
```

## Azure DevOps Pipelines

Pipeline YAML files are in the `pipelines/` folder at the repo root:

- `ops-sync-servers.yml` - Uses shared template
- `ops-sync-eol.yml` - Uses shared template
- `ops-sync-certificates.yml` - Runs PowerShell scan then Python sync

All pipelines use the `operations-sync-secrets` variable group and run on the `Default` self-hosted agent pool.

## Architecture

```
Databricks ──[SQL API]──> sync_server_list.py ──> shared.servers
Databricks ──[SQL API]──> sync_eol_software.py ──> eol.end_of_life_software
PowerShell ──[CSV file]──> sync_certificates.py ──> certificates.inventory
                                                 ──> system.scan_failures (unreachable servers)
```

Each script:
1. Fetches data from the source
2. Bulk loads into a temp table
3. Upserts into the target table (ON CONFLICT DO UPDATE)
4. Deactivates records no longer present in the source
5. Tracks sync history in `system.sync_history`

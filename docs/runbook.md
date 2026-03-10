# Operations API — Production Runbook

**Version:** 1.0
**Last Updated:** 2026-03-08
**Audience:** Operations Engineers, DevOps Engineers, On-Call Engineers
**Scope:** Production environment — Operations API platform

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Daily Scheduled Operations](#3-daily-scheduled-operations)
4. [Deployment Procedure](#4-deployment-procedure)
5. [Rollback Procedure](#5-rollback-procedure)
6. [Backup & Restore Reference](#6-backup--restore-reference)
7. [Monitoring & Alerting](#7-monitoring--alerting)
8. [Circuit Breaker](#8-circuit-breaker)
9. [Incident Response Playbooks](#9-incident-response-playbooks)
10. [Common Operational Queries](#10-common-operational-queries)
11. [Environment Variables Reference](#11-environment-variables-reference)
12. [Pipeline Reference](#12-pipeline-reference)
13. [Access & Permissions](#13-access--permissions)

---

## 1. Overview

### Purpose

The Operations API is an internal platform that centralises server inventory, patching schedules, SSL/TLS certificate monitoring, and end-of-life software tracking. It provides a REST API and web frontend consumed by the Operations and Security teams, and is the authoritative source for server health data used during monthly patch cycles.

### Tech Stack

| Component | Technology |
|-----------|-----------|
| API | .NET 10, IIS on Windows Server |
| Database | PostgreSQL 16 |
| Data sync | Python 3.13 (scheduled via Azure DevOps) |
| Frontend | Static HTML/CSS/JS served from IIS |
| Alerting | Microsoft Teams (incoming webhooks) |
| CI/CD | Azure DevOps Pipelines |
| Source data | Databricks (server list, EOL data), Confluence (known issues), internal HTML page (patching schedule) |

### Key Paths & URLs

| Item | Value |
|------|-------|
| IIS site name | `OperationsApi` |
| IIS app pool | `OperationsApi` |
| Application files | `C:\inetpub\operations-api` |
| Application file backups | `C:\inetpub\operations-api.backup.<timestamp>` |
| Database dump backups | `C:\backups\ops-api-db\ops-api-db-<timestamp>.dump` |
| Health endpoint | `http://localhost/healthz` (internal) |
| API health | `GET /api/health` |
| Sync health | `GET /api/health/syncs` |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     AZURE DEVOPS                                 │
│  ops-api-build ──► ops-api-deploy ──► ops-api-rollback          │
│  ops-sync-* (scheduled daily) ──► ops-health-alert              │
└────────────────────────┬────────────────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │   IIS (Windows)     │
              │   OperationsApi     │
              │   .NET 10 API       │
              │   Static Frontend   │
              └──────────┬──────────┘
                         │ psycopg2 / ADO.NET
              ┌──────────▼──────────┐
              │   PostgreSQL 16     │
              │   ops_platform DB   │
              │                     │
              │  shared.*           │  ◄── Server inventory
              │  certificates.*     │  ◄── TLS certificate data
              │  patching.*         │  ◄── Patch schedules & issues
              │  eol.*              │  ◄── EOL software data
              │  system.*           │  ◄── Health, sync tracking
              └─────────────────────┘
                         ▲
         ┌───────────────┼───────────────────────┐
         │               │                       │
┌────────┴───────┐ ┌─────┴──────────┐ ┌─────────┴────────┐
│   Databricks   │ │  Confluence    │ │  Patching HTML   │
│  master_server │ │  Known Issues  │ │  Schedule page   │
│  EOL software  │ │  parent page   │ │  (Shavlik/HTML)  │
└────────────────┘ └────────────────┘ └──────────────────┘
         ▲
┌────────┴───────┐
│  Certificate   │
│  scan targets  │
│ (servers.txt + │
│  endpoints.csv)│
└────────────────┘
```

### Data Flow

1. **Server list:** Databricks `gold.master_server_list` → `sync_server_list.py` → `shared.servers`
2. **EOL data:** Databricks `gold_asset_inventory.end_of_life_software` → `sync_eol_software.py` → `eol.end_of_life_software`
3. **Certificates:** PowerShell TLS scan → CSV → `sync_certificates.py` → `certificates.inventory`
4. **Patching schedule:** Internal HTML page → `sync_patching_schedule.py` → `patching.patch_schedule`
5. **Known issues:** Confluence REST API → `sync_confluence_issues.py` → `patching.known_issues`
6. **Frontend/API consumers:** `GET /api/*` — reads from PostgreSQL, served via IIS

### External Dependencies

| Dependency | Used By | Failure Impact |
|-----------|---------|----------------|
| Databricks | Server sync, EOL sync | Server list goes stale after 2h (circuit breaker opens) |
| Confluence | Issues sync | Known issues go stale; patching view loses issue links |
| Patching schedule HTML | Patching sync | Schedule data stale for that patch cycle |
| Certificate scan targets | Cert sync | Cert data stale; expiry alerts may not fire |
| Teams webhook | All alerts | Alerts silently fail; no on-call notification |

---

## 3. Daily Scheduled Operations

All times are UTC. Pipelines are defined in Azure DevOps and triggered on a cron schedule.

| UTC Time | Pipeline | Script | Purpose | Success Criteria |
|----------|----------|--------|---------|-----------------|
| 04:00 | `ops-sync-confluence` | `sync/confluence/sync_confluence_issues.py` | Sync known patching issues from Confluence | `sync_history` row with `status = 'success'`; `patching.known_issues` updated |
| 05:00 | `ops-sync-servers` | `sync/servers/sync_server_list.py` | Sync server inventory from Databricks | >0 servers processed; no safety-check abort |
| 05:30 | `ops-sync-eol` | `sync/eol/sync_eol_software.py` | Sync EOL software metadata from Databricks | `eol.end_of_life_software` rows updated |
| 06:00 | `ops-sync-certificates` | PowerShell scan → `sync/certificates/sync_certificates.py` → `alert_cert_expiry.py` | Scan servers for TLS certs; alert on expiring certs | CSV produced; certs upserted; Teams alert if certs critical |
| 06:30 | `ops-sync-patching-schedule` | `sync/patching/sync_patching_schedule.py` | Sync patching schedule from HTML page | `patching.patch_schedule` rows updated for current cycle |
| 07:00 | `ops-alert-unmatched` | `sync/alerts/alert_unmatched_spike.py` | Alert if ≥5 new unmatched servers in last 25h | Teams card posted if threshold exceeded |
| 08:00 | `ops-health-alert` | `sync/alerts/sync_health_alert.py` | Check health of all syncs; alert if degraded | Teams card posted if any sync is error/stale/warning |

### Checking Whether Today's Syncs Ran Successfully

```sql
SELECT
    sync_name,
    status,
    started_at,
    completed_at,
    processed,
    inserted,
    updated,
    failed,
    error_message
FROM system.sync_history
WHERE started_at >= CURRENT_DATE
ORDER BY started_at DESC;
```

---

## 4. Deployment Procedure

### Prerequisites

Before triggering a deployment:

- [ ] Build pipeline has completed successfully for the target commit
- [ ] All tests passing in `ops-run-tests` pipeline
- [ ] Change has been reviewed and approved
- [ ] Deployment window agreed with the team (avoid during 04:00–09:00 UTC sync window)
- [ ] You have approval rights on the `operations-api-prod` Azure DevOps environment

### Step-by-Step

#### Step 1 — Trigger the build pipeline

1. In Azure DevOps, navigate to **Pipelines → ops-api-build**
2. Confirm the latest run completed successfully (green)
3. Note the **Run ID** from the URL (you may need it for Step 3 if deploying a specific build)

#### Step 2 — Trigger the deploy pipeline

1. Navigate to **Pipelines → ops-api-deploy**
2. Click **Run pipeline**
3. (Optional) Enter the `buildPipelineRunId` if deploying a specific build rather than latest
4. Click **Run**
5. When the approval gate appears, verify the correct build is being deployed and **Approve**

#### Step 3 — What the pipeline does (automatically)

The pipeline executes the following steps in order:

| Step | Action | Abort on failure? |
|------|--------|-------------------|
| Download artifact | Downloads build output from ops-api-build | Yes |
| **Database backup** | `pg_dump` → `C:\backups\ops-api-db\ops-api-db-<timestamp>.dump` | **Yes — migration will NOT run without a backup** |
| Run migrations | Executes `database/*.sql` scripts in order via `psql` | Yes |
| Stop IIS app pool | Stops `OperationsApi` app pool (waits up to 30s) | No (warns and continues) |
| Backup current deployment | Copies `C:\inetpub\operations-api` → `…operations-api.backup.<timestamp>` | No |
| Deploy API files | Copies new binaries to `C:\inetpub\operations-api` | Yes |
| Write appsettings | Writes `appsettings.Production.json` from pipeline variables | Yes |
| Deploy frontend | Copies static files to `wwwroot\` | No (warns if missing) |
| Start IIS app pool | Starts `OperationsApi` | Yes |
| Health check | Polls `http://localhost/healthz` up to 3 times (10s apart) | Yes |

#### Step 4 — Verify deployment

1. Confirm the pipeline completed with all steps green
2. Note the **DB dump path** from the "Database backup" step log — save this for rollback:
   ```
   DB dump written to: C:\backups\ops-api-db\ops-api-db-20260308-142300.dump
   ```
3. Browse to the health endpoint and confirm `Healthy`:
   ```
   GET http://localhost/healthz
   → {"status":"Healthy"}
   ```
4. Check the API health summary:
   ```
   GET /api/health
   ```
5. Run the post-deployment SQL check:

```sql
-- Confirm migrations applied
SELECT script_name, applied_at, applied_by
FROM system.schema_migrations
ORDER BY applied_at DESC
LIMIT 10;

-- Confirm sync history table exists and is writable
SELECT COUNT(*) FROM system.sync_history;
```

#### Step 5 — Post-deployment monitoring

After the 08:00 UTC health alert pipeline runs, check Teams for any sync degradation alerts. If all syncs show green in the Teams card, deployment is confirmed healthy.

---

## 5. Rollback Procedure

### When to Rollback

Trigger a rollback if any of the following occur after deployment:

- Health check endpoint returns non-200 and cannot be recovered within 15 minutes
- API returns 5xx errors for more than 5 minutes
- A database migration introduced a breaking schema change
- Data corruption is observed in key tables
- The business requests an immediate revert

### Decision Tree

```
Was a database migration included in this deployment?
│
├── YES ──► Was data written to the new schema after deployment?
│          │
│          ├── NO  ──► Use OPTION A (full DB + file rollback)
│          │
│          └── YES ──► STOP. Assess data loss impact before proceeding.
│                      Contact DBA. Consider Option B + manual data fix.
│
└── NO  ──► Use OPTION B (file rollback only)
```

### Option A — Full Rollback (Recommended when migration was included)

**Uses:** `pg_restore` from the pre-migration dump + file backup restore

1. Locate the DB dump file path from the deploy pipeline log:
   ```
   DB dump written to: C:\backups\ops-api-db\ops-api-db-20260308-142300.dump
   ```
2. Navigate to **Pipelines → ops-api-rollback**
3. Click **Run pipeline** and set:
   - `backupTimestamp`: timestamp of the file backup to restore (e.g. `20260308-142300`), or leave empty for latest
   - `dbDumpFile`: full path to the dump file (e.g. `C:\backups\ops-api-db\ops-api-db-20260308-142300.dump`)
4. Approve the environment gate
5. The pipeline will:
   - Restore the database from the dump (`pg_restore`) before stopping IIS
   - Stop IIS
   - Restore application files from the file backup
   - Regenerate `appsettings.Production.json`
   - Start IIS
   - Run health check
6. Verify ([see Post-Rollback Verification](#post-rollback-verification))

### Option B — File-Only Rollback (No migration, or data written post-deploy)

**Uses:** File backup restore only. Database must be manually reverted afterwards.

1. Navigate to **Pipelines → ops-api-rollback**
2. Click **Run pipeline** and set:
   - `backupTimestamp`: timestamp to restore, or leave empty for latest
   - `dbDumpFile`: **leave empty**
3. Approve the environment gate
4. Pipeline restores application files and regenerates config
5. **Manually revert the database** — apply rollback scripts in reverse order:

```bash
# Connect to the database
psql -h <OPS_DB_HOST> -p <OPS_DB_PORT> -d ops_platform -U ops_migrate

# Apply rollback scripts in REVERSE order (newest first)
\i database/rollback/007-migration-tracking.sql
\i database/rollback/006-eol-schema.sql
# ... continue for each migration that was in this deployment
```

Then update the migration tracking table:

```sql
UPDATE system.schema_migrations
SET rolled_back_at = CURRENT_TIMESTAMP,
    rolled_back_by = CURRENT_USER
WHERE script_name IN (
    '007-migration-tracking.sql',
    '006-eol-schema.sql'
    -- add all scripts from this deployment
);
```

### Post-Rollback Verification

1. Confirm health endpoint returns `Healthy`:
   ```
   GET http://localhost/healthz
   ```
2. Confirm migration state matches expected:
   ```sql
   SELECT script_name, applied_at, rolled_back_at
   FROM system.schema_migrations
   ORDER BY script_name;
   ```
3. Confirm sync history is writable (trigger one sync manually if needed):
   ```sql
   SELECT COUNT(*) FROM system.sync_history WHERE status = 'success';
   ```
4. Notify stakeholders that rollback is complete and state the cause.

---

## 6. Backup & Restore Reference

### Application File Backups

| Item | Detail |
|------|--------|
| Location | `C:\inetpub\operations-api.backup.<yyyyMMdd-HHmmss>` |
| Created by | Deploy pipeline ("Backup current deployment" step) |
| Retention | Last **3** backups kept; older ones deleted automatically |
| Format | Full directory copy of `C:\inetpub\operations-api` |

**To list available file backups (PowerShell on the IIS server):**
```powershell
Get-ChildItem "C:\inetpub\operations-api.backup.*" -Directory | Sort-Object Name -Descending
```

### Database Dump Backups

| Item | Detail |
|------|--------|
| Location | `C:\backups\ops-api-db\ops-api-db-<yyyyMMdd-HHmmss>.dump` |
| Created by | Deploy pipeline ("Database backup (pre-migration)" step) |
| Retention | Last **5** dumps kept; older ones deleted automatically |
| Format | PostgreSQL custom binary format (`pg_dump -F c`) |
| Printed in log | `DB dump written to: <path>` in "Database backup" step |

**To list available database dumps (PowerShell on the server):**
```powershell
Get-ChildItem "C:\backups\ops-api-db\ops-api-db-*.dump" | Sort-Object Name -Descending
```

**To find the dump for a specific deployment:**
Open the Azure DevOps run for `ops-api-deploy`, expand the "Database backup (pre-migration)" step log, and search for `DB dump written to:`.

### Manual Database Restore (if pipeline restore fails)

If `pg_restore` via the rollback pipeline fails, run manually on the server:

```powershell
# Write credentials to pgpass (adjust values)
$pgpassFile = "$env:TEMP\pgpass_restore"
"<host>:<port>:<dbname>:<user>:<password>" | Out-File $pgpassFile -Encoding ASCII
$env:PGPASSFILE = $pgpassFile

# Restore
pg_restore `
  -h <OPS_DB_HOST> `
  -p <OPS_DB_PORT> `
  -d ops_platform `
  -U ops_migrate `
  -F c -c -v `
  "C:\backups\ops-api-db\ops-api-db-<timestamp>.dump"

# Clean up
Remove-Item $pgpassFile -Force
```

The `-c` flag drops existing objects before recreating them (clean restore). Check the verbose output for any errors.

---

## 7. Monitoring & Alerting

### Health Endpoints

| Endpoint | Purpose | Expected Response |
|---------|---------|------------------|
| `GET http://localhost/healthz` | IIS/process liveness | `{"status":"Healthy"}` — HTTP 200 |
| `GET /api/health` | Platform health summary | JSON with sync statuses |
| `GET /api/health/syncs` | All sync job statuses | Array of sync status objects |
| `GET /api/health/syncs/{syncName}/history` | History for one sync | Array of history records |

### Teams Alert Types

#### Sync Health Alert (08:00 UTC daily)

**Source:** `sync_health_alert.py`
**Triggers when:** Any sync job is in `error`, `stale`, or `warning` state

| Status | Colour | Meaning |
|--------|--------|---------|
| Error | Red | Last run failed with an exception |
| Stale | Yellow | No successful run within `max_age_hours` |
| Warning | Yellow | `consecutive_failures > 0` but not yet at threshold |
| Healthy | Green | Last run succeeded within expected window |

**First response:** Check [Incident Response — Sync Failed](#91-sync-failed-single-or-repeated).

#### Certificate Expiry Alert (06:00 UTC daily)

**Source:** `alert_cert_expiry.py`
**Triggers when:** Any certificate has `days_until_expiry ≤ 14`
**Card shows:** Certificate CN, server, environment, app, days remaining, expiry date
**Note:** Alerts are deduplicated — each cert only alerted once until renewed

**First response:** Check [Incident Response — Cert Expiry Alert](#93-cert-expiry-alert).

#### Unmatched Server Spike Alert (07:00 UTC daily)

**Source:** `alert_unmatched_spike.py`
**Triggers when:** ≥5 new unmatched servers in the last 25 hours
**Card shows:** Server names and suggested canonical matches (using `similarity()`)
**First response:** Check [Incident Response — Unmatched Server Spike](#94-unmatched-server-spike).

### Checking Sync Status Directly

```sql
-- Overall health at a glance
SELECT
    sync_name,
    status,
    last_success_at,
    last_failure_at,
    consecutive_failures,
    EXTRACT(EPOCH FROM (NOW() - last_success_at)) / 3600 AS hours_since_success
FROM system.sync_status
ORDER BY sync_name;
```

---

## 8. Circuit Breaker

### What It Is

The circuit breaker prevents repeated pipeline failures from generating excessive on-call alerts when an external dependency (e.g., Databricks) is down. After a configurable number of consecutive failures within a time window, subsequent sync runs are **skipped** and recorded as `cancelled` rather than failing again.

### How It Works

```
Sync run starts
     │
     ▼
check_circuit_breaker()
     │
     ├── consecutive_failures < threshold?  ──► Proceed normally
     │
     ├── last_failure_at > timeout ago?     ──► Proceed normally (cooldown elapsed)
     │
     └── Both thresholds exceeded           ──► Raise CircuitBreakerOpenError
                                                 │
                                                 └── Record 'cancelled' in sync_history
                                                     Exit 0 (no on-call alert)
```

On the next successful run, `consecutive_failures` is automatically reset to 0.

### Configuration

| Environment Variable | Default | Effect |
|---------------------|---------|--------|
| `CIRCUIT_BREAKER_THRESHOLD` | `3` | Number of consecutive failures to open the circuit |
| `CIRCUIT_BREAKER_TIMEOUT_SECONDS` | `7200` | Seconds to keep circuit open (2 hours) |

Both are set in the Azure DevOps variable group `operations-sync-secrets` or as pipeline variables.

### Detecting an Open Circuit Breaker

```sql
-- Syncs currently showing cancelled runs (circuit may be open)
SELECT
    sync_name,
    consecutive_failures,
    last_failure_at,
    last_failure_at + INTERVAL '2 hours' AS circuit_opens_until
FROM system.sync_status
WHERE consecutive_failures >= 3
ORDER BY consecutive_failures DESC;

-- Recent cancelled runs
SELECT sync_name, started_at, status, error_message
FROM system.sync_history
WHERE status = 'cancelled'
  AND started_at >= NOW() - INTERVAL '24 hours'
ORDER BY started_at DESC;
```

### Resetting the Circuit Breaker

Once the underlying issue is resolved, reset the counter to allow the next run to proceed immediately:

```sql
UPDATE system.sync_status
SET consecutive_failures = 0
WHERE sync_name = '<sync_name>';
-- e.g. WHERE sync_name = 'databricks_servers'
```

### Emergency Override (bypass without DB change)

To force a sync through while the circuit is open (e.g., for a one-off manual run), add a pipeline variable at queue time:

```
CIRCUIT_BREAKER_THRESHOLD = 99
```

This raises the threshold above any realistic failure count. Remove it after the run.

---

## 9. Incident Response Playbooks

---

### 9.1 Sync Failed (Single or Repeated)

**Symptoms:** Teams health alert (08:00 UTC), sync status shows `error`.

**Step 1 — Identify the failure**

```sql
-- Last run details for the failing sync
SELECT started_at, completed_at, status, processed, failed, error_message
FROM system.sync_history
WHERE sync_name = '<sync_name>'
ORDER BY started_at DESC
LIMIT 5;
```

**Step 2 — Diagnose by error type**

| Error message contains | Likely cause | Action |
|-----------------------|--------------|--------|
| `ConnectionError`, `Timeout`, `connection refused` | External dependency down | Check Databricks/Confluence/HTML page availability |
| `OperationalError`, `could not connect to server` | DB connection issue | Check PostgreSQL is running; check credentials |
| `Circuit breaker OPEN` | Too many failures — circuit is open | See [Section 8](#8-circuit-breaker) |
| `Safety check failed` | Server count dropped >50% | Investigate Databricks query; do not force-run |
| `FileNotFoundError`, `No CSV files found` | Certificate scan didn't produce output | Check PowerShell scan step in `ops-sync-certificates` |

**Step 3 — Resolve and re-run**

Once the root cause is fixed, either:
- Wait for the next scheduled run, **or**
- Manually trigger the pipeline in Azure DevOps

---

### 9.2 Circuit Breaker Open

**Symptoms:** `sync_history` rows showing `status = 'cancelled'` for 3+ consecutive runs. No error alert (by design).

**Step 1 — Confirm the breaker is open**

```sql
SELECT sync_name, consecutive_failures, last_failure_at
FROM system.sync_status
WHERE consecutive_failures >= 3;
```

**Step 2 — Identify the underlying failure**

```sql
SELECT started_at, error_message
FROM system.sync_history
WHERE sync_name = '<sync_name>' AND status = 'error'
ORDER BY started_at DESC
LIMIT 3;
```

**Step 3 — Fix the root cause**

Address the underlying dependency issue (Databricks connectivity, credentials, schema mismatch, etc.).

**Step 4 — Reset the circuit**

```sql
UPDATE system.sync_status
SET consecutive_failures = 0
WHERE sync_name = '<sync_name>';
```

**Step 5 — Verify next run succeeds**

Either wait for the next scheduled run or trigger manually. Confirm `status = 'success'` in `sync_history`.

---

### 9.3 Cert Expiry Alert

**Symptoms:** Teams card from `alert_cert_expiry.py` listing certificates with ≤14 days remaining.

**Step 1 — Review the full expiry list**

```sql
SELECT
    server_name,
    subject_cn,
    store_name,
    valid_to,
    days_until_expiry,
    alert_level,
    is_expired
FROM certificates.inventory
WHERE is_active = TRUE
  AND days_until_expiry <= 30
ORDER BY days_until_expiry ASC;
```

**Step 2 — Categorise**

- `is_expired = TRUE` or `days_until_expiry < 0` → Certificate already expired. Escalate immediately.
- `days_until_expiry <= 7` → CRITICAL. Escalate to server/application owner today.
- `days_until_expiry <= 14` → Raise renewal request with owner if not already in progress.

**Step 3 — Certificate renewal**

Certificate renewal is handled by the application/server owner. Once renewed, the next certificate scan (06:00 UTC) will pick up the new cert and deactivate the old one.

**Step 4 — Silence a known alert**

If a cert is intentionally self-signed or renewal is tracked elsewhere, mark it in the alerts table:

```sql
-- Find the alert record
SELECT * FROM certificates.alerts
WHERE certificate_id IN (
    SELECT id FROM certificates.inventory
    WHERE server_name = '<server>' AND subject_cn LIKE '%<cn>%'
);
```

---

### 9.4 Unmatched Server Spike

**Symptoms:** Teams alert at 07:00 UTC showing ≥5 new servers that could not be matched to `shared.servers`.

**Step 1 — Review unmatched servers**

```sql
SELECT
    server_name,
    source_system,
    context,
    occurrence_count,
    first_seen_at,
    last_seen_at,
    suggested_match,
    similarity_score
FROM system.unmatched_servers
WHERE first_seen_at >= NOW() - INTERVAL '25 hours'
ORDER BY first_seen_at DESC;
```

**Step 2 — Determine cause**

| Cause | Indicators | Action |
|-------|-----------|--------|
| New servers added to source that aren't in Databricks | `suggested_match` is NULL or very different | Wait for next server sync (05:00 UTC), then re-check |
| Naming mismatch (domain suffix, casing) | `suggested_match` exists, high similarity | Add to `system.server_aliases` |
| Old patching schedule references decommissioned servers | Server names match historic entries | Investigate source data; update schedule |
| Bulk import error | Dozens of unmatched with no suggestions | Investigate the source file/query |

**Step 3 — Add a server alias (if naming mismatch)**

```sql
INSERT INTO system.server_aliases (alias_name, canonical_name, source_system, notes)
VALUES ('srv-web-01.contoso.com', 'srv-web-01', 'patching_html', 'FQDN used in patching schedule');
```

---

### 9.5 Resolving Unmatched Servers via API

The Operations API provides write endpoints for managing server aliases and unmatched servers. These require OpsAdmin role (Windows auth).

**Create a server alias** (maps an alternate name to a canonical server):

```bash
curl -X POST "https://<host>/api/servers/aliases" \
  --negotiate -u : \
  -H "Content-Type: application/json" \
  -d '{"aliasName": "WEBPROD01", "canonicalName": "WEB-PROD-01", "sourceSystem": "SCCM"}'
```

**Resolve an unmatched server** (link it to a known server):

```bash
curl -X POST "https://<host>/api/servers/unmatched/<unmatchedId>/resolve" \
  --negotiate -u : \
  -H "Content-Type: application/json" \
  -d '{"serverId": 42}'
```

**Ignore an unmatched server** (mark as not needing resolution):

```bash
curl -X POST "https://<host>/api/servers/unmatched/<unmatchedId>/ignore" \
  --negotiate -u :
```

> **Note:** These endpoints require OpsAdmin role. On Windows, use `--negotiate -u :` with curl to pass Kerberos credentials. From PowerShell, use `Invoke-WebRequest -UseDefaultCredentials`.

---

### 9.6 Health Check Failing After Deploy

**Symptoms:** Deploy pipeline health check step fails; IIS app pool may not start; API returns 5xx.

**Step 1 — Check IIS app pool state (PowerShell on server)**

```powershell
Import-Module WebAdministration
Get-WebAppPoolState -Name 'OperationsApi'
```

**Step 2 — Check Windows Event Log for application errors**

```powershell
Get-EventLog -LogName Application -Source 'IIS*' -Newest 20 |
    Format-List TimeGenerated, EntryType, Message
```

**Step 3 — Check .NET application log**

Look in `C:\inetpub\operations-api\logs\` for `*.log` files.

**Step 4 — Check appsettings**

Verify `C:\inetpub\operations-api\appsettings.Production.json` contains the correct connection string and is valid JSON:

```powershell
Get-Content "C:\inetpub\operations-api\appsettings.Production.json" | ConvertFrom-Json
```

**Step 5 — Check database connectivity**

```powershell
psql -h <OPS_DB_HOST> -p <OPS_DB_PORT> -d ops_platform -U ops_api -c "SELECT 1"
```

**Step 6 — If unresolvable within 15 minutes — rollback**

See [Section 5 — Rollback Procedure](#5-rollback-procedure).

---

### 9.7 Database Connection Failure

**Symptoms:** All syncs failing with `OperationalError: could not connect to server`.

**Step 1 — Test connectivity from the agent**

```powershell
Test-NetConnection -ComputerName <OPS_DB_HOST> -Port <OPS_DB_PORT>
```

**Step 2 — Check PostgreSQL service**

On the database server:
```powershell
Get-Service postgresql*
```

Or on Linux:
```bash
systemctl status postgresql
```

**Step 3 — Check credentials**

Confirm the variable group `operations-api-prod` has the correct `OPS_DB_PASSWORD`. Try a manual psql connection:
```powershell
psql -h <OPS_DB_HOST> -p <OPS_DB_PORT> -d ops_platform -U ops_api
```

**Step 4 — Check connection limits**

```sql
SELECT count(*), state
FROM pg_stat_activity
WHERE datname = 'ops_platform'
GROUP BY state;
```

If connection count is at `max_connections`, identify and terminate idle connections:
```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'ops_platform'
  AND state = 'idle'
  AND query_start < NOW() - INTERVAL '10 minutes';
```

---

### 9.8 Databricks Unreachable

**Symptoms:** `sync_server_list` and `sync_eol_software` failing with `ConnectionError` or timeout against Databricks.

**Step 1 — Confirm Databricks is down**

Check Databricks status page or test connectivity:
```powershell
Invoke-WebRequest -Uri "https://<DATABRICKS_HOST>/api/2.0/clusters/list" `
    -Headers @{Authorization="Bearer $env:DATABRICKS_TOKEN"} -UseBasicParsing
```

**Step 2 — Let the circuit breaker do its job**

After 3 consecutive failures (within 2 hours), the circuit opens and subsequent runs skip cleanly (exit 0). No action needed unless Databricks is down for more than 2 hours.

**Step 3 — When Databricks recovers**

Reset the circuit breakers:
```sql
UPDATE system.sync_status
SET consecutive_failures = 0
WHERE sync_name IN ('databricks_servers', 'databricks_eol');
```

The next scheduled run will succeed and data will catch up automatically.

**Step 4 — Data staleness check**

```sql
SELECT sync_name, last_success_at,
    EXTRACT(EPOCH FROM (NOW() - last_success_at)) / 3600 AS hours_since_success
FROM system.sync_status
WHERE sync_name IN ('databricks_servers', 'databricks_eol');
```

If `hours_since_success > 48`, consider escalating — server list may be significantly stale.

---

### 9.9 Migration Failed Mid-Deploy

**Symptoms:** Deploy pipeline failed on "Run database migrations" step. IIS was not stopped; no application files were changed.

**Step 1 — Identify which script failed**

Check the "Run database migrations" step log in Azure DevOps. The pipeline logs each script before running it:
```
Running: 005-system-health-schema.sql
Migration failed on 005-system-health-schema.sql — deployment aborted
```

**Step 2 — Check partial application**

```sql
SELECT script_name, applied_at
FROM system.schema_migrations
ORDER BY script_name;
```

**Step 3 — Assess the state**

Each migration script uses `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, and `ON CONFLICT DO NOTHING` — they are designed to be **idempotent**. However, if a script failed partway through:

```sql
-- Check what objects exist from the failing script
\dt patching.*   -- or whichever schema was being created
```

**Step 4 — Option A: Fix the script and re-deploy**

If the failure was due to a bug in the migration script:
1. Fix the script
2. Re-run the build pipeline
3. Re-run the deploy pipeline

Since the backup was taken before migration, the DB is clean and the pipeline will re-run the failed script from scratch.

**Step 5 — Option B: Manual rollback to pre-migration state**

If the schema is in a partially-applied inconsistent state:

```powershell
# Use the pg_dump taken by the deploy pipeline
pg_restore -h <host> -p <port> -d ops_platform -U ops_migrate -F c -c -v `
    "C:\backups\ops-api-db\ops-api-db-<timestamp>.dump"
```

The dump was created before any migration ran, so this returns the DB to a known-good state. Then fix the migration and re-deploy.

---

## 10. Common Operational Queries

### Current Sync Status

```sql
SELECT
    sync_name,
    status,
    last_success_at,
    last_failure_at,
    consecutive_failures,
    ROUND(EXTRACT(EPOCH FROM (NOW() - last_success_at)) / 3600, 1) AS hours_since_success
FROM system.sync_status
ORDER BY
    CASE status WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
    sync_name;
```

### Recent Sync History (Last 24 Hours)

```sql
SELECT
    sync_name,
    status,
    started_at,
    completed_at,
    processed,
    inserted,
    updated,
    failed,
    LEFT(error_message, 200) AS error_summary
FROM system.sync_history
WHERE started_at >= NOW() - INTERVAL '24 hours'
ORDER BY started_at DESC;
```

### Open Circuit Breakers

```sql
SELECT
    sync_name,
    consecutive_failures,
    last_failure_at,
    last_failure_at + INTERVAL '2 hours' AS circuit_resets_at,
    GREATEST(0, ROUND(
        (EXTRACT(EPOCH FROM (last_failure_at + INTERVAL '2 hours' - NOW())) / 60)::numeric, 0
    )) AS minutes_until_reset
FROM system.sync_status
WHERE consecutive_failures >= 3
  AND last_failure_at > NOW() - INTERVAL '2 hours';
```

### Unmatched Servers

```sql
SELECT
    server_name,
    source_system,
    context,
    occurrence_count,
    first_seen_at,
    suggested_match,
    similarity_score
FROM system.unmatched_servers
WHERE is_resolved = FALSE
ORDER BY first_seen_at DESC;
```

### Scan Failures (Unreachable / Access Denied)

```sql
SELECT
    server_name,
    scan_type,
    error_category,
    error_message,
    failure_count,
    first_seen_at,
    last_seen_at
FROM system.scan_failures
WHERE is_resolved = FALSE
ORDER BY failure_count DESC, last_seen_at DESC;
```

### Expiring Certificates (Next 30 Days)

```sql
SELECT
    server_name,
    subject_cn,
    issuer_cn,
    store_name,
    valid_to,
    days_until_expiry,
    alert_level,
    is_expired
FROM certificates.inventory
WHERE is_active = TRUE
  AND days_until_expiry <= 30
ORDER BY days_until_expiry ASC;
```

### Migration History

```sql
SELECT
    script_name,
    applied_at,
    applied_by,
    execution_ms,
    rolled_back_at,
    rolled_back_by
FROM system.schema_migrations
ORDER BY script_name;
```

### Check Pending Migrations

```sql
-- Pass the list of scripts that should be applied in this deployment
SELECT * FROM system.check_pending_migrations(ARRAY[
    '001-common.sql',
    '002-shared-schema.sql',
    '003-certificates-schema.sql',
    '004-patching-schema.sql',
    '005-system-health-schema.sql',
    '006-eol-schema.sql',
    '007-migration-tracking.sql'
]);
-- Returns: script_name | status (applied / pending / rolled_back)
```

### Server Count by Source

```sql
SELECT source_system, COUNT(*) AS server_count, SUM(CASE WHEN is_active THEN 1 ELSE 0 END) AS active
FROM shared.servers
GROUP BY source_system
ORDER BY active DESC;
```

---

## 11. Environment Variables Reference

All secrets are stored in the Azure DevOps variable group **`operations-api-prod`** (linked to `operations-sync-secrets` for sync pipelines). Pipeline-level variables are defined inline in each `.yml` file.

### Database

| Variable | Default | Required | Used By | Notes |
|----------|---------|----------|---------|-------|
| `OPS_DB_HOST` | `localhost` | Yes | All sync scripts, API | PostgreSQL server hostname |
| `OPS_DB_PORT` | `5432` | No | All sync scripts | PostgreSQL port |
| `OPS_DB_NAME` | `ops_platform` | No | All sync scripts | Database name |
| `OPS_DB_USER` | *(none)* | Yes | All sync scripts | Application DB user (`ops_api` role) |
| `OPS_DB_PASSWORD` | *(none)* | Yes* | All sync scripts | *Or use `OPS_DB_USE_PGPASS=1` |
| `OPS_DB_USE_PGPASS` | `0` | No | All sync scripts | Set to `1` to use `.pgpass` instead |
| `OPS_DB_SSLMODE` | `require` | No | All sync scripts | `require`, `verify-ca`, or `verify-full` |
| `OPS_DB_SSLROOTCERT` | *(none)* | No | All sync scripts | Path to CA cert for `verify-full` |
| `OPS_DB_MIGRATE_USER` | *(none)* | Yes | Deploy pipeline | DDL-privileged user (`ops_migrate` role) |
| `OPS_CONNECTIONSTRING` | *(none)* | Yes | Deploy pipeline | Full ADO.NET connection string for API |

### Databricks

| Variable | Required | Used By | Notes |
|----------|----------|---------|-------|
| `DATABRICKS_HOST` | Yes | Server sync, EOL sync | API hostname (no `https://`) |
| `DATABRICKS_TOKEN` | Yes | Server sync, EOL sync | Bearer token |
| `DATABRICKS_WAREHOUSE_ID` | Yes | Server sync, EOL sync | SQL warehouse ID |
| `DATABRICKS_QUERY` | No | Server sync | Override default server list query |
| `DATABRICKS_EOL_QUERY` | No | EOL sync | Override default EOL query |

### Confluence

| Variable | Required | Used By | Notes |
|----------|----------|---------|-------|
| `CONFLUENCE_URL` | Yes | Issues sync | Base URL, e.g. `https://confluence.corp.local` |
| `CONFLUENCE_TOKEN` | Yes | Issues sync | API bearer token |
| `CONFLUENCE_PARENT_PAGE_ID` | Yes | Issues sync | Page ID of the parent issues page |

### Alerting

| Variable | Required | Used By | Notes |
|----------|----------|---------|-------|
| `TEAMS_WEBHOOK_URL` | Yes | All alert scripts | Must match `*.webhook.office.com` |

### Circuit Breaker

| Variable | Default | Used By | Notes |
|----------|---------|---------|-------|
| `CIRCUIT_BREAKER_THRESHOLD` | `3` | All sync scripts | Consecutive failures to open circuit |
| `CIRCUIT_BREAKER_TIMEOUT_SECONDS` | `7200` | All sync scripts | Seconds to keep circuit open (2h) |

### IIS / Deployment (pipeline variables, not secrets)

| Variable | Value | Defined In |
|----------|-------|-----------|
| `iisSiteName` | `OperationsApi` | `ops-api-deploy.yml`, `ops-api-rollback.yml` |
| `iisAppPoolName` | `OperationsApi` | Both deploy pipelines |
| `deployPath` | `C:\inetpub\operations-api` | Both deploy pipelines |
| `dbBackupPath` | `C:\backups\ops-api-db` | `ops-api-deploy.yml` |

---

## 12. Pipeline Reference

| Pipeline | Trigger | Approval Required | Key Parameters | Purpose |
|----------|---------|------------------|----------------|---------|
| `ops-api-build` | Push/PR on `main`, `feature/*` | No | — | Build, test, publish artifact |
| `ops-api-deploy` | Manual only | Yes — `operations-api-prod` environment | `buildPipelineRunId` (optional) | Deploy to IIS with DB migrations |
| `ops-api-rollback` | Manual only | Yes — `operations-api-prod` environment | `backupTimestamp`, `dbDumpFile` | Restore previous deployment |
| `ops-run-tests` | Manual only | No | — | Run .NET unit tests on demand |
| `ops-sync-servers` | Daily 05:00 UTC | No | — | Sync server list from Databricks |
| `ops-sync-eol` | Daily 05:30 UTC | No | — | Sync EOL data from Databricks |
| `ops-sync-certificates` | Daily 06:00 UTC | No | — | Scan certs; alert expiring |
| `ops-sync-patching-schedule` | Daily 06:30 UTC | No | — | Sync patching schedule from HTML |
| `ops-sync-confluence` | Daily 04:00 UTC | No | — | Sync known issues from Confluence |
| `ops-alert-unmatched` | Daily 07:00 UTC | No | — | Alert on unmatched server spike |
| `ops-health-alert` | Daily 08:00 UTC | No | — | Alert on sync health degradation |

### Skipping a Scheduled Sync Run

Scheduled pipelines do not have a skip mechanism in YAML. To prevent a single run (e.g., during a maintenance window), either:
- Disable the pipeline in Azure DevOps for the window and re-enable after
- Let it run — if the dependency is down, the circuit breaker will handle it cleanly

---

## 13. Access & Permissions

### Azure DevOps

| Permission | Who Needs It | Where |
|-----------|-------------|-------|
| Run `ops-api-deploy` | Senior Engineers + Approvers | `operations-api-prod` environment — Approvals & Checks |
| Run `ops-api-rollback` | Senior Engineers + Approvers | `operations-api-prod` environment — Approvals & Checks |
| Run sync pipelines | Pipeline service account (automated) | No gate — scheduled |
| Edit pipeline variables | DevOps Engineers | Variable group `operations-api-prod` |
| Edit secrets | DevOps Lead | Variable group `operations-sync-secrets` (secret marked) |

### PostgreSQL Roles

| Role | Privileges | Used By |
|------|-----------|---------|
| `ops_api` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` on application tables | .NET API, Python sync scripts |
| `ops_migrate` | `CREATE`, `ALTER`, `DROP` (DDL) | Deploy pipeline migration step |

Connection credentials for both roles are stored in the `operations-api-prod` Azure DevOps variable group.

### IIS Application Pool

The `OperationsApi` application pool runs under a service account with read access to `C:\inetpub\operations-api` and the ability to connect to PostgreSQL. The identity is managed by the server team — do not run the app pool as `LocalSystem` or `NetworkService` in production.

### Teams Webhook

The Teams webhook URL is stored as a **secret** in the Azure DevOps variable group `operations-sync-secrets`. It is never logged or printed by any pipeline or script. To rotate it:

1. Generate a new incoming webhook URL in the Teams channel settings
2. Update `TEAMS_WEBHOOK_URL` in the `operations-sync-secrets` variable group
3. No code change or redeployment required — the next sync run picks it up automatically

### Secret Rotation Checklist

| Secret | Variable | Rotation action |
|--------|----------|-----------------|
| DB app password | `OPS_DB_PASSWORD` | Update variable group + restart IIS app pool |
| DB migrate password | `OPS_DB_PASSWORD` in `ops-api-deploy.yml` | Update variable group |
| Databricks token | `DATABRICKS_TOKEN` | Update variable group |
| Confluence token | `CONFLUENCE_TOKEN` | Update variable group |
| Teams webhook | `TEAMS_WEBHOOK_URL` | Update variable group (Teams-side rotation first) |
| API connection string | `OPS_CONNECTIONSTRING` | Update variable group + restart IIS app pool |

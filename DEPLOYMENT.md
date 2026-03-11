# Operations API - Deployment Guide

**Target:** Windows Server with IIS, .NET 10, PostgreSQL
**Server:** Group Application Server (self-hosted Azure DevOps agent)
**Version:** 1.2.0

This guide walks through every step of deploying the Operations API from scratch on the Group Application Server. It covers installing prerequisites, setting up the database, publishing the .NET API, configuring IIS, setting up the Python sync environment, and scheduling automated data sync pipelines.

---

## Table of Contents

1. [Quick Deploy — Group App Server](#quick-deploy--group-app-server)
2. [Architecture Overview](#architecture-overview)
3. [Prerequisites](#prerequisites)
4. [Step 1: Install PostgreSQL](#step-1-install-postgresql)
5. [Step 2: Create the Database and Users](#step-2-create-the-database-and-users)
6. [Step 3: Run Database Schema Scripts](#step-3-run-database-schema-scripts)
7. [Step 4: Grant Database Permissions](#step-4-grant-database-permissions)
8. [Step 5: Verify the Database](#step-5-verify-the-database)
9. [Step 6: Install the .NET 10 Hosting Bundle](#step-6-install-the-net-10-hosting-bundle)
10. [Step 7: Install the .NET 10 SDK (Build Machine)](#step-7-install-the-net-10-sdk-build-machine)
11. [Step 8: Publish the Application](#step-8-publish-the-application)
12. [Step 9: Configure Application Settings](#step-9-configure-application-settings)
13. [Step 10: Enable IIS Features](#step-10-enable-iis-features)
14. [Step 11: Create the IIS Application Pool](#step-11-create-the-iis-application-pool)
15. [Step 12: Create the IIS Website](#step-12-create-the-iis-website)
16. [Step 13: Configure Authentication in IIS](#step-13-configure-authentication-in-iis)
17. [Step 14: Deploy the Frontend](#step-14-deploy-the-frontend)
18. [Step 15: Verify the API and Frontend](#step-15-verify-the-api-and-frontend)
19. [Step 16: Install Python](#step-16-install-python)
20. [Step 17: Create the Python Virtual Environment](#step-17-create-the-python-virtual-environment)
21. [Step 18: Configure Sync Environment Variables](#step-18-configure-sync-environment-variables)
22. [Step 19: Test Sync Scripts Manually](#step-19-test-sync-scripts-manually)
23. [Step 20: Set Up Azure DevOps Pipelines](#step-20-set-up-azure-devops-pipelines)
24. [Step 21: Seed Sync Status Records](#step-21-seed-sync-status-records)
25. [Step 22: Post-Deployment Verification](#step-22-post-deployment-verification)
26. [Step 23: Set Up CI/CD Pipelines (Build and Deploy)](#step-23-set-up-cicd-pipelines-build-and-deploy)
27. [Updating the Application](#updating-the-application)
28. [Applying Database Migrations](#applying-database-migrations)
29. [Troubleshooting](#troubleshooting)

---

## Quick Deploy — Group App Server

This section is a condensed checklist for getting the Operations API running on the Group Application Server. Each item references a detailed step below if you need the full walkthrough.

### What you need on the Group App Server

| Component | Version | Purpose |
|-----------|---------|---------|
| **Windows Server** | 2019 or later | Host OS |
| **PostgreSQL** | 16+ | Database — stores all operational data |
| **.NET 10 Hosting Bundle** | 10.0.x | Runs the ASP.NET Core API inside IIS |
| **.NET 10 SDK** | 10.0.x | Builds/publishes the application |
| **IIS** | 10+ | Web server — reverse proxy + Windows Auth + static files |
| **Python** | 3.13+ | Runs scheduled sync scripts |
| **Azure DevOps Agent** | Latest | Self-hosted agent for CI/CD pipelines |

### Deploy order (do these in sequence)

```
Phase 1 — Database                         Phase 2 — API + Frontend
─────────────────────────────               ──────────────────────────
1. Install PostgreSQL          [Step 1]     6. Install .NET Hosting Bundle  [Step 6]
2. Create database + users     [Step 2]     7. Install .NET SDK             [Step 7]
3. Run schema scripts (000-008)[Step 3]     8. Publish the API              [Step 8]
4. Grant permissions           [Step 4]     9. Configure appsettings.json   [Step 9]
5. Verify DB connectivity      [Step 5]    10. Enable IIS features          [Step 10]
                                           11. Create IIS app pool          [Step 11]
Phase 3 — Python Sync                     12. Create IIS website           [Step 12]
─────────────────────────────             13. Configure Windows Auth       [Step 13]
14. Install Python             [Step 16]  14. Deploy frontend to wwwroot   [Step 14]
15. Create venv + install deps [Step 17]  15. Test health + API + dashboard[Step 15]
16. Set environment variables  [Step 18]
17. Dry-run each sync script   [Step 19]

Phase 4 — Automation
─────────────────────────────
18. Create Azure DevOps variable groups   [Step 20]
19. Create sync pipelines (7 YAML files)  [Step 20]
20. Create build + deploy pipelines       [Step 23]
21. Run first deployment through pipeline [Step 23]
22. Post-deployment verification          [Step 22]
```

### Quick verification commands

Run these on the Group App Server to confirm everything is working:

```cmd
:: ── Prerequisites ──
psql --version                        & REM Should show PostgreSQL 18+
dotnet --list-runtimes                & REM Should show Microsoft.AspNetCore.App 10.0.x
python --version                      & REM Should show Python 3.13+

:: ── Database ──
psql -U ops_api -d ops_platform -c "SELECT table_schema, COUNT(*) FROM information_schema.tables WHERE table_schema IN ('shared','certificates','patching','eol','system') GROUP BY table_schema ORDER BY table_schema;"

:: ── API ──
curl -k --negotiate -u : https://localhost/healthz
curl -k --negotiate -u : https://localhost/api/health

:: ── IIS ──
%windir%\system32\inetsrv\appcmd list site /name:OperationsApi
%windir%\system32\inetsrv\appcmd list apppool /apppool.name:OperationsApi

:: ── Sync (from venv) ──
cd C:\Dev\GitHub\operations-api\sync
venv\Scripts\activate
python servers/sync_server_list.py --dry-run --verbose
```

### Key file locations on the Group App Server

| What | Path |
|------|------|
| **Repository clone** | `C:\Dev\GitHub\operations-api` |
| **Published API** | `C:\inetpub\operations-api` |
| **Frontend** | `C:\inetpub\operations-api\wwwroot\index.html` |
| **Production config** | `C:\inetpub\operations-api\appsettings.Production.json` |
| **IIS stdout logs** | `C:\inetpub\operations-api\logs\stdout` |
| **Python venv** | `C:\Dev\GitHub\operations-api\sync\venv` |
| **Database schemas** | `C:\Dev\GitHub\operations-api\database\000-*.sql` through `008-*.sql` |
| **Deployment backups** | `C:\inetpub\operations-api.backup.*` |
| **Azure DevOps Agent** | Check Services for `vstsagent.*` |
| **PostgreSQL data** | `C:\Program Files\PostgreSQL\18\data` |

### Ports and networking

| Service | Port | Protocol | Notes |
|---------|------|----------|-------|
| IIS (HTTPS) | 443 | TCP | Frontend + API — requires SSL cert |
| IIS (HTTP) | 80 | TCP | Optional redirect to HTTPS |
| PostgreSQL | 5432 | TCP | Database — localhost only unless `pg_hba.conf` allows remote |
| Kestrel (internal) | N/A | — | In-process hosting via ASP.NET Core Module — no separate port |

### Required credentials (have these ready)

| Credential | Where it goes | Created in |
|------------|---------------|------------|
| `postgres` superuser password | psql commands during setup | PostgreSQL installer |
| `ops_api` password | `appsettings.json` connection string | Step 2 |
| `ops_sync` password | System env var `OPS_DB_PASSWORD` + Azure DevOps variable group | Step 2 |
| Databricks PAT | System env var `DATABRICKS_TOKEN` + Azure DevOps variable group | Databricks workspace |
| Confluence token | System env var `CONFLUENCE_TOKEN` + Azure DevOps variable group | Confluence admin |
| Teams webhook URL | System env var `TEAMS_WEBHOOK_URL` + Azure DevOps variable group | Teams channel connector |
| SSL certificate | IIS site binding | Your certificate authority |

---

## Architecture Overview

The Operations API is a full-stack platform with four main components:

```
                    +---------------------+
                    |    IIS Website       |
                    |  (Windows Auth)      |
                    |                      |
                    |  +---------------+   |
   Browser ------->|  | Frontend      |   |
                    |  | (index.html)  |   |
                    |  +-------+-------+   |
                    |          |           |
                    |  +-------v-------+   |
                    |  | .NET 10 API   |   |
                    |  | (Kestrel via  |   |
                    |  |  IIS reverse  |   |
                    |  |  proxy)       |   |
                    |  +-------+-------+   |
                    +----------|----------+
                               |
                    +----------v----------+
                    |    PostgreSQL 18+    |
                    |    (ops_platform)    |
                    +----------^----------+
                               |
            +------------------+------------------+
            |                  |                  |
   +--------+------+  +-------+-------+  +-------+-------+
   | Python Sync   |  | Python Sync   |  | Python Sync   |
   | (Databricks)  |  | (HTML page)   |  | (PowerShell   |
   | servers, EOL  |  | patching      |  |  CSV certs)   |
   +---------------+  +---------------+  +---------------+
```

**Component summary:**

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | Single HTML file (HTML/CSS/JS) | Dashboard UI — Health, Servers, Patching, Certificates, EOL tabs |
| **API** | .NET 10, Dapper ORM, Npgsql | REST endpoints consumed by the frontend |
| **Database** | PostgreSQL 18+ | 5 schemas: `system`, `shared`, `certificates`, `patching`, `eol` |
| **Sync Scripts** | Python 3.13+ | Scheduled data pipelines from Databricks, HTML pages, Confluence, PowerShell CSVs |
| **CI/CD** | Azure DevOps Pipelines | Scheduled triggers running sync scripts on the self-hosted agent |

---

## Prerequisites

Before starting, confirm you have:

- [ ] **Administrator access** to the target Windows Server
- [ ] The `operations-api` repository cloned or copied to the server (e.g. `C:\Dev\GitHub\operations-api`)
- [ ] Internet access for downloading installers (or offline installers pre-downloaded)
- [ ] A hostname or URL decided for the site (e.g. `ops-api.contoso.com`)
- [ ] An SSL certificate for HTTPS (if using HTTPS — strongly recommended)
- [ ] Access to Azure DevOps for creating pipelines (for scheduled sync jobs)

---

## Step 1: Install PostgreSQL

PostgreSQL is the database that stores all operational data.

### 1.1 Download the installer

Go to https://www.postgresql.org/download/windows/ and download **PostgreSQL 18** or later. Click "Download the installer" (this uses the EnterpriseDB installer which is the easiest for Windows).

### 1.2 Run the installer

Double-click the downloaded `.exe` and follow the wizard:

1. **Installation directory:** Accept the default (`C:\Program Files\PostgreSQL\18`) or choose your standard location
2. **Select components:** Keep all checked (PostgreSQL Server, pgAdmin 4, Stack Builder, Command Line Tools)
3. **Data directory:** Accept the default (`C:\Program Files\PostgreSQL\18\data`)
4. **Password:** Set a strong password for the `postgres` superuser account. **Save this password** — you will need it in the next steps
5. **Port:** `5432` (the default — keep this unless you have a conflict)
6. **Locale:** Accept the default
7. Click **Next** through to completion

### 1.3 Verify the service is running

Open **Services** (press `Win+R`, type `services.msc`, press Enter):

1. Find **postgresql-x64-16** (or similar) in the list
2. Confirm its Status is **Running**
3. Confirm Startup Type is **Automatic** — if not, right-click > Properties > change to Automatic

### 1.4 Add PostgreSQL to PATH

This lets you run `psql` from any command prompt:

1. Press `Win+R`, type `sysdm.cpl`, press Enter
2. Click **Advanced** tab > **Environment Variables**
3. Under **System variables**, find `Path`, click **Edit**
4. Click **New** and add: `C:\Program Files\PostgreSQL\18\bin`
   (adjust the path if you installed to a different location or version)
5. Click **OK** on all dialogs

### 1.5 Verify psql works

Open a **new** command prompt (the old one won't have the updated PATH) and run:

```cmd
psql --version
```

You should see something like: `psql (PostgreSQL) 16.x`

---

## Step 2: Create the Database and Users

Now create the database and two service accounts — one for the API (read-only) and one for the sync scripts (read-write).

### 2.1 Connect to PostgreSQL as the superuser

Open a command prompt and run:

```cmd
psql -U postgres
```

Enter the superuser password you set during installation. You should see the `postgres=#` prompt.

### 2.2 Create the database and users

Copy and paste this entire block into the psql prompt:

```sql
-- Create the application database
CREATE DATABASE ops_platform;

-- Create the API service account (read-only access)
CREATE USER ops_api WITH PASSWORD 'YOUR_API_PASSWORD_HERE';

-- Create the sync service account (read-write access)
CREATE USER ops_sync WITH PASSWORD 'YOUR_SYNC_PASSWORD_HERE';

-- Grant connect permissions
GRANT CONNECT ON DATABASE ops_platform TO ops_api;
GRANT CONNECT ON DATABASE ops_platform TO ops_sync;
```

**Replace `YOUR_API_PASSWORD_HERE` and `YOUR_SYNC_PASSWORD_HERE` with strong, unique passwords.** Save these passwords — you will need them later for the API connection string and sync environment variables.

### 2.3 Exit psql

```sql
\q
```

---

## Step 3: Run Database Schema Scripts

The database has 7 schema files that must be run **in order** because each one depends on objects created by the previous files. The numbering in the filenames tells you the order.

### 3.1 Connect to the new database

```cmd
psql -U postgres -d ops_platform
```

Enter the postgres superuser password.

### 3.2 Run each schema file in order

Run each of these commands one at a time. Wait for each to complete before running the next. **Use forward slashes in the paths** — psql requires this even on Windows.

```sql
\i 'C:/Dev/GitHub/operations-api/database/000-extensions.sql'
```

Wait for the output. You should see `NOTICE: All extensions installed successfully`. Then continue:

```sql
\i 'C:/Dev/GitHub/operations-api/database/001-common.sql'
\i 'C:/Dev/GitHub/operations-api/database/002-shared-schema.sql'
\i 'C:/Dev/GitHub/operations-api/database/003-certificates-schema.sql'
\i 'C:/Dev/GitHub/operations-api/database/004-patching-schema.sql'
\i 'C:/Dev/GitHub/operations-api/database/005-system-health-schema.sql'
\i 'C:/Dev/GitHub/operations-api/database/006-eol-schema.sql'
\i 'C:/Dev/GitHub/operations-api/database/007-migration-tracking.sql'
\i 'C:/Dev/GitHub/operations-api/database/008-eol-add-machine-name.sql'
```

> **Adjust the paths** if your repository is cloned to a different location than `C:\Dev\GitHub\operations-api`.
>
> **Note:** Migration 008 is idempotent — safe to re-run. On first run it adds the `machine_name` column to `eol.end_of_life_software` and clears old databricks rows for a clean sync. On subsequent runs the block is a no-op.

Each script will output `CREATE TABLE`, `CREATE INDEX`, `CREATE FUNCTION`, `INSERT`, etc. as it runs. If you see any `ERROR` messages, stop and fix the issue before continuing to the next script.

### 3.3 Verify the tables were created

Still connected to psql, run:

```sql
SELECT table_schema, COUNT(*) AS table_count
FROM information_schema.tables
WHERE table_schema IN ('shared', 'certificates', 'patching', 'eol', 'system')
GROUP BY table_schema
ORDER BY table_schema;
```

You should see all 5 schemas with tables in each:

```
 table_schema | table_count
--------------+------------
 certificates |           1
 eol          |           1
 patching     |           4
 shared       |           2
 system       |           7
```

Stay connected for the next step.

---

## Step 4: Grant Database Permissions

The two users need different levels of access. Still connected to `psql` as the postgres superuser on the `ops_platform` database:

### 4.1 Grant read-only access to the API user

```sql
-- API user: can read all tables but cannot modify data
GRANT USAGE ON SCHEMA shared, certificates, patching, eol, system TO ops_api;
GRANT SELECT ON ALL TABLES IN SCHEMA shared, certificates, patching, eol, system TO ops_api;

-- Make sure future tables also get SELECT granted automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA shared, certificates, patching, eol, system
    GRANT SELECT ON TABLES TO ops_api;
```

### 4.2 Grant read-write access to the sync user

```sql
-- Sync user: can read and write all tables and use sequences (for auto-increment IDs)
GRANT USAGE ON SCHEMA shared, certificates, patching, eol, system TO ops_sync;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shared, certificates, patching, eol, system TO ops_sync;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA shared, certificates, patching, eol, system TO ops_sync;

-- Make sure future tables/sequences also get granted automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA shared, certificates, patching, eol, system
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ops_sync;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared, certificates, patching, eol, system
    GRANT USAGE, SELECT ON SEQUENCES TO ops_sync;

-- Sync user needs to execute functions (for resolve_server_name, record_unmatched_server, etc.)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA system TO ops_sync;
ALTER DEFAULT PRIVILEGES IN SCHEMA system
    GRANT EXECUTE ON FUNCTIONS TO ops_sync;

-- Sync user needs to execute patching functions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA patching TO ops_sync;
ALTER DEFAULT PRIVILEGES IN SCHEMA patching
    GRANT EXECUTE ON FUNCTIONS TO ops_sync;
```

### 4.3 Exit psql

```sql
\q
```

---

## Step 5: Verify the Database

Test that both users can connect and see what they should:

### 5.1 Test the API user

```cmd
psql -U ops_api -d ops_platform -c "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('shared','certificates','patching','eol','system') ORDER BY table_schema, table_name;"
```

Enter the `ops_api` password. You should see a list of all tables across all 5 schemas.

### 5.2 Test the sync user

```cmd
psql -U ops_sync -d ops_platform -c "SELECT sync_name, expected_schedule FROM system.sync_status ORDER BY sync_name;"
```

Enter the `ops_sync` password. You should see the 6 pre-seeded sync status entries:

```
       sync_name        | expected_schedule
------------------------+-------------------
 certificate_scan       | Daily 6:00 AM
 confluence_issues      | Daily 4:00 AM
 databricks_eol         | Daily 5:30 AM
 databricks_servers     | Daily 5:00 AM
 ivanti_patching        | Weekly Thursday
 patching_schedule_html | Daily 6:30 AM
```

If either test fails with a permission error, go back to Step 4 and re-run the GRANT statements.

---

## Step 6: Install the .NET 10 Hosting Bundle

The **.NET Hosting Bundle** is what allows IIS to run .NET applications. This is different from the SDK (which is for building).

### 6.1 Download the Hosting Bundle

Go to https://dotnet.microsoft.com/download/dotnet/10.0

On that page, find the **Hosting Bundle** under the "ASP.NET Core Runtime" section. It will be labelled something like:
> **Hosting Bundle** — Includes the ASP.NET Core Runtime and IIS support

Download and run the installer. It includes:
- The ASP.NET Core Runtime (runs your app)
- The ASP.NET Core IIS Module (connects IIS to your app)

### 6.2 Restart IIS

After the Hosting Bundle installs, you **must** restart IIS for it to detect the new module. Open an **elevated** (Administrator) command prompt and run:

```cmd
net stop was /y
net start w3svc
```

The first command stops IIS and all dependent services. The second starts the World Wide Web Publishing Service back up.

### 6.3 Verify installation

In the same command prompt, run:

```cmd
dotnet --list-runtimes
```

Look for a line like:
```
Microsoft.AspNetCore.App 10.0.x [C:\Program Files\dotnet\shared\Microsoft.AspNetCore.App]
```

If you see it, the hosting bundle is installed correctly.

---

## Step 7: Install the .NET 10 SDK (Build Machine)

You need the **.NET 10 SDK** to build and publish the application. This can be installed on the same server, or on a separate build machine.

### 7.1 Download the SDK

Go to https://dotnet.microsoft.com/download/dotnet/10.0 and download the **.NET 10 SDK** (not just the Runtime).

### 7.2 Install and verify

Run the installer, then open a **new** command prompt and run:

```cmd
dotnet --version
```

You should see `10.0.x`. The SDK includes the runtime, so if you install the SDK on the same machine as the Hosting Bundle, you have everything you need.

---

## Step 8: Publish the Application

Publishing compiles the C# code and creates a folder with everything needed to run the API.

### 8.1 Open a command prompt on the build machine

Navigate to the repository root:

```cmd
cd C:\Dev\GitHub\operations-api
```

### 8.2 Publish in Release mode

```cmd
dotnet publish -c Release -o C:\inetpub\operations-api
```

**What this does:**
- `-c Release` — builds in Release mode (optimized, no debug symbols)
- `-o C:\inetpub\operations-api` — outputs the published files to this directory

This will download NuGet packages (first time only), compile the code, and copy the output. It takes about 30-60 seconds.

### 8.3 Verify the publish output

```cmd
dir C:\inetpub\operations-api\OperationsApi.dll
```

You should see the DLL file. The folder will also contain `appsettings.json`, `web.config` (auto-generated), and various `.dll` files.

> **If building on a separate machine:** Copy the entire `C:\inetpub\operations-api` folder to the target server at the same path.

---

## Step 9: Configure Application Settings

The published `appsettings.json` needs to be updated with your production database password and site URL.

### 9.1 Open the settings file

Open this file in a text editor (e.g. Notepad):

```
C:\inetpub\operations-api\appsettings.json
```

### 9.2 Update the contents

Replace the file contents with:

```json
{
  "ConnectionStrings": {
    "OperationsDb": "Host=localhost;Port=5432;Database=ops_platform;Username=ops_api;Password=YOUR_API_PASSWORD_HERE"
  },
  "Authentication": {
    "Mode": "Windows"
  },
  "Cors": {
    "AllowedOrigins": [
      "https://YOUR-SERVER-HOSTNAME"
    ]
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information"
    }
  }
}
```

### 9.3 What to change

| Setting | What to put | Example |
|---------|------------|---------|
| `Password=` in ConnectionStrings | The `ops_api` password from Step 2 | `Password=MyStr0ngP@ss!` |
| `AllowedOrigins` | The URL where users will access the dashboard | `https://ops-api.contoso.com` |

**Important notes:**
- The CORS origin must match **exactly** what users type in their browser (including `https://` and port if non-standard)
- If you're also testing locally, you can add `http://localhost:8080` as a second origin
- **Never commit passwords to source control** — this file is only on the server

### 9.4 (Optional) Use a separate production settings file

For better security, create `appsettings.Production.json` alongside `appsettings.json`:

```json
{
  "ConnectionStrings": {
    "OperationsDb": "Host=localhost;Port=5432;Database=ops_platform;Username=ops_api;Password=YOUR_ACTUAL_PASSWORD"
  }
}
```

ASP.NET Core automatically merges `appsettings.Production.json` over `appsettings.json` when the `ASPNETCORE_ENVIRONMENT` variable is set to `Production`. This way the base file can stay in source control without secrets.

---

## Step 10: Enable IIS Features

IIS needs specific features enabled to host the application.

### 10.1 Open Server Manager

Press `Win`, type **Server Manager**, open it.

### 10.2 Add roles and features

1. Click **Manage** (top-right) > **Add Roles and Features**
2. Click **Next** through to **Server Roles**
3. Expand **Web Server (IIS)** and ensure these are checked:

**Under Web Server > Common HTTP Features:**
- [x] Default Document
- [x] Static Content
- [x] HTTP Errors

**Under Web Server > Security:**
- [x] **Windows Authentication** (this is critical — it's not enabled by default)

**Under Web Server > Application Development:**
- No specific features needed — the .NET Hosting Bundle installed the ASP.NET Core Module automatically

**Under Management Tools:**
- [x] IIS Management Console (so you can use the IIS Manager GUI)

4. Click **Next** and then **Install**
5. Wait for it to complete. A reboot is usually not required.

---

## Step 11: Create the IIS Application Pool

An Application Pool is the worker process that runs your API.

### 11.1 Open IIS Manager

Press `Win`, type **IIS**, open **Internet Information Services (IIS) Manager**.

### 11.2 Create the pool

1. In the left panel, click on your server name to expand it
2. Click **Application Pools**
3. In the right panel, click **Add Application Pool...**
4. Fill in:
   - **Name:** `OperationsApi`
   - **.NET CLR version:** Select **No Managed Code**
     > This is correct — ASP.NET Core runs its own runtime (Kestrel) and doesn't use the old .NET CLR
   - **Managed pipeline mode:** **Integrated**
5. Click **OK**

### 11.3 Configure advanced settings

1. Click the new `OperationsApi` pool in the list
2. In the right panel, click **Advanced Settings...**
3. Change these settings:
   - **Start Mode:** Change from `OnDemand` to `AlwaysRunning`
     > This prevents a slow first request after the app pool recycles
   - **Identity:** Click the `...` button. Choose one of:
     - **ApplicationPoolIdentity** (default, simplest — fine for most setups)
     - **A domain service account** if your organisation requires it
4. Click **OK**

---

## Step 12: Create the IIS Website

### 12.1 Add the website

1. In IIS Manager, right-click **Sites** in the left panel
2. Click **Add Website...**
3. Fill in:

| Field | Value |
|-------|-------|
| **Site name** | `OperationsApi` |
| **Application pool** | Click **Select...** and choose `OperationsApi` |
| **Physical path** | `C:\inetpub\operations-api` |
| **Binding type** | `https` (recommended) or `http` |
| **IP address** | All Unassigned |
| **Port** | `443` for HTTPS, or `80` for HTTP |
| **Host name** | Your chosen hostname (e.g. `ops-api.contoso.com`) |
| **SSL certificate** | Select your certificate (only shown for HTTPS) |

4. Click **OK**

### 12.2 If using HTTPS with a specific hostname

You may need to check **Require Server Name Indication** if you have multiple HTTPS sites on the same server.

### 12.3 If the Default Web Site is conflicting

If you get a port conflict error, the Default Web Site may be using port 80 or 443. Either:
- Stop the Default Web Site (right-click > Manage Website > Stop)
- Or use a different port for your site

---

## Step 13: Configure Authentication in IIS

### 13.1 Select the site

In IIS Manager, click on the `OperationsApi` site in the left panel.

### 13.2 Open Authentication settings

Double-click **Authentication** in the centre panel (under the IIS section).

### 13.3 Configure the authentication methods

You need to make exactly these changes:

| Method | Status |
|--------|--------|
| **Anonymous Authentication** | **Disabled** (right-click > Disable) |
| **Windows Authentication** | **Enabled** (right-click > Enable) |

> **Why?** The API uses Windows (Negotiate/Kerberos) authentication. If Anonymous is left enabled, users won't be prompted for credentials and the API won't know who they are.

### 13.4 Verify

After making these changes, the Authentication panel should show:

```
Anonymous Authentication     Disabled
Windows Authentication       Enabled
```

---

## Step 14: Deploy the Frontend

The frontend is a single HTML file that needs to be placed in the `wwwroot` folder inside the published application.

### 14.1 Create the wwwroot folder (if it doesn't exist)

```cmd
if not exist "C:\inetpub\operations-api\wwwroot" mkdir "C:\inetpub\operations-api\wwwroot"
```

### 14.2 Copy the frontend file

```cmd
copy "C:\Dev\GitHub\operations-api\frontend\index.html" "C:\inetpub\operations-api\wwwroot\index.html"
```

### 14.3 Update the API base URL in the frontend

Open `C:\inetpub\operations-api\wwwroot\index.html` in a text editor. Near the top of the `<script>` section (around line 440), find:

```javascript
const API_BASE = 'http://localhost:5000/api';
```

Change it to:

```javascript
const API_BASE = '/api';
```

Using a relative path (`/api`) means the frontend will call the API on the same host and port, which is correct when both are served from the same IIS site.

### 14.4 Enable static file serving in the API

The API needs middleware to serve the `index.html` file. Open `Program.cs` in the repository and add two lines after `app.UseCors();`:

```csharp
app.UseCors();
app.UseDefaultFiles();   // <-- add this line
app.UseStaticFiles();    // <-- add this line
```

Then re-publish the application:

```cmd
cd C:\Dev\GitHub\operations-api
dotnet publish -c Release -o C:\inetpub\operations-api
```

> **Note:** After re-publishing, re-copy the frontend file (Step 14.2) and re-check the API_BASE setting (Step 14.3), because `dotnet publish` may overwrite the wwwroot folder.

---

## Step 15: Verify the API and Frontend

### 15.1 Start (or restart) the site

In IIS Manager, right-click the `OperationsApi` site > **Manage Website** > **Restart**.

### 15.2 Test the health endpoint

Open a command prompt and run:

```cmd
curl -k --negotiate -u : https://localhost/healthz
```

**Expected response:** `Healthy`

**What the flags mean:**
- `-k` — accept self-signed certificates (remove this if you have a valid cert)
- `--negotiate -u :` — use Windows Authentication with the current user's credentials

If you see `Unhealthy`, the database connection is failing — check the connection string in `appsettings.json`.

### 15.3 Test an API endpoint

```cmd
curl -k --negotiate -u : https://localhost/api/health/summary
```

You should get a JSON response. The data may be mostly empty until the sync scripts run — that's expected.

### 15.4 Test the frontend

Open a browser on the server (or from another machine on the network) and navigate to:

```
https://YOUR-SERVER-HOSTNAME/
```

You should see the **GES Operations Dashboard** with tabs for Health, Servers, Patching, Certificates, and End of Life. Until the sync scripts run, the dashboard will show demo/placeholder data.

### 15.5 Check the API documentation (development only)

If you want to explore the API interactively, you can temporarily run in Development mode. Set the environment variable `ASPNETCORE_ENVIRONMENT=Development` in the IIS Application Pool's environment, then navigate to:

```
https://localhost/scalar/v1
```

This shows the Scalar API reference with all endpoints documented.

> **Remove this when done** — Development mode disables HSTS and may expose extra information.

---

## Step 16: Install Python

The sync scripts are written in Python and pull data from various sources into the PostgreSQL database.

### 16.1 Download Python

Go to https://www.python.org/downloads/ and download **Python 3.13** or later.

### 16.2 Run the installer

1. **Check "Add python.exe to PATH"** at the bottom of the first screen — this is critical
2. Click **Install Now** (or Customize if you want to change the install location)
3. Wait for it to complete

### 16.3 Verify

Open a **new** command prompt and run:

```cmd
python --version
```

You should see `Python 3.13.x` (or whichever version you installed).

Also verify pip:

```cmd
pip --version
```

---

## Step 17: Create the Python Virtual Environment

A virtual environment keeps the sync script dependencies isolated from the system Python.

### 17.1 Navigate to the sync directory

```cmd
cd C:\Dev\GitHub\operations-api\sync
```

### 17.2 Create the virtual environment

```cmd
python -m venv venv
```

This creates a `venv` folder containing a self-contained Python environment.

### 17.3 Activate the virtual environment

```cmd
venv\Scripts\activate
```

Your command prompt should now show `(venv)` at the beginning:
```
(venv) C:\Dev\GitHub\operations-api\sync>
```

### 17.4 Install dependencies

```cmd
pip install -r requirements.txt
```

This installs:
- `psycopg2-binary` — PostgreSQL database driver
- `requests` — HTTP client for fetching data from Databricks and HTML pages
- `pandas` — Data processing for Excel/CSV files
- `openpyxl` — Excel file reading
- `beautifulsoup4` — HTML parsing for the patching schedule page
- `lxml` — Fast HTML/XML parser used by BeautifulSoup

You should see output ending with `Successfully installed ...`

### 17.5 Verify the installation

```cmd
python -c "import psycopg2; import requests; import pandas; import bs4; print('All packages OK')"
```

Should print: `All packages OK`

---

## Step 18: Configure Sync Environment Variables

The sync scripts read database credentials and data source credentials from environment variables.

### 18.1 Required variables

Set these as **System environment variables** on the server:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `OPS_DB_HOST` | PostgreSQL host | `localhost` |
| `OPS_DB_PORT` | PostgreSQL port | `5432` |
| `OPS_DB_NAME` | Database name | `ops_platform` |
| `OPS_DB_USER` | Sync user (from Step 2) | `ops_sync` |
| `OPS_DB_PASSWORD` | Sync user password | *(the password you set)* |
| `DATABRICKS_HOST` | Databricks workspace URL | `your-workspace.azuredatabricks.net` |
| `DATABRICKS_TOKEN` | Databricks Personal Access Token | *(your PAT)* |
| `DATABRICKS_WAREHOUSE_ID` | SQL warehouse ID | *(your warehouse ID)* |

**For Confluence sync (optional):**

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `CONFLUENCE_URL` | Confluence server URL | `https://confluence.contoso.com` |
| `CONFLUENCE_TOKEN` | Confluence API bearer token | *(your token)* |
| `CONFLUENCE_PARENT_PAGE_ID` | Parent page ID for known issues | *(page ID)* |

### 18.2 How to set system environment variables

1. Press `Win+R`, type `sysdm.cpl`, press Enter
2. Click **Advanced** tab > **Environment Variables**
3. Under **System variables**, click **New** for each variable:
   - Variable name: `OPS_DB_HOST`
   - Variable value: `localhost`
4. Repeat for each variable
5. Click **OK** on all dialogs

> **Important:** You must open a **new** command prompt after setting environment variables for them to take effect. Existing command prompts won't see the changes.

### 18.3 Verify the variables are set

Open a new command prompt and run:

```cmd
echo %OPS_DB_HOST%
echo %OPS_DB_NAME%
echo %OPS_DB_USER%
```

Each should print the value you set (not the variable name).

---

## Step 19: Test Sync Scripts Manually

Test each sync script with `--dry-run` first, which parses and processes the data but doesn't write to the database.

### 19.1 Activate the virtual environment

```cmd
cd C:\Dev\GitHub\operations-api\sync
venv\Scripts\activate
```

### 19.2 Dry run the server sync

```cmd
python servers/sync_server_list.py --dry-run --verbose
```

This connects to Databricks, pulls the server list, and shows what it would insert — without touching the database. If it succeeds, you'll see log output like:
```
INFO - Starting sync: databricks_servers
INFO - Querying Databricks for server list...
INFO - Retrieved 342 servers
INFO - DRY RUN - no changes committed
```

### 19.3 Dry run the other sync scripts

```cmd
python eol/sync_eol_software.py --dry-run --verbose
python patching/sync_patching_schedule.py --dry-run --verbose
```

The certificate sync requires a CSV file from PowerShell:
```cmd
python certificates/sync_certificates.py --csv "path\to\SSL-CertExpiry-*.csv" --dry-run --verbose
```

### 19.4 Run for real (without --dry-run)

Once dry runs succeed, run without `--dry-run` to actually write to the database:

```cmd
python servers/sync_server_list.py --verbose
python eol/sync_eol_software.py --verbose
python patching/sync_patching_schedule.py --verbose
```

### 19.5 Verify data landed in the database

```cmd
psql -U ops_api -d ops_platform -c "SELECT sync_name, status, records_processed FROM system.sync_status WHERE status != 'unknown';"
```

You should see rows with `status = 'success'` and a non-zero `records_processed` count.

### 19.6 Check the dashboard

Refresh the frontend in your browser — you should now see real data instead of demo data.

---

## Step 20: Set Up Azure DevOps Pipelines

The sync scripts should run automatically on a schedule. This is done via Azure DevOps Pipelines running on the self-hosted agent on the server.

### 20.1 Understand the pipeline structure

The repository already contains pipeline YAML files:

```
devops/pipelines/
  ops-sync-servers.yml            -- Daily at 05:00 UTC
  ops-sync-eol.yml                -- Daily at 05:30 UTC
  ops-sync-certificates.yml       -- Daily at 06:00 UTC
  ops-sync-patching-schedule.yml  -- Daily at 06:30 UTC
  templates/
    ops-sync-steps.yml            -- Shared template used by the above
```

The order matters — server sync runs first because other scripts depend on having servers in the database for name resolution.

### 20.2 Create the variable group

Pipelines read secrets from an Azure DevOps Variable Group — this keeps passwords out of the YAML files.

1. Go to your Azure DevOps project in the browser
2. Click **Pipelines** in the left navigation
3. Click **Library**
4. Click **+ Variable group**
5. Name it: `operations-sync-secrets`
6. Add each variable:

| Name | Value | Secret? |
|------|-------|---------|
| `OPS_DB_HOST` | `localhost` | No |
| `OPS_DB_PORT` | `5432` | No |
| `OPS_DB_NAME` | `ops_platform` | No |
| `OPS_DB_USER` | `ops_sync` | No |
| `OPS_DB_PASSWORD` | *(your sync password)* | **Yes** (click the lock icon) |
| `DATABRICKS_HOST` | *(your workspace URL)* | No |
| `DATABRICKS_TOKEN` | *(your PAT)* | **Yes** |
| `DATABRICKS_WAREHOUSE_ID` | *(your warehouse ID)* | No |

7. Click **Save**

> **Locked variables** are encrypted and masked in logs — always lock passwords and tokens.

### 20.3 Create the pipelines

For each pipeline YAML file, create a pipeline in Azure DevOps:

1. Go to **Pipelines** > **New pipeline**
2. Click **Azure Repos Git** (or wherever your repo is hosted)
3. Select the `operations-api` repository
4. Click **Existing Azure Pipelines YAML file**
5. Select the branch (`main`) and the path (e.g. `/devops/pipelines/ops-sync-servers.yml`)
6. Click **Continue**, then **Save** (not "Run" — let the schedule trigger it)
7. Give the pipeline a descriptive name (e.g. "Ops - Server Sync")

Repeat for each of the 4 pipeline files:

| Pipeline YAML | Suggested Name | Schedule |
|---------------|---------------|----------|
| `ops-sync-confluence.yml` | Ops - Confluence Sync | Daily 04:00 UTC |
| `ops-sync-servers.yml` | Ops - Server Sync | Daily 05:00 UTC |
| `ops-sync-eol.yml` | Ops - EOL Sync | Daily 05:30 UTC |
| `ops-sync-certificates.yml` | Ops - Certificate Scan | Daily 06:00 UTC |
| `ops-sync-patching-schedule.yml` | Ops - Patching Sync | Daily 06:30 UTC |
| `ops-alert-unmatched.yml` | Ops - Unmatched Alert | Daily 07:00 UTC |
| `ops-health-alert.yml` | Ops - Health Alert | Daily 08:00 UTC |
| `ops-run-tests.yml` | Ops - Unit Tests | On push/PR to `sync/**` |

The build and deploy pipelines for the .NET API are covered separately in Step 23.

### 20.4 Authorize the variable group

The first time a pipeline runs, Azure DevOps will ask you to authorize access to the `operations-sync-secrets` variable group. Click **Permit** when prompted.

### 20.5 Verify the self-hosted agent is online

1. Go to **Project Settings** (bottom-left) > **Agent pools**
2. Click the **Default** pool (or whichever pool name is in the YAML files)
3. Click the **Agents** tab
4. Confirm your server's agent shows as **Online**

If the agent is offline, check that the Azure DevOps Agent service is running on the server (look for `vstsagent.*` in Services).

### 20.6 Test by running manually

You can trigger any pipeline manually to test it:

1. Go to **Pipelines**, click the pipeline name
2. Click **Run pipeline**
3. Click **Run**
4. Watch the output — it should show the Python script running and completing successfully

---

## Step 21: Seed Sync Status Records

The database schema (`005-system-health-schema.sql`) already inserts initial sync status records. Verify they exist:

```cmd
psql -U ops_sync -d ops_platform -c "SELECT sync_name, sync_type, expected_schedule, max_age_hours FROM system.sync_status ORDER BY sync_name;"
```

You should see 6 rows. If any are missing (e.g. if you re-ran the schema), insert them:

```cmd
psql -U ops_sync -d ops_platform -c "INSERT INTO system.sync_status (sync_name, sync_type, expected_schedule, max_age_hours, min_expected_records) VALUES ('databricks_servers', 'scheduled', 'Daily 5:00 AM', 24, 50), ('databricks_eol', 'scheduled', 'Daily 5:30 AM', 24, 10), ('confluence_issues', 'scheduled', 'Daily 4:00 AM', 24, 1), ('certificate_scan', 'scheduled', 'Daily 6:00 AM', 24, 10), ('ivanti_patching', 'triggered', 'Weekly Thursday', 168, 50), ('patching_schedule_html', 'scheduled', 'Daily 6:30 AM', 48, 50) ON CONFLICT (sync_name) DO NOTHING;"
```

---

## Step 22: Post-Deployment Verification

### Checklist

Go through each item and confirm it works:

- [ ] **PostgreSQL** — Service running, accessible on port 5432
- [ ] **Database** — All 5 schemas have tables (`shared`, `certificates`, `patching`, `eol`, `system`)
- [ ] **DB Users** — `ops_api` can SELECT, `ops_sync` can INSERT/UPDATE/DELETE
- [ ] **IIS Site** — Running, bound to your hostname on port 443 (or 80)
- [ ] **Authentication** — Windows Auth enabled, Anonymous Auth disabled
- [ ] **Health endpoint** — `https://YOUR-SERVER/healthz` returns `Healthy`
- [ ] **API endpoint** — `https://YOUR-SERVER/api/health/summary` returns JSON
- [ ] **Frontend** — `https://YOUR-SERVER/` loads the GES Operations Dashboard
- [ ] **Data populated** — After sync scripts run, the dashboard shows real data
- [ ] **Sync history** — `system.sync_history` has rows with `status = 'completed'`
- [ ] **Azure DevOps** — Pipelines are created and scheduled, agent is online
- [ ] **Environment vars** — All `OPS_DB_*` and `DATABRICKS_*` variables set as system vars
- [ ] **CI/CD (optional)** — Build and deploy pipelines created (Step 23), `operations-api-prod` variable group configured, `ASPNETCORE_ENVIRONMENT=Production` set on app pool

### Useful diagnostic commands

```cmd
:: ============ IIS ============

:: Check if the IIS site is running
%windir%\system32\inetsrv\appcmd list site

:: Check if the application pool is running
%windir%\system32\inetsrv\appcmd list apppool

:: View stdout logs (if the app writes to a log file)
type C:\inetpub\operations-api\logs\*.log

:: ============ PostgreSQL ============

:: Check recent sync history (last 10 runs)
psql -U ops_api -d ops_platform -c "SELECT sync_name, status, started_at, completed_at, records_processed FROM system.sync_history ORDER BY started_at DESC LIMIT 10;"

:: Check current sync status
psql -U ops_api -d ops_platform -c "SELECT sync_name, status, last_success_at, consecutive_failures FROM system.sync_status;"

:: Check how many servers are in the inventory
psql -U ops_api -d ops_platform -c "SELECT COUNT(*) AS total_servers, COUNT(*) FILTER (WHERE is_active) AS active_servers FROM shared.servers;"

:: Check for unmatched servers that need resolution
psql -U ops_api -d ops_platform -c "SELECT server_name_raw, source_system, occurrence_count FROM system.unmatched_servers WHERE status = 'pending' ORDER BY occurrence_count DESC LIMIT 20;"

:: Run validation rules to check data quality
psql -U ops_api -d ops_platform -c "SELECT * FROM system.run_validation();"

:: ============ Python Sync ============

:: Activate the virtual environment
cd C:\Dev\GitHub\operations-api\sync
venv\Scripts\activate

:: Run any sync script in dry-run mode to test
python servers/sync_server_list.py --dry-run --verbose
```

---

## Step 23: Set Up CI/CD Pipelines (Build and Deploy)

Steps 1–22 set up the server manually. This step automates future deployments so that code changes go through a repeatable build → approve → deploy pipeline instead of manual `dotnet publish` and file copying.

**What this gives you:**
- Push code → API builds automatically → you see pass/fail in Azure DevOps
- Click "Run pipeline" on the deploy pipeline → approve → API deploys to IIS with backup and health check
- Database migrations run automatically on every deploy
- Secrets stay in Azure DevOps, never in source control

### 23.1 ASP.NET Core environment (already handled)

The deploy pipeline generates an `appsettings.Production.json` file on the server with your connection string and CORS origins. ASP.NET Core only loads this file when it knows it's running in Production mode.

This is already configured via `web.config` in the repository root — it sets `ASPNETCORE_ENVIRONMENT` to `Production` automatically. When `dotnet publish` runs, this file is included in the output. **No manual IIS configuration is needed.**

You can verify this after the first deployment by checking:

```cmd
type C:\inetpub\operations-api\web.config
```

Look for `<environmentVariable name="ASPNETCORE_ENVIRONMENT" value="Production" />` inside the `<aspNetCore>` element.

### 23.2 Create the deployment variable group

This is a **separate** variable group from `operations-sync-secrets` (which you created in Step 20). The sync variable group has credentials for Python scripts. This new one has credentials for the .NET API deployment.

1. Go to your Azure DevOps project
2. Click **Pipelines** > **Library**
3. Click **+ Variable group**
4. Name it: `operations-api-prod`
5. Add each variable:

| Name | Value | Secret? | Notes |
|------|-------|---------|-------|
| `OPS_DB_HOST` | `localhost` | No | Same as sync group |
| `OPS_DB_PORT` | `5432` | No | Same as sync group |
| `OPS_DB_NAME` | `ops_platform` | No | Same as sync group |
| `OPS_DB_MIGRATE_USER` | `ops_sync` | No | User that runs the SQL migration scripts |
| `OPS_DB_PASSWORD` | *(the ops_sync password from Step 2)* | **Yes** | Click the lock icon to encrypt |
| `OPS_CONNECTIONSTRING` | *(see below)* | **Yes** | Full connection string for the .NET API |
| `OPS_CORS_ORIGINS` | *(see below)* | No | Comma-separated URLs |

6. Click **Save**

**How to build the `OPS_CONNECTIONSTRING` value:**

```
Host=localhost;Port=5432;Database=ops_platform;Username=ops_api;Password=YOUR_API_PASSWORD_HERE
```

Replace `YOUR_API_PASSWORD_HERE` with the `ops_api` password you set in Step 2. This is the same connection string from your `appsettings.json` (Step 9), but now it lives in Azure DevOps instead of on disk.

**How to set `OPS_CORS_ORIGINS`:**

Enter the URL(s) where users access the dashboard, separated by commas. For example:

```
https://ops-api.contoso.com
```

Or if you have multiple:

```
https://ops-api.contoso.com,https://ops-api-backup.contoso.com
```

These must match exactly what users type in their browser (including `https://`).

### 23.3 Create the deployment environment with approval gate

An Environment in Azure DevOps is a named target for deployments. By adding an approval check, you ensure that someone must explicitly approve each deploy before it runs — no accidental deployments.

1. In Azure DevOps, click **Pipelines** > **Environments**
2. Click **New environment**
3. Fill in:
   - **Name:** `operations-api-prod`
   - **Description:** `Production IIS deployment for Operations API`
   - **Resource:** None
4. Click **Create**
5. Once created, click the **⋮** (three dots) menu in the top-right of the environment page
6. Click **Approvals and checks**
7. Click **+ Add check** (or the `+` button)
8. Select **Approvals**
9. In the **Approvers** field, add yourself (and anyone else who should be able to approve deployments)
10. Optionally set **Timeout** to something reasonable (e.g. 72 hours — the deploy will auto-reject if nobody approves within that window)
11. Click **Create**

Now whenever the deploy pipeline targets this environment, it will pause and wait for your approval before proceeding.

### 23.4 Create the Build pipeline

The build pipeline (CI) triggers automatically when you push code changes. It compiles the .NET API and packages everything needed for deployment into an artifact.

1. Go to **Pipelines** > **New pipeline**
2. Select your repository source (Azure Repos Git, GitHub, etc.)
3. Select the `operations-api` repository
4. Click **Existing Azure Pipelines YAML file**
5. Select branch: `main`
6. Select path: `/devops/pipelines/ops-api-build.yml`
7. Click **Continue**
8. **Do not click "Run" yet** — click **Save** (the dropdown arrow next to Run)
9. After saving, click **⋮** (three dots) > **Rename/move**
10. Rename to: `ops-api-build`

> **Important:** The name `ops-api-build` matters — the deploy pipeline references it by this name when downloading the build artifact. If you use a different name, update the `pipeline:` value in `ops-api-deploy.yml` to match.

**What triggers this pipeline:**
- Any push to `main` or `feature/*` branches that changes `.cs`, `.csproj`, `frontend/`, or `database/` files
- Any pull request targeting `main` with those same file changes
- Changes to Python sync scripts do **not** trigger this pipeline (they have their own test pipeline)

### 23.5 Test the Build pipeline

1. Go to **Pipelines**, click `ops-api-build`
2. Click **Run pipeline**
3. Leave defaults and click **Run**
4. Watch the steps complete:
   - **Install .NET 10 SDK** — downloads/confirms SDK availability
   - **Restore NuGet packages** — pulls dependencies (Dapper, Npgsql, etc.)
   - **Build** — compiles the C# code in Release mode
   - **Publish API** — creates the deployable output
   - **Copy frontend** — adds `index.html` to the artifact
   - **Copy database scripts** — adds the SQL migration files
   - **Publish artifact** — bundles everything into a downloadable artifact

5. After the pipeline completes (green checkmark), click the run and look for the **Artifacts** section (usually shown as "1 published" near the top). Click it to verify the artifact contains three folders:
   - `api/` — compiled .NET DLLs, `web.config`, etc.
   - `frontend/` — `index.html`
   - `database/` — all `.sql` files

If any step fails, check the log output. Common issues:
- ".NET SDK not found" → the self-hosted agent needs the .NET 10 SDK installed (Step 7)
- "Build errors" → fix the C# code and push again

### 23.6 Create the Deploy pipeline

1. Go to **Pipelines** > **New pipeline**
2. Select your repository
3. Click **Existing Azure Pipelines YAML file**
4. Select branch: `main`, path: `/devops/pipelines/ops-api-deploy.yml`
5. Click **Continue**, then **Save** (not Run)
6. Rename to: `ops-api-deploy`

**Grant the pipeline access to the variable group:**

7. Go to **Pipelines** > **Library**
8. Click the `operations-api-prod` variable group
9. Click **Pipeline permissions** (tab at the top)
10. Click **+** and add the `ops-api-deploy` pipeline
11. Click **Save**

### 23.7 Run the first deployment

> **Before running:** Make sure Steps 1–15 are complete — the IIS site, app pool, and database must already exist. The deploy pipeline updates an existing installation; it does not create IIS sites from scratch.

1. Go to **Pipelines**, click `ops-api-deploy`
2. Click **Run pipeline**
3. You'll see two parameters:
   - **Build pipeline run ID:** Leave empty (uses the latest successful build)
   - **Skip database migrations:** Leave unchecked
4. Click **Run**
5. The pipeline will pause at the **Deploy to Production** stage with a message: "This stage is waiting for approval"
6. Click **Review** > **Approve**
7. Watch the steps:

| Step | What to watch for |
|------|-------------------|
| **Download build artifact** | "Successfully downloaded artifacts" |
| **Run database migrations** | Each SQL file prints "OK". "All migrations complete" at the end |
| **Stop IIS app pool** | "Stopped app pool: OperationsApi" |
| **Backup current deployment** | "Backing up to: C:\inetpub\operations-api.backup.YYYYMMDD-HHmmss" |
| **Deploy API to IIS** | "API files deployed" |
| **Write appsettings.Production.json** | "Wrote C:\inetpub\operations-api\appsettings.Production.json" |
| **Deploy frontend** | "Frontend deployed to ...\wwwroot\index.html" |
| **Start IIS app pool** | "Started app pool: OperationsApi" |
| **Health check** | "Deployment verified - API is healthy" |

If the health check fails, the pipeline shows a red X. Check:
- Is the connection string correct in the `operations-api-prod` variable group?
- Is PostgreSQL running?
- Is `ASPNETCORE_ENVIRONMENT` set to `Production` on the app pool? (Step 23.1)

### 23.8 Verify the deployment

After a successful deploy, confirm everything works:

1. **Health endpoint:**
   ```cmd
   curl -k --negotiate -u : https://localhost/healthz
   ```
   Should return: `Healthy`

2. **API endpoint:**
   ```cmd
   curl -k --negotiate -u : https://localhost/api/health
   ```
   Should return JSON with sync statuses

3. **Frontend:** Open `https://YOUR-SERVER-HOSTNAME/` in a browser — the dashboard should load

4. **Check the backup exists:**
   ```cmd
   dir C:\inetpub\operations-api.backup.*
   ```
   You should see a timestamped backup folder

### 23.9 How rollback works

If a deployment breaks something, you can roll back to the previous version in about 30 seconds:

1. **Stop the app pool:**
   ```cmd
   %windir%\system32\inetsrv\appcmd stop apppool /apppool.name:OperationsApi
   ```

2. **Swap folders:**
   ```cmd
   :: Rename the broken deployment out of the way
   ren C:\inetpub\operations-api operations-api.broken

   :: Rename the backup to the active path
   ren C:\inetpub\operations-api.backup.YYYYMMDD-HHmmss operations-api
   ```
   Replace `YYYYMMDD-HHmmss` with the actual backup timestamp (use `dir C:\inetpub\operations-api.backup.*` to find it).

3. **Start the app pool:**
   ```cmd
   %windir%\system32\inetsrv\appcmd start apppool /apppool.name:OperationsApi
   ```

4. **Verify:**
   ```cmd
   curl -k --negotiate -u : https://localhost/healthz
   ```

The pipeline keeps the last 3 backups automatically. Older backups are cleaned up on each deploy.

> **Note on database rollback:** The deploy pipeline runs database migrations (adding new tables, columns, functions) but these are always additive — they add things, never remove them. Rolling back the API files is safe because the old code works with the new schema (the old code simply doesn't use the new columns/tables). If a migration genuinely breaks something, you'll need to manually reverse it with psql.

---

## Updating the Application

With CI/CD pipelines set up (Step 23), the update process is now:

### Standard update (recommended)

1. Push your code changes to the `main` branch (or merge a PR)
2. The **build pipeline** (`ops-api-build`) triggers automatically
3. Wait for it to complete (green checkmark — usually 1-2 minutes)
4. Go to the **deploy pipeline** (`ops-api-deploy`) and click **Run pipeline**
5. Click **Run**, then **Approve** when prompted
6. The deploy pipeline handles everything: migrations, backup, file copy, config, health check

### Manual update (without pipelines)

If the pipelines are not set up yet, or for emergency fixes:

```cmd
cd C:\Dev\GitHub\operations-api

:: Pull latest code (if using git)
git pull

:: Re-publish
dotnet publish -c Release -o C:\inetpub\operations-api

:: Re-copy the frontend (publish may overwrite wwwroot)
copy frontend\index.html C:\inetpub\operations-api\wwwroot\index.html
```

Then update `API_BASE` in the deployed `index.html` if needed (see Step 14.3).

Restart the IIS site in IIS Manager or run:

```cmd
%windir%\system32\inetsrv\appcmd stop site /site.name:OperationsApi
%windir%\system32\inetsrv\appcmd start site /site.name:OperationsApi
```

### Update the database schema

If a schema file has changed, see the [Applying Database Migrations](#applying-database-migrations) section for the full procedure. Quick version:

```cmd
psql -U postgres -d ops_platform -f "C:/Dev/GitHub/operations-api/database/006-eol-schema.sql"
```

Most schema objects use `CREATE ... IF NOT EXISTS` and `ON CONFLICT DO NOTHING/UPDATE`, so re-running is generally safe. Always re-grant permissions afterward.

> **With CI/CD:** The deploy pipeline runs all migration scripts automatically. You don't need to do this manually unless you're skipping the pipeline.

### Update Python sync dependencies

```cmd
cd C:\Dev\GitHub\operations-api\sync
venv\Scripts\activate
pip install -r requirements.txt --upgrade
```

---

## Applying Database Migrations

When schema files are updated (new tables, views, functions, validation rules), you need to re-apply the changed scripts to the Group App Server's database. The scripts are designed to be idempotent — `CREATE ... IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, and `CREATE OR REPLACE` — so re-running them is safe.

### Which scripts changed?

Check git for what's changed since the last deployment:

```cmd
cd C:\Dev\GitHub\operations-api
git log --oneline --name-only -- database/
```

Or compare against the migration tracking table:

```cmd
psql -U ops_api -d ops_platform -c "SELECT script_name, applied_at FROM system.schema_migrations ORDER BY script_name;"
```

### Apply changed scripts

Connect as the postgres superuser and run each changed script:

```cmd
psql -U postgres -d ops_platform
```

```sql
-- Example: re-apply changed certificate schema (updated expiry function + view)
\i 'C:/Dev/GitHub/operations-api/database/003-certificates-schema.sql'

-- Example: re-apply system health schema (new validation rules)
\i 'C:/Dev/GitHub/operations-api/database/005-system-health-schema.sql'

-- Example: re-apply EOL schema (updated v_at_risk_servers view with alias resolution)
\i 'C:/Dev/GitHub/operations-api/database/006-eol-schema.sql'

-- Example: add machine_name to EOL software table (idempotent — safe to re-run)
\i 'C:/Dev/GitHub/operations-api/database/008-eol-add-machine-name.sql'
```

> **Important:** Always run scripts in numerical order. If you need to re-run `003`, `005`, and `006`, run them in that order.

### Record the migration

After applying scripts, update the migration tracking table:

```sql
INSERT INTO system.schema_migrations (script_name, description) VALUES
    ('003-certificates-schema.sql', 'Updated: NULL valid_to flagged as CRITICAL, view includes NULL certs'),
    ('005-system-health-schema.sql', 'Updated: Added certs_server_id_mismatch validation rule'),
    ('006-eol-schema.sql', 'Updated: v_at_risk_servers resolves server aliases'),
    ('008-eol-add-machine-name.sql', 'Added machine_name column, updated unique index and views')
ON CONFLICT (script_name) DO UPDATE SET
    applied_at = CURRENT_TIMESTAMP,
    applied_by = CURRENT_USER,
    description = EXCLUDED.description;
```

### Verify the changes took effect

```cmd
:: Check the updated certificate function handles NULL valid_to
psql -U ops_api -d ops_platform -c "SELECT certificates.refresh_expiry_calculations();"

:: Check the new validation rule exists
psql -U ops_api -d ops_platform -c "SELECT rule_name, severity FROM system.validation_rules WHERE rule_name = 'certs_server_id_mismatch';"

:: Check the EOL view resolves aliases (should join system.server_aliases)
psql -U ops_api -d ops_platform -c "SELECT pg_get_viewdef('eol.v_at_risk_servers'::regclass, true);" 2>&1 | head -5
```

### Re-grant permissions after schema changes

If new tables, views, or functions were added, re-run the permission grants to ensure both users can access them:

```cmd
psql -U postgres -d ops_platform
```

```sql
-- Re-grant to API user (read-only)
GRANT SELECT ON ALL TABLES IN SCHEMA shared, certificates, patching, eol, system TO ops_api;

-- Re-grant to sync user (read-write)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shared, certificates, patching, eol, system TO ops_sync;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA shared, certificates, patching, eol, system TO ops_sync;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA system TO ops_sync;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA patching TO ops_sync;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA certificates TO ops_sync;
```

> **With CI/CD:** The deploy pipeline (`ops-api-deploy.yml`) runs all migration scripts automatically and handles permissions. You only need to do this manually if deploying without the pipeline.

---

## Troubleshooting

### IIS / API Errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| **502.5 error** in browser | .NET Hosting Bundle not installed or IIS not restarted after install | Install the Hosting Bundle (Step 6), then run `net stop was /y` and `net start w3svc` |
| **500.30 error** in browser | The app crashed on startup — usually a bad connection string or missing config | Check `appsettings.json` connection string. Check Windows Event Log > Application for the error message |
| **500.0 error** with "ANCM In-Process Handler Load Failure" | Wrong .NET version or missing runtime | Run `dotnet --list-runtimes` and confirm `Microsoft.AspNetCore.App 10.0.x` exists |
| **401 Unauthorized** | Windows Auth not configured correctly | Check IIS Authentication settings (Step 13). Ensure Anonymous is disabled and Windows Auth is enabled |
| **403 Forbidden** | The app pool identity doesn't have permission to the physical path | Right-click `C:\inetpub\operations-api` > Properties > Security > Add the app pool identity with Read & Execute |
| **healthz returns Unhealthy** | PostgreSQL connection failing | Check the connection string password. Check PostgreSQL service is running. Check `pg_hba.conf` allows the connection |
| **Frontend shows "Demo Data"** | API calls failing — the frontend falls back to embedded demo data | Open browser DevTools (F12) > Network tab. Look for failed API calls to `/api/`. Check CORS origins match the browser URL. Check `API_BASE` in `index.html` |
| **CORS error** in browser console | The frontend URL isn't in `AllowedOrigins` | Add the exact browser URL to `Cors:AllowedOrigins` in `appsettings.json`, then restart the site |

### PostgreSQL Errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| **"password authentication failed"** | Wrong password in connection string or environment variable | Double-check the password. You can reset it: `psql -U postgres -c "ALTER USER ops_api PASSWORD 'new_password';"` |
| **"database ops_platform does not exist"** | Database not created yet | Go to Step 2 |
| **"relation does not exist"** | Schema scripts not run, or run out of order | Go to Step 3 and run all scripts in order |
| **"permission denied for table"** | GRANT statements not run | Go to Step 4 and re-run the GRANTs |
| **"could not connect to server"** | PostgreSQL service not running, or wrong host/port | Check the PostgreSQL service in Services. Check `OPS_DB_HOST` and `OPS_DB_PORT` |
| **"FATAL: no pg_hba.conf entry"** | PostgreSQL not configured to accept connections from this host | Edit `pg_hba.conf` (in the PostgreSQL data directory) and add a line for your host. Reload PostgreSQL: `pg_ctl reload` |

### Python Sync Errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| **"ModuleNotFoundError: No module named 'psycopg2'"** | Dependencies not installed or venv not activated | Activate the venv (`venv\Scripts\activate`) and run `pip install -r requirements.txt` |
| **"Database user not configured"** | `OPS_DB_USER` environment variable not set | Set the environment variable (Step 18). Open a new command prompt after setting it |
| **"Database password not configured"** | `OPS_DB_PASSWORD` environment variable not set | Set the environment variable (Step 18) |
| **Databricks connection error** | PAT expired, wrong host, or warehouse not running | Check `DATABRICKS_TOKEN` hasn't expired. Verify `DATABRICKS_HOST`. Check the SQL warehouse is started in the Databricks UI |
| **"No servers found in HTML page"** | The patching schedule HTML page structure changed | Check the URL is accessible: `curl http://contosodeployment.contoso.com/patching%20schedule.htm`. The parser expects `<h2>` headings with "Shavlik" and `<table>` elements |
| **Sync shows 0 records processed** | Source returned empty data | Check the source system directly (Databricks query, HTML page, CSV file) to confirm data exists |

### Azure DevOps Pipeline Errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| **"No agents found in pool 'Default'"** | Agent offline or wrong pool name | Check the agent is running (Services > look for `vstsagent`). Verify the pool name in the YAML matches the agent's pool |
| **"Variable group not authorized"** | Pipeline hasn't been granted access to the variable group | Click **Permit** when prompted, or go to Library > variable group > Pipeline permissions > Allow |
| **"Python was not found"** | `UsePythonVersion` task can't find Python 3.13 | Install Python 3.13 on the agent machine (Step 16). Or remove the `UsePythonVersion` task and ensure Python is in PATH |
| **Pipeline never runs on schedule** | Schedule only triggers on commits to the specified branch | Make sure the YAML has `always: true` under the schedule. Push at least one commit to the `main` branch |

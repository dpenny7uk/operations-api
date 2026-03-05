# Operations API - Deployment Guide

**Target:** Windows Server with IIS, .NET 10, PostgreSQL
**Server:** Group Application Server (self-hosted Azure DevOps agent)

---

## Prerequisites

Before starting, ensure you have:
- Administrator access to the Group Application Server
- The `operations-api` repository cloned or copied to the server
- Internet access for downloading installers (or offline installers pre-downloaded)

---

## Step 1: Install PostgreSQL

1. Download PostgreSQL 16+ from https://www.postgresql.org/download/windows/
2. Run the installer:
   - Install directory: accept default or choose your standard location
   - Data directory: accept default
   - Set a **superuser password** for the `postgres` account - save this securely
   - Port: `5432` (default)
   - Locale: default
3. Ensure the PostgreSQL Windows service is set to **Automatic** startup
4. Add PostgreSQL `bin` directory to the system PATH (e.g. `C:\Program Files\PostgreSQL\16\bin`)

### Create the application database and user

Open a command prompt and run:

```cmd
psql -U postgres
```

Then execute:

```sql
-- Create the application database
CREATE DATABASE ops_platform;

-- Create the API service account
CREATE USER ops_api WITH PASSWORD 'YOUR_SECURE_PASSWORD_HERE';

-- Create the sync service account
CREATE USER ops_sync WITH PASSWORD 'YOUR_SECURE_PASSWORD_HERE';

-- Grant connect permissions
GRANT CONNECT ON DATABASE ops_platform TO ops_api;
GRANT CONNECT ON DATABASE ops_platform TO ops_sync;

\q
```

---

## Step 2: Run Database Schema Scripts

Connect to the new database and run the schema files **in order**. Each file depends on objects created by the previous ones.

```cmd
psql -U postgres -d ops_platform
```

Run each file in sequence:

```sql
\i 'C:/Dev/GitHub/operations-api/database/000-extensions.sql'
\i 'C:/Dev/GitHub/operations-api/database/001-common.sql'
\i 'C:/Dev/GitHub/operations-api/database/002-shared-schema.sql'
\i 'C:/Dev/GitHub/operations-api/database/003-certificates-schema.sql'
\i 'C:/Dev/GitHub/operations-api/database/004-patching-schema.sql'
\i 'C:/Dev/GitHub/operations-api/database/005-system-health-schema.sql'
\i 'C:/Dev/GitHub/operations-api/database/006-eol-schema.sql'
```

> **Important:** Use forward slashes in the paths even on Windows when using `psql`.

### Grant permissions to application users

Still connected to `ops_platform`:

```sql
-- API user: read-only access to all schemas
GRANT USAGE ON SCHEMA shared, certificates, patching, eol, system TO ops_api;
GRANT SELECT ON ALL TABLES IN SCHEMA shared, certificates, patching, eol, system TO ops_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared, certificates, patching, eol, system
    GRANT SELECT ON TABLES TO ops_api;

-- Sync user: read/write access for sync operations
GRANT USAGE ON SCHEMA shared, certificates, patching, eol, system TO ops_sync;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shared, certificates, patching, eol, system TO ops_sync;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA shared, certificates, patching, eol, system TO ops_sync;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared, certificates, patching, eol, system
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ops_sync;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared, certificates, patching, eol, system
    GRANT USAGE, SELECT ON SEQUENCES TO ops_sync;

-- Sync user needs to create temp tables
GRANT CREATE ON DATABASE ops_platform TO ops_sync;

\q
```

### Verify the database

```cmd
psql -U ops_api -d ops_platform -c "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('shared','certificates','patching','eol','system') ORDER BY table_schema, table_name;"
```

You should see tables in all five schemas.

---

## Step 3: Install .NET 10 Hosting Bundle

1. Download the **.NET 10 Hosting Bundle** from https://dotnet.microsoft.com/download/dotnet/10.0
   - You need the **Hosting Bundle**, not just the Runtime or SDK
   - The Hosting Bundle includes: ASP.NET Core Runtime + IIS support (ASP.NET Core Module)
2. Run the installer
3. **Restart IIS** after installation:
   ```cmd
   net stop was /y
   net start w3svc
   ```
4. Verify installation:
   ```cmd
   dotnet --list-runtimes
   ```
   Confirm `Microsoft.AspNetCore.App 10.0.x` appears in the output.

---

## Step 4: Publish the Application

On a machine with the .NET 10 SDK installed (this can be the server itself or a build machine):

```cmd
cd C:\Dev\GitHub\operations-api
dotnet publish -c Release -o C:\inetpub\operations-api
```

This creates a self-contained publish output in `C:\inetpub\operations-api`.

---

## Step 5: Configure Application Settings

Edit the published configuration file:

```
C:\inetpub\operations-api\appsettings.json
```

Update with production values:

```json
{
  "ConnectionStrings": {
    "OperationsDb": "Host=localhost;Port=5432;Database=ops_platform;Username=ops_api;Password=YOUR_SECURE_PASSWORD_HERE"
  },
  "Authentication": {
    "Mode": "Windows"
  },
  "Cors": {
    "AllowedOrigins": [
      "https://your-dashboard-url.hiscox.com",
      "http://localhost:8080"
    ]
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information"
    }
  }
}
```

**What to change:**
- `ConnectionStrings:OperationsDb` - set the `Password` to the `ops_api` password you created in Step 2
- `Cors:AllowedOrigins` - add the URL where the dashboard will be hosted (the IIS site URL)
- `Authentication:Mode` - keep as `"Windows"` for Windows Authentication via IIS

> **Security:** Consider using `appsettings.Production.json` for sensitive values, or environment variables set in IIS. Never commit passwords to source control.

---

## Step 6: Configure IIS

### Enable Required IIS Features

Open **Server Manager > Add Roles and Features** and ensure these are enabled:
- Web Server (IIS)
  - Common HTTP Features: Default Document, Static Content
  - Security: **Windows Authentication**
  - Application Development: (no specific features needed - the Hosting Bundle handles .NET)

### Create the Application Pool

1. Open **IIS Manager**
2. Right-click **Application Pools** > **Add Application Pool**
   - Name: `OperationsApi`
   - .NET CLR version: **No Managed Code** (ASP.NET Core runs out-of-process)
   - Managed pipeline mode: **Integrated**
3. Click the new pool > **Advanced Settings**:
   - Identity: Choose an appropriate identity (e.g. `ApplicationPoolIdentity` or a domain service account)
   - Start Mode: `AlwaysRunning` (recommended for faster first requests)

### Create the Website

1. Right-click **Sites** > **Add Website**
   - Site name: `OperationsApi`
   - Application pool: `OperationsApi` (the pool you just created)
   - Physical path: `C:\inetpub\operations-api`
   - Binding:
     - Type: `https` (recommended) or `http`
     - Port: `443` (or your chosen port)
     - Host name: your chosen hostname (e.g. `ops-api.hiscox.com`)
     - SSL certificate: select your certificate if using HTTPS
2. Click OK

### Configure Windows Authentication

1. Select the `OperationsApi` site in IIS Manager
2. Double-click **Authentication**
3. Enable **Windows Authentication**
4. Disable **Anonymous Authentication**

### Deploy the Frontend

Copy the frontend file into the published application:

```cmd
copy C:\Dev\GitHub\operations-api\frontend\index.html C:\inetpub\operations-api\wwwroot\index.html
```

If the `wwwroot` folder doesn't exist:
```cmd
mkdir C:\inetpub\operations-api\wwwroot
copy C:\Dev\GitHub\operations-api\frontend\index.html C:\inetpub\operations-api\wwwroot\index.html
```

> **Note:** The frontend `index.html` has `API_BASE` set to `http://localhost:5000/api`. Update this to match your IIS site URL:

Open `C:\inetpub\operations-api\wwwroot\index.html` and find:
```javascript
const API_BASE = 'http://localhost:5000/api';
```
Change to:
```javascript
const API_BASE = '/api';
```

Using a relative path (`/api`) means the frontend will call the API on the same host, which works when both are served from the same IIS site.

### Enable Static Files in the API

The API needs to serve the frontend HTML. Add static file middleware. Edit `Program.cs` before publishing (or re-publish after):

The API currently doesn't serve static files. To serve `index.html` from `wwwroot`, you have two options:

**Option A (recommended):** Create a separate IIS site or virtual directory for the frontend. This keeps the API and frontend independent.

**Option B:** Add static file support to the API. Before publishing, add these lines to `Program.cs` after `app.UseCors();`:

```csharp
app.UseDefaultFiles();
app.UseStaticFiles();
```

Then re-publish with `dotnet publish -c Release -o C:\inetpub\operations-api`.

---

## Step 7: Verify the API

### Test the health endpoint

```cmd
curl -k --negotiate -u : https://localhost/healthz
```

Expected response: `Healthy`

### Test an API endpoint

```cmd
curl -k --negotiate -u : https://localhost/api/health/summary
```

You should get a JSON response (data may be empty until sync scripts run).

### Test the frontend

Open a browser and navigate to `https://your-server-name/` — you should see the GES Operations Dashboard.

### Check the Scalar API docs (development only)

If running in Development mode, navigate to `https://localhost/scalar/v1` to see the interactive API documentation.

---

## Step 8: Set Up Python Sync Environment

The sync scripts pull data from Databricks into PostgreSQL.

### Install Python

1. Download Python 3.11+ from https://www.python.org/downloads/
2. Install with **"Add Python to PATH"** checked
3. Verify: `python --version`

### Create a virtual environment and install dependencies

```cmd
cd C:\Dev\GitHub\operations-api\sync
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### Configure sync environment variables

The sync scripts need these environment variables. Set them as **system environment variables** on the server, or configure them in your Azure DevOps pipeline variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `OPS_DB_HOST` | PostgreSQL host | `localhost` |
| `OPS_DB_PORT` | PostgreSQL port | `5432` |
| `OPS_DB_NAME` | Database name | `ops_platform` |
| `OPS_DB_USER` | Sync user | `ops_sync` |
| `OPS_DB_PASSWORD` | Sync user password | *(your password)* |
| `DATABRICKS_HOST` | Databricks workspace URL | `your-workspace.azuredatabricks.net` |
| `DATABRICKS_TOKEN` | Databricks PAT | *(your token)* |
| `DATABRICKS_WAREHOUSE_ID` | SQL warehouse ID | *(your warehouse ID)* |

### Test the sync scripts manually

```cmd
cd C:\Dev\GitHub\operations-api\sync

:: Activate the virtual environment
venv\Scripts\activate

:: Dry run first (no database changes)
python servers/sync_server_list.py --dry-run --verbose
python eol/sync_eol_software.py --dry-run --verbose

:: If dry runs succeed, run for real
python servers/sync_server_list.py --verbose
python eol/sync_eol_software.py --verbose
```

---

## Step 9: Schedule Sync via Azure DevOps Pipelines

Since you have a self-hosted Azure DevOps agent on the Group Application Server, create pipelines to run the sync scripts on a schedule.

### Example pipeline: `azure-pipelines-sync-servers.yml`

```yaml
trigger: none

schedules:
  - cron: "0 6 * * *"
    displayName: "Daily server sync at 06:00"
    branches:
      include:
        - main
    always: true

pool:
  name: 'Default'  # Your self-hosted agent pool name

variables:
  - group: operations-sync-secrets  # Variable group with DB and Databricks credentials

steps:
  - task: UsePythonVersion@0
    inputs:
      versionSpec: '3.11'

  - script: |
      cd sync
      pip install -r requirements.txt
      python servers/sync_server_list.py --verbose
    displayName: 'Sync Server List from Databricks'
    env:
      OPS_DB_HOST: $(OPS_DB_HOST)
      OPS_DB_PORT: $(OPS_DB_PORT)
      OPS_DB_NAME: $(OPS_DB_NAME)
      OPS_DB_USER: $(OPS_DB_USER)
      OPS_DB_PASSWORD: $(OPS_DB_PASSWORD)
      DATABRICKS_HOST: $(DATABRICKS_HOST)
      DATABRICKS_TOKEN: $(DATABRICKS_TOKEN)
      DATABRICKS_WAREHOUSE_ID: $(DATABRICKS_WAREHOUSE_ID)
```

### Example pipeline: `azure-pipelines-sync-eol.yml`

```yaml
trigger: none

schedules:
  - cron: "0 7 * * *"
    displayName: "Daily EOL sync at 07:00"
    branches:
      include:
        - main
    always: true

pool:
  name: 'Default'

variables:
  - group: operations-sync-secrets

steps:
  - task: UsePythonVersion@0
    inputs:
      versionSpec: '3.11'

  - script: |
      cd sync
      pip install -r requirements.txt
      python eol/sync_eol_software.py --verbose
    displayName: 'Sync EOL Software from Databricks'
    env:
      OPS_DB_HOST: $(OPS_DB_HOST)
      OPS_DB_PORT: $(OPS_DB_PORT)
      OPS_DB_NAME: $(OPS_DB_NAME)
      OPS_DB_USER: $(OPS_DB_USER)
      OPS_DB_PASSWORD: $(OPS_DB_PASSWORD)
      DATABRICKS_HOST: $(DATABRICKS_HOST)
      DATABRICKS_TOKEN: $(DATABRICKS_TOKEN)
      DATABRICKS_WAREHOUSE_ID: $(DATABRICKS_WAREHOUSE_ID)
```

### Set up the variable group

1. In Azure DevOps, go to **Pipelines > Library**
2. Create a variable group called `operations-sync-secrets`
3. Add all the environment variables from the table in Step 8
4. Mark passwords and tokens as **secret** (lock icon)

---

## Step 10: Seed Sync Status Records

The `005-system-health-schema.sql` creates initial sync status entries. If you added the EOL sync after running the schema, insert the tracking record:

```cmd
psql -U ops_sync -d ops_platform -c "INSERT INTO system.sync_status (sync_name, display_name, schedule) VALUES ('databricks_eol', 'Databricks EOL Software Sync', 'Daily 07:00') ON CONFLICT (sync_name) DO NOTHING;"
```

Also verify the server sync entry exists:

```cmd
psql -U ops_sync -d ops_platform -c "SELECT sync_name, display_name, status FROM system.sync_status;"
```

---

## Step 11: Post-Deployment Verification

### Checklist

- [ ] PostgreSQL service running and accessible on port 5432
- [ ] All schema tables created (`\dt shared.*`, `\dt eol.*`, etc.)
- [ ] IIS site running with Windows Authentication enabled
- [ ] `https://your-server/healthz` returns `Healthy`
- [ ] `https://your-server/api/health/summary` returns JSON
- [ ] Frontend loads at `https://your-server/`
- [ ] Sync scripts run successfully (check `system.sync_history` table)
- [ ] Azure DevOps pipelines are scheduled and the agent is online

### Useful diagnostic commands

```cmd
:: Check IIS site status
%windir%\system32\inetsrv\appcmd list site

:: Check application pool status
%windir%\system32\inetsrv\appcmd list apppool

:: View API logs (if configured to file)
type C:\inetpub\operations-api\logs\*.log

:: Check sync history
psql -U ops_api -d ops_platform -c "SELECT sync_name, status, started_at, completed_at, records_processed FROM system.sync_history ORDER BY started_at DESC LIMIT 10;"

:: Check sync status
psql -U ops_api -d ops_platform -c "SELECT sync_name, status, last_success_at, consecutive_failures FROM system.sync_status;"
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| 502.5 error in browser | Check .NET Hosting Bundle is installed. Run `dotnet --list-runtimes`. Restart IIS. |
| 500.30 error | Check `appsettings.json` connection string. Verify PostgreSQL is running. Check Windows Event Log > Application. |
| Windows Auth not working | Ensure Anonymous Auth is disabled and Windows Auth is enabled in IIS. Check the app pool identity has network access. |
| `healthz` returns Unhealthy | PostgreSQL connection failing. Check connection string, firewall, and that the PostgreSQL service is running. |
| Sync scripts fail with connection error | Verify `OPS_DB_*` environment variables are set. Check `pg_hba.conf` allows the connection. |
| Sync scripts fail with Databricks error | Verify `DATABRICKS_*` variables. Check the PAT hasn't expired. Ensure the warehouse is running. |
| Frontend shows demo data only | API calls are failing. Check browser dev tools Network tab. Verify `API_BASE` in `index.html` is correct. Check CORS origins include the frontend URL. |

# Operations API - First-Time Deployment Guide

**Target environment:** Windows Server with IIS, .NET 10, PostgreSQL 18
**Application version:** 1.2.0
**Last updated:** 2026-03-12

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [PostgreSQL Installation and Database Setup](#2-postgresql-installation-and-database-setup)
3. [IIS Setup](#3-iis-setup)
4. [Application Deployment](#4-application-deployment)
5. [Configuration](#5-configuration)
6. [Database Migrations](#6-database-migrations)
7. [Start and Verify](#7-start-and-verify)
8. [Post-Deployment](#8-post-deployment)
9. [Rollback Procedures](#9-rollback-procedures)

---

## 1. Prerequisites

### Software Requirements

| Component | Required Version | Download |
|---|---|---|
| Windows Server | 2019 or 2022 | N/A (OS) |
| IIS | 10.0 | Windows Feature |
| .NET 10 Hosting Bundle | 10.0.x (latest patch) | https://dotnet.microsoft.com/download/dotnet/10.0 |
| PostgreSQL | 18.x | https://www.postgresql.org/download/windows/ |
| Git (optional) | Latest | Only if deploying from source |

### Windows Server Roles and Features

The following IIS features must be enabled. Run this in an **elevated PowerShell**:

```powershell
Install-WindowsFeature -Name Web-Server, Web-WebServer, Web-Common-Http, Web-Default-Doc, Web-Static-Content, Web-Http-Errors, Web-Http-Logging, Web-Request-Monitor, Web-Filtering, Web-Performance, Web-Stat-Compression, Web-Dyn-Compression, Web-Security, Web-Windows-Auth, Web-Net-Ext45, Web-Asp-Net45, Web-ISAPI-Ext, Web-ISAPI-Filter, Web-Mgmt-Tools, Web-Mgmt-Console
```

### IIS Authentication Features

Windows Authentication must be installed. Verify with:

```powershell
Get-WindowsFeature Web-Windows-Auth
```

If not installed:

```powershell
Install-WindowsFeature Web-Windows-Auth
```

### .NET 10 Hosting Bundle

Download and install the **ASP.NET Core 10.0 Hosting Bundle** (not just the runtime). This installs both the runtime and the ASP.NET Core IIS module.

After installation, **restart IIS**:

```powershell
net stop was /y
net start w3svc
```

### Domain Accounts and Permissions

| Account | Purpose | Required Permissions |
|---|---|---|
| Your admin account | Performing this deployment | Local Administrator on the server |
| **IIS AppPool\OperationsApi** | IIS app pool identity (virtual account, created automatically) | Read access to deploy path, connect to PostgreSQL |
| **DOMAIN\GES-Ops-Admins** | AD security group for OpsAdmin write endpoints | Must exist in Active Directory before deployment |
| PostgreSQL superuser (`postgres`) | Initial DB setup and extension installation | PostgreSQL superuser |
| `ops_api` | Application database user | CONNECT, USAGE, SELECT, INSERT, UPDATE on application schemas |
| `ops_migrate` | Migration runner | USAGE, CREATE, ALTER, DROP on all application schemas |

### Network Requirements

| From | To | Port | Purpose |
|---|---|---|---|
| Client browsers (6 users) | This server | 443 (HTTPS) | Web UI and API |
| This server | PostgreSQL | 5432 | Database connection |
| This server | Domain Controller | 88 (Kerberos), 389 (LDAP) | Windows Authentication |

### Firewall

Open inbound port 443 on the server firewall:

```powershell
New-NetFirewallRule -DisplayName "Operations API HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

<details>
<summary>How to verify prerequisites</summary>

```powershell
# Check IIS is running
Get-Service W3SVC | Select-Object Status

# Check .NET 10 hosting bundle is installed
dotnet --list-runtimes | Select-String "Microsoft.AspNetCore.App 10"

# Check Windows Auth feature
Get-WindowsFeature Web-Windows-Auth | Select-Object InstallState

# Check PostgreSQL is reachable (replace YOUR_SERVER if PostgreSQL is remote)
Test-NetConnection -ComputerName localhost -Port 5432

# Check the admin group exists in AD
Get-ADGroup -Identity "GES-Ops-Admins"
```

All checks should return positive results before proceeding.

</details>

<details>
<summary>Rollback: Prerequisites</summary>

Prerequisites are additive and do not need rollback. If the .NET Hosting Bundle causes issues, uninstall it from **Programs and Features**. The firewall rule can be removed with:

```powershell
Remove-NetFirewallRule -DisplayName "Operations API HTTPS"
```

</details>

---

## 2. PostgreSQL Installation and Database Setup

### 2.1 Install PostgreSQL 18

If PostgreSQL is not already installed on this server, install it using the EnterpriseDB installer. Accept defaults. Remember the `postgres` superuser password you set during installation.

After installation, add the PostgreSQL bin directory to PATH if it is not already there:

```powershell
$pgBin = "C:\Program Files\PostgreSQL\18\bin"
[Environment]::SetEnvironmentVariable("PATH", "$env:PATH;$pgBin", "Machine")
```

Close and reopen your PowerShell session for the PATH change to take effect.

### 2.2 Create the Database

Connect as the `postgres` superuser:

```powershell
psql -U postgres
```

Run the following SQL:

```sql
CREATE DATABASE operations
    ENCODING = 'UTF8'
    LC_COLLATE = 'en_US.UTF-8'
    LC_CTYPE = 'en_US.UTF-8'
    TEMPLATE = template0;
```

**Note:** If the locale `en_US.UTF-8` is not available on your Windows Server, use the default locale by omitting the `LC_COLLATE` and `LC_CTYPE` lines:

```sql
CREATE DATABASE operations ENCODING = 'UTF8' TEMPLATE = template0;
```

### 2.3 Install Required Extensions

Still connected as `postgres`, switch to the new database and install extensions:

```sql
\c operations

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

Verify the extensions installed correctly:

```sql
SELECT levenshtein('test', 'tset');
SELECT similarity('test', 'tset');
SELECT gen_random_uuid();
```

All three queries should return results without errors.

### 2.4 Create Database Roles

Still connected as `postgres` to the `operations` database:

```sql
-- Migration user (used by deploy pipeline and manual migrations)
CREATE ROLE ops_migrate WITH LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD_1';

-- Application user (used by the running API via connection string)
CREATE ROLE ops_api WITH LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD_2';
```

**Important:** Generate strong random passwords. Store them securely (e.g., in your team's password manager or Azure DevOps variable group `operations-api-prod`).

### 2.5 Create Schemas and Grant Permissions

Still connected as `postgres` to the `operations` database:

```sql
-- Create all schemas
CREATE SCHEMA IF NOT EXISTS system;
CREATE SCHEMA IF NOT EXISTS shared;
CREATE SCHEMA IF NOT EXISTS certificates;
CREATE SCHEMA IF NOT EXISTS patching;
CREATE SCHEMA IF NOT EXISTS eol;

-- Migration user: full control on all schemas
GRANT ALL PRIVILEGES ON SCHEMA system, shared, certificates, patching, eol TO ops_migrate;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA system, shared, certificates, patching, eol TO ops_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA system GRANT ALL PRIVILEGES ON TABLES TO ops_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared GRANT ALL PRIVILEGES ON TABLES TO ops_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA certificates GRANT ALL PRIVILEGES ON TABLES TO ops_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA patching GRANT ALL PRIVILEGES ON TABLES TO ops_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA eol GRANT ALL PRIVILEGES ON TABLES TO ops_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA system GRANT ALL PRIVILEGES ON SEQUENCES TO ops_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared GRANT ALL PRIVILEGES ON SEQUENCES TO ops_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA certificates GRANT ALL PRIVILEGES ON SEQUENCES TO ops_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA patching GRANT ALL PRIVILEGES ON SEQUENCES TO ops_migrate;
ALTER DEFAULT PRIVILEGES IN SCHEMA eol GRANT ALL PRIVILEGES ON SEQUENCES TO ops_migrate;

-- Application user: read/write but no DDL
GRANT CONNECT ON DATABASE operations TO ops_api;
GRANT USAGE ON SCHEMA system, shared, certificates, patching, eol TO ops_api;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA system, shared, certificates, patching, eol TO ops_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA system, shared, certificates, patching, eol TO ops_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA system GRANT SELECT, INSERT, UPDATE ON TABLES TO ops_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared GRANT SELECT, INSERT, UPDATE ON TABLES TO ops_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA certificates GRANT SELECT, INSERT, UPDATE ON TABLES TO ops_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA patching GRANT SELECT, INSERT, UPDATE ON TABLES TO ops_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA eol GRANT SELECT, INSERT, UPDATE ON TABLES TO ops_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA system GRANT USAGE, SELECT ON SEQUENCES TO ops_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared GRANT USAGE, SELECT ON SEQUENCES TO ops_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA certificates GRANT USAGE, SELECT ON SEQUENCES TO ops_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA patching GRANT USAGE, SELECT ON SEQUENCES TO ops_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA eol GRANT USAGE, SELECT ON SEQUENCES TO ops_api;

-- Allow ops_api to execute functions (needed for server name matching functions)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA system TO ops_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA system GRANT EXECUTE ON FUNCTIONS TO ops_api;
```

### 2.6 Configure pg_hba.conf for Application Access

Edit **C:\Program Files\PostgreSQL\18\data\pg_hba.conf** and add these lines before any catch-all rules at the bottom:

```
# Operations API - application and migration users
host    operations    ops_api       127.0.0.1/32    scram-sha-256
host    operations    ops_api       ::1/128         scram-sha-256
host    operations    ops_migrate   127.0.0.1/32    scram-sha-256
host    operations    ops_migrate   ::1/128         scram-sha-256
```

If PostgreSQL is on a different server than IIS, replace `127.0.0.1/32` with the IIS server's IP address.

Reload PostgreSQL configuration:

```powershell
pg_ctl reload -D "C:\Program Files\PostgreSQL\18\data"
```

Or restart the PostgreSQL service:

```powershell
Restart-Service postgresql-x64-18
```

<details>
<summary>How to verify database setup</summary>

```powershell
# Test migration user connection
psql -U ops_migrate -d operations -c "SELECT current_user, current_database();"

# Test application user connection
psql -U ops_api -d operations -c "SELECT current_user, current_database();"

# Verify schemas exist
psql -U ops_migrate -d operations -c "\dn"
```

Expected output: both users connect successfully, and schemas `system`, `shared`, `certificates`, `patching`, `eol` appear in the schema list.

</details>

<details>
<summary>Rollback: Database setup</summary>

To completely remove the database and start over:

```sql
-- Connect as postgres superuser
DROP DATABASE IF EXISTS operations;
DROP ROLE IF EXISTS ops_api;
DROP ROLE IF EXISTS ops_migrate;
```

Remove the lines you added to `pg_hba.conf` and reload PostgreSQL.

</details>

---

## 3. IIS Setup

### 3.1 Create the Deploy Directory

```powershell
New-Item -ItemType Directory -Path "C:\inetpub\operations-api" -Force
New-Item -ItemType Directory -Path "C:\inetpub\operations-api\logs" -Force
```

### 3.2 Create the Application Pool

Open an **elevated PowerShell** and run:

```powershell
Import-Module WebAdministration

New-WebAppPool -Name "OperationsApi"
Set-ItemProperty "IIS:\AppPools\OperationsApi" -Name "managedRuntimeVersion" -Value ""
Set-ItemProperty "IIS:\AppPools\OperationsApi" -Name "managedPipelineMode" -Value "Integrated"
Set-ItemProperty "IIS:\AppPools\OperationsApi" -Name "startMode" -Value "AlwaysRunning"
Set-ItemProperty "IIS:\AppPools\OperationsApi" -Name "processModel.idleTimeout" -Value ([TimeSpan]::FromMinutes(0))
Set-ItemProperty "IIS:\AppPools\OperationsApi" -Name "processModel.loadUserProfile" -Value $true
```

**Key settings explained:**
- **managedRuntimeVersion = ""** (empty string) -- Required for .NET Core/10 apps running via the ASP.NET Core Module. Do NOT set this to "v4.0".
- **startMode = AlwaysRunning** -- Prevents cold-start delays for the first user.
- **idleTimeout = 0** -- App pool never shuts down due to inactivity (only 6 users, requests may be sparse).
- **loadUserProfile = true** -- Required for Windows Authentication to function correctly.

### 3.3 Create the IIS Site

```powershell
New-Website -Name "OperationsApi" `
    -PhysicalPath "C:\inetpub\operations-api" `
    -ApplicationPool "OperationsApi" `
    -Port 443 `
    -Ssl `
    -HostHeader "REPLACE_WITH_YOUR_HOSTNAME"
```

Replace **REPLACE_WITH_YOUR_HOSTNAME** with the actual hostname users will use to access the application (e.g., `ops-api.contoso.com`).

**If you need to bind to port 80 as well** (for HTTP-to-HTTPS redirect), add a second binding:

```powershell
New-WebBinding -Name "OperationsApi" -Protocol "http" -Port 80 -HostHeader "REPLACE_WITH_YOUR_HOSTNAME"
```

### 3.4 Bind an SSL Certificate

You need an SSL certificate for the hostname. If you have a PFX file:

```powershell
$cert = Import-PfxCertificate -FilePath "REPLACE_WITH_PATH_TO_PFX" -CertStoreLocation "Cert:\LocalMachine\My" -Password (ConvertTo-SecureString -String "REPLACE_WITH_PFX_PASSWORD" -AsPlainText -Force)

# Bind it to the site
$binding = Get-WebBinding -Name "OperationsApi" -Protocol "https"
$binding.AddSslCertificate($cert.Thumbprint, "My")
```

If using an internal CA certificate that is already in the server's certificate store, bind it via **IIS Manager > OperationsApi site > Bindings > Edit the https binding > select the SSL certificate**.

### 3.5 Configure Authentication

Disable Anonymous Authentication and enable Windows Authentication on the site:

```powershell
Set-WebConfigurationProperty -Filter "/system.webServer/security/authentication/anonymousAuthentication" -Name "enabled" -Value $false -PSPath "IIS:\Sites\OperationsApi"
Set-WebConfigurationProperty -Filter "/system.webServer/security/authentication/windowsAuthentication" -Name "enabled" -Value $true -PSPath "IIS:\Sites\OperationsApi"
```

Configure Windows Authentication to use Negotiate (Kerberos with NTLM fallback):

```powershell
# Verify providers - Negotiate should be listed first
Get-WebConfigurationProperty -Filter "/system.webServer/security/authentication/windowsAuthentication/providers" -Name "." -PSPath "IIS:\Sites\OperationsApi" | Select-Object -ExpandProperty Collection | Format-Table Value
```

Expected output should show **Negotiate** listed before **NTLM**. If not:

```powershell
# In IIS Manager: Sites > OperationsApi > Authentication > Windows Authentication > Providers
# Move "Negotiate" to the top of the list
```

### 3.6 Set Folder Permissions

Grant the app pool identity read access to the deploy directory:

```powershell
$acl = Get-Acl "C:\inetpub\operations-api"
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule("IIS AppPool\OperationsApi", "ReadAndExecute", "ContainerInherit,ObjectInherit", "None", "Allow")
$acl.AddAccessRule($rule)
Set-Acl "C:\inetpub\operations-api" $acl
```

Grant write access to the logs directory:

```powershell
$acl = Get-Acl "C:\inetpub\operations-api\logs"
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule("IIS AppPool\OperationsApi", "Modify", "ContainerInherit,ObjectInherit", "None", "Allow")
$acl.AddAccessRule($rule)
Set-Acl "C:\inetpub\operations-api\logs" $acl
```

<details>
<summary>How to verify IIS setup</summary>

```powershell
Import-Module WebAdministration

# App pool exists and is configured correctly
Get-ItemProperty "IIS:\AppPools\OperationsApi" | Select-Object name, managedRuntimeVersion, managedPipelineMode, startMode

# Site exists and points to correct path
Get-Website -Name "OperationsApi" | Select-Object name, physicalPath, state

# Bindings are correct
Get-WebBinding -Name "OperationsApi" | Format-Table protocol, bindingInformation

# Authentication is configured
Get-WebConfigurationProperty -Filter "/system.webServer/security/authentication/anonymousAuthentication" -Name "enabled" -PSPath "IIS:\Sites\OperationsApi"
# Expected: False

Get-WebConfigurationProperty -Filter "/system.webServer/security/authentication/windowsAuthentication" -Name "enabled" -PSPath "IIS:\Sites\OperationsApi"
# Expected: True
```

</details>

<details>
<summary>Rollback: IIS setup</summary>

```powershell
Import-Module WebAdministration

# Remove site and app pool
Remove-Website -Name "OperationsApi"
Remove-WebAppPool -Name "OperationsApi"

# Optionally remove the deploy directory
Remove-Item -Path "C:\inetpub\operations-api" -Recurse -Force
```

</details>

---

## 4. Application Deployment

### 4.1 Build the Application

On your build machine (or the server if building locally), from the repository root:

```powershell
dotnet publish --configuration Release --output "C:\inetpub\operations-api"
```

### 4.2 Copy the Frontend

```powershell
$source = "REPLACE_WITH_REPO_PATH\frontend"
$destination = "C:\inetpub\operations-api\wwwroot"

New-Item -ItemType Directory -Path $destination -Force
Copy-Item -Path "$source\index.html" -Destination $destination -Force
Copy-Item -Path "$source\css" -Destination "$destination\css" -Recurse -Force
Copy-Item -Path "$source\js" -Destination "$destination\js" -Recurse -Force
```

Replace **REPLACE_WITH_REPO_PATH** with the path to your local clone of the repository (e.g., `C:\Dev\GitHub\operations-api`).

### 4.3 Copy the web.config

The publish step should include `web.config` automatically. Verify it exists:

```powershell
Test-Path "C:\inetpub\operations-api\web.config"
```

If it returns `False`, copy it manually:

```powershell
Copy-Item "REPLACE_WITH_REPO_PATH\web.config" "C:\inetpub\operations-api\web.config"
```

<details>
<summary>How to verify application files</summary>

```powershell
# Key files that must exist
@(
    "C:\inetpub\operations-api\OperationsApi.dll",
    "C:\inetpub\operations-api\web.config",
    "C:\inetpub\operations-api\appsettings.json",
    "C:\inetpub\operations-api\wwwroot\index.html",
    "C:\inetpub\operations-api\wwwroot\js\api.js"
) | ForEach-Object {
    $exists = Test-Path $_
    Write-Host "$_ : $exists"
}
```

All files should show `True`.

</details>

<details>
<summary>Rollback: Application deployment</summary>

Remove the deployed files and re-deploy from a known good build:

```powershell
Remove-Item -Path "C:\inetpub\operations-api\*" -Recurse -Force
```

Then repeat the publish and copy steps.

</details>

---

## 5. Configuration

### 5.1 Write appsettings.Production.json

Create the production configuration file at **C:\inetpub\operations-api\appsettings.Production.json**:

```powershell
$settings = @'
{
  "ConnectionStrings": {
    "OperationsDb": "Host=REPLACE_WITH_DB_HOST;Port=5432;Database=operations;Username=ops_api;Password=REPLACE_WITH_OPS_API_PASSWORD;Pooling=true;Minimum Pool Size=2;Maximum Pool Size=20;Connection Idle Lifetime=300"
  },
  "Authentication": {
    "Mode": "Windows",
    "AdminRole": "DOMAIN\\GES-Ops-Admins"
  },
  "Cors": {
    "AllowedOrigins": [
      "https://REPLACE_WITH_YOUR_HOSTNAME"
    ]
  },
  "Logging": {
    "LogLevel": {
      "Default": "Warning",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.Hosting": "Information",
      "OperationsApi": "Information"
    }
  }
}
'@

$settings | Out-File -FilePath "C:\inetpub\operations-api\appsettings.Production.json" -Encoding utf8
```

**Replace the following placeholders:**

| Placeholder | Replace with | Example |
|---|---|---|
| `REPLACE_WITH_DB_HOST` | PostgreSQL server hostname or IP | `localhost` (if on same server) or `db-server.contoso.com` |
| `REPLACE_WITH_OPS_API_PASSWORD` | The password you set for the `ops_api` database role in step 2.4 | (your password) |
| `DOMAIN\\GES-Ops-Admins` | Your actual domain and admin group name | `CONTOSO\\GES-Ops-Admins` |
| `REPLACE_WITH_YOUR_HOSTNAME` | The hostname users browse to, with `https://` prefix | `https://ops-api.contoso.com` |

**CORS note:** Add every origin that will access the API. If the frontend is served from the same site, add that site's URL. If you have additional origins, add them as extra entries in the `AllowedOrigins` array. The application will fail to start in Production if `AllowedOrigins` is empty.

### 5.2 Secure the Configuration File

Restrict access to the config file so only SYSTEM, Administrators, and the app pool identity can read it:

```powershell
$configPath = "C:\inetpub\operations-api\appsettings.Production.json"

icacls $configPath /inheritance:d
icacls $configPath /remove:g "Users"
icacls $configPath /remove:g "Authenticated Users"
icacls $configPath /grant:r "SYSTEM:(F)"
icacls $configPath /grant:r "IIS AppPool\OperationsApi:(R)"
icacls $configPath /grant:r "BUILTIN\Administrators:(F)"
```

### 5.3 Verify the ASPNETCORE_ENVIRONMENT Variable

The `web.config` file already sets `ASPNETCORE_ENVIRONMENT` to `Production`. Confirm:

```powershell
Select-String -Path "C:\inetpub\operations-api\web.config" -Pattern "ASPNETCORE_ENVIRONMENT"
```

Expected output should contain: `value="Production"`

<details>
<summary>How to verify configuration</summary>

```powershell
# File exists and is not empty
(Get-Content "C:\inetpub\operations-api\appsettings.Production.json" | Measure-Object -Character).Characters -gt 50

# Connection string contains expected database name
Select-String -Path "C:\inetpub\operations-api\appsettings.Production.json" -Pattern "Database=operations"

# CORS origins are not empty
Select-String -Path "C:\inetpub\operations-api\appsettings.Production.json" -Pattern "https://"

# ACL is restricted (Users and Authenticated Users should NOT appear)
icacls "C:\inetpub\operations-api\appsettings.Production.json"
```

</details>

<details>
<summary>Rollback: Configuration</summary>

Delete the production config and recreate it:

```powershell
Remove-Item "C:\inetpub\operations-api\appsettings.Production.json" -Force
```

Then repeat step 5.1.

</details>

---

## 6. Database Migrations

### 6.1 Run the Extension Script (Superuser Required)

The first migration script requires PostgreSQL superuser privileges because it creates extensions. Run as `postgres`:

```powershell
psql -U postgres -d operations -f "REPLACE_WITH_REPO_PATH\database\000-extensions.sql"
```

Replace **REPLACE_WITH_REPO_PATH** with the path to the repository.

### 6.2 Run Remaining Migrations

Run migrations 001 through 008 as the `ops_migrate` user, in order:

```powershell
$repoPath = "REPLACE_WITH_REPO_PATH"

@(
    "001-common.sql",
    "002-shared-schema.sql",
    "003-certificates-schema.sql",
    "004-patching-schema.sql",
    "005-system-health-schema.sql",
    "006-eol-schema.sql",
    "007-migration-tracking.sql",
    "008-eol-add-machine-name.sql"
) | ForEach-Object {
    Write-Host "Running: $_"
    psql -U ops_migrate -d operations -f "$repoPath\database\$_" -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "FAILED on $_  -- stop here and investigate"
        break
    }
    Write-Host "  OK"
}
```

Replace **REPLACE_WITH_REPO_PATH** with the path to the repository.

**Note:** If psql prompts for a password, enter the `ops_migrate` password from step 2.4. To avoid repeated prompts, create a `pgpass.conf` file at `%APPDATA%\postgresql\pgpass.conf` with the content:

```
localhost:5432:operations:ops_migrate:REPLACE_WITH_MIGRATE_PASSWORD
```

### 6.3 Update Domain Suffixes in normalize_server_name

Migration `001-common.sql` creates a function `system.normalize_server_name()` that strips domain suffixes for server name matching. The default patterns are `contoso.com`, `corp.local`, and `domain.local`.

**You must update these to match your organization's actual domain suffixes.** Connect as `ops_migrate` and run:

```sql
\c operations

CREATE OR REPLACE FUNCTION system.normalize_server_name(raw_name TEXT)
RETURNS TEXT AS $$
BEGIN
    IF raw_name IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN LOWER(TRIM(
        REGEXP_REPLACE(
            REGEXP_REPLACE(raw_name,
                '\.(REPLACE_WITH_YOUR_DOMAIN_1|REPLACE_WITH_YOUR_DOMAIN_2)$', '', 'i'),
            '\.(local|internal|com)$', '', 'i'
        )
    ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

Replace **REPLACE_WITH_YOUR_DOMAIN_1** and **REPLACE_WITH_YOUR_DOMAIN_2** with your actual domain suffixes (e.g., `mycompany\.com`, `corp\.mycompany\.local`). Escape dots with `\.` in the regex.

<details>
<summary>How to verify migrations</summary>

```powershell
# Check all schemas exist
psql -U ops_api -d operations -c "\dn"

# Check migration tracking table shows all scripts
psql -U ops_api -d operations -c "SELECT script_name, applied_at FROM system.schema_migrations ORDER BY script_name;"

# Check tables exist in each schema
psql -U ops_api -d operations -c "\dt shared.*"
psql -U ops_api -d operations -c "\dt certificates.*"
psql -U ops_api -d operations -c "\dt patching.*"
psql -U ops_api -d operations -c "\dt eol.*"
psql -U ops_api -d operations -c "\dt system.*"

# Test the normalize function
psql -U ops_api -d operations -c "SELECT system.normalize_server_name('SERVER01.contoso.com');"
# Expected: server01
```

</details>

<details>
<summary>Rollback: Database migrations</summary>

Rollback scripts are provided in `database/rollback/`. Run them in **reverse order** as `ops_migrate`:

```powershell
$repoPath = "REPLACE_WITH_REPO_PATH"

# Run ONLY the scripts you need to roll back, in reverse order
@(
    "008-eol-add-machine-name.sql",
    "007-migration-tracking.sql",
    "006-eol-schema.sql",
    "005-system-health-schema.sql",
    "004-patching-schema.sql",
    "003-certificates-schema.sql",
    "002-shared-schema.sql",
    "001-common.sql"
) | ForEach-Object {
    Write-Host "Rolling back: $_"
    psql -U ops_migrate -d operations -f "$repoPath\database\rollback\$_" -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Rollback FAILED on $_ -- manual intervention required"
        break
    }
    Write-Host "  OK"
}
```

After rollback, mark the migrations as rolled back:

```sql
UPDATE system.schema_migrations
SET rolled_back_at = CURRENT_TIMESTAMP, rolled_back_by = CURRENT_USER
WHERE script_name IN ('001-common.sql', '002-shared-schema.sql', ...);
```

To completely start over, drop and recreate the database (see section 2 rollback).

</details>

---

## 7. Start and Verify

### 7.1 Start the Application Pool

```powershell
Import-Module WebAdministration
Start-WebAppPool -Name "OperationsApi"
```

Wait 5 seconds for the application to initialize.

### 7.2 Verify the Health Endpoint

The `/healthz` endpoint is anonymous (no authentication required):

```powershell
$response = Invoke-WebRequest -Uri "http://localhost/healthz" -UseBasicParsing
$response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 3
```

**Expected response:**

```json
{
  "status": "Healthy",
  "checks": [
    {
      "name": "npgsql",
      "status": "Healthy",
      "description": null,
      "duration": ...
    }
  ],
  "version": "1.2.0",
  "timestamp": "..."
}
```

If `status` is not `Healthy`, check:
1. The connection string in `appsettings.Production.json` is correct
2. PostgreSQL is running and accepting connections
3. The `ops_api` user has CONNECT permission on the `operations` database

### 7.3 Verify Windows Authentication

From a domain-joined machine on the same network, open a browser and navigate to:

**https://REPLACE_WITH_YOUR_HOSTNAME/healthz**

This should return JSON without prompting for credentials (Kerberos SSO). If the browser prompts for credentials, NTLM fallback is working but Kerberos may need SPN configuration (see Troubleshooting below).

### 7.4 Verify an Authenticated Endpoint

From a domain-joined browser, navigate to:

**https://REPLACE_WITH_YOUR_HOSTNAME/api/servers?limit=5**

- If the database has no data yet, you should get an empty array `[]` with a 200 status code.
- If you get a 401 or 403, check that Windows Authentication is enabled in IIS and Anonymous is disabled.

### 7.5 Verify the X-App-Version Header

```powershell
$response = Invoke-WebRequest -Uri "http://localhost/healthz" -UseBasicParsing
$response.Headers["X-App-Version"]
```

Expected: **1.2.0.0** (or similar version string matching `OperationsApi.csproj`).

<details>
<summary>Troubleshooting: Common startup failures</summary>

**502.5 - Process Failure:**
- Check that the .NET 10 Hosting Bundle is installed (not just the runtime)
- Run `dotnet C:\inetpub\operations-api\OperationsApi.dll` from the command line to see the actual error
- Check `C:\inetpub\operations-api\logs\stdout` if stdout logging is enabled in web.config

**500.30 - ASP.NET Core app failed to start:**
- Usually a configuration error. Run the app manually: `dotnet C:\inetpub\operations-api\OperationsApi.dll`
- Common cause: empty connection string in Production mode (the app throws `InvalidOperationException` on startup)
- Common cause: empty CORS origins in Production mode

**503 - Service Unavailable:**
- App pool has crashed. Check Event Viewer > Windows Logs > Application
- Check `Get-WebAppPoolState -Name "OperationsApi"` -- if Stopped, review the error and restart

**Kerberos not working (NTLM fallback):**
- Register an SPN: `setspn -S HTTP/REPLACE_WITH_YOUR_HOSTNAME DOMAIN\COMPUTERNAME$`
- Verify: `setspn -L DOMAIN\COMPUTERNAME$`

</details>

<details>
<summary>Rollback: Start and verify</summary>

```powershell
Import-Module WebAdministration
Stop-WebAppPool -Name "OperationsApi"
```

The site will return 503 until the app pool is started again.

</details>

---

## 8. Post-Deployment

### 8.1 Health Check URL

Bookmark this URL for monitoring:

| URL | Auth | Purpose |
|---|---|---|
| **https://REPLACE_WITH_YOUR_HOSTNAME/healthz** | Anonymous | Health check -- returns JSON with database connectivity status |
| **http://localhost/healthz** | Anonymous | Local health check (use from the server itself) |

### 8.2 Log Locations

| Log | Location | Format |
|---|---|---|
| Application logs (Serilog) | **stdout** (captured by IIS) | Compact JSON (RenderedCompactJsonFormatter) |
| IIS stdout logs (emergency only) | **C:\inetpub\operations-api\logs\stdout** | Plain text. Enable by setting `stdoutLogEnabled="true"` in web.config. **Disable immediately after debugging** -- these logs are unbounded. |
| IIS access logs | **C:\inetpub\logs\LogFiles\W3SVC{N}** | W3C format |
| Windows Event Log | **Event Viewer > Windows Logs > Application** | Source: IIS AspNetCore Module |

### 8.3 Key Operational Details

| Setting | Value |
|---|---|
| Rate limiting | 60 requests per minute per user (keyed by Windows identity) |
| Max request body size | 10 MB (enforced by both Kestrel and IIS `requestFiltering`) |
| Database connection pool | Min 2, Max 30 connections (Npgsql), idle timeout 300s |
| Response caching | Enabled (middleware registered) |
| Security headers | CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy (set in web.config) |

### 8.4 First-Run Validation Checklist

Run through these checks after the first deployment:

- [ ] **https://REPLACE_WITH_YOUR_HOSTNAME/healthz** returns `{"status":"Healthy"}`
- [ ] **https://REPLACE_WITH_YOUR_HOSTNAME/** loads the frontend SPA (dashboard page)
- [ ] **https://REPLACE_WITH_YOUR_HOSTNAME/api/servers** returns 200 (empty array is OK before first sync)
- [ ] **https://REPLACE_WITH_YOUR_HOSTNAME/api/certificates** returns 200
- [ ] **https://REPLACE_WITH_YOUR_HOSTNAME/api/patching** returns 200
- [ ] **https://REPLACE_WITH_YOUR_HOSTNAME/api/eol** returns 200
- [ ] A member of **DOMAIN\GES-Ops-Admins** can access write endpoints (POST)
- [ ] A user who is NOT in GES-Ops-Admins gets 403 on write endpoints
- [ ] The `X-App-Version` header is present on all responses
- [ ] From a non-domain machine, the API returns 401 (not 200)

### 8.5 Create Backup Directory

Create the directory used by the deploy pipeline for pre-migration database backups:

```powershell
New-Item -ItemType Directory -Path "C:\backups\ops-api-db" -Force
```

### 8.6 Azure DevOps Variable Group

If using the Azure DevOps deploy pipeline (`ops-api-deploy.yml`), create a variable group named **operations-api-prod** in your Azure DevOps project with these variables:

| Variable | Value | Secret? |
|---|---|---|
| `OPS_DB_HOST` | PostgreSQL hostname (e.g., `localhost`) | No |
| `OPS_DB_PORT` | `5432` | No |
| `OPS_DB_NAME` | `operations` | No |
| `OPS_DB_MIGRATE_USER` | `ops_migrate` | No |
| `OPS_DB_PASSWORD` | Password for ops_migrate | **Yes** |
| `OPS_CONNECTIONSTRING` | Full connection string for ops_api (same as in appsettings.Production.json) | **Yes** |
| `OPS_CORS_ORIGINS` | Comma-separated origins (e.g., `https://ops-api.contoso.com`) | No |
| `TEAMS_WEBHOOK_URL` | Microsoft Teams incoming webhook URL for failure alerts (optional) | **Yes** |

---

## 9. Rollback Procedures

### 9.1 Application Rollback (Automated)

If using the Azure DevOps pipeline, run the **ops-api-rollback** pipeline. It will:

1. Optionally restore the database from a pre-migration dump file
2. Stop the IIS app pool
3. Replace the deploy directory with the most recent backup
4. Regenerate `appsettings.Production.json` from pipeline variables
5. Start the app pool and run a health check

### 9.2 Application Rollback (Manual)

If the deploy pipeline created a backup directory:

```powershell
Import-Module WebAdministration

# 1. Stop the app pool
Stop-WebAppPool -Name "OperationsApi"

# 2. Find available backups
Get-ChildItem "C:\inetpub\operations-api.backup.*" -Directory | Sort-Object Name -Descending

# 3. Replace with the most recent backup
$backup = (Get-ChildItem "C:\inetpub\operations-api.backup.*" -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
Remove-Item "C:\inetpub\operations-api" -Recurse -Force
Copy-Item $backup "C:\inetpub\operations-api" -Recurse

# 4. Re-apply the production config (it may have been in the backup, but regenerate to be safe)
# Repeat step 5.1 and 5.2 from this guide

# 5. Start the app pool
Start-WebAppPool -Name "OperationsApi"

# 6. Verify
Invoke-WebRequest -Uri "http://localhost/healthz" -UseBasicParsing | Select-Object StatusCode
```

### 9.3 Database Rollback

**Option A: Restore from dump (recommended)**

If a pg_dump backup exists in `C:\backups\ops-api-db\`:

```powershell
$dumpFile = (Get-ChildItem "C:\backups\ops-api-db\ops-api-db-*.dump" | Sort-Object Name -Descending | Select-Object -First 1).FullName
pg_restore -U ops_migrate -d operations -F c -c -v $dumpFile
```

**Option B: Run rollback SQL scripts**

See the rollback section under [6. Database Migrations](#6-database-migrations).

### 9.4 Full Rollback (Nuclear Option)

To completely remove the Operations API from the server:

```powershell
# 1. Remove IIS site and app pool
Import-Module WebAdministration
Remove-Website -Name "OperationsApi"
Remove-WebAppPool -Name "OperationsApi"

# 2. Remove application files
Remove-Item "C:\inetpub\operations-api" -Recurse -Force
Remove-Item "C:\inetpub\operations-api.backup.*" -Recurse -Force

# 3. Remove database
psql -U postgres -c "DROP DATABASE IF EXISTS operations;"
psql -U postgres -c "DROP ROLE IF EXISTS ops_api;"
psql -U postgres -c "DROP ROLE IF EXISTS ops_migrate;"

# 4. Remove backups
Remove-Item "C:\backups\ops-api-db" -Recurse -Force

# 5. Remove firewall rule
Remove-NetFirewallRule -DisplayName "Operations API HTTPS"
```

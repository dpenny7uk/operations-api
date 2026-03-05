# operations-api
Full-stack operations platform — .NET Core REST API, PostgreSQL schema, and Python data sync pipelines for server inventory, patching, and certificate monitoring

## Security Notes

### Authentication Mode (`Authentication:Mode`)
Set to `"Windows"` (default) for production. Setting to `"none"` disables all authentication and exposes every endpoint without credentials. This is intended **only for local development**. The API logs a console warning if auth is disabled in a non-development environment.

### CORS Configuration (`Cors:AllowedOrigins`)
Must be set to the exact origin(s) of your frontend (e.g., `["https://ops.corp.local"]`). If left empty, cross-origin requests will be blocked and a startup warning is logged. Never use a wildcard — the policy uses `AllowCredentials`, which is incompatible with `*`.

### Validation Rules (`system.validation_rules`)
The `POST /api/health/validation/run` endpoint calls `system.run_validation()`, which executes SQL stored in the `validation_rules` table. **Write access to this table is equivalent to arbitrary SQL execution.** Restrict INSERT/UPDATE on `system.validation_rules` to trusted database roles only.

### Database Access
All queries use Dapper parameterization — SQL injection via API parameters is not possible. However, the connection string grants full read/write access to the `operations` database. Use a dedicated PostgreSQL role with least-privilege grants for the API connection.

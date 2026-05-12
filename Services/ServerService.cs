using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class ServerService : BaseService<ServerService>, IServerService
{
    public ServerService(IDbConnection db, ILogger<ServerService> logger)
        : base(db, logger) { }

    public Task<IEnumerable<Server>> ListServersAsync(
        string? environment,
        string? application,
        string? patchGroup,
        string? businessUnit,
        string? search,
        int limit,
        int offset) => RunDbAsync(async () =>
    {
        // Service/Func: prefer the shared.servers columns (migration 012,
        // populated by Databricks once sync is extended), but fall back to
        // patching.patch_schedule.service / .app from the latest cycle
        // (Ivanti CSV). That's where the legacy UI sourced them from.
        var sql = $@"
            SELECT
                s.server_id AS ServerId,
                s.server_name AS ServerName,
                s.fqdn AS Fqdn,
                s.ip_address AS IpAddress,
                s.environment AS Environment,
                a.application_name AS ApplicationName,
                COALESCE(s.service, latest_ps.service) AS Service,
                COALESCE(s.func, latest_ps.app) AS Func,
                s.patch_group AS PatchGroup,
                s.business_unit AS BusinessUnit,
                s.is_active AS IsActive,
                COALESCE(s.last_seen_at, s.synced_at) AS LastSeen
            FROM {Sql.Tables.Servers} s
            LEFT JOIN {Sql.Tables.Applications} a ON s.primary_application_id = a.application_id
            LEFT JOIN LATERAL (
                SELECT ps.service, ps.app
                FROM {Sql.Tables.PatchSchedule} ps
                WHERE ps.server_id = s.server_id
                ORDER BY ps.cycle_id DESC
                LIMIT 1
            ) latest_ps ON TRUE
            WHERE s.is_active = TRUE";

        var p = new DynamicParameters();

        if (environment == "Unknown")
            sql += " AND s.environment IS NULL";
        else
            AddExactFilter(ref sql, p, "s.environment", "Env", environment);
        AddILikeFilter(ref sql, p, "a.application_name", "App", application);
        AddExactFilter(ref sql, p, "s.patch_group", "PG", patchGroup);
        AddExactFilter(ref sql, p, "s.business_unit", "BU", businessUnit);

        if (!string.IsNullOrEmpty(search))
        {
            sql += " AND (s.server_name ILIKE @Search ESCAPE '\\' OR s.fqdn ILIKE @Search ESCAPE '\\')";
            p.Add("Search", $"%{EscapeLike(search)}%");
        }

        AddPagination(ref sql, p, limit, offset, "s.server_name");

        return await Db.QueryAsync<Server>(sql, p);
    });

    public Task<int> CountServersAsync(
        string? environment,
        string? application,
        string? patchGroup,
        string? businessUnit,
        string? search) => RunDbAsync(async () =>
    {
        var sql = $@"
            SELECT COUNT(*)
            FROM {Sql.Tables.Servers} s
            LEFT JOIN {Sql.Tables.Applications} a ON s.primary_application_id = a.application_id
            WHERE s.is_active = TRUE";

        var p = new DynamicParameters();

        if (environment == "Unknown")
            sql += " AND s.environment IS NULL";
        else
            AddExactFilter(ref sql, p, "s.environment", "Env", environment);
        AddILikeFilter(ref sql, p, "a.application_name", "App", application);
        AddExactFilter(ref sql, p, "s.patch_group", "PG", patchGroup);
        AddExactFilter(ref sql, p, "s.business_unit", "BU", businessUnit);

        if (!string.IsNullOrEmpty(search))
        {
            sql += " AND (s.server_name ILIKE @Search ESCAPE '\\' OR s.fqdn ILIKE @Search ESCAPE '\\')";
            p.Add("Search", $"%{EscapeLike(search)}%");
        }

        return await Db.ExecuteScalarAsync<int>(sql, p);
    });

    public Task<ServerSummary> GetServerSummaryAsync(string? environment = null, string? businessUnit = null) => RunDbAsync(async () =>
    {
        // Cross-facet rule: top-level scoped by both filters; env breakdown
        // scoped by BU only (so each env's count reflects the active BU);
        // BU breakdown scoped by env only (so each BU's count reflects the
        // active env). Same shape used by Disks and Certs.
        var topArgs = new DynamicParameters();
        var topClauses = new List<string> { "s.is_active = TRUE" };
        if (!string.IsNullOrWhiteSpace(environment))
        {
            topClauses.Add("s.environment = @Environment");
            topArgs.Add("Environment", environment);
        }
        if (!string.IsNullOrWhiteSpace(businessUnit))
        {
            topClauses.Add("s.business_unit = @BusinessUnit");
            topArgs.Add("BusinessUnit", businessUnit);
        }
        var topWhere = "WHERE " + string.Join(" AND ", topClauses);

        var topCount = await Db.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM {Sql.Tables.Servers} s {topWhere}", topArgs);

        // Env breakdown: scoped by BU only.
        var envArgs = new DynamicParameters();
        var envClauses = new List<string> { "s.is_active = TRUE" };
        if (!string.IsNullOrWhiteSpace(businessUnit))
        {
            envClauses.Add("s.business_unit = @BusinessUnit");
            envArgs.Add("BusinessUnit", businessUnit);
        }
        var envWhere = "WHERE " + string.Join(" AND ", envClauses);
        var envRows = await Db.QueryAsync<(string? Environment, int Total)>($@"
            SELECT
                s.environment AS Environment,
                COUNT(*) AS Total
            FROM {Sql.Tables.Servers} s
            {envWhere}
            GROUP BY s.environment
            ORDER BY COUNT(*) DESC", envArgs);

        // BU breakdown: scoped by env only.
        var buArgs = new DynamicParameters();
        var buClauses = new List<string> { "s.is_active = TRUE" };
        if (!string.IsNullOrWhiteSpace(environment))
        {
            buClauses.Add("s.environment = @Environment");
            buArgs.Add("Environment", environment);
        }
        var buWhere = "WHERE " + string.Join(" AND ", buClauses);
        var buRows = await Db.QueryAsync<(string? BusinessUnit, int Total)>($@"
            SELECT
                s.business_unit AS BusinessUnit,
                COUNT(*) AS Total
            FROM {Sql.Tables.Servers} s
            {buWhere}
            GROUP BY s.business_unit
            ORDER BY COUNT(*) DESC", buArgs);

        var summary = new ServerSummary
        {
            TotalCount = topCount,
            ActiveCount = topCount, // Only active rows in scope, so Total == Active
        };
        foreach (var row in envRows)
        {
            var env = row.Environment ?? "Unknown";
            summary.EnvironmentCounts[env] = new EnvironmentCount { Total = row.Total, Active = row.Total };
        }
        foreach (var row in buRows)
        {
            var bu = row.BusinessUnit ?? "Unknown";
            summary.BusinessUnitCounts[bu] = new BusinessUnitCount { Total = row.Total, Active = row.Total };
        }
        return summary;
    });

    public Task<ServerDetail?> GetServerByIdAsync(int id) => RunDbAsync(() =>
        Db.QueryFirstOrDefaultAsync<ServerDetail>($@"
            SELECT
                s.server_id AS ServerId,
                s.server_name AS ServerName,
                s.fqdn AS Fqdn,
                s.environment AS Environment,
                a.application_name AS ApplicationName,
                COALESCE(s.service, latest_ps.service) AS Service,
                COALESCE(s.func, latest_ps.app) AS Func,
                s.patch_group AS PatchGroup,
                s.business_unit AS BusinessUnit,
                s.is_active AS IsActive,
                COALESCE(s.last_seen_at, s.synced_at) AS LastSeen,
                s.operating_system AS OperatingSystem,
                s.ip_address AS IpAddress,
                s.location AS Location,
                s.primary_contact AS PrimaryContact
            FROM {Sql.Tables.Servers} s
            LEFT JOIN {Sql.Tables.Applications} a ON s.primary_application_id = a.application_id
            LEFT JOIN LATERAL (
                SELECT ps.service, ps.app
                FROM {Sql.Tables.PatchSchedule} ps
                WHERE ps.server_id = s.server_id
                ORDER BY ps.cycle_id DESC
                LIMIT 1
            ) latest_ps ON TRUE
            WHERE s.server_id = @Id
        ", new { Id = id })
    );

    public Task<ServerMatch?> ResolveServerNameAsync(string name) => RunDbAsync(() =>
        Db.QueryFirstOrDefaultAsync<ServerMatch>(@"
            SELECT
                server_id AS ServerId,
                server_name AS ServerName,
                match_type AS MatchType
            FROM system.resolve_server_name(@Name)
            LIMIT 1
        ", new { Name = name })
    );

    // Patch history for a single server. Joins patch_schedule (rows are per
    // server-per-cycle) with patch_cycles for the date, and computes the
    // cycle-level status from patch_exclusions:
    //   held      - there's an active exclusion whose window covers cycle_date
    //   patched   - cycle has passed (optimistic: patch_status itself is
    //               unpopulated, see CLAUDE.md "patch_status never populated")
    //   scheduled - cycle is upcoming
    // When Ivanti reconciliation lands, swap the optimistic 'patched' branch
    // for the real ps.patch_status value.
    public Task<IEnumerable<ServerPatchHistoryItem>> GetPatchHistoryAsync(int serverId, int limit = 50) => RunDbAsync(() =>
        Db.QueryAsync<ServerPatchHistoryItem>($@"
            SELECT
                ps.cycle_id AS CycleId,
                pc.cycle_date AS CycleDate,
                COALESCE(ps.patch_group, '') AS PatchGroup,
                CASE
                    WHEN EXISTS (
                        SELECT 1 FROM {Sql.Tables.PatchExclusions} px
                        WHERE px.server_id = @ServerId
                          AND px.is_active = TRUE
                          AND px.excluded_at::date <= pc.cycle_date
                          AND px.held_until >= pc.cycle_date
                    ) THEN 'held'
                    WHEN pc.cycle_date < CURRENT_DATE THEN 'patched'
                    ELSE 'scheduled'
                END AS Status
            FROM {Sql.Tables.PatchSchedule} ps
            JOIN {Sql.Tables.PatchCycles} pc ON pc.cycle_id = ps.cycle_id
            WHERE ps.server_id = @ServerId
            ORDER BY pc.cycle_date DESC
            LIMIT @Limit
        ", new { ServerId = serverId, Limit = limit })
    );

    public Task<IEnumerable<UnmatchedServer>> GetUnmatchedServersAsync(string? source, int limit) => RunDbAsync(async () =>
    {
        var sql = $@"
            SELECT
                server_name_raw AS ServerNameRaw,
                server_name_normalized AS ServerNameNormalized,
                source_system AS SourceSystem,
                occurrence_count AS OccurrenceCount,
                first_seen_at AS FirstSeenAt,
                last_seen_at AS LastSeenAt,
                (
                    SELECT s.server_name
                    FROM {Sql.Tables.Servers} s
                    WHERE s.is_active
                      AND similarity(system.normalize_server_name(s.server_name), um.server_name_normalized) > 0.3
                    ORDER BY similarity(
                        system.normalize_server_name(s.server_name),
                        um.server_name_normalized
                    ) DESC, s.server_name
                    LIMIT 1
                ) AS ClosestMatch
            FROM {Sql.Tables.UnmatchedServers} um
            WHERE status = 'pending'";

        var p = new DynamicParameters();
        AddExactFilter(ref sql, p, "source_system", "Source", source);

        sql += " ORDER BY occurrence_count DESC LIMIT @Limit";
        p.Add("Limit", limit);

        return await Db.QueryAsync<UnmatchedServer>(sql, p);
    });

    public Task<IEnumerable<UnreachableServer>> GetUnreachableServersAsync(int limit) => RunDbAsync(() =>
        Db.QueryAsync<UnreachableServer>($@"
            SELECT
                server_name AS ServerName,
                environment AS Environment,
                last_failure_at AS LastSeen,
                scan_type AS ScanType,
                failure_count AS FailureCount
            FROM system.v_unreachable_servers
            ORDER BY failure_count DESC
            LIMIT @Limit
        ", new { Limit = limit })
    );

    public Task CreateAliasAsync(string canonical, string alias, string? source, string actingUser) => RunDbAsync(async () =>
    {
        Logger.LogInformation("Creating server alias: {Alias} -> {Canonical} (source: {Source}, user: {User})", alias, canonical, source, actingUser);
        await Db.ExecuteAsync($@"
            INSERT INTO {Sql.Tables.ServerAliases}
                (canonical_name, alias_name, source_system, created_by)
            VALUES (@Canonical, @Alias, @Source, @CreatedBy)
            ON CONFLICT (alias_name) DO UPDATE SET
                canonical_name = EXCLUDED.canonical_name
        ", new { Canonical = canonical, Alias = alias, Source = source, CreatedBy = actingUser });
    });

    public Task<int> ResolveUnmatchedServerAsync(string raw, int serverId, string canonicalName, string? sourceSystem = null, string? actingUser = null) => RunDbAsync(async () =>
    {
        Logger.LogInformation("Resolving unmatched server {ServerName} to ID {ServerId} by {User}", raw, serverId, actingUser ?? "unknown");

        if (Db.State != System.Data.ConnectionState.Open)
            Db.Open();

        using var transaction = Db.BeginTransaction();

        var sql = $@"
            UPDATE {Sql.Tables.UnmatchedServers} SET
                status = 'resolved',
                resolved_to_server_id = @ServerId,
                resolved_at = CURRENT_TIMESTAMP,
                resolved_by = @ResolvedBy
            WHERE server_name_raw = @Raw AND status = 'pending'";

        var p = new DynamicParameters();
        p.Add("Raw", raw);
        p.Add("ServerId", serverId);
        p.Add("ResolvedBy", actingUser ?? "api");

        if (!string.IsNullOrEmpty(sourceSystem))
        {
            sql += " AND source_system = @Source";
            p.Add("Source", sourceSystem);
        }

        var rows = await Db.ExecuteAsync(sql, p, transaction);

        // Create alias so future syncs match automatically
        if (rows > 0)
        {
            await Db.ExecuteAsync($@"
                INSERT INTO {Sql.Tables.ServerAliases} (canonical_name, alias_name, source_system, created_by)
                VALUES (@Canonical, @Alias, 'unmatched_resolve', @CreatedBy)
                ON CONFLICT (alias_name) DO NOTHING",
                new { Canonical = canonicalName, Alias = raw, CreatedBy = actingUser ?? "api" }, transaction);
        }

        transaction.Commit();
        return rows;
    });

    public Task IgnoreUnmatchedServerAsync(string raw, string? sourceSystem = null, string? actingUser = null) => RunDbAsync(async () =>
    {
        Logger.LogInformation("Ignoring unmatched server {ServerName} by {User}", raw, actingUser ?? "unknown");
        var sql = $@"
            UPDATE {Sql.Tables.UnmatchedServers} SET
                status = 'ignored',
                resolved_at = CURRENT_TIMESTAMP,
                resolved_by = @ResolvedBy
            WHERE server_name_raw = @Raw AND status = 'pending'";

        var p = new DynamicParameters();
        p.Add("Raw", raw);
        p.Add("ResolvedBy", actingUser ?? "api");

        if (!string.IsNullOrEmpty(sourceSystem))
        {
            sql += " AND source_system = @Source";
            p.Add("Source", sourceSystem);
        }

        await Db.ExecuteAsync(sql, p);
    });
}

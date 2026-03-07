using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class ServerService : BaseService<ServerService>, IServerService
{
    public ServerService(IDbConnection db, ILogger<ServerService> logger) 
        : base(db, logger) { }

    public async Task<IEnumerable<Server>> ListServersAsync(
        string? environment,
        string? application,
        string? patchGroup,
        string? search,
        int limit,
        int offset)
    {
        var sql = $@"
            SELECT 
                s.server_id AS ServerId,
                s.server_name AS ServerName,
                s.fqdn AS Fqdn,
                s.environment AS Environment,
                a.application_name AS ApplicationName,
                s.patch_group AS PatchGroup,
                s.is_active AS IsActive
            FROM {Sql.Tables.Servers} s
            LEFT JOIN {Sql.Tables.Applications} a ON s.primary_application_id = a.application_id
            WHERE s.is_active = TRUE";

        var p = new DynamicParameters();

        AddExactFilter(ref sql, p, "s.environment", "Env", environment);
        AddILikeFilter(ref sql, p, "a.application_name", "App", application);
        AddExactFilter(ref sql, p, "s.patch_group", "PG", patchGroup);

        if (!string.IsNullOrEmpty(search))
        {
            sql += " AND (s.server_name ILIKE @Search ESCAPE '\\' OR s.fqdn ILIKE @Search ESCAPE '\\')";
            p.Add("Search", $"%{EscapeLike(search)}%");
        }

        AddPagination(ref sql, p, limit, offset, "s.server_name");

        return await Db.QueryAsync<Server>(sql, p);
    }

    public async Task<ServerDetail?> GetServerByIdAsync(int id)
    {
        return await Db.QueryFirstOrDefaultAsync<ServerDetail>($@"
            SELECT 
                s.server_id AS ServerId,
                s.server_name AS ServerName,
                s.fqdn AS Fqdn,
                s.environment AS Environment,
                a.application_name AS ApplicationName,
                s.patch_group AS PatchGroup,
                s.is_active AS IsActive,
                s.operating_system AS OperatingSystem,
                s.ip_address AS IpAddress,
                s.location AS Location,
                s.primary_contact AS PrimaryContact
            FROM {Sql.Tables.Servers} s
            LEFT JOIN {Sql.Tables.Applications} a ON s.primary_application_id = a.application_id
            WHERE s.server_id = @Id
        ", new { Id = id });
    }

    public async Task<ServerMatch?> ResolveServerNameAsync(string name)
    {
        return await Db.QueryFirstOrDefaultAsync<ServerMatch>(@"
            SELECT 
                server_id AS ServerId,
                server_name AS ServerName,
                match_type AS MatchType
            FROM system.resolve_server_name(@Name)
            LIMIT 1
        ", new { Name = name });
    }

    public async Task<IEnumerable<UnmatchedServer>> GetUnmatchedServersAsync(string? source, int limit)
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
    }

    public async Task CreateAliasAsync(string canonical, string alias, string? source)
    {
        Logger.LogInformation("Creating server alias: {Alias} -> {Canonical} (source: {Source})", alias, canonical, source);
        await Db.ExecuteAsync($@"
            INSERT INTO {Sql.Tables.ServerAliases} 
                (canonical_name, alias_name, source_system, created_by)
            VALUES (@Canonical, @Alias, @Source, 'api')
            ON CONFLICT (alias_name) DO UPDATE SET 
                canonical_name = EXCLUDED.canonical_name
        ", new { Canonical = canonical, Alias = alias, Source = source });
    }

    public async Task<int> ResolveUnmatchedServerAsync(string raw, int serverId, string? sourceSystem = null)
    {
        Logger.LogInformation("Resolving unmatched server {ServerName} to ID {ServerId}", raw, serverId);
        var sql = $@"
            UPDATE {Sql.Tables.UnmatchedServers} SET
                status = 'resolved',
                resolved_to_server_id = @ServerId,
                resolved_at = CURRENT_TIMESTAMP
            WHERE server_name_raw = @Raw AND status = 'pending'";

        var p = new DynamicParameters();
        p.Add("Raw", raw);
        p.Add("ServerId", serverId);

        if (!string.IsNullOrEmpty(sourceSystem))
        {
            sql += " AND source_system = @Source";
            p.Add("Source", sourceSystem);
        }

        return await Db.ExecuteAsync(sql, p);
    }

    public async Task IgnoreUnmatchedServerAsync(string raw, string? sourceSystem = null)
    {
        Logger.LogInformation("Ignoring unmatched server {ServerName}", raw);
        var sql = $@"
            UPDATE {Sql.Tables.UnmatchedServers} SET
                status = 'ignored',
                resolved_at = CURRENT_TIMESTAMP
            WHERE server_name_raw = @Raw";

        var p = new DynamicParameters();
        p.Add("Raw", raw);

        if (!string.IsNullOrEmpty(sourceSystem))
        {
            sql += " AND source_system = @Source";
            p.Add("Source", sourceSystem);
        }

        await Db.ExecuteAsync(sql, p);
    }
}

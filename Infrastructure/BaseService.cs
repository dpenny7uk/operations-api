using System.Data;
using Dapper;
using Microsoft.Extensions.Logging;

namespace OperationsApi.Infrastructure;

/// <summary>
/// Base class for data services - provides common query building utilities.
/// </summary>
public abstract class BaseService<TService> where TService : class
{
    protected readonly IDbConnection Db;
    protected readonly ILogger<TService> Logger;

    protected BaseService(IDbConnection db, ILogger<TService> logger)
    {
        Db = db ?? throw new ArgumentNullException(nameof(db));
        Logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <summary>
    /// Add ILIKE filter with wildcards for partial matching.
    /// </summary>
    protected static void AddILikeFilter(
        ref string sql,
        DynamicParameters p,
        string column,
        string paramName,
        string? value,
        bool prefix = true,
        bool suffix = true)
    {
        if (string.IsNullOrEmpty(value))
            return;

        sql += $" AND {column} ILIKE @{paramName}";
        var pattern = (prefix ? "%" : "") + value + (suffix ? "%" : "");
        p.Add(paramName, pattern);
    }

    /// <summary>
    /// Add exact match filter.
    /// </summary>
    protected static void AddExactFilter(
        ref string sql,
        DynamicParameters p,
        string column,
        string paramName,
        string? value)
    {
        if (string.IsNullOrEmpty(value))
            return;

        sql += $" AND {column} = @{paramName}";
        p.Add(paramName, value);
    }

    /// <summary>
    /// Add LIMIT/OFFSET pagination.
    /// </summary>
    protected static void AddPagination(
        ref string sql,
        DynamicParameters p,
        int limit,
        int offset = 0,
        string orderBy = "")
    {
        if (!string.IsNullOrEmpty(orderBy))
            sql += $" ORDER BY {orderBy}";

        sql += " LIMIT @Limit";
        p.Add("Limit", limit);

        if (offset > 0)
        {
            sql += " OFFSET @Offset";
            p.Add("Offset", offset);
        }
    }

    /// <summary>
    /// Get count and last update time for freshness checks.
    /// </summary>
    protected async Task<(int Count, DateTime? LastUpdated)> GetTableFreshnessAsync(
        string table,
        string timestampColumn = "updated_at",
        string? whereClause = null)
    {
        var sql = $"SELECT COUNT(*) AS Count, MAX({timestampColumn}) AS LastUpdated FROM {table}";
        
        if (!string.IsNullOrEmpty(whereClause))
            sql += $" WHERE {whereClause}";

        var result = await Db.QueryFirstOrDefaultAsync<dynamic>(sql);
        return (result?.Count ?? 0, result?.LastUpdated as DateTime?);
    }
}

/// <summary>
/// SQL table names and common clauses.
/// </summary>
public static class Sql
{
    public static class Tables
    {
        public const string Servers = "shared.servers";
        public const string Applications = "shared.applications";
        public const string Certificates = "certificates.inventory";
        public const string PatchCycles = "patching.patch_cycles";
        public const string PatchSchedule = "patching.patch_schedule";
        public const string PatchWindows = "patching.patch_windows";
        public const string KnownIssues = "patching.known_issues";
        public const string SyncStatus = "system.sync_status";
        public const string SyncHistory = "system.sync_history";
        public const string UnmatchedServers = "system.unmatched_servers";
        public const string ServerAliases = "system.server_aliases";
        public const string EolSoftware = "eol.end_of_life_software";
    }

    public const string IsActive = "is_active = TRUE";
}

using System.Data;
using Dapper;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace OperationsApi.Infrastructure;

/// <summary>
/// Dapper type handler for DateOnly (PostgreSQL DATE columns via Npgsql).
/// </summary>
public class DateOnlyTypeHandler : SqlMapper.TypeHandler<DateOnly>
{
    public override void SetValue(IDbDataParameter parameter, DateOnly value)
        => parameter.Value = value;

    public override DateOnly Parse(object value) => value switch
    {
        null or DBNull => default,
        DateOnly d => d,
        DateTime dt => DateOnly.FromDateTime(dt),
        _ => DateOnly.FromDateTime(Convert.ToDateTime(value))
    };
}

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
    /// Execute a database operation with error logging. Logs the caller context
    /// and re-throws so the global exception handler still returns 500.
    /// </summary>
    protected async Task<T> RunDbAsync<T>(Func<Task<T>> operation,
        [System.Runtime.CompilerServices.CallerMemberName] string caller = "")
    {
        try
        {
            return await operation();
        }
        // ConflictException is an expected client error (e.g. duplicate row) the
        // caller translates to 409 - don't log it as a database fault.
        catch (Exception ex) when (ex is not ConflictException)
        {
            Logger.LogError(ex, "Database error in {Service}.{Method}", typeof(TService).Name, caller);
            throw;
        }
    }

    protected async Task RunDbAsync(Func<Task> operation,
        [System.Runtime.CompilerServices.CallerMemberName] string caller = "")
    {
        try
        {
            await operation();
        }
        catch (Exception ex) when (ex is not ConflictException)
        {
            Logger.LogError(ex, "Database error in {Service}.{Method}", typeof(TService).Name, caller);
            throw;
        }
    }

    /// <summary>
    /// Run an operation, translating a PostgreSQL unique-constraint violation into a
    /// ConflictException (409) with the supplied message. Any other exception propagates
    /// unchanged. Centralises the catch that services otherwise hand-rolled per constraint.
    /// </summary>
    protected static async Task<T> TranslateUniqueViolation<T>(Func<Task<T>> op, string conflictMessage)
    {
        try { return await op(); }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            throw new ConflictException(conflictMessage);
        }
    }

    /// <summary>
    /// Escape PostgreSQL LIKE/ILIKE metacharacters in user input.
    /// </summary>
    protected static string EscapeLike(string value)
        => value.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

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

        sql += $" AND {column} ILIKE @{paramName} ESCAPE '\\'";
        var escaped = EscapeLike(value);
        var pattern = (prefix ? "%" : "") + escaped + (suffix ? "%" : "");
        p.Add(paramName, pattern);
    }

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

    private static readonly HashSet<string> AllowedOrderByColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        "s.server_name", "server_name", "valid_to", "cycle_date", "occurrence_count",
        "excluded_at", "held_until"
    };

    protected static void AddPagination(
        ref string sql,
        DynamicParameters p,
        int limit,
        int offset = 0,
        string orderBy = "")
    {
        if (!string.IsNullOrEmpty(orderBy))
        {
            if (!AllowedOrderByColumns.Contains(orderBy))
                throw new ArgumentException($"Invalid ORDER BY column: {orderBy}");
            sql += $" ORDER BY {orderBy}";
        }

        sql += " LIMIT @Limit";
        p.Add("Limit", limit);

        if (offset > 0)
        {
            sql += " OFFSET @Offset";
            p.Add("Offset", offset);
        }
    }
}

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
        public const string UnmatchedEolSoftware = "eol.unmatched_software";
        public const string ScanFailures = "system.scan_failures";
        public const string PatchExclusions = "patching.patch_exclusions";
        public const string ExclusionAlerts = "patching.exclusion_alerts";
        public const string DiskSnapshots = "monitoring.disk_snapshots";
        public const string DiskCurrent = "monitoring.disk_current";
        public const string DiskAlerts = "monitoring.alerts";
        public const string Licences = "licensing.licences";
        public const string Renewals = "licensing.renewals";
        public const string LicenceAlerts = "licensing.alerts";
        public const string AuditApplicationGroups = "auditing.application_groups";
        public const string AuditApplicationNominees = "auditing.application_nominees";
        public const string AuditCampaigns = "auditing.campaigns";
        public const string AuditPackets = "auditing.attestation_packets";
        public const string AuditPacketSubjects = "auditing.attestation_packet_subjects";
        public const string AuditDecisions = "auditing.attestation_decisions";
        public const string AuditEmailLog = "auditing.email_log";
        public const string AuditLifecycleLog = "auditing.app_lifecycle_log";
    }
}

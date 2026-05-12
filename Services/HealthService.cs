using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class HealthService : BaseService<HealthService>, IHealthService
{
    public HealthService(IDbConnection db, ILogger<HealthService> logger)
        : base(db, logger) { }

    public Task<HealthSummary> GetHealthSummaryAsync() => RunDbAsync(async () =>
    {
        var syncs = await GetSyncStatusesAsync();

        var counts = await Db.QueryFirstAsync<HealthCounts>($@"
            SELECT
                (SELECT COUNT(*)::INT FROM {Sql.Tables.UnmatchedServers} WHERE status = 'pending') AS Unmatched,
                (SELECT COUNT(*)::INT FROM {Sql.Tables.ScanFailures} WHERE NOT is_resolved) AS Unreachable
        ");

        var hasError = syncs.Any(s => s.Status == "error" || s.FreshnessStatus == "error");
        var hasWarning = syncs.Any(s => s.Status == "warning" || s.FreshnessStatus == "stale");

        return new HealthSummary
        {
            OverallStatus = hasError ? "error" : hasWarning ? "warning" : "healthy",
            SyncStatuses = syncs.ToList(),
            UnmatchedServersCount = counts.Unmatched,
            UnreachableServersCount = counts.Unreachable,
            LastUpdated = DateTime.UtcNow
        };
    });

    public Task<IEnumerable<SyncStatus>> GetSyncStatusesAsync() => RunDbAsync(() =>
        Db.QueryAsync<SyncStatus>($@"
            SELECT 
                sync_name AS SyncName,
                status AS Status,
                last_success_at AS LastSuccessAt,
                EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - last_success_at)) / 3600 AS HoursSinceSuccess,
                CASE 
                    WHEN last_success_at IS NULL THEN 'error'
                    WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - last_success_at)) / 3600 > max_age_hours THEN 'stale'
                    WHEN consecutive_failures > 0 THEN 'warning'
                    ELSE 'healthy'
                END AS FreshnessStatus,
                records_processed AS RecordsProcessed,
                consecutive_failures AS ConsecutiveFailures,
                CASE WHEN last_error_message IS NOT NULL THEN 'Sync error occurred - check server logs' ELSE NULL END AS LastErrorMessage,
                expected_schedule AS ExpectedSchedule
            FROM {Sql.Tables.SyncStatus}
            ORDER BY CASE status 
                WHEN 'error' THEN 1 
                WHEN 'warning' THEN 2 
                ELSE 3 
            END
        ")
    );

    public Task<IEnumerable<SyncHistory>> GetSyncHistoryAsync(string syncName, int limit) => RunDbAsync(() =>
        Db.QueryAsync<SyncHistory>($@"
            SELECT 
                history_id AS HistoryId,
                sync_name AS SyncName,
                started_at AS StartedAt,
                completed_at AS CompletedAt,
                status AS Status,
                records_processed AS RecordsProcessed,
                records_inserted AS RecordsInserted,
                records_updated AS RecordsUpdated,
                records_failed AS RecordsFailed,
                CASE WHEN error_message IS NOT NULL THEN 'Error occurred - check server logs' ELSE NULL END AS ErrorMessage
            FROM {Sql.Tables.SyncHistory}
            WHERE sync_name = @SyncName
            ORDER BY started_at DESC
            LIMIT @Limit
        ", new { SyncName = syncName, Limit = limit })
    );

    public Task<IEnumerable<ValidationRunResult>> RunValidationAsync(string? ruleName) => RunDbAsync(async () =>
    {
        Logger.LogInformation("Running validation rules (filter: {RuleName})", ruleName ?? "all");

        var mapped = (await Db.QueryAsync<ValidationRunResult>(
            "SELECT rule_name AS RuleName, result AS Result, violation_count AS ViolationCount, execution_time_ms AS ExecutionTimeMs FROM system.run_validation(@RuleName)",
            new { RuleName = ruleName }
        )).ToList();

        var failures = mapped.Where(r => r.Result == "fail").ToList();
        if (failures.Count > 0)
            Logger.LogWarning("Validation found {Count} failing rule(s): {Rules}",
                failures.Count, string.Join(", ", failures.Select(f => f.RuleName)));

        return (IEnumerable<ValidationRunResult>)mapped;
    });

    private class HealthCounts
    {
        public int Unmatched { get; set; }
        public int Unreachable { get; set; }
    }
}

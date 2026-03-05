using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class HealthService : BaseService<HealthService>, IHealthService
{
    public HealthService(IDbConnection db, ILogger<HealthService> logger) 
        : base(db, logger) { }

    public async Task<HealthSummary> GetHealthSummaryAsync()
    {
        var syncs = await GetSyncStatusesAsync();
        
        var unmatched = await Db.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM {Sql.Tables.UnmatchedServers} WHERE status = 'pending'"
        );

        var unreachable = await Db.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM {Sql.Tables.ScanFailures} WHERE NOT is_resolved"
        );

        var hasError = syncs.Any(s => s.Status == "error" || s.FreshnessStatus == "error");
        var hasWarning = syncs.Any(s => s.Status == "warning" || s.FreshnessStatus == "stale");

        return new HealthSummary
        {
            OverallStatus = hasError ? "error" : hasWarning ? "warning" : "healthy",
            SyncStatuses = syncs.ToList(),
            UnmatchedServersCount = unmatched,
            UnreachableServersCount = unreachable,
            LastUpdated = DateTime.UtcNow
        };
    }

    public async Task<IEnumerable<SyncStatus>> GetSyncStatusesAsync()
    {
        return await Db.QueryAsync<SyncStatus>($@"
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
                last_error_message AS LastErrorMessage,
                expected_schedule AS ExpectedSchedule
            FROM {Sql.Tables.SyncStatus}
            ORDER BY CASE status 
                WHEN 'error' THEN 1 
                WHEN 'warning' THEN 2 
                ELSE 3 
            END
        ");
    }

    public async Task<IEnumerable<SyncHistory>> GetSyncHistoryAsync(string syncName, int limit)
    {
        return await Db.QueryAsync<SyncHistory>($@"
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
                error_message AS ErrorMessage
            FROM {Sql.Tables.SyncHistory}
            WHERE sync_name = @SyncName
            ORDER BY started_at DESC
            LIMIT @Limit
        ", new { SyncName = syncName, Limit = limit });
    }

    public async Task<IEnumerable<ValidationRunResult>> RunValidationAsync(string? ruleName)
    {
        var results = await Db.QueryAsync<dynamic>(
            "SELECT * FROM system.run_validation(@RuleName)",
            new { RuleName = ruleName }
        );

        return results.Select(r => new ValidationRunResult
        {
            RuleName = r.rule_name,
            Result = r.result,
            ViolationCount = r.violation_count,
            ExecutionTimeMs = r.execution_time_ms
        });
    }
}

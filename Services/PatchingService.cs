using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class PatchingService : BaseService<PatchingService>, IPatchingService
{
    // Typed DTOs for intermediate query results (replaces dynamic)
    private record NextCycleRow(int CycleId, DateOnly CycleDate, int? ServersOnprem, string? Status, int? DaysUntil);
    private record GroupCount(string? PatchGroup, int Count);
    private record SeverityCount(string? Severity, int ServerCount);

    public PatchingService(IDbConnection db, ILogger<PatchingService> logger)
        : base(db, logger) { }

    public async Task<NextPatchingSummary?> GetNextPatchingSummaryAsync()
    {
        // Get next active cycle
        var cycle = await Db.QueryFirstOrDefaultAsync<NextCycleRow>($@"
            SELECT
                cycle_id AS CycleId,
                cycle_date AS CycleDate,
                servers_onprem AS ServersOnprem,
                status AS Status,
                (cycle_date - CURRENT_DATE)::INT AS DaysUntil
            FROM {Sql.Tables.PatchCycles}
            WHERE cycle_date >= CURRENT_DATE AND status = 'active'
            ORDER BY cycle_date
            LIMIT 1
        ");

        if (cycle == null)
            return null;

        // Get servers by group and issues by severity in a single roundtrip
        using var multi = await Db.QueryMultipleAsync($@"
            SELECT patch_group AS PatchGroup, COUNT(*)::INT AS Count
            FROM {Sql.Tables.PatchSchedule}
            WHERE cycle_id = @CycleId
            GROUP BY patch_group;

            SELECT ki.severity AS Severity, COUNT(DISTINCT ps.server_name)::INT AS ServerCount
            FROM {Sql.Tables.PatchSchedule} ps
            JOIN {Sql.Tables.KnownIssues} ki ON ki.is_active
                AND (ps.app = ANY(COALESCE(ki.affected_apps, ARRAY[]::TEXT[])) OR ps.service = ANY(COALESCE(ki.affected_services, ARRAY[]::TEXT[])))
            WHERE ps.cycle_id = @CycleId
            GROUP BY ki.severity;
        ", new { CycleId = cycle.CycleId });

        var groups = await multi.ReadAsync<GroupCount>();
        var issues = (await multi.ReadAsync<SeverityCount>()).ToList();

        return new NextPatchingSummary
        {
            Cycle = new PatchCycle
            {
                CycleId = cycle.CycleId,
                CycleDate = cycle.CycleDate,
                ServerCount = cycle.ServersOnprem ?? 0,
                Status = cycle.Status ?? "unknown"
            },
            DaysUntil = cycle.DaysUntil ?? 0,
            ServersByGroup = groups.ToDictionary(
                g => g.PatchGroup ?? "Unassigned",
                g => g.Count
            ),
            IssuesBySeverity = issues.ToDictionary(
                i => i.Severity ?? "Unknown",
                i => i.ServerCount
            ),
            TotalIssuesAffectingServers = issues.Sum(i => i.ServerCount)
        };
    }

    public async Task<IEnumerable<PatchCycle>> ListPatchCyclesAsync(bool upcomingOnly, int limit)
    {
        var sql = $@"
            SELECT
                cycle_id AS CycleId,
                cycle_date AS CycleDate,
                servers_onprem AS ServerCount,
                status AS Status
            FROM {Sql.Tables.PatchCycles}";

        if (upcomingOnly)
        {
            sql += " WHERE cycle_date >= CURRENT_DATE AND status = 'active'";
            sql += " ORDER BY cycle_date LIMIT @Limit";
        }
        else
        {
            sql += " ORDER BY cycle_date DESC LIMIT @Limit";
        }

        return await Db.QueryAsync<PatchCycle>(sql, new { Limit = limit });
    }

    public async Task<PagedResult<PatchScheduleItem>> GetCycleServersAsync(
        int cycleId,
        string? patchGroup,
        bool? hasIssues,
        int limit = 100,
        int offset = 0)
    {
        var where = $"WHERE ps.cycle_id = @CycleId";
        var p = new DynamicParameters();
        p.Add("CycleId", cycleId);

        if (!string.IsNullOrEmpty(patchGroup))
        {
            where += " AND ps.patch_group = @PatchGroup";
            p.Add("PatchGroup", patchGroup);
        }

        var having = "";
        if (hasIssues.HasValue)
        {
            having = hasIssues.Value
                ? " HAVING COUNT(ki.issue_id) > 0"
                : " HAVING COUNT(ki.issue_id) = 0";
        }

        var joins = $@"
            FROM {Sql.Tables.PatchSchedule} ps
            LEFT JOIN {Sql.Tables.PatchWindows} pw
                ON pw.patch_group = ps.patch_group AND pw.window_type = 'onprem'
            LEFT JOIN {Sql.Tables.KnownIssues} ki
                ON ki.is_active AND (ps.app = ANY(COALESCE(ki.affected_apps, ARRAY[]::TEXT[])) OR ps.service = ANY(COALESCE(ki.affected_services, ARRAY[]::TEXT[])))
            {where}";

        var groupBy = @"
            GROUP BY ps.schedule_id, ps.server_name,
                     ps.patch_group, pw.scheduled_time, ps.app";

        p.Add("Limit", limit);
        p.Add("Offset", offset);

        // Combined count + data in a single roundtrip for consistency
        var combinedSql = $@"
            SELECT COUNT(*) FROM (SELECT ps.schedule_id {joins} {groupBy} {having}) sub;

            SELECT
                ps.schedule_id AS ScheduleId,
                ps.server_name AS ServerName,
                ps.patch_group AS PatchGroup,
                pw.scheduled_time AS ScheduledTime,
                ps.app AS Application,
                CASE WHEN COUNT(ki.issue_id) > 0 THEN TRUE ELSE FALSE END AS HasKnownIssue,
                COUNT(ki.issue_id) AS IssueCount
            {joins}
            {groupBy}
            {having}
            ORDER BY ps.patch_group, ps.server_name
            LIMIT @Limit OFFSET @Offset";

        using var multi = await Db.QueryMultipleAsync(combinedSql, p);
        var totalCount = await multi.ReadSingleAsync<int>();
        var items = await multi.ReadAsync<PatchScheduleItem>();

        return new PagedResult<PatchScheduleItem>
        {
            Items = items,
            TotalCount = totalCount,
            Limit = limit,
            Offset = offset
        };
    }

    public async Task<IEnumerable<KnownIssue>> ListKnownIssuesAsync(
        string? severity,
        string? app,
        string? patchType,
        bool activeOnly)
    {
        var sql = $@"
            SELECT 
                issue_id AS IssueId,
                title AS Title,
                severity AS Severity,
                application AS Application,
                fix AS Fix,
                applies_to_windows AS AppliesToWindows,
                applies_to_sql AS AppliesToSql,
                applies_to_other AS AppliesToOther
            FROM {Sql.Tables.KnownIssues}
            WHERE 1=1";

        var p = new DynamicParameters();

        if (activeOnly)
            sql += " AND is_active = TRUE";

        if (!string.IsNullOrEmpty(severity))
        {
            sql += " AND severity = @Severity";
            p.Add("Severity", severity);
        }

        if (!string.IsNullOrEmpty(app))
        {
            sql += " AND application ILIKE @App ESCAPE '\\'";
            p.Add("App", $"%{EscapeLike(app)}%");
        }

        if (!string.IsNullOrEmpty(patchType))
        {
            var typeFilter = patchType.ToLower() switch
            {
                "windows" => " AND applies_to_windows",
                "sql" => " AND applies_to_sql",
                "other" => " AND applies_to_other",
                _ => ""
            };
            if (typeFilter.Length == 0)
                Logger.LogWarning("Unknown patchType filter ignored: {PatchType}", patchType);
            else
                sql += typeFilter;
        }

        sql += @"
            ORDER BY CASE severity
                WHEN 'CRITICAL' THEN 1
                WHEN 'HIGH' THEN 2
                WHEN 'MEDIUM' THEN 3
                ELSE 4
            END
            LIMIT 500";

        return await Db.QueryAsync<KnownIssue>(sql, p);
    }

    public async Task<KnownIssueDetail?> GetKnownIssueByIdAsync(int id)
    {
        return await Db.QueryFirstOrDefaultAsync<KnownIssueDetail>($@"
            SELECT 
                issue_id AS IssueId,
                title AS Title,
                severity AS Severity,
                application AS Application,
                fix AS Fix,
                applies_to_windows AS AppliesToWindows,
                applies_to_sql AS AppliesToSql,
                applies_to_other AS AppliesToOther,
                trigger_description AS TriggerDescription,
                signature AS Signature,
                category_notes AS CategoryNotes,
                confluence_url AS ConfluenceUrl,
                is_active AS IsActive,
                last_synced_at AS LastSyncedAt
            FROM {Sql.Tables.KnownIssues}
            WHERE issue_id = @Id
        ", new { Id = id });
    }

    public async Task<IEnumerable<PatchWindow>> GetPatchWindowsAsync()
    {
        return await Db.QueryAsync<PatchWindow>($@"
            SELECT 
                patch_group AS PatchGroup,
                window_type AS WindowType,
                scheduled_time AS ScheduledTime,
                CASE WHEN start_time IS NOT NULL AND end_time IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (end_time - start_time)) / 60
                END::INTEGER AS DurationMinutes
            FROM {Sql.Tables.PatchWindows}
            ORDER BY patch_group, window_type
        ");
    }
}

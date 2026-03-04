using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class PatchingService : BaseService<PatchingService>, IPatchingService
{
    public PatchingService(IDbConnection db, ILogger<PatchingService> logger) 
        : base(db, logger) { }

    public async Task<NextPatchingSummary?> GetNextPatchingSummaryAsync()
    {
        // Get next active cycle
        var cycle = await Db.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT 
                cycle_id,
                cycle_date,
                servers_onprem,
                servers_azure,
                status,
                cycle_date - CURRENT_DATE AS days_until
            FROM {Sql.Tables.PatchCycles}
            WHERE cycle_date >= CURRENT_DATE AND status = 'active'
            ORDER BY cycle_date
            LIMIT 1
        ");

        if (cycle == null)
            return null;

        // Get servers by patch group
        var groups = await Db.QueryAsync<dynamic>($@"
            SELECT patch_group, COUNT(*) AS count
            FROM {Sql.Tables.PatchSchedule}
            WHERE cycle_id = @CycleId
            GROUP BY patch_group
        ", new { CycleId = cycle.cycle_id });

        // Get issues by severity
        var issues = await Db.QueryAsync<dynamic>($@"
            SELECT ki.severity, COUNT(DISTINCT ps.server_name) AS server_count
            FROM {Sql.Tables.PatchSchedule} ps
            JOIN {Sql.Tables.KnownIssues} ki ON ki.is_active 
                AND (ps.app = ANY(ki.affected_apps) OR ps.service = ANY(ki.affected_services))
            WHERE ps.cycle_id = @CycleId
            GROUP BY ki.severity
        ", new { CycleId = cycle.cycle_id });

        return new NextPatchingSummary
        {
            Cycle = new PatchCycle
            {
                CycleId = cycle.cycle_id,
                CycleDate = cycle.cycle_date,
                ServersOnprem = cycle.servers_onprem,
                ServersAzure = cycle.servers_azure,
                Status = cycle.status
            },
            DaysUntil = cycle.days_until,
            ServersByGroup = groups.ToDictionary(
                g => (string)g.patch_group,
                g => (int)g.count
            ),
            IssuesBySeverity = issues.ToDictionary(
                i => (string)i.severity,
                i => (int)i.server_count
            ),
            TotalIssuesAffectingServers = issues.Sum(i => (int)i.server_count)
        };
    }

    public async Task<IEnumerable<PatchCycle>> ListPatchCyclesAsync(bool upcomingOnly, int limit)
    {
        var sql = $@"
            SELECT 
                cycle_id AS CycleId,
                cycle_date AS CycleDate,
                servers_onprem AS ServersOnprem,
                servers_azure AS ServersAzure,
                status AS Status
            FROM {Sql.Tables.PatchCycles}";

        if (upcomingOnly)
            sql += " WHERE cycle_date >= CURRENT_DATE AND status = 'active'";

        sql += " ORDER BY cycle_date LIMIT @Limit";

        return await Db.QueryAsync<PatchCycle>(sql, new { Limit = limit });
    }

    public async Task<IEnumerable<PatchScheduleItem>> GetCycleServersAsync(
        int cycleId,
        string? patchGroup,
        bool? hasIssues)
    {
        var sql = $@"
            SELECT 
                ps.schedule_id AS ScheduleId,
                ps.server_name AS ServerName,
                ps.server_type AS ServerType,
                ps.patch_group AS PatchGroup,
                pw.scheduled_time AS ScheduledTime,
                ps.app AS Application,
                CASE WHEN COUNT(ki.issue_id) > 0 THEN TRUE ELSE FALSE END AS HasKnownIssue,
                COUNT(ki.issue_id) AS IssueCount
            FROM {Sql.Tables.PatchSchedule} ps
            LEFT JOIN {Sql.Tables.PatchWindows} pw 
                ON pw.patch_group = ps.patch_group AND pw.window_type = ps.server_type
            LEFT JOIN {Sql.Tables.KnownIssues} ki 
                ON ki.is_active AND (ps.app = ANY(ki.affected_apps) OR ps.service = ANY(ki.affected_services))
            WHERE ps.cycle_id = @CycleId";

        var p = new DynamicParameters();
        p.Add("CycleId", cycleId);

        if (!string.IsNullOrEmpty(patchGroup))
        {
            sql += " AND ps.patch_group = @PatchGroup";
            p.Add("PatchGroup", patchGroup);
        }

        sql += @"
            GROUP BY ps.schedule_id, ps.server_name, ps.server_type, 
                     ps.patch_group, pw.scheduled_time, ps.app";

        if (hasIssues.HasValue)
        {
            sql += hasIssues.Value
                ? " HAVING COUNT(ki.issue_id) > 0"
                : " HAVING COUNT(ki.issue_id) = 0";
        }

        sql += " ORDER BY ps.patch_group, ps.server_name";

        return await Db.QueryAsync<PatchScheduleItem>(sql, p);
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
            sql += " AND application ILIKE @App";
            p.Add("App", $"%{app}%");
        }

        if (!string.IsNullOrEmpty(patchType))
        {
            sql += patchType.ToLower() switch
            {
                "windows" => " AND applies_to_windows",
                "sql" => " AND applies_to_sql",
                "other" => " AND applies_to_other",
                _ => ""
            };
        }

        sql += @"
            ORDER BY CASE severity 
                WHEN 'CRITICAL' THEN 1 
                WHEN 'HIGH' THEN 2 
                WHEN 'MEDIUM' THEN 3 
                ELSE 4 
            END";

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
                COALESCE(EXTRACT(EPOCH FROM (end_time - start_time)) / 60, 90)::INTEGER AS DurationMinutes
            FROM {Sql.Tables.PatchWindows}
            ORDER BY patch_group, window_type
        ");
    }
}

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

    public Task<NextPatchingSummary?> GetNextPatchingSummaryAsync() => RunDbAsync(async () =>
    {
        // Get next active cycle
        // Find this week's cycle (Monday to Sunday), fall back to next upcoming
        var cycle = await Db.QueryFirstOrDefaultAsync<NextCycleRow>($@"
            SELECT
                cycle_id AS CycleId,
                cycle_date AS CycleDate,
                servers_onprem AS ServersOnprem,
                status AS Status,
                (cycle_date - CURRENT_DATE)::INT AS DaysUntil
            FROM {Sql.Tables.PatchCycles}
            WHERE status = 'active'
              AND cycle_date >= date_trunc('week', CURRENT_DATE)::DATE
              AND cycle_date <  (date_trunc('week', CURRENT_DATE) + INTERVAL '7 days')::DATE
            ORDER BY cycle_date
            LIMIT 1
        ") ?? await Db.QueryFirstOrDefaultAsync<NextCycleRow>($@"
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

        return (NextPatchingSummary?)new NextPatchingSummary
        {
            Cycle = new PatchCycle
            {
                CycleId = cycle.CycleId,
                CycleDate = cycle.CycleDate,
                ServerCount = groups.Sum(g => g.Count),
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
    });

    public Task<IEnumerable<PatchCycle>> ListPatchCyclesAsync(bool upcomingOnly, int limit) => RunDbAsync(async () =>
    {
        var sql = $@"
            SELECT
                pc.cycle_id AS CycleId,
                pc.cycle_date AS CycleDate,
                COALESCE((SELECT COUNT(*)::INT FROM {Sql.Tables.PatchSchedule} ps WHERE ps.cycle_id = pc.cycle_id), 0) AS ServerCount,
                pc.status AS Status,
                CASE
                    WHEN pc.status = 'completed' THEN 'Completed'
                    WHEN pc.status = 'cancelled' THEN 'Cancelled'
                    WHEN pc.cycle_date = CURRENT_DATE THEN 'Active'
                    WHEN pc.cycle_date > CURRENT_DATE THEN 'Upcoming'
                    ELSE 'Past'
                END AS DisplayStatus
            FROM {Sql.Tables.PatchCycles} pc";

        if (upcomingOnly)
        {
            sql += @" WHERE (pc.status = 'active' AND pc.cycle_date >= CURRENT_DATE)
                         OR (pc.status = 'completed' AND pc.cycle_date >= CURRENT_DATE - INTERVAL '7 days')";
            sql += " ORDER BY pc.cycle_date LIMIT @Limit";
        }
        else
        {
            sql += " ORDER BY pc.cycle_date DESC LIMIT @Limit";
        }

        return await Db.QueryAsync<PatchCycle>(sql, new { Limit = limit });
    });

    public Task<PagedResult<PatchScheduleItem>> GetCycleServersAsync(
        int cycleId,
        string? patchGroup,
        bool? hasIssues,
        string? search,
        int limit = 100,
        int offset = 0) => RunDbAsync(async () =>
    {
        var where = $"WHERE ps.cycle_id = @CycleId";
        var p = new DynamicParameters();
        p.Add("CycleId", cycleId);

        if (!string.IsNullOrEmpty(patchGroup))
        {
            where += " AND ps.patch_group = @PatchGroup";
            p.Add("PatchGroup", patchGroup);
        }

        if (!string.IsNullOrEmpty(search))
        {
            where += @" AND (ps.server_name ILIKE @Search ESCAPE '\'
                OR ps.service ILIKE @Search ESCAPE '\'
                OR ps.app ILIKE @Search ESCAPE '\'
                OR ps.patch_group ILIKE @Search ESCAPE '\')";
            p.Add("Search", $"%{EscapeLike(search)}%");
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
                     ps.patch_group, pw.scheduled_time, ps.app, ps.service";

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
                ps.service AS Service,
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
    });

    public Task<IEnumerable<KnownIssue>> ListKnownIssuesAsync(
        string? severity,
        string? app,
        string? patchType,
        bool activeOnly) => RunDbAsync(async () =>
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
    });

    public Task<KnownIssueDetail?> GetKnownIssueByIdAsync(int id) => RunDbAsync(() =>
        Db.QueryFirstOrDefaultAsync<KnownIssueDetail>($@"
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
        ", new { Id = id })
    );

    public Task<IEnumerable<GlobalServerSearchResult>> SearchServersGlobalAsync(string query, int limit) => RunDbAsync(async () =>
    {
        var sql = $@"
            SELECT
                pc.cycle_id AS CycleId,
                pc.cycle_date AS CycleDate,
                CASE
                    WHEN pc.status = 'completed' THEN 'Completed'
                    WHEN pc.status = 'cancelled' THEN 'Cancelled'
                    WHEN pc.cycle_date = CURRENT_DATE THEN 'Active'
                    WHEN pc.cycle_date > CURRENT_DATE THEN 'Upcoming'
                    ELSE 'Past'
                END AS DisplayStatus,
                ps.schedule_id AS ScheduleId,
                ps.server_name AS ServerName,
                ps.patch_group AS PatchGroup,
                COALESCE(pw.scheduled_time, ps.scheduled_time) AS ScheduledTime,
                ps.app AS Application,
                ps.service AS Service,
                CASE WHEN COUNT(ki.issue_id) OVER (PARTITION BY ps.schedule_id) > 0 THEN TRUE ELSE FALSE END AS HasKnownIssue,
                COUNT(ki.issue_id) OVER (PARTITION BY ps.schedule_id) AS IssueCount
            FROM {Sql.Tables.PatchSchedule} ps
            JOIN {Sql.Tables.PatchCycles} pc ON pc.cycle_id = ps.cycle_id
            LEFT JOIN {Sql.Tables.PatchWindows} pw
                ON pw.patch_group = ps.patch_group AND pw.window_type = 'onprem'
            LEFT JOIN {Sql.Tables.KnownIssues} ki
                ON ki.is_active AND (ps.app = ANY(COALESCE(ki.affected_apps, ARRAY[]::TEXT[])) OR ps.service = ANY(COALESCE(ki.affected_services, ARRAY[]::TEXT[])))
            WHERE ((pc.status = 'active' AND pc.cycle_date >= CURRENT_DATE)
                OR (pc.status = 'completed' AND pc.cycle_date >= CURRENT_DATE - INTERVAL '7 days'))
              AND (ps.server_name ILIKE @Search ESCAPE '\'
                OR ps.service ILIKE @Search ESCAPE '\'
                OR ps.app ILIKE @Search ESCAPE '\'
                OR ps.patch_group ILIKE @Search ESCAPE '\')
            ORDER BY pc.cycle_date, ps.server_name
            LIMIT @Limit";

        var searchTerm = $"%{EscapeLike(query)}%";
        var rows = await Db.QueryAsync<GlobalSearchRow>(sql, new { Search = searchTerm, Limit = limit });

        var grouped = rows
            .GroupBy(r => new { r.CycleId, r.CycleDate, r.DisplayStatus })
            .Select(g => new GlobalServerSearchResult
            {
                CycleId = g.Key.CycleId,
                CycleDate = g.Key.CycleDate,
                DisplayStatus = g.Key.DisplayStatus,
                Servers = g.Select(r => new PatchScheduleItem
                {
                    ScheduleId = r.ScheduleId,
                    ServerName = r.ServerName,
                    PatchGroup = r.PatchGroup,
                    ScheduledTime = r.ScheduledTime,
                    Application = r.Application,
                    Service = r.Service,
                    HasKnownIssue = r.HasKnownIssue,
                    IssueCount = r.IssueCount
                }).ToList(),
                TotalCount = g.Count()
            });

        return grouped;
    });

    private record GlobalSearchRow(
        int CycleId, DateOnly CycleDate, string DisplayStatus,
        int ScheduleId, string ServerName, string? PatchGroup,
        string? ScheduledTime, string? Application, string? Service,
        bool HasKnownIssue, int IssueCount);

    public Task<IEnumerable<PatchWindow>> GetPatchWindowsAsync() => RunDbAsync(() =>
        Db.QueryAsync<PatchWindow>($@"
            SELECT
                patch_group AS PatchGroup,
                window_type AS WindowType,
                scheduled_time AS ScheduledTime,
                CASE WHEN start_time IS NOT NULL AND end_time IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (end_time - start_time)) / 60
                END::INTEGER AS DurationMinutes
            FROM {Sql.Tables.PatchWindows}
            ORDER BY patch_group, window_type
        ")
    );

    public Task<bool> UpdateCycleStatusAsync(int cycleId, string status) => RunDbAsync(async () =>
    {
        var rows = await Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.PatchCycles}
            SET status = @Status, updated_at = CURRENT_TIMESTAMP
            WHERE cycle_id = @CycleId
        ", new { CycleId = cycleId, Status = status });
        return rows > 0;
    });
}

using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class PatchingService : BaseService<PatchingService>, IPatchingService
{
    // Typed DTOs for intermediate query results (replaces dynamic)
    private record NextCycleRow(int CycleId, DateOnly CycleDate, int? ServersOnprem, string? Status, int? DaysUntil);
    private record GroupCount(int CycleId, string? PatchGroup, int Count);
    private record SeverityCount(string? Severity, int ServerCount);
    private record GroupWindow(string PatchGroup, string ScheduledTime);

    public PatchingService(IDbConnection db, ILogger<PatchingService> logger)
        : base(db, logger) { }

    public Task<NextPatchingSummary?> GetNextPatchingSummaryAsync(string? businessUnit = null) => RunDbAsync(async () =>
    {
        // Find ALL upcoming active cycles in the next 45 days. Weekly cycles
        // (most groups) and monthly cycles (e.g. usa/usb) both fall inside
        // this window. Widened from the original current-week-only filter,
        // which silently dropped monthly groups.
        var cycles = (await Db.QueryAsync<NextCycleRow>($@"
            SELECT
                cycle_id AS CycleId,
                cycle_date AS CycleDate,
                servers_onprem AS ServersOnprem,
                status AS Status,
                (cycle_date - CURRENT_DATE)::INT AS DaysUntil
            FROM {Sql.Tables.PatchCycles}
            WHERE status = 'active'
              AND cycle_date >= CURRENT_DATE
              AND cycle_date <  CURRENT_DATE + INTERVAL '45 days'
            ORDER BY cycle_date
        ")).ToList();

        // The source HTML schedule page is updated by hand and sometimes lags
        // behind the actual cycle cadence. When there's no upcoming cycle in
        // the 45-day window, fall back to the most recent past cycle within
        // 30 days so the dashboard still shows context with an IsStale flag.
        // The truly-empty case (no cycles in either direction) still returns
        // null -> 404, which preserves the diagnostic for total data loss.
        bool isStale = false;
        if (cycles.Count == 0)
        {
            // Include 'completed' because sync_patching_schedule.py flips
            // past cycles from 'active' to 'completed' on every run. Filtering
            // on 'active' alone would miss every cycle the sync has already
            // processed - exactly the rows we want for the stale fallback.
            cycles = (await Db.QueryAsync<NextCycleRow>($@"
                SELECT
                    cycle_id AS CycleId,
                    cycle_date AS CycleDate,
                    servers_onprem AS ServersOnprem,
                    status AS Status,
                    (cycle_date - CURRENT_DATE)::INT AS DaysUntil
                FROM {Sql.Tables.PatchCycles}
                WHERE status IN ('active', 'completed')
                  AND cycle_date >= CURRENT_DATE - INTERVAL '30 days'
                  AND cycle_date <  CURRENT_DATE
                ORDER BY cycle_date DESC
                LIMIT 1
            ")).ToList();

            if (cycles.Count == 0)
                return null;

            isStale = true;
        }

        var cycleIds = cycles.Select(c => c.CycleId).ToArray();

        // When BU is set, narrow the per-cycle counts and issue counts to
        // servers in that BU. The join uses ps.server_id → shared.servers
        // (CLAUDE.md note: patch_schedule.business_unit is denormalised; the
        // canonical BU lives on shared.servers). Rows with server_id IS NULL
        // (soft-deleted servers) are excluded by the inner join - correct,
        // since they no longer belong to any BU.
        var hasBu = !string.IsNullOrWhiteSpace(businessUnit);
        var buJoin = hasBu
            ? $" INNER JOIN {Sql.Tables.Servers} s ON s.server_id = ps.server_id AND s.is_active = TRUE AND s.business_unit = @BusinessUnit"
            : "";

        // Get servers by group, issues by severity, and the configured time
        // window per patch group. DISTINCT ON collapses the onprem/azure pair
        // to one row; WHERE scheduled_time IS NOT NULL drops the empty Azure
        // placeholder rows.
        using var multi = await Db.QueryMultipleAsync($@"
            SELECT ps.cycle_id AS CycleId, ps.patch_group AS PatchGroup, COUNT(*)::INT AS Count
            FROM {Sql.Tables.PatchSchedule} ps{buJoin}
            WHERE ps.cycle_id = ANY(@CycleIds)
            GROUP BY ps.cycle_id, ps.patch_group;

            SELECT ki.severity AS Severity, COUNT(DISTINCT ps.server_name)::INT AS ServerCount
            FROM {Sql.Tables.PatchSchedule} ps{buJoin}
            JOIN {Sql.Tables.KnownIssues} ki ON ki.is_active
                AND (LOWER(ps.app) = ANY(COALESCE(ki.affected_apps, ARRAY[]::TEXT[])) OR LOWER(ps.service) = ANY(COALESCE(ki.affected_services, ARRAY[]::TEXT[])))
            WHERE ps.cycle_id = ANY(@CycleIds)
            GROUP BY ki.severity;

            SELECT DISTINCT ON (patch_group) patch_group AS PatchGroup, scheduled_time AS ScheduledTime
            FROM {Sql.Tables.PatchWindows}
            WHERE scheduled_time IS NOT NULL
            ORDER BY patch_group, window_type;
        ", new { CycleIds = cycleIds, BusinessUnit = businessUnit });

        var groups = (await multi.ReadAsync<GroupCount>()).ToList();
        var issues = (await multi.ReadAsync<SeverityCount>()).ToList();
        var windows = (await multi.ReadAsync<GroupWindow>()).ToList();
        var first = cycles[0];

        // Build per-cycle detail (date + groups for that date)
        var cycleMap = cycles.ToDictionary(c => c.CycleId);
        var cycleDetails = cycles.Select(c => new CycleDetailItem
        {
            CycleDate = c.CycleDate,
            ServersByGroup = groups
                .Where(g => g.CycleId == c.CycleId)
                .ToDictionary(g => g.PatchGroup ?? "Unassigned", g => g.Count)
        }).ToList();

        // Aggregate across all cycles for the total
        var aggregatedGroups = groups
            .GroupBy(g => g.PatchGroup ?? "Unassigned")
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Count));

        return (NextPatchingSummary?)new NextPatchingSummary
        {
            Cycle = new PatchCycle
            {
                CycleId = first.CycleId,
                CycleDate = first.CycleDate,
                ServerCount = groups.Sum(g => g.Count),
                Status = first.Status ?? "unknown"
            },
            DaysUntil = first.DaysUntil ?? 0,
            CycleDates = cycles.Select(c => c.CycleDate).ToList(),
            CycleDetails = cycleDetails,
            ServersByGroup = aggregatedGroups,
            WindowsByGroup = windows.ToDictionary(w => w.PatchGroup, w => w.ScheduledTime),
            IssuesBySeverity = issues.ToDictionary(
                i => i.Severity ?? "Unknown",
                i => i.ServerCount
            ),
            TotalIssuesAffectingServers = issues.Sum(i => i.ServerCount),
            IsStale = isStale,
            DaysOverdue = isStale ? -(first.DaysUntil ?? 0) : null
        };
    });

    public Task<IEnumerable<PatchCycle>> ListPatchCyclesAsync(bool upcomingOnly, int limit, string? businessUnit = null) => RunDbAsync(async () =>
    {
        // When BU is set, narrow the per-cycle aggregate (server count + the
        // completed/failed/started/finished projections) to servers in that
        // BU. Cycles themselves remain visible regardless of BU - every BU
        // shares the same monthly cadence - but their headline server counts
        // become BU-scoped, matching the rest of the console's per-BU view.
        var hasBu = !string.IsNullOrWhiteSpace(businessUnit);
        var buJoin = hasBu
            ? $" INNER JOIN {Sql.Tables.Servers} s ON s.server_id = ps.server_id AND s.is_active = TRUE AND s.business_unit = @BusinessUnit"
            : "";
        var sql = $@"
            SELECT
                pc.cycle_id AS CycleId,
                pc.cycle_date AS CycleDate,
                COALESCE(agg.total, 0)     AS ServerCount,
                COALESCE(agg.completed, 0) AS CompletedCount,
                COALESCE(agg.failed, 0)    AS FailedCount,
                agg.started_at             AS StartedAt,
                agg.completed_at           AS CompletedAt,
                pc.status AS Status,
                CASE
                    WHEN pc.status = 'completed' THEN 'Completed'
                    WHEN pc.status = 'cancelled' THEN 'Cancelled'
                    WHEN pc.cycle_date = CURRENT_DATE THEN 'Active'
                    WHEN pc.cycle_date > CURRENT_DATE THEN 'Upcoming'
                    ELSE 'Past'
                END AS DisplayStatus
            FROM {Sql.Tables.PatchCycles} pc
            LEFT JOIN (
                SELECT
                    ps.cycle_id,
                    COUNT(*)::INT AS total,
                    COUNT(*) FILTER (WHERE ps.patch_status = 'completed')::INT AS completed,
                    COUNT(*) FILTER (WHERE ps.patch_status = 'failed')::INT    AS failed,
                    MIN(ps.status_updated_at) FILTER (WHERE ps.patch_status IN ('in_progress','completed','failed')) AS started_at,
                    MAX(ps.status_updated_at) FILTER (WHERE ps.patch_status IN ('completed','failed')) AS completed_at
                FROM {Sql.Tables.PatchSchedule} ps{buJoin}
                GROUP BY ps.cycle_id
            ) agg ON agg.cycle_id = pc.cycle_id";

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

        return await Db.QueryAsync<PatchCycle>(sql, new { Limit = limit, BusinessUnit = businessUnit });
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
            where += " AND (ps.server_name ILIKE @Search ESCAPE @Esc"
                   + " OR ps.service ILIKE @Search ESCAPE @Esc"
                   + " OR ps.app ILIKE @Search ESCAPE @Esc"
                   + " OR ps.patch_group ILIKE @Search ESCAPE @Esc)";
            p.Add("Search", $"%{EscapeLike(search)}%");
            p.Add("Esc", "\\");
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
            LEFT JOIN {Sql.Tables.Servers} s ON ps.server_id = s.server_id
            LEFT JOIN {Sql.Tables.PatchWindows} pw
                ON pw.patch_group = ps.patch_group AND pw.window_type = 'onprem'
            LEFT JOIN {Sql.Tables.KnownIssues} ki
                ON ki.is_active AND (ps.app = ANY(COALESCE(ki.affected_apps, ARRAY[]::TEXT[])) OR ps.service = ANY(COALESCE(ki.affected_services, ARRAY[]::TEXT[])))
            {where}";

        var groupBy = @"
            GROUP BY ps.schedule_id, ps.server_name,
                     ps.patch_group, pw.scheduled_time, ps.app, ps.service, s.business_unit";

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
                s.business_unit AS BusinessUnit,
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
                -- Use stored status when present; otherwise derive from severity
                -- so the design's three-way bucketing (blocking/workaround/resolved) always has a value.
                COALESCE(
                    LOWER(status),
                    CASE
                        WHEN severity = 'HIGH'   THEN 'blocking'
                        WHEN severity = 'MEDIUM' THEN 'workaround'
                        ELSE 'resolved'
                    END
                ) AS Status,
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
                s.business_unit AS BusinessUnit,
                (COUNT(ki.issue_id) OVER (PARTITION BY ps.schedule_id) > 0) AS HasKnownIssue,
                (COUNT(ki.issue_id) OVER (PARTITION BY ps.schedule_id))::INT AS IssueCount
            FROM {Sql.Tables.PatchSchedule} ps
            JOIN {Sql.Tables.PatchCycles} pc ON pc.cycle_id = ps.cycle_id
            LEFT JOIN {Sql.Tables.Servers} s ON ps.server_id = s.server_id
            LEFT JOIN {Sql.Tables.PatchWindows} pw
                ON pw.patch_group = ps.patch_group AND pw.window_type = 'onprem'
            LEFT JOIN {Sql.Tables.KnownIssues} ki
                ON ki.is_active AND (ps.app = ANY(COALESCE(ki.affected_apps, ARRAY[]::TEXT[])) OR ps.service = ANY(COALESCE(ki.affected_services, ARRAY[]::TEXT[])))
            WHERE ((pc.status = 'active' AND pc.cycle_date >= CURRENT_DATE)
                OR (pc.status = 'completed' AND pc.cycle_date >= CURRENT_DATE - INTERVAL '7 days'))
              AND (ps.server_name ILIKE @Search ESCAPE @Esc
                OR ps.service ILIKE @Search ESCAPE @Esc
                OR ps.app ILIKE @Search ESCAPE @Esc
                OR ps.patch_group ILIKE @Search ESCAPE @Esc)
            ORDER BY pc.cycle_date, ps.server_name
            LIMIT @Limit";

        var searchTerm = $"%{EscapeLike(query)}%";
        var rows = await Db.QueryAsync<GlobalSearchRow>(sql, new { Search = searchTerm, Limit = limit, Esc = "\\" });

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
                    BusinessUnit = r.BusinessUnit,
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
        string? BusinessUnit, bool HasKnownIssue, int IssueCount);

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

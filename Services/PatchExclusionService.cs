using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class PatchExclusionService : BaseService<PatchExclusionService>, IPatchExclusionService
{
    public PatchExclusionService(IDbConnection db, ILogger<PatchExclusionService> logger)
        : base(db, logger) { }

    // State vocabulary matches the frontend dropdown values:
    // 'overdue' = held_until < CURRENT_DATE
    // 'expiring-soon' = held_until between CURRENT_DATE and CURRENT_DATE + 7 days
    // 'active' = everything else among active rows
    private static string StateClauseFor(string? state)
    {
        if (string.IsNullOrWhiteSpace(state)) return "";
        return state.Trim().ToLowerInvariant() switch
        {
            "overdue"       => " AND pe.held_until < CURRENT_DATE",
            "expiring-soon" => " AND pe.held_until >= CURRENT_DATE AND pe.held_until < CURRENT_DATE + INTERVAL '7 days'",
            "active"        => " AND pe.held_until >= CURRENT_DATE + INTERVAL '7 days'",
            _ => "",
        };
    }

    // Builds the active-exclusions filter extras with optional BU + state.
    // exclude lets a cross-facet breakdown query skip its own dimension.
    private static (string extras, DynamicParameters args) BuildExclusionFilterClause(
        string? businessUnit, string? state, string? exclude = null)
    {
        var sql = "";
        var args = new DynamicParameters();
        if (!string.IsNullOrWhiteSpace(businessUnit) && exclude != "businessUnit")
        {
            sql += " AND s.business_unit = @BusinessUnit";
            args.Add("BusinessUnit", businessUnit);
        }
        if (exclude != "state")
        {
            sql += StateClauseFor(state);
        }
        return (sql, args);
    }

    public Task<PatchExclusionSummary> GetExclusionSummaryAsync(string? businessUnit = null, string? state = null) => RunDbAsync(async () =>
    {
        // Cross-facet rule: top-level scoped by both filters; States[] scoped
        // by BU only; BusinessUnits[] scoped by state only.
        var (topExtra, topArgs) = BuildExclusionFilterClause(businessUnit, state);
        var (stExtra,  stArgs)  = BuildExclusionFilterClause(businessUnit, state, exclude: "state");
        var (buExtra,  buArgs)  = BuildExclusionFilterClause(businessUnit, state, exclude: "businessUnit");

        var top = await Db.QuerySingleAsync<PatchExclusionSummary>($@"
            SELECT
                COUNT(*)::INT AS TotalExcluded,
                COUNT(*) FILTER (WHERE pe.held_until <= CURRENT_DATE)::INT AS HoldExpiredCount
            FROM patching.patch_exclusions pe
            LEFT JOIN shared.servers s ON pe.server_id = s.server_id
            WHERE pe.is_active
            {topExtra}", topArgs);

        // States[] - single-row counts, then unpivot.
        var stRow = await Db.QueryFirstAsync($@"
            SELECT
                COUNT(*) FILTER (WHERE pe.held_until < CURRENT_DATE)::INT AS OverdueCount,
                COUNT(*) FILTER (WHERE pe.held_until >= CURRENT_DATE
                                  AND pe.held_until < CURRENT_DATE + INTERVAL '7 days')::INT AS ExpiringCount,
                COUNT(*) FILTER (WHERE pe.held_until >= CURRENT_DATE + INTERVAL '7 days')::INT AS ActiveCount
            FROM patching.patch_exclusions pe
            LEFT JOIN shared.servers s ON pe.server_id = s.server_id
            WHERE pe.is_active
            {stExtra}", stArgs);
        top.States = new List<ExclusionStateCount>
        {
            new() { State = "overdue",       TotalCount = (int)stRow.overduecount },
            new() { State = "expiring-soon", TotalCount = (int)stRow.expiringcount },
            new() { State = "active",        TotalCount = (int)stRow.activecount },
        };

        // BusinessUnits[] - GROUP BY business_unit under state-scoped (BU-excluded).
        var buRows = await Db.QueryAsync<ExclusionBuCount>($@"
            SELECT
                COALESCE(s.business_unit, 'Unknown') AS BusinessUnit,
                COUNT(*)::INT AS TotalCount
            FROM patching.patch_exclusions pe
            LEFT JOIN shared.servers s ON pe.server_id = s.server_id
            WHERE pe.is_active
            {buExtra}
            GROUP BY s.business_unit
            ORDER BY COUNT(*) DESC", buArgs);
        top.BusinessUnits = buRows.ToList();

        return top;
    });

    public Task<PagedResult<PatchExclusion>> ListExclusionsAsync(string? search, int limit, int offset, string? businessUnit = null, string? state = null) =>
        RunDbAsync(async () =>
    {
        var where = "WHERE pe.is_active";
        var p = new DynamicParameters();

        if (!string.IsNullOrEmpty(search))
        {
            where += " AND (pe.server_name ILIKE @Search ESCAPE '\\' OR pe.reason ILIKE @Search ESCAPE '\\')";
            p.Add("Search", $"%{EscapeLike(search)}%");
        }

        if (!string.IsNullOrWhiteSpace(businessUnit))
        {
            where += " AND s.business_unit = @BusinessUnit";
            p.Add("BusinessUnit", businessUnit);
        }

        // State filter uses the same vocabulary as StateClauseFor but with the
        // pe-aliased columns from the existing data SQL - append directly.
        where += StateClauseFor(state);

        var countSql = $@"
            SELECT COUNT(*)::INT
            FROM patching.patch_exclusions pe
            LEFT JOIN shared.servers s ON pe.server_id = s.server_id
            {where}";

        var dataSql = $@"
            SELECT
                pe.exclusion_id AS ExclusionId,
                pe.server_id AS ServerId,
                pe.server_name AS ServerName,
                ps.patch_group AS PatchGroup,
                ps.service AS Service,
                ps.app AS Application,
                s.environment AS Environment,
                s.business_unit AS BusinessUnit,
                pe.reason AS Reason,
                pe.reason_slug AS ReasonSlug,
                pe.notes AS Notes,
                pe.ticket AS Ticket,
                pe.held_until AS HeldUntil,
                pe.excluded_by AS ExcludedBy,
                pe.excluded_at AS ExcludedAt,
                (pe.held_until <= CURRENT_DATE) AS HoldExpired,
                CASE
                    WHEN pe.held_until < CURRENT_DATE THEN 'overdue'
                    WHEN pe.held_until < CURRENT_DATE + INTERVAL '7 days' THEN 'expiring'
                    ELSE 'active'
                END AS Status
            FROM patching.patch_exclusions pe
            LEFT JOIN shared.servers s ON pe.server_id = s.server_id
            LEFT JOIN LATERAL (
                SELECT ps2.patch_group, ps2.service, ps2.app
                FROM {Sql.Tables.PatchSchedule} ps2
                WHERE ps2.server_id = pe.server_id
                ORDER BY ps2.cycle_id DESC
                LIMIT 1
            ) ps ON TRUE
            {where}
            ORDER BY pe.held_until, pe.server_name
            LIMIT @Limit OFFSET @Offset";

        p.Add("Limit", limit);
        p.Add("Offset", offset);

        using var multi = await Db.QueryMultipleAsync($"{countSql};{dataSql}", p);
        var totalCount = await multi.ReadSingleAsync<int>();
        var items = await multi.ReadAsync<PatchExclusion>();

        return new PagedResult<PatchExclusion>
        {
            Items = items,
            TotalCount = totalCount,
            Limit = limit,
            Offset = offset
        };
    });

    public Task<PagedResult<PatchServerItem>> SearchPatchServersAsync(string? search, int limit, int offset) =>
        RunDbAsync(async () =>
    {
        var where = @"WHERE ps.server_id IS NOT NULL
              AND ((pc.status = 'active' AND pc.cycle_date >= CURRENT_DATE)
                OR (pc.status = 'completed' AND pc.cycle_date >= CURRENT_DATE - INTERVAL '7 days'))";
        var p = new DynamicParameters();

        if (!string.IsNullOrEmpty(search))
        {
            where += @" AND (ps.server_name ILIKE @Search ESCAPE '\'
                OR ps.service ILIKE @Search ESCAPE '\'
                OR ps.app ILIKE @Search ESCAPE '\'
                OR ps.patch_group ILIKE @Search ESCAPE '\')";
            p.Add("Search", $"%{EscapeLike(search)}%");
        }

        var countSql = $@"
            SELECT COUNT(DISTINCT ps.server_name)::INT
            FROM {Sql.Tables.PatchSchedule} ps
            JOIN {Sql.Tables.PatchCycles} pc ON pc.cycle_id = ps.cycle_id
            {where}";

        var dataSql = $@"
            SELECT DISTINCT ON (ps.server_name)
                ps.server_id AS ServerId,
                ps.server_name AS ServerName,
                ps.patch_group AS PatchGroup,
                ps.service AS Service,
                ps.app AS Application,
                s.environment AS Environment,
                s.business_unit AS BusinessUnit
            FROM {Sql.Tables.PatchSchedule} ps
            JOIN {Sql.Tables.PatchCycles} pc ON pc.cycle_id = ps.cycle_id
            LEFT JOIN {Sql.Tables.Servers} s ON ps.server_id = s.server_id
            {where}
            ORDER BY ps.server_name
            LIMIT @Limit OFFSET @Offset";

        p.Add("Limit", limit);
        p.Add("Offset", offset);

        using var multi = await Db.QueryMultipleAsync($"{countSql};{dataSql}", p);
        var totalCount = await multi.ReadSingleAsync<int>();
        var items = await multi.ReadAsync<PatchServerItem>();

        return new PagedResult<PatchServerItem>
        {
            Items = items,
            TotalCount = totalCount,
            Limit = limit,
            Offset = offset
        };
    });

    public Task<int> ExcludeServersAsync(List<int> serverIds, string reason, DateOnly heldUntil, string excludedBy,
        string? ticket = null, string? reasonSlug = null, string? notes = null) =>
        RunDbAsync(async () =>
    {
        const string sql = @"
            INSERT INTO patching.patch_exclusions
                (server_id, server_name, reason, reason_slug, notes, ticket, held_until, excluded_by)
            SELECT
                s.server_id,
                s.server_name,
                @Reason,
                @ReasonSlug,
                @Notes,
                @Ticket,
                @HeldUntil,
                @ExcludedBy
            FROM shared.servers s
            WHERE s.server_id = ANY(@ServerIds)
              AND s.is_active
            ON CONFLICT (server_id) WHERE is_active
            DO UPDATE SET
                reason = EXCLUDED.reason,
                reason_slug = EXCLUDED.reason_slug,
                notes = EXCLUDED.notes,
                ticket = EXCLUDED.ticket,
                held_until = EXCLUDED.held_until,
                excluded_by = EXCLUDED.excluded_by,
                excluded_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP";

        var p = new DynamicParameters();
        p.Add("ServerIds", serverIds.ToArray());
        p.Add("Reason", reason);
        p.Add("ReasonSlug", reasonSlug);
        p.Add("Notes", notes);
        p.Add("Ticket", ticket);
        p.Add("HeldUntil", heldUntil);
        p.Add("ExcludedBy", excludedBy);

        return await Db.ExecuteAsync(sql, p);
    });

    // Bulk exclude: select servers by patch_group or environment, then insert one exclusion per row.
    // Single round-trip, no individual server-id list. 'kind' is validated at call time.
    public Task<int> BulkExcludeAsync(string kind, string target, string reason, DateOnly heldUntil, string excludedBy,
        string? ticket = null, string? reasonSlug = null, string? notes = null) =>
        RunDbAsync(async () =>
    {
        if (kind != "group" && kind != "env")
            throw new ArgumentException("kind must be 'group' or 'env'", nameof(kind));

        var filter = kind == "group" ? "s.patch_group = @Target" : "s.environment = @Target";
        var sql = $@"
            INSERT INTO patching.patch_exclusions
                (server_id, server_name, reason, reason_slug, notes, ticket, held_until, excluded_by)
            SELECT
                s.server_id,
                s.server_name,
                @Reason,
                @ReasonSlug,
                @Notes,
                @Ticket,
                @HeldUntil,
                @ExcludedBy
            FROM shared.servers s
            WHERE {filter}
              AND s.is_active
            ON CONFLICT (server_id) WHERE is_active
            DO UPDATE SET
                reason = EXCLUDED.reason,
                reason_slug = EXCLUDED.reason_slug,
                notes = EXCLUDED.notes,
                ticket = EXCLUDED.ticket,
                held_until = EXCLUDED.held_until,
                excluded_by = EXCLUDED.excluded_by,
                excluded_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP";

        var p = new DynamicParameters();
        p.Add("Target", target);
        p.Add("Reason", reason);
        p.Add("ReasonSlug", reasonSlug);
        p.Add("Notes", notes);
        p.Add("Ticket", ticket);
        p.Add("HeldUntil", heldUntil);
        p.Add("ExcludedBy", excludedBy);

        return await Db.ExecuteAsync(sql, p);
    });

    public Task<bool> ExtendExclusionAsync(int exclusionId, DateOnly newHeldUntil, string extendedBy) =>
        RunDbAsync(async () =>
    {
        const string sql = @"
            UPDATE patching.patch_exclusions
            SET held_until = @NewHeldUntil,
                excluded_by = @ExtendedBy,
                updated_at = CURRENT_TIMESTAMP
            WHERE exclusion_id = @ExclusionId
              AND is_active";

        var p = new DynamicParameters();
        p.Add("ExclusionId", exclusionId);
        p.Add("NewHeldUntil", newHeldUntil);
        p.Add("ExtendedBy", extendedBy);

        return await Db.ExecuteAsync(sql, p) > 0;
    });

    // Generalised PATCH: updates any non-null subset of held_until / notes.
    public Task<bool> UpdateExclusionAsync(int exclusionId, DateOnly? newHeldUntil, string? notes, string actingUser) =>
        RunDbAsync(async () =>
    {
        if (newHeldUntil == null && notes == null) return false;

        var sets = new List<string>();
        var p = new DynamicParameters();
        p.Add("ExclusionId", exclusionId);
        p.Add("ActingUser", actingUser);
        if (newHeldUntil != null) { sets.Add("held_until = @HeldUntil"); p.Add("HeldUntil", newHeldUntil.Value); }
        if (notes != null)        { sets.Add("notes = @Notes");           p.Add("Notes", notes); }
        sets.Add("excluded_by = @ActingUser");
        sets.Add("updated_at = CURRENT_TIMESTAMP");

        var sql = $@"
            UPDATE patching.patch_exclusions
            SET {string.Join(", ", sets)}
            WHERE exclusion_id = @ExclusionId
              AND is_active";

        return await Db.ExecuteAsync(sql, p) > 0;
    });

    public Task<bool> RemoveExclusionAsync(int exclusionId, string removedBy) =>
        RunDbAsync(async () =>
    {
        const string sql = @"
            UPDATE patching.patch_exclusions
            SET is_active = FALSE,
                removed_by = @RemovedBy,
                removed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE exclusion_id = @ExclusionId
              AND is_active";

        var p = new DynamicParameters();
        p.Add("ExclusionId", exclusionId);
        p.Add("RemovedBy", removedBy);

        return await Db.ExecuteAsync(sql, p) > 0;
    });
}

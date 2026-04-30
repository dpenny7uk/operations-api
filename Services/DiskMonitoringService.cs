using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class DiskMonitoringService : BaseService<DiskMonitoringService>, IDiskMonitoringService
{
    // History window for the days-until-critical projection. 30 days balances
    // "enough points to fit a meaningful slope" against "recent enough that a
    // disk's growth pattern is still representative".
    private const int ProjectionWindowDays = 30;

    public DiskMonitoringService(IDbConnection db, ILogger<DiskMonitoringService> logger)
        : base(db, logger) { }

    public Task<DiskSummary> GetSummaryAsync(string? environment = null, string? businessUnit = null) => RunDbAsync(async () =>
    {
        // Three queries: top-level totals scoped by the optional filters, and two
        // unscoped breakdowns (per env + per BU) that drive the dropdown labels.
        // Keeping the breakdowns unscoped means the dropdowns always show every
        // option's independent count, so users can switch between filters without
        // labels jumping around.
        var (whereClause, scopedArgs) = BuildDiskFilterClause(environment, businessUnit);

        var top = await Db.QueryFirstAsync<DiskSummary>($@"
            SELECT
                COUNT(*)::int                                       AS TotalCount,
                (COUNT(*) FILTER (WHERE alert_status = 1))::int     AS OkCount,
                (COUNT(*) FILTER (WHERE alert_status = 2))::int     AS WarningCount,
                (COUNT(*) FILTER (WHERE alert_status = 3))::int     AS CriticalCount
            FROM {Sql.Tables.DiskCurrent}
            {whereClause}
        ", scopedArgs);

        var envs = (await Db.QueryAsync<DiskEnvCount>($@"
            SELECT
                COALESCE(environment, '') AS Environment,
                COUNT(*)::int                                       AS TotalCount,
                (COUNT(*) FILTER (WHERE alert_status = 1))::int     AS OkCount,
                (COUNT(*) FILTER (WHERE alert_status = 2))::int     AS WarningCount,
                (COUNT(*) FILTER (WHERE alert_status = 3))::int     AS CriticalCount
            FROM {Sql.Tables.DiskCurrent}
            GROUP BY environment
            ORDER BY environment
        ")).ToList();

        var bus = (await Db.QueryAsync<DiskBuCount>($@"
            SELECT
                COALESCE(business_unit, '') AS BusinessUnit,
                COUNT(*)::int                                       AS TotalCount,
                (COUNT(*) FILTER (WHERE alert_status = 1))::int     AS OkCount,
                (COUNT(*) FILTER (WHERE alert_status = 2))::int     AS WarningCount,
                (COUNT(*) FILTER (WHERE alert_status = 3))::int     AS CriticalCount
            FROM {Sql.Tables.DiskCurrent}
            GROUP BY business_unit
            ORDER BY business_unit
        ")).ToList();

        top.Environments = envs;
        top.BusinessUnits = bus;
        return top;
    });

    public Task<PagedResult<Disk>> ListDisksAsync(int limit, int offset, string? environment = null, string? businessUnit = null) => RunDbAsync(async () =>
    {
        // Filter clauses compose with AND. Casing matches the canonical values
        // written by the sync (_canonicalize_env / _canonicalize_bu in
        // sync_solarwinds_disks.py); equality match avoids any per-query LOWER().
        var (whereClause, scopedArgs) = BuildDiskFilterClause(environment, businessUnit);
        scopedArgs.Add("Limit", limit);
        scopedArgs.Add("Offset", offset);

        var totalCount = await Db.QueryFirstAsync<int>(
            $"SELECT COUNT(*) FROM {Sql.Tables.DiskCurrent} {whereClause}", scopedArgs);

        var disks = (await Db.QueryAsync<Disk>($@"
            SELECT
                server_name        AS ServerName,
                disk_label         AS DiskLabel,
                service            AS Service,
                environment        AS Environment,
                technical_owner    AS TechnicalOwner,
                business_owner     AS BusinessOwner,
                business_unit      AS BusinessUnit,
                tier               AS Tier,
                volume_size_gb     AS VolumeSizeGb,
                used_gb            AS UsedGb,
                free_gb            AS FreeGb,
                percent_used       AS PercentUsed,
                alert_status       AS AlertStatus,
                threshold_warn_pct AS ThresholdWarnPct,
                threshold_crit_pct AS ThresholdCritPct,
                captured_at        AS CapturedAt
            FROM {Sql.Tables.DiskCurrent}
            {whereClause}
            ORDER BY alert_status DESC, percent_used DESC, server_name, disk_label
            LIMIT @Limit OFFSET @Offset
        ", scopedArgs)).ToList();

        // Batch-fetch the projection-window history for the disks on this page,
        // then compute slopes in C# to avoid an N+1 round-trip.
        if (disks.Count > 0)
        {
            var keys = disks.Select(d => new { d.ServerName, d.DiskLabel }).ToList();
            var serverNames = keys.Select(k => k.ServerName).Distinct().ToArray();
            var diskLabels = keys.Select(k => k.DiskLabel).Distinct().ToArray();

            var historyRows = await Db.QueryAsync<(string ServerName, string DiskLabel, DateTime CapturedAt, decimal UsedGb)>($@"
                SELECT server_name AS ServerName, disk_label AS DiskLabel,
                       captured_at AS CapturedAt, used_gb AS UsedGb
                FROM {Sql.Tables.DiskSnapshots}
                WHERE captured_at >= NOW() - (@Days || ' days')::INTERVAL
                  AND server_name = ANY(@ServerNames)
                  AND disk_label = ANY(@DiskLabels)
                ORDER BY server_name, disk_label, captured_at
            ", new { Days = ProjectionWindowDays, ServerNames = serverNames, DiskLabels = diskLabels });

            var historyByDisk = historyRows
                .GroupBy(r => (r.ServerName, r.DiskLabel))
                .ToDictionary(g => g.Key, g => g.ToList());

            foreach (var disk in disks)
            {
                if (!historyByDisk.TryGetValue((disk.ServerName, disk.DiskLabel), out var history) || history.Count < 2)
                {
                    disk.DaysUntilCritical = null;
                    continue;
                }
                disk.DaysUntilCritical = ProjectDaysUntilCritical(disk, history);
            }
        }

        return new PagedResult<Disk>
        {
            Items = disks,
            TotalCount = totalCount,
            Limit = limit,
            Offset = offset
        };
    });

    public Task<IEnumerable<DiskHistoryPoint>> GetHistoryAsync(string serverName, string diskLabel, int days) =>
        RunDbAsync(() => Db.QueryAsync<DiskHistoryPoint>($@"
            SELECT captured_at AS CapturedAt,
                   used_gb     AS UsedGb,
                   percent_used AS PercentUsed
            FROM {Sql.Tables.DiskSnapshots}
            WHERE server_name = @ServerName
              AND disk_label = @DiskLabel
              AND captured_at >= NOW() - (@Days || ' days')::INTERVAL
            ORDER BY captured_at
        ", new { ServerName = serverName, DiskLabel = diskLabel, Days = days })
    );

    // Build a parameterised WHERE clause from optional environment + businessUnit
    // filters. Returns the clause text (empty string if no filters) and a
    // DynamicParameters bag prepopulated with whichever values were set.
    private static (string clause, DynamicParameters args) BuildDiskFilterClause(
        string? environment, string? businessUnit)
    {
        var clauses = new List<string>();
        var args = new DynamicParameters();
        if (!string.IsNullOrWhiteSpace(environment))
        {
            clauses.Add("environment = @Environment");
            args.Add("Environment", environment);
        }
        if (!string.IsNullOrWhiteSpace(businessUnit))
        {
            clauses.Add("business_unit = @BusinessUnit");
            args.Add("BusinessUnit", businessUnit);
        }
        var clauseText = clauses.Count == 0 ? "" : "WHERE " + string.Join(" AND ", clauses);
        return (clauseText, args);
    }

    // Cap the projection at one year. Beyond that the linear-regression model
    // is unreliable (capacity decisions over a year out are made from utilisation
    // trends, not point projections), and producing values like "4 billion days"
    // for near-zero slopes is operationally noise.
    private const double ProjectionCapDays = 365;

    // Simple linear-regression projection. Computes growth rate (GB/day) over
    // the supplied history and projects how many days remain before used_gb
    // reaches the critical threshold. Returns null when slope <= 0 (stable or
    // shrinking) or when the projection exceeds ProjectionCapDays.
    private static double? ProjectDaysUntilCritical(
        Disk disk,
        List<(string ServerName, string DiskLabel, DateTime CapturedAt, decimal UsedGb)> history)
    {
        var x0 = history[0].CapturedAt;
        double sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        var n = history.Count;
        foreach (var p in history)
        {
            var x = (p.CapturedAt - x0).TotalDays;
            var y = (double)p.UsedGb;
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumX2 += x * x;
        }

        var denom = n * sumX2 - sumX * sumX;
        if (denom <= 0) return null;
        var slope = (n * sumXY - sumX * sumY) / denom;
        if (slope <= 0) return null;

        var critGb = (double)(disk.VolumeSizeGb * disk.ThresholdCritPct / 100m);
        var remainingGb = critGb - (double)disk.UsedGb;
        if (remainingGb <= 0) return 0;

        var days = remainingGb / slope;
        return days > ProjectionCapDays ? null : days;
    }
}

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

    public Task<DiskSummary> GetSummaryAsync() => RunDbAsync(async () =>
    {
        // Per-environment breakdown drives both the dropdown labels
        // ("Production (466)") and the KPI strip's env-aware counts. The
        // overall totals are summed in app code rather than a second query.
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

        return new DiskSummary
        {
            TotalCount = envs.Sum(e => e.TotalCount),
            OkCount = envs.Sum(e => e.OkCount),
            WarningCount = envs.Sum(e => e.WarningCount),
            CriticalCount = envs.Sum(e => e.CriticalCount),
            Environments = envs,
        };
    });

    public Task<PagedResult<Disk>> ListDisksAsync(int limit, int offset, string? environment = null) => RunDbAsync(async () =>
    {
        // Optional environment filter — applied via parameterised SQL. Empty/null
        // means no filter (caller wants all envs). Casing matches the canonical
        // values written by the sync (`_canonicalize_env` in sync_solarwinds_disks.py).
        var hasEnv = !string.IsNullOrWhiteSpace(environment);
        var envClause = hasEnv ? "WHERE environment = @Environment" : "";
        var args = new DynamicParameters();
        args.Add("Limit", limit);
        args.Add("Offset", offset);
        if (hasEnv) args.Add("Environment", environment);

        var totalCount = await Db.QueryFirstAsync<int>(
            $"SELECT COUNT(*) FROM {Sql.Tables.DiskCurrent} {envClause}", args);

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
            {envClause}
            ORDER BY alert_status DESC, percent_used DESC, server_name, disk_label
            LIMIT @Limit OFFSET @Offset
        ", args)).ToList();

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

    // Simple linear-regression projection. Computes growth rate (GB/day) over
    // the supplied history and projects how many days remain before used_gb
    // reaches the critical threshold. Returns null when slope <= 0 (the disk
    // is stable or shrinking — projecting infinity isn't useful).
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

        return remainingGb / slope;
    }
}

using Microsoft.Extensions.Logging.Abstractions;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Integration;

[Collection("Database")]
public class DiskMonitoringServiceTests : IntegrationTestBase
{
    public DiskMonitoringServiceTests(DatabaseFixture db) : base(db) { }

    private DiskMonitoringService CreateService()
        => new(OpenConnection(), NullLogger<DiskMonitoringService>.Instance);

    // ── GetSummaryAsync ─────────────────────────────────────────────────

    [DockerFact]
    public async Task Summary_counts_by_alert_status_using_disk_current_view()
    {
        var svc = CreateService();
        var summary = await svc.GetSummaryAsync();

        // Seed: WEB01 ok, WEB02 warn, API01 crit, DEV01 ok = 4 disks across 3 statuses.
        // Older WEB01 history snapshots are excluded by disk_current (latest-per-disk).
        Assert.Equal(4, summary.TotalCount);
        Assert.Equal(2, summary.OkCount);
        Assert.Equal(1, summary.WarningCount);
        Assert.Equal(1, summary.CriticalCount);
    }

    // ── ListDisksAsync ──────────────────────────────────────────────────

    [DockerFact]
    public async Task List_returns_paged_result_ordered_crit_first()
    {
        var svc = CreateService();
        var page = await svc.ListDisksAsync(limit: 100, offset: 0);

        Assert.Equal(4, page.TotalCount);
        var items = page.Items.ToList();
        Assert.Equal(4, items.Count);

        // ORDER BY alert_status DESC, percent_used DESC — crit (API01) first.
        Assert.Equal("API01", items[0].ServerName);
        Assert.Equal((short)3, items[0].AlertStatus);
        Assert.Equal("WEB02", items[1].ServerName);
        Assert.Equal((short)2, items[1].AlertStatus);
    }

    [DockerFact]
    public async Task List_respects_offset_and_limit()
    {
        var svc = CreateService();
        var page = await svc.ListDisksAsync(limit: 2, offset: 1);

        Assert.Equal(4, page.TotalCount);
        Assert.Equal(2, page.Items.Count());
    }

    [DockerFact]
    public async Task List_computes_days_until_critical_for_growing_disk()
    {
        var svc = CreateService();
        var page = await svc.ListDisksAsync(limit: 100, offset: 0);

        // WEB01 has 4 history rows showing ~1 GB / 5 days = positive slope.
        // Current used 250 GB, crit at 90% of 500 = 450 GB → ~200 GB remaining
        // → projection should be a positive finite number.
        var web01 = page.Items.Single(d => d.ServerName == "WEB01");
        Assert.NotNull(web01.DaysUntilCritical);
        Assert.True(web01.DaysUntilCritical > 0);
    }

    [DockerFact]
    public async Task List_returns_null_days_until_critical_when_no_history()
    {
        var svc = CreateService();
        var page = await svc.ListDisksAsync(limit: 100, offset: 0);

        // DEV01 only has the single current snapshot — slope can't be fitted.
        var dev01 = page.Items.Single(d => d.ServerName == "DEV01");
        Assert.Null(dev01.DaysUntilCritical);
    }

    // ── GetHistoryAsync ─────────────────────────────────────────────────

    [DockerFact]
    public async Task History_returns_snapshots_in_chronological_order()
    {
        var svc = CreateService();
        var history = (await svc.GetHistoryAsync("WEB01", "C:\\", days: 30)).ToList();

        // 4 history rows + 1 current = 5 snapshots within last 30 days.
        Assert.Equal(5, history.Count);
        for (int i = 1; i < history.Count; i++)
            Assert.True(history[i - 1].CapturedAt <= history[i].CapturedAt);
    }

    [DockerFact]
    public async Task History_filters_by_server_and_disk()
    {
        var svc = CreateService();
        var history = (await svc.GetHistoryAsync("API01", "D:\\", days: 30)).ToList();

        Assert.Single(history);
        Assert.Equal(95.00m, history[0].PercentUsed);
    }

    [DockerFact]
    public async Task History_excludes_snapshots_outside_window()
    {
        var svc = CreateService();
        var history = (await svc.GetHistoryAsync("WEB01", "C:\\", days: 1)).ToList();

        // Only the current (5 minutes ago) snapshot fits a 1-day window.
        Assert.Single(history);
    }
}

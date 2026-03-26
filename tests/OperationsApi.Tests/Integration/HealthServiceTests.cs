using Microsoft.Extensions.Logging.Abstractions;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Integration;

[Collection("Database")]
public class HealthServiceTests : IntegrationTestBase
{
    public HealthServiceTests(DatabaseFixture db) : base(db) { }

    private HealthService CreateService()
        => new(OpenConnection(), NullLogger<HealthService>.Instance);

    // ── GetHealthSummaryAsync ────────────────────────────────────────

    [DockerFact]
    public async Task Summary_reflects_overall_status()
    {
        var svc = CreateService();
        var summary = await svc.GetHealthSummaryAsync();

        // certificate_scan has consecutive_failures=3 and is stale (30h old)
        Assert.NotEqual("healthy", summary.OverallStatus);
    }

    [DockerFact]
    public async Task Summary_counts_unmatched_servers()
    {
        var svc = CreateService();
        var summary = await svc.GetHealthSummaryAsync();

        // 2 pending unmatched (WEBSVR01, UNKNOWN99); RESOLVED01 excluded
        Assert.Equal(2, summary.UnmatchedServersCount);
    }

    [DockerFact]
    public async Task Summary_counts_unreachable_servers()
    {
        var svc = CreateService();
        var summary = await svc.GetHealthSummaryAsync();

        // 2 unresolved scan failures (OFFLINE01, LOCKED02); FIXED03 excluded
        Assert.Equal(2, summary.UnreachableServersCount);
    }

    [DockerFact]
    public async Task Summary_includes_sync_statuses()
    {
        var svc = CreateService();
        var summary = await svc.GetHealthSummaryAsync();

        Assert.True(summary.SyncStatuses.Count > 0);
        Assert.Contains(summary.SyncStatuses, s => s.SyncName == "databricks_servers");
        Assert.Contains(summary.SyncStatuses, s => s.SyncName == "certificate_scan");
    }

    // ── GetSyncStatusesAsync ─────────────────────────────────────────

    [DockerFact]
    public async Task SyncStatuses_healthy_sync_correct()
    {
        var svc = CreateService();
        var statuses = (await svc.GetSyncStatusesAsync()).ToList();

        var dbSync = statuses.First(s => s.SyncName == "databricks_servers");
        Assert.Equal("healthy", dbSync.Status);
        Assert.Equal("healthy", dbSync.FreshnessStatus);
        Assert.NotNull(dbSync.HoursSinceSuccess);
        Assert.True(dbSync.HoursSinceSuccess < 24);
    }

    [DockerFact]
    public async Task SyncStatuses_stale_sync_flagged()
    {
        var svc = CreateService();
        var statuses = (await svc.GetSyncStatusesAsync()).ToList();

        var certSync = statuses.First(s => s.SyncName == "certificate_scan");
        Assert.Equal("stale", certSync.FreshnessStatus);
        Assert.True(certSync.ConsecutiveFailures > 0);
    }

    [DockerFact]
    public async Task SyncStatuses_error_message_sanitized()
    {
        var svc = CreateService();
        var statuses = (await svc.GetSyncStatusesAsync()).ToList();

        // The service redacts actual error messages
        var certSync = statuses.First(s => s.SyncName == "certificate_scan");
        if (certSync.LastErrorMessage != null)
            Assert.DoesNotContain("Connection timeout", certSync.LastErrorMessage);
    }

    // ── GetSyncHistoryAsync ──────────────────────────────────────────

    [DockerFact]
    public async Task SyncHistory_returns_entries_for_known_sync()
    {
        var svc = CreateService();
        var history = (await svc.GetSyncHistoryAsync("databricks_servers", 10)).ToList();

        Assert.Equal(2, history.Count);
        Assert.All(history, h => Assert.Equal("databricks_servers", h.SyncName));
    }

    [DockerFact]
    public async Task SyncHistory_ordered_by_most_recent()
    {
        var svc = CreateService();
        var history = (await svc.GetSyncHistoryAsync("databricks_servers", 10)).ToList();

        Assert.True(history[0].StartedAt > history[1].StartedAt);
    }

    [DockerFact]
    public async Task SyncHistory_empty_for_unknown_sync()
    {
        var svc = CreateService();
        var history = (await svc.GetSyncHistoryAsync("nonexistent_sync", 10)).ToList();

        Assert.Empty(history);
    }

    // ── RunValidationAsync ───────────────────────────────────────────

    [DockerFact]
    public async Task Validation_runs_seeded_rules()
    {
        var svc = CreateService();
        var results = (await svc.RunValidationAsync(null)).ToList();

        Assert.True(results.Count >= 3);
        Assert.Contains(results, r => r.RuleName == "servers_no_duplicates");
    }

    [DockerFact]
    public async Task Validation_no_duplicate_servers()
    {
        var svc = CreateService();
        var results = (await svc.RunValidationAsync("servers_no_duplicates")).ToList();

        var rule = results.First(r => r.RuleName == "servers_no_duplicates");
        Assert.Equal("pass", rule.Result);
        Assert.Equal(0, rule.ViolationCount);
    }
}

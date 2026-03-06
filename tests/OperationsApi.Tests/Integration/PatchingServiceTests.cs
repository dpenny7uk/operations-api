using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Integration;

[Collection("Database")]
public class PatchingServiceTests : IntegrationTestBase
{
    public PatchingServiceTests(DatabaseFixture db) : base(db) { }

    private PatchingService CreateService()
    {
        var conn = new NpgsqlConnection(Db.ConnectionString);
        conn.Open();
        return new PatchingService(conn, NullLogger<PatchingService>.Instance);
    }

    // ── GetNextPatchingSummaryAsync ───────────────────────────────────

    [Fact]
    public async Task NextSummary_returns_upcoming_active_cycle()
    {
        var svc = CreateService();
        var summary = await svc.GetNextPatchingSummaryAsync();

        Assert.NotNull(summary);
        Assert.Equal("active", summary.Cycle.Status);
        Assert.True(summary.Cycle.CycleDate >= DateOnly.FromDateTime(DateTime.Today));
        Assert.True(summary.DaysUntil > 0);
    }

    [Fact]
    public async Task NextSummary_includes_servers_by_group()
    {
        var svc = CreateService();
        var summary = await svc.GetNextPatchingSummaryAsync();

        Assert.NotNull(summary);
        Assert.True(summary.ServersByGroup.Count > 0);
        Assert.Contains("8a", summary.ServersByGroup.Keys);
    }

    [Fact]
    public async Task NextSummary_includes_issue_counts()
    {
        var svc = CreateService();
        var summary = await svc.GetNextPatchingSummaryAsync();

        Assert.NotNull(summary);
        // WEB01/WEB02 have app=Portal, service=IIS which matches the IIS known issue
        Assert.True(summary.TotalIssuesAffectingServers > 0);
    }

    // ── ListPatchCyclesAsync ─────────────────────────────────────────

    [Fact]
    public async Task ListCycles_upcoming_only()
    {
        var svc = CreateService();
        var results = (await svc.ListPatchCyclesAsync(upcomingOnly: true, limit: 10)).ToList();

        Assert.All(results, c =>
        {
            Assert.Equal("active", c.Status);
            Assert.True(c.CycleDate >= DateOnly.FromDateTime(DateTime.Today));
        });
    }

    [Fact]
    public async Task ListCycles_all_includes_completed()
    {
        var svc = CreateService();
        var results = (await svc.ListPatchCyclesAsync(upcomingOnly: false, limit: 10)).ToList();

        Assert.Contains(results, c => c.Status == "completed");
    }

    // ── GetCycleServersAsync ─────────────────────────────────────────

    [Fact]
    public async Task GetCycleServers_returns_paged_result()
    {
        var svc = CreateService();
        var result = await svc.GetCycleServersAsync(1, null, null, 100, 0);

        Assert.Equal(3, result.TotalCount);
        Assert.Equal(3, result.Items.Count());
    }

    [Fact]
    public async Task GetCycleServers_filter_by_patch_group()
    {
        var svc = CreateService();
        var result = await svc.GetCycleServersAsync(1, "8a", null, 100, 0);

        Assert.All(result.Items, s => Assert.Equal("8a", s.PatchGroup));
        Assert.Single(result.Items);
    }

    [Fact]
    public async Task GetCycleServers_filter_has_issues_true()
    {
        var svc = CreateService();
        var result = await svc.GetCycleServersAsync(1, null, true, 100, 0);

        Assert.All(result.Items, s => Assert.True(s.HasKnownIssue));
    }

    [Fact]
    public async Task GetCycleServers_filter_has_issues_false()
    {
        var svc = CreateService();
        var result = await svc.GetCycleServersAsync(1, null, false, 100, 0);

        Assert.All(result.Items, s => Assert.False(s.HasKnownIssue));
    }

    [Fact]
    public async Task GetCycleServers_pagination()
    {
        var svc = CreateService();
        var page1 = await svc.GetCycleServersAsync(1, null, null, 2, 0);
        var page2 = await svc.GetCycleServersAsync(1, null, null, 2, 2);

        Assert.Equal(3, page1.TotalCount);
        Assert.Equal(2, page1.Items.Count());
        Assert.Single(page2.Items);
    }

    // ── ListKnownIssuesAsync ─────────────────────────────────────────

    [Fact]
    public async Task ListIssues_active_only()
    {
        var svc = CreateService();
        var results = (await svc.ListKnownIssuesAsync(null, null, null, activeOnly: true)).ToList();

        Assert.DoesNotContain(results, i => i.Title.Contains("Resolved"));
        Assert.Equal(2, results.Count);
    }

    [Fact]
    public async Task ListIssues_filter_by_severity()
    {
        var svc = CreateService();
        var results = (await svc.ListKnownIssuesAsync("CRITICAL", null, null, activeOnly: true)).ToList();

        Assert.All(results, i => Assert.Equal("CRITICAL", i.Severity));
    }

    [Fact]
    public async Task ListIssues_filter_by_app_ilike()
    {
        var svc = CreateService();
        var results = (await svc.ListKnownIssuesAsync(null, "portal", null, activeOnly: true)).ToList();

        Assert.Single(results);
        Assert.Equal("Portal", results[0].Application);
    }

    [Fact]
    public async Task ListIssues_filter_by_patch_type_windows()
    {
        var svc = CreateService();
        var results = (await svc.ListKnownIssuesAsync(null, null, "windows", activeOnly: true)).ToList();

        Assert.All(results, i => Assert.True(i.AppliesToWindows));
    }

    [Fact]
    public async Task ListIssues_filter_by_patch_type_sql()
    {
        var svc = CreateService();
        var results = (await svc.ListKnownIssuesAsync(null, null, "sql", activeOnly: true)).ToList();

        Assert.All(results, i => Assert.True(i.AppliesToSql));
    }

    [Fact]
    public async Task ListIssues_ordered_by_severity()
    {
        var svc = CreateService();
        var results = (await svc.ListKnownIssuesAsync(null, null, null, activeOnly: true)).ToList();

        // CRITICAL should come before HIGH
        var critIndex = results.FindIndex(i => i.Severity == "CRITICAL");
        var highIndex = results.FindIndex(i => i.Severity == "HIGH");
        if (critIndex >= 0 && highIndex >= 0)
            Assert.True(critIndex < highIndex);
    }

    // ── GetKnownIssueByIdAsync ───────────────────────────────────────

    [Fact]
    public async Task GetIssueById_returns_full_detail()
    {
        var svc = CreateService();
        var issue = await svc.GetKnownIssueByIdAsync(1);

        Assert.NotNull(issue);
        Assert.Equal("IIS pool crash after reboot", issue.Title);
        Assert.Equal("Restart IIS app pools", issue.Fix);
        Assert.Equal("Server reboot", issue.TriggerDescription);
        Assert.True(issue.IsActive);
    }

    [Fact]
    public async Task GetIssueById_returns_null_for_missing()
    {
        var svc = CreateService();
        Assert.Null(await svc.GetKnownIssueByIdAsync(99999));
    }

    // ── GetPatchWindowsAsync ─────────────────────────────────────────

    [Fact]
    public async Task GetPatchWindows_returns_seeded_windows()
    {
        var svc = CreateService();
        var results = (await svc.GetPatchWindowsAsync()).ToList();

        Assert.True(results.Count >= 12); // 6 onprem + 6 azure from migration seed
        Assert.Contains(results, w => w.PatchGroup == "8a" && w.WindowType == "onprem");
    }
}

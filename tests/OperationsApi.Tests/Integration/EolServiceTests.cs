using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Integration;

[Collection("Database")]
public class EolServiceTests : IntegrationTestBase
{
    public EolServiceTests(DatabaseFixture db) : base(db) { }

    private EolService CreateService()
    {
        var conn = new NpgsqlConnection(Db.ConnectionString);
        conn.Open();
        return new EolService(conn, NullLogger<EolService>.Instance);
    }

    // ── GetSummaryAsync ──────────────────────────────────────────────

    [Fact]
    public async Task Summary_counts_by_lifecycle_status()
    {
        var svc = CreateService();
        var summary = await svc.GetSummaryAsync();

        Assert.True(summary.EolCount >= 2);         // Win2019 x2
        Assert.True(summary.ApproachingCount >= 1);  // SQL2019 (2 months out)
        Assert.True(summary.SupportedCount >= 2);    // Win2022 x2
        Assert.True(summary.TotalCount >= 5);
        Assert.True(summary.AffectedServers >= 1);
    }

    // ── ListEolSoftwareAsync ─────────────────────────────────────────

    [Fact]
    public async Task List_returns_only_active_grouped()
    {
        var svc = CreateService();
        var results = (await svc.ListEolSoftwareAsync(null, null, 100)).ToList();

        // Should NOT contain Legacy App 1.0 (inactive)
        Assert.DoesNotContain(results, e => e.Product == "Legacy App");
    }

    [Fact]
    public async Task List_filter_by_product_ilike()
    {
        var svc = CreateService();
        var results = (await svc.ListEolSoftwareAsync(null, "windows", 100)).ToList();

        Assert.All(results, e => Assert.Contains("Windows", e.Product, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task List_filter_eol_alert_level()
    {
        var svc = CreateService();
        var results = (await svc.ListEolSoftwareAsync("eol", null, 100)).ToList();

        Assert.All(results, e => Assert.Equal("eol", e.AlertLevel));
        Assert.Contains(results, e => e.Product == "Windows Server" && e.Version == "2019");
    }

    [Fact]
    public async Task List_filter_approaching_alert_level()
    {
        var svc = CreateService();
        var results = (await svc.ListEolSoftwareAsync("approaching", null, 100)).ToList();

        Assert.All(results, e => Assert.Equal("approaching", e.AlertLevel));
    }

    [Fact]
    public async Task List_groups_by_product_version()
    {
        var svc = CreateService();
        var results = (await svc.ListEolSoftwareAsync(null, "Windows Server", 100)).ToList();

        // Win2019 has 2 assets, should show AffectedAssets=2 in one group
        var win2019 = results.FirstOrDefault(e => e.Version == "2019");
        Assert.NotNull(win2019);
        Assert.Equal(2, win2019.AffectedAssets);
    }

    // ── GetByProductVersionAsync ─────────────────────────────────────

    [Fact]
    public async Task GetByProductVersion_returns_detail_with_assets()
    {
        var svc = CreateService();
        var detail = await svc.GetByProductVersionAsync("Windows Server", "2019");

        Assert.NotNull(detail);
        Assert.Equal("Windows Server", detail.Product);
        Assert.Equal(2, detail.AffectedAssets);
        Assert.Contains("OLD01", detail.Assets);
        Assert.Contains("DEV01", detail.Assets);
    }

    [Fact]
    public async Task GetByProductVersion_returns_null_for_missing()
    {
        var svc = CreateService();
        Assert.Null(await svc.GetByProductVersionAsync("Nonexistent", "99.0"));
    }

    // ── GetByServerAsync ─────────────────────────────────────────────

    [Fact]
    public async Task GetByServer_returns_software_for_asset()
    {
        var svc = CreateService();
        var results = (await svc.GetByServerAsync("API01")).ToList();

        Assert.Single(results);
        Assert.Equal("SQL Server", results[0].Product);
    }

    [Fact]
    public async Task GetByServer_case_insensitive()
    {
        var svc = CreateService();
        var results = (await svc.GetByServerAsync("old01")).ToList();

        Assert.Single(results); // Only active Win2019, not inactive Legacy App
        Assert.Equal("Windows Server", results[0].Product);
    }
}

using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Integration;

[Collection("Database")]
public class CertificateServiceTests : IntegrationTestBase
{
    public CertificateServiceTests(DatabaseFixture db) : base(db) { }

    private CertificateService CreateService()
    {
        var conn = new NpgsqlConnection(Db.ConnectionString);
        conn.Open();
        return new CertificateService(conn, NullLogger<CertificateService>.Instance);
    }

    // ── GetSummaryAsync ──────────────────────────────────────────────

    [Fact]
    public async Task Summary_counts_active_certs_by_alert_level()
    {
        var svc = CreateService();
        var summary = await svc.GetSummaryAsync();

        // Active certs: AAA111 (CRITICAL), BBB222 (OK), CCC333 (WARNING), DDD444 (CRITICAL+expired)
        Assert.True(summary.CriticalCount >= 2); // AAA111 + DDD444
        Assert.True(summary.WarningCount >= 1);   // CCC333
        Assert.True(summary.OkCount >= 1);         // BBB222
        Assert.Equal(4, summary.TotalCount);       // excludes inactive EEE555
    }

    // ── ListCertificatesAsync ────────────────────────────────────────

    [Fact]
    public async Task List_returns_only_active()
    {
        var svc = CreateService();
        var results = (await svc.ListCertificatesAsync(null, null, null, 100)).ToList();

        Assert.Equal(4, results.Count);
        Assert.DoesNotContain(results, c => c.SubjectCn == "inactive.contoso.com");
    }

    [Fact]
    public async Task List_filter_by_alert_level()
    {
        var svc = CreateService();
        var results = (await svc.ListCertificatesAsync("WARNING", null, null, 100)).ToList();

        Assert.All(results, c => Assert.Equal("WARNING", c.AlertLevel));
    }

    [Fact]
    public async Task List_filter_by_server_ilike()
    {
        var svc = CreateService();
        var results = (await svc.ListCertificatesAsync(null, "WEB01", null, 100)).ToList();

        Assert.All(results, c => Assert.Equal("WEB01", c.ServerName));
        Assert.Equal(2, results.Count); // AAA111 + DDD444
    }

    [Fact]
    public async Task List_filter_by_days_until_expiry()
    {
        var svc = CreateService();
        var results = (await svc.ListCertificatesAsync(null, null, 14, 100)).ToList();

        Assert.All(results, c => Assert.True(c.DaysUntilExpiry <= 14));
    }

    [Fact]
    public async Task List_ordered_by_valid_to()
    {
        var svc = CreateService();
        var results = (await svc.ListCertificatesAsync(null, null, null, 100)).ToList();

        for (int i = 1; i < results.Count; i++)
            Assert.True(results[i - 1].ValidTo <= results[i].ValidTo);
    }

    // ── GetByIdAsync ─────────────────────────────────────────────────

    [Fact]
    public async Task GetById_returns_full_detail()
    {
        var svc = CreateService();
        var cert = await svc.GetByIdAsync(1);

        Assert.NotNull(cert);
        Assert.Equal("web01.contoso.com", cert.SubjectCn);
        Assert.Equal("AAA111", cert.Thumbprint);
        Assert.Equal("CN=Contoso CA", cert.Issuer);
    }

    [Fact]
    public async Task GetById_returns_null_for_missing()
    {
        var svc = CreateService();
        Assert.Null(await svc.GetByIdAsync(99999));
    }

    // ── GetByServerAsync ─────────────────────────────────────────────

    [Fact]
    public async Task GetByServer_returns_matching_certs()
    {
        var svc = CreateService();
        var results = (await svc.GetByServerAsync("API01")).ToList();

        Assert.Single(results);
        Assert.Equal("api.contoso.com", results[0].SubjectCn);
    }

    [Fact]
    public async Task GetByServer_case_insensitive()
    {
        var svc = CreateService();
        var results = (await svc.GetByServerAsync("web01")).ToList();

        Assert.Equal(2, results.Count);
    }
}

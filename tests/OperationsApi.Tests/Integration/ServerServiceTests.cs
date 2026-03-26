using Microsoft.Extensions.Logging.Abstractions;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Integration;

[Collection("Database")]
public class ServerServiceTests : IntegrationTestBase
{
    public ServerServiceTests(DatabaseFixture db) : base(db) { }

    private ServerService CreateService()
        => new(OpenConnection(), NullLogger<ServerService>.Instance);

    // ── ListServersAsync ──────────────────────────────────────────────

    [DockerFact]
    public async Task ListServers_returns_only_active()
    {
        var svc = CreateService();
        var results = (await svc.ListServersAsync(null, null, null, null, 100, 0)).ToList();

        Assert.All(results, s => Assert.True(s.IsActive));
        Assert.DoesNotContain(results, s => s.ServerName == "OLD01");
    }

    [DockerFact]
    public async Task ListServers_filter_by_environment()
    {
        var svc = CreateService();
        var results = (await svc.ListServersAsync("Production", null, null, null, 100, 0)).ToList();

        Assert.All(results, s => Assert.Equal("Production", s.Environment));
        Assert.Equal(3, results.Count); // WEB01, WEB02, API01
    }

    [DockerFact]
    public async Task ListServers_filter_by_application_ilike()
    {
        var svc = CreateService();
        var results = (await svc.ListServersAsync(null, "portal", null, null, 100, 0)).ToList();

        Assert.All(results, s => Assert.Equal("Portal", s.ApplicationName));
    }

    [DockerFact]
    public async Task ListServers_filter_by_patch_group()
    {
        var svc = CreateService();
        var results = (await svc.ListServersAsync(null, null, "8a", null, 100, 0)).ToList();

        Assert.All(results, s => Assert.Equal("8a", s.PatchGroup));
        Assert.Equal(2, results.Count); // WEB01, DEV01
    }

    [DockerFact]
    public async Task ListServers_search_by_name()
    {
        var svc = CreateService();
        var results = (await svc.ListServersAsync(null, null, null, "web", 100, 0)).ToList();

        Assert.Equal(2, results.Count);
        Assert.All(results, s => Assert.Contains("WEB", s.ServerName));
    }

    [DockerFact]
    public async Task ListServers_search_by_fqdn()
    {
        var svc = CreateService();
        var results = (await svc.ListServersAsync(null, null, null, "api01.contoso", 100, 0)).ToList();

        Assert.Single(results);
        Assert.Equal("API01", results[0].ServerName);
    }

    [DockerFact]
    public async Task ListServers_search_escapes_percent()
    {
        var svc = CreateService();
        // A search for "%" should not match everything
        var results = (await svc.ListServersAsync(null, null, null, "%", 100, 0)).ToList();

        Assert.Empty(results);
    }

    [DockerFact]
    public async Task ListServers_pagination()
    {
        var svc = CreateService();
        var page1 = (await svc.ListServersAsync(null, null, null, null, 2, 0)).ToList();
        var page2 = (await svc.ListServersAsync(null, null, null, null, 2, 2)).ToList();

        Assert.Equal(2, page1.Count);
        Assert.Equal(2, page2.Count);
        Assert.DoesNotContain(page2, s => page1.Any(p => p.ServerId == s.ServerId));
    }

    [DockerFact]
    public async Task ListServers_combined_filters()
    {
        var svc = CreateService();
        var results = (await svc.ListServersAsync("Production", "Portal", "8a", null, 100, 0)).ToList();

        Assert.Single(results);
        Assert.Equal("WEB01", results[0].ServerName);
    }

    // ── GetServerByIdAsync ────────────────────────────────────────────

    [DockerFact]
    public async Task GetById_returns_detail()
    {
        var svc = CreateService();
        var server = await svc.GetServerByIdAsync(1);

        Assert.NotNull(server);
        Assert.Equal("WEB01", server.ServerName);
        Assert.Equal("Windows Server 2022", server.OperatingSystem);
        Assert.Equal("10.0.0.1", server.IpAddress);
        Assert.Equal("Portal", server.ApplicationName);
    }

    [DockerFact]
    public async Task GetById_returns_null_for_missing()
    {
        var svc = CreateService();
        var server = await svc.GetServerByIdAsync(99999);

        Assert.Null(server);
    }

    // ── ResolveServerNameAsync ────────────────────────────────────────

    [DockerFact]
    public async Task Resolve_exact_match()
    {
        var svc = CreateService();
        var match = await svc.ResolveServerNameAsync("WEB01");

        Assert.NotNull(match);
        Assert.Equal("WEB01", match.ServerName);
        Assert.Equal("exact", match.MatchType);
    }

    [DockerFact]
    public async Task Resolve_case_insensitive()
    {
        var svc = CreateService();
        var match = await svc.ResolveServerNameAsync("web01");

        Assert.NotNull(match);
        Assert.Equal("WEB01", match.ServerName);
    }

    [DockerFact]
    public async Task Resolve_alias()
    {
        var svc = CreateService();
        var match = await svc.ResolveServerNameAsync("WEBSERVER01");

        Assert.NotNull(match);
        Assert.Equal("WEB01", match.ServerName);
        Assert.Equal("alias", match.MatchType);
    }

    [DockerFact]
    public async Task Resolve_returns_null_for_unknown()
    {
        var svc = CreateService();
        var match = await svc.ResolveServerNameAsync("COMPLETELY_UNKNOWN_SERVER_XYZ");

        Assert.Null(match);
    }

    // ── GetUnmatchedServersAsync ──────────────────────────────────────

    [DockerFact]
    public async Task GetUnmatched_returns_only_pending()
    {
        var svc = CreateService();
        var results = (await svc.GetUnmatchedServersAsync(null, 100)).ToList();

        Assert.DoesNotContain(results, u => u.ServerNameRaw == "RESOLVED01");
    }

    [DockerFact]
    public async Task GetUnmatched_filter_by_source()
    {
        var svc = CreateService();
        var results = (await svc.GetUnmatchedServersAsync("ivanti", 100)).ToList();

        Assert.Single(results);
        Assert.Equal("UNKNOWN99", results[0].ServerNameRaw);
    }

    [DockerFact]
    public async Task GetUnmatched_ordered_by_occurrence_desc()
    {
        var svc = CreateService();
        var results = (await svc.GetUnmatchedServersAsync(null, 100)).ToList();

        Assert.True(results.Count >= 2);
        Assert.True(results[0].OccurrenceCount >= results[1].OccurrenceCount);
    }
}

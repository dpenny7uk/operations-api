using Dapper;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Integration;

[Collection("Database")]
public class PatchExclusionServiceTests : IntegrationTestBase
{
    public PatchExclusionServiceTests(DatabaseFixture db) : base(db) { }

    private PatchExclusionService CreateService()
        => new(OpenConnection(), NullLogger<PatchExclusionService>.Instance);

    // Collection-shared DB: clean exclusions between tests so inserts don't leak.
    private async Task ResetExclusions()
    {
        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        await conn.ExecuteAsync("DELETE FROM patching.patch_exclusions");
    }

    private static DateOnly Today() => DateOnly.FromDateTime(DateTime.Today);
    private static DateOnly InDays(int n) => Today().AddDays(n);

    // ── Summary ──────────────────────────────────────────────────────

    [DockerFact]
    public async Task Summary_reflects_active_and_expired_holds()
    {
        await ResetExclusions();
        var svc = CreateService();

        await svc.ExcludeServersAsync(new List<int> { 1 }, "hold WEB01", InDays(30), "tester");
        await svc.ExcludeServersAsync(new List<int> { 2 }, "hold WEB02", InDays(10), "tester");

        // Age one of them into "expired hold" territory via a direct UPDATE - the
        // service has no API for setting held_until in the past.
        await using (var conn = new NpgsqlConnection(Db.ConnectionString))
        {
            await conn.OpenAsync();
            await conn.ExecuteAsync(
                "UPDATE patching.patch_exclusions SET held_until = CURRENT_DATE - INTERVAL '1 day' WHERE server_id = 1");
        }

        var summary = await svc.GetExclusionSummaryAsync();

        Assert.Equal(2, summary.TotalExcluded);
        Assert.Equal(1, summary.HoldExpiredCount);
    }

    // ── ExcludeServersAsync ──────────────────────────────────────────

    [DockerFact]
    public async Task Exclude_inserts_active_rows_for_each_server_id()
    {
        await ResetExclusions();
        var svc = CreateService();

        var count = await svc.ExcludeServersAsync(
            new List<int> { 1, 2, 3 }, "regression hold", InDays(14), "tester",
            ticket: "INC-42", reasonSlug: "regression", notes: "pending vendor fix");

        Assert.Equal(3, count);

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var rows = (await conn.QueryAsync<(string server_name, string reason, string ticket, string reason_slug, string notes, bool is_active)>(
            "SELECT server_name, reason, ticket, reason_slug, notes, is_active FROM patching.patch_exclusions ORDER BY server_name")).ToList();
        Assert.Equal(3, rows.Count);
        Assert.All(rows, r => Assert.True(r.is_active));
        Assert.All(rows, r => Assert.Equal("regression hold", r.reason));
        Assert.All(rows, r => Assert.Equal("INC-42", r.ticket));
        Assert.All(rows, r => Assert.Equal("regression", r.reason_slug));
        Assert.Contains(rows, r => r.server_name == "WEB01");
        Assert.Contains(rows, r => r.server_name == "WEB02");
        Assert.Contains(rows, r => r.server_name == "API01");
    }

    [DockerFact]
    public async Task Exclude_upserts_on_repeat_for_same_server()
    {
        await ResetExclusions();
        var svc = CreateService();

        await svc.ExcludeServersAsync(new List<int> { 1 }, "original reason", InDays(30), "alice",
            ticket: "INC-1", reasonSlug: "old", notes: "first note");
        await svc.ExcludeServersAsync(new List<int> { 1 }, "updated reason", InDays(60), "bob",
            ticket: "INC-2", reasonSlug: "new", notes: "second note");

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        // Unique index enforces at most one active row per server_id.
        var rows = (await conn.QueryAsync<(string reason, string ticket, string reason_slug, string notes, string excluded_by, DateOnly held_until)>(
            "SELECT reason, ticket, reason_slug, notes, excluded_by, held_until FROM patching.patch_exclusions WHERE server_id = 1 AND is_active")).ToList();
        Assert.Single(rows);
        Assert.Equal("updated reason", rows[0].reason);
        Assert.Equal("INC-2", rows[0].ticket);
        Assert.Equal("new", rows[0].reason_slug);
        Assert.Equal("second note", rows[0].notes);
        Assert.Equal("bob", rows[0].excluded_by);
        Assert.Equal(InDays(60), rows[0].held_until);
    }

    [DockerFact]
    public async Task Exclude_ignores_inactive_servers()
    {
        await ResetExclusions();
        var svc = CreateService();

        // DECOMM01 (id 6) is_active = FALSE in seed data - the service's WHERE clause skips it.
        var count = await svc.ExcludeServersAsync(new List<int> { 6 }, "try on inactive", InDays(30), "tester");

        Assert.Equal(0, count);
    }

    // ── BulkExcludeAsync ─────────────────────────────────────────────

    [DockerFact]
    public async Task BulkExclude_by_patch_group_covers_all_active_servers_in_group()
    {
        await ResetExclusions();
        var svc = CreateService();

        // Seed: WEB01 (active, 8a) + DEV01 (active, 8a). DECOMM01 (inactive, 9b) is excluded by is_active filter.
        var count = await svc.BulkExcludeAsync("group", "8a", "group-wide freeze", InDays(21), "tester");

        Assert.Equal(2, count);

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var names = (await conn.QueryAsync<string>(
            "SELECT server_name FROM patching.patch_exclusions WHERE is_active ORDER BY server_name")).ToList();
        Assert.Equal(new[] { "DEV01", "WEB01" }, names);
    }

    [DockerFact]
    public async Task BulkExclude_by_environment_covers_all_active_servers_in_env()
    {
        await ResetExclusions();
        var svc = CreateService();

        // Seed: Production active = WEB01, WEB02, API01, OLD01 (DECOMM01 inactive).
        var count = await svc.BulkExcludeAsync("env", "Production", "env-wide freeze", InDays(21), "tester");

        Assert.Equal(4, count);

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var names = (await conn.QueryAsync<string>(
            "SELECT server_name FROM patching.patch_exclusions WHERE is_active ORDER BY server_name")).ToList();
        Assert.Equal(new[] { "API01", "OLD01", "WEB01", "WEB02" }, names);
    }

    [DockerFact]
    public async Task BulkExclude_rejects_invalid_kind()
    {
        await ResetExclusions();
        var svc = CreateService();

        await Assert.ThrowsAsync<ArgumentException>(() =>
            svc.BulkExcludeAsync("bogus", "8a", "reason", InDays(7), "tester"));
    }

    // ── ExtendExclusionAsync ─────────────────────────────────────────

    [DockerFact]
    public async Task Extend_updates_held_until_and_returns_true()
    {
        await ResetExclusions();
        var svc = CreateService();

        await svc.ExcludeServersAsync(new List<int> { 1 }, "hold", InDays(7), "tester");

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var id = await conn.QuerySingleAsync<int>(
            "SELECT exclusion_id FROM patching.patch_exclusions WHERE server_id = 1 AND is_active");

        var ok = await svc.ExtendExclusionAsync(id, InDays(45), "extender");

        Assert.True(ok);
        var held = await conn.QuerySingleAsync<DateOnly>(
            "SELECT held_until FROM patching.patch_exclusions WHERE exclusion_id = @id", new { id });
        Assert.Equal(InDays(45), held);
        var by = await conn.QuerySingleAsync<string>(
            "SELECT excluded_by FROM patching.patch_exclusions WHERE exclusion_id = @id", new { id });
        Assert.Equal("extender", by);
    }

    [DockerFact]
    public async Task Extend_returns_false_for_missing_id()
    {
        await ResetExclusions();
        var svc = CreateService();
        var ok = await svc.ExtendExclusionAsync(999_999, InDays(30), "tester");
        Assert.False(ok);
    }

    // ── UpdateExclusionAsync ─────────────────────────────────────────

    [DockerFact]
    public async Task Update_patches_held_until_only()
    {
        await ResetExclusions();
        var svc = CreateService();
        await svc.ExcludeServersAsync(new List<int> { 1 }, "reason", InDays(7), "orig",
            notes: "initial notes");

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var id = await conn.QuerySingleAsync<int>(
            "SELECT exclusion_id FROM patching.patch_exclusions WHERE server_id = 1 AND is_active");

        var ok = await svc.UpdateExclusionAsync(id, InDays(30), null, "updater");

        Assert.True(ok);
        var row = await conn.QuerySingleAsync<(DateOnly held_until, string notes, string excluded_by)>(
            "SELECT held_until, notes, excluded_by FROM patching.patch_exclusions WHERE exclusion_id = @id", new { id });
        Assert.Equal(InDays(30), row.held_until);
        Assert.Equal("initial notes", row.notes);  // untouched
        Assert.Equal("updater", row.excluded_by);
    }

    [DockerFact]
    public async Task Update_patches_notes_only()
    {
        await ResetExclusions();
        var svc = CreateService();
        await svc.ExcludeServersAsync(new List<int> { 1 }, "reason", InDays(7), "orig",
            notes: "initial notes");

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var id = await conn.QuerySingleAsync<int>(
            "SELECT exclusion_id FROM patching.patch_exclusions WHERE server_id = 1 AND is_active");

        var ok = await svc.UpdateExclusionAsync(id, null, "fresh notes", "updater");

        Assert.True(ok);
        var row = await conn.QuerySingleAsync<(DateOnly held_until, string notes)>(
            "SELECT held_until, notes FROM patching.patch_exclusions WHERE exclusion_id = @id", new { id });
        Assert.Equal(InDays(7), row.held_until);  // untouched
        Assert.Equal("fresh notes", row.notes);
    }

    [DockerFact]
    public async Task Update_patches_both_held_until_and_notes()
    {
        await ResetExclusions();
        var svc = CreateService();
        await svc.ExcludeServersAsync(new List<int> { 1 }, "reason", InDays(7), "orig");

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var id = await conn.QuerySingleAsync<int>(
            "SELECT exclusion_id FROM patching.patch_exclusions WHERE server_id = 1 AND is_active");

        var ok = await svc.UpdateExclusionAsync(id, InDays(14), "both changed", "updater");

        Assert.True(ok);
        var row = await conn.QuerySingleAsync<(DateOnly held_until, string notes)>(
            "SELECT held_until, notes FROM patching.patch_exclusions WHERE exclusion_id = @id", new { id });
        Assert.Equal(InDays(14), row.held_until);
        Assert.Equal("both changed", row.notes);
    }

    [DockerFact]
    public async Task Update_returns_false_when_nothing_to_update()
    {
        await ResetExclusions();
        var svc = CreateService();
        await svc.ExcludeServersAsync(new List<int> { 1 }, "reason", InDays(7), "orig");

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var id = await conn.QuerySingleAsync<int>(
            "SELECT exclusion_id FROM patching.patch_exclusions WHERE server_id = 1 AND is_active");

        var ok = await svc.UpdateExclusionAsync(id, null, null, "updater");
        Assert.False(ok);
    }

    // ── RemoveExclusionAsync ─────────────────────────────────────────

    [DockerFact]
    public async Task Remove_soft_deletes_and_records_auditor()
    {
        await ResetExclusions();
        var svc = CreateService();
        await svc.ExcludeServersAsync(new List<int> { 1 }, "reason", InDays(7), "orig");

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var id = await conn.QuerySingleAsync<int>(
            "SELECT exclusion_id FROM patching.patch_exclusions WHERE server_id = 1 AND is_active");

        var ok = await svc.RemoveExclusionAsync(id, "remover");

        Assert.True(ok);
        var row = await conn.QuerySingleAsync<(bool is_active, string removed_by, DateTime? removed_at)>(
            "SELECT is_active, removed_by, removed_at FROM patching.patch_exclusions WHERE exclusion_id = @id", new { id });
        Assert.False(row.is_active);
        Assert.Equal("remover", row.removed_by);
        Assert.NotNull(row.removed_at);
    }

    [DockerFact]
    public async Task Remove_returns_false_for_missing_id()
    {
        await ResetExclusions();
        var svc = CreateService();
        var ok = await svc.RemoveExclusionAsync(999_999, "remover");
        Assert.False(ok);
    }

    // ── ListExclusionsAsync ──────────────────────────────────────────

    [DockerFact]
    public async Task List_returns_only_active_rows()
    {
        await ResetExclusions();
        var svc = CreateService();
        await svc.ExcludeServersAsync(new List<int> { 1, 2 }, "hold", InDays(7), "tester");

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var idToRemove = await conn.QuerySingleAsync<int>(
            "SELECT exclusion_id FROM patching.patch_exclusions WHERE server_id = 2 AND is_active");
        await svc.RemoveExclusionAsync(idToRemove, "tester");

        var page = await svc.ListExclusionsAsync(null, 50, 0);

        Assert.Equal(1, page.TotalCount);
        var items = page.Items.ToList();
        Assert.Single(items);
        Assert.Equal("WEB01", items[0].ServerName);
    }

    [DockerFact]
    public async Task List_search_filters_by_server_name()
    {
        await ResetExclusions();
        var svc = CreateService();
        await svc.ExcludeServersAsync(new List<int> { 1, 2, 3 }, "matched reason", InDays(7), "tester");

        var page = await svc.ListExclusionsAsync("WEB01", 50, 0);

        Assert.Equal(1, page.TotalCount);
        Assert.Equal("WEB01", page.Items.First().ServerName);
    }

    [DockerFact]
    public async Task List_search_filters_by_reason()
    {
        await ResetExclusions();
        var svc = CreateService();
        await svc.ExcludeServersAsync(new List<int> { 1 }, "vendor regression hold", InDays(7), "tester");
        await svc.ExcludeServersAsync(new List<int> { 2 }, "change freeze", InDays(7), "tester");

        var page = await svc.ListExclusionsAsync("regression", 50, 0);

        Assert.Equal(1, page.TotalCount);
        Assert.Equal("WEB01", page.Items.First().ServerName);
    }

    [DockerFact]
    public async Task List_respects_limit_and_offset()
    {
        await ResetExclusions();
        var svc = CreateService();
        await svc.ExcludeServersAsync(new List<int> { 1, 2, 3 }, "hold", InDays(7), "tester");

        var first = await svc.ListExclusionsAsync(null, 2, 0);
        var second = await svc.ListExclusionsAsync(null, 2, 2);

        Assert.Equal(3, first.TotalCount);
        Assert.Equal(2, first.Items.Count());
        Assert.Single(second.Items);
    }

    // ── SearchPatchServersAsync ──────────────────────────────────────

    [DockerFact]
    public async Task SearchPatchServers_returns_active_cycle_servers()
    {
        await ResetExclusions();
        var svc = CreateService();

        // Seed cycle 1 (active, +7d) has WEB01, WEB02, API01. Cycle 2 (completed, -30d) is
        // outside the 7-day completed-recency window.
        var page = await svc.SearchPatchServersAsync(null, 50, 0);
        var names = page.Items.Select(x => x.ServerName).OrderBy(x => x).ToList();

        Assert.Contains("WEB01", names);
        Assert.Contains("WEB02", names);
        Assert.Contains("API01", names);
        Assert.DoesNotContain("DEV01", names);
    }

    [DockerFact]
    public async Task SearchPatchServers_search_filters_by_server_name()
    {
        await ResetExclusions();
        var svc = CreateService();

        var page = await svc.SearchPatchServersAsync("WEB01", 50, 0);

        Assert.Equal(1, page.TotalCount);
        Assert.Equal("WEB01", page.Items.First().ServerName);
    }

    // Regression guard for migration 010: the ExcludeServersAsync / BulkExcludeAsync
    // upserts rely on ON CONFLICT (server_id) WHERE is_active. That target requires
    // a matching partial unique index. If a future migration drops it, the upsert
    // silently degrades to inserting duplicate active rows instead of updating.
    [DockerFact]
    public async Task Migration_010_partial_unique_index_on_active_exclusions_exists()
    {
        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();

        var (indexname, indexdef) = await conn.QuerySingleOrDefaultAsync<(string indexname, string indexdef)>(@"
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = 'patching'
              AND tablename  = 'patch_exclusions'
              AND indexname  = 'idx_exclusion_active_server'");

        Assert.Equal("idx_exclusion_active_server", indexname);
        // Must be UNIQUE and partial on is_active so it matches the upsert's
        // ON CONFLICT (server_id) WHERE is_active target.
        Assert.Contains("UNIQUE", indexdef, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("server_id", indexdef);
        Assert.Contains("WHERE is_active", indexdef, StringComparison.OrdinalIgnoreCase);
    }
}

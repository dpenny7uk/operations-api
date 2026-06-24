using Dapper;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using OperationsApi.Infrastructure;
using OperationsApi.Models;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Integration;

[Collection("Database")]
public class LicensingServiceTests : IntegrationTestBase
{
    public LicensingServiceTests(DatabaseFixture db) : base(db) { }

    private LicensingService CreateService()
        => new(OpenConnection(), NullLogger<LicensingService>.Instance);

    // Collection-shared DB: clear licences between tests (cascades to renewals + alerts).
    private async Task ResetLicences()
    {
        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        await conn.ExecuteAsync("DELETE FROM licensing.licences");
    }

    private static DateOnly Today() => DateOnly.FromDateTime(DateTime.Today);
    private static DateOnly InDays(int n) => Today().AddDays(n);

    private static LicenceCreateRequest NewReq(
        string vendor, string product, DateOnly expires,
        string? appName = null, string? type = "Annual", string status = "tracked",
        int? qty = 100, string? owner = "owner.sam", string? freq = "Annual",
        int? notice = 60, string? notes = null)
        => new()
        {
            ApplicationName = appName,
            Vendor = vendor,
            Product = product,
            LicenceType = type,
            QuantityHeld = qty,
            AuditFrequency = freq,
            AuditOwnerSam = owner,
            ExpiresAt = expires,
            NoticePeriodDays = notice,
            StatusFlag = status,
            Notes = notes,
        };

    // ── CreateAsync ──────────────────────────────────────────────────

    [DockerFact]
    public async Task Create_persists_fields_and_resolves_application_id_from_name()
    {
        await ResetLicences();
        var svc = CreateService();

        // 'Portal' is application_id 1 in the seed.
        var created = await svc.CreateAsync(
            NewReq("Tableau", "Tableau Server", InDays(20), appName: "Portal",
                type: "User Client Access", qty: 500, owner: "paul.griffin", freq: "Annual"),
            "tester");

        Assert.True(created.LicenceId > 0);
        Assert.Equal(1, created.ApplicationId);
        Assert.Equal("Tableau", created.Vendor);
        Assert.Equal("User Client Access", created.LicenceType);
        Assert.Equal(500, created.QuantityHeld);
        Assert.Equal("paul.griffin", created.AuditOwnerSam);
        Assert.Equal("tracked", created.StatusFlag);
        Assert.Equal(InDays(20), created.ExpiresAt);

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var by = await conn.QuerySingleAsync<string>(
            "SELECT created_by FROM licensing.licences WHERE licence_id = @id", new { id = created.LicenceId });
        Assert.Equal("tester", by);
    }

    [DockerFact]
    public async Task Create_with_unknown_application_name_leaves_application_id_null()
    {
        await ResetLicences();
        var svc = CreateService();

        var created = await svc.CreateAsync(
            NewReq("Snyk", "Snyk Enterprise", InDays(40), appName: "No Such App"), "tester");

        Assert.Null(created.ApplicationId);
    }

    // licence_type / audit_frequency are flexible VARCHAR (no DB CHECK): a value
    // outside the current CMDB dropdown must still persist.
    [DockerFact]
    public async Task Create_accepts_arbitrary_licence_type_and_audit_frequency()
    {
        await ResetLicences();
        var svc = CreateService();

        var created = await svc.CreateAsync(
            NewReq("Vendor", "Product", InDays(100), type: "Brand New CMDB Type", freq: "Fortnightly"),
            "tester");

        Assert.Equal("Brand New CMDB Type", created.LicenceType);
        Assert.Equal("Fortnightly", created.AuditFrequency);
    }

    // The partial unique index forbids two ACTIVE licences with the same
    // (vendor, product, application_id) - the service must surface that as a
    // ConflictException (-> 409) rather than letting the raw PG error become a 500.
    [DockerFact]
    public async Task Create_duplicate_active_vendor_product_app_throws_Conflict()
    {
        await ResetLicences();
        var svc = CreateService();
        await svc.CreateAsync(NewReq("Tableau", "Tableau Server", InDays(20), appName: "Portal"), "tester");

        await Assert.ThrowsAsync<ConflictException>(() =>
            svc.CreateAsync(NewReq("Tableau", "Tableau Server", InDays(40), appName: "Portal"), "tester"));
    }

    [DockerFact]
    public async Task Create_same_product_for_different_application_is_allowed()
    {
        await ResetLicences();
        var svc = CreateService();
        await svc.CreateAsync(NewReq("Tableau", "Tableau Server", InDays(20), appName: "Portal"), "tester");

        // Different application_id -> distinct key -> no conflict.
        var ok = await svc.CreateAsync(NewReq("Tableau", "Tableau Server", InDays(20), appName: "API Gateway"), "tester");
        Assert.True(ok.LicenceId > 0);
    }

    [DockerFact]
    public async Task Create_duplicate_is_allowed_after_soft_delete()
    {
        await ResetLicences();
        var svc = CreateService();
        var first = await svc.CreateAsync(NewReq("Tableau", "Tableau Server", InDays(20), appName: "Portal"), "tester");
        await svc.DeleteAsync(first.LicenceId, "tester");

        // The unique index is partial (WHERE is_active), so re-adding is fine once
        // the original is inactive.
        var second = await svc.CreateAsync(NewReq("Tableau", "Tableau Server", InDays(40), appName: "Portal"), "tester");
        Assert.True(second.LicenceId > first.LicenceId);
    }

    // ── ListAsync ────────────────────────────────────────────────────

    [DockerFact]
    public async Task List_returns_active_rows_ordered_by_expiry()
    {
        await ResetLicences();
        var svc = CreateService();
        await svc.CreateAsync(NewReq("Z-Vendor", "Later", InDays(120)), "tester");
        await svc.CreateAsync(NewReq("A-Vendor", "Sooner", InDays(5)), "tester");

        var rows = (await svc.ListAsync(null, null, null, 100)).ToList();

        Assert.Equal(2, rows.Count);
        Assert.Equal("Sooner", rows[0].Product);   // nearest expiry first
        Assert.Equal("Later", rows[1].Product);
    }

    [DockerFact]
    public async Task List_filters_by_vendor_status_and_search()
    {
        await ResetLicences();
        var svc = CreateService();
        await svc.CreateAsync(NewReq("Atlassian", "Confluence", InDays(10), status: "engaged"), "tester");
        await svc.CreateAsync(NewReq("Splunk", "Splunk Enterprise", InDays(20), status: "tracked"), "tester");

        Assert.Single(await svc.ListAsync("Atlassian", null, null, 100));
        Assert.Single(await svc.ListAsync(null, "engaged", null, 100));
        var hit = (await svc.ListAsync(null, null, "splunk", 100)).ToList();
        Assert.Single(hit);
        Assert.Equal("Splunk", hit[0].Vendor);
    }

    [DockerFact]
    public async Task List_embeds_renewal_history()
    {
        await ResetLicences();
        var svc = CreateService();
        var created = await svc.CreateAsync(NewReq("Tableau", "Tableau Server", InDays(30)), "tester");
        await svc.RenewAsync(created.LicenceId, InDays(395), "1-year renewal", "renewer");

        var row = (await svc.ListAsync(null, null, null, 100)).Single();

        Assert.Single(row.Renewals);
        Assert.Equal("1-year renewal", row.Renewals[0].Notes);
    }

    [DockerFact]
    public async Task List_excludes_soft_deleted()
    {
        await ResetLicences();
        var svc = CreateService();
        var a = await svc.CreateAsync(NewReq("V1", "P1", InDays(10)), "tester");
        await svc.CreateAsync(NewReq("V2", "P2", InDays(20)), "tester");

        await svc.DeleteAsync(a.LicenceId, "tester");

        var rows = (await svc.ListAsync(null, null, null, 100)).ToList();
        Assert.Single(rows);
        Assert.Equal("P2", rows[0].Product);
    }

    // ── GetByIdAsync ─────────────────────────────────────────────────

    [DockerFact]
    public async Task GetById_returns_detail_or_null()
    {
        await ResetLicences();
        var svc = CreateService();
        var created = await svc.CreateAsync(NewReq("V", "P", InDays(15)), "tester");

        var found = await svc.GetByIdAsync(created.LicenceId);
        Assert.NotNull(found);
        Assert.Equal("P", found!.Product);

        Assert.Null(await svc.GetByIdAsync(999_999));
    }

    // ── PatchAsync ───────────────────────────────────────────────────

    [DockerFact]
    public async Task Patch_updates_only_supplied_fields()
    {
        await ResetLicences();
        var svc = CreateService();
        var created = await svc.CreateAsync(
            NewReq("V", "P", InDays(30), status: "tracked", notes: "original"), "tester");

        // Inline status-flag edit path: only status_flag supplied.
        var updated = await svc.PatchAsync(created.LicenceId,
            new LicencePatchRequest { StatusFlag = "engaged" }, "editor");

        Assert.NotNull(updated);
        Assert.Equal("engaged", updated!.StatusFlag);
        Assert.Equal("original", updated.Notes);          // untouched
        Assert.Equal(InDays(30), updated.ExpiresAt);      // untouched

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var by = await conn.QuerySingleAsync<string>(
            "SELECT updated_by FROM licensing.licences WHERE licence_id = @id", new { id = created.LicenceId });
        Assert.Equal("editor", by);
    }

    [DockerFact]
    public async Task Patch_updates_expiry_and_multiple_fields()
    {
        await ResetLicences();
        var svc = CreateService();
        var created = await svc.CreateAsync(NewReq("V", "P", InDays(30), qty: 100, freq: "Annual"), "tester");

        var updated = await svc.PatchAsync(created.LicenceId, new LicencePatchRequest
        {
            ExpiresAt = InDays(400),
            QuantityHeld = 250,
            AuditFrequency = "Quarterly",
            Notes = "renegotiated",
        }, "editor");

        Assert.NotNull(updated);
        Assert.Equal(InDays(400), updated!.ExpiresAt);
        Assert.Equal(250, updated.QuantityHeld);
        Assert.Equal("Quarterly", updated.AuditFrequency);
        Assert.Equal("renegotiated", updated.Notes);
    }

    [DockerFact]
    public async Task Patch_changing_application_name_reresolves_application_id()
    {
        await ResetLicences();
        var svc = CreateService();
        // 'Portal' = id 1, 'API Gateway' = id 2 in the seed.
        var created = await svc.CreateAsync(NewReq("V", "P", InDays(30), appName: "Portal"), "tester");
        Assert.Equal(1, created.ApplicationId);

        var moved = await svc.PatchAsync(created.LicenceId,
            new LicencePatchRequest { ApplicationName = "API Gateway" }, "editor");
        Assert.Equal(2, moved!.ApplicationId);

        var unknown = await svc.PatchAsync(created.LicenceId,
            new LicencePatchRequest { ApplicationName = "No Such App" }, "editor");
        Assert.Null(unknown!.ApplicationId);
    }

    [DockerFact]
    public async Task Patch_returns_null_for_missing()
    {
        await ResetLicences();
        var svc = CreateService();
        var updated = await svc.PatchAsync(999_999, new LicencePatchRequest { Notes = "x" }, "editor");
        Assert.Null(updated);
    }

    // ── DeleteAsync ──────────────────────────────────────────────────

    [DockerFact]
    public async Task Delete_soft_deletes_and_returns_false_for_missing()
    {
        await ResetLicences();
        var svc = CreateService();
        var created = await svc.CreateAsync(NewReq("V", "P", InDays(10)), "tester");

        Assert.True(await svc.DeleteAsync(created.LicenceId, "remover"));
        Assert.Null(await svc.GetByIdAsync(created.LicenceId));   // GetById filters is_active
        Assert.False(await svc.DeleteAsync(created.LicenceId, "remover")); // already inactive
        Assert.False(await svc.DeleteAsync(999_999, "remover"));
    }

    // ── RenewAsync (the transactional core) ──────────────────────────

    [DockerFact]
    public async Task Renew_records_cycle_advances_expiry_resets_status_and_clears_alerts()
    {
        await ResetLicences();
        var svc = CreateService();
        var created = await svc.CreateAsync(
            NewReq("Tableau", "Tableau Server", InDays(20), status: "engaged"), "tester");

        // Seed an alert row that the renew must clear.
        await using (var conn = new NpgsqlConnection(Db.ConnectionString))
        {
            await conn.OpenAsync();
            await conn.ExecuteAsync(
                "INSERT INTO licensing.alerts (licence_id, threshold, notification_sent) VALUES (@id, 'thirty_d', TRUE)",
                new { id = created.LicenceId });
        }

        var oldExpiry = created.ExpiresAt;
        var renewed = await svc.RenewAsync(created.LicenceId, InDays(385), "1-year renewal", "renewer");

        Assert.NotNull(renewed);
        Assert.Equal(InDays(385), renewed!.ExpiresAt);     // expiry advanced
        Assert.Equal("tracked", renewed.StatusFlag);       // status reset
        Assert.Single(renewed.Renewals);                   // history appended
        Assert.Equal(oldExpiry, renewed.Renewals[0].CycleEnded);
        Assert.Equal(InDays(385), renewed.Renewals[0].NewExpires);
        Assert.Equal("renewer", renewed.Renewals[0].RenewedBy);

        await using var c2 = new NpgsqlConnection(Db.ConnectionString);
        await c2.OpenAsync();
        var alertsLeft = await c2.QuerySingleAsync<int>(
            "SELECT count(*) FROM licensing.alerts WHERE licence_id = @id", new { id = created.LicenceId });
        Assert.Equal(0, alertsLeft);                       // alert rows cleared
    }

    [DockerFact]
    public async Task Renew_clears_only_the_target_licence_alerts()
    {
        await ResetLicences();
        var svc = CreateService();
        var a = await svc.CreateAsync(NewReq("V1", "P1", InDays(10)), "tester");
        var b = await svc.CreateAsync(NewReq("V2", "P2", InDays(10)), "tester");

        await using (var conn = new NpgsqlConnection(Db.ConnectionString))
        {
            await conn.OpenAsync();
            await conn.ExecuteAsync(
                "INSERT INTO licensing.alerts (licence_id, threshold) VALUES (@a,'thirty_d'), (@b,'thirty_d')",
                new { a = a.LicenceId, b = b.LicenceId });
        }

        await svc.RenewAsync(a.LicenceId, InDays(375), null, "renewer");

        await using var c2 = new NpgsqlConnection(Db.ConnectionString);
        await c2.OpenAsync();
        Assert.Equal(0, await c2.QuerySingleAsync<int>(
            "SELECT count(*) FROM licensing.alerts WHERE licence_id = @id", new { id = a.LicenceId }));
        Assert.Equal(1, await c2.QuerySingleAsync<int>(
            "SELECT count(*) FROM licensing.alerts WHERE licence_id = @id", new { id = b.LicenceId }));
    }

    [DockerFact]
    public async Task Renew_returns_null_for_missing()
    {
        await ResetLicences();
        var svc = CreateService();
        Assert.Null(await svc.RenewAsync(999_999, InDays(365), null, "renewer"));
    }

    // ── Migration 019 schema invariants ──────────────────────────────
    // The alert dedup relies on UNIQUE (licence_id, threshold); the renew
    // endpoint resets it by deleting the rows. If a future migration drops the
    // constraint, each daily run would re-insert duplicate alert rows.
    [DockerFact]
    public async Task Migration_019_alerts_have_unique_licence_threshold()
    {
        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();

        var defs = (await conn.QueryAsync<string>(@"
            SELECT indexdef FROM pg_indexes
            WHERE schemaname = 'licensing' AND tablename = 'alerts'")).ToList();

        Assert.Contains(defs, d =>
            d.Contains("UNIQUE", StringComparison.OrdinalIgnoreCase)
            && d.Contains("licence_id") && d.Contains("threshold"));
    }
}

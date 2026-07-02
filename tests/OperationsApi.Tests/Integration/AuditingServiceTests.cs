using Dapper;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using OperationsApi.Infrastructure;
using OperationsApi.Models;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Integration;

[Collection("Database")]
public class AuditingServiceTests : IntegrationTestBase
{
    public AuditingServiceTests(DatabaseFixture db) : base(db) { }

    private AuditingService CreateService()
        => new(OpenConnection(), NullLogger<AuditingService>.Instance);

    // Collection-shared DB: clear auditing rows + reset any audit config the seed
    // apps (Portal/API Gateway/BackOffice) might have picked up between tests.
    private async Task ResetAuditing()
    {
        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            DELETE FROM auditing.campaigns;
            DELETE FROM auditing.application_groups;
            DELETE FROM auditing.application_nominees;
            DELETE FROM auditing.app_lifecycle_log;
            DELETE FROM shared.applications WHERE source_system = 'auditing';
            UPDATE shared.applications
            SET audit_frequency_months = NULL, auto_launch = FALSE,
                audit_routing_mode = 'line_manager', audit_due_period_days = 21,
                audit_status = 'active';");
    }

    private static AppCreateRequest NewApp(string name, string mode = "line_manager", int? freq = 12, int due = 21)
        => new()
        {
            Name = name,
            BusinessOwner = "paul.griffin",
            TechnicalOwner = "tom.walsh",
            SupportEmail = name.ToLowerInvariant() + "@contoso.com",
            AuditFrequencyMonths = freq,
            AutoLaunch = false,
            AuditRoutingMode = mode,
            AuditDuePeriodDays = due,
        };

    // ── Applications ─────────────────────────────────────────────────

    [DockerFact]
    public async Task Create_persists_audit_config_and_appears_in_list()
    {
        await ResetAuditing();
        var svc = CreateService();

        var created = await svc.CreateApplicationAsync(NewApp("Tableau Server", "line_manager", 6, 21), "tester");

        Assert.True(created.ApplicationId > 0);
        Assert.Equal("Tableau Server", created.Name);
        Assert.Equal("line_manager", created.AuditRoutingMode);
        Assert.Equal(6, created.AuditFrequencyMonths);
        Assert.Equal(21, created.AuditDuePeriodDays);

        var list = (await svc.ListApplicationsAsync(null)).ToList();
        Assert.Contains(list, a => a.ApplicationId == created.ApplicationId);
    }

    [DockerFact]
    public async Task Create_persists_and_returns_owner_display_names()
    {
        await ResetAuditing();
        var svc = CreateService();

        // Owners who are NOT synced AD members (no ad_users row) -- the cached display
        // is the only way to show a name instead of the bare sam.
        var created = await svc.CreateApplicationAsync(new AppCreateRequest
        {
            Name = "Display App",
            BusinessOwner = "bishopj", BusinessOwnerDisplay = "Jay Bishop",
            TechnicalOwner = "pennyd", TechnicalOwnerDisplay = "Penny Davis",
            AuditRoutingMode = "line_manager", AuditFrequencyMonths = 12, AuditDuePeriodDays = 21,
        }, "tester");

        Assert.Equal("Jay Bishop", created.BusinessOwnerDisplay);

        var detail = await svc.GetApplicationAsync(created.ApplicationId);
        Assert.Equal("Jay Bishop", detail!.BusinessOwnerDisplay);
        Assert.Equal("Penny Davis", detail.TechnicalOwnerDisplay);

        // A rename via patch can also update the cached display.
        var patched = await svc.PatchApplicationAsync(created.ApplicationId,
            new AppPatchRequest { BusinessOwner = "bishopj", BusinessOwnerDisplay = "Jay R. Bishop" }, "tester");
        Assert.Equal("Jay R. Bishop", patched!.BusinessOwnerDisplay);
    }

    [DockerFact]
    public async Task Create_duplicate_name_throws_ConflictException()
    {
        await ResetAuditing();
        var svc = CreateService();

        await svc.CreateApplicationAsync(NewApp("Atlassian Jira"), "tester");

        await Assert.ThrowsAsync<ConflictException>(() =>
            svc.CreateApplicationAsync(NewApp("Atlassian Jira"), "tester"));
    }

    [DockerFact]
    public async Task List_excludes_estate_apps_with_no_audit_footprint()
    {
        await ResetAuditing();
        var svc = CreateService();

        // The seed apps (Portal/API Gateway/BackOffice) have no audit config and no
        // bindings, so they must NOT appear in the auditing list.
        var list = (await svc.ListApplicationsAsync(null)).ToList();
        Assert.DoesNotContain(list, a => a.Name == "Portal");
    }

    [DockerFact]
    public async Task Patch_updates_only_supplied_fields()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("ServiceNow"), "tester");

        var patched = await svc.PatchApplicationAsync(app.ApplicationId,
            new AppPatchRequest { AutoLaunch = true, AuditDuePeriodDays = 14 }, "tester");

        Assert.NotNull(patched);
        Assert.True(patched!.AutoLaunch);
        Assert.Equal(14, patched.AuditDuePeriodDays);
        Assert.Equal("line_manager", patched.AuditRoutingMode); // untouched
    }


    // ── Bindings ─────────────────────────────────────────────────────

    [DockerFact]
    public async Task AddBinding_for_missing_app_returns_null()
    {
        await ResetAuditing();
        var svc = CreateService();

        var binding = await svc.AddBindingAsync(999999, new BindingCreateRequest { GroupDn = "CN=X,DC=contoso,DC=com" }, "tester");
        Assert.Null(binding);
    }

    [DockerFact]
    public async Task AddBinding_duplicate_active_throws_ConflictException()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Tableau Server"), "tester");
        var dn = "CN=APP-Tableau-Editors,OU=AppGroups,DC=contoso,DC=com";

        await svc.AddBindingAsync(app.ApplicationId, new BindingCreateRequest { GroupDn = dn }, "tester");

        await Assert.ThrowsAsync<ConflictException>(() =>
            svc.AddBindingAsync(app.ApplicationId, new BindingCreateRequest { GroupDn = dn }, "tester"));
    }

    [DockerFact]
    public async Task RemoveBinding_then_rebind_same_group_is_allowed()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Tableau Server"), "tester");
        var dn = "CN=APP-Tableau-Viewers,OU=AppGroups,DC=contoso,DC=com";

        var binding = await svc.AddBindingAsync(app.ApplicationId, new BindingCreateRequest { GroupDn = dn }, "tester");
        Assert.NotNull(binding);

        Assert.True(await svc.RemoveBindingAsync(app.ApplicationId, binding!.BindingId, "tester"));

        // Re-binding the same DN after removal must not trip the partial-unique index.
        var rebind = await svc.AddBindingAsync(app.ApplicationId, new BindingCreateRequest { GroupDn = dn }, "tester");
        Assert.NotNull(rebind);

        var detail = await svc.GetApplicationAsync(app.ApplicationId);
        Assert.Single(detail!.Bindings); // only the active one is embedded
    }

    // ── Nominees ─────────────────────────────────────────────────────

    [DockerFact]
    public async Task AddNominee_duplicate_throws_ConflictException()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Atlassian Jira", "nominees"), "tester");

        await svc.AddNomineeAsync(app.ApplicationId, new NomineeCreateRequest { NomineeSam = "sara.bennett", RoleNote = "Tech owner" }, "tester");

        await Assert.ThrowsAsync<ConflictException>(() =>
            svc.AddNomineeAsync(app.ApplicationId, new NomineeCreateRequest { NomineeSam = "sara.bennett" }, "tester"));
    }

    [DockerFact]
    public async Task GetApplication_embeds_bindings_and_nominees()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Atlassian Jira", "nominees"), "tester");
        await svc.AddBindingAsync(app.ApplicationId, new BindingCreateRequest { GroupDn = "CN=APP-Jira-Users,DC=contoso,DC=com", GroupSam = "APP-Jira-Users", GroupType = "Security" }, "tester");
        await svc.AddNomineeAsync(app.ApplicationId, new NomineeCreateRequest { NomineeSam = "sara.bennett", RoleNote = "Tech owner" }, "tester");

        var detail = await svc.GetApplicationAsync(app.ApplicationId);

        Assert.NotNull(detail);
        Assert.Single(detail!.Bindings);
        Assert.Single(detail.Nominees);
        Assert.Equal(1, detail.BindingCount);
        Assert.Equal(1, detail.NomineeCount);
    }

    [DockerFact]
    public async Task GetApplication_attaches_live_group_members_and_owners()
    {
        await ResetAuditing();
        const string dn = "CN=APP-Roster-Test,OU=AppGroups,DC=contoso,DC=com";

        // Seed the auditing_ad_sync tables the attach query reads from.
        await using (var conn = new NpgsqlConnection(Db.ConnectionString))
        {
            await conn.OpenAsync();
            await conn.ExecuteAsync(@"
                DELETE FROM auditing.group_memberships WHERE group_dn = @Dn;
                DELETE FROM auditing.group_owners      WHERE group_dn = @Dn;
                DELETE FROM auditing.ad_users WHERE sam_account = ANY(@Sams);
                INSERT INTO auditing.ad_users (sam_account, display_name, email, manager_sam, enabled) VALUES
                    ('alice.chen', 'Alice Chen', 'alice.chen@contoso.com', 'bob.harris', TRUE),
                    ('bob.harris', 'Bob Harris', 'bob.harris@contoso.com', NULL, TRUE);
                INSERT INTO auditing.group_memberships (group_dn, sam_account) VALUES (@Dn, 'alice.chen');
                INSERT INTO auditing.group_owners (group_dn, owner_sam, owner_display_name, owner_email, source)
                    VALUES (@Dn, 'bob.harris', 'Bob Harris', 'bob.harris@contoso.com', 'managedBy');",
                new { Dn = dn, Sams = new[] { "alice.chen", "bob.harris" } });
        }

        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Roster Test"), "tester");
        await svc.AddBindingAsync(app.ApplicationId, new BindingCreateRequest { GroupDn = dn, GroupSam = "APP-Roster-Test", GroupType = "Security" }, "tester");

        var detail = await svc.GetApplicationAsync(app.ApplicationId);
        var binding = Assert.Single(detail!.Bindings);

        var member = Assert.Single(binding.Members);
        Assert.Equal("alice.chen", member.SamAccount);
        Assert.Equal("Alice Chen", member.DisplayName);
        Assert.True(member.Enabled);
        Assert.Equal("bob.harris", member.ManagerSam);

        var owner = Assert.Single(binding.Owners);
        Assert.Equal("bob.harris", owner.OwnerSam);
        Assert.Equal("Bob Harris", owner.OwnerDisplayName);
        Assert.Equal("managedBy", owner.Source);
    }

    // ── Lifecycle: archive / restore / edit / delete ─────────────────

    // Inserts a campaign row directly so the open-campaign + history guards have
    // something to see, without standing up the full launch path.
    private async Task SeedCampaign(int appId, string status)
    {
        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            INSERT INTO auditing.campaigns (application_id, name, status, routing_mode, closure_mode, launch_kind)
            VALUES (@Id, 'seed campaign', @Status, 'line_manager', 'all_packets', 'manual')",
            new { Id = appId, Status = status });
    }

    [DockerFact]
    public async Task Archive_sets_status_and_GetApplication_reflects_it()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Archivable"), "tester");

        var archived = await svc.ArchiveApplicationAsync(app.ApplicationId, "tester");
        Assert.Equal("archived", archived!.AuditStatus);
        Assert.Equal("archived", (await svc.GetApplicationAsync(app.ApplicationId))!.AuditStatus);

        // Still in the registered list (archived is a status, not an unregister).
        Assert.Contains(await svc.ListApplicationsAsync(null), a => a.ApplicationId == app.ApplicationId && a.AuditStatus == "archived");
    }

    [DockerFact]
    public async Task Archive_blocked_when_open_campaign()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Busy"), "tester");
        await SeedCampaign(app.ApplicationId, "active");

        await Assert.ThrowsAsync<ConflictException>(() => svc.ArchiveApplicationAsync(app.ApplicationId, "tester"));
    }

    [DockerFact]
    public async Task Restore_flips_status_back_to_active()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Roundtrip"), "tester");
        await svc.ArchiveApplicationAsync(app.ApplicationId, "tester");

        var restored = await svc.RestoreApplicationAsync(app.ApplicationId, "tester");
        Assert.Equal("active", restored!.AuditStatus);
    }

    [DockerFact]
    public async Task Patch_name_updates_application_name()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Old Name"), "tester");

        var updated = await svc.PatchApplicationAsync(app.ApplicationId, new AppPatchRequest { Name = "New Name" }, "tester");
        Assert.Equal("New Name", updated!.Name);
    }

    [DockerFact]
    public async Task Patch_to_duplicate_name_throws_ConflictException()
    {
        await ResetAuditing();
        var svc = CreateService();
        await svc.CreateApplicationAsync(NewApp("Taken"), "tester");
        var app = await svc.CreateApplicationAsync(NewApp("Free"), "tester");

        await Assert.ThrowsAsync<ConflictException>(() =>
            svc.PatchApplicationAsync(app.ApplicationId, new AppPatchRequest { Name = "Taken" }, "tester"));
    }

    [DockerFact]
    public async Task Delete_hard_deletes_when_no_history_and_name_is_reusable()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Mistake"), "tester");

        Assert.True(await svc.DeleteApplicationAsync(app.ApplicationId, "tester"));

        // The shared.applications row is gone, so the same name can be re-used.
        await using (var conn = new NpgsqlConnection(Db.ConnectionString))
        {
            await conn.OpenAsync();
            var count = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM shared.applications WHERE application_id = @Id", new { Id = app.ApplicationId });
            Assert.Equal(0, count);
        }
        var recreated = await svc.CreateApplicationAsync(NewApp("Mistake"), "tester");
        Assert.True(recreated.ApplicationId > 0);
    }

    [DockerFact]
    public async Task Delete_soft_unregisters_when_campaign_history_exists()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Has History"), "tester");
        await SeedCampaign(app.ApplicationId, "closed"); // history, but not open

        Assert.True(await svc.DeleteApplicationAsync(app.ApplicationId, "tester"));

        // Row preserved (campaigns FK has no CASCADE) but dropped from the registered list.
        await using (var conn = new NpgsqlConnection(Db.ConnectionString))
        {
            await conn.OpenAsync();
            var count = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM shared.applications WHERE application_id = @Id AND is_active", new { Id = app.ApplicationId });
            Assert.Equal(1, count);
        }
        Assert.DoesNotContain(await svc.ListApplicationsAsync(null), a => a.ApplicationId == app.ApplicationId);
    }

    [DockerFact]
    public async Task Delete_blocked_when_open_campaign()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Mid Audit"), "tester");
        await SeedCampaign(app.ApplicationId, "active");

        await Assert.ThrowsAsync<ConflictException>(() => svc.DeleteApplicationAsync(app.ApplicationId, "tester"));
    }

    [DockerFact]
    public async Task Mutations_on_archived_app_are_rejected()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Frozen"), "tester");
        var binding = await svc.AddBindingAsync(app.ApplicationId, new BindingCreateRequest { GroupDn = "CN=APP-Frozen,DC=contoso,DC=com" }, "tester");
        await svc.ArchiveApplicationAsync(app.ApplicationId, "tester");

        await Assert.ThrowsAsync<ConflictException>(() => svc.AddBindingAsync(app.ApplicationId, new BindingCreateRequest { GroupDn = "CN=APP-Other,DC=contoso,DC=com" }, "tester"));
        await Assert.ThrowsAsync<ConflictException>(() => svc.RemoveBindingAsync(app.ApplicationId, binding!.BindingId, "tester"));
        await Assert.ThrowsAsync<ConflictException>(() => svc.AddNomineeAsync(app.ApplicationId, new NomineeCreateRequest { NomineeSam = "sara.bennett" }, "tester"));
        await Assert.ThrowsAsync<ConflictException>(() => svc.RemoveNomineeAsync(app.ApplicationId, 999));
        await Assert.ThrowsAsync<ConflictException>(() => svc.PatchApplicationAsync(app.ApplicationId, new AppPatchRequest { SupportEmail = "x@contoso.com" }, "tester"));
    }

    [DockerFact]
    public async Task Archive_restore_delete_write_lifecycle_log()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Logged"), "tester");

        await svc.ArchiveApplicationAsync(app.ApplicationId, "alice");
        await svc.RestoreApplicationAsync(app.ApplicationId, "bob");
        await svc.PatchApplicationAsync(app.ApplicationId, new AppPatchRequest { Name = "Logged Renamed" }, "carol");
        await svc.DeleteApplicationAsync(app.ApplicationId, "dave"); // hard-delete (no history)

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var rows = (await conn.QueryAsync<(string Action, string Actor, string? Detail)>(
            "SELECT action AS Action, actor AS Actor, detail AS Detail FROM auditing.app_lifecycle_log WHERE application_id = @Id ORDER BY log_id",
            new { Id = app.ApplicationId })).ToList();

        Assert.Equal(new[] { "archived", "restored", "renamed", "deleted" }, rows.Select(r => r.Action).ToArray());
        Assert.Equal(new[] { "alice", "bob", "carol", "dave" }, rows.Select(r => r.Actor).ToArray());
        Assert.Contains("Logged", rows[2].Detail); // rename records old -> new
    }

    [DockerFact]
    public async Task GetApplication_reports_rosters_synced_at()
    {
        await ResetAuditing();
        const string dn = "CN=APP-Synced,OU=AppGroups,DC=contoso,DC=com";
        await using (var conn = new NpgsqlConnection(Db.ConnectionString))
        {
            await conn.OpenAsync();
            await conn.ExecuteAsync(@"
                DELETE FROM auditing.group_memberships WHERE group_dn = @Dn;
                INSERT INTO auditing.group_memberships (group_dn, sam_account, synced_at)
                VALUES (@Dn, 'alice.chen', TIMESTAMPTZ '2026-06-20 06:00:00+00');",
                new { Dn = dn });
        }

        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Synced"), "tester");
        await svc.AddBindingAsync(app.ApplicationId, new BindingCreateRequest { GroupDn = dn }, "tester");

        var detail = await svc.GetApplicationAsync(app.ApplicationId);
        Assert.NotNull(detail!.RostersSyncedAt);
        Assert.Equal(new DateTime(2026, 6, 20, 6, 0, 0, DateTimeKind.Utc), detail.RostersSyncedAt!.Value.ToUniversalTime());
    }

    // ── Campaigns (read path) ────────────────────────────────────────

    [DockerFact]
    public async Task GetCampaign_hydrates_packets_subjects_decisions_and_email_log()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("ServiceNow"), "tester");

        // Seed a campaign + packet + subject + decision + email-log row directly.
        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var campaignId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO auditing.campaigns
                (application_id, name, status, routing_mode, closure_mode, cc_audit_mailbox, launch_kind)
            VALUES (@appId, '2026 ServiceNow access review', 'active', 'line_manager', 'all_packets',
                    'group.userrecertification@contoso.com', 'manual')
            RETURNING campaign_id", new { appId = app.ApplicationId });

        var packetId = await conn.ExecuteScalarAsync<Guid>(@"
            INSERT INTO auditing.attestation_packets
                (campaign_id, recipient_sam, recipient_display_name, recipient_email, recipient_kind)
            VALUES (@cid, 'alice.chen', 'Alice Chen', 'alice.chen@contoso.com', 'manager')
            RETURNING packet_id", new { cid = campaignId });

        await conn.ExecuteAsync(@"
            INSERT INTO auditing.attestation_packet_subjects (packet_id, subject_sam, subject_display_name)
            VALUES (@pid, 'david.okafor', 'David Okafor');
            INSERT INTO auditing.attestation_decisions (packet_id, subject_sam, subject_display, decision, comment)
            VALUES (@pid, 'david.okafor', 'David Okafor', 'revoke', 'Moved teams');
            INSERT INTO auditing.email_log (packet_id, campaign_id, to_addr, cc_addr, subject, kind, success)
            VALUES (@pid, @cid, 'alice.chen@contoso.com', 'group.userrecertification@contoso.com', 'invite', 'invite', TRUE);",
            new { pid = packetId, cid = campaignId });

        var detail = await svc.GetCampaignAsync(campaignId);

        Assert.NotNull(detail);
        Assert.Equal("ServiceNow", detail!.ApplicationName);
        Assert.Equal(1, detail.PacketCount);
        Assert.Single(detail.Packets);
        Assert.Single(detail.Packets[0].Subjects);
        Assert.Equal("david.okafor", detail.Packets[0].Subjects[0].SubjectSam);
        Assert.Single(detail.Decisions);
        Assert.Equal("revoke", detail.Decisions[0].Decision);
        Assert.Single(detail.EmailLog);
    }

    [DockerFact]
    public async Task ListCampaigns_orders_active_first()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Tableau Server"), "tester");

        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            INSERT INTO auditing.campaigns (application_id, name, status, routing_mode, closure_mode, closed_at)
            VALUES (@appId, 'closed one', 'closed', 'line_manager', 'all_packets', NOW() - INTERVAL '5 days'),
                   (@appId, 'active one', 'active', 'line_manager', 'all_packets', NULL)",
            new { appId = app.ApplicationId });

        var list = (await svc.ListCampaignsAsync()).ToList();

        Assert.Equal(2, list.Count);
        Assert.Equal("active", list[0].Status); // active sorts first
    }

    [DockerFact]
    public async Task GetCampaign_returns_null_for_missing()
    {
        await ResetAuditing();
        var svc = CreateService();
        Assert.Null(await svc.GetCampaignAsync(987654));
    }
}

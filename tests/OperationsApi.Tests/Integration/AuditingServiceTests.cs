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
        => new(OpenConnection(), NullLogger<AuditingService>.Instance, new AttestationTokenService("auditing-tests-signing-key-0123456789"));

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
            DELETE FROM shared.applications WHERE source_system = 'auditing';
            UPDATE shared.applications
            SET audit_frequency_months = NULL, auto_launch = FALSE,
                audit_routing_mode = 'line_manager', audit_due_period_days = 21;");
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

    [DockerFact]
    public async Task Delete_unregisters_app_but_preserves_shared_row()
    {
        await ResetAuditing();
        var svc = CreateService();
        var app = await svc.CreateApplicationAsync(NewApp("Legacy Reporting Portal"), "tester");
        await svc.AddBindingAsync(app.ApplicationId, new BindingCreateRequest { GroupDn = "CN=APP-Legacy,DC=contoso,DC=com" }, "tester");

        var removed = await svc.DeleteApplicationAsync(app.ApplicationId, "tester");
        Assert.True(removed);

        // Drops out of the auditing list...
        var list = (await svc.ListApplicationsAsync(null)).ToList();
        Assert.DoesNotContain(list, a => a.ApplicationId == app.ApplicationId);

        // ...but the shared.applications row still exists (just unregistered).
        await using var conn = new NpgsqlConnection(Db.ConnectionString);
        await conn.OpenAsync();
        var stillThere = await conn.ExecuteScalarAsync<bool>(
            "SELECT EXISTS (SELECT 1 FROM shared.applications WHERE application_id = @id AND is_active)",
            new { id = app.ApplicationId });
        Assert.True(stillThere);
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

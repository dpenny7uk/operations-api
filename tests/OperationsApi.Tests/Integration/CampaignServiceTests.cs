using System.Collections.Generic;
using System.Linq;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using OperationsApi.Infrastructure;
using OperationsApi.Models;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Integration;

[Collection("Database")]
public class CampaignServiceTests : IntegrationTestBase
{
    public CampaignServiceTests(DatabaseFixture db) : base(db) { }

    private static readonly IAttestationTokenService Tokens =
        new AttestationTokenService("integration-tests-signing-key-0123456789");

    private static IConfiguration Config() => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Auditing:BaseUrl"] = "https://ops/",
            ["Auditing:CcAuditMailbox"] = "audit@contoso.com",
            ["Auditing:TokenTtlDays"] = "14",
        }).Build();

    private AuditingService Aud() => new(OpenConnection(), NullLogger<AuditingService>.Instance, Tokens);
    private CampaignService Camp() => new(OpenConnection(), NullLogger<CampaignService>.Instance, Tokens, Config());

    private const string Dn = "CN=APP-X,OU=AppGroups,DC=contoso,DC=com";

    private async Task Reset()
    {
        await using var c = new NpgsqlConnection(Db.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            DELETE FROM auditing.campaigns;
            DELETE FROM auditing.application_groups;
            DELETE FROM auditing.application_nominees;
            DELETE FROM auditing.group_memberships;
            DELETE FROM auditing.ad_users;
            DELETE FROM shared.applications WHERE source_system = 'auditing';
            UPDATE shared.applications
            SET audit_frequency_months = NULL, auto_launch = FALSE,
                audit_routing_mode = 'line_manager', audit_due_period_days = 21, business_owner = NULL;");
    }

    // Org: paul (head) ; alice,bob -> paul ; carol -> alice ; zara -> no manager.
    // Members of APP-X: alice, bob, carol, zara.
    private async Task SeedAd()
    {
        await using var c = new NpgsqlConnection(Db.ConnectionString);
        await c.OpenAsync();
        await c.ExecuteAsync(@"
            INSERT INTO auditing.ad_users (sam_account, display_name, email, manager_sam, enabled) VALUES
              ('paul','Paul Griffin','paul@contoso.com', NULL, TRUE),
              ('alice','Alice Chen','alice@contoso.com','paul', TRUE),
              ('bob','Bob Harris','bob@contoso.com','paul', TRUE),
              ('carol','Carol Nguyen','carol@contoso.com','alice', TRUE),
              ('zara','Zara Holt','zara@contoso.com', NULL, TRUE)
            ON CONFLICT (sam_account) DO NOTHING;
            INSERT INTO auditing.group_memberships (group_dn, sam_account) VALUES
              (@dn,'alice'), (@dn,'bob'), (@dn,'carol'), (@dn,'zara')
            ON CONFLICT DO NOTHING;",
            new { dn = Dn });
    }

    private static string TokenFrom(LaunchedPacket p)
    {
        var i = p.AttestationUrl.IndexOf("t=", System.StringComparison.Ordinal);
        return p.AttestationUrl.Substring(i + 2);
    }

    private async Task<AuditApplicationDetail> NewApp(string name, string mode, string? businessOwner)
    {
        var aud = Aud();
        var app = await aud.CreateApplicationAsync(new AppCreateRequest
        {
            Name = name, AuditRoutingMode = mode, BusinessOwner = businessOwner,
            AuditFrequencyMonths = 12, AuditDuePeriodDays = 21,
        }, "tester");
        await aud.AddBindingAsync(app.ApplicationId, new BindingCreateRequest { GroupDn = Dn }, "tester");
        return app;
    }

    // ── Launch ───────────────────────────────────────────────────────

    [DockerFact]
    public async Task Launch_refuses_when_roster_is_empty()
    {
        await Reset(); // no AD seed -> no members
        var app = await NewApp("Empty App", "line_manager", "paul");

        var ex = await Assert.ThrowsAsync<ConflictException>(() =>
            Camp().LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "doomed" }, "tester"));
        Assert.Contains("No members", ex.Message);
    }

    [DockerFact]
    public async Task Launch_line_manager_groups_by_manager_and_merges_fallback_into_business_owner()
    {
        await Reset(); await SeedAd();
        var app = await NewApp("LM App", "line_manager", "paul"); // business_owner = paul

        var result = await Camp().LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "2026 LM review" }, "tester");

        // paul -> {alice, bob} + fallback {zara} (paul is business_owner); alice -> {carol}.
        Assert.Equal(2, result.Packets.Count);
        var paul = result.Packets.Single(p => p.RecipientSam == "paul");
        var alice = result.Packets.Single(p => p.RecipientSam == "alice");
        Assert.Equal(3, paul.SubjectCount); // alice, bob, zara
        Assert.Equal(1, alice.SubjectCount); // carol
        Assert.All(result.Packets, p => Assert.Equal("manager", p.RecipientKind));

        // Campaign persisted active with all_packets closure.
        await using var c = new NpgsqlConnection(Db.ConnectionString);
        await c.OpenAsync();
        var status = await c.QuerySingleAsync<string>("SELECT status FROM auditing.campaigns WHERE campaign_id=@id", new { id = result.CampaignId });
        var closure = await c.QuerySingleAsync<string>("SELECT closure_mode FROM auditing.campaigns WHERE campaign_id=@id", new { id = result.CampaignId });
        Assert.Equal("active", status);
        Assert.Equal("all_packets", closure);
    }

    [DockerFact]
    public async Task Launch_line_manager_refuses_when_unrouted_and_no_business_owner()
    {
        await Reset(); await SeedAd();
        var app = await NewApp("No Fallback App", "line_manager", null); // zara unrouted, no fallback

        var ex = await Assert.ThrowsAsync<ConflictException>(() =>
            Camp().LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "x" }, "tester"));
        Assert.Contains("business_owner", ex.Message);
    }

    [DockerFact]
    public async Task Launch_nominees_creates_one_full_roster_packet_per_nominee()
    {
        await Reset(); await SeedAd();
        var aud = Aud();
        var app = await NewApp("Nom App", "nominees", "paul");
        await aud.AddNomineeAsync(app.ApplicationId, new NomineeCreateRequest { NomineeSam = "paul", NomineeDisplayName = "Paul", NomineeEmail = "paul@contoso.com" }, "tester");
        await aud.AddNomineeAsync(app.ApplicationId, new NomineeCreateRequest { NomineeSam = "bob", NomineeDisplayName = "Bob", NomineeEmail = "bob@contoso.com" }, "tester");

        var result = await Camp().LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "2026 nominee review" }, "tester");

        Assert.Equal(2, result.Packets.Count);
        Assert.All(result.Packets, p => Assert.Equal("nominee", p.RecipientKind));
        Assert.All(result.Packets, p => Assert.Equal(4, p.SubjectCount)); // full roster: alice, bob, carol, zara
    }

    // ── Attestation submit + closure ─────────────────────────────────

    [DockerFact]
    public async Task Attestation_get_then_submit_records_decisions_and_returns_submitted_state()
    {
        await Reset(); await SeedAd();
        var app = await NewApp("Submit App", "line_manager", "paul");
        var result = await Camp().LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "submit review" }, "tester");
        var aliceToken = TokenFrom(result.Packets.Single(p => p.RecipientSam == "alice")); // subjects: carol

        var aud = Aud();
        var view = await aud.GetAttestationAsync(aliceToken);
        Assert.NotNull(view);
        Assert.Equal("pending", view!.State);
        Assert.Single(view.Subjects);

        var submit = await aud.SubmitAttestationAsync(aliceToken,
            new List<AttestationDecisionInput> { new() { SubjectSam = "carol", Decision = "revoke", Comment = "left team" } }, "10.0.0.9");
        Assert.Equal(AttestationSubmitOutcome.Ok, submit.Outcome);
        Assert.Equal("submitted", submit.View!.State);
        Assert.Single(submit.View.Decisions);
        Assert.Equal("revoke", submit.View.Decisions[0].Decision);

        // Re-submitting the same packet now conflicts with the read-only view.
        var again = await aud.SubmitAttestationAsync(aliceToken,
            new List<AttestationDecisionInput> { new() { SubjectSam = "carol", Decision = "keep" } }, null);
        Assert.Equal(AttestationSubmitOutcome.Conflict, again.Outcome);
    }

    [DockerFact]
    public async Task Attestation_all_packets_campaign_auto_closes_when_last_packet_submits()
    {
        await Reset(); await SeedAd();
        var app = await NewApp("Close App", "line_manager", "paul");
        var result = await Camp().LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "close review" }, "tester");
        var aud = Aud();

        async Task<string> Status() {
            await using var c = new NpgsqlConnection(Db.ConnectionString); await c.OpenAsync();
            return await c.QuerySingleAsync<string>("SELECT status FROM auditing.campaigns WHERE campaign_id=@id", new { id = result.CampaignId });
        }

        // Submit paul's packet (alice, bob, zara) -> campaign still active (alice pending).
        var paul = result.Packets.Single(p => p.RecipientSam == "paul");
        await aud.SubmitAttestationAsync(TokenFrom(paul),
            new List<AttestationDecisionInput> {
                new() { SubjectSam = "alice", Decision = "keep" },
                new() { SubjectSam = "bob", Decision = "keep" },
                new() { SubjectSam = "zara", Decision = "revoke" },
            }, null);
        Assert.Equal("active", await Status());

        // Submit alice's packet (carol) -> last one in -> campaign auto-closes.
        var alice = result.Packets.Single(p => p.RecipientSam == "alice");
        await aud.SubmitAttestationAsync(TokenFrom(alice),
            new List<AttestationDecisionInput> { new() { SubjectSam = "carol", Decision = "keep" } }, null);
        Assert.Equal("closed", await Status());
    }

    [DockerFact]
    public async Task Attestation_any_packet_first_nominee_closes_others_see_closed_by_other()
    {
        await Reset(); await SeedAd();
        var aud = Aud();
        var app = await NewApp("Nom Close App", "nominees", "paul");
        await aud.AddNomineeAsync(app.ApplicationId, new NomineeCreateRequest { NomineeSam = "paul", NomineeDisplayName = "Paul" }, "tester");
        await aud.AddNomineeAsync(app.ApplicationId, new NomineeCreateRequest { NomineeSam = "bob", NomineeDisplayName = "Bob" }, "tester");

        var result = await Camp().LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "nominee close" }, "tester");
        var paulToken = TokenFrom(result.Packets.Single(p => p.RecipientSam == "paul"));
        var bobToken = TokenFrom(result.Packets.Single(p => p.RecipientSam == "bob"));

        var roster = new[] { "alice", "bob", "carol", "zara" };
        var decisions = roster.Select(s => new AttestationDecisionInput { SubjectSam = s, Decision = "keep" }).ToList();

        var submit = await aud.SubmitAttestationAsync(paulToken, decisions, null);
        Assert.Equal(AttestationSubmitOutcome.Ok, submit.Outcome);

        // Bob's token still resolves, but now shows the read-only closed-by-other view.
        var bobView = await aud.GetAttestationAsync(bobToken);
        Assert.NotNull(bobView);
        Assert.Equal("closed_by_other", bobView!.State);
        Assert.Equal("Paul", bobView.SubmittedByDisplay);
        Assert.Equal(4, bobView.Decisions.Count);

        // And a submit attempt on bob's packet conflicts.
        var bobSubmit = await aud.SubmitAttestationAsync(bobToken, decisions, null);
        Assert.Equal(AttestationSubmitOutcome.Conflict, bobSubmit.Outcome);
    }

    [DockerFact]
    public async Task Attestation_rejects_unknown_token_and_validates_decisions()
    {
        await Reset(); await SeedAd();
        var app = await NewApp("Validate App", "line_manager", "paul");
        var result = await Camp().LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "validate" }, "tester");
        var aud = Aud();

        // Garbage token -> not found.
        Assert.Null(await aud.GetAttestationAsync("not-a-real-token"));
        var bad = await aud.SubmitAttestationAsync("not-a-real-token", new List<AttestationDecisionInput>(), null);
        Assert.Equal(AttestationSubmitOutcome.NotFound, bad.Outcome);

        // Missing a decision for a subject -> bad request.
        var aliceToken = TokenFrom(result.Packets.Single(p => p.RecipientSam == "paul")); // 3 subjects
        var partial = await aud.SubmitAttestationAsync(aliceToken,
            new List<AttestationDecisionInput> { new() { SubjectSam = "alice", Decision = "keep" } }, null);
        Assert.Equal(AttestationSubmitOutcome.BadRequest, partial.Outcome);

        // A decision for a subject not in the packet -> bad request.
        var stranger = await aud.SubmitAttestationAsync(aliceToken,
            new List<AttestationDecisionInput> {
                new() { SubjectSam = "alice", Decision = "keep" },
                new() { SubjectSam = "bob", Decision = "keep" },
                new() { SubjectSam = "zara", Decision = "keep" },
                new() { SubjectSam = "intruder", Decision = "keep" },
            }, null);
        Assert.Equal(AttestationSubmitOutcome.BadRequest, stranger.Outcome);
    }
}

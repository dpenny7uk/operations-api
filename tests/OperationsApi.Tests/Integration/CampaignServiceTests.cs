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

    private static IConfiguration Config() => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Auditing:BaseUrl"] = "https://ops/",
            ["Auditing:CcAuditMailbox"] = "audit@contoso.com",
        }).Build();

    private readonly FakeEmail _email = new();

    // Records sends; succeeds when there's a recipient (mirrors the real "no address
    // -> failure" behaviour) so we can assert email_log success rows without SMTP.
    private sealed class FakeEmail : IEmailService
    {
        public int Sent;
        public int Batches;
        public Task<EmailResult> SendAsync(EmailRequest req, System.Threading.CancellationToken ct = default)
        {
            Sent++;
            return Task.FromResult(new EmailResult { Success = !string.IsNullOrWhiteSpace(req.To), Response = "fake" });
        }
        public Task<IReadOnlyList<EmailResult>> SendBatchAsync(IReadOnlyList<EmailRequest> reqs, System.Threading.CancellationToken ct = default)
        {
            Batches++;
            var list = new List<EmailResult>();
            foreach (var r in reqs) { Sent++; list.Add(new EmailResult { Success = !string.IsNullOrWhiteSpace(r.To), Response = "fake" }); }
            return Task.FromResult<IReadOnlyList<EmailResult>>(list);
        }
    }

    private AuditingService Aud() => new(OpenConnection(), NullLogger<AuditingService>.Instance);
    private CampaignService Camp() => new(OpenConnection(), NullLogger<CampaignService>.Instance, _email, Config());

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

    // The SSO link is attest.html?p=<packetId>; pull the packet id back out for the
    // attestation tests (the caller's sam is passed separately as the identity).
    private static System.Guid PacketIdFrom(LaunchedPacket p)
    {
        var i = p.AttestationUrl.IndexOf("?p=", System.StringComparison.Ordinal);
        return System.Guid.Parse(p.AttestationUrl.Substring(i + 3));
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
    public async Task Launch_refuses_a_second_open_campaign_for_the_same_app()
    {
        await Reset(); await SeedAd();
        var app = await NewApp("Dup App", "line_manager", "paul");
        var camp = Camp();

        await camp.LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "first" }, "tester");

        // Second launch while one is open -> refused.
        await Assert.ThrowsAsync<ConflictException>(() =>
            camp.LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "second" }, "tester"));

        // Close the open one, then a fresh launch is allowed again.
        var firstId = (await Aud().ListCampaignsAsync()).First(c => c.ApplicationId == app.ApplicationId).CampaignId;
        await camp.CloseAsync(firstId, "tester");
        var third = await camp.LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "third" }, "tester");
        Assert.True(third.CampaignId > 0);
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
        var alicePid = PacketIdFrom(result.Packets.Single(p => p.RecipientSam == "alice")); // subjects: carol

        var aud = Aud();
        var view = await aud.GetAttestationAsync(alicePid, "alice");
        Assert.Equal(AttestationGetOutcome.Ok, view.Outcome);
        Assert.Equal("pending", view.View!.State);
        Assert.Single(view.View.Subjects);

        var submit = await aud.SubmitAttestationAsync(alicePid, "alice",
            new List<AttestationDecisionInput> { new() { SubjectSam = "carol", Decision = "revoke", Comment = "left team" } }, "10.0.0.9");
        Assert.Equal(AttestationSubmitOutcome.Ok, submit.Outcome);
        Assert.Equal("submitted", submit.View!.State);
        Assert.Single(submit.View.Decisions);
        Assert.Equal("revoke", submit.View.Decisions[0].Decision);

        // submitted_by is the authenticated caller (recorded from the SSO identity).
        await using (var conn = new NpgsqlConnection(Db.ConnectionString))
        {
            await conn.OpenAsync();
            var sam = await conn.QuerySingleAsync<string>(
                "SELECT submitted_by_sam FROM auditing.attestation_packets WHERE packet_id=@id", new { id = alicePid });
            Assert.Equal("alice", sam);
        }

        // Re-submitting the same packet now conflicts with the read-only view.
        var again = await aud.SubmitAttestationAsync(alicePid, "alice",
            new List<AttestationDecisionInput> { new() { SubjectSam = "carol", Decision = "keep" } }, null);
        Assert.Equal(AttestationSubmitOutcome.Conflict, again.Outcome);
    }

    [DockerFact]
    public async Task Attestation_refuses_a_caller_who_is_not_the_recipient()
    {
        await Reset(); await SeedAd();
        var app = await NewApp("Forbidden App", "line_manager", "paul");
        var result = await Camp().LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "forbidden review" }, "tester");
        var alicePid = PacketIdFrom(result.Packets.Single(p => p.RecipientSam == "alice"));
        var aud = Aud();

        // Bob is authenticated, but the packet is addressed to alice -> 403 on read and submit.
        Assert.Equal(AttestationGetOutcome.Forbidden, (await aud.GetAttestationAsync(alicePid, "bob")).Outcome);
        var submit = await aud.SubmitAttestationAsync(alicePid, "bob",
            new List<AttestationDecisionInput> { new() { SubjectSam = "carol", Decision = "keep" } }, null);
        Assert.Equal(AttestationSubmitOutcome.Forbidden, submit.Outcome);

        // The identity match is case-insensitive (AD sAMAccountName casing isn't guaranteed).
        Assert.Equal(AttestationGetOutcome.Ok, (await aud.GetAttestationAsync(alicePid, "ALICE")).Outcome);
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
        await aud.SubmitAttestationAsync(PacketIdFrom(paul), "paul",
            new List<AttestationDecisionInput> {
                new() { SubjectSam = "alice", Decision = "keep" },
                new() { SubjectSam = "bob", Decision = "keep" },
                new() { SubjectSam = "zara", Decision = "revoke" },
            }, null);
        Assert.Equal("active", await Status());

        // Submit alice's packet (carol) -> last one in -> campaign auto-closes.
        var alice = result.Packets.Single(p => p.RecipientSam == "alice");
        await aud.SubmitAttestationAsync(PacketIdFrom(alice), "alice",
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
        var paulPid = PacketIdFrom(result.Packets.Single(p => p.RecipientSam == "paul"));
        var bobPid = PacketIdFrom(result.Packets.Single(p => p.RecipientSam == "bob"));

        var roster = new[] { "alice", "bob", "carol", "zara" };
        var decisions = roster.Select(s => new AttestationDecisionInput { SubjectSam = s, Decision = "keep" }).ToList();

        var submit = await aud.SubmitAttestationAsync(paulPid, "paul", decisions, null);
        Assert.Equal(AttestationSubmitOutcome.Ok, submit.Outcome);

        // Bob's packet still resolves for bob, but now shows the read-only closed-by-other view.
        var bobView = await aud.GetAttestationAsync(bobPid, "bob");
        Assert.Equal(AttestationGetOutcome.Ok, bobView.Outcome);
        Assert.Equal("closed_by_other", bobView.View!.State);
        Assert.Equal("Paul", bobView.View.SubmittedByDisplay);
        Assert.Equal(4, bobView.View.Decisions.Count);

        // And a submit attempt on bob's packet conflicts.
        var bobSubmit = await aud.SubmitAttestationAsync(bobPid, "bob", decisions, null);
        Assert.Equal(AttestationSubmitOutcome.Conflict, bobSubmit.Outcome);
    }

    [DockerFact]
    public async Task Attestation_rejects_unknown_packet_and_validates_decisions()
    {
        await Reset(); await SeedAd();
        var app = await NewApp("Validate App", "line_manager", "paul");
        var result = await Camp().LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "validate" }, "tester");
        var aud = Aud();

        // Unknown packet id -> not found.
        var unknown = System.Guid.NewGuid();
        Assert.Equal(AttestationGetOutcome.NotFound, (await aud.GetAttestationAsync(unknown, "paul")).Outcome);
        var bad = await aud.SubmitAttestationAsync(unknown, "paul", new List<AttestationDecisionInput>(), null);
        Assert.Equal(AttestationSubmitOutcome.NotFound, bad.Outcome);

        // Missing a decision for a subject -> bad request.
        var paulPid = PacketIdFrom(result.Packets.Single(p => p.RecipientSam == "paul")); // 3 subjects
        var partial = await aud.SubmitAttestationAsync(paulPid, "paul",
            new List<AttestationDecisionInput> { new() { SubjectSam = "alice", Decision = "keep" } }, null);
        Assert.Equal(AttestationSubmitOutcome.BadRequest, partial.Outcome);

        // A decision for a subject not in the packet -> bad request.
        var stranger = await aud.SubmitAttestationAsync(paulPid, "paul",
            new List<AttestationDecisionInput> {
                new() { SubjectSam = "alice", Decision = "keep" },
                new() { SubjectSam = "bob", Decision = "keep" },
                new() { SubjectSam = "zara", Decision = "keep" },
                new() { SubjectSam = "intruder", Decision = "keep" },
            }, null);
        Assert.Equal(AttestationSubmitOutcome.BadRequest, stranger.Outcome);
    }

    // ── Email (Slice 4) ──────────────────────────────────────────────

    [DockerFact]
    public async Task Launch_sends_an_invite_per_packet_and_logs_them()
    {
        await Reset(); await SeedAd();
        var app = await NewApp("Email App", "line_manager", "paul");

        var result = await Camp().LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "email review" }, "tester");

        Assert.Equal(2, result.Packets.Count);       // paul + alice
        Assert.True(_email.Sent >= 2);

        var detail = await Aud().GetCampaignAsync(result.CampaignId);
        var invites = detail!.EmailLog.Where(e => e.Kind == "invite").ToList();
        Assert.Equal(2, invites.Count);
        Assert.All(invites, e => Assert.True(e.Success));
    }

    [DockerFact]
    public async Task Remind_resends_to_pending_packets_only_and_logs_reminders()
    {
        await Reset(); await SeedAd();
        var app = await NewApp("Remind App", "line_manager", "paul");
        var camp = Camp();
        var result = await camp.LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "remind review" }, "tester");

        // Submit alice's packet (subject carol) so only paul's packet stays pending.
        var aud = Aud();
        var alicePid = PacketIdFrom(result.Packets.Single(p => p.RecipientSam == "alice"));
        await aud.SubmitAttestationAsync(alicePid, "alice", new List<AttestationDecisionInput> { new() { SubjectSam = "carol", Decision = "keep" } }, null);

        var sent = await camp.RemindAsync(result.CampaignId, "tester");
        Assert.Equal(1, sent);

        var detail = await aud.GetCampaignAsync(result.CampaignId);
        Assert.Single(detail!.EmailLog, e => e.Kind == "reminder");
        Assert.NotNull(detail.Packets.Single(p => p.RecipientSam == "paul").ReminderSentAt);
    }

    [DockerFact]
    public async Task Remind_refuses_a_closed_campaign()
    {
        await Reset(); await SeedAd();
        var app = await NewApp("Closed Remind App", "line_manager", "paul");
        var camp = Camp();
        var result = await camp.LaunchAsync(new CampaignLaunchRequest { ApplicationId = app.ApplicationId, Name = "x" }, "tester");
        await camp.CloseAsync(result.CampaignId, "tester");

        await Assert.ThrowsAsync<ConflictException>(() => camp.RemindAsync(result.CampaignId, "tester"));
    }
}

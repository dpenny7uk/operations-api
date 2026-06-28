using System.Data;
using Dapper;
using Npgsql;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

/// <summary>
/// Campaign launch (Surface 09, Slices 3-4). Snapshots the app's routing config,
/// builds the subject roster from the bound groups' membership, creates one packet
/// per recipient (manager per line_manager group, or per nominee), emails each
/// recipient their attestation link, and logs every send to auditing.email_log.
/// The link carries only the packet_id — the recipient authenticates via Windows
/// SSO and the attestation API verifies their identity (no bearer token). The links
/// are also returned once so an OpsAdmin can hand-deliver to a recipient.
/// </summary>
public class CampaignService : BaseService<CampaignService>, ICampaignService
{
    private readonly IEmailService _email;
    private readonly string _baseUrl;
    private readonly string _ccMailbox;

    public CampaignService(IDbConnection db, ILogger<CampaignService> logger,
        IEmailService email, IConfiguration config)
        : base(db, logger)
    {
        _email = email;
        _baseUrl = (config["Auditing:BaseUrl"] ?? "https://ops/").TrimEnd('/') + "/";
        _ccMailbox = config["Auditing:CcAuditMailbox"] ?? "";
    }

    // The recipient's attestation link: SSO-gated, identifies the packet only.
    private string AttestUrl(Guid packetId) => _baseUrl + "attest.html?p=" + packetId;

    private sealed class AppConfigRow
    {
        public string ApplicationName { get; set; } = "";
        public string RoutingMode { get; set; } = "line_manager";
        public int DuePeriodDays { get; set; }
        public string? BusinessOwner { get; set; }
    }

    private sealed class RosterMember
    {
        public string Sam { get; set; } = "";
        public string Display { get; set; } = "";
        public string? Email { get; set; }
        public string? ManagerSam { get; set; }
    }

    private sealed class AdUser
    {
        public string SamAccount { get; set; } = "";
        public string? DisplayName { get; set; }
        public string? Email { get; set; }
    }

    private sealed class NomineeRow
    {
        public string NomineeSam { get; set; } = "";
        public string? NomineeDisplayName { get; set; }
        public string? NomineeEmail { get; set; }
        public string? RoleNote { get; set; }
    }

    // A recipient + the subjects they're being asked to attest.
    private sealed class PacketPlan
    {
        public string Sam = "";
        public string? Display;
        public string? Email;
        public string Kind = "manager";
        public string? RoleNote;
        public List<RosterMember> Subjects = new();
    }

    public Task<CampaignLaunchResult> LaunchAsync(CampaignLaunchRequest req, string actor) => RunDbAsync(async () =>
    {
        if (string.IsNullOrWhiteSpace(req.Name)) throw new ConflictException("Campaign name is required.");

        var app = await Db.QueryFirstOrDefaultAsync<AppConfigRow>($@"
            SELECT application_name AS ApplicationName, audit_routing_mode AS RoutingMode,
                   audit_due_period_days AS DuePeriodDays, business_owner AS BusinessOwner
            FROM {Sql.Tables.Applications}
            WHERE application_id = @Id AND is_active",
            new { Id = req.ApplicationId });
        if (app == null) throw new ConflictException("Application not found.");

        // One open campaign per app: refuse if an active/draft campaign already
        // exists (a partial unique index is the race-safe backstop). Prevents
        // double-launch -> duplicate links/emails + a forked audit trail.
        var openExists = await Db.ExecuteScalarAsync<bool>($@"
            SELECT EXISTS (SELECT 1 FROM {Sql.Tables.AuditCampaigns}
                           WHERE application_id = @Id AND status IN ('active', 'draft'))",
            new { Id = req.ApplicationId });
        if (openExists)
            throw new ConflictException("This application already has an open campaign. Close it before launching another.");

        // Roster = deduped members across the app's active bindings, with AD attrs
        // (display/email/manager). Empty until the AD sync has populated membership.
        var roster = (await Db.QueryAsync<RosterMember>($@"
            SELECT DISTINCT m.sam_account AS Sam,
                   COALESCE(u.display_name, m.sam_account) AS Display,
                   u.email AS Email,
                   u.manager_sam AS ManagerSam
            FROM {Sql.Tables.AuditApplicationGroups} g
            JOIN auditing.group_memberships m ON m.group_dn = g.group_dn
            LEFT JOIN auditing.ad_users u ON u.sam_account = m.sam_account
            WHERE g.application_id = @Id AND g.is_active",
            new { Id = req.ApplicationId })).ToList();

        if (roster.Count == 0)
            throw new ConflictException("No members found in the bound groups. Run the AD sync (or check the bindings) before launching.");

        var closureMode = app.RoutingMode == "nominees" ? "any_packet" : "all_packets";
        var dueAt = req.DueAt.HasValue
            ? DateTime.SpecifyKind(req.DueAt.Value.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc)
            : DateTime.SpecifyKind(DateTime.UtcNow.Date, DateTimeKind.Utc).AddDays(app.DuePeriodDays);

        // ---- Build packet plans by routing mode ----
        var plans = new List<PacketPlan>();

        if (app.RoutingMode == "nominees")
        {
            var nominees = (await Db.QueryAsync<NomineeRow>($@"
                SELECT nominee_sam AS NomineeSam, nominee_display_name AS NomineeDisplayName,
                       nominee_email AS NomineeEmail, role_note AS RoleNote
                FROM {Sql.Tables.AuditApplicationNominees}
                WHERE application_id = @Id",
                new { Id = req.ApplicationId })).ToList();
            if (nominees.Count == 0)
                throw new ConflictException("This application is in nominees mode but has no nominees configured.");

            foreach (var n in nominees)
                plans.Add(new PacketPlan { Sam = n.NomineeSam, Display = n.NomineeDisplayName ?? n.NomineeSam, Email = n.NomineeEmail, Kind = "nominee", RoleNote = n.RoleNote, Subjects = roster });
        }
        else
        {
            // line_manager: group by manager_sam; NULL-manager subjects -> business_owner fallback.
            var byManager = roster.Where(r => r.ManagerSam != null).GroupBy(r => r.ManagerSam!).ToList();
            var unrouted = roster.Where(r => r.ManagerSam == null).ToList();

            var mgrSams = byManager.Select(g => g.Key).ToArray();
            var mgrBySam = (mgrSams.Length == 0 ? new List<AdUser>() : (await Db.QueryAsync<AdUser>($@"
                SELECT sam_account AS SamAccount, display_name AS DisplayName, email AS Email
                FROM auditing.ad_users WHERE sam_account = ANY(@Sams)",
                new { Sams = mgrSams })).ToList()).ToDictionary(u => u.SamAccount);

            // Keyed by recipient sam so the fallback can merge into a manager's
            // existing packet (a business_owner who is also a line manager would
            // otherwise collide on the unique (campaign, recipient, kind) index).
            var plansBySam = new Dictionary<string, PacketPlan>();
            foreach (var g in byManager)
            {
                mgrBySam.TryGetValue(g.Key, out var mu);
                plansBySam[g.Key] = new PacketPlan { Sam = g.Key, Display = mu?.DisplayName ?? g.Key, Email = mu?.Email, Kind = "manager", Subjects = g.ToList() };
            }

            if (unrouted.Count > 0)
            {
                if (string.IsNullOrWhiteSpace(app.BusinessOwner))
                    throw new ConflictException($"{unrouted.Count} subject(s) have no manager and the application has no business_owner fallback. Set a business owner or fix the manager data before launching.");

                if (plansBySam.TryGetValue(app.BusinessOwner, out var existing))
                {
                    existing.Subjects = existing.Subjects.Concat(unrouted).ToList();
                }
                else
                {
                    var bo = await Db.QueryFirstOrDefaultAsync<AdUser>($@"
                        SELECT sam_account AS SamAccount, display_name AS DisplayName, email AS Email
                        FROM auditing.ad_users WHERE sam_account = @Sam",
                        new { Sam = app.BusinessOwner });
                    plansBySam[app.BusinessOwner] = new PacketPlan { Sam = app.BusinessOwner, Display = bo?.DisplayName ?? app.BusinessOwner, Email = bo?.Email, Kind = "manager", RoleNote = "business owner (fallback)", Subjects = unrouted };
                }
            }

            plans.AddRange(plansBySam.Values);
        }

        // ---- Persist atomically ----
        if (Db.State != ConnectionState.Open) Db.Open();
        using var tx = Db.BeginTransaction();

        int campaignId;
        try
        {
            campaignId = await Db.ExecuteScalarAsync<int>($@"
                INSERT INTO {Sql.Tables.AuditCampaigns}
                    (application_id, name, status, due_at, created_by, created_at, launch_kind,
                     routing_mode, closure_mode, cc_audit_mailbox)
                VALUES (@AppId, @Name, 'active', @DueAt, @Actor, NOW(), 'manual',
                        @RoutingMode, @ClosureMode, @Cc)
                RETURNING campaign_id",
                new { AppId = req.ApplicationId, Name = req.Name.Trim(), DueAt = dueAt, Actor = actor,
                      RoutingMode = app.RoutingMode, ClosureMode = closureMode, Cc = Cc() }, tx);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            // Lost the race against a concurrent launch (partial unique index).
            tx.Rollback();
            throw new ConflictException("This application already has an open campaign. Close it before launching another.");
        }

        // due_period <= 7 suppresses the reminder (it would fire before/at launch).
        DateTime? reminderStamp = app.DuePeriodDays <= 7 ? DateTime.UtcNow : null;
        var result = new CampaignLaunchResult { CampaignId = campaignId, Name = req.Name.Trim(), RoutingMode = app.RoutingMode };
        var sends = new List<(Guid PacketId, string? To, string? Display, string Kind, string Url)>();

        foreach (var p in plans)
        {
            // packet_id is generated client-side so we can build the SSO link before insert.
            var packetId = Guid.NewGuid();

            await Db.ExecuteAsync($@"
                INSERT INTO {Sql.Tables.AuditPackets}
                    (packet_id, campaign_id, recipient_sam, recipient_display_name, recipient_email,
                     recipient_kind, role_note, reminder_sent_at)
                VALUES (@Pid, @Cid, @Sam, @Disp, @Email, @Kind, @RoleNote, @Reminder)",
                new { Pid = packetId, Cid = campaignId, Sam = p.Sam, Disp = p.Display, Email = p.Email,
                      Kind = p.Kind, RoleNote = p.RoleNote, Reminder = reminderStamp }, tx);

            foreach (var s in p.Subjects)
            {
                await Db.ExecuteAsync($@"
                    INSERT INTO {Sql.Tables.AuditPacketSubjects} (packet_id, subject_sam, subject_display_name)
                    VALUES (@Pid, @Sam, @Disp)
                    ON CONFLICT (packet_id, subject_sam) DO NOTHING",
                    new { Pid = packetId, Sam = s.Sam, Disp = s.Display }, tx);
            }

            var url = AttestUrl(packetId);
            sends.Add((packetId, p.Email, p.Display, p.Kind, url));
            result.Packets.Add(new LaunchedPacket
            {
                RecipientSam = p.Sam, RecipientDisplay = p.Display, RecipientEmail = p.Email,
                RecipientKind = p.Kind, SubjectCount = p.Subjects.Count, AttestationUrl = url,
            });
        }

        tx.Commit();

        // Deliver invites + log every attempt OUTSIDE the transaction (SMTP I/O must
        // not hold the DB tx open; a delivery failure must not roll back the launch),
        // over a SINGLE SMTP connection for the whole campaign.
        var subject = req.Name.Trim() + " - your attestation";
        var requests = sends.Select(s =>
        {
            var (text, html) = BuildBody("invite", s.Display, app.ApplicationName, req.Name.Trim(), dueAt, s.Url, s.Kind == "nominee");
            return new EmailRequest { To = s.To ?? "", Cc = Cc(), Subject = subject, TextBody = text, HtmlBody = html };
        }).ToList();
        var emailResults = await _email.SendBatchAsync(requests);
        for (var i = 0; i < sends.Count; i++)
            await LogEmailAsync(sends[i].PacketId, campaignId, sends[i].To, subject, "invite", emailResults[i]);

        return result;
    });

    public Task<bool> CloseAsync(int campaignId, string actor) => RunDbAsync(async () =>
        await Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.AuditCampaigns}
            SET status = 'closed', closed_at = NOW()
            WHERE campaign_id = @Id AND status <> 'closed'",
            new { Id = campaignId }) > 0);

    private sealed class RemindCampaign
    {
        public string Name { get; set; } = "";
        public string Status { get; set; } = "";
        public DateTime? DueAt { get; set; }
        public string ApplicationName { get; set; } = "";
    }

    private sealed class PendingPacket
    {
        public Guid PacketId { get; set; }
        public string? Email { get; set; }
        public string? Display { get; set; }
        public string Kind { get; set; } = "manager";
    }

    public Task<int> RemindAsync(int campaignId, string actor) => RunDbAsync(async () =>
    {
        var c = await Db.QueryFirstOrDefaultAsync<RemindCampaign>($@"
            SELECT c.name AS Name, c.status AS Status, c.due_at AS DueAt, a.application_name AS ApplicationName
            FROM {Sql.Tables.AuditCampaigns} c
            JOIN {Sql.Tables.Applications} a ON a.application_id = c.application_id
            WHERE c.campaign_id = @Id",
            new { Id = campaignId });
        if (c == null) throw new ConflictException("Campaign not found.");
        if (c.Status != "active") throw new ConflictException("Only active campaigns can be reminded.");

        var pending = (await Db.QueryAsync<PendingPacket>($@"
            SELECT packet_id AS PacketId, recipient_email AS Email, recipient_display_name AS Display,
                   recipient_kind AS Kind
            FROM {Sql.Tables.AuditPackets}
            WHERE campaign_id = @Id AND submitted_at IS NULL",
            new { Id = campaignId })).ToList();

        var subject = "Reminder: " + c.Name + " - your attestation";

        // Phase 1: build a reminder per not-yet-submitted packet. The link is just the
        // packet_id (SSO-gated), so there's nothing to re-issue.
        var items = new List<(Guid PacketId, string? To, EmailRequest Req)>();
        foreach (var p in pending)
        {
            var url = AttestUrl(p.PacketId);
            var (text, html) = BuildBody("reminder", p.Display, c.ApplicationName, c.Name, c.DueAt, url, p.Kind == "nominee");
            items.Add((p.PacketId, p.Email, new EmailRequest { To = p.Email ?? "", Cc = Cc(), Subject = subject, TextBody = text, HtmlBody = html }));
        }

        // Phase 2: send over one connection. Phase 3: log all, stamp reminder_sent_at only on success.
        var results = await _email.SendBatchAsync(items.Select(x => x.Req).ToList());
        var sent = 0;
        for (var i = 0; i < items.Count; i++)
        {
            await LogEmailAsync(items[i].PacketId, campaignId, items[i].To, subject, "reminder", results[i]);
            if (results[i].Success)
            {
                sent++;
                await Db.ExecuteAsync($@"
                    UPDATE {Sql.Tables.AuditPackets} SET reminder_sent_at = NOW() WHERE packet_id = @Pid",
                    new { Pid = items[i].PacketId });
            }
        }
        return sent;
    });

    private Task LogEmailAsync(Guid packetId, int campaignId, string? to, string subject, string kind, EmailResult res)
        => Db.ExecuteAsync($@"
            INSERT INTO {Sql.Tables.AuditEmailLog}
                (packet_id, campaign_id, to_addr, cc_addr, subject, kind, sent_at, smtp_response, success)
            VALUES (@Pid, @Cid, @To, @Cc, @Subject, @Kind, NOW(), @Resp, @Success)",
            new { Pid = packetId, Cid = campaignId, To = to, Cc = Cc(), Subject = subject, Kind = kind, Resp = res.Response, Success = res.Success });

    private static (string Text, string Html) BuildBody(string kind, string? recipientDisplay, string? appName,
        string campaignName, DateTime? dueAt, string url, bool isNominee)
    {
        var who = string.IsNullOrWhiteSpace(recipientDisplay) ? "there" : recipientDisplay!;
        var due = dueAt.HasValue ? dueAt.Value.ToString("d MMMM yyyy") : "the due date";
        var lead = kind == "reminder"
            ? "This is a reminder that an access attestation is awaiting your response."
            : "You have been asked to review and confirm who should keep access to an application.";
        var roleLine = isNominee
            ? "You are a nominee for this review; the first nominee to submit closes it for everyone."
            : "Please confirm access for your direct reports listed at the link.";

        var text =
            $"Hello {who},\n\n{lead}\n\n" +
            $"Application: {appName}\nReview: {campaignName}\nDue: {due}\n\n" +
            $"{roleLine}\n\nOpen your attestation:\n{url}\n\n" +
            "If you were not expecting this, please contact Service Operations.";

        var html =
            $"<p>Hello {Enc(who)},</p><p>{Enc(lead)}</p>" +
            $"<p><b>Application:</b> {Enc(appName)}<br><b>Review:</b> {Enc(campaignName)}<br><b>Due:</b> {Enc(due)}</p>" +
            $"<p>{Enc(roleLine)}</p>" +
            $"<p><a href=\"{Enc(url)}\">Open your attestation</a></p>" +
            "<p style=\"color:#888;font-size:12px\">If you were not expecting this, please contact Service Operations.</p>";

        return (text, html);
    }

    private static string Enc(string? s) => System.Net.WebUtility.HtmlEncode(s ?? "");

    private string? Cc() => string.IsNullOrEmpty(_ccMailbox) ? null : _ccMailbox;
}

using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

/// <summary>
/// Campaign launch (Surface 09, Slice 3). Snapshots the app's routing config,
/// builds the subject roster from the bound groups' membership, and creates one
/// signed-token packet per recipient (manager per line_manager group, or per
/// nominee). DB-only: emails are logged as pending (delivery lands in the email
/// slice); the minted links are returned once so an OpsAdmin can distribute them.
/// </summary>
public class CampaignService : BaseService<CampaignService>, ICampaignService
{
    private readonly IAttestationTokenService _tokens;
    private readonly string _baseUrl;
    private readonly string _ccMailbox;
    private readonly int _tokenTtlDays;

    public CampaignService(IDbConnection db, ILogger<CampaignService> logger,
        IAttestationTokenService tokens, IConfiguration config)
        : base(db, logger)
    {
        _tokens = tokens;
        _baseUrl = (config["Auditing:BaseUrl"] ?? "https://ops/").TrimEnd('/') + "/";
        _ccMailbox = config["Auditing:CcAuditMailbox"] ?? "";
        _tokenTtlDays = int.TryParse(config["Auditing:TokenTtlDays"], out var t) ? t : 14;
    }

    private sealed class AppConfigRow
    {
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
            SELECT audit_routing_mode AS RoutingMode, audit_due_period_days AS DuePeriodDays,
                   business_owner AS BusinessOwner
            FROM {Sql.Tables.Applications}
            WHERE application_id = @Id AND is_active",
            new { Id = req.ApplicationId });
        if (app == null) throw new ConflictException("Application not found.");

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
        var tokenExpiry = new DateTimeOffset(dueAt, TimeSpan.Zero).AddDays(_tokenTtlDays);

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

        var campaignId = await Db.ExecuteScalarAsync<int>($@"
            INSERT INTO {Sql.Tables.AuditCampaigns}
                (application_id, name, status, due_at, created_by, created_at, launch_kind,
                 routing_mode, closure_mode, cc_audit_mailbox)
            VALUES (@AppId, @Name, 'active', @DueAt, @Actor, NOW(), 'manual',
                    @RoutingMode, @ClosureMode, @Cc)
            RETURNING campaign_id",
            new { AppId = req.ApplicationId, Name = req.Name.Trim(), DueAt = dueAt, Actor = actor,
                  RoutingMode = app.RoutingMode, ClosureMode = closureMode, Cc = Cc() }, tx);

        // due_period <= 7 suppresses the reminder (it would fire before/at launch).
        DateTime? reminderStamp = app.DuePeriodDays <= 7 ? DateTime.UtcNow : null;
        var result = new CampaignLaunchResult { CampaignId = campaignId, Name = req.Name.Trim(), RoutingMode = app.RoutingMode };

        foreach (var p in plans)
        {
            // packet_id is generated client-side so we can mint the token before insert.
            var packetId = Guid.NewGuid();
            var minted = _tokens.Mint(packetId, tokenExpiry);

            await Db.ExecuteAsync($@"
                INSERT INTO {Sql.Tables.AuditPackets}
                    (packet_id, campaign_id, recipient_sam, recipient_display_name, recipient_email,
                     recipient_kind, role_note, token_hash, token_expires_at, reminder_sent_at)
                VALUES (@Pid, @Cid, @Sam, @Disp, @Email, @Kind, @RoleNote, @Hash, @Exp, @Reminder)",
                new { Pid = packetId, Cid = campaignId, Sam = p.Sam, Disp = p.Display, Email = p.Email,
                      Kind = p.Kind, RoleNote = p.RoleNote, Hash = minted.Hash, Exp = tokenExpiry.UtcDateTime, Reminder = reminderStamp }, tx);

            foreach (var s in p.Subjects)
            {
                await Db.ExecuteAsync($@"
                    INSERT INTO {Sql.Tables.AuditPacketSubjects} (packet_id, subject_sam, subject_display_name)
                    VALUES (@Pid, @Sam, @Disp)
                    ON CONFLICT (packet_id, subject_sam) DO NOTHING",
                    new { Pid = packetId, Sam = s.Sam, Disp = s.Display }, tx);
            }

            await Db.ExecuteAsync($@"
                INSERT INTO {Sql.Tables.AuditEmailLog} (packet_id, campaign_id, to_addr, cc_addr, subject, kind, success)
                VALUES (@Pid, @Cid, @To, @Cc, @Subject, 'invite', FALSE)",
                new { Pid = packetId, Cid = campaignId, To = p.Email, Cc = Cc(), Subject = req.Name.Trim() + " - your attestation" }, tx);

            result.Packets.Add(new LaunchedPacket
            {
                RecipientSam = p.Sam, RecipientDisplay = p.Display, RecipientEmail = p.Email,
                RecipientKind = p.Kind, SubjectCount = p.Subjects.Count,
                AttestationUrl = _baseUrl + "attest.html?t=" + minted.Raw,
            });
        }

        tx.Commit();
        return result;
    });

    public Task<bool> CloseAsync(int campaignId, string actor) => RunDbAsync(async () =>
        await Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.AuditCampaigns}
            SET status = 'closed', closed_at = NOW()
            WHERE campaign_id = @Id AND status <> 'closed'",
            new { Id = campaignId }) > 0);

    private string? Cc() => string.IsNullOrEmpty(_ccMailbox) ? null : _ccMailbox;
}

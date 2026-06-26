using System.Data;
using Dapper;
using Npgsql;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

/// <summary>
/// Auditing (Surface 09) data access. Slice 1: application registration, AD-group
/// bindings, nominees, and read-only campaign dashboards. Mirrors LicensingService:
/// snake_case SELECT aliases (wire casing is separate, via [JsonPropertyName]),
/// DynamicParameters, one-query children-attach (no N+1), ConflictException -> 409.
/// </summary>
public class AuditingService : BaseService<AuditingService>, IAuditingService
{
    public AuditingService(IDbConnection db, ILogger<AuditingService> logger)
        : base(db, logger) { }

    // An application "belongs" to auditing once it has audit config or an active
    // binding. Estate apps that were never registered (no cadence, no auto-launch,
    // no binding) stay out of the auditing list.
    private const string RegisteredPredicate = @"
        a.is_active
        AND (a.audit_frequency_months IS NOT NULL
             OR a.auto_launch
             OR EXISTS (SELECT 1 FROM auditing.application_groups g
                        WHERE g.application_id = a.application_id AND g.is_active))";

    private const string AppColumns = @"
        a.application_id AS ApplicationId,
        a.application_name AS Name,
        a.business_owner AS BusinessOwner,
        a.technical_owner AS TechnicalOwner,
        a.support_email AS SupportEmail,
        a.audit_frequency_months AS AuditFrequencyMonths,
        a.auto_launch AS AutoLaunch,
        a.audit_routing_mode AS AuditRoutingMode,
        a.audit_due_period_days AS AuditDuePeriodDays,
        (SELECT COUNT(*) FROM auditing.application_groups g
         WHERE g.application_id = a.application_id AND g.is_active) AS BindingCount,
        (SELECT COUNT(*) FROM auditing.application_nominees n
         WHERE n.application_id = a.application_id) AS NomineeCount";

    private const string BindingColumns = @"
        binding_id AS BindingId,
        application_id AS ApplicationId,
        group_dn AS GroupDn,
        group_sam AS GroupSam,
        group_type AS GroupType,
        is_active AS IsActive";

    private const string NomineeColumns = @"
        nominee_id AS NomineeId,
        application_id AS ApplicationId,
        nominee_sam AS NomineeSam,
        nominee_display_name AS NomineeDisplayName,
        nominee_email AS NomineeEmail,
        role_note AS RoleNote";

    // ── Applications ─────────────────────────────────────────────────

    public Task<IEnumerable<AuditApplication>> ListApplicationsAsync(string? search) => RunDbAsync(async () =>
    {
        var sql = $@"
            SELECT {AppColumns}
            FROM {Sql.Tables.Applications} a
            WHERE {RegisteredPredicate}";

        var p = new DynamicParameters();
        if (!string.IsNullOrEmpty(search))
        {
            sql += @" AND a.application_name ILIKE @Search ESCAPE '\'";
            p.Add("Search", $"%{EscapeLike(search)}%");
        }
        sql += " ORDER BY a.application_name";

        return await Db.QueryAsync<AuditApplication>(sql, p);
    });

    public Task<AuditApplicationDetail?> GetApplicationAsync(int id) => RunDbAsync(() => LoadApplicationAsync(id));

    public Task<AuditApplicationDetail> CreateApplicationAsync(AppCreateRequest req, string actor) => RunDbAsync(async () =>
    {
        var id = await TranslateConflict(() => Db.ExecuteScalarAsync<int>($@"
            INSERT INTO {Sql.Tables.Applications}
                (application_name, business_owner, technical_owner, support_email,
                 audit_frequency_months, auto_launch, audit_routing_mode, audit_due_period_days,
                 source_system, is_active)
            VALUES
                (@Name, @BusinessOwner, @TechnicalOwner, @SupportEmail,
                 @AuditFrequencyMonths, COALESCE(@AutoLaunch, FALSE),
                 COALESCE(NULLIF(@AuditRoutingMode, ''), 'line_manager'),
                 COALESCE(@AuditDuePeriodDays, 21),
                 'auditing', TRUE)
            RETURNING application_id",
            new
            {
                req.Name, req.BusinessOwner, req.TechnicalOwner, req.SupportEmail,
                req.AuditFrequencyMonths, req.AutoLaunch, req.AuditRoutingMode, req.AuditDuePeriodDays
            }));

        return (await LoadApplicationAsync(id))!;
    });

    public Task<AuditApplicationDetail?> PatchApplicationAsync(int id, AppPatchRequest req, string actor) => RunDbAsync(async () =>
    {
        var sets = new List<string>();
        var p = new DynamicParameters();
        p.Add("Id", id);

        if (req.BusinessOwner != null) { sets.Add("business_owner = @BusinessOwner"); p.Add("BusinessOwner", req.BusinessOwner); }
        if (req.TechnicalOwner != null) { sets.Add("technical_owner = @TechnicalOwner"); p.Add("TechnicalOwner", req.TechnicalOwner); }
        if (req.SupportEmail != null) { sets.Add("support_email = @SupportEmail"); p.Add("SupportEmail", req.SupportEmail); }
        if (req.AuditFrequencyMonths != null) { sets.Add("audit_frequency_months = @AuditFrequencyMonths"); p.Add("AuditFrequencyMonths", req.AuditFrequencyMonths.Value); }
        if (req.AutoLaunch != null) { sets.Add("auto_launch = @AutoLaunch"); p.Add("AutoLaunch", req.AutoLaunch.Value); }
        if (req.AuditRoutingMode != null) { sets.Add("audit_routing_mode = @AuditRoutingMode"); p.Add("AuditRoutingMode", req.AuditRoutingMode); }
        if (req.AuditDuePeriodDays != null) { sets.Add("audit_due_period_days = @AuditDuePeriodDays"); p.Add("AuditDuePeriodDays", req.AuditDuePeriodDays.Value); }

        if (sets.Count == 0) return await LoadApplicationAsync(id);

        var rows = await Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.Applications}
            SET {string.Join(", ", sets)}
            WHERE application_id = @Id AND is_active", p);

        return rows == 0 ? null : await LoadApplicationAsync(id);
    });

    public Task<bool> DeleteApplicationAsync(int id, string actor) => RunDbAsync(async () =>
    {
        if (Db.State != ConnectionState.Open) Db.Open();
        using var tx = Db.BeginTransaction();

        // Reset audit config to defaults so the app drops out of the registered list.
        var rows = await Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.Applications}
            SET audit_frequency_months = NULL,
                auto_launch = FALSE,
                audit_routing_mode = 'line_manager',
                audit_due_period_days = 21
            WHERE application_id = @Id AND is_active",
            new { Id = id }, tx);

        if (rows == 0)
        {
            tx.Rollback();
            return false;
        }

        await Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.AuditApplicationGroups}
            SET is_active = FALSE, updated_by = @Actor, updated_at = CURRENT_TIMESTAMP
            WHERE application_id = @Id AND is_active",
            new { Id = id, Actor = actor }, tx);

        await Db.ExecuteAsync($@"
            DELETE FROM {Sql.Tables.AuditApplicationNominees} WHERE application_id = @Id",
            new { Id = id }, tx);

        tx.Commit();
        return true;
    });

    // ── Bindings ─────────────────────────────────────────────────────

    public Task<AuditBinding?> AddBindingAsync(int appId, BindingCreateRequest req, string actor) => RunDbAsync(async () =>
    {
        if (!await ApplicationExistsAsync(appId)) return null;

        var bindingId = await TranslateConflictBinding(() => Db.ExecuteScalarAsync<int>($@"
            INSERT INTO {Sql.Tables.AuditApplicationGroups}
                (application_id, group_dn, group_sam, group_type, created_by, updated_by)
            VALUES (@AppId, @GroupDn, @GroupSam, @GroupType, @Actor, @Actor)
            RETURNING binding_id",
            new { AppId = appId, req.GroupDn, req.GroupSam, req.GroupType, Actor = actor }));

        return await Db.QueryFirstOrDefaultAsync<AuditBinding>($@"
            SELECT {BindingColumns} FROM {Sql.Tables.AuditApplicationGroups} WHERE binding_id = @Id",
            new { Id = bindingId });
    });

    public Task<bool> RemoveBindingAsync(int appId, int bindingId, string actor) => RunDbAsync(async () =>
        await Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.AuditApplicationGroups}
            SET is_active = FALSE, updated_by = @Actor, updated_at = CURRENT_TIMESTAMP
            WHERE binding_id = @BindingId AND application_id = @AppId AND is_active",
            new { BindingId = bindingId, AppId = appId, Actor = actor }) > 0);

    // ── Nominees ─────────────────────────────────────────────────────

    public Task<AuditNominee?> AddNomineeAsync(int appId, NomineeCreateRequest req, string actor) => RunDbAsync(async () =>
    {
        if (!await ApplicationExistsAsync(appId)) return null;

        var nomineeId = await TranslateConflictNominee(() => Db.ExecuteScalarAsync<int>($@"
            INSERT INTO {Sql.Tables.AuditApplicationNominees}
                (application_id, nominee_sam, nominee_display_name, nominee_email, role_note, added_by)
            VALUES (@AppId, @NomineeSam, @NomineeDisplayName, @NomineeEmail, @RoleNote, @Actor)
            RETURNING nominee_id",
            new { AppId = appId, req.NomineeSam, req.NomineeDisplayName, req.NomineeEmail, req.RoleNote, Actor = actor }));

        return await Db.QueryFirstOrDefaultAsync<AuditNominee>($@"
            SELECT {NomineeColumns} FROM {Sql.Tables.AuditApplicationNominees} WHERE nominee_id = @Id",
            new { Id = nomineeId });
    });

    public Task<bool> RemoveNomineeAsync(int appId, int nomineeId) => RunDbAsync(async () =>
        await Db.ExecuteAsync($@"
            DELETE FROM {Sql.Tables.AuditApplicationNominees}
            WHERE nominee_id = @NomineeId AND application_id = @AppId",
            new { NomineeId = nomineeId, AppId = appId }) > 0);

    // ── Campaigns (read-only) ────────────────────────────────────────

    private const string CampaignColumns = @"
        c.campaign_id AS CampaignId,
        c.application_id AS ApplicationId,
        a.application_name AS ApplicationName,
        c.name AS Name,
        c.status AS Status,
        c.due_at AS DueAt,
        c.created_by AS CreatedBy,
        c.created_at AS CreatedAt,
        c.closed_at AS ClosedAt,
        c.closed_by_packet_id AS ClosedByPacketId,
        c.launch_kind AS LaunchKind,
        c.routing_mode AS RoutingMode,
        c.closure_mode AS ClosureMode,
        c.cc_audit_mailbox AS CcAuditMailbox,
        (SELECT COUNT(*) FROM auditing.attestation_packets p WHERE p.campaign_id = c.campaign_id) AS PacketCount,
        (SELECT COUNT(*) FROM auditing.attestation_packets p
         WHERE p.campaign_id = c.campaign_id AND p.submitted_at IS NOT NULL) AS SubmittedCount";

    public Task<IEnumerable<AuditCampaign>> ListCampaignsAsync() => RunDbAsync(async () =>
        await Db.QueryAsync<AuditCampaign>($@"
            SELECT {CampaignColumns}
            FROM {Sql.Tables.AuditCampaigns} c
            JOIN {Sql.Tables.Applications} a ON a.application_id = c.application_id
            ORDER BY (c.status = 'active') DESC, COALESCE(c.closed_at, c.created_at) DESC"));

    public Task<AuditCampaignDetail?> GetCampaignAsync(int id) => RunDbAsync(async () =>
    {
        var detail = await Db.QueryFirstOrDefaultAsync<AuditCampaignDetail>($@"
            SELECT {CampaignColumns}
            FROM {Sql.Tables.AuditCampaigns} c
            JOIN {Sql.Tables.Applications} a ON a.application_id = c.application_id
            WHERE c.campaign_id = @Id",
            new { Id = id });

        if (detail == null) return null;

        var packets = (await Db.QueryAsync<AuditPacket>($@"
            SELECT
                packet_id AS PacketId,
                campaign_id AS CampaignId,
                recipient_sam AS RecipientSam,
                recipient_display_name AS RecipientDisplay,
                recipient_email AS RecipientEmail,
                recipient_kind AS RecipientKind,
                role_note AS RoleNote,
                token_expires_at AS TokenExpiresAt,
                submitted_at AS SubmittedAt,
                submitted_by_sam AS SubmittedBySam,
                submitted_by_display AS SubmittedByDisplay,
                reminder_sent_at AS ReminderSentAt
            FROM {Sql.Tables.AuditPackets}
            WHERE campaign_id = @Id
            ORDER BY recipient_display_name, recipient_sam",
            new { Id = id })).ToList();

        if (packets.Count > 0)
        {
            var packetIds = packets.Select(p => p.PacketId).ToArray();

            var subjects = await Db.QueryAsync<(Guid PacketId, string SubjectSam, string? SubjectDisplay)>($@"
                SELECT packet_id AS PacketId, subject_sam AS SubjectSam, subject_display_name AS SubjectDisplay
                FROM {Sql.Tables.AuditPacketSubjects}
                WHERE packet_id = ANY(@Ids)
                ORDER BY subject_display_name, subject_sam",
                new { Ids = packetIds });

            var subjectsByPacket = subjects
                .GroupBy(s => s.PacketId)
                .ToDictionary(g => g.Key,
                    g => g.Select(s => new AuditPacketSubject { SubjectSam = s.SubjectSam, SubjectDisplay = s.SubjectDisplay }).ToList());

            foreach (var pk in packets)
                pk.Subjects = subjectsByPacket.TryGetValue(pk.PacketId, out var subs) ? subs : new List<AuditPacketSubject>();

            detail.Decisions = (await Db.QueryAsync<AuditDecision>($@"
                SELECT
                    packet_id AS PacketId,
                    subject_sam AS SubjectSam,
                    subject_display AS SubjectDisplay,
                    decision AS Decision,
                    comment AS Comment
                FROM {Sql.Tables.AuditDecisions}
                WHERE packet_id = ANY(@Ids)",
                new { Ids = packetIds })).ToList();
        }

        detail.Packets = packets;

        detail.EmailLog = (await Db.QueryAsync<AuditEmailLog>($@"
            SELECT
                log_id AS LogId,
                packet_id AS PacketId,
                campaign_id AS CampaignId,
                to_addr AS ToAddr,
                cc_addr AS CcAddr,
                subject AS Subject,
                kind AS Kind,
                sent_at AS SentAt,
                success AS Success
            FROM {Sql.Tables.AuditEmailLog}
            WHERE campaign_id = @Id
            ORDER BY sent_at",
            new { Id = id })).ToList();

        return detail;
    });

    // ── Helpers ──────────────────────────────────────────────────────

    private async Task<bool> ApplicationExistsAsync(int id)
        => await Db.ExecuteScalarAsync<bool>($@"
            SELECT EXISTS (SELECT 1 FROM {Sql.Tables.Applications} WHERE application_id = @Id AND is_active)",
            new { Id = id });

    private async Task<AuditApplicationDetail?> LoadApplicationAsync(int id)
    {
        var detail = await Db.QueryFirstOrDefaultAsync<AuditApplicationDetail>($@"
            SELECT {AppColumns}
            FROM {Sql.Tables.Applications} a
            WHERE a.application_id = @Id AND a.is_active",
            new { Id = id });

        if (detail == null) return null;

        detail.Bindings = (await Db.QueryAsync<AuditBinding>($@"
            SELECT {BindingColumns}
            FROM {Sql.Tables.AuditApplicationGroups}
            WHERE application_id = @Id AND is_active
            ORDER BY group_dn",
            new { Id = id })).ToList();

        detail.Nominees = (await Db.QueryAsync<AuditNominee>($@"
            SELECT {NomineeColumns}
            FROM {Sql.Tables.AuditApplicationNominees}
            WHERE application_id = @Id
            ORDER BY nominee_display_name, nominee_sam",
            new { Id = id })).ToList();

        return detail;
    }

    // Unique application_name (shared.applications) -> 409 on create.
    private static async Task<T> TranslateConflict<T>(Func<Task<T>> op)
    {
        try { return await op(); }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            throw new ConflictException("An application with this name already exists.");
        }
    }

    // Partial-unique idx_app_group_active -> 409 when an active binding for the
    // same group already exists on the application.
    private static async Task<T> TranslateConflictBinding<T>(Func<Task<T>> op)
    {
        try { return await op(); }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            throw new ConflictException("That group is already bound to this application.");
        }
    }

    // Unique (application_id, nominee_sam) -> 409 on duplicate nominee.
    private static async Task<T> TranslateConflictNominee<T>(Func<Task<T>> op)
    {
        try { return await op(); }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            throw new ConflictException("That person is already a nominee for this application.");
        }
    }
}

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
        COALESCE(a.business_owner_display,
                 (SELECT u.display_name FROM auditing.ad_users u WHERE u.sam_account = a.business_owner)) AS BusinessOwnerDisplay,
        a.technical_owner AS TechnicalOwner,
        COALESCE(a.technical_owner_display,
                 (SELECT u.display_name FROM auditing.ad_users u WHERE u.sam_account = a.technical_owner)) AS TechnicalOwnerDisplay,
        a.support_email AS SupportEmail,
        a.audit_frequency_months AS AuditFrequencyMonths,
        a.auto_launch AS AutoLaunch,
        a.audit_routing_mode AS AuditRoutingMode,
        a.audit_due_period_days AS AuditDuePeriodDays,
        a.audit_status AS AuditStatus,
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
                (application_name, business_owner, business_owner_display,
                 technical_owner, technical_owner_display, support_email,
                 audit_frequency_months, auto_launch, audit_routing_mode, audit_due_period_days,
                 source_system, is_active)
            VALUES
                (@Name, @BusinessOwner, @BusinessOwnerDisplay,
                 @TechnicalOwner, @TechnicalOwnerDisplay, @SupportEmail,
                 @AuditFrequencyMonths, COALESCE(@AutoLaunch, FALSE),
                 COALESCE(NULLIF(@AuditRoutingMode, ''), 'line_manager'),
                 COALESCE(@AuditDuePeriodDays, 21),
                 'auditing', TRUE)
            RETURNING application_id",
            new
            {
                req.Name, req.BusinessOwner, req.BusinessOwnerDisplay,
                req.TechnicalOwner, req.TechnicalOwnerDisplay, req.SupportEmail,
                req.AuditFrequencyMonths, req.AutoLaunch, req.AuditRoutingMode, req.AuditDuePeriodDays
            }));

        return (await LoadApplicationAsync(id))!;
    });

    public Task<AuditApplicationDetail?> PatchApplicationAsync(int id, AppPatchRequest req, string actor) => RunDbAsync(async () =>
    {
        await GuardNotArchivedAsync(id);

        // Snapshot the current name so a rename can be recorded in the lifecycle log.
        string? oldName = req.Name == null ? null : await Db.ExecuteScalarAsync<string?>(
            $"SELECT application_name FROM {Sql.Tables.Applications} WHERE application_id = @Id AND is_active", new { Id = id });

        var sets = new List<string>();
        var p = new DynamicParameters();
        p.Add("Id", id);

        if (req.Name != null) { sets.Add("application_name = @Name"); p.Add("Name", req.Name); }
        if (req.BusinessOwner != null) { sets.Add("business_owner = @BusinessOwner"); p.Add("BusinessOwner", req.BusinessOwner); }
        if (req.BusinessOwnerDisplay != null) { sets.Add("business_owner_display = @BusinessOwnerDisplay"); p.Add("BusinessOwnerDisplay", req.BusinessOwnerDisplay); }
        if (req.TechnicalOwner != null) { sets.Add("technical_owner = @TechnicalOwner"); p.Add("TechnicalOwner", req.TechnicalOwner); }
        if (req.TechnicalOwnerDisplay != null) { sets.Add("technical_owner_display = @TechnicalOwnerDisplay"); p.Add("TechnicalOwnerDisplay", req.TechnicalOwnerDisplay); }
        if (req.SupportEmail != null) { sets.Add("support_email = @SupportEmail"); p.Add("SupportEmail", req.SupportEmail); }
        if (req.AuditFrequencyMonths != null) { sets.Add("audit_frequency_months = @AuditFrequencyMonths"); p.Add("AuditFrequencyMonths", req.AuditFrequencyMonths.Value); }
        if (req.AutoLaunch != null) { sets.Add("auto_launch = @AutoLaunch"); p.Add("AutoLaunch", req.AutoLaunch.Value); }
        if (req.AuditRoutingMode != null) { sets.Add("audit_routing_mode = @AuditRoutingMode"); p.Add("AuditRoutingMode", req.AuditRoutingMode); }
        if (req.AuditDuePeriodDays != null) { sets.Add("audit_due_period_days = @AuditDuePeriodDays"); p.Add("AuditDuePeriodDays", req.AuditDuePeriodDays.Value); }

        if (sets.Count == 0) return await LoadApplicationAsync(id);

        // Renaming to an existing application_name trips the UNIQUE constraint -> 409.
        var rows = await TranslateConflict(() => Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.Applications}
            SET {string.Join(", ", sets)}
            WHERE application_id = @Id AND is_active", p));

        if (rows == 0) return null;
        if (req.Name != null && oldName != null && !string.Equals(oldName, req.Name, StringComparison.Ordinal))
            await TryLogLifecycleAsync(id, req.Name, "renamed", actor, $"'{oldName}' -> '{req.Name}'");
        return await LoadApplicationAsync(id);
    });

    public Task<AuditApplicationDetail?> ArchiveApplicationAsync(int id, string actor) => RunDbAsync(async () =>
    {
        if (await HasOpenCampaignAsync(id))
            throw new ConflictException("This application has an open campaign. Close it before archiving.");

        var rows = await Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.Applications}
            SET audit_status = 'archived'
            WHERE application_id = @Id AND is_active",
            new { Id = id });

        if (rows == 0) return null;
        var detail = await LoadApplicationAsync(id);
        await TryLogLifecycleAsync(id, detail?.Name, "archived", actor, null);
        return detail;
    });

    public Task<AuditApplicationDetail?> RestoreApplicationAsync(int id, string actor) => RunDbAsync(async () =>
    {
        // Only an actually-archived app can be restored. Without the audit_status
        // guard, restoring a never-archived app matched the row, returned success,
        // and wrote a spurious 'restored' lifecycle entry.
        var rows = await Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.Applications}
            SET audit_status = 'active'
            WHERE application_id = @Id AND is_active AND audit_status = 'archived'",
            new { Id = id });

        if (rows == 0) return null;
        var detail = await LoadApplicationAsync(id);
        await TryLogLifecycleAsync(id, detail?.Name, "restored", actor, null);
        return detail;
    });

    // True when the app has a campaign that isn't yet closed -- blocks archive + delete.
    private Task<bool> HasOpenCampaignAsync(int id) => Db.ExecuteScalarAsync<bool>($@"
        SELECT EXISTS (SELECT 1 FROM {Sql.Tables.AuditCampaigns}
                       WHERE application_id = @Id AND status IN ('active', 'draft'))",
        new { Id = id });

    public Task<bool> DeleteApplicationAsync(int id, string actor) => RunDbAsync(async () =>
    {
        if (await HasOpenCampaignAsync(id))
            throw new ConflictException("This application has an open campaign. Close it before deleting.");

        // Snapshot the name for the lifecycle log (survives a hard delete).
        var appName = await Db.ExecuteScalarAsync<string?>($@"
            SELECT application_name FROM {Sql.Tables.Applications} WHERE application_id = @Id AND is_active",
            new { Id = id });
        if (appName == null) return false; // not found / already inactive

        // Hard-delete is only safe when nothing outside auditing references the row
        // (auditing.campaigns / licensing.licences / shared.servers have no ON DELETE
        // CASCADE). When the app was created by auditing and has no such references,
        // drop it outright so re-adding the same name later doesn't 409. Otherwise
        // fall back to the soft unregister, preserving the shared row + its history.
        var canHardDelete = await Db.ExecuteScalarAsync<bool>($@"
            SELECT EXISTS (
                SELECT 1 FROM {Sql.Tables.Applications} a
                WHERE a.application_id = @Id
                  AND a.is_active
                  AND a.source_system = 'auditing'
                  AND NOT EXISTS (SELECT 1 FROM {Sql.Tables.AuditCampaigns} c WHERE c.application_id = a.application_id)
                  AND NOT EXISTS (SELECT 1 FROM {Sql.Tables.Licences} l WHERE l.application_id = a.application_id)
                  AND NOT EXISTS (SELECT 1 FROM {Sql.Tables.Servers} s WHERE s.primary_application_id = a.application_id))",
            new { Id = id });

        bool ok;
        string action, detail;
        if (canHardDelete)
        {
            try
            {
                ok = await HardDeleteAppAsync(id);
                action = "deleted"; detail = "hard delete (no history)";
            }
            catch (PostgresException ex)
            {
                // Any DB-level problem with the hard delete (an unanticipated referrer,
                // etc.) -> preserve the row via a soft unregister instead of surfacing a 500.
                Logger.LogWarning(ex, "Hard delete of app {AppId} failed ({SqlState}); soft-unregistering instead.", id, ex.SqlState);
                ok = await SoftUnregisterAppAsync(id, actor);
                action = "unregistered"; detail = "soft delete (hard delete failed)";
            }
        }
        else
        {
            ok = await SoftUnregisterAppAsync(id, actor);
            action = "unregistered"; detail = "soft delete (history preserved)";
        }

        // Best-effort audit trail -- a logging failure must never turn a successful delete
        // into a 500 (e.g. if the lifecycle-log table lags a deploy).
        if (ok) await TryLogLifecycleAsync(id, appName, action, actor, detail);
        return ok;
    });

    private async Task<bool> HardDeleteAppAsync(int id)
    {
        if (Db.State != ConnectionState.Open) Db.Open();
        using var tx = Db.BeginTransaction();
        // CASCADE clears application_groups / application_nominees / auto_launch_log.
        var deleted = await Db.ExecuteAsync($@"
            DELETE FROM {Sql.Tables.Applications} WHERE application_id = @Id",
            new { Id = id }, tx);
        tx.Commit();
        return deleted > 0;
    }

    private async Task<bool> SoftUnregisterAppAsync(int id, string actor)
    {
        if (Db.State != ConnectionState.Open) Db.Open();
        using var tx = Db.BeginTransaction();
        // Reset audit config to defaults so the app drops out of the registered list.
        var rows = await Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.Applications}
            SET audit_frequency_months = NULL,
                auto_launch = FALSE,
                audit_routing_mode = 'line_manager',
                audit_due_period_days = 21,
                audit_status = 'active'
            WHERE application_id = @Id AND is_active",
            new { Id = id }, tx);
        if (rows == 0) { tx.Rollback(); return false; }

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
    }

    private async Task TryLogLifecycleAsync(int appId, string? appName, string action, string actor, string? detail)
    {
        try { await LogLifecycleAsync(appId, appName, action, actor, detail); }
        catch (Exception ex) { Logger.LogWarning(ex, "Auditing lifecycle log write failed for app {AppId} ({Action}).", appId, action); }
    }

    // ── Bindings ─────────────────────────────────────────────────────

    public Task<AuditBinding?> AddBindingAsync(int appId, BindingCreateRequest req, string actor) => RunDbAsync(async () =>
    {
        if (!await ApplicationExistsAsync(appId)) return null;
        await GuardNotArchivedAsync(appId);

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
    {
        await GuardNotArchivedAsync(appId);
        return await Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.AuditApplicationGroups}
            SET is_active = FALSE, updated_by = @Actor, updated_at = CURRENT_TIMESTAMP
            WHERE binding_id = @BindingId AND application_id = @AppId AND is_active",
            new { BindingId = bindingId, AppId = appId, Actor = actor }) > 0;
    });

    // ── Nominees ─────────────────────────────────────────────────────

    public Task<AuditNominee?> AddNomineeAsync(int appId, NomineeCreateRequest req, string actor) => RunDbAsync(async () =>
    {
        if (!await ApplicationExistsAsync(appId)) return null;
        await GuardNotArchivedAsync(appId);

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

    public Task<bool> RemoveNomineeAsync(int appId, int nomineeId, string actor) => RunDbAsync(async () =>
    {
        await GuardNotArchivedAsync(appId);

        // Capture who is being removed before the delete so the removal can be
        // attributed in the lifecycle log. Nominees are pre-launch config and a
        // launched campaign snapshots its own recipients, so a hard delete is fine
        // here -- but it must not be unattributed (mirrors RemoveBindingAsync).
        var nomineeSam = await Db.ExecuteScalarAsync<string?>($@"
            SELECT nominee_sam FROM {Sql.Tables.AuditApplicationNominees}
            WHERE nominee_id = @NomineeId AND application_id = @AppId",
            new { NomineeId = nomineeId, AppId = appId });

        var removed = await Db.ExecuteAsync($@"
            DELETE FROM {Sql.Tables.AuditApplicationNominees}
            WHERE nominee_id = @NomineeId AND application_id = @AppId",
            new { NomineeId = nomineeId, AppId = appId }) > 0;

        if (removed)
        {
            var appName = await Db.ExecuteScalarAsync<string?>($@"
                SELECT application_name FROM {Sql.Tables.Applications} WHERE application_id = @AppId",
                new { AppId = appId });
            await TryLogLifecycleAsync(appId, appName, "nominee_removed", actor,
                nomineeSam is null ? $"nominee #{nomineeId}" : $"nominee '{nomineeSam}' (#{nomineeId})");
        }
        return removed;
    });

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

    // ── Public attestation (anonymous, token-gated) ──────────────────

    private sealed class AttestationPacketRow
    {
        public Guid PacketId { get; set; }
        public int CampaignId { get; set; }
        public string RecipientSam { get; set; } = "";
        public string? RecipientDisplay { get; set; }
        public string RecipientKind { get; set; } = "manager";
        public string? RoleNote { get; set; }
        public byte[]? TokenHash { get; set; }
        public DateTime? SubmittedAt { get; set; }
        public string? SubmittedByDisplay { get; set; }
        public string CampaignName { get; set; } = "";
        public string CampaignStatus { get; set; } = "";
        public string RoutingMode { get; set; } = "line_manager";
        public string ClosureMode { get; set; } = "all_packets";
        public DateTime? DueAt { get; set; }
        public string? CcAuditMailbox { get; set; }
        public string? ApplicationName { get; set; }
    }

    private sealed class ClosingPacket
    {
        public Guid PacketId { get; set; }
        public string? SubmittedByDisplay { get; set; }
        public DateTime? SubmittedAt { get; set; }
    }

    private const string AttestPacketColumns = @"
        p.packet_id AS PacketId,
        p.campaign_id AS CampaignId,
        p.recipient_sam AS RecipientSam,
        p.recipient_display_name AS RecipientDisplay,
        p.recipient_kind AS RecipientKind,
        p.role_note AS RoleNote,
        p.token_hash AS TokenHash,
        p.submitted_at AS SubmittedAt,
        p.submitted_by_display AS SubmittedByDisplay,
        c.name AS CampaignName,
        c.status AS CampaignStatus,
        c.routing_mode AS RoutingMode,
        c.closure_mode AS ClosureMode,
        c.due_at AS DueAt,
        c.cc_audit_mailbox AS CcAuditMailbox,
        a.application_name AS ApplicationName";

    private const string SubjectsSelect = @"
        SELECT s.subject_sam AS SubjectSam, s.subject_display_name AS SubjectDisplay,
               u.email AS SubjectEmail, COALESCE(u.enabled, TRUE) AS Enabled
        FROM auditing.attestation_packet_subjects s
        LEFT JOIN auditing.ad_users u ON u.sam_account = s.subject_sam
        WHERE s.packet_id = @Pid
        ORDER BY s.subject_display_name, s.subject_sam";

    public Task<AttestationGetResult> GetAttestationAsync(Guid packetId, string callerSam) => RunDbAsync(async () =>
    {
        var row = await LoadPacketAsync(packetId, null);
        if (row == null) return new AttestationGetResult { Outcome = AttestationGetOutcome.NotFound };
        if (!SamEquals(row.RecipientSam, callerSam)) return new AttestationGetResult { Outcome = AttestationGetOutcome.Forbidden };
        return new AttestationGetResult { Outcome = AttestationGetOutcome.Ok, View = await BuildViewAsync(row, null) };
    });

    public Task<AttestationSubmitResult> SubmitAttestationAsync(Guid packetId, string callerSam, List<AttestationDecisionInput> decisions, string? ip) => RunDbAsync(async () =>
    {
        if (Db.State != ConnectionState.Open) Db.Open();
        using var tx = Db.BeginTransaction();

        var row = await LoadPacketAsync(packetId, tx);
        if (row == null) { tx.Rollback(); return new AttestationSubmitResult { Outcome = AttestationSubmitOutcome.NotFound }; }

        // SSO identity gate: only the packet's intended recipient may submit.
        if (!SamEquals(row.RecipientSam, callerSam)) { tx.Rollback(); return new AttestationSubmitResult { Outcome = AttestationSubmitOutcome.Forbidden }; }

        // Already done (this packet submitted, or the campaign was closed by another
        // nominee) -> return the read-only view, no write.
        if (row.SubmittedAt != null || row.CampaignStatus == "closed")
        {
            var done = await BuildViewAsync(row, tx);
            tx.Rollback();
            return new AttestationSubmitResult { Outcome = AttestationSubmitOutcome.Conflict, View = done };
        }

        var subjects = (await Db.QueryAsync<AttestationSubject>(SubjectsSelect, new { Pid = row.PacketId }, tx)).ToList();
        var displayBySam = subjects.ToDictionary(s => s.SubjectSam, s => s.SubjectDisplay);

        // One valid decision per subject, no strangers, no duplicates.
        var seen = new HashSet<string>();
        foreach (var d in decisions)
        {
            if (d.Decision is not ("keep" or "revoke")) return Bad(tx, "Each decision must be 'keep' or 'revoke'.");
            if (!displayBySam.ContainsKey(d.SubjectSam)) return Bad(tx, "Decision for an unknown subject.");
            if (!seen.Add(d.SubjectSam)) return Bad(tx, "Duplicate decision for a subject.");
        }
        if (seen.Count != subjects.Count) return Bad(tx, "A decision is required for every subject.");

        // Claim the packet atomically. Losing the race -> 0 rows -> conflict.
        var claimed = await Db.ExecuteAsync($@"
            UPDATE {Sql.Tables.AuditPackets}
            SET submitted_at = NOW(), submitted_by_sam = @Sam, submitted_by_display = @Disp, submitted_ip = @Ip::inet
            WHERE packet_id = @Pid AND submitted_at IS NULL",
            new { Pid = row.PacketId, Sam = callerSam, Disp = row.RecipientDisplay, Ip = ip }, tx);

        if (claimed == 0)
        {
            var fresh = await LoadPacketAsync(row.PacketId, tx);
            var view = fresh != null ? await BuildViewAsync(fresh, tx) : null;
            tx.Rollback();
            return new AttestationSubmitResult { Outcome = AttestationSubmitOutcome.Conflict, View = view };
        }

        foreach (var d in decisions)
        {
            await Db.ExecuteAsync($@"
                INSERT INTO {Sql.Tables.AuditDecisions} (packet_id, subject_sam, subject_display, decision, comment)
                VALUES (@Pid, @Sam, @Disp, @Decision, @Comment)",
                new { Pid = row.PacketId, Sam = d.SubjectSam, Disp = displayBySam[d.SubjectSam], d.Decision,
                      Comment = string.IsNullOrWhiteSpace(d.Comment) ? null : d.Comment.Trim() }, tx);
        }

        // Closure: any_packet closes on first submit; all_packets when the last lands.
        if (row.ClosureMode == "any_packet")
        {
            await Db.ExecuteAsync($@"
                UPDATE {Sql.Tables.AuditCampaigns}
                SET status = 'closed', closed_at = NOW(), closed_by_packet_id = @Pid
                WHERE campaign_id = @Cid AND status = 'active'",
                new { Pid = row.PacketId, Cid = row.CampaignId }, tx);
        }
        else
        {
            await Db.ExecuteAsync($@"
                UPDATE {Sql.Tables.AuditCampaigns}
                SET status = 'closed', closed_at = NOW()
                WHERE campaign_id = @Cid AND status = 'active'
                  AND NOT EXISTS (SELECT 1 FROM {Sql.Tables.AuditPackets}
                                  WHERE campaign_id = @Cid AND submitted_at IS NULL)",
                new { Cid = row.CampaignId }, tx);
        }

        tx.Commit();

        var after = await LoadPacketAsync(row.PacketId, null);
        return new AttestationSubmitResult
        {
            Outcome = AttestationSubmitOutcome.Ok,
            View = after != null ? await BuildViewAsync(after, null) : null
        };
    });

    private static AttestationSubmitResult Bad(IDbTransaction tx, string msg)
    {
        tx.Rollback();
        return new AttestationSubmitResult { Outcome = AttestationSubmitOutcome.BadRequest, Error = msg };
    }

    // Case-insensitive sAMAccountName compare. callerSam arrives already normalised
    // (bare sam) from the controller; recipient_sam is the AD sAMAccountName.
    private static bool SamEquals(string? recipientSam, string? callerSam)
        => !string.IsNullOrEmpty(recipientSam) && !string.IsNullOrEmpty(callerSam)
           && string.Equals(recipientSam, callerSam, StringComparison.OrdinalIgnoreCase);

    private Task<AttestationPacketRow?> LoadPacketAsync(Guid packetId, IDbTransaction? tx)
        => Db.QueryFirstOrDefaultAsync<AttestationPacketRow>($@"
            SELECT {AttestPacketColumns}
            FROM {Sql.Tables.AuditPackets} p
            JOIN {Sql.Tables.AuditCampaigns} c ON c.campaign_id = p.campaign_id
            JOIN {Sql.Tables.Applications} a ON a.application_id = c.application_id
            WHERE p.packet_id = @Pid",
            new { Pid = packetId }, tx);

    private async Task<AttestationView> BuildViewAsync(AttestationPacketRow row, IDbTransaction? tx)
    {
        var view = new AttestationView
        {
            CampaignName = row.CampaignName,
            ApplicationName = row.ApplicationName,
            RoutingMode = row.RoutingMode,
            ClosureMode = row.ClosureMode,
            DueAt = row.DueAt,
            CcAuditMailbox = row.CcAuditMailbox,
            RecipientDisplay = row.RecipientDisplay,
            RecipientKind = row.RecipientKind,
            RoleNote = row.RoleNote,
            Subjects = (await Db.QueryAsync<AttestationSubject>(SubjectsSelect, new { Pid = row.PacketId }, tx)).ToList(),
        };

        var decisionPacketId = row.PacketId;
        if (row.SubmittedAt != null)
        {
            view.State = "submitted";
            view.SubmittedByDisplay = row.SubmittedByDisplay;
            view.SubmittedAt = row.SubmittedAt;
        }
        else if (row.CampaignStatus == "closed" && row.ClosureMode == "any_packet")
        {
            var closing = await Db.QueryFirstOrDefaultAsync<ClosingPacket>($@"
                SELECT packet_id AS PacketId, submitted_by_display AS SubmittedByDisplay, submitted_at AS SubmittedAt
                FROM {Sql.Tables.AuditPackets}
                WHERE campaign_id = @Cid AND submitted_at IS NOT NULL
                ORDER BY submitted_at LIMIT 1",
                new { Cid = row.CampaignId }, tx);
            if (closing != null)
            {
                view.State = "closed_by_other";
                view.SubmittedByDisplay = closing.SubmittedByDisplay;
                view.SubmittedAt = closing.SubmittedAt;
                decisionPacketId = closing.PacketId;
            }
        }

        if (view.State != "pending")
        {
            view.Decisions = (await Db.QueryAsync<AttestationDecisionView>($@"
                SELECT subject_sam AS SubjectSam, decision AS Decision, comment AS Comment
                FROM {Sql.Tables.AuditDecisions}
                WHERE packet_id = @Pid",
                new { Pid = decisionPacketId }, tx)).ToList();
        }

        return view;
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private async Task<bool> ApplicationExistsAsync(int id)
        => await Db.ExecuteScalarAsync<bool>($@"
            SELECT EXISTS (SELECT 1 FROM {Sql.Tables.Applications} WHERE application_id = @Id AND is_active)",
            new { Id = id });

    // Archived apps are a read-only register -- block binding/nominee/config edits
    // (defence-in-depth; the UI already hides the controls). Restore to edit again.
    private async Task GuardNotArchivedAsync(int id)
    {
        var archived = await Db.ExecuteScalarAsync<bool>($@"
            SELECT EXISTS (SELECT 1 FROM {Sql.Tables.Applications}
                           WHERE application_id = @Id AND is_active AND audit_status = 'archived')",
            new { Id = id });
        if (archived) throw new ConflictException("This application is archived. Restore it before editing.");
    }

    // Append a lifecycle record (archived / restored / deleted / unregistered /
    // renamed). application_name is snapshotted so a hard-delete's record stays
    // readable. Pass tx when logging inside the delete transaction.
    private Task LogLifecycleAsync(int appId, string? appName, string action, string actor, string? detail, IDbTransaction? tx = null)
        => Db.ExecuteAsync($@"
            INSERT INTO {Sql.Tables.AuditLifecycleLog} (application_id, application_name, action, actor, detail)
            VALUES (@AppId, @AppName, @Action, @Actor, @Detail)",
            new { AppId = appId, AppName = appName, Action = action, Actor = actor, Detail = detail }, tx);

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

        await AttachGroupRostersAsync(detail.Bindings);

        // enabled comes from the AD sync when the nominee is a synced user; a nominee who
        // isn't a synced group member has no ad_users row, so default TRUE (the AD picker
        // only returns enabled accounts, so an unsynced nominee was enabled when added --
        // "no record" must NOT read as "disabled in AD").
        detail.Nominees = (await Db.QueryAsync<AuditNominee>($@"
            SELECT n.nominee_id AS NomineeId,
                   n.application_id AS ApplicationId,
                   n.nominee_sam AS NomineeSam,
                   n.nominee_display_name AS NomineeDisplayName,
                   n.nominee_email AS NomineeEmail,
                   n.role_note AS RoleNote,
                   COALESCE(u.enabled, TRUE) AS Enabled
            FROM {Sql.Tables.AuditApplicationNominees} n
            LEFT JOIN auditing.ad_users u ON u.sam_account = n.nominee_sam
            WHERE n.application_id = @Id
            ORDER BY n.nominee_display_name, n.nominee_sam",
            new { Id = id })).ToList();

        // Freshest membership sync across the app's bound groups (null = never synced).
        detail.RostersSyncedAt = await Db.ExecuteScalarAsync<DateTime?>($@"
            SELECT MAX(m.synced_at)
            FROM auditing.group_memberships m
            JOIN {Sql.Tables.AuditApplicationGroups} g ON g.group_dn = m.group_dn
            WHERE g.application_id = @Id AND g.is_active",
            new { Id = id });

        return detail;
    }

    // Attach the live AD membership + owners (from the auditing_ad_sync tables)
    // to each active binding so the app-detail page shows the real roster, not
    // the demo fixture. Two batched queries keyed by the bindings' DNs -- no N+1.
    private async Task AttachGroupRostersAsync(IReadOnlyCollection<AuditBinding> bindings)
    {
        if (bindings.Count == 0) return;
        var dns = bindings.Select(b => b.GroupDn).Distinct().ToArray();

        var members = (await Db.QueryAsync<GroupMemberRow>(@"
            SELECT m.group_dn AS GroupDn,
                   m.sam_account AS SamAccount,
                   COALESCE(u.display_name, m.sam_account) AS DisplayName,
                   u.email AS Email,
                   COALESCE(u.enabled, TRUE) AS Enabled,
                   u.manager_sam AS ManagerSam
            FROM auditing.group_memberships m
            LEFT JOIN auditing.ad_users u ON u.sam_account = m.sam_account
            WHERE m.group_dn = ANY(@Dns)
            ORDER BY COALESCE(u.display_name, m.sam_account), m.sam_account",
            new { Dns = dns })).ToList();

        var owners = (await Db.QueryAsync<GroupOwnerRow>(@"
            SELECT group_dn AS GroupDn,
                   owner_sam AS OwnerSam,
                   owner_display_name AS OwnerDisplayName,
                   owner_email AS OwnerEmail,
                   source AS Source
            FROM auditing.group_owners
            WHERE group_dn = ANY(@Dns)
            ORDER BY COALESCE(owner_display_name, owner_sam), owner_sam",
            new { Dns = dns })).ToList();

        var membersByDn = members.GroupBy(m => m.GroupDn).ToDictionary(g => g.Key,
            g => g.Select(m => new AuditGroupMember
            {
                SamAccount = m.SamAccount, DisplayName = m.DisplayName, Email = m.Email,
                Enabled = m.Enabled, ManagerSam = m.ManagerSam,
            }).ToList());

        var ownersByDn = owners.GroupBy(o => o.GroupDn).ToDictionary(g => g.Key,
            g => g.Select(o => new AuditGroupOwner
            {
                OwnerSam = o.OwnerSam, OwnerDisplayName = o.OwnerDisplayName,
                OwnerEmail = o.OwnerEmail, Source = o.Source,
            }).ToList());

        foreach (var b in bindings)
        {
            if (membersByDn.TryGetValue(b.GroupDn, out var m)) b.Members = m;
            if (ownersByDn.TryGetValue(b.GroupDn, out var o)) b.Owners = o;
        }
    }

    private sealed class GroupMemberRow
    {
        public string GroupDn { get; set; } = "";
        public string SamAccount { get; set; } = "";
        public string? DisplayName { get; set; }
        public string? Email { get; set; }
        public bool Enabled { get; set; }
        public string? ManagerSam { get; set; }
    }

    private sealed class GroupOwnerRow
    {
        public string GroupDn { get; set; } = "";
        public string OwnerSam { get; set; } = "";
        public string? OwnerDisplayName { get; set; }
        public string? OwnerEmail { get; set; }
        public string? Source { get; set; }
    }

    // Per-constraint 409 messages; the shared catch lives in BaseService.TranslateUniqueViolation.
    // Unique application_name (shared.applications) -> 409 on create.
    private static Task<T> TranslateConflict<T>(Func<Task<T>> op)
        => TranslateUniqueViolation(op, "An application with this name already exists.");

    // Partial-unique idx_app_group_active -> 409 when an active binding for the same group exists.
    private static Task<T> TranslateConflictBinding<T>(Func<Task<T>> op)
        => TranslateUniqueViolation(op, "That group is already bound to this application.");

    // Unique (application_id, nominee_sam) -> 409 on duplicate nominee.
    private static Task<T> TranslateConflictNominee<T>(Func<Task<T>> op)
        => TranslateUniqueViolation(op, "That person is already a nominee for this application.");
}

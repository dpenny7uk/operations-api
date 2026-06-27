using System.Text.Json.Serialization;

namespace OperationsApi.Models;

// Auditing (Surface 09) DTOs.
//
// WIRE CASING NOTE: every property carries an explicit [JsonPropertyName] in
// snake_case. The rest of the API serialises camelCase (the System.Text.Json
// default), but the Auditing SPA page (op-pages.js / auditing-demo-data.js) was
// prototyped against snake_case field names. Pinning snake_case here keeps the
// Phase-1 "swap demo data for the real API" change minimal -- the frontend
// helpers read these names unchanged. Same deliberate divergence as Licensing.
//
// One intentional upgrade over the demo contract: packet `subjects` were bare
// sam strings in the fixture; here they are { subject_sam, subject_display }
// objects so the UI can show display names without a second AD lookup.

// ---- Applications ----

/// <summary>An application registered for access auditing (list-row shape).</summary>
public class AuditApplication
{
    [JsonPropertyName("application_id")] public int ApplicationId { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("business_owner")] public string? BusinessOwner { get; set; }
    [JsonPropertyName("technical_owner")] public string? TechnicalOwner { get; set; }
    [JsonPropertyName("support_email")] public string? SupportEmail { get; set; }
    [JsonPropertyName("audit_frequency_months")] public int? AuditFrequencyMonths { get; set; }
    [JsonPropertyName("auto_launch")] public bool AutoLaunch { get; set; }
    [JsonPropertyName("audit_routing_mode")] public string AuditRoutingMode { get; set; } = "line_manager";
    [JsonPropertyName("audit_due_period_days")] public int AuditDuePeriodDays { get; set; }
    [JsonPropertyName("binding_count")] public int BindingCount { get; set; }
    [JsonPropertyName("nominee_count")] public int NomineeCount { get; set; }
}

/// <summary>Application with its embedded bindings + nominees (detail shape).</summary>
public class AuditApplicationDetail : AuditApplication
{
    [JsonPropertyName("bindings")] public List<AuditBinding> Bindings { get; set; } = new();
    [JsonPropertyName("nominees")] public List<AuditNominee> Nominees { get; set; } = new();
}

/// <summary>An AD group binding that gates an application.</summary>
public class AuditBinding
{
    [JsonPropertyName("binding_id")] public int BindingId { get; set; }
    [JsonPropertyName("application_id")] public int ApplicationId { get; set; }
    [JsonPropertyName("group_dn")] public string GroupDn { get; set; } = "";
    [JsonPropertyName("group_sam")] public string? GroupSam { get; set; }
    [JsonPropertyName("group_type")] public string? GroupType { get; set; }
    [JsonPropertyName("is_active")] public bool IsActive { get; set; }
}

/// <summary>A picked attestation recipient (nominees-mode apps).</summary>
public class AuditNominee
{
    [JsonPropertyName("nominee_id")] public int NomineeId { get; set; }
    [JsonPropertyName("application_id")] public int ApplicationId { get; set; }
    [JsonPropertyName("nominee_sam")] public string NomineeSam { get; set; } = "";
    [JsonPropertyName("nominee_display_name")] public string? NomineeDisplayName { get; set; }
    [JsonPropertyName("nominee_email")] public string? NomineeEmail { get; set; }
    [JsonPropertyName("role_note")] public string? RoleNote { get; set; }
}

// ---- Campaigns ----

/// <summary>An attestation campaign (list-row shape, with progress counts).</summary>
public class AuditCampaign
{
    [JsonPropertyName("campaign_id")] public int CampaignId { get; set; }
    [JsonPropertyName("application_id")] public int ApplicationId { get; set; }
    [JsonPropertyName("application_name")] public string? ApplicationName { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "draft";
    [JsonPropertyName("due_at")] public DateTime? DueAt { get; set; }
    [JsonPropertyName("created_by")] public string? CreatedBy { get; set; }
    [JsonPropertyName("created_at")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("closed_at")] public DateTime? ClosedAt { get; set; }
    [JsonPropertyName("closed_by_packet_id")] public Guid? ClosedByPacketId { get; set; }
    [JsonPropertyName("launch_kind")] public string? LaunchKind { get; set; }
    [JsonPropertyName("routing_mode")] public string RoutingMode { get; set; } = "line_manager";
    [JsonPropertyName("closure_mode")] public string ClosureMode { get; set; } = "all_packets";
    [JsonPropertyName("cc_audit_mailbox")] public string? CcAuditMailbox { get; set; }
    [JsonPropertyName("packet_count")] public int PacketCount { get; set; }
    [JsonPropertyName("submitted_count")] public int SubmittedCount { get; set; }
}

/// <summary>Campaign with embedded packets, decisions and email log (detail shape).</summary>
public class AuditCampaignDetail : AuditCampaign
{
    [JsonPropertyName("packets")] public List<AuditPacket> Packets { get; set; } = new();
    [JsonPropertyName("decisions")] public List<AuditDecision> Decisions { get; set; } = new();
    [JsonPropertyName("email_log")] public List<AuditEmailLog> EmailLog { get; set; } = new();
}

/// <summary>One attestation packet (a recipient's slice of a campaign). Dashboard
/// reads never include the raw token -- only the public attestation endpoint does.</summary>
public class AuditPacket
{
    [JsonPropertyName("packet_id")] public Guid PacketId { get; set; }
    [JsonPropertyName("campaign_id")] public int CampaignId { get; set; }
    [JsonPropertyName("recipient_sam")] public string RecipientSam { get; set; } = "";
    [JsonPropertyName("recipient_display")] public string? RecipientDisplay { get; set; }
    [JsonPropertyName("recipient_email")] public string? RecipientEmail { get; set; }
    [JsonPropertyName("recipient_kind")] public string RecipientKind { get; set; } = "manager";
    [JsonPropertyName("role_note")] public string? RoleNote { get; set; }
    [JsonPropertyName("subjects")] public List<AuditPacketSubject> Subjects { get; set; } = new();
    [JsonPropertyName("token_expires_at")] public DateTime? TokenExpiresAt { get; set; }
    [JsonPropertyName("submitted_at")] public DateTime? SubmittedAt { get; set; }
    [JsonPropertyName("submitted_by_sam")] public string? SubmittedBySam { get; set; }
    [JsonPropertyName("submitted_by_display")] public string? SubmittedByDisplay { get; set; }
    [JsonPropertyName("reminder_sent_at")] public DateTime? ReminderSentAt { get; set; }
}

/// <summary>A subject a packet is asking about (snapshot at launch).</summary>
public class AuditPacketSubject
{
    [JsonPropertyName("subject_sam")] public string SubjectSam { get; set; } = "";
    [JsonPropertyName("subject_display")] public string? SubjectDisplay { get; set; }
}

/// <summary>A keep/revoke decision for one subject on one packet.</summary>
public class AuditDecision
{
    [JsonPropertyName("packet_id")] public Guid PacketId { get; set; }
    [JsonPropertyName("subject_sam")] public string SubjectSam { get; set; } = "";
    [JsonPropertyName("subject_display")] public string? SubjectDisplay { get; set; }
    [JsonPropertyName("decision")] public string Decision { get; set; } = "keep";
    [JsonPropertyName("comment")] public string? Comment { get; set; }
}

/// <summary>One logged email send (invite/reminder/closure) for the audit trail.</summary>
public class AuditEmailLog
{
    [JsonPropertyName("log_id")] public int LogId { get; set; }
    [JsonPropertyName("packet_id")] public Guid? PacketId { get; set; }
    [JsonPropertyName("campaign_id")] public int? CampaignId { get; set; }
    [JsonPropertyName("to_addr")] public string? ToAddr { get; set; }
    [JsonPropertyName("cc_addr")] public string? CcAddr { get; set; }
    [JsonPropertyName("subject")] public string? Subject { get; set; }
    [JsonPropertyName("kind")] public string? Kind { get; set; }
    [JsonPropertyName("sent_at")] public DateTime? SentAt { get; set; }
    [JsonPropertyName("success")] public bool Success { get; set; }
}

// ---- Request DTOs (inbound JSON is snake_case -> needs JsonPropertyName too) ----

/// <summary>Register a new application for auditing (Add application form).</summary>
public class AppCreateRequest
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("business_owner")] public string? BusinessOwner { get; set; }
    [JsonPropertyName("technical_owner")] public string? TechnicalOwner { get; set; }
    [JsonPropertyName("support_email")] public string? SupportEmail { get; set; }
    [JsonPropertyName("audit_frequency_months")] public int? AuditFrequencyMonths { get; set; }
    [JsonPropertyName("auto_launch")] public bool? AutoLaunch { get; set; }
    [JsonPropertyName("audit_routing_mode")] public string? AuditRoutingMode { get; set; }
    [JsonPropertyName("audit_due_period_days")] public int? AuditDuePeriodDays { get; set; }
}

/// <summary>Partial update of an application's audit config. Null = unchanged.</summary>
public class AppPatchRequest
{
    [JsonPropertyName("business_owner")] public string? BusinessOwner { get; set; }
    [JsonPropertyName("technical_owner")] public string? TechnicalOwner { get; set; }
    [JsonPropertyName("support_email")] public string? SupportEmail { get; set; }
    [JsonPropertyName("audit_frequency_months")] public int? AuditFrequencyMonths { get; set; }
    [JsonPropertyName("auto_launch")] public bool? AutoLaunch { get; set; }
    [JsonPropertyName("audit_routing_mode")] public string? AuditRoutingMode { get; set; }
    [JsonPropertyName("audit_due_period_days")] public int? AuditDuePeriodDays { get; set; }
}

/// <summary>Add an AD group binding to an application.</summary>
public class BindingCreateRequest
{
    [JsonPropertyName("group_dn")] public string GroupDn { get; set; } = "";
    [JsonPropertyName("group_sam")] public string? GroupSam { get; set; }
    [JsonPropertyName("group_type")] public string? GroupType { get; set; }
}

/// <summary>Add a nominee to a nominees-mode application.</summary>
public class NomineeCreateRequest
{
    [JsonPropertyName("nominee_sam")] public string NomineeSam { get; set; } = "";
    [JsonPropertyName("nominee_display_name")] public string? NomineeDisplayName { get; set; }
    [JsonPropertyName("nominee_email")] public string? NomineeEmail { get; set; }
    [JsonPropertyName("role_note")] public string? RoleNote { get; set; }
}

// ---- Public attestation (Slice 2) ----

/// <summary>The self-contained view the public attest.html page renders from a
/// signed token. state: 'pending' (fill in keep/revoke), 'submitted' (this packet
/// already done), or 'closed_by_other' (a nominee closed the campaign first).</summary>
public class AttestationView
{
    [JsonPropertyName("state")] public string State { get; set; } = "pending";
    [JsonPropertyName("campaign_name")] public string CampaignName { get; set; } = "";
    [JsonPropertyName("application_name")] public string? ApplicationName { get; set; }
    [JsonPropertyName("routing_mode")] public string RoutingMode { get; set; } = "line_manager";
    [JsonPropertyName("closure_mode")] public string ClosureMode { get; set; } = "all_packets";
    [JsonPropertyName("due_at")] public DateTime? DueAt { get; set; }
    [JsonPropertyName("cc_audit_mailbox")] public string? CcAuditMailbox { get; set; }
    [JsonPropertyName("recipient_display")] public string? RecipientDisplay { get; set; }
    [JsonPropertyName("recipient_kind")] public string RecipientKind { get; set; } = "manager";
    [JsonPropertyName("role_note")] public string? RoleNote { get; set; }
    [JsonPropertyName("subjects")] public List<AttestationSubject> Subjects { get; set; } = new();
    [JsonPropertyName("submitted_by_display")] public string? SubmittedByDisplay { get; set; }
    [JsonPropertyName("submitted_at")] public DateTime? SubmittedAt { get; set; }
    [JsonPropertyName("decisions")] public List<AttestationDecisionView> Decisions { get; set; } = new();
}

/// <summary>A subject to attest. email/enabled are current AD attributes (null/true
/// when AD hasn't been synced yet); sam + display are the launch-time snapshot.</summary>
public class AttestationSubject
{
    [JsonPropertyName("subject_sam")] public string SubjectSam { get; set; } = "";
    [JsonPropertyName("subject_display")] public string? SubjectDisplay { get; set; }
    [JsonPropertyName("subject_email")] public string? SubjectEmail { get; set; }
    [JsonPropertyName("enabled")] public bool Enabled { get; set; } = true;
}

/// <summary>A recorded decision, shown read-only once a packet/campaign is submitted.</summary>
public class AttestationDecisionView
{
    [JsonPropertyName("subject_sam")] public string SubjectSam { get; set; } = "";
    [JsonPropertyName("decision")] public string Decision { get; set; } = "keep";
    [JsonPropertyName("comment")] public string? Comment { get; set; }
}

/// <summary>Inbound submit payload (one decision per subject).</summary>
public class AttestationSubmitRequest
{
    [JsonPropertyName("decisions")] public List<AttestationDecisionInput> Decisions { get; set; } = new();
}

public class AttestationDecisionInput
{
    [JsonPropertyName("subject_sam")] public string SubjectSam { get; set; } = "";
    [JsonPropertyName("decision")] public string Decision { get; set; } = "keep";
    [JsonPropertyName("comment")] public string? Comment { get; set; }
}

/// <summary>Service result for a submit attempt, mapped to a status code by the controller.</summary>
public class AttestationSubmitResult
{
    public AttestationSubmitOutcome Outcome { get; set; }
    public AttestationView? View { get; set; }
    public string? Error { get; set; }
}

public enum AttestationSubmitOutcome { Ok, NotFound, Conflict, BadRequest }

// ---- Campaign launch (Slice 3) ----

/// <summary>Launch a campaign for an application. due_at overrides the per-app
/// default window (launched_at + audit_due_period_days) when supplied.</summary>
public class CampaignLaunchRequest
{
    [JsonPropertyName("application_id")] public int ApplicationId { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("due_at")] public DateOnly? DueAt { get; set; }
}

/// <summary>Result of a launch: the campaign + the freshly-minted attestation links.
/// The raw links appear ONCE here (never stored) so an OpsAdmin can distribute them
/// manually until email delivery lands in the email slice.</summary>
public class CampaignLaunchResult
{
    [JsonPropertyName("campaign_id")] public int CampaignId { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("routing_mode")] public string RoutingMode { get; set; } = "";
    [JsonPropertyName("packets")] public List<LaunchedPacket> Packets { get; set; } = new();
}

public class LaunchedPacket
{
    [JsonPropertyName("recipient_sam")] public string RecipientSam { get; set; } = "";
    [JsonPropertyName("recipient_display")] public string? RecipientDisplay { get; set; }
    [JsonPropertyName("recipient_email")] public string? RecipientEmail { get; set; }
    [JsonPropertyName("recipient_kind")] public string RecipientKind { get; set; } = "";
    [JsonPropertyName("subject_count")] public int SubjectCount { get; set; }
    [JsonPropertyName("attestation_url")] public string AttestationUrl { get; set; } = "";
}

// ---- Live AD group search (Slice 5, binding picker) ----

/// <summary>A group returned by the live AD search.</summary>
public class AdGroupResult
{
    [JsonPropertyName("dn")] public string Dn { get; set; } = "";
    [JsonPropertyName("sam")] public string? Sam { get; set; }
    [JsonPropertyName("group_type")] public string? GroupType { get; set; }
}

/// <summary>A user returned by the live AD search (owner / nominee pickers).</summary>
public class AdUserResult
{
    [JsonPropertyName("sam")] public string Sam { get; set; } = "";
    [JsonPropertyName("display")] public string? Display { get; set; }
    [JsonPropertyName("email")] public string? Email { get; set; }
}

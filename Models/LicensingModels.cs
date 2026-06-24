using System.Text.Json.Serialization;

namespace OperationsApi.Models;

// Licensing (Surface 08) DTOs.
//
// WIRE CASING NOTE: every property carries an explicit [JsonPropertyName] in
// snake_case. The rest of the API serialises camelCase (the System.Text.Json
// default), but the Licensing SPA page (op-pages.js / licensing-demo-data.js)
// was prototyped against snake_case field names. Pinning snake_case here keeps
// the Phase-1 "swap demo data for the real API" change minimal -- the frontend
// helpers (getBucket, daysUntilExpiry, fmtStatusFlag, ...) read these names
// unchanged. This is a deliberate, localised divergence from the camelCase norm.

/// <summary>A tracked vendor licence/contract (list-row shape).</summary>
public class Licence
{
    [JsonPropertyName("licence_id")] public int LicenceId { get; set; }
    [JsonPropertyName("application_id")] public int? ApplicationId { get; set; }
    [JsonPropertyName("application_name")] public string? ApplicationName { get; set; }
    [JsonPropertyName("vendor")] public string Vendor { get; set; } = "";
    [JsonPropertyName("product")] public string Product { get; set; } = "";

    // CMDB-mirrored fields (flexible: UI dropdown supplies values, DB has no CHECK).
    [JsonPropertyName("licence_type")] public string? LicenceType { get; set; }
    [JsonPropertyName("quantity_held")] public int? QuantityHeld { get; set; }
    [JsonPropertyName("audit_frequency")] public string? AuditFrequency { get; set; }
    [JsonPropertyName("audit_owner_sam")] public string? AuditOwnerSam { get; set; }

    // ops-api renewal/expiry layer.
    [JsonPropertyName("expires_at")] public DateOnly ExpiresAt { get; set; }
    [JsonPropertyName("notice_period_days")] public int? NoticePeriodDays { get; set; }
    [JsonPropertyName("status_flag")] public string StatusFlag { get; set; } = "tracked";
    [JsonPropertyName("notes")] public string? Notes { get; set; }
}

/// <summary>Licence with audit columns and embedded renewal history (detail shape).</summary>
public class LicenceDetail : Licence
{
    [JsonPropertyName("is_active")] public bool IsActive { get; set; }
    [JsonPropertyName("created_at")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updated_at")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("renewals")] public List<Renewal> Renewals { get; set; } = new();
}

/// <summary>One closed renewal cycle (audit trail / Renewal History panel).</summary>
public class Renewal
{
    [JsonPropertyName("renewal_id")] public int RenewalId { get; set; }
    [JsonPropertyName("licence_id")] public int LicenceId { get; set; }
    [JsonPropertyName("cycle_ended")] public DateOnly CycleEnded { get; set; }
    [JsonPropertyName("renewed_on")] public DateOnly RenewedOn { get; set; }
    [JsonPropertyName("new_expires")] public DateOnly NewExpires { get; set; }
    [JsonPropertyName("renewed_by")] public string? RenewedBy { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
}

// ---- Request DTOs (inbound JSON is snake_case -> needs JsonPropertyName too,
// since case-insensitive binding does NOT ignore underscores) ----

/// <summary>Create-licence payload (Add Licence form).</summary>
public class LicenceCreateRequest
{
    [JsonPropertyName("vendor")] public string Vendor { get; set; } = "";
    [JsonPropertyName("product")] public string Product { get; set; } = "";
    [JsonPropertyName("application_name")] public string? ApplicationName { get; set; }
    [JsonPropertyName("licence_type")] public string? LicenceType { get; set; }
    [JsonPropertyName("quantity_held")] public int? QuantityHeld { get; set; }
    [JsonPropertyName("audit_frequency")] public string? AuditFrequency { get; set; }
    [JsonPropertyName("audit_owner_sam")] public string? AuditOwnerSam { get; set; }
    [JsonPropertyName("expires_at")] public DateOnly ExpiresAt { get; set; }
    [JsonPropertyName("notice_period_days")] public int? NoticePeriodDays { get; set; }
    [JsonPropertyName("status_flag")] public string? StatusFlag { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
}

/// <summary>Partial-update payload. Any null field is left unchanged.</summary>
public class LicencePatchRequest
{
    [JsonPropertyName("application_name")] public string? ApplicationName { get; set; }
    [JsonPropertyName("licence_type")] public string? LicenceType { get; set; }
    [JsonPropertyName("quantity_held")] public int? QuantityHeld { get; set; }
    [JsonPropertyName("audit_frequency")] public string? AuditFrequency { get; set; }
    [JsonPropertyName("audit_owner_sam")] public string? AuditOwnerSam { get; set; }
    [JsonPropertyName("expires_at")] public DateOnly? ExpiresAt { get; set; }
    [JsonPropertyName("notice_period_days")] public int? NoticePeriodDays { get; set; }
    [JsonPropertyName("status_flag")] public string? StatusFlag { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
}

/// <summary>Renew action payload: a new expiry date closes the current cycle.</summary>
public class LicenceRenewRequest
{
    [JsonPropertyName("new_expires")] public DateOnly NewExpires { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
}

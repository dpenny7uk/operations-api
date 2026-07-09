using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Infrastructure;
using OperationsApi.Models;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>
/// Vendor-licence renewal tracking (Surface 08, Risk group). Reads expose commercial
/// licence data, so they require OpsAuditor; writes require OpsAdmin. Licences are
/// entered/maintained here (manual source of record) -- not synced from the CMDB.
/// </summary>
[Authorize]
[ApiController]
[Route("api/licensing")]
[Produces("application/json")]
public class LicensingController : ControllerBase
{
    private readonly ILicensingService _svc;

    public LicensingController(ILicensingService svc) => _svc = svc;

    // status_flag vocabulary (matches the DB CHECK + the frontend dropdown).
    private static bool IsValidStatus(string? s) => s is null or "tracked" or "engaged";

    /// <summary>List active licences, optionally filtered by vendor, status_flag, and free text.</summary>
    /// <param name="vendor">Optional exact vendor filter.</param>
    /// <param name="status">Optional status_flag filter ('tracked' | 'engaged').</param>
    /// <param name="q">Optional free-text search over application / vendor / product.</param>
    /// <param name="limit">Page size (1-1000, default 200).</param>
    [HttpGet("licences")]
    [Authorize(Policy = "OpsAuditor")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> List(
        [FromQuery] string? vendor = null,
        [FromQuery] string? status = null,
        [FromQuery] string? q = null,
        [FromQuery] int limit = 200)
    {
        if (vendor?.Length > 120 || InputGuard.ContainsControlChars(vendor))
            return BadRequest("vendor parameter is invalid.");
        if (!IsValidStatus(status))
            return BadRequest("status must be 'tracked' or 'engaged'.");
        if (q?.Length > 255 || InputGuard.ContainsControlChars(q))
            return BadRequest("q parameter is invalid.");

        var vendorFilter = string.IsNullOrWhiteSpace(vendor) ? null : vendor.Trim();
        var statusFilter = string.IsNullOrWhiteSpace(status) ? null : status.Trim();
        var search = string.IsNullOrWhiteSpace(q) ? null : q.Trim();

        return Ok(await _svc.ListAsync(vendorFilter, statusFilter, search, Math.Clamp(limit, 1, 1000)));
    }

    /// <summary>Get one licence with its embedded renewal history.</summary>
    [HttpGet("licences/{id}")]
    [Authorize(Policy = "OpsAuditor")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetById(int id)
    {
        var licence = await _svc.GetByIdAsync(id);
        return licence == null ? NotFound() : Ok(licence);
    }

    /// <summary>Create a licence. Requires OpsAdmin role.</summary>
    [HttpPost("licences")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(201)]
    [ProducesResponseType(400)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> Create([FromBody] LicenceCreateRequest req)
    {
        var error = ValidateCommon(req.Vendor, req.Product, req.ApplicationName, req.LicenceType,
            req.QuantityHeld, req.AuditFrequency, req.AuditOwnerSam, req.NoticePeriodDays,
            req.StatusFlag, req.Notes, req.ExpiresAt, expiryRequired: true);
        if (error != null) return BadRequest(error);

        var actor = User.CurrentSam();
        var created = await _svc.CreateAsync(req, actor);
        return Created($"/api/licensing/licences/{created.LicenceId}", created);
    }

    /// <summary>Patch a licence (any subset of fields, incl. inline status-flag edit). Requires OpsAdmin role.</summary>
    [HttpPatch("licences/{id}")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> Update(int id, [FromBody] LicencePatchRequest req)
    {
        var error = ValidateCommon(
            // vendor/product aren't editable via PATCH in the UI, but guard if sent.
            vendor: null, product: null,
            req.ApplicationName, req.LicenceType, req.QuantityHeld, req.AuditFrequency,
            req.AuditOwnerSam, req.NoticePeriodDays, req.StatusFlag, req.Notes,
            req.ExpiresAt, expiryRequired: false);
        if (error != null) return BadRequest(error);

        var actor = User.CurrentSam();
        var updated = await _svc.PatchAsync(id, req, actor);
        return updated == null ? NotFound() : Ok(updated);
    }

    /// <summary>Renew a licence: close the current cycle, advance the expiry, reset alerts. Requires OpsAdmin role.</summary>
    [HttpPost("licences/{id}/renew")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Renew(int id, [FromBody] LicenceRenewRequest req)
    {
        var today = DateOnly.FromDateTime(DateTime.Today);
        if (req.NewExpires < today)
            return BadRequest("new_expires must be today or later.");
        if (req.NewExpires > today.AddYears(20))
            return BadRequest("new_expires must be within 20 years.");
        if (req.Notes?.Length > 4000 || InputGuard.ContainsControlCharsExceptWhitespace(req.Notes))
            return BadRequest("notes is invalid (max 4000 characters).");

        var actor = User.CurrentSam();
        var renewed = await _svc.RenewAsync(id, req.NewExpires, req.Notes?.Trim(), actor);
        return renewed == null ? NotFound() : Ok(renewed);
    }

    /// <summary>Soft-delete a licence. Requires OpsAdmin role.</summary>
    [HttpDelete("licences/{id}")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Delete(int id)
    {
        var actor = User.CurrentSam();
        var removed = await _svc.DeleteAsync(id, actor);
        return removed ? Ok() : NotFound();
    }

    // Shared field validation for create + patch. Returns an error message or null.
    private static string? ValidateCommon(
        string? vendor, string? product, string? applicationName, string? licenceType,
        int? quantityHeld, string? auditFrequency, string? auditOwnerSam, int? noticePeriodDays,
        string? statusFlag, string? notes, DateOnly? expiresAt, bool expiryRequired)
    {
        if (expiryRequired)
        {
            if (string.IsNullOrWhiteSpace(vendor)) return "vendor is required.";
            if (string.IsNullOrWhiteSpace(product)) return "product is required.";
            if (expiresAt == null) return "expires_at is required.";
        }
        var textError = InputGuard.InvalidText(vendor, 120, "vendor")
            ?? InputGuard.InvalidText(product, 120, "product")
            ?? InputGuard.InvalidText(applicationName, 255, "application_name")
            ?? InputGuard.InvalidText(licenceType, 50, "licence_type")
            ?? InputGuard.InvalidText(auditFrequency, 30, "audit_frequency")
            ?? InputGuard.InvalidText(auditOwnerSam, 255, "audit_owner_sam")
            // Notes is a multi-line free-text field, so newlines/tabs are valid.
            ?? InputGuard.InvalidText(notes, 4000, "notes", allowNewlines: true);
        if (textError != null) return textError;
        if (quantityHeld is < 0 or > 100_000_000)
            return "quantity_held must be between 0 and 100,000,000.";
        if (noticePeriodDays is < 0 or > 3650)
            return "notice_period_days must be between 0 and 3650.";
        if (!IsValidStatus(statusFlag))
            return "status_flag must be 'tracked' or 'engaged'.";
        if (expiresAt != null)
        {
            // Past dates are allowed (expired licences are tracked); cap the upper bound to catch typos.
            if (expiresAt.Value > DateOnly.FromDateTime(DateTime.Today).AddYears(20))
                return "expires_at must be within 20 years.";
            if (expiresAt.Value < new DateOnly(2000, 1, 1))
                return "expires_at must be on or after 2000-01-01.";
        }
        return null;
    }
}

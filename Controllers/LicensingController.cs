using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Infrastructure;
using OperationsApi.Models;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>
/// Vendor-licence renewal tracking (Surface 08, Risk group). Reads are open to any
/// authenticated user; writes require OpsAdmin. Licences are entered/maintained here
/// (manual source of record) -- not synced from the CMDB.
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

        var actor = User.Identity?.Name ?? "unknown";
        try
        {
            var created = await _svc.CreateAsync(req, actor);
            return Created($"/api/licensing/licences/{created.LicenceId}", created);
        }
        catch (ConflictException ex)
        {
            return Conflict(ex.Message);
        }
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

        var actor = User.Identity?.Name ?? "unknown";
        try
        {
            var updated = await _svc.PatchAsync(id, req, actor);
            return updated == null ? NotFound() : Ok(updated);
        }
        catch (ConflictException ex)
        {
            return Conflict(ex.Message);
        }
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
        if (req.Notes?.Length > 4000 || InputGuard.ContainsControlChars(req.Notes))
            return BadRequest("notes is invalid (max 4000 characters).");

        var actor = User.Identity?.Name ?? "unknown";
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
        var actor = User.Identity?.Name ?? "unknown";
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
        if (vendor != null && (vendor.Length > 120 || InputGuard.ContainsControlChars(vendor)))
            return "vendor is invalid (max 120 characters).";
        if (product != null && (product.Length > 120 || InputGuard.ContainsControlChars(product)))
            return "product is invalid (max 120 characters).";
        if (applicationName != null && (applicationName.Length > 255 || InputGuard.ContainsControlChars(applicationName)))
            return "application_name is invalid (max 255 characters).";
        if (licenceType != null && (licenceType.Length > 50 || InputGuard.ContainsControlChars(licenceType)))
            return "licence_type is invalid (max 50 characters).";
        if (auditFrequency != null && (auditFrequency.Length > 30 || InputGuard.ContainsControlChars(auditFrequency)))
            return "audit_frequency is invalid (max 30 characters).";
        if (auditOwnerSam != null && (auditOwnerSam.Length > 255 || InputGuard.ContainsControlChars(auditOwnerSam)))
            return "audit_owner_sam is invalid (max 255 characters).";
        if (notes != null && (notes.Length > 4000 || InputGuard.ContainsControlChars(notes)))
            return "notes is invalid (max 4000 characters).";
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

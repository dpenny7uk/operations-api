using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Infrastructure;
using OperationsApi.Models;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>
/// Application access auditing (Surface 09, Governance group). Registers
/// applications, the AD groups that gate them, and (for nominees-mode apps) the
/// picked recipients. Reads are open to any authenticated user; writes require
/// OpsAdmin. Campaign launch + attestation arrive in later slices.
/// </summary>
[Authorize]
[ApiController]
[Route("api/auditing")]
[Produces("application/json")]
public class AuditingApplicationsController : ControllerBase
{
    private readonly IAuditingService _svc;

    public AuditingApplicationsController(IAuditingService svc) => _svc = svc;

    private static bool IsValidRoutingMode(string? s) => s is null or "line_manager" or "nominees";

    // ── Applications ─────────────────────────────────────────────────

    /// <summary>List applications registered for auditing, optionally filtered by name.</summary>
    [HttpGet("applications")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> ListApplications([FromQuery] string? q = null)
    {
        if (q?.Length > 255 || InputGuard.ContainsControlChars(q))
            return BadRequest("q parameter is invalid.");

        var search = string.IsNullOrWhiteSpace(q) ? null : q.Trim();
        return Ok(await _svc.ListApplicationsAsync(search));
    }

    /// <summary>Get one application with its embedded bindings and nominees.</summary>
    [HttpGet("applications/{id}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetApplication(int id)
    {
        var app = await _svc.GetApplicationAsync(id);
        return app == null ? NotFound() : Ok(app);
    }

    /// <summary>Register an application for auditing. Requires OpsAdmin role.</summary>
    [HttpPost("applications")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(201)]
    [ProducesResponseType(400)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> CreateApplication([FromBody] AppCreateRequest req)
    {
        var error = ValidateApp(req.Name, req.BusinessOwner, req.TechnicalOwner, req.SupportEmail,
            req.AuditRoutingMode, req.AuditFrequencyMonths, req.AuditDuePeriodDays, nameRequired: true)
            ?? ValidateDisplay(req.BusinessOwnerDisplay, "business_owner_display")
            ?? ValidateDisplay(req.TechnicalOwnerDisplay, "technical_owner_display");
        if (error != null) return BadRequest(error);

        var actor = User.Identity?.Name ?? "unknown";
        try
        {
            var created = await _svc.CreateApplicationAsync(req, actor);
            return Created($"/api/auditing/applications/{created.ApplicationId}", created);
        }
        catch (ConflictException ex)
        {
            return Conflict(ex.Message);
        }
    }

    /// <summary>Patch an application's audit config (any subset of fields). Requires OpsAdmin role.</summary>
    [HttpPatch("applications/{id}")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> UpdateApplication(int id, [FromBody] AppPatchRequest req)
    {
        var error = ValidateApp(req.Name, req.BusinessOwner, req.TechnicalOwner, req.SupportEmail,
            req.AuditRoutingMode, req.AuditFrequencyMonths, req.AuditDuePeriodDays, nameRequired: false)
            ?? ValidateDisplay(req.BusinessOwnerDisplay, "business_owner_display")
            ?? ValidateDisplay(req.TechnicalOwnerDisplay, "technical_owner_display");
        if (error != null) return BadRequest(error);

        var actor = User.Identity?.Name ?? "unknown";
        try
        {
            var updated = await _svc.PatchApplicationAsync(id, req, actor);
            return updated == null ? NotFound() : Ok(updated);
        }
        catch (ConflictException ex)
        {
            return Conflict(ex.Message);
        }
    }

    /// <summary>Archive (retire) an application. Keeps its config + attestation history but
    /// moves it out of the active list and blocks new campaigns. Requires OpsAdmin role.</summary>
    [HttpPost("applications/{id}/archive")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> ArchiveApplication(int id)
    {
        var actor = User.Identity?.Name ?? "unknown";
        try
        {
            var archived = await _svc.ArchiveApplicationAsync(id, actor);
            return archived == null ? NotFound() : Ok(archived);
        }
        catch (ConflictException ex)
        {
            return Conflict(ex.Message);
        }
    }

    /// <summary>Restore an archived application back to active. Requires OpsAdmin role.</summary>
    [HttpPost("applications/{id}/restore")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> RestoreApplication(int id)
    {
        var actor = User.Identity?.Name ?? "unknown";
        var restored = await _svc.RestoreApplicationAsync(id, actor);
        return restored == null ? NotFound() : Ok(restored);
    }

    /// <summary>Delete an application: hard-deletes the row when it was auditing-created and
    /// nothing references it, else soft-unregisters (clears config, deactivates bindings,
    /// removes nominees; shared row preserved). 409 if an open campaign exists. Requires OpsAdmin role.</summary>
    [HttpDelete("applications/{id}")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> DeleteApplication(int id)
    {
        var actor = User.Identity?.Name ?? "unknown";
        try
        {
            var removed = await _svc.DeleteApplicationAsync(id, actor);
            return removed ? Ok() : NotFound();
        }
        catch (ConflictException ex)
        {
            return Conflict(ex.Message);
        }
    }

    // ── Bindings ─────────────────────────────────────────────────────

    /// <summary>Bind an AD group to an application. Requires OpsAdmin role.</summary>
    [HttpPost("applications/{id}/bindings")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(201)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> AddBinding(int id, [FromBody] BindingCreateRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.GroupDn)) return BadRequest("group_dn is required.");
        if (req.GroupDn.Length > 500 || InputGuard.ContainsControlChars(req.GroupDn))
            return BadRequest("group_dn is invalid (max 500 characters).");
        if (req.GroupSam?.Length > 255 || InputGuard.ContainsControlChars(req.GroupSam))
            return BadRequest("group_sam is invalid (max 255 characters).");
        if (req.GroupType?.Length > 20 || InputGuard.ContainsControlChars(req.GroupType))
            return BadRequest("group_type is invalid (max 20 characters).");

        var actor = User.Identity?.Name ?? "unknown";
        try
        {
            var binding = await _svc.AddBindingAsync(id, req, actor);
            return binding == null
                ? NotFound()
                : Created($"/api/auditing/applications/{id}", binding);
        }
        catch (ConflictException ex)
        {
            return Conflict(ex.Message);
        }
    }

    /// <summary>Remove a group binding from an application. Requires OpsAdmin role.</summary>
    [HttpDelete("applications/{id}/bindings/{bindingId}")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> RemoveBinding(int id, int bindingId)
    {
        var actor = User.Identity?.Name ?? "unknown";
        try
        {
            var removed = await _svc.RemoveBindingAsync(id, bindingId, actor);
            return removed ? Ok() : NotFound();
        }
        catch (ConflictException ex)
        {
            return Conflict(ex.Message);
        }
    }

    // ── Nominees ─────────────────────────────────────────────────────

    /// <summary>Add a nominee to a nominees-mode application. Requires OpsAdmin role.</summary>
    [HttpPost("applications/{id}/nominees")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(201)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> AddNominee(int id, [FromBody] NomineeCreateRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.NomineeSam)) return BadRequest("nominee_sam is required.");
        if (req.NomineeSam.Length > 255 || InputGuard.ContainsControlChars(req.NomineeSam))
            return BadRequest("nominee_sam is invalid (max 255 characters).");
        if (req.NomineeDisplayName?.Length > 255 || InputGuard.ContainsControlChars(req.NomineeDisplayName))
            return BadRequest("nominee_display_name is invalid (max 255 characters).");
        if (req.NomineeEmail?.Length > 255 || InputGuard.ContainsControlChars(req.NomineeEmail))
            return BadRequest("nominee_email is invalid (max 255 characters).");
        if (req.RoleNote?.Length > 4000 || InputGuard.ContainsControlCharsExceptWhitespace(req.RoleNote))
            return BadRequest("role_note is invalid (max 4000 characters).");

        var actor = User.Identity?.Name ?? "unknown";
        try
        {
            var nominee = await _svc.AddNomineeAsync(id, req, actor);
            return nominee == null
                ? NotFound()
                : Created($"/api/auditing/applications/{id}", nominee);
        }
        catch (ConflictException ex)
        {
            return Conflict(ex.Message);
        }
    }

    /// <summary>Remove a nominee from an application. Requires OpsAdmin role.</summary>
    [HttpDelete("applications/{id}/nominees/{nomineeId}")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> RemoveNominee(int id, int nomineeId)
    {
        try
        {
            var removed = await _svc.RemoveNomineeAsync(id, nomineeId);
            return removed ? Ok() : NotFound();
        }
        catch (ConflictException ex)
        {
            return Conflict(ex.Message);
        }
    }

    // Cached AD display name (e.g. "Jay Bishop") — bounded + control-char guarded.
    private static string? ValidateDisplay(string? v, string field)
        => (v != null && (v.Length > 255 || InputGuard.ContainsControlChars(v)))
            ? field + " is invalid (max 255 characters)." : null;

    // Shared application-field validation for create + patch. Returns an error or null.
    private static string? ValidateApp(
        string? name, string? businessOwner, string? technicalOwner, string? supportEmail,
        string? routingMode, int? frequencyMonths, int? duePeriodDays, bool nameRequired)
    {
        if (nameRequired && string.IsNullOrWhiteSpace(name))
            return "name is required.";
        if (name != null && (name.Length > 255 || InputGuard.ContainsControlChars(name)))
            return "name is invalid (max 255 characters).";
        if (businessOwner != null && (businessOwner.Length > 255 || InputGuard.ContainsControlChars(businessOwner)))
            return "business_owner is invalid (max 255 characters).";
        if (technicalOwner != null && (technicalOwner.Length > 255 || InputGuard.ContainsControlChars(technicalOwner)))
            return "technical_owner is invalid (max 255 characters).";
        if (supportEmail != null && (supportEmail.Length > 255 || InputGuard.ContainsControlChars(supportEmail)))
            return "support_email is invalid (max 255 characters).";
        if (!IsValidRoutingMode(routingMode))
            return "audit_routing_mode must be 'line_manager' or 'nominees'.";
        if (frequencyMonths is < 1 or > 120)
            return "audit_frequency_months must be between 1 and 120.";
        if (duePeriodDays is < 1 or > 365)
            return "audit_due_period_days must be between 1 and 365.";
        return null;
    }
}

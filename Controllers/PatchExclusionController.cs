using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>Patch exclusion management - exclude servers from patching cycles with a reason and hold date.</summary>
[Authorize]
[ApiController]
[Route("api/patching/exclusions")]
[Produces("application/json")]
public class PatchExclusionController : ControllerBase
{
    private readonly IPatchExclusionService _svc;

    public PatchExclusionController(IPatchExclusionService svc) => _svc = svc;

    /// <summary>Get exclusion summary with cross-facet counts by state + business unit.</summary>
    /// <param name="businessUnit">Optional canonical business-unit filter.</param>
    /// <param name="state">Optional hold-state filter ('overdue' | 'expiring-soon' | 'active').</param>
    [HttpGet("summary")]
    [ResponseCache(Duration = 30, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetSummary(
        [FromQuery] string? businessUnit = null,
        [FromQuery] string? state = null)
    {
        var buFilter = string.IsNullOrWhiteSpace(businessUnit) ? null : businessUnit.Trim();
        var stateFilter = string.IsNullOrWhiteSpace(state) ? null : state.Trim();
        return Ok(await _svc.GetExclusionSummaryAsync(buFilter, stateFilter));
    }

    [HttpGet]
    [ProducesResponseType(200)]
    public async Task<IActionResult> List(
        [FromQuery] string? search,
        [FromQuery] string? businessUnit = null,
        [FromQuery] string? state = null,
        [FromQuery] int limit = 100,
        [FromQuery] int offset = 0)
    {
        if (search?.Length > 255 || InputGuard.ContainsControlChars(search))
            return BadRequest("search parameter is invalid.");
        var buFilter = string.IsNullOrWhiteSpace(businessUnit) ? null : businessUnit.Trim();
        var stateFilter = string.IsNullOrWhiteSpace(state) ? null : state.Trim();

        return Ok(await _svc.ListExclusionsAsync(search,
            Math.Clamp(limit, 1, 500),
            Math.Clamp(offset, 0, 100000),
            buFilter,
            stateFilter));
    }

    /// <summary>Search servers from patching schedule data for exclusion selection.</summary>
    /// <param name="search">Search term - matches server name, service, application, or patch group.</param>
    /// <param name="limit">Page size (1-50, default 50).</param>
    /// <param name="offset">Pagination offset (default 0).</param>
    [HttpGet("servers")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> SearchServers(
        [FromQuery] string? search,
        [FromQuery] int limit = 50,
        [FromQuery] int offset = 0)
    {
        if (search?.Length > 255 || InputGuard.ContainsControlChars(search))
            return BadRequest("search parameter is invalid.");

        return Ok(await _svc.SearchPatchServersAsync(search,
            Math.Clamp(limit, 1, 50),
            Math.Clamp(offset, 0, 100000)));
    }

    /// <summary>Exclude servers from patching. Requires OpsAdmin role.</summary>
    [HttpPost]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> Exclude([FromBody] ExcludeRequest req)
    {
        if (req.ServerIds == null || req.ServerIds.Count == 0)
            return BadRequest("At least one server ID is required.");
        if (req.ServerIds.Count > 100)
            return BadRequest("Maximum 100 servers per request.");
        if (req.ServerIds.Any(id => id <= 0))
            return BadRequest("All server IDs must be positive.");
        if (string.IsNullOrWhiteSpace(req.Reason))
            return BadRequest("Reason is required.");
        if (req.Reason.Length > 2000)
            return BadRequest("Reason must be 2000 characters or fewer.");
        if (InputGuard.ContainsControlChars(req.Reason))
            return BadRequest("Reason contains invalid characters.");
        if (req.HeldUntil < DateOnly.FromDateTime(DateTime.Today))
            return BadRequest("Held until date must be today or later.");
        if (req.HeldUntil > DateOnly.FromDateTime(DateTime.Today.AddYears(2)))
            return BadRequest("Held until date must be within 2 years.");
        if (req.Ticket?.Length > 100) return BadRequest("Ticket must be 100 characters or fewer.");
        if (req.ReasonSlug?.Length > 50) return BadRequest("Reason slug must be 50 characters or fewer.");
        if (req.Notes?.Length > 4000) return BadRequest("Notes must be 4000 characters or fewer.");

        var user = User.Identity?.Name ?? "unknown";
        var count = await _svc.ExcludeServersAsync(req.ServerIds, req.Reason.Trim(), req.HeldUntil, user,
            req.Ticket?.Trim(), req.ReasonSlug?.Trim(), req.Notes?.Trim());
        return Ok(new { excluded = count });
    }

    /// <summary>Bulk-exclude all active servers in a patch group or environment. Requires OpsAdmin role.</summary>
    [HttpPost("bulk")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> Bulk([FromBody] BulkExcludeRequest req)
    {
        if (req.Kind != "group" && req.Kind != "env")
            return BadRequest("kind must be 'group' or 'env'.");
        if (string.IsNullOrWhiteSpace(req.Target) || req.Target.Length > 100)
            return BadRequest("target is required (max 100 chars).");
        if (InputGuard.ContainsControlChars(req.Target))
            return BadRequest("target contains invalid characters.");
        if (string.IsNullOrWhiteSpace(req.Reason))
            return BadRequest("Reason is required.");
        if (req.Reason.Length > 2000)
            return BadRequest("Reason must be 2000 characters or fewer.");
        if (req.HeldUntil < DateOnly.FromDateTime(DateTime.Today))
            return BadRequest("Held until date must be today or later.");
        if (req.HeldUntil > DateOnly.FromDateTime(DateTime.Today.AddYears(2)))
            return BadRequest("Held until date must be within 2 years.");
        if (req.Ticket?.Length > 100) return BadRequest("Ticket must be 100 characters or fewer.");
        if (req.Notes?.Length > 4000) return BadRequest("Notes must be 4000 characters or fewer.");

        var user = User.Identity?.Name ?? "unknown";
        var count = await _svc.BulkExcludeAsync(req.Kind, req.Target.Trim(), req.Reason.Trim(), req.HeldUntil, user,
            req.Ticket?.Trim(), req.ReasonSlug?.Trim(), req.Notes?.Trim());
        return Ok(new { affected = count });
    }

    /// <summary>Extend the hold date on an existing exclusion. Requires OpsAdmin role.</summary>
    [HttpPost("{id}/extend")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Extend(int id, [FromBody] ExtendRequest req)
    {
        if (req.HeldUntil < DateOnly.FromDateTime(DateTime.Today))
            return BadRequest("Held until date must be today or later.");
        if (req.HeldUntil > DateOnly.FromDateTime(DateTime.Today.AddYears(2)))
            return BadRequest("Held until date must be within 2 years.");

        var user = User.Identity?.Name ?? "unknown";
        var updated = await _svc.ExtendExclusionAsync(id, req.HeldUntil, user);
        return updated ? Ok() : NotFound();
    }

    /// <summary>Renew (PATCH) an exclusion - updates hold-until and/or notes. Requires OpsAdmin role.</summary>
    [HttpPatch("{id}")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateExclusionRequest req)
    {
        if (req.HeldUntil != null)
        {
            if (req.HeldUntil < DateOnly.FromDateTime(DateTime.Today))
                return BadRequest("Held until date must be today or later.");
            if (req.HeldUntil > DateOnly.FromDateTime(DateTime.Today.AddYears(2)))
                return BadRequest("Held until date must be within 2 years.");
        }
        if (req.Notes?.Length > 4000) return BadRequest("Notes must be 4000 characters or fewer.");
        if (req.HeldUntil == null && req.Notes == null)
            return BadRequest("At least one of heldUntil or notes must be provided.");

        var user = User.Identity?.Name ?? "unknown";
        var updated = await _svc.UpdateExclusionAsync(id, req.HeldUntil, req.Notes?.Trim(), user);
        return updated ? Ok() : NotFound();
    }

    /// <summary>Release (DELETE) an exclusion (soft delete). Requires OpsAdmin role.</summary>
    [HttpDelete("{id}")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Release(int id)
    {
        var user = User.Identity?.Name ?? "unknown";
        var removed = await _svc.RemoveExclusionAsync(id, user);
        return removed ? Ok() : NotFound();
    }

    /// <summary>Remove a server from the exclusion list (soft delete). Requires OpsAdmin role.</summary>
    /// <remarks>Legacy endpoint - prefer DELETE /{id}.</remarks>
    [HttpPost("{id}/remove")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Remove(int id)
    {
        var user = User.Identity?.Name ?? "unknown";
        var removed = await _svc.RemoveExclusionAsync(id, user);
        return removed ? Ok() : NotFound();
    }

    public record ExcludeRequest(List<int> ServerIds, string Reason, DateOnly HeldUntil,
        string? Ticket = null, string? ReasonSlug = null, string? Notes = null);
    public record BulkExcludeRequest(string Kind, string Target, string Reason, DateOnly HeldUntil,
        string? Ticket = null, string? ReasonSlug = null, string? Notes = null);
    public record ExtendRequest(DateOnly HeldUntil);
    public record UpdateExclusionRequest(DateOnly? HeldUntil, string? Notes);
}

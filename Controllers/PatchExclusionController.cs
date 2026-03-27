using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>Patch exclusion management — exclude servers from patching cycles with a reason and hold date.</summary>
[Authorize]
[ApiController]
[Route("api/patching/exclusions")]
[Produces("application/json")]
public class PatchExclusionController : ControllerBase
{
    private readonly IPatchExclusionService _svc;

    public PatchExclusionController(IPatchExclusionService svc) => _svc = svc;

    /// <summary>Get exclusion summary (total excluded count and expired hold count).</summary>
    [HttpGet("summary")]
    [ResponseCache(Duration = 30, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetSummary()
        => Ok(await _svc.GetExclusionSummaryAsync());

    /// <summary>List active patch exclusions with optional search and pagination.</summary>
    /// <param name="search">Search term — matches server name or reason.</param>
    /// <param name="limit">Page size (1-500, default 100).</param>
    /// <param name="offset">Pagination offset (default 0).</param>
    [HttpGet]
    [ProducesResponseType(200)]
    public async Task<IActionResult> List(
        [FromQuery] string? search,
        [FromQuery] int limit = 100,
        [FromQuery] int offset = 0)
    {
        if (search?.Length > 255 || InputGuard.ContainsControlChars(search))
            return BadRequest("search parameter is invalid.");

        return Ok(await _svc.ListExclusionsAsync(search,
            Math.Clamp(limit, 1, 500),
            Math.Clamp(offset, 0, 100000)));
    }

    /// <summary>Search servers from patching schedule data for exclusion selection.</summary>
    /// <param name="search">Search term — matches server name, service, application, or patch group.</param>
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

        var user = User.Identity?.Name ?? "unknown";
        var count = await _svc.ExcludeServersAsync(req.ServerIds, req.Reason.Trim(), req.HeldUntil, user);
        return Ok(new { excluded = count });
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

    /// <summary>Remove a server from the exclusion list (soft delete). Requires OpsAdmin role.</summary>
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

    public record ExcludeRequest(List<int> ServerIds, string Reason, DateOnly HeldUntil);
    public record ExtendRequest(DateOnly HeldUntil);
}

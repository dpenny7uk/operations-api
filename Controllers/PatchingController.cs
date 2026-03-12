using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>Patch cycle management and known issue tracking.</summary>
[Authorize]
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class PatchingController : ControllerBase
{
    private readonly IPatchingService _svc;

    public PatchingController(IPatchingService svc) => _svc = svc;

    /// <summary>Get a summary of the next upcoming patch cycle including server counts and known issues.</summary>
    [HttpGet("next")]
    [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetNextSummary()
    {
        var summary = await _svc.GetNextPatchingSummaryAsync();
        return summary == null ? NotFound("No upcoming cycles") : Ok(summary);
    }

    /// <summary>List patch cycles, optionally filtered to upcoming only.</summary>
    /// <param name="upcomingOnly">If true, only return future/scheduled cycles (default true).</param>
    /// <param name="limit">Maximum number of cycles to return (1-100, default 10).</param>
    [HttpGet("cycles")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> ListCycles(
        [FromQuery] bool upcomingOnly = true,
        [FromQuery] int limit = 10)
    {
        return Ok(await _svc.ListPatchCyclesAsync(upcomingOnly, Math.Clamp(limit, 1, 100)));
    }

    /// <summary>Get servers assigned to a specific patch cycle with optional filtering.</summary>
    /// <param name="cycleId">The patch cycle ID.</param>
    /// <param name="patchGroup">Filter by patch group name.</param>
    /// <param name="hasIssues">Filter to servers with/without known issues.</param>
    /// <param name="limit">Page size (1-500, default 100).</param>
    /// <param name="offset">Pagination offset (default 0).</param>
    [HttpGet("cycles/{cycleId}/servers")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetCycleServers(
        int cycleId,
        [FromQuery] string? patchGroup,
        [FromQuery] bool? hasIssues,
        [FromQuery] int limit = 100,
        [FromQuery] int offset = 0)
    {
        if (patchGroup?.Length > 100 || InputGuard.ContainsControlChars(patchGroup))
            return BadRequest("patchGroup parameter is invalid.");
        return Ok(await _svc.GetCycleServersAsync(cycleId, patchGroup, hasIssues,
            Math.Clamp(limit, 1, 500), Math.Clamp(offset, 0, 100000)));
    }

    /// <summary>List known patching issues with optional severity and application filters.</summary>
    [HttpGet("issues")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> ListIssues(
        [FromQuery] string? severity,
        [FromQuery] string? application,
        [FromQuery] string? patchType,
        [FromQuery] bool activeOnly = true)
    {
        if (patchType != null && patchType.ToLower() is not ("windows" or "sql" or "other"))
            return BadRequest("patchType must be one of: windows, sql, other.");
        if (InputGuard.ContainsControlChars(severity) || InputGuard.ContainsControlChars(application))
            return BadRequest("Query parameter contains invalid characters.");
        return Ok(await _svc.ListKnownIssuesAsync(severity, application, patchType, activeOnly));
    }

    /// <summary>Get a specific known issue by ID.</summary>
    [HttpGet("issues/{id}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetIssue(int id)
    {
        var issue = await _svc.GetKnownIssueByIdAsync(id);
        return issue == null ? NotFound() : Ok(issue);
    }

    /// <summary>Get configured patch maintenance windows.</summary>
    [HttpGet("windows")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetWindows()
        => Ok(await _svc.GetPatchWindowsAsync());
}

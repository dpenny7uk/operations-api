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
    /// <param name="businessUnit">Optional canonical business-unit filter - narrows server / known-issue counts to that BU. Cycle dates and patch-window times are unaffected (they're shared across BUs).</param>
    [HttpGet("next")]
    [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetNextSummary([FromQuery] string? businessUnit = null)
    {
        if (businessUnit?.Length > 100 || InputGuard.ContainsControlChars(businessUnit))
            return BadRequest("businessUnit parameter is invalid.");
        var buFilter = string.IsNullOrWhiteSpace(businessUnit) ? null : businessUnit.Trim();
        var summary = await _svc.GetNextPatchingSummaryAsync(buFilter);
        return summary == null ? NotFound("No upcoming cycles") : Ok(summary);
    }

    [HttpGet("cycles")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> ListCycles(
        [FromQuery] bool upcomingOnly = true,
        [FromQuery] int limit = 10,
        [FromQuery] string? businessUnit = null)
    {
        if (businessUnit?.Length > 100 || InputGuard.ContainsControlChars(businessUnit))
            return BadRequest("businessUnit parameter is invalid.");
        var buFilter = string.IsNullOrWhiteSpace(businessUnit) ? null : businessUnit.Trim();
        return Ok(await _svc.ListPatchCyclesAsync(upcomingOnly, Math.Clamp(limit, 1, 100), buFilter));
    }

    [HttpGet("cycles/{cycleId}/servers")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetCycleServers(
        int cycleId,
        [FromQuery] string? patchGroup,
        [FromQuery] bool? hasIssues,
        [FromQuery] string? search,
        [FromQuery] int limit = 100,
        [FromQuery] int offset = 0)
    {
        if (patchGroup?.Length > 100 || InputGuard.ContainsControlChars(patchGroup))
            return BadRequest("patchGroup parameter is invalid.");
        if (search?.Length > 100 || InputGuard.ContainsControlChars(search))
            return BadRequest("search parameter is invalid.");
        return Ok(await _svc.GetCycleServersAsync(cycleId, patchGroup, hasIssues, search,
            Math.Clamp(limit, 1, 500), Math.Clamp(offset, 0, 100000)));
    }

    /// <param name="q">Search term (min 2 characters) - matches server name, service, application, or patch group.</param>
    /// <param name="limit">Maximum total results (1-200, default 50).</param>
    [HttpGet("servers/search")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> SearchServers(
        [FromQuery] string? q,
        [FromQuery] int limit = 50)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Length < 2)
            return BadRequest("Search query must be at least 2 characters.");
        if (q.Length > 100 || InputGuard.ContainsControlChars(q))
            return BadRequest("Search query is invalid.");
        return Ok(await _svc.SearchServersGlobalAsync(q, Math.Clamp(limit, 1, 200)));
    }

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

    [HttpGet("issues/{id}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetIssue(int id)
    {
        var issue = await _svc.GetKnownIssueByIdAsync(id);
        return issue == null ? NotFound() : Ok(issue);
    }

    [HttpGet("windows")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetWindows()
        => Ok(await _svc.GetPatchWindowsAsync());

    /// <summary>Update the status of a patch cycle. Requires OpsAdmin role.</summary>
    [HttpPatch("cycles/{cycleId}/status")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> UpdateCycleStatus(int cycleId, [FromBody] CycleStatusRequest req)
    {
        var status = req.Status?.ToLower();
        if (status is not ("completed" or "cancelled"))
            return BadRequest("Status must be one of: completed, cancelled.");
        var updated = await _svc.UpdateCycleStatusAsync(cycleId, status);
        return updated ? Ok() : NotFound();
    }

    public record CycleStatusRequest(string? Status);
}

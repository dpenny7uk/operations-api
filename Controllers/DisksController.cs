using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>Disk capacity monitoring sourced from SolarWinds Orion.</summary>
[Authorize]
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class DisksController : ControllerBase
{
    private readonly IDiskMonitoringService _svc;

    public DisksController(IDiskMonitoringService svc) => _svc = svc;

    /// <summary>Get disk summary with counts by alert status.</summary>
    [HttpGet("summary")]
    [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetSummary()
        => Ok(await _svc.GetSummaryAsync());

    /// <summary>List current-state disks with paged response.</summary>
    /// <param name="limit">Maximum results (1-2000, default 1000).</param>
    /// <param name="offset">Skip the first N results (default 0).</param>
    /// <param name="environment">Optional canonical environment filter (e.g. "Production").</param>
    [HttpGet]
    [ProducesResponseType(200)]
    public async Task<IActionResult> List(
        [FromQuery] int limit = 1000,
        [FromQuery] int offset = 0,
        [FromQuery] string? environment = null)
    {
        // Cap raised to 2000 (was 1000) so an unfiltered fetch returns the full
        // SolarWinds population (~1,231 disks) without truncation. Per-env fetches
        // are well under the cap; the filter shrinks the working set on the SPA.
        var clampedLimit = Math.Clamp(limit, 1, 2000);
        var clampedOffset = Math.Max(offset, 0);
        var envFilter = string.IsNullOrWhiteSpace(environment) ? null : environment.Trim();
        return Ok(await _svc.ListDisksAsync(clampedLimit, clampedOffset, envFilter));
    }

    /// <summary>Get snapshot history for a single disk (used for sparkline + growth projection).</summary>
    [HttpGet("{serverName}/{diskLabel}/history")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> GetHistory(
        string serverName,
        string diskLabel,
        [FromQuery] int days = 30)
    {
        if (string.IsNullOrWhiteSpace(serverName) || serverName.Length > 255 || InputGuard.ContainsControlChars(serverName))
            return BadRequest("Server name is required and must not exceed 255 characters.");
        if (string.IsNullOrWhiteSpace(diskLabel) || diskLabel.Length > 255 || InputGuard.ContainsControlChars(diskLabel))
            return BadRequest("Disk label is required and must not exceed 255 characters.");

        var clampedDays = Math.Clamp(days, 1, 365);
        return Ok(await _svc.GetHistoryAsync(serverName, diskLabel, clampedDays));
    }
}

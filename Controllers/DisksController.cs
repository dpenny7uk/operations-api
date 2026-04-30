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
    /// <param name="environment">Optional canonical environment filter (e.g. "Production").</param>
    /// <param name="businessUnit">Optional canonical business-unit filter (e.g. "Contoso Group Support").</param>
    [HttpGet("summary")]
    [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetSummary(
        [FromQuery] string? environment = null,
        [FromQuery] string? businessUnit = null)
    {
        var envFilter = string.IsNullOrWhiteSpace(environment) ? null : environment.Trim();
        var buFilter = string.IsNullOrWhiteSpace(businessUnit) ? null : businessUnit.Trim();
        return Ok(await _svc.GetSummaryAsync(envFilter, buFilter));
    }

    /// <summary>List current-state disks with paged response.</summary>
    /// <param name="limit">Maximum results (1-5000, default 2000).</param>
    /// <param name="offset">Skip the first N results (default 0).</param>
    /// <param name="environment">Optional canonical environment filter (e.g. "Production").</param>
    /// <param name="businessUnit">Optional canonical business-unit filter (e.g. "Contoso Group Support").</param>
    [HttpGet]
    [ProducesResponseType(200)]
    public async Task<IActionResult> List(
        [FromQuery] int limit = 2000,
        [FromQuery] int offset = 0,
        [FromQuery] string? environment = null,
        [FromQuery] string? businessUnit = null)
    {
        // Cap raised to 5000 (was 2000) so an unfiltered all-BU fetch returns the
        // full estate without truncation. Per-filter fetches stay well under the
        // cap; the filters shrink the working set on the SPA.
        var clampedLimit = Math.Clamp(limit, 1, 5000);
        var clampedOffset = Math.Max(offset, 0);
        var envFilter = string.IsNullOrWhiteSpace(environment) ? null : environment.Trim();
        var buFilter = string.IsNullOrWhiteSpace(businessUnit) ? null : businessUnit.Trim();
        return Ok(await _svc.ListDisksAsync(clampedLimit, clampedOffset, envFilter, buFilter));
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

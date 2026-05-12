using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class HealthController : ControllerBase
{
    private readonly IHealthService _svc;

    public HealthController(IHealthService svc) => _svc = svc;

    /// <summary>Get overall system health summary including sync statuses and server counts.</summary>
    [HttpGet]
    [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetSummary()
        => Ok(await _svc.GetHealthSummaryAsync());

    [HttpGet("syncs")]
    [ResponseCache(Duration = 30, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetSyncStatuses()
        => Ok(await _svc.GetSyncStatusesAsync());

    /// <param name="syncName">Name of the sync job (e.g. databricks_servers, certificate_scan).</param>
    /// <param name="limit">Maximum number of history records to return (1-100, default 20).</param>
    [HttpGet("syncs/{syncName}/history")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> GetSyncHistory(string syncName, [FromQuery] int limit = 20)
    {
        if (string.IsNullOrWhiteSpace(syncName) || syncName.Length > 100 || InputGuard.ContainsControlChars(syncName))
            return BadRequest("Sync name is required and must not exceed 100 characters.");
        return Ok(await _svc.GetSyncHistoryAsync(syncName, Math.Clamp(limit, 1, 100)));
    }

    /// <summary>Run data validation rules on demand. Requires OpsAdmin role.</summary>
    /// <param name="ruleName">Optional specific rule to run. If omitted, all rules are executed.</param>
    [HttpPost("validation/run")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> RunValidation([FromQuery] string? ruleName = null)
    {
        if (ruleName != null && (ruleName.Length > 100 || string.IsNullOrWhiteSpace(ruleName) || InputGuard.ContainsControlChars(ruleName)))
            return BadRequest("Rule name must be 1-100 characters.");
        return Ok(await _svc.RunValidationAsync(ruleName));
    }
}

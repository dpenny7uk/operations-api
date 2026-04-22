using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>Recent alerts across the estate — unreachable hosts, cert expiries, sync lag, overdue exclusions.</summary>
[Authorize]
[ApiController]
[Route("api/alerts")]
[Produces("application/json")]
public class AlertsController : ControllerBase
{
    private readonly IAlertsService _svc;

    public AlertsController(IAlertsService svc) => _svc = svc;

    /// <summary>Most recent alerts across all sources, ordered by occurrence timestamp descending.</summary>
    /// <param name="limit">Page size (1-100, default 20).</param>
    [HttpGet("recent")]
    [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    public async Task<IActionResult> Recent([FromQuery] int limit = 20)
        => Ok(await _svc.GetRecentAlertsAsync(Math.Clamp(limit, 1, 100)));
}

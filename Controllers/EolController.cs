using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>End-of-life software tracking and affected asset counts.</summary>
[Authorize]
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class EolController : ControllerBase
{
    private readonly IEolService _svc;

    public EolController(IEolService svc) => _svc = svc;

    /// <summary>Get EOL summary with counts by status (eol, approaching, supported).</summary>
    [HttpGet("summary")]
    [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetSummary()
        => Ok(await _svc.GetSummaryAsync());

    /// <summary>List EOL software entries with optional filtering.</summary>
    /// <param name="alertLevel">Filter by status (eol, approaching, supported).</param>
    /// <param name="product">Filter by product name (partial match).</param>
    /// <param name="limit">Maximum results (1-1000, default 100).</param>
    [HttpGet]
    [ProducesResponseType(200)]
    public async Task<IActionResult> List(
        [FromQuery] string? alertLevel,
        [FromQuery] string? product,
        [FromQuery] int limit = 100)
    {
        return Ok(await _svc.ListEolSoftwareAsync(alertLevel, product, Math.Clamp(limit, 1, 1000)));
    }

    /// <summary>Get EOL details for a specific product and version.</summary>
    [HttpGet("{product}/{version}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetByProductVersion(string product, string version)
    {
        if (string.IsNullOrWhiteSpace(product) || string.IsNullOrWhiteSpace(version)
            || product.Length > 255 || version.Length > 100)
            return BadRequest("Product and version are required and must not exceed length limits.");
        var detail = await _svc.GetByProductVersionAsync(product, version);
        return detail == null ? NotFound() : Ok(detail);
    }

    /// <summary>Get all EOL software entries affecting a specific server.</summary>
    [HttpGet("server/{serverName}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> GetByServer(string serverName)
    {
        if (string.IsNullOrWhiteSpace(serverName) || serverName.Length > 255)
            return BadRequest("Server name is required and must not exceed 255 characters.");
        return Ok(await _svc.GetByServerAsync(serverName));
    }
}

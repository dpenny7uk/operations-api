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

    /// <summary>Get EOL summary with counts by status (eol, extended, approaching, supported).</summary>
    /// <param name="hasServers">When true, only count products with affected servers &gt; 0.</param>
    /// <param name="businessUnit">Optional canonical business-unit filter - narrows the per-product affected-server counts (and therefore the hasServers projection) to servers in that BU.</param>
    [HttpGet("summary")]
    [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> GetSummary(
        [FromQuery] bool hasServers = false,
        [FromQuery] string? businessUnit = null)
    {
        if (businessUnit?.Length > 100 || InputGuard.ContainsControlChars(businessUnit))
            return BadRequest("businessUnit parameter is invalid.");
        var buFilter = string.IsNullOrWhiteSpace(businessUnit) ? null : businessUnit.Trim();
        return Ok(await _svc.GetSummaryAsync(hasServers, buFilter));
    }

    [HttpGet]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> List(
        [FromQuery] string? alertLevel,
        [FromQuery] string? product,
        [FromQuery] int limit = 100,
        [FromQuery] bool hasServers = false,
        [FromQuery] string? businessUnit = null)
    {
        if (alertLevel != null && alertLevel.ToLower() is not ("eol" or "extended" or "approaching" or "supported"))
            return BadRequest("alertLevel must be one of: eol, approaching, supported.");
        if (product?.Length > 255 || InputGuard.ContainsControlChars(product))
            return BadRequest("product parameter is invalid.");
        if (businessUnit?.Length > 100 || InputGuard.ContainsControlChars(businessUnit))
            return BadRequest("businessUnit parameter is invalid.");
        var buFilter = string.IsNullOrWhiteSpace(businessUnit) ? null : businessUnit.Trim();
        return Ok(await _svc.ListEolSoftwareAsync(alertLevel, product, Math.Clamp(limit, 1, 1000), hasServers, buFilter));
    }

    [HttpGet("{product}/{version}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetByProductVersion(
        string product,
        string version,
        [FromQuery] string? businessUnit = null)
    {
        if (string.IsNullOrWhiteSpace(product) || string.IsNullOrWhiteSpace(version)
            || product.Length > 255 || version.Length > 100
            || InputGuard.ContainsControlChars(product) || InputGuard.ContainsControlChars(version)
            || product.Contains('/') || product.Contains('\\') || version.Contains('/') || version.Contains('\\'))
            return BadRequest("Product and version are required and must not exceed length limits.");
        if (businessUnit?.Length > 100 || InputGuard.ContainsControlChars(businessUnit))
            return BadRequest("businessUnit parameter is invalid.");
        var buFilter = string.IsNullOrWhiteSpace(businessUnit) ? null : businessUnit.Trim();
        var detail = await _svc.GetByProductVersionAsync(product, version, buFilter);
        return detail == null ? NotFound() : Ok(detail);
    }

    [HttpGet("server/{serverName}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> GetByServer(string serverName)
    {
        if (string.IsNullOrWhiteSpace(serverName) || serverName.Length > 255 || InputGuard.ContainsControlChars(serverName))
            return BadRequest("Server name is required and must not exceed 255 characters.");
        return Ok(await _svc.GetByServerAsync(serverName));
    }

    /// <summary>Installed-software strings that did not match SOFTWARE_PATTERNS in the EOL sync. Top-N by frequency = work-list for catalogue expansion.</summary>
    [HttpGet("unmatched")]
    [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetUnmatched([FromQuery] int limit = 50)
        => Ok(await _svc.GetUnmatchedSoftwareAsync(Math.Clamp(limit, 1, 500)));
}

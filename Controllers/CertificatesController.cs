using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>SSL/TLS certificate monitoring and expiry tracking.</summary>
[Authorize]
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class CertificatesController : ControllerBase
{
    private readonly ICertificateService _svc;

    public CertificatesController(ICertificateService svc) => _svc = svc;

    /// <summary>Get certificate summary with counts by alert level.</summary>
    [HttpGet("summary")]
    [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetSummary()
        => Ok(await _svc.GetSummaryAsync());

    /// <summary>List certificates with optional filtering by alert level, server, or days until expiry.</summary>
    /// <param name="alertLevel">Filter by alert level (critical, warning, ok).</param>
    /// <param name="serverName">Filter by server name (partial match).</param>
    /// <param name="daysUntilExpiry">Only return certificates expiring within this many days.</param>
    /// <param name="limit">Maximum results (1-1000, default 100).</param>
    [HttpGet]
    [ProducesResponseType(200)]
    public async Task<IActionResult> List(
        [FromQuery] string? alertLevel,
        [FromQuery] string? serverName,
        [FromQuery] int? daysUntilExpiry,
        [FromQuery] int limit = 100)
    {
        if (alertLevel != null && alertLevel.ToLower() is not ("critical" or "warning" or "ok"))
            return BadRequest("alertLevel must be one of: critical, warning, ok.");
        if (serverName?.Length > 255 || InputGuard.ContainsControlChars(serverName))
            return BadRequest("serverName parameter is invalid.");
        var days = daysUntilExpiry.HasValue ? Math.Max(daysUntilExpiry.Value, 0) : (int?)null;
        return Ok(await _svc.ListCertificatesAsync(alertLevel, serverName, days, Math.Clamp(limit, 1, 1000)));
    }

    /// <summary>Get a specific certificate by ID.</summary>
    [HttpGet("{id}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetById(int id)
    {
        var cert = await _svc.GetByIdAsync(id);
        return cert == null ? NotFound() : Ok(cert);
    }

    /// <summary>Get all certificates for a specific server.</summary>
    [HttpGet("server/{serverName}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> GetByServer(string serverName)
    {
        if (string.IsNullOrWhiteSpace(serverName) || serverName.Length > 255 || InputGuard.ContainsControlChars(serverName))
            return BadRequest("Server name is required and must not exceed 255 characters.");
        return Ok(await _svc.GetByServerAsync(serverName));
    }
}

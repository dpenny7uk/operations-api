using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>Server inventory management and name resolution.</summary>
[Authorize]
[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class ServersController : ControllerBase
{
    private readonly IServerService _svc;
    private readonly ILogger<ServersController> _logger;

    public ServersController(IServerService svc, ILogger<ServersController> logger)
    {
        _svc = svc;
        _logger = logger;
    }

    private string GetUserName()
    {
        var name = User.Identity?.Name;
        if (name is null)
            _logger.LogWarning("User identity could not be resolved — attributing action to 'api'");
        return name ?? "api";
    }

    /// <summary>List servers with optional filtering by environment, application, or search term.</summary>
    [HttpGet]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> List(
        [FromQuery] string? environment,
        [FromQuery] string? application,
        [FromQuery] string? patchGroup,
        [FromQuery] string? search,
        [FromQuery] int limit = 100,
        [FromQuery] int offset = 0)
    {
        if (environment?.Length > 100 || application?.Length > 255 || patchGroup?.Length > 50 || search?.Length > 255)
            return BadRequest("Query parameter exceeds maximum length.");
        // Reject control characters to prevent log injection (newline, carriage return, etc.)
        if (InputGuard.ContainsControlChars(environment) || InputGuard.ContainsControlChars(application) ||
            InputGuard.ContainsControlChars(patchGroup) || InputGuard.ContainsControlChars(search))
            return BadRequest("Query parameter contains invalid characters.");

        var clampedLimit = Math.Clamp(limit, 1, 1000);
        var clampedOffset = Math.Clamp(offset, 0, 100000);
        var servers = await _svc.ListServersAsync(environment, application, patchGroup, search,
            clampedLimit, clampedOffset);
        var totalCount = await _svc.CountServersAsync(environment, application, patchGroup, search);
        return Ok(new { items = servers, totalCount });
    }

    /// <summary>Get server inventory summary with counts by environment.</summary>
    [HttpGet("summary")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> Summary()
    {
        var summary = await _svc.GetServerSummaryAsync();
        return Ok(summary);
    }

    /// <summary>Get a server by its numeric ID.</summary>
    [HttpGet("{id}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetById(int id)
    {
        var server = await _svc.GetServerByIdAsync(id);
        return server == null ? NotFound() : Ok(server);
    }

    /// <summary>Resolve a server name (including aliases) to its canonical record.</summary>
    [HttpGet("resolve/{name}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Resolve(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Length > 500)
            return BadRequest("Server name is required and must not exceed 500 characters.");
        var match = await _svc.ResolveServerNameAsync(name);
        return match == null ? NotFound() : Ok(match);
    }

    /// <summary>List servers that failed certificate or other scans (unreachable).</summary>
    [HttpGet("unreachable")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetUnreachable([FromQuery] int limit = 50)
        => Ok(await _svc.GetUnreachableServersAsync(Math.Clamp(limit, 1, 500)));

    /// <summary>List servers that could not be matched to the canonical inventory.</summary>
    [HttpGet("unmatched")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> GetUnmatched(
        [FromQuery] string? sourceSystem,
        [FromQuery] int limit = 50)
    {
        if (sourceSystem?.Length > 100 || InputGuard.ContainsControlChars(sourceSystem))
            return BadRequest("sourceSystem parameter is invalid.");
        return Ok(await _svc.GetUnmatchedServersAsync(sourceSystem, Math.Clamp(limit, 1, 500)));
    }

    /// <summary>Create a server name alias mapping. Requires OpsAdmin role.</summary>
    [HttpPost("aliases")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(201)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> CreateAlias([FromBody] AliasRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.CanonicalName) || req.CanonicalName.Length > 255)
            return BadRequest("CanonicalName is required and must be 255 characters or less.");
        if (string.IsNullOrWhiteSpace(req.AliasName) || req.AliasName.Length > 255)
            return BadRequest("AliasName is required and must be 255 characters or less.");
        if (req.SourceSystem?.Length > 100)
            return BadRequest("SourceSystem must be 100 characters or less.");

        var user = GetUserName();
        await _svc.CreateAliasAsync(req.CanonicalName.Trim(), req.AliasName.Trim(), req.SourceSystem?.Trim(), user);
        return StatusCode(201);
    }

    /// <summary>Resolve an unmatched server entry to an existing server. Requires OpsAdmin role.</summary>
    [HttpPost("unmatched/{serverNameRaw}/resolve")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> ResolveUnmatched(string serverNameRaw, [FromBody] ResolveRequest req)
    {
        if (string.IsNullOrWhiteSpace(serverNameRaw) || serverNameRaw.Length > 500 || InputGuard.ContainsControlChars(serverNameRaw))
            return BadRequest("Invalid server name.");
        if (req.ServerId <= 0)
            return BadRequest("ServerId must be a positive integer.");
        if (req.SourceSystem?.Length > 100)
            return BadRequest("SourceSystem must be 100 characters or less.");

        var target = await _svc.GetServerByIdAsync(req.ServerId);
        if (target == null)
            return BadRequest($"Server with ID {req.ServerId} does not exist.");

        var user = GetUserName();
        var rows = await _svc.ResolveUnmatchedServerAsync(serverNameRaw, req.ServerId, target.ServerName, req.SourceSystem?.Trim(), user);
        if (rows == 0)
            return NotFound($"No pending unmatched server entry found for '{serverNameRaw}'.");
        return Ok();
    }

    /// <summary>Mark an unmatched server entry as ignored. Requires OpsAdmin role.</summary>
    [HttpPost("unmatched/{serverNameRaw}/ignore")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> IgnoreUnmatched(string serverNameRaw, [FromBody] IgnoreRequest? req = null)
    {
        if (string.IsNullOrWhiteSpace(serverNameRaw) || serverNameRaw.Length > 500 || InputGuard.ContainsControlChars(serverNameRaw))
            return BadRequest("Invalid server name.");
        if (req?.SourceSystem?.Length > 100)
            return BadRequest("SourceSystem must be 100 characters or less.");

        var user = GetUserName();
        await _svc.IgnoreUnmatchedServerAsync(serverNameRaw, req?.SourceSystem?.Trim(), user);
        return Ok();
    }


    public record AliasRequest(string CanonicalName, string AliasName, string? SourceSystem);
    public record ResolveRequest(int ServerId, string? SourceSystem = null);
    public record IgnoreRequest(string? SourceSystem = null);
}

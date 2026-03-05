using Microsoft.AspNetCore.Mvc;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HealthController : ControllerBase
{
    private readonly IHealthService _svc;

    public HealthController(IHealthService svc) => _svc = svc;

    [HttpGet]
    public async Task<IActionResult> GetSummary() 
        => Ok(await _svc.GetHealthSummaryAsync());

    [HttpGet("syncs")]
    public async Task<IActionResult> GetSyncStatuses() 
        => Ok(await _svc.GetSyncStatusesAsync());

    [HttpGet("syncs/{syncName}/history")]
    public async Task<IActionResult> GetSyncHistory(string syncName, [FromQuery] int limit = 20)
        => Ok(await _svc.GetSyncHistoryAsync(syncName, Math.Clamp(limit, 1, 100)));

    [HttpPost("validation/run")]
    public async Task<IActionResult> RunValidation([FromQuery] string? ruleName = null) 
        => Ok(await _svc.RunValidationAsync(ruleName));
}

[ApiController]
[Route("api/[controller]")]
public class ServersController : ControllerBase
{
    private readonly IServerService _svc;

    public ServersController(IServerService svc) => _svc = svc;

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? environment,
        [FromQuery] string? application,
        [FromQuery] string? patchGroup,
        [FromQuery] string? search,
        [FromQuery] int limit = 100,
        [FromQuery] int offset = 0)
    {
        var servers = await _svc.ListServersAsync(environment, application, patchGroup, search,
            Math.Clamp(limit, 1, 1000), Math.Max(offset, 0));
        return Ok(servers);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var server = await _svc.GetServerByIdAsync(id);
        return server == null ? NotFound() : Ok(server);
    }

    [HttpGet("resolve/{name}")]
    public async Task<IActionResult> Resolve(string name)
    {
        var match = await _svc.ResolveServerNameAsync(name);
        return match == null ? NotFound() : Ok(match);
    }

    [HttpGet("unmatched")]
    public async Task<IActionResult> GetUnmatched(
        [FromQuery] string? sourceSystem,
        [FromQuery] int limit = 50)
    {
        return Ok(await _svc.GetUnmatchedServersAsync(sourceSystem, Math.Clamp(limit, 1, 500)));
    }

    [HttpPost("aliases")]
    public async Task<IActionResult> CreateAlias([FromBody] AliasRequest req)
    {
        await _svc.CreateAliasAsync(req.CanonicalName, req.AliasName, req.SourceSystem);
        return Ok();
    }

    [HttpPost("unmatched/{serverNameRaw}/resolve")]
    public async Task<IActionResult> ResolveUnmatched(string serverNameRaw, [FromBody] ResolveRequest req)
    {
        await _svc.ResolveUnmatchedServerAsync(serverNameRaw, req.ServerId);
        return Ok();
    }

    [HttpPost("unmatched/{serverNameRaw}/ignore")]
    public async Task<IActionResult> IgnoreUnmatched(string serverNameRaw)
    {
        await _svc.IgnoreUnmatchedServerAsync(serverNameRaw);
        return Ok();
    }

    public record AliasRequest(string CanonicalName, string AliasName, string? SourceSystem);
    public record ResolveRequest(int ServerId);
}

[ApiController]
[Route("api/[controller]")]
public class PatchingController : ControllerBase
{
    private readonly IPatchingService _svc;

    public PatchingController(IPatchingService svc) => _svc = svc;

    [HttpGet("next")]
    public async Task<IActionResult> GetNextSummary()
    {
        var summary = await _svc.GetNextPatchingSummaryAsync();
        return summary == null ? NotFound("No upcoming cycles") : Ok(summary);
    }

    [HttpGet("cycles")]
    public async Task<IActionResult> ListCycles(
        [FromQuery] bool upcomingOnly = true,
        [FromQuery] int limit = 10)
    {
        return Ok(await _svc.ListPatchCyclesAsync(upcomingOnly, Math.Clamp(limit, 1, 100)));
    }

    [HttpGet("cycles/{cycleId}/servers")]
    public async Task<IActionResult> GetCycleServers(
        int cycleId,
        [FromQuery] string? patchGroup,
        [FromQuery] bool? hasIssues)
    {
        return Ok(await _svc.GetCycleServersAsync(cycleId, patchGroup, hasIssues));
    }

    [HttpGet("issues")]
    public async Task<IActionResult> ListIssues(
        [FromQuery] string? severity,
        [FromQuery] string? application,
        [FromQuery] string? patchType,
        [FromQuery] bool activeOnly = true)
    {
        return Ok(await _svc.ListKnownIssuesAsync(severity, application, patchType, activeOnly));
    }

    [HttpGet("issues/{id}")]
    public async Task<IActionResult> GetIssue(int id)
    {
        var issue = await _svc.GetKnownIssueByIdAsync(id);
        return issue == null ? NotFound() : Ok(issue);
    }

    [HttpGet("windows")]
    public async Task<IActionResult> GetWindows() 
        => Ok(await _svc.GetPatchWindowsAsync());
}

[ApiController]
[Route("api/[controller]")]
public class CertificatesController : ControllerBase
{
    private readonly ICertificateService _svc;

    public CertificatesController(ICertificateService svc) => _svc = svc;

    [HttpGet("summary")]
    public async Task<IActionResult> GetSummary() 
        => Ok(await _svc.GetSummaryAsync());

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? alertLevel,
        [FromQuery] string? serverName,
        [FromQuery] int? daysUntilExpiry,
        [FromQuery] int limit = 100)
    {
        return Ok(await _svc.ListCertificatesAsync(alertLevel, serverName, daysUntilExpiry, Math.Clamp(limit, 1, 1000)));
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var cert = await _svc.GetByIdAsync(id);
        return cert == null ? NotFound() : Ok(cert);
    }

    [HttpGet("server/{serverName}")]
    public async Task<IActionResult> GetByServer(string serverName)
        => Ok(await _svc.GetByServerAsync(serverName));
}

[ApiController]
[Route("api/[controller]")]
public class EolController : ControllerBase
{
    private readonly IEolService _svc;

    public EolController(IEolService svc) => _svc = svc;

    [HttpGet("summary")]
    public async Task<IActionResult> GetSummary()
        => Ok(await _svc.GetSummaryAsync());

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? alertLevel,
        [FromQuery] string? product,
        [FromQuery] int limit = 100)
    {
        return Ok(await _svc.ListEolSoftwareAsync(alertLevel, product, Math.Clamp(limit, 1, 1000)));
    }

    [HttpGet("{product}/{version}")]
    public async Task<IActionResult> GetByProductVersion(string product, string version)
    {
        var detail = await _svc.GetByProductVersionAsync(product, version);
        return detail == null ? NotFound() : Ok(detail);
    }

    [HttpGet("server/{serverName}")]
    public async Task<IActionResult> GetByServer(string serverName)
        => Ok(await _svc.GetByServerAsync(serverName));
}

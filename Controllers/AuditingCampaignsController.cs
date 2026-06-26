using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>
/// Attestation campaigns (Surface 09, Governance group). Read-only in Slice 1 --
/// the dashboards list campaigns and drill into per-packet detail. Campaign
/// create / launch / close / remind arrive in later slices.
/// </summary>
[Authorize]
[ApiController]
[Route("api/auditing")]
[Produces("application/json")]
public class AuditingCampaignsController : ControllerBase
{
    private readonly IAuditingService _svc;

    public AuditingCampaignsController(IAuditingService svc) => _svc = svc;

    /// <summary>List campaigns (active first, then most-recently-closed), with progress counts.</summary>
    [HttpGet("campaigns")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> ListCampaigns()
        => Ok(await _svc.ListCampaignsAsync());

    /// <summary>Get one campaign with its packets (+ subjects), decisions and email log.</summary>
    [HttpGet("campaigns/{id}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetCampaign(int id)
    {
        var campaign = await _svc.GetCampaignAsync(id);
        return campaign == null ? NotFound() : Ok(campaign);
    }
}

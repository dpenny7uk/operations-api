using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Infrastructure;
using OperationsApi.Models;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>
/// Attestation campaigns (Surface 09, Governance group). Reads (list + per-packet
/// detail) expose access-recertification rosters (PII), so they require OpsAuditor;
/// launch and close require OpsAdmin.
/// </summary>
[Authorize]
[ApiController]
[Route("api/auditing")]
[Produces("application/json")]
public class AuditingCampaignsController : ControllerBase
{
    private readonly IAuditingService _svc;
    private readonly ICampaignService _campaigns;

    public AuditingCampaignsController(IAuditingService svc, ICampaignService campaigns)
    {
        _svc = svc;
        _campaigns = campaigns;
    }

    /// <summary>List campaigns (active first, then most-recently-closed), with progress counts.</summary>
    [HttpGet("campaigns")]
    [Authorize(Policy = "OpsAuditor")]
    [ProducesResponseType(200)]
    public async Task<IActionResult> ListCampaigns()
        => Ok(await _svc.ListCampaignsAsync());

    /// <summary>Get one campaign with its packets (+ subjects), decisions and email log.</summary>
    [HttpGet("campaigns/{id}")]
    [Authorize(Policy = "OpsAuditor")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetCampaign(int id)
    {
        var campaign = await _svc.GetCampaignAsync(id);
        return campaign == null ? NotFound() : Ok(campaign);
    }

    /// <summary>Launch a campaign for an application: builds packets + signed tokens
    /// from the bound groups' roster and activates it. Returns the minted attestation
    /// links (shown once). Requires OpsAdmin role.</summary>
    [HttpPost("campaigns/launch")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(201)]
    [ProducesResponseType(400)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> Launch([FromBody] CampaignLaunchRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Name))
            return BadRequest("name is required.");
        if (req.Name.Length > 255 || InputGuard.ContainsControlChars(req.Name))
            return BadRequest("name is invalid (max 255 characters).");
        if (req.ApplicationId <= 0)
            return BadRequest("application_id is required.");

        var actor = User.CurrentSam();
        // Launch-refusal states (no roster, no nominees, unrouteable + no fallback)
        // surface as a ConflictException -> 409 via the global exception handler.
        var result = await _campaigns.LaunchAsync(req, actor);
        return Created($"/api/auditing/campaigns/{result.CampaignId}", result);
    }

    /// <summary>Manually close a campaign. Requires OpsAdmin role.</summary>
    [HttpPost("campaigns/{id}/close")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Close(int id)
    {
        var actor = User.CurrentSam();
        var closed = await _campaigns.CloseAsync(id, actor);
        return closed ? Ok() : NotFound();
    }

    /// <summary>Re-send the attestation link to every not-yet-submitted recipient of
    /// an active campaign. Returns the number of reminders sent. Requires OpsAdmin role.</summary>
    [HttpPost("campaigns/{id}/remind")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> Remind(int id)
    {
        var actor = User.CurrentSam();
        var sent = await _campaigns.RemindAsync(id, actor);
        return Ok(new { sent });
    }

    /// <summary>Re-send the attestation link to a single recipient (packet) of an active
    /// campaign. Returns 1 if sent. Requires OpsAdmin role.</summary>
    [HttpPost("campaigns/{id}/packets/{packetId}/remind")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> RemindPacket(int id, Guid packetId)
    {
        var actor = User.CurrentSam();
        var sent = await _campaigns.RemindPacketAsync(id, packetId, actor);
        return Ok(new { sent });
    }
}

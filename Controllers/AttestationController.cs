using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Infrastructure;
using OperationsApi.Models;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>
/// Attestation surface (Surface 09). A recipient opens their link (attest.html?p=packetId),
/// reads the subjects in scope, and submits keep/revoke decisions. There is NO bearer token:
/// the caller is authenticated by the app's standard Windows Negotiate auth, and every
/// read/write verifies the caller's sAMAccountName equals the packet's recipient (403 otherwise),
/// so an authenticated user can only see and act on packets addressed to them. The mutating
/// POST is CSRF-guarded by the X-Requested-With middleware.
/// </summary>
[Authorize]
[ApiController]
[Route("api/auditing/attestation")]
[Produces("application/json")]
public class AttestationController : ControllerBase
{
    private readonly IAuditingService _svc;

    public AttestationController(IAuditingService svc) => _svc = svc;

    /// <summary>Load the attestation packet (subjects + state) for the signed-in recipient.
    /// 403 when the packet is addressed to a different user; 404 when it doesn't exist.</summary>
    [HttpGet("{packetId:guid}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(403)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Get(Guid packetId)
    {
        var result = await _svc.GetAttestationAsync(packetId, User.CurrentSam());
        return result.Outcome switch
        {
            AttestationGetOutcome.Ok => Ok(result.View),
            AttestationGetOutcome.Forbidden => StatusCode(403, "This attestation is not addressed to you."),
            _ => NotFound(),
        };
    }

    /// <summary>Submit keep/revoke decisions for the signed-in recipient's packet. 403 when the
    /// packet belongs to someone else; 409 (with the read-only view) when this packet — or, in
    /// nominees mode, the campaign — is already submitted.</summary>
    [HttpPost("{packetId:guid}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(403)]
    [ProducesResponseType(404)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> Submit(Guid packetId, [FromBody] AttestationSubmitRequest req)
    {
        if (req?.Decisions == null || req.Decisions.Count == 0)
            return BadRequest("At least one decision is required.");
        if (req.Decisions.Count > 5000)
            return BadRequest("Too many decisions.");

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        var result = await _svc.SubmitAttestationAsync(packetId, User.CurrentSam(), req.Decisions, ip);
        return result.Outcome switch
        {
            AttestationSubmitOutcome.Ok => Ok(result.View),
            AttestationSubmitOutcome.NotFound => NotFound(),
            AttestationSubmitOutcome.Forbidden => StatusCode(403, "This attestation is not addressed to you."),
            AttestationSubmitOutcome.BadRequest => BadRequest(result.Error ?? "Invalid submission."),
            AttestationSubmitOutcome.Conflict => Conflict(result.View),
            _ => StatusCode(500),
        };
    }
}

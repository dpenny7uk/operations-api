using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Models;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>
/// Public (anonymous) attestation surface (Surface 09, Slice 2). A recipient opens
/// a signed link (attest.html?t=token), reads the subjects in scope, and submits
/// keep/revoke decisions. There is no Windows auth here — the HMAC token IS the
/// credential. The mutating POST is still CSRF-guarded by the X-Requested-With
/// middleware. IIS must allow Anonymous Auth for /api/auditing/public/* (web.config),
/// and [AllowAnonymous] bypasses the global Negotiate fallback (proven by /healthz).
/// </summary>
[AllowAnonymous]
[ApiController]
[Route("api/auditing/public")]
[Produces("application/json")]
public class AttestationController : ControllerBase
{
    private readonly IAuditingService _svc;

    public AttestationController(IAuditingService svc) => _svc = svc;

    /// <summary>Resolve a signed token to its attestation packet (subjects + state).</summary>
    [HttpGet("attestation/{token}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Get(string token)
    {
        var view = await _svc.GetAttestationAsync(token);
        return view == null ? NotFound() : Ok(view);
    }

    /// <summary>Submit keep/revoke decisions for a token's packet. 409 (with the
    /// read-only view) when this packet — or, in nominees mode, the campaign — is
    /// already submitted.</summary>
    [HttpPost("attestation/{token}")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    [ProducesResponseType(409)]
    public async Task<IActionResult> Submit(string token, [FromBody] AttestationSubmitRequest req)
    {
        if (req?.Decisions == null || req.Decisions.Count == 0)
            return BadRequest("At least one decision is required.");
        if (req.Decisions.Count > 5000)
            return BadRequest("Too many decisions.");

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        var result = await _svc.SubmitAttestationAsync(token, req.Decisions, ip);
        return result.Outcome switch
        {
            AttestationSubmitOutcome.Ok => Ok(result.View),
            AttestationSubmitOutcome.NotFound => NotFound(),
            AttestationSubmitOutcome.BadRequest => BadRequest(result.Error ?? "Invalid submission."),
            AttestationSubmitOutcome.Conflict => Conflict(result.View),
            _ => StatusCode(500),
        };
    }
}

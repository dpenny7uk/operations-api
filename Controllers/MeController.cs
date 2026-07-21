using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OperationsApi.Infrastructure;

namespace OperationsApi.Controllers;

[Authorize]
[ApiController]
[Route("api/me")]
[Produces("application/json")]
public class MeController : ControllerBase
{
    /// <summary>Identity of the caller as seen by Windows Negotiate auth.</summary>
    [HttpGet]
    [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Client)]
    [ProducesResponseType(200)]
    public IActionResult Get()
    {
        var raw = User.Identity?.Name ?? "unknown";
        // Strip "DOMAIN\" prefix so the frontend gets just the username.
        var username = User.CurrentSam();
        return Ok(new { username, fullName = raw });
    }

    // Diagnostic: dump every claim the Negotiate handler put on the principal,
    // plus the OpsAdmin policy's configured role string and whether
    // User.IsInRole returns true for it. Use this to debug 403s on AdminRole-
    // gated endpoints without guessing at claim formats (SID vs DOMAIN\name vs
    // DNS-style prefix). Authenticated users only - same disclosure surface as
    // `whoami /claims` shows the user themselves.
    [HttpGet("claims")]
    [ProducesResponseType(200)]
    public IActionResult Claims([FromServices] IConfiguration config)
    {
        var adminRole = config.GetValue<string>("Authentication:AdminRole") ?? "";
        var auditorRole = config.GetValue<string>("Authentication:AuditorRole") ?? "";
        var raw = User.Identity?.Name ?? "unknown";
        var username = User.CurrentSam();
        var claims = User.Claims.Select(c => new
        {
            type = c.Type,
            value = c.Value,
            valueType = c.ValueType,
            issuer = c.Issuer,
        });
        var isAdmin = !string.IsNullOrEmpty(adminRole) && User.IsInRole(adminRole);
        // Admins satisfy OpsAuditor too - mirrors the policy in Program.cs.
        var isAuditor = isAdmin || (!string.IsNullOrEmpty(auditorRole) && User.IsInRole(auditorRole));
        return Ok(new
        {
            username,
            fullName = raw,
            authenticationType = User.Identity?.AuthenticationType,
            isAuthenticated = User.Identity?.IsAuthenticated ?? false,
            // Only surface the configured group names to users already in them, so a
            // non-privileged caller cannot enumerate the privileged AD groups from here.
            configuredAdminRole = isAdmin ? adminRole : null,
            isInConfiguredAdminRole = isAdmin,
            configuredAuditorRole = isAuditor ? auditorRole : null,
            isInConfiguredAuditorRole = isAuditor,
            claims,
        });
    }
}

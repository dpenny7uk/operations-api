using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace OperationsApi.Controllers;

/// <summary>Returns the currently authenticated user's identity.</summary>
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
        var username = raw.Contains('\\') ? raw.Split('\\', 2)[1] : raw;
        return Ok(new { username, fullName = raw });
    }
}

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using OperationsApi.Models;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>
/// Live AD user search (Surface 09) powering the business/technical owner pickers.
/// OpsAdmin only. Briefly cached to absorb typeahead keystrokes; an unreachable
/// directory returns 503 so the picker can fall back to a typed value.
/// </summary>
[Authorize]
[ApiController]
[Route("api/auditing/ad-users")]
[Produces("application/json")]
public class AdUsersController : ControllerBase
{
    private readonly IAdDirectoryService _ad;
    private readonly IMemoryCache _cache;
    private readonly ILogger<AdUsersController> _logger;

    public AdUsersController(IAdDirectoryService ad, IMemoryCache cache, ILogger<AdUsersController> logger)
    {
        _ad = ad;
        _cache = cache;
        _logger = logger;
    }

    /// <summary>Search AD users by name / sam / email (min 2 chars). Requires OpsAdmin.</summary>
    [HttpGet("search")]
    [Authorize(Policy = "OpsAdmin")]
    [ProducesResponseType(200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(503)]
    public IActionResult Search([FromQuery] string q = "", [FromQuery] int limit = 10)
    {
        var query = (q ?? "").Trim();
        if (query.Length < 2)
            return BadRequest("Provide at least 2 characters to search.");
        if (query.Length > 64 || InputGuard.ContainsControlChars(query))
            return BadRequest("Search term is invalid.");
        limit = Math.Clamp(limit, 1, 50);

        var key = $"adusers:{query.ToLowerInvariant()}:{limit}";
        if (_cache.TryGetValue(key, out List<AdUserResult>? cached))
            return Ok(cached);

        try
        {
            var results = _ad.SearchUsers(query, limit);
            _cache.Set(key, results, TimeSpan.FromSeconds(60));
            return Ok(results);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "AD user search failed for {Query}", query);
            return StatusCode(503, "AD search is unavailable. Try again shortly, or type the username directly.");
        }
    }
}

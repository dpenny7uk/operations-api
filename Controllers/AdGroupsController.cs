using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using OperationsApi.Models;
using OperationsApi.Services;

namespace OperationsApi.Controllers;

/// <summary>
/// Live AD group search (Surface 09, Slice 5) powering the binding picker. OpsAdmin
/// only. Results are cached briefly to absorb typeahead keystrokes; an unreachable
/// directory returns 503 (not 500) so the picker can fall back to a typed DN.
/// </summary>
[Authorize]
[ApiController]
[Route("api/auditing/ad-groups")]
[Produces("application/json")]
public class AdGroupsController : ControllerBase
{
    private readonly IAdDirectoryService _ad;
    private readonly IMemoryCache _cache;
    private readonly ILogger<AdGroupsController> _logger;

    public AdGroupsController(IAdDirectoryService ad, IMemoryCache cache, ILogger<AdGroupsController> logger)
    {
        _ad = ad;
        _cache = cache;
        _logger = logger;
    }

    /// <summary>Search AD groups by name fragment (min 2 chars). Requires OpsAdmin.</summary>
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

        var key = $"adgroups:{query.ToLowerInvariant()}:{limit}";
        if (_cache.TryGetValue(key, out List<AdGroupResult>? cached))
            return Ok(cached);

        try
        {
            var results = _ad.SearchGroups(query, limit);
            _cache.Set(key, results, TimeSpan.FromSeconds(60));
            return Ok(results);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "AD group search failed for {Query}", query);
            return StatusCode(503, "AD search is unavailable. Try again shortly, or type the group DN directly.");
        }
    }
}

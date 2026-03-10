using Microsoft.AspNetCore.Mvc;
using Moq;
using OperationsApi.Controllers;
using OperationsApi.Models;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Controllers;

public class HealthControllerTests
{
    private readonly Mock<IHealthService> _svc = new();
    private HealthController Controller => new(_svc.Object);

    // ── GetSummary ──────────────────────────────────────────────────────

    [Fact]
    public async Task GetSummary_returns_ok()
    {
        _svc.Setup(s => s.GetHealthSummaryAsync()).ReturnsAsync(new HealthSummary());
        var result = await Controller.GetSummary();
        Assert.IsType<OkObjectResult>(result);
    }

    // ── GetSyncStatuses ─────────────────────────────────────────────────

    [Fact]
    public async Task GetSyncStatuses_returns_ok()
    {
        _svc.Setup(s => s.GetSyncStatusesAsync()).ReturnsAsync([]);
        var result = await Controller.GetSyncStatuses();
        Assert.IsType<OkObjectResult>(result);
    }

    // ── GetSyncHistory ──────────────────────────────────────────────────

    [Fact]
    public async Task GetSyncHistory_returns_ok_for_valid_input()
    {
        _svc.Setup(s => s.GetSyncHistoryAsync("databricks_servers", 20)).ReturnsAsync([]);
        var result = await Controller.GetSyncHistory("databricks_servers");
        Assert.IsType<OkObjectResult>(result);
    }

    [Fact]
    public async Task GetSyncHistory_returns_bad_request_for_empty_name()
    {
        var result = await Controller.GetSyncHistory("");
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task GetSyncHistory_returns_bad_request_for_long_name()
    {
        var result = await Controller.GetSyncHistory(new string('a', 101));
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task GetSyncHistory_clamps_limit()
    {
        _svc.Setup(s => s.GetSyncHistoryAsync("test", 100)).ReturnsAsync([]);
        var result = await Controller.GetSyncHistory("test", 9999);
        Assert.IsType<OkObjectResult>(result);
        _svc.Verify(s => s.GetSyncHistoryAsync("test", 100), Times.Once);
    }

    // ── RunValidation ───────────────────────────────────────────────────

    [Fact]
    public async Task RunValidation_returns_ok_with_null_rule()
    {
        _svc.Setup(s => s.RunValidationAsync(null)).ReturnsAsync([]);
        var result = await Controller.RunValidation();
        Assert.IsType<OkObjectResult>(result);
    }

    [Fact]
    public async Task RunValidation_returns_ok_with_valid_rule()
    {
        _svc.Setup(s => s.RunValidationAsync("my_rule")).ReturnsAsync([]);
        var result = await Controller.RunValidation("my_rule");
        Assert.IsType<OkObjectResult>(result);
    }

    [Fact]
    public async Task RunValidation_returns_bad_request_for_long_rule()
    {
        var result = await Controller.RunValidation(new string('a', 101));
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task RunValidation_returns_bad_request_for_whitespace_rule()
    {
        var result = await Controller.RunValidation("   ");
        Assert.IsType<BadRequestObjectResult>(result);
    }
}

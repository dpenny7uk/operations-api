using Microsoft.AspNetCore.Mvc;
using Moq;
using OperationsApi.Controllers;
using OperationsApi.Models;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Controllers;

public class DisksControllerTests
{
    private readonly Mock<IDiskMonitoringService> _svc = new();
    private DisksController Controller => new(_svc.Object);

    private void SetupListReturnsEmpty()
        => _svc.Setup(s => s.ListDisksAsync(
                It.IsAny<int>(), It.IsAny<int>(),
                It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<int?>()))
            .ReturnsAsync(new PagedResult<Disk>());

    private void SetupSummaryReturnsEmpty()
        => _svc.Setup(s => s.GetSummaryAsync(
                It.IsAny<string?>(), It.IsAny<string?>(), It.IsAny<int?>()))
            .ReturnsAsync(new DiskSummary());

    [Fact]
    public async Task List_clamps_limit_at_5000()
    {
        SetupListReturnsEmpty();

        await Controller.List(limit: 9999, offset: 0);

        _svc.Verify(s => s.ListDisksAsync(5000, 0, null, null, null));
    }

    [Fact]
    public async Task List_clamps_limit_minimum_to_1()
    {
        SetupListReturnsEmpty();

        await Controller.List(limit: -10, offset: 0);

        _svc.Verify(s => s.ListDisksAsync(1, 0, null, null, null));
    }

    [Fact]
    public async Task List_floors_negative_offset_at_zero()
    {
        SetupListReturnsEmpty();

        await Controller.List(limit: 100, offset: -50);

        _svc.Verify(s => s.ListDisksAsync(100, 0, null, null, null));
    }

    [Fact]
    public async Task List_passes_environment_through_when_set()
    {
        SetupListReturnsEmpty();

        await Controller.List(limit: 100, offset: 0, environment: "Production");

        _svc.Verify(s => s.ListDisksAsync(100, 0, "Production", null, null));
    }

    [Fact]
    public async Task List_passes_business_unit_through_when_set()
    {
        SetupListReturnsEmpty();

        await Controller.List(limit: 100, offset: 0, businessUnit: "Contoso Group Support");

        _svc.Verify(s => s.ListDisksAsync(100, 0, null, "Contoso Group Support", null));
    }

    [Fact]
    public async Task List_composes_environment_and_business_unit()
    {
        SetupListReturnsEmpty();

        await Controller.List(limit: 100, offset: 0, environment: "Production", businessUnit: "Contoso UK");

        _svc.Verify(s => s.ListDisksAsync(100, 0, "Production", "Contoso UK", null));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task List_treats_blank_filters_as_no_filter(string? blank)
    {
        SetupListReturnsEmpty();

        await Controller.List(limit: 100, offset: 0, environment: blank, businessUnit: blank);

        _svc.Verify(s => s.ListDisksAsync(100, 0, null, null, null));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public async Task List_passes_valid_alert_status_through(int status)
    {
        SetupListReturnsEmpty();

        await Controller.List(limit: 100, offset: 0, alertStatus: status);

        _svc.Verify(s => s.ListDisksAsync(100, 0, null, null, status));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(4)]
    [InlineData(-1)]
    [InlineData(99)]
    public async Task List_clamps_invalid_alert_status_to_null(int status)
    {
        SetupListReturnsEmpty();

        await Controller.List(limit: 100, offset: 0, alertStatus: status);

        _svc.Verify(s => s.ListDisksAsync(100, 0, null, null, null));
    }

    [Fact]
    public async Task GetSummary_passes_filters_through()
    {
        SetupSummaryReturnsEmpty();

        await Controller.GetSummary(environment: "Production", businessUnit: "Contoso Group Support", alertStatus: 3);

        _svc.Verify(s => s.GetSummaryAsync("Production", "Contoso Group Support", 3));
    }

    [Fact]
    public async Task GetSummary_treats_blank_filters_as_no_filter()
    {
        SetupSummaryReturnsEmpty();

        await Controller.GetSummary(environment: "  ", businessUnit: "");

        _svc.Verify(s => s.GetSummaryAsync(null, null, null));
    }

    [Fact]
    public async Task GetSummary_clamps_invalid_alert_status_to_null()
    {
        SetupSummaryReturnsEmpty();

        await Controller.GetSummary(alertStatus: 99);

        _svc.Verify(s => s.GetSummaryAsync(null, null, null));
    }

    [Theory]
    [InlineData(null, "C:\\")]
    [InlineData("", "C:\\")]
    [InlineData("   ", "C:\\")]
    [InlineData("WEB01", null)]
    [InlineData("WEB01", "")]
    public async Task GetHistory_returns_BadRequest_for_empty_path_segment(string? server, string? disk)
    {
        var result = await Controller.GetHistory(server!, disk!);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task GetHistory_clamps_days_at_365()
    {
        _svc.Setup(s => s.GetHistoryAsync("WEB01", "C:\\", It.IsAny<int>()))
            .ReturnsAsync(Array.Empty<DiskHistoryPoint>());

        await Controller.GetHistory("WEB01", "C:\\", days: 9999);

        _svc.Verify(s => s.GetHistoryAsync("WEB01", "C:\\", 365));
    }

    [Fact]
    public async Task GetHistory_clamps_days_minimum_to_1()
    {
        _svc.Setup(s => s.GetHistoryAsync("WEB01", "C:\\", It.IsAny<int>()))
            .ReturnsAsync(Array.Empty<DiskHistoryPoint>());

        await Controller.GetHistory("WEB01", "C:\\", days: 0);

        _svc.Verify(s => s.GetHistoryAsync("WEB01", "C:\\", 1));
    }
}

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

    [Fact]
    public async Task List_clamps_limit_at_5000()
    {
        _svc.Setup(s => s.ListDisksAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<string?>()))
            .ReturnsAsync(new PagedResult<Disk>());

        await Controller.List(limit: 9999, offset: 0);

        _svc.Verify(s => s.ListDisksAsync(5000, 0, null, null));
    }

    [Fact]
    public async Task List_clamps_limit_minimum_to_1()
    {
        _svc.Setup(s => s.ListDisksAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<string?>()))
            .ReturnsAsync(new PagedResult<Disk>());

        await Controller.List(limit: -10, offset: 0);

        _svc.Verify(s => s.ListDisksAsync(1, 0, null, null));
    }

    [Fact]
    public async Task List_floors_negative_offset_at_zero()
    {
        _svc.Setup(s => s.ListDisksAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<string?>()))
            .ReturnsAsync(new PagedResult<Disk>());

        await Controller.List(limit: 100, offset: -50);

        _svc.Verify(s => s.ListDisksAsync(100, 0, null, null));
    }

    [Fact]
    public async Task List_passes_environment_through_when_set()
    {
        _svc.Setup(s => s.ListDisksAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<string?>()))
            .ReturnsAsync(new PagedResult<Disk>());

        await Controller.List(limit: 100, offset: 0, environment: "Production");

        _svc.Verify(s => s.ListDisksAsync(100, 0, "Production", null));
    }

    [Fact]
    public async Task List_passes_business_unit_through_when_set()
    {
        _svc.Setup(s => s.ListDisksAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<string?>()))
            .ReturnsAsync(new PagedResult<Disk>());

        await Controller.List(limit: 100, offset: 0, businessUnit: "Contoso Group Support");

        _svc.Verify(s => s.ListDisksAsync(100, 0, null, "Contoso Group Support"));
    }

    [Fact]
    public async Task List_composes_environment_and_business_unit()
    {
        _svc.Setup(s => s.ListDisksAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<string?>()))
            .ReturnsAsync(new PagedResult<Disk>());

        await Controller.List(limit: 100, offset: 0, environment: "Production", businessUnit: "Contoso UK");

        _svc.Verify(s => s.ListDisksAsync(100, 0, "Production", "Contoso UK"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task List_treats_blank_filters_as_no_filter(string? blank)
    {
        _svc.Setup(s => s.ListDisksAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<string?>()))
            .ReturnsAsync(new PagedResult<Disk>());

        await Controller.List(limit: 100, offset: 0, environment: blank, businessUnit: blank);

        _svc.Verify(s => s.ListDisksAsync(100, 0, null, null));
    }

    [Fact]
    public async Task GetSummary_passes_filters_through()
    {
        _svc.Setup(s => s.GetSummaryAsync(It.IsAny<string?>(), It.IsAny<string?>()))
            .ReturnsAsync(new DiskSummary());

        await Controller.GetSummary(environment: "Production", businessUnit: "Contoso Group Support");

        _svc.Verify(s => s.GetSummaryAsync("Production", "Contoso Group Support"));
    }

    [Fact]
    public async Task GetSummary_treats_blank_filters_as_no_filter()
    {
        _svc.Setup(s => s.GetSummaryAsync(It.IsAny<string?>(), It.IsAny<string?>()))
            .ReturnsAsync(new DiskSummary());

        await Controller.GetSummary(environment: "  ", businessUnit: "");

        _svc.Verify(s => s.GetSummaryAsync(null, null));
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

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
    public async Task List_clamps_limit_at_1000()
    {
        _svc.Setup(s => s.ListDisksAsync(It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(new PagedResult<Disk>());

        await Controller.List(limit: 5000, offset: 0);

        _svc.Verify(s => s.ListDisksAsync(1000, 0));
    }

    [Fact]
    public async Task List_clamps_limit_minimum_to_1()
    {
        _svc.Setup(s => s.ListDisksAsync(It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(new PagedResult<Disk>());

        await Controller.List(limit: -10, offset: 0);

        _svc.Verify(s => s.ListDisksAsync(1, 0));
    }

    [Fact]
    public async Task List_floors_negative_offset_at_zero()
    {
        _svc.Setup(s => s.ListDisksAsync(It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(new PagedResult<Disk>());

        await Controller.List(limit: 100, offset: -50);

        _svc.Verify(s => s.ListDisksAsync(100, 0));
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

using Microsoft.AspNetCore.Mvc;
using Moq;
using OperationsApi.Controllers;
using OperationsApi.Models;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Controllers;

public class PatchingControllerTests
{
    private readonly Mock<IPatchingService> _svc = new();
    private PatchingController Controller => new(_svc.Object);

    [Fact]
    public async Task GetNextSummary_returns_NotFound_when_null()
    {
        _svc.Setup(s => s.GetNextPatchingSummaryAsync()).ReturnsAsync((NextPatchingSummary?)null);

        var result = await Controller.GetNextSummary();

        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task ListCycles_clamps_limit()
    {
        _svc.Setup(s => s.ListPatchCyclesAsync(true, It.IsAny<int>()))
            .ReturnsAsync(Array.Empty<PatchCycle>());

        await Controller.ListCycles(upcomingOnly: true, limit: 500);

        _svc.Verify(s => s.ListPatchCyclesAsync(true, 100));
    }

    [Fact]
    public async Task GetCycleServers_clamps_limit()
    {
        _svc.Setup(s => s.GetCycleServersAsync(1, null, null, It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(new PagedResult<PatchScheduleItem>());

        await Controller.GetCycleServers(1, null, null, null, limit: 1000, offset: 0);

        _svc.Verify(s => s.GetCycleServersAsync(1, null, null, null, 500, 0));
    }
}

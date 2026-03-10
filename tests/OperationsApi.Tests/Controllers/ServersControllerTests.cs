using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;
using OperationsApi.Controllers;
using OperationsApi.Models;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Controllers;

public class ServersControllerTests
{
    private readonly Mock<IServerService> _svc = new();
    private readonly Mock<ILogger<ServersController>> _logger = new();
    private ServersController Controller => new(_svc.Object, _logger.Object);

    [Fact]
    public async Task List_clamps_limit_to_max_1000()
    {
        _svc.Setup(s => s.ListServersAsync(null, null, null, null, It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(Array.Empty<Server>());

        await Controller.List(null, null, null, null, limit: 5000, offset: 0);

        _svc.Verify(s => s.ListServersAsync(null, null, null, null, 1000, 0));
    }

    [Fact]
    public async Task List_clamps_limit_to_min_1()
    {
        _svc.Setup(s => s.ListServersAsync(null, null, null, null, It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(Array.Empty<Server>());

        await Controller.List(null, null, null, null, limit: -5, offset: 0);

        _svc.Verify(s => s.ListServersAsync(null, null, null, null, 1, 0));
    }

    [Fact]
    public async Task List_clamps_negative_offset_to_zero()
    {
        _svc.Setup(s => s.ListServersAsync(null, null, null, null, It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(Array.Empty<Server>());

        await Controller.List(null, null, null, null, limit: 100, offset: -10);

        _svc.Verify(s => s.ListServersAsync(null, null, null, null, 100, 0));
    }

    [Fact]
    public async Task GetById_returns_NotFound_when_null()
    {
        _svc.Setup(s => s.GetServerByIdAsync(999)).ReturnsAsync((ServerDetail?)null);

        var result = await Controller.GetById(999);

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task GetById_returns_Ok_when_found()
    {
        _svc.Setup(s => s.GetServerByIdAsync(1))
            .ReturnsAsync(new ServerDetail { ServerId = 1, ServerName = "SRV01" });

        var result = await Controller.GetById(1);

        Assert.IsType<OkObjectResult>(result);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Resolve_returns_BadRequest_for_empty_name(string? name)
    {
        var result = await Controller.Resolve(name!);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Resolve_returns_NotFound_when_no_match()
    {
        _svc.Setup(s => s.ResolveServerNameAsync("unknown")).ReturnsAsync((ServerMatch?)null);

        var result = await Controller.Resolve("unknown");

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task CreateAlias_returns_BadRequest_for_empty_canonical()
    {
        var req = new ServersController.AliasRequest("", "alias", null);

        var result = await Controller.CreateAlias(req);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task CreateAlias_returns_BadRequest_for_long_canonical()
    {
        var req = new ServersController.AliasRequest(new string('x', 256), "alias", null);

        var result = await Controller.CreateAlias(req);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task CreateAlias_returns_BadRequest_for_empty_alias()
    {
        var req = new ServersController.AliasRequest("canonical", "", null);

        var result = await Controller.CreateAlias(req);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task CreateAlias_returns_BadRequest_for_long_source()
    {
        var req = new ServersController.AliasRequest("canonical", "alias", new string('x', 101));

        var result = await Controller.CreateAlias(req);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task ResolveUnmatched_returns_BadRequest_for_invalid_serverId()
    {
        var req = new ServersController.ResolveRequest(0);

        var result = await Controller.ResolveUnmatched("raw", req);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task IgnoreUnmatched_returns_BadRequest_for_empty_name(string? name)
    {
        var result = await Controller.IgnoreUnmatched(name!);

        Assert.IsType<BadRequestObjectResult>(result);
    }
}

using Microsoft.AspNetCore.Mvc;
using Moq;
using OperationsApi.Controllers;
using OperationsApi.Models;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Controllers;

public class EolControllerTests
{
    private readonly Mock<IEolService> _svc = new();
    private EolController Controller => new(_svc.Object);

    [Fact]
    public async Task List_clamps_limit()
    {
        _svc.Setup(s => s.ListEolSoftwareAsync(null, null, It.IsAny<int>()))
            .ReturnsAsync(Array.Empty<EolSoftware>());

        await Controller.List(null, null, limit: 5000);

        _svc.Verify(s => s.ListEolSoftwareAsync(null, null, 1000));
    }

    [Theory]
    [InlineData(null, "1.0")]
    [InlineData("", "1.0")]
    [InlineData("   ", "1.0")]
    [InlineData("product", null)]
    [InlineData("product", "")]
    [InlineData("product", "   ")]
    public async Task GetByProductVersion_returns_BadRequest_for_empty_inputs(string? product, string? version)
    {
        var result = await Controller.GetByProductVersion(product!, version!);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task GetByProductVersion_returns_NotFound_when_null()
    {
        _svc.Setup(s => s.GetByProductVersionAsync("prod", "1.0"))
            .ReturnsAsync((EolSoftwareDetail?)null);

        var result = await Controller.GetByProductVersion("prod", "1.0");

        Assert.IsType<NotFoundResult>(result);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task GetByServer_returns_BadRequest_for_empty_name(string? name)
    {
        var result = await Controller.GetByServer(name!);

        Assert.IsType<BadRequestObjectResult>(result);
    }
}

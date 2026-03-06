using Microsoft.AspNetCore.Mvc;
using Moq;
using OperationsApi.Controllers;
using OperationsApi.Models;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Controllers;

public class CertificatesControllerTests
{
    private readonly Mock<ICertificateService> _svc = new();
    private CertificatesController Controller => new(_svc.Object);

    [Fact]
    public async Task List_clamps_negative_daysUntilExpiry_to_zero()
    {
        _svc.Setup(s => s.ListCertificatesAsync(null, null, It.IsAny<int?>(), It.IsAny<int>()))
            .ReturnsAsync(Array.Empty<Certificate>());

        await Controller.List(null, null, daysUntilExpiry: -5, limit: 100);

        _svc.Verify(s => s.ListCertificatesAsync(null, null, 0, 100));
    }

    [Fact]
    public async Task List_passes_null_when_daysUntilExpiry_not_provided()
    {
        _svc.Setup(s => s.ListCertificatesAsync(null, null, null, It.IsAny<int>()))
            .ReturnsAsync(Array.Empty<Certificate>());

        await Controller.List(null, null, daysUntilExpiry: null, limit: 100);

        _svc.Verify(s => s.ListCertificatesAsync(null, null, null, 100));
    }

    [Fact]
    public async Task List_clamps_limit()
    {
        _svc.Setup(s => s.ListCertificatesAsync(null, null, null, It.IsAny<int>()))
            .ReturnsAsync(Array.Empty<Certificate>());

        await Controller.List(null, null, null, limit: 5000);

        _svc.Verify(s => s.ListCertificatesAsync(null, null, null, 1000));
    }

    [Fact]
    public async Task GetById_returns_NotFound_when_null()
    {
        _svc.Setup(s => s.GetByIdAsync(999)).ReturnsAsync((CertificateDetail?)null);

        var result = await Controller.GetById(999);

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

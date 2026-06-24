using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using OperationsApi.Controllers;
using OperationsApi.Infrastructure;
using OperationsApi.Models;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Controllers;

public class LicensingControllerTests
{
    private readonly Mock<ILicensingService> _svc = new();

    // DefaultHttpContext gives a non-null User so the write actions' actor lookup
    // (User.Identity?.Name) resolves to null -> "unknown" instead of throwing.
    private LicensingController Controller() => new(_svc.Object)
    {
        ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
    };

    private static DateOnly Future(int days = 30) => DateOnly.FromDateTime(DateTime.Today).AddDays(days);

    private static LicenceDetail Sample(int id = 1) => new()
    {
        LicenceId = id, Vendor = "V", Product = "P", StatusFlag = "tracked", ExpiresAt = Future(),
    };

    // ── List ─────────────────────────────────────────────────────────

    [Fact]
    public async Task List_clamps_limit_to_1000()
    {
        _svc.Setup(s => s.ListAsync(null, null, null, It.IsAny<int>()))
            .ReturnsAsync(Array.Empty<LicenceDetail>());

        await Controller().List(null, null, null, limit: 5000);

        _svc.Verify(s => s.ListAsync(null, null, null, 1000));
    }

    [Fact]
    public async Task List_rejects_invalid_status()
    {
        var result = await Controller().List(status: "bogus");
        Assert.IsType<BadRequestObjectResult>(result);
    }

    // ── GetById ──────────────────────────────────────────────────────

    [Fact]
    public async Task GetById_returns_NotFound_when_null()
    {
        _svc.Setup(s => s.GetByIdAsync(999)).ReturnsAsync((LicenceDetail?)null);
        Assert.IsType<NotFoundResult>(await Controller().GetById(999));
    }

    // ── Create ───────────────────────────────────────────────────────

    [Theory]
    [InlineData("", "P")]   // missing vendor
    [InlineData("V", "")]   // missing product
    public async Task Create_requires_vendor_and_product(string vendor, string product)
    {
        var req = new LicenceCreateRequest { Vendor = vendor, Product = product, ExpiresAt = Future(10) };
        Assert.IsType<BadRequestObjectResult>(await Controller().Create(req));
    }

    [Fact]
    public async Task Create_rejects_invalid_status_flag()
    {
        var req = new LicenceCreateRequest { Vendor = "V", Product = "P", StatusFlag = "bogus", ExpiresAt = Future(10) };
        Assert.IsType<BadRequestObjectResult>(await Controller().Create(req));
    }

    [Fact]
    public async Task Create_returns_Created_with_location_on_valid_request()
    {
        _svc.Setup(s => s.CreateAsync(It.IsAny<LicenceCreateRequest>(), It.IsAny<string>()))
            .ReturnsAsync(Sample(7));

        var req = new LicenceCreateRequest { Vendor = "V", Product = "P", ExpiresAt = Future(10) };
        var result = await Controller().Create(req);

        var created = Assert.IsType<CreatedResult>(result);
        Assert.Equal("/api/licensing/licences/7", created.Location);
    }

    [Fact]
    public async Task Create_returns_Conflict_when_service_reports_duplicate()
    {
        _svc.Setup(s => s.CreateAsync(It.IsAny<LicenceCreateRequest>(), It.IsAny<string>()))
            .ThrowsAsync(new ConflictException("duplicate"));

        var req = new LicenceCreateRequest { Vendor = "V", Product = "P", ExpiresAt = Future(10) };
        Assert.IsType<ConflictObjectResult>(await Controller().Create(req));
    }

    // ── Update (PATCH) ───────────────────────────────────────────────

    [Fact]
    public async Task Update_rejects_invalid_status_flag()
    {
        var result = await Controller().Update(5, new LicencePatchRequest { StatusFlag = "bogus" });
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Update_returns_NotFound_when_service_returns_null()
    {
        _svc.Setup(s => s.PatchAsync(5, It.IsAny<LicencePatchRequest>(), It.IsAny<string>()))
            .ReturnsAsync((LicenceDetail?)null);

        var result = await Controller().Update(5, new LicencePatchRequest { StatusFlag = "engaged" });
        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task Update_returns_Ok_when_patched()
    {
        _svc.Setup(s => s.PatchAsync(5, It.IsAny<LicencePatchRequest>(), It.IsAny<string>()))
            .ReturnsAsync(Sample(5));

        var result = await Controller().Update(5, new LicencePatchRequest { StatusFlag = "engaged" });
        Assert.IsType<OkObjectResult>(result);
    }

    // ── Renew ────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_rejects_negative_quantity_held()
    {
        var req = new LicenceCreateRequest { Vendor = "V", Product = "P", QuantityHeld = -5, ExpiresAt = Future(10) };
        Assert.IsType<BadRequestObjectResult>(await Controller().Create(req));
    }

    [Fact]
    public async Task Create_rejects_expiry_more_than_20_years_out()
    {
        var req = new LicenceCreateRequest { Vendor = "V", Product = "P", ExpiresAt = Future(366 * 21) };
        Assert.IsType<BadRequestObjectResult>(await Controller().Create(req));
    }

    [Fact]
    public async Task Renew_rejects_past_new_expires()
    {
        var req = new LicenceRenewRequest { NewExpires = Future(-1) };
        Assert.IsType<BadRequestObjectResult>(await Controller().Renew(1, req));
    }

    [Fact]
    public async Task Renew_rejects_new_expires_more_than_20_years_out()
    {
        var req = new LicenceRenewRequest { NewExpires = Future(366 * 21) };
        Assert.IsType<BadRequestObjectResult>(await Controller().Renew(1, req));
    }

    [Fact]
    public async Task Renew_returns_NotFound_when_service_returns_null()
    {
        _svc.Setup(s => s.RenewAsync(9, It.IsAny<DateOnly>(), It.IsAny<string>(), It.IsAny<string>()))
            .ReturnsAsync((LicenceDetail?)null);

        var result = await Controller().Renew(9, new LicenceRenewRequest { NewExpires = Future(365) });
        Assert.IsType<NotFoundResult>(result);
    }

    // ── Delete ───────────────────────────────────────────────────────

    [Fact]
    public async Task Delete_returns_NotFound_when_not_removed()
    {
        _svc.Setup(s => s.DeleteAsync(3, It.IsAny<string>())).ReturnsAsync(false);
        Assert.IsType<NotFoundResult>(await Controller().Delete(3));
    }

    [Fact]
    public async Task Delete_returns_Ok_when_removed()
    {
        _svc.Setup(s => s.DeleteAsync(3, It.IsAny<string>())).ReturnsAsync(true);
        Assert.IsType<OkResult>(await Controller().Delete(3));
    }
}

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using OperationsApi.Controllers;
using OperationsApi.Infrastructure;
using OperationsApi.Models;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Controllers;

public class AuditingApplicationsControllerTests
{
    private readonly Mock<IAuditingService> _svc = new();

    // DefaultHttpContext gives a non-null User so the write actions' actor lookup
    // (User.Identity?.Name) resolves to null -> "unknown" instead of throwing.
    private AuditingApplicationsController Controller() => new(_svc.Object)
    {
        ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
    };

    private static AuditApplicationDetail SampleApp(int id = 1) => new()
    {
        ApplicationId = id, Name = "App", AuditRoutingMode = "line_manager", AuditDuePeriodDays = 21,
    };

    // ── Applications: list / get ─────────────────────────────────────

    [Fact]
    public async Task ListApplications_rejects_overlong_q()
    {
        var result = await Controller().ListApplications(new string('x', 256));
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task GetApplication_returns_NotFound_when_null()
    {
        _svc.Setup(s => s.GetApplicationAsync(999)).ReturnsAsync((AuditApplicationDetail?)null);
        Assert.IsType<NotFoundResult>(await Controller().GetApplication(999));
    }

    // ── Create ───────────────────────────────────────────────────────

    [Fact]
    public async Task CreateApplication_requires_name()
    {
        var req = new AppCreateRequest { Name = "" };
        Assert.IsType<BadRequestObjectResult>(await Controller().CreateApplication(req));
    }

    [Fact]
    public async Task CreateApplication_rejects_invalid_routing_mode()
    {
        var req = new AppCreateRequest { Name = "App", AuditRoutingMode = "bogus" };
        Assert.IsType<BadRequestObjectResult>(await Controller().CreateApplication(req));
    }

    [Fact]
    public async Task CreateApplication_rejects_out_of_range_due_period()
    {
        var req = new AppCreateRequest { Name = "App", AuditDuePeriodDays = 999 };
        Assert.IsType<BadRequestObjectResult>(await Controller().CreateApplication(req));
    }

    [Fact]
    public async Task CreateApplication_returns_Created_with_location()
    {
        _svc.Setup(s => s.CreateApplicationAsync(It.IsAny<AppCreateRequest>(), It.IsAny<string>()))
            .ReturnsAsync(SampleApp(7));

        var result = await Controller().CreateApplication(new AppCreateRequest { Name = "App" });

        var created = Assert.IsType<CreatedResult>(result);
        Assert.Equal("/api/auditing/applications/7", created.Location);
    }

    [Fact]
    public async Task CreateApplication_returns_Conflict_on_duplicate_name()
    {
        _svc.Setup(s => s.CreateApplicationAsync(It.IsAny<AppCreateRequest>(), It.IsAny<string>()))
            .ThrowsAsync(new ConflictException("duplicate"));

        Assert.IsType<ConflictObjectResult>(await Controller().CreateApplication(new AppCreateRequest { Name = "App" }));
    }

    // ── Patch ────────────────────────────────────────────────────────

    [Fact]
    public async Task UpdateApplication_rejects_invalid_routing_mode()
    {
        var result = await Controller().UpdateApplication(5, new AppPatchRequest { AuditRoutingMode = "bogus" });
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task UpdateApplication_accepts_due_period_up_to_365()
    {
        _svc.Setup(s => s.PatchApplicationAsync(5, It.IsAny<AppPatchRequest>(), It.IsAny<string>())).ReturnsAsync(SampleApp(5));
        Assert.IsType<OkObjectResult>(await Controller().UpdateApplication(5, new AppPatchRequest { AuditDuePeriodDays = 365 }));
    }

    [Fact]
    public async Task UpdateApplication_rejects_due_period_over_365()
    {
        Assert.IsType<BadRequestObjectResult>(await Controller().UpdateApplication(5, new AppPatchRequest { AuditDuePeriodDays = 366 }));
    }

    [Fact]
    public async Task UpdateApplication_returns_NotFound_when_service_returns_null()
    {
        _svc.Setup(s => s.PatchApplicationAsync(5, It.IsAny<AppPatchRequest>(), It.IsAny<string>()))
            .ReturnsAsync((AuditApplicationDetail?)null);

        var result = await Controller().UpdateApplication(5, new AppPatchRequest { AutoLaunch = true });
        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task UpdateApplication_returns_Ok_when_patched()
    {
        _svc.Setup(s => s.PatchApplicationAsync(5, It.IsAny<AppPatchRequest>(), It.IsAny<string>()))
            .ReturnsAsync(SampleApp(5));

        var result = await Controller().UpdateApplication(5, new AppPatchRequest { AutoLaunch = true });
        Assert.IsType<OkObjectResult>(result);
    }

    // ── Delete ───────────────────────────────────────────────────────

    [Fact]
    public async Task DeleteApplication_returns_NotFound_when_not_removed()
    {
        _svc.Setup(s => s.DeleteApplicationAsync(3, It.IsAny<string>())).ReturnsAsync(false);
        Assert.IsType<NotFoundResult>(await Controller().DeleteApplication(3));
    }

    [Fact]
    public async Task DeleteApplication_returns_Ok_when_removed()
    {
        _svc.Setup(s => s.DeleteApplicationAsync(3, It.IsAny<string>())).ReturnsAsync(true);
        Assert.IsType<OkResult>(await Controller().DeleteApplication(3));
    }

    [Fact]
    public async Task DeleteApplication_returns_Conflict_when_open_campaign()
    {
        _svc.Setup(s => s.DeleteApplicationAsync(3, It.IsAny<string>()))
            .ThrowsAsync(new ConflictException("open campaign"));
        Assert.IsType<ConflictObjectResult>(await Controller().DeleteApplication(3));
    }

    [Fact]
    public async Task UpdateApplication_returns_Conflict_on_duplicate_name()
    {
        _svc.Setup(s => s.PatchApplicationAsync(5, It.IsAny<AppPatchRequest>(), It.IsAny<string>()))
            .ThrowsAsync(new ConflictException("duplicate name"));
        Assert.IsType<ConflictObjectResult>(await Controller().UpdateApplication(5, new AppPatchRequest { Name = "Dup" }));
    }

    // ── Archive / restore ────────────────────────────────────────────

    [Fact]
    public async Task ArchiveApplication_returns_NotFound_when_missing()
    {
        _svc.Setup(s => s.ArchiveApplicationAsync(9, It.IsAny<string>())).ReturnsAsync((AuditApplicationDetail?)null);
        Assert.IsType<NotFoundResult>(await Controller().ArchiveApplication(9));
    }

    [Fact]
    public async Task ArchiveApplication_returns_Ok_with_app()
    {
        _svc.Setup(s => s.ArchiveApplicationAsync(5, It.IsAny<string>())).ReturnsAsync(SampleApp(5));
        Assert.IsType<OkObjectResult>(await Controller().ArchiveApplication(5));
    }

    [Fact]
    public async Task ArchiveApplication_returns_Conflict_when_open_campaign()
    {
        _svc.Setup(s => s.ArchiveApplicationAsync(5, It.IsAny<string>()))
            .ThrowsAsync(new ConflictException("open campaign"));
        Assert.IsType<ConflictObjectResult>(await Controller().ArchiveApplication(5));
    }

    [Fact]
    public async Task RestoreApplication_returns_NotFound_when_missing()
    {
        _svc.Setup(s => s.RestoreApplicationAsync(9, It.IsAny<string>())).ReturnsAsync((AuditApplicationDetail?)null);
        Assert.IsType<NotFoundResult>(await Controller().RestoreApplication(9));
    }

    [Fact]
    public async Task RestoreApplication_returns_Ok_with_app()
    {
        _svc.Setup(s => s.RestoreApplicationAsync(5, It.IsAny<string>())).ReturnsAsync(SampleApp(5));
        Assert.IsType<OkObjectResult>(await Controller().RestoreApplication(5));
    }

    // ── Bindings ─────────────────────────────────────────────────────

    [Fact]
    public async Task AddBinding_requires_group_dn()
    {
        var result = await Controller().AddBinding(1, new BindingCreateRequest { GroupDn = "" });
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task AddBinding_returns_NotFound_when_app_missing()
    {
        _svc.Setup(s => s.AddBindingAsync(1, It.IsAny<BindingCreateRequest>(), It.IsAny<string>()))
            .ReturnsAsync((AuditBinding?)null);

        var result = await Controller().AddBinding(1, new BindingCreateRequest { GroupDn = "CN=APP-X,DC=contoso,DC=com" });
        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task AddBinding_returns_Created_on_success()
    {
        _svc.Setup(s => s.AddBindingAsync(1, It.IsAny<BindingCreateRequest>(), It.IsAny<string>()))
            .ReturnsAsync(new AuditBinding { BindingId = 4, ApplicationId = 1, GroupDn = "CN=APP-X,DC=contoso,DC=com", IsActive = true });

        var result = await Controller().AddBinding(1, new BindingCreateRequest { GroupDn = "CN=APP-X,DC=contoso,DC=com" });
        Assert.IsType<CreatedResult>(result);
    }

    [Fact]
    public async Task AddBinding_returns_Conflict_on_duplicate()
    {
        _svc.Setup(s => s.AddBindingAsync(1, It.IsAny<BindingCreateRequest>(), It.IsAny<string>()))
            .ThrowsAsync(new ConflictException("dup"));

        var result = await Controller().AddBinding(1, new BindingCreateRequest { GroupDn = "CN=APP-X,DC=contoso,DC=com" });
        Assert.IsType<ConflictObjectResult>(result);
    }

    [Fact]
    public async Task RemoveBinding_returns_NotFound_when_not_removed()
    {
        _svc.Setup(s => s.RemoveBindingAsync(1, 9, It.IsAny<string>())).ReturnsAsync(false);
        Assert.IsType<NotFoundResult>(await Controller().RemoveBinding(1, 9));
    }

    // ── Nominees ─────────────────────────────────────────────────────

    [Fact]
    public async Task AddNominee_requires_nominee_sam()
    {
        var result = await Controller().AddNominee(1, new NomineeCreateRequest { NomineeSam = "" });
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task AddNominee_returns_NotFound_when_app_missing()
    {
        _svc.Setup(s => s.AddNomineeAsync(1, It.IsAny<NomineeCreateRequest>(), It.IsAny<string>()))
            .ReturnsAsync((AuditNominee?)null);

        var result = await Controller().AddNominee(1, new NomineeCreateRequest { NomineeSam = "sara.bennett" });
        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task AddNominee_returns_Conflict_on_duplicate()
    {
        _svc.Setup(s => s.AddNomineeAsync(1, It.IsAny<NomineeCreateRequest>(), It.IsAny<string>()))
            .ThrowsAsync(new ConflictException("dup"));

        var result = await Controller().AddNominee(1, new NomineeCreateRequest { NomineeSam = "sara.bennett" });
        Assert.IsType<ConflictObjectResult>(result);
    }

    [Fact]
    public async Task RemoveNominee_returns_Ok_when_removed()
    {
        _svc.Setup(s => s.RemoveNomineeAsync(1, 9)).ReturnsAsync(true);
        Assert.IsType<OkResult>(await Controller().RemoveNominee(1, 9));
    }
}

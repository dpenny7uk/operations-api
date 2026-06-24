using System.Text.Json;
using OperationsApi.Models;
using Xunit;

namespace OperationsApi.Tests.Serialization;

/// <summary>
/// Locks the licensing wire contract. The Licensing SPA page (op-pages.js /
/// licensing-demo-data.js) reads snake_case field names, so the DTOs carry
/// explicit [JsonPropertyName] attributes that override the API's default
/// camelCase policy. If anyone removes/renames one, the frontend silently reads
/// undefined — these tests fail first. Serialised with JsonSerializerDefaults.Web
/// to mirror what ASP.NET Core MVC actually uses.
/// </summary>
public class LicensingSerializationTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public void LicenceDetail_serialises_snake_case_matching_the_frontend()
    {
        var detail = new LicenceDetail
        {
            LicenceId = 7,
            ApplicationId = 3,
            ApplicationName = "Tableau Server",
            Vendor = "Tableau",
            Product = "Tableau Server",
            LicenceType = "User Client Access",
            QuantityHeld = 500,
            AuditFrequency = "Annual",
            AuditOwnerSam = "paul.griffin",
            ExpiresAt = new DateOnly(2026, 11, 22),
            NoticePeriodDays = 90,
            StatusFlag = "tracked",
            Notes = "n",
            Renewals =
            {
                new Renewal
                {
                    RenewalId = 1, LicenceId = 7,
                    CycleEnded = new DateOnly(2025, 11, 22),
                    RenewedOn = new DateOnly(2025, 11, 8),
                    NewExpires = new DateOnly(2026, 11, 22),
                    RenewedBy = "x",
                },
            },
        };

        var json = JsonSerializer.Serialize(detail, Web);

        Assert.Contains("\"licence_id\":7", json);
        Assert.Contains("\"application_id\":3", json);
        Assert.Contains("\"application_name\":", json);
        Assert.Contains("\"licence_type\":", json);
        Assert.Contains("\"quantity_held\":500", json);
        Assert.Contains("\"audit_frequency\":", json);
        Assert.Contains("\"audit_owner_sam\":", json);
        Assert.Contains("\"notice_period_days\":90", json);
        Assert.Contains("\"status_flag\":", json);
        // DateOnly emits ISO yyyy-MM-dd, which the frontend parses directly.
        Assert.Contains("\"expires_at\":\"2026-11-22\"", json);
        // Embedded renewal history (the list/detail hydrates the panel in one GET).
        Assert.Contains("\"renewals\":", json);
        Assert.Contains("\"new_expires\":\"2026-11-22\"", json);
        Assert.Contains("\"cycle_ended\":\"2025-11-22\"", json);

        // Guard against an accidental drop back to camelCase.
        Assert.DoesNotContain("licenceId", json);
        Assert.DoesNotContain("auditOwnerSam", json);
        Assert.DoesNotContain("quantityHeld", json);
    }

    [Fact]
    public void RenewRequest_binds_snake_case_body()
    {
        const string body = "{\"new_expires\":\"2027-01-15\",\"notes\":\"renewed\"}";

        var req = JsonSerializer.Deserialize<LicenceRenewRequest>(body, Web);

        Assert.NotNull(req);
        Assert.Equal(new DateOnly(2027, 1, 15), req!.NewExpires);
        Assert.Equal("renewed", req.Notes);
    }

    [Fact]
    public void CreateRequest_binds_snake_case_body()
    {
        const string body = """
            {"vendor":"Tableau","product":"Tableau Server","application_name":"Tableau Server",
             "licence_type":"User Client Access","quantity_held":500,"audit_frequency":"Annual",
             "audit_owner_sam":"paul.griffin","expires_at":"2026-11-22","notice_period_days":90,
             "status_flag":"tracked","notes":"n"}
            """;

        var req = JsonSerializer.Deserialize<LicenceCreateRequest>(body, Web);

        Assert.NotNull(req);
        Assert.Equal("Tableau", req!.Vendor);
        Assert.Equal("User Client Access", req.LicenceType);
        Assert.Equal(500, req.QuantityHeld);
        Assert.Equal("paul.griffin", req.AuditOwnerSam);
        Assert.Equal(new DateOnly(2026, 11, 22), req.ExpiresAt);
        Assert.Equal("tracked", req.StatusFlag);
    }
}

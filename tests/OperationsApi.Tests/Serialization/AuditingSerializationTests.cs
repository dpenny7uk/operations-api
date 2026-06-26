using System.Text.Json;
using OperationsApi.Models;
using Xunit;

namespace OperationsApi.Tests.Serialization;

/// <summary>
/// Locks the auditing wire contract. The Auditing SPA page (op-pages.js /
/// auditing-demo-data.js) reads snake_case field names, so the DTOs carry
/// explicit [JsonPropertyName] attributes that override the API's default
/// camelCase policy. If anyone removes/renames one, the frontend silently reads
/// undefined — these tests fail first. Serialised with JsonSerializerDefaults.Web
/// to mirror what ASP.NET Core MVC actually uses.
/// </summary>
public class AuditingSerializationTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public void ApplicationDetail_serialises_snake_case_matching_the_frontend()
    {
        var app = new AuditApplicationDetail
        {
            ApplicationId = 1,
            Name = "Atlassian Jira",
            BusinessOwner = "sara.bennett",
            TechnicalOwner = "tom.walsh",
            SupportEmail = "jira-support@contoso.com",
            AuditFrequencyMonths = 12,
            AutoLaunch = false,
            AuditRoutingMode = "nominees",
            AuditDuePeriodDays = 21,
            BindingCount = 2,
            NomineeCount = 3,
            Bindings = { new AuditBinding { BindingId = 5, ApplicationId = 1, GroupDn = "CN=APP-Jira-Users,OU=AppGroups,DC=contoso,DC=com", GroupSam = "APP-Jira-Users", GroupType = "Security", IsActive = true } },
            Nominees = { new AuditNominee { NomineeId = 9, ApplicationId = 1, NomineeSam = "sara.bennett", NomineeDisplayName = "Sara Bennett", NomineeEmail = "sara.bennett@contoso.com", RoleNote = "Tech owner" } },
        };

        var json = JsonSerializer.Serialize(app, Web);

        Assert.Contains("\"application_id\":1", json);
        Assert.Contains("\"name\":\"Atlassian Jira\"", json);
        Assert.Contains("\"business_owner\":", json);
        Assert.Contains("\"technical_owner\":", json);
        Assert.Contains("\"audit_frequency_months\":12", json);
        Assert.Contains("\"auto_launch\":false", json);
        Assert.Contains("\"audit_routing_mode\":\"nominees\"", json);
        Assert.Contains("\"audit_due_period_days\":21", json);
        Assert.Contains("\"binding_count\":2", json);
        Assert.Contains("\"nominee_count\":3", json);
        Assert.Contains("\"bindings\":", json);
        Assert.Contains("\"binding_id\":5", json);
        Assert.Contains("\"group_dn\":", json);
        Assert.Contains("\"nominees\":", json);
        Assert.Contains("\"nominee_sam\":\"sara.bennett\"", json);
        Assert.Contains("\"role_note\":", json);

        // Guard against an accidental drop back to camelCase.
        Assert.DoesNotContain("applicationId", json);
        Assert.DoesNotContain("auditRoutingMode", json);
        Assert.DoesNotContain("bindingCount", json);
    }

    [Fact]
    public void CampaignDetail_serialises_snake_case_including_packet_and_subject_shape()
    {
        var packetId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var campaign = new AuditCampaignDetail
        {
            CampaignId = 102,
            ApplicationId = 3,
            ApplicationName = "ServiceNow",
            Name = "2026 ServiceNow access review",
            Status = "active",
            DueAt = new DateTime(2026, 6, 3, 0, 0, 0, DateTimeKind.Utc),
            CreatedBy = "damian.penny",
            CreatedAt = new DateTime(2026, 5, 20, 8, 30, 0, DateTimeKind.Utc),
            ClosedByPacketId = null,
            LaunchKind = "manual",
            RoutingMode = "line_manager",
            ClosureMode = "all_packets",
            CcAuditMailbox = "group.userrecertification@contoso.com",
            PacketCount = 6,
            SubmittedCount = 2,
            Packets =
            {
                new AuditPacket
                {
                    PacketId = packetId, CampaignId = 102,
                    RecipientSam = "alice.chen", RecipientDisplay = "Alice Chen",
                    RecipientEmail = "alice.chen@contoso.com", RecipientKind = "manager",
                    Subjects = { new AuditPacketSubject { SubjectSam = "david.okafor", SubjectDisplay = "David Okafor" } },
                },
            },
            Decisions =
            {
                new AuditDecision { PacketId = packetId, SubjectSam = "david.okafor", SubjectDisplay = "David Okafor", Decision = "revoke", Comment = "Moved teams" },
            },
            EmailLog =
            {
                new AuditEmailLog { LogId = 21, PacketId = packetId, CampaignId = 102, ToAddr = "alice.chen@contoso.com", CcAddr = "group.userrecertification@contoso.com", Subject = "invite", Kind = "invite", Success = true },
            },
        };

        var json = JsonSerializer.Serialize(campaign, Web);

        Assert.Contains("\"campaign_id\":102", json);
        Assert.Contains("\"application_name\":\"ServiceNow\"", json);
        Assert.Contains("\"routing_mode\":\"line_manager\"", json);
        Assert.Contains("\"closure_mode\":\"all_packets\"", json);
        Assert.Contains("\"cc_audit_mailbox\":", json);
        Assert.Contains("\"packet_count\":6", json);
        Assert.Contains("\"submitted_count\":2", json);
        Assert.Contains("\"recipient_kind\":\"manager\"", json);
        Assert.Contains("\"recipient_display\":\"Alice Chen\"", json);
        // Intentional upgrade over the demo: subjects are { subject_sam, subject_display } objects.
        Assert.Contains("\"subjects\":", json);
        Assert.Contains("\"subject_sam\":\"david.okafor\"", json);
        Assert.Contains("\"subject_display\":\"David Okafor\"", json);
        Assert.Contains("\"decision\":\"revoke\"", json);
        Assert.Contains("\"to_addr\":", json);
        Assert.Contains("\"cc_addr\":", json);

        Assert.DoesNotContain("campaignId", json);
        Assert.DoesNotContain("closureMode", json);
        Assert.DoesNotContain("recipientKind", json);
    }

    [Fact]
    public void CreateRequest_binds_snake_case_body()
    {
        const string body = """
            {"name":"Confluence","business_owner":"sara.bennett","technical_owner":"tom.walsh",
             "support_email":"conf@contoso.com","audit_frequency_months":6,"auto_launch":true,
             "audit_routing_mode":"line_manager","audit_due_period_days":14}
            """;

        var req = JsonSerializer.Deserialize<AppCreateRequest>(body, Web);

        Assert.NotNull(req);
        Assert.Equal("Confluence", req!.Name);
        Assert.Equal("sara.bennett", req.BusinessOwner);
        Assert.Equal(6, req.AuditFrequencyMonths);
        Assert.True(req.AutoLaunch);
        Assert.Equal("line_manager", req.AuditRoutingMode);
        Assert.Equal(14, req.AuditDuePeriodDays);
    }

    [Fact]
    public void BindingRequest_binds_snake_case_body()
    {
        const string body = "{\"group_dn\":\"CN=APP-X,OU=AppGroups,DC=contoso,DC=com\",\"group_sam\":\"APP-X\",\"group_type\":\"Security\"}";

        var req = JsonSerializer.Deserialize<BindingCreateRequest>(body, Web);

        Assert.NotNull(req);
        Assert.Equal("CN=APP-X,OU=AppGroups,DC=contoso,DC=com", req!.GroupDn);
        Assert.Equal("APP-X", req.GroupSam);
        Assert.Equal("Security", req.GroupType);
    }
}

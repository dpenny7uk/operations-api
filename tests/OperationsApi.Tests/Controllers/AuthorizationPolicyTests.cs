using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using OperationsApi.Controllers;
using Xunit;

namespace OperationsApi.Tests.Controllers;

// Guards the fix for the "OpsAuditor policy defined but never applied" finding: the
// auditing/licensing read actions expose access-governance / commercial data and must
// carry [Authorize(Policy = "OpsAuditor")]. If someone drops the attribute, this fails.
public class AuthorizationPolicyTests
{
    [Theory]
    [InlineData(typeof(AuditingCampaignsController), "ListCampaigns")]
    [InlineData(typeof(AuditingCampaignsController), "GetCampaign")]
    [InlineData(typeof(AuditingApplicationsController), "ListApplications")]
    [InlineData(typeof(AuditingApplicationsController), "GetApplication")]
    [InlineData(typeof(LicensingController), "List")]
    [InlineData(typeof(LicensingController), "GetById")]
    public void Read_endpoints_require_OpsAuditor(Type controller, string method)
    {
        var m = controller.GetMethod(method)
            ?? throw new Xunit.Sdk.XunitException($"{controller.Name}.{method} not found");
        var attrs = m.GetCustomAttributes<AuthorizeAttribute>(inherit: true);
        Assert.Contains(attrs, a => a.Policy == "OpsAuditor");
    }
}

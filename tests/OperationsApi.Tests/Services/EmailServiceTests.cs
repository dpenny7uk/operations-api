using System.Collections.Generic;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using OperationsApi.Services;
using Xunit;

namespace OperationsApi.Tests.Services;

/// <summary>
/// Pure unit tests for SmtpEmailService's guard paths (no SMTP server). These prove
/// it degrades to a failure result rather than throwing when misconfigured, which is
/// what keeps the rest of auditing working before SMTP is wired up.
/// </summary>
public class EmailServiceTests
{
    private static SmtpEmailService Svc(Dictionary<string, string?> cfg)
        => new(new ConfigurationBuilder().AddInMemoryCollection(cfg).Build(), NullLogger<SmtpEmailService>.Instance);

    [Fact]
    public async Task Returns_failure_when_smtp_not_configured()
    {
        var svc = Svc(new Dictionary<string, string?>());
        var res = await svc.SendAsync(new EmailRequest { To = "a@b.com", Subject = "s", TextBody = "t" });
        Assert.False(res.Success);
        Assert.Contains("not configured", res.Response);
    }

    [Fact]
    public async Task Returns_failure_when_no_recipient()
    {
        var svc = Svc(new Dictionary<string, string?> { ["Smtp:Host"] = "localhost", ["Smtp:From"] = "x@y.com" });
        var res = await svc.SendAsync(new EmailRequest { To = "", Subject = "s", TextBody = "t" });
        Assert.False(res.Success);
        Assert.Contains("recipient", res.Response);
    }
}

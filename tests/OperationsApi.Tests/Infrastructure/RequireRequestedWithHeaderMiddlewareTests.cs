using Microsoft.AspNetCore.Http;
using OperationsApi.Infrastructure;
using Xunit;

namespace OperationsApi.Tests.Infrastructure;

public class RequireRequestedWithHeaderMiddlewareTests
{
    private static async Task<(int status, bool nextCalled)> Invoke(string method, string path, string? header)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Method = method;
        ctx.Request.Path   = path;
        if (header != null) ctx.Request.Headers["X-Requested-With"] = header;
        ctx.Response.Body  = new MemoryStream();

        var nextCalled = false;
        var mw = new RequireRequestedWithHeaderMiddleware(_ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });
        await mw.InvokeAsync(ctx);
        return (ctx.Response.StatusCode, nextCalled);
    }

    [Theory]
    [InlineData("POST")]
    [InlineData("PATCH")]
    [InlineData("DELETE")]
    [InlineData("PUT")]
    public async Task Write_methods_without_header_return_403(string method)
    {
        var (status, nextCalled) = await Invoke(method, "/api/patching/exclusions", null);

        Assert.Equal(StatusCodes.Status403Forbidden, status);
        Assert.False(nextCalled);
    }

    [Theory]
    [InlineData("POST")]
    [InlineData("PATCH")]
    [InlineData("DELETE")]
    [InlineData("PUT")]
    public async Task Write_methods_with_correct_header_call_next(string method)
    {
        var (status, nextCalled) = await Invoke(method, "/api/patching/exclusions", "ops-api");

        Assert.Equal(200, status);
        Assert.True(nextCalled);
    }

    [Theory]
    [InlineData("ops-api ")]    // trailing space
    [InlineData(" ops-api")]    // leading space
    [InlineData("OPS-API")]     // wrong case — must be byte-exact
    [InlineData("XMLHttpRequest")]
    [InlineData("")]
    public async Task Wrong_header_values_return_403(string headerValue)
    {
        var (status, nextCalled) = await Invoke("POST", "/api/patching/exclusions", headerValue);

        Assert.Equal(StatusCodes.Status403Forbidden, status);
        Assert.False(nextCalled);
    }

    [Theory]
    [InlineData("GET")]
    [InlineData("HEAD")]
    [InlineData("OPTIONS")]
    public async Task Read_methods_skip_check(string method)
    {
        var (status, nextCalled) = await Invoke(method, "/api/servers", null);

        Assert.Equal(200, status);
        Assert.True(nextCalled);
    }

    [Theory]
    [InlineData("/healthz")]
    [InlineData("/healthz/")]
    public async Task Healthz_is_exempt(string path)
    {
        var (status, nextCalled) = await Invoke("POST", path, null);

        Assert.Equal(200, status);
        Assert.True(nextCalled);
    }
}

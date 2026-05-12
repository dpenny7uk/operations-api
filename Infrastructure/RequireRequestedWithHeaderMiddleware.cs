using Microsoft.AspNetCore.Http;

namespace OperationsApi.Infrastructure;

// CSRF defence for SPA + Windows Negotiate auth. Browsers cannot set custom
// headers on simple cross-origin requests (a fetch with a custom header
// triggers a CORS preflight that the AllowedOrigins policy will reject for
// unknown origins), so requiring X-Requested-With on writes blocks classic
// form-based CSRF without the weight of antiforgery cookies/tokens.
//
// Threat model: another internal site within the same SSO realm forges a
// POST/PATCH/DELETE against /api/. Cookie-token antiforgery is the textbook
// fix for cookie-auth flows; for Negotiate + same-origin SPA this header
// check is the equivalent and what ASP.NET Core's own docs recommend.
//
// /healthz is bypassed because it's AllowAnonymous and probed by external
// monitoring that cannot be assumed to set the header.
public sealed class RequireRequestedWithHeaderMiddleware
{
    public const string HeaderName  = "X-Requested-With";
    public const string HeaderValue = "ops-api";

    private readonly RequestDelegate _next;

    public RequireRequestedWithHeaderMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        if (RequiresHeader(context.Request) && !HasValidHeader(context.Request))
        {
            context.Response.StatusCode  = StatusCodes.Status403Forbidden;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(
                "{\"error\":\"Missing or invalid X-Requested-With header.\"}");
            return;
        }
        await _next(context);
    }

    private static bool RequiresHeader(HttpRequest req)
    {
        if (HttpMethods.IsGet(req.Method) || HttpMethods.IsHead(req.Method)
            || HttpMethods.IsOptions(req.Method))
            return false;
        // /healthz is AllowAnonymous and probed by external monitoring.
        if (req.Path.StartsWithSegments("/healthz")) return false;
        // Scope to JSON writes — the only shape the SPA actually issues.
        return HttpMethods.IsPost(req.Method)
            || HttpMethods.IsPatch(req.Method)
            || HttpMethods.IsDelete(req.Method)
            || HttpMethods.IsPut(req.Method);
    }

    private static bool HasValidHeader(HttpRequest req)
        => req.Headers.TryGetValue(HeaderName, out var values)
           && string.Equals(values.ToString(), HeaderValue, StringComparison.Ordinal);
}

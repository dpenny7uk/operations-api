using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics;
using Npgsql;
using Scalar.AspNetCore;
using System.Data;
using System.Threading.RateLimiting;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Services;

SqlMapper.AddTypeHandler(new DateOnlyTypeHandler());

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

// Authentication
var authMode = config.GetValue<string>("Authentication:Mode") ?? "Windows";
var authEnabled = !authMode.Equals("none", StringComparison.OrdinalIgnoreCase);
if (!authEnabled && !builder.Environment.IsDevelopment())
{
    throw new InvalidOperationException("Authentication cannot be disabled in non-development environments. Remove Authentication:Mode=none from configuration.");
}
var adminRole = config.GetValue<string>("Authentication:AdminRole") ?? "";
if (authEnabled)
{
    builder.Services
        .AddAuthentication(NegotiateDefaults.AuthenticationScheme)
        .AddNegotiate();
    builder.Services.AddAuthorization(options =>
    {
        options.FallbackPolicy = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .Build();
        if (!string.IsNullOrWhiteSpace(adminRole))
        {
            options.AddPolicy("OpsAdmin", policy => policy.RequireRole(adminRole));
        }
        else
        {
            options.AddPolicy("OpsAdmin", policy => policy.RequireAuthenticatedUser());
        }
    });
}
else
{
    builder.Services.AddAuthorization(options =>
    {
        options.AddPolicy("OpsAdmin", policy => policy.RequireAssertion(_ => true));
    });
}

// Database connection
builder.Services.AddScoped<IDbConnection>(sp =>
{
    var connString = config.GetConnectionString("OperationsDb");
    if (string.IsNullOrEmpty(connString))
        throw new InvalidOperationException("Connection string 'OperationsDb' is not configured. Set it in appsettings.json or environment variables.");

    var conn = new NpgsqlConnection(connString);
    conn.Open();
    return conn;
});

// Services
builder.Services.AddScoped<IHealthService, HealthService>();
builder.Services.AddScoped<IServerService, ServerService>();
builder.Services.AddScoped<IPatchingService, PatchingService>();
builder.Services.AddScoped<ICertificateService, CertificateService>();
builder.Services.AddScoped<IEolService, EolService>();

// API configuration
builder.Services.AddControllers();
builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer((doc, ctx, ct) =>
    {
        doc.Info.Title = "GES Operations API";
        doc.Info.Version = "v1";
        doc.Info.Description = "Server inventory, patching, certificate monitoring, and end-of-life tracking for GES Operations.";
        return Task.CompletedTask;
    });
});

var allowedOrigins = config.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .WithMethods("GET", "POST")
              .WithHeaders("Content-Type")
              .AllowCredentials();
    });
});

// Rate limiting
builder.Services.AddRateLimiter(options =>
{
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.User.Identity?.Name ?? context.Connection.RemoteIpAddress?.ToString() ?? Guid.NewGuid().ToString(),
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 60,
                Window = TimeSpan.FromMinutes(1)
            }));
    options.RejectionStatusCode = 429;
});

// Health checks
var connStr = config.GetConnectionString("OperationsDb");
var healthChecks = builder.Services.AddHealthChecks();
if (!string.IsNullOrEmpty(connStr))
{
    healthChecks.AddNpgSql(connStr);
}

var app = builder.Build();

if (allowedOrigins.Length == 0 && !app.Environment.IsDevelopment())
{
    throw new InvalidOperationException("Cors:AllowedOrigins must be configured in non-development environments.");
}
else if (allowedOrigins.Length == 0)
{
    app.Logger.LogWarning("No CORS origins configured in Cors:AllowedOrigins — cross-origin requests will be blocked");
}

// Middleware pipeline
app.UseExceptionHandler(error => error.Run(async context =>
{
    var correlationId = context.TraceIdentifier;
    var ex = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("ExceptionHandler");
    logger.LogError(ex, "Unhandled exception on {Method} {Path} [CorrelationId={CorrelationId}]",
        context.Request.Method, context.Request.Path, correlationId);

    context.Response.StatusCode = 500;
    context.Response.ContentType = "application/json";
    await context.Response.WriteAsJsonAsync(new { error = "An internal server error occurred.", correlationId });
}));

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}
app.UseHttpsRedirection();
app.UseCors();
app.UseRateLimiter();

if (authEnabled)
{
    app.UseAuthentication();
}
app.UseAuthorization();

app.UseDefaultFiles();
app.UseStaticFiles();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
    app.MapGet("/", () => Results.Redirect("/scalar/v1"));
}

// Endpoints
app.MapHealthChecks("/healthz", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
{
    ResponseWriter = (context, _) =>
    {
        context.Response.ContentType = "text/plain";
        return context.Response.WriteAsync(context.Response.StatusCode == 200 ? "Healthy" : "Unhealthy");
    }
}).AllowAnonymous();
app.MapControllers();

app.Run();

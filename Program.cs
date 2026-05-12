using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Npgsql;
using Scalar.AspNetCore;
using Serilog;
using Serilog.Events;
using Serilog.Formatting.Compact;
using System.Data;
using System.Threading.RateLimiting;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Services;

SqlMapper.AddTypeHandler(new DateOnlyTypeHandler());

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
    .MinimumLevel.Override("Microsoft.Hosting", LogEventLevel.Information)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("Application", "OperationsApi")
    .WriteTo.Console(new RenderedCompactJsonFormatter())
    .CreateBootstrapLogger();

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSerilog((ctx, services, cfg) =>
{
    cfg.MinimumLevel.Is(ctx.HostingEnvironment.IsDevelopment() ? LogEventLevel.Debug : LogEventLevel.Information)
       .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
       .MinimumLevel.Override("Microsoft.Hosting", LogEventLevel.Information)
       .Enrich.FromLogContext()
       .Enrich.WithProperty("Application", "OperationsApi")
       .WriteTo.Console(new RenderedCompactJsonFormatter());
});
var config = builder.Configuration;

// Fail fast if connection string is missing - don't wait for first request
var connStringCheck = config.GetConnectionString("OperationsDb");
if (string.IsNullOrEmpty(connStringCheck) && !builder.Environment.IsDevelopment())
    throw new InvalidOperationException("Connection string 'OperationsDb' is not configured. Set it in appsettings.json or environment variables.");

// Authentication - Windows Negotiate (Kerberos/NTLM) is always required.
// There is no bypass mode. For local development without Active Directory,
// configure a test account in IIS Express or use a mocked auth middleware in a test project.
var adminRole = config.GetValue<string>("Authentication:AdminRole") ?? "";
builder.Services
    .AddAuthentication(NegotiateDefaults.AuthenticationScheme)
    .AddNegotiate();
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
    if (!string.IsNullOrWhiteSpace(adminRole))
        options.AddPolicy("OpsAdmin", policy => policy.RequireRole(adminRole));
    else
        options.AddPolicy("OpsAdmin", policy => policy.RequireAuthenticatedUser());
});

// Database connection - explicit pool settings for production predictability
builder.Services.AddScoped<IDbConnection>(sp =>
{
    var connString = config.GetConnectionString("OperationsDb");
    if (string.IsNullOrEmpty(connString))
        throw new InvalidOperationException("Connection string 'OperationsDb' is not configured. Set it in appsettings.json or environment variables.");

    var csb = new NpgsqlConnectionStringBuilder(connString)
    {
        MaxPoolSize = 30,
        MinPoolSize = 2,
        ConnectionIdleLifetime = 300,
        CommandTimeout = 30,
    };
    return new NpgsqlConnection(csb.ConnectionString);
});

// Services
builder.Services.AddScoped<IHealthService, HealthService>();
builder.Services.AddScoped<IServerService, ServerService>();
builder.Services.AddScoped<IPatchingService, PatchingService>();
builder.Services.AddScoped<ICertificateService, CertificateService>();
builder.Services.AddScoped<IEolService, EolService>();
builder.Services.AddScoped<IPatchExclusionService, PatchExclusionService>();
builder.Services.AddScoped<IAlertsService, AlertsService>();
builder.Services.AddScoped<IDiskMonitoringService, DiskMonitoringService>();

// API configuration
builder.WebHost.ConfigureKestrel(options =>
    options.Limits.MaxRequestBodySize = 10 * 1024 * 1024); // 10 MB
builder.Services.AddControllers();
builder.Services.AddResponseCaching();
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
            context.User.Identity?.Name ?? context.Connection.RemoteIpAddress?.ToString() ?? "anonymous",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 200,
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
    app.Logger.LogWarning("No CORS origins configured in Cors:AllowedOrigins - cross-origin requests will be blocked");
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

app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<OperationsApi.Infrastructure.RequireRequestedWithHeaderMiddleware>();
app.UseRateLimiter();
app.UseResponseCaching();
app.UseSerilogRequestLogging();

// Expose application version in every response for observability and post-deploy verification
var appVersion = typeof(Program).Assembly.GetName().Version?.ToString() ?? "unknown";
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers["X-App-Version"] = appVersion;
    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
    app.MapGet("/", () => Results.Redirect("/scalar/v1"));
}

// Endpoints
app.MapHealthChecks("/healthz", new HealthCheckOptions
{
    ResponseWriter = async (context, report) =>
    {
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsJsonAsync(new
        {
            status = report.Status.ToString(),
            checks = report.Entries.Select(e => new
            {
                name = e.Key,
                status = e.Value.Status.ToString(),
                description = e.Value.Description,
                duration = e.Value.Duration.TotalMilliseconds
            }),
            version = typeof(Program).Assembly.GetName().Version?.ToString(3),
            timestamp = DateTime.UtcNow
        });
    }
}).AllowAnonymous();
app.MapControllers();

app.Run();

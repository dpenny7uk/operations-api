using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics;
using Npgsql;
using Scalar.AspNetCore;
using System.Data;
using OperationsApi.Services;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

// Authentication
var authMode = config.GetValue<string>("Authentication:Mode") ?? "Windows";
var authEnabled = !authMode.Equals("none", StringComparison.OrdinalIgnoreCase);
if (!authEnabled && !builder.Environment.IsDevelopment())
{
    Console.WriteLine("WARNING: Authentication is disabled (Authentication:Mode=none) in a non-development environment!");
}
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
    });
}
else
{
    builder.Services.AddAuthorization();
}

// Database connection
builder.Services.AddScoped<IDbConnection>(sp =>
{
    var connString = config.GetConnectionString("OperationsDb")
        ?? throw new InvalidOperationException("Connection string 'OperationsDb' not found");

    return new NpgsqlConnection(connString);
});

// Services
builder.Services.AddScoped<IHealthService, HealthService>();
builder.Services.AddScoped<IServerService, ServerService>();
builder.Services.AddScoped<IPatchingService, PatchingService>();
builder.Services.AddScoped<ICertificateService, CertificateService>();
builder.Services.AddScoped<IEolService, EolService>();

// API configuration
builder.Services.AddControllers();
builder.Services.AddOpenApi();

var allowedOrigins = config.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials();
    });
});

// Health checks
var connStr = config.GetConnectionString("OperationsDb");
if (!string.IsNullOrEmpty(connStr))
{
    builder.Services.AddHealthChecks().AddNpgSql(connStr);
}

var app = builder.Build();

if (allowedOrigins.Length == 0)
{
    app.Logger.LogWarning("No CORS origins configured in Cors:AllowedOrigins — cross-origin requests will be blocked");
}

// Middleware pipeline
app.UseExceptionHandler(error => error.Run(async context =>
{
    var ex = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("ExceptionHandler");
    logger.LogError(ex, "Unhandled exception on {Method} {Path}", context.Request.Method, context.Request.Path);

    context.Response.StatusCode = 500;
    context.Response.ContentType = "application/json";
    await context.Response.WriteAsJsonAsync(new { error = "An internal server error occurred." });
}));

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}
app.UseHttpsRedirection();
app.UseCors();

if (authEnabled)
{
    app.UseAuthentication();
}
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
    app.MapGet("/", () => Results.Redirect("/scalar/v1"));
}

// Endpoints
app.MapHealthChecks("/healthz").AllowAnonymous();
app.MapControllers();

app.Run();

using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Authorization;
using Npgsql;
using Scalar.AspNetCore;
using System.Data;
using OperationsApi.Services;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

// Authentication
var authMode = config.GetValue<string>("Authentication:Mode") ?? "Windows";
if (authMode.ToLower() != "none")
{
    builder.Services
        .AddAuthentication(NegotiateDefaults.AuthenticationScheme)
        .AddNegotiate();
}
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});

// Database connection
builder.Services.AddScoped<IDbConnection>(sp =>
{
    var connString = config.GetConnectionString("OperationsDb")
        ?? throw new InvalidOperationException("Connection string 'OperationsDb' not found");

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

// Middleware pipeline
app.UseHttpsRedirection();
app.UseCors();

if (authMode.ToLower() != "none")
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

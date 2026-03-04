using Microsoft.AspNetCore.Authentication.Negotiate;
using Npgsql;
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
builder.Services.AddAuthorization();

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

// API configuration
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
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
app.UseSwagger();
app.UseSwaggerUI();
app.UseCors();

if (authMode.ToLower() != "none")
{
    app.UseAuthentication();
}
app.UseAuthorization();

// Endpoints
app.MapHealthChecks("/healthz");
app.MapControllers();
app.MapGet("/", () => Results.Redirect("/swagger"));

app.Run();

using Npgsql;
using Testcontainers.PostgreSql;
using Xunit;

namespace OperationsApi.Tests.Integration;

/// <summary>
/// Spins up a PostgreSQL container, runs all migration scripts, and seeds test data.
/// Shared across all integration test classes via ICollectionFixture.
/// Gracefully handles Docker not being available — tests will skip.
/// </summary>
public class DatabaseFixture : IAsyncLifetime
{
    private PostgreSqlContainer? _container;

    public string? ConnectionString { get; private set; }
    public bool IsAvailable { get; private set; }
    public string? SkipReason { get; private set; }

    public async Task InitializeAsync()
    {
        try
        {
            _container = new PostgreSqlBuilder()
                .WithImage("postgres:17")
                .Build();

            await _container.StartAsync();
            ConnectionString = _container.GetConnectionString();
            await RunMigrations();
            await SeedTestData();
            IsAvailable = true;
        }
        catch (Exception ex)
        {
            SkipReason = $"Docker not available: {ex.Message}";
            IsAvailable = false;
        }
    }

    public async Task DisposeAsync()
    {
        if (_container != null)
            await _container.DisposeAsync();
    }

    private async Task RunMigrations()
    {
        var scripts = new[]
        {
            "database/000-extensions.sql",
            "database/001-common.sql",
            "database/002-shared-schema.sql",
            "database/003-certificates-schema.sql",
            "database/004-patching-schema.sql",
            "database/005-system-health-schema.sql",
            "database/006-eol-schema.sql",
            "database/007-migration-tracking.sql",
            "database/008-eol-add-machine-name.sql",
            "database/009-eol-split-dates.sql",
            "database/010-patch-exclusions.sql",
            "database/011-patch-exclusion-grants.sql",
            "database/012-design-v2-fields.sql",
            "database/013-monitoring-schema.sql"
        };

        // Walk up from bin/Debug/net10.0 to find the project root
        var dir = AppContext.BaseDirectory;
        while (dir != null && !File.Exists(Path.Combine(dir, "OperationsApi.csproj")))
            dir = Path.GetDirectoryName(dir);

        if (dir == null)
            throw new InvalidOperationException("Could not find project root from " + AppContext.BaseDirectory);

        await using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        foreach (var script in scripts)
        {
            var path = Path.Combine(dir, script);
            var sql = await File.ReadAllTextAsync(path);
            await using var cmd = new NpgsqlCommand(sql, conn);
            await cmd.ExecuteNonQueryAsync();
        }
    }

    private async Task SeedTestData()
    {
        await using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(SeedSql, conn);
        await cmd.ExecuteNonQueryAsync();
    }

    private const string SeedSql = """
        -- ═══ Applications ═══
        INSERT INTO shared.applications (application_name, source_system, criticality)
        VALUES
            ('Portal', 'test', 'HIGH'),
            ('API Gateway', 'test', 'CRITICAL'),
            ('BackOffice', 'test', 'LOW');

        -- ═══ Servers ═══
        INSERT INTO shared.servers
            (server_name, fqdn, ip_address, operating_system, environment, location,
             business_unit, primary_application_id, primary_contact, patch_group, is_active, source_system,
             service, func, last_seen_at)
        VALUES
            ('WEB01', 'web01.contoso.com', '10.0.0.1', 'Windows Server 2022', 'Production', 'DC1',
             'Engineering', 1, 'ops@contoso.com', '8a', TRUE, 'test',
             'portal-web', 'front-door', CURRENT_TIMESTAMP - INTERVAL '15 minutes'),
            ('WEB02', 'web02.contoso.com', '10.0.0.2', 'Windows Server 2022', 'Production', 'DC1',
             'Engineering', 1, 'ops@contoso.com', '8b', TRUE, 'test',
             'portal-web', 'front-door', CURRENT_TIMESTAMP - INTERVAL '20 minutes'),
            ('API01', 'api01.contoso.com', '10.0.1.1', 'Windows Server 2022', 'Production', 'DC2',
             'Engineering', 2, 'api-team@contoso.com', '9a', TRUE, 'test',
             'api-gateway', 'public-api', CURRENT_TIMESTAMP - INTERVAL '5 minutes'),
            ('DEV01', 'dev01.contoso.com', '10.0.2.1', 'Windows Server 2022', 'Development', 'DC1',
             'Engineering', 1, 'dev@contoso.com', '8a', TRUE, 'test',
             NULL, NULL, NULL),
            ('OLD01', 'old01.contoso.com', '10.0.3.1', 'Windows Server 2019', 'Production', 'DC1',
             'Engineering', 3, 'ops@contoso.com', '9b', FALSE, 'test',
             NULL, NULL, NULL);

        -- ═══ Certificates ═══
        INSERT INTO certificates.inventory
            (thumbprint, subject, subject_cn, issuer, issuer_cn, valid_from, valid_to,
             days_until_expiry, is_expired, alert_level, server_name, server_id,
             store_name, scan_source, is_active)
        VALUES
            ('AAA111', 'CN=web01.contoso.com', 'web01.contoso.com', 'CN=Contoso CA', 'Contoso CA',
             '2024-01-01', NOW() + INTERVAL '7 days', 7, FALSE, 'CRITICAL',
             'WEB01', 1, 'LocalMachine\My', 'powershell', TRUE),
            ('BBB222', 'CN=web02.contoso.com', 'web02.contoso.com', 'CN=Contoso CA', 'Contoso CA',
             '2024-01-01', NOW() + INTERVAL '90 days', 90, FALSE, 'OK',
             'WEB02', 2, 'LocalMachine\My', 'powershell', TRUE),
            ('CCC333', 'CN=api.contoso.com', 'api.contoso.com', 'CN=Contoso CA', 'Contoso CA',
             '2024-01-01', NOW() + INTERVAL '25 days', 25, FALSE, 'WARNING',
             'API01', 3, 'LocalMachine\My', 'powershell', TRUE),
            ('DDD444', 'CN=expired.contoso.com', 'expired.contoso.com', 'CN=Contoso CA', 'Contoso CA',
             '2023-01-01', NOW() - INTERVAL '10 days', -10, TRUE, 'CRITICAL',
             'WEB01', 1, 'LocalMachine\My', 'powershell', TRUE),
            ('EEE555', 'CN=inactive.contoso.com', 'inactive.contoso.com', 'CN=Contoso CA', 'Contoso CA',
             '2024-01-01', NOW() + INTERVAL '60 days', 60, FALSE, 'OK',
             'OLD01', 5, 'LocalMachine\My', 'powershell', FALSE);

        -- ═══ Patch cycles ═══
        INSERT INTO patching.patch_cycles (cycle_date, status, servers_onprem)
        VALUES
            (CURRENT_DATE + 7, 'active', 3),
            (CURRENT_DATE - 30, 'completed', 2);

        -- ═══ Patch schedule ═══
        INSERT INTO patching.patch_schedule
            (cycle_id, server_name, server_type, patch_group, app, service, server_id)
        VALUES
            (1, 'WEB01', 'onprem', '8a', 'Portal', 'IIS', 1),
            (1, 'WEB02', 'onprem', '8b', 'Portal', 'IIS', 2),
            (1, 'API01', 'onprem', '9a', 'API Gateway', 'ApiSvc', 3),
            (2, 'WEB01', 'onprem', '8a', 'Portal', 'IIS', 1),
            (2, 'DEV01', 'onprem', '8a', 'Portal', 'IIS', 4);

        -- ═══ Known issues ═══
        INSERT INTO patching.known_issues
            (title, application, severity, is_active, applies_to_windows, applies_to_sql,
             applies_to_other, affected_apps, affected_services, fix, trigger_description,
             category, status, confluence_page_id)
        VALUES
            ('IIS pool crash after reboot', 'Portal', 'HIGH', TRUE, TRUE, FALSE, FALSE,
             ARRAY['Portal'], ARRAY['IIS'], 'Restart IIS app pools', 'Server reboot',
             'Windows O/S Patching', 'PUBLISHED', 'page-001'),
            ('SQL Agent stops', NULL, 'CRITICAL', TRUE, FALSE, TRUE, FALSE,
             ARRAY['API Gateway'], ARRAY['SQLAgent'], 'Restart SQL Agent', 'SQL patching',
             'SQL Server Patching', 'PUBLISHED', 'page-002'),
            ('Resolved old issue', 'BackOffice', 'LOW', FALSE, TRUE, FALSE, FALSE,
             ARRAY['BackOffice'], ARRAY[]::TEXT[], 'N/A', 'N/A',
             'Windows O/S Patching', 'WITHDRAWN', 'page-003');

        -- ═══ EOL Software ═══
        INSERT INTO eol.end_of_life_software
            (eol_product, eol_product_version, eol_end_of_life, eol_end_of_support, machine_name, asset, is_active)
        VALUES
            ('Windows Server', '2019', NOW() - INTERVAL '6 months', NOW() - INTERVAL '1 year', 'OLD01', 'Windows Server 2019 Standard', TRUE),
            ('Windows Server', '2019', NOW() - INTERVAL '6 months', NOW() - INTERVAL '1 year', 'DEV01', 'Windows Server 2019 Standard', TRUE),
            ('Windows Server', '2022', NOW() + INTERVAL '3 years', NOW() + INTERVAL '2 years', 'WEB01', 'Windows Server 2022 Standard', TRUE),
            ('Windows Server', '2022', NOW() + INTERVAL '3 years', NOW() + INTERVAL '2 years', 'WEB02', 'Windows Server 2022 Standard', TRUE),
            ('SQL Server', '2019', NOW() + INTERVAL '2 months', NOW() - INTERVAL '6 months', 'API01', 'SQL Server 2019 Database Engine', TRUE),
            ('Legacy App', '1.0', NOW() - INTERVAL '2 years', NOW() - INTERVAL '3 years', 'OLD01', 'Legacy App Runtime', FALSE);

        -- ═══ Sync status ═══
        UPDATE system.sync_status SET
            status = 'healthy',
            last_success_at = NOW() - INTERVAL '2 hours',
            last_run_at = NOW() - INTERVAL '2 hours',
            records_processed = 100,
            consecutive_failures = 0
        WHERE sync_name = 'databricks_servers';

        UPDATE system.sync_status SET
            status = 'warning',
            last_success_at = NOW() - INTERVAL '30 hours',
            last_run_at = NOW() - INTERVAL '1 hour',
            records_processed = 0,
            consecutive_failures = 3,
            last_error_message = 'Connection timeout'
        WHERE sync_name = 'certificate_scan';

        -- ═══ Sync history ═══
        INSERT INTO system.sync_history
            (sync_name, started_at, completed_at, status, records_processed, records_inserted)
        VALUES
            ('databricks_servers', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours' + INTERVAL '30 seconds', 'success', 100, 5),
            ('databricks_servers', NOW() - INTERVAL '26 hours', NOW() - INTERVAL '26 hours' + INTERVAL '45 seconds', 'success', 98, 3);

        -- ═══ Unmatched servers ═══
        INSERT INTO system.unmatched_servers
            (server_name_raw, server_name_normalized, source_system, status, occurrence_count)
        VALUES
            ('WEBSVR01', 'websvr01', 'patching_html', 'pending', 3),
            ('UNKNOWN99', 'unknown99', 'ivanti', 'pending', 1),
            ('RESOLVED01', 'resolved01', 'patching_html', 'resolved', 2);

        -- ═══ Scan failures ═══
        INSERT INTO system.scan_failures
            (server_name, scan_type, error_category, error_message, failure_count, is_resolved)
        VALUES
            ('OFFLINE01', 'certificate', 'unreachable', 'No ping response', 5, FALSE),
            ('LOCKED02', 'certificate', 'access_denied', 'Access denied', 2, FALSE),
            ('FIXED03', 'certificate', 'timeout', 'Connection timeout', 1, TRUE);

        -- ═══ Server aliases ═══
        INSERT INTO system.server_aliases (canonical_name, alias_name, source_system, created_by)
        VALUES ('WEB01', 'WEBSERVER01', 'patching_html', 'test');

        -- ═══ Disk snapshots — current state covering all three alert statuses ═══
        -- The disk_current view picks the latest snapshot per (server, disk).
        -- WEB01 C:\ is OK (50%), WEB02 C:\ is warn (85%), API01 D:\ is crit (95%).
        INSERT INTO monitoring.disk_snapshots
            (captured_at, server_name, service, environment, technical_owner,
             business_unit, disk_label, volume_size_gb, used_gb, free_gb, percent_used,
             alert_status, threshold_warn_pct, threshold_crit_pct,
             source_volume_id, source_node_id)
        VALUES
            (NOW() - INTERVAL '5 minutes', 'WEB01', 'portal-web', 'Production', 'Andy King',
             'Engineering', 'C:\', 500, 250.00, 250.00, 50.00, 1, 80, 90, 1001, 101),
            (NOW() - INTERVAL '5 minutes', 'WEB02', 'portal-web', 'Production', 'Andy King',
             'Engineering', 'C:\', 500, 425.00, 75.00, 85.00, 2, 80, 90, 1002, 102),
            (NOW() - INTERVAL '5 minutes', 'API01', 'api-gateway', 'Production', 'Richard Wykes',
             'Engineering', 'D:\', 200, 190.00, 10.00, 95.00, 3, 80, 90, 1003, 103),
            (NOW() - INTERVAL '5 minutes', 'DEV01', 'portal-web', 'Development', 'Andy King',
             'Engineering', 'C:\', 250, 100.00, 150.00, 40.00, 1, 80, 90, 1004, 104);

        -- ═══ Disk history — small growth series for projection regression ═══
        -- WEB01 C:\ growing ~1 GB/day (positive slope → daysUntilCritical computed).
        INSERT INTO monitoring.disk_snapshots
            (captured_at, server_name, service, environment, technical_owner, business_unit,
             disk_label, volume_size_gb, used_gb, free_gb, percent_used,
             alert_status, threshold_warn_pct, threshold_crit_pct,
             source_volume_id, source_node_id)
        VALUES
            (NOW() - INTERVAL '20 days', 'WEB01', 'portal-web', 'Production', 'Andy King', 'Engineering',
             'C:\', 500, 230.00, 270.00, 46.00, 1, 80, 90, 1001, 101),
            (NOW() - INTERVAL '15 days', 'WEB01', 'portal-web', 'Production', 'Andy King', 'Engineering',
             'C:\', 500, 235.00, 265.00, 47.00, 1, 80, 90, 1001, 101),
            (NOW() - INTERVAL '10 days', 'WEB01', 'portal-web', 'Production', 'Andy King', 'Engineering',
             'C:\', 500, 240.00, 260.00, 48.00, 1, 80, 90, 1001, 101),
            (NOW() - INTERVAL '5 days', 'WEB01', 'portal-web', 'Production', 'Andy King', 'Engineering',
             'C:\', 500, 245.00, 255.00, 49.00, 1, 80, 90, 1001, 101);

        -- ═══ Disk alerts — one previously-sent crit alert for de-dup tests ═══
        INSERT INTO monitoring.alerts
            (server_name, disk_label, alert_type, alert_status_at_send,
             percent_used_at_send, notification_sent, notification_sent_at)
        VALUES
            ('API01', 'D:\', 'breach_crit', 3, 92.00, TRUE, NOW() - INTERVAL '6 hours');
        """;
}

/// <summary>
/// Base class for integration tests — skips all tests when Docker is unavailable.
/// </summary>
public abstract class IntegrationTestBase : IDisposable
{
    protected readonly DatabaseFixture Db;
    private readonly List<NpgsqlConnection> _connections = [];

    protected IntegrationTestBase(DatabaseFixture db)
    {
        Db = db;
    }

    /// <summary>Opens a connection tracked for disposal when the test class is torn down.</summary>
    protected NpgsqlConnection OpenConnection()
    {
        var conn = new NpgsqlConnection(Db.ConnectionString);
        conn.Open();
        _connections.Add(conn);
        return conn;
    }

    public void Dispose()
    {
        foreach (var conn in _connections)
            conn.Dispose();
        _connections.Clear();
        GC.SuppressFinalize(this);
    }
}

/// <summary>
/// Like [Fact] but automatically skips when Docker is not available.
/// </summary>
public class DockerFactAttribute : FactAttribute
{
    private static readonly Lazy<string?> _skipReason = new(() =>
    {
        try
        {
            using var client = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            // Check Docker socket on Windows named pipe via HTTP
            var cts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(2));
            var response = client.GetAsync("http://localhost:2375/version", cts.Token).GetAwaiter().GetResult();
            return response.IsSuccessStatusCode ? null : "Docker API not reachable";
        }
        catch
        {
            // Try npipe
            try
            {
                using var pipe = new System.IO.Pipes.NamedPipeClientStream(".", "docker_engine", System.IO.Pipes.PipeDirection.InOut, System.IO.Pipes.PipeOptions.None);
                pipe.Connect(2000);
                return null;
            }
            catch
            {
                return "Docker is not available — install Docker Desktop to run integration tests";
            }
        }
    });

    public DockerFactAttribute()
    {
        if (_skipReason.Value is string reason)
            Skip = reason;
    }
}

[CollectionDefinition("Database")]
public class DatabaseCollection : ICollectionFixture<DatabaseFixture> { }

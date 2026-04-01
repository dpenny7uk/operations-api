using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class CertificateService : BaseService<CertificateService>, ICertificateService
{
    public CertificateService(IDbConnection db, ILogger<CertificateService> logger)
        : base(db, logger) { }

    public Task<CertificateSummary> GetSummaryAsync() => RunDbAsync(() =>
        Db.QueryFirstAsync<CertificateSummary>($@"
            SELECT
                COUNT(*) FILTER (WHERE alert_level = 'CRITICAL' AND NOT is_expired) AS CriticalCount,
                COUNT(*) FILTER (WHERE alert_level = 'WARNING' AND NOT is_expired) AS WarningCount,
                COUNT(*) FILTER (WHERE alert_level = 'OK' AND NOT is_expired) AS OkCount,
                COUNT(*) FILTER (WHERE is_expired) AS ExpiredCount,
                COUNT(*) AS TotalCount
            FROM {Sql.Tables.Certificates}
            WHERE is_active = TRUE
        ")
    );

    public Task<IEnumerable<Certificate>> ListCertificatesAsync(
        string? alertLevel,
        string? server,
        int? daysUntil,
        int limit) => RunDbAsync(async () =>
    {
        var sql = $@"
            SELECT
                c.certificate_id AS CertId,
                c.subject_cn AS SubjectCn,
                c.server_name AS ServerName,
                c.valid_to AS ValidTo,
                c.days_until_expiry AS DaysUntilExpiry,
                c.alert_level AS AlertLevel,
                c.is_expired AS IsExpired,
                a.application_name AS ServiceName
            FROM {Sql.Tables.Certificates} c
            LEFT JOIN {Sql.Tables.Servers} s ON UPPER(s.server_name) = UPPER(c.server_name) AND s.is_active
            LEFT JOIN {Sql.Tables.Applications} a ON a.application_id = s.primary_application_id
            WHERE c.is_active = TRUE";

        var p = new DynamicParameters();

        if (daysUntil.HasValue)
        {
            sql += " AND c.days_until_expiry <= @Days";
            p.Add("Days", daysUntil.Value);
        }

        if (!string.IsNullOrEmpty(server))
        {
            sql += " AND c.server_name ILIKE @Server ESCAPE '\\'";
            p.Add("Server", $"%{EscapeLike(server)}%");
        }

        if (!string.IsNullOrEmpty(alertLevel))
        {
            if (alertLevel.Equals("EXPIRED", StringComparison.OrdinalIgnoreCase))
            {
                sql += " AND c.is_expired = TRUE";
            }
            else
            {
                sql += " AND c.alert_level = @AlertLevel AND NOT c.is_expired";
                p.Add("AlertLevel", alertLevel.ToUpper());
            }
        }

        sql += " ORDER BY c.valid_to LIMIT @Limit";
        p.Add("Limit", limit);

        return await Db.QueryAsync<Certificate>(sql, p);
    });

    public Task<CertificateDetail?> GetByIdAsync(int id) => RunDbAsync(() =>
        Db.QueryFirstOrDefaultAsync<CertificateDetail>($@"
            SELECT
                certificate_id AS CertId,
                subject_cn AS SubjectCn,
                server_name AS ServerName,
                valid_to AS ValidTo,
                days_until_expiry AS DaysUntilExpiry,
                alert_level AS AlertLevel,
                issuer AS Issuer,
                valid_from AS ValidFrom,
                thumbprint AS Thumbprint,
                iis_binding_port AS Port,
                iis_site_name AS ServiceName,
                is_active AS IsActive,
                last_seen_at AS LastScannedAt
            FROM {Sql.Tables.Certificates}
            WHERE certificate_id = @Id
        ", new { Id = id })
    );

    public Task<IEnumerable<Certificate>> GetByServerAsync(string server, int limit = 500) => RunDbAsync(() =>
        Db.QueryAsync<Certificate>($@"
            SELECT
                c.certificate_id AS CertId,
                c.subject_cn AS SubjectCn,
                c.server_name AS ServerName,
                c.valid_to AS ValidTo,
                c.days_until_expiry AS DaysUntilExpiry,
                c.alert_level AS AlertLevel,
                a.application_name AS ServiceName
            FROM {Sql.Tables.Certificates} c
            LEFT JOIN {Sql.Tables.Servers} s ON UPPER(s.server_name) = UPPER(c.server_name) AND s.is_active
            LEFT JOIN {Sql.Tables.Applications} a ON a.application_id = s.primary_application_id
            WHERE c.is_active = TRUE AND UPPER(c.server_name) = UPPER(@Server)
            ORDER BY c.valid_to
            LIMIT @Limit
        ", new { Server = server, Limit = limit })
    );
}

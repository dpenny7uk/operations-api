using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class CertificateService : BaseService<CertificateService>, ICertificateService
{
    public CertificateService(IDbConnection db, ILogger<CertificateService> logger) 
        : base(db, logger) { }

    public async Task<CertificateSummary> GetSummaryAsync()
    {
        return await Db.QueryFirstAsync<CertificateSummary>($@"
            SELECT
                COUNT(*) FILTER (WHERE alert_level = 'CRITICAL' OR is_expired) AS CriticalCount,
                COUNT(*) FILTER (WHERE alert_level = 'WARNING' AND NOT is_expired) AS WarningCount,
                COUNT(*) FILTER (WHERE alert_level = 'OK' AND NOT is_expired) AS OkCount,
                COUNT(*) AS TotalCount
            FROM {Sql.Tables.Certificates}
            WHERE is_active = TRUE
        ");
    }

    public async Task<IEnumerable<Certificate>> ListCertificatesAsync(
        string? alertLevel,
        string? server,
        int? daysUntil,
        int limit)
    {
        var sql = $@"
            SELECT 
                certificate_id AS CertId,
                subject_cn AS SubjectCn,
                server_name AS ServerName,
                valid_to AS ValidTo,
                days_until_expiry AS DaysUntilExpiry,
                alert_level AS AlertLevel
            FROM {Sql.Tables.Certificates}
            WHERE is_active = TRUE";

        var p = new DynamicParameters();

        if (daysUntil.HasValue)
        {
            sql += " AND days_until_expiry <= @Days";
            p.Add("Days", daysUntil.Value);
        }

        if (!string.IsNullOrEmpty(server))
        {
            sql += " AND server_name ILIKE @Server";
            p.Add("Server", $"%{EscapeLike(server)}%");
        }

        if (!string.IsNullOrEmpty(alertLevel))
        {
            sql += " AND alert_level = @AlertLevel";
            p.Add("AlertLevel", alertLevel.ToUpper());
        }

        sql += " ORDER BY valid_to LIMIT @Limit";
        p.Add("Limit", limit);

        return await Db.QueryAsync<Certificate>(sql, p);
    }

    public async Task<CertificateDetail?> GetByIdAsync(int id)
    {
        return await Db.QueryFirstOrDefaultAsync<CertificateDetail>($@"
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
        ", new { Id = id });
    }

    public async Task<IEnumerable<Certificate>> GetByServerAsync(string server, int limit = 500)
    {
        return await Db.QueryAsync<Certificate>($@"
            SELECT
                certificate_id AS CertId,
                subject_cn AS SubjectCn,
                server_name AS ServerName,
                valid_to AS ValidTo,
                days_until_expiry AS DaysUntilExpiry,
                alert_level AS AlertLevel
            FROM {Sql.Tables.Certificates}
            WHERE is_active = TRUE AND server_name ILIKE @Server
            ORDER BY valid_to
            LIMIT @Limit
        ", new { Server = $"%{EscapeLike(server)}%", Limit = limit });
    }
}

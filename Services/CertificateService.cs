using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class CertificateService : BaseService<CertificateService>, ICertificateService
{
    // Retention window for expired certs in the dashboard UI. Certs past this
    // cut-off stay in the DB (is_active=TRUE) but are hidden from the summary
    // counters and list endpoints so the "expired" metric doesn't grow
    // indefinitely. Audit / history lookups go direct to the DB.
    // days_until_expiry is negative for expired certs, so the SQL uses
    // `days_until_expiry >= -ExpiredRetentionDays` via a bound parameter.
    private const int ExpiredRetentionDays = 14;

    public CertificateService(IDbConnection db, ILogger<CertificateService> logger)
        : base(db, logger) { }

    // Level vocabulary used on the wire matches the frontend dropdown values:
    // 'expired' / 'crit' / 'warn' / 'ok'. Maps to the canonical SQL columns
    // (alert_level + is_expired) using inline literals — no parameters needed.
    // Unknown values return an empty clause (treated as no filter).
    private static string LevelToSqlClause(string? level)
    {
        if (string.IsNullOrWhiteSpace(level)) return "";
        return level.Trim().ToLowerInvariant() switch
        {
            "expired" => " AND c.is_expired = TRUE",
            "crit"    => " AND c.alert_level = 'CRITICAL' AND NOT c.is_expired",
            "warn"    => " AND c.alert_level = 'WARNING'  AND NOT c.is_expired",
            "ok"      => " AND c.alert_level = 'OK'       AND NOT c.is_expired",
            _ => "",
        };
    }

    // Builds the active-certs base WHERE extras plus optional BU + level filters.
    // exclude lets a breakdown query skip its own dimension (cross-facet rule).
    private static (string extras, DynamicParameters args) BuildCertFilterClause(
        string? businessUnit, string? level, string? exclude = null)
    {
        var sql = "";
        var args = new DynamicParameters();
        args.Add("MinExpiredDays", -ExpiredRetentionDays);

        if (!string.IsNullOrWhiteSpace(businessUnit) && exclude != "businessUnit")
        {
            sql += " AND s.business_unit = @BusinessUnit";
            args.Add("BusinessUnit", businessUnit);
        }
        if (exclude != "level")
        {
            sql += LevelToSqlClause(level);
        }
        return (sql, args);
    }

    public Task<CertificateSummary> GetSummaryAsync(string? businessUnit = null, string? level = null) => RunDbAsync(async () =>
    {
        // Cross-facet rule: top-level scoped by both filters; Levels[] scoped
        // by BU only; BusinessUnits[] scoped by level only.
        var (topExtra, topArgs) = BuildCertFilterClause(businessUnit, level);
        var (lvlExtra, lvlArgs) = BuildCertFilterClause(businessUnit, level, exclude: "level");
        var (buExtra,  buArgs)  = BuildCertFilterClause(businessUnit, level, exclude: "businessUnit");

        // Top-level totals.
        var top = await Db.QueryFirstAsync<CertificateSummary>($@"
            SELECT
                COUNT(*) FILTER (WHERE c.alert_level = 'CRITICAL' AND NOT c.is_expired) AS CriticalCount,
                COUNT(*) FILTER (WHERE c.alert_level = 'WARNING'  AND NOT c.is_expired) AS WarningCount,
                COUNT(*) FILTER (WHERE c.alert_level = 'OK'       AND NOT c.is_expired) AS OkCount,
                COUNT(*) FILTER (WHERE c.is_expired AND c.days_until_expiry >= @MinExpiredDays) AS ExpiredCount,
                COUNT(*) FILTER (WHERE NOT c.is_expired OR c.days_until_expiry >= @MinExpiredDays) AS TotalCount
            FROM {Sql.Tables.Certificates} c
            LEFT JOIN {Sql.Tables.Servers} s ON UPPER(s.server_name) = UPPER(c.server_name) AND s.is_active
            WHERE c.is_active = TRUE
              AND (NOT c.is_expired OR c.days_until_expiry >= @MinExpiredDays)
              {topExtra}
        ", topArgs);

        // Levels[] — one row per level under the BU-scoped (level-excluded) WHERE.
        // Reuses the four FILTER clauses then unpivots into rows.
        var levelRow = await Db.QueryFirstAsync($@"
            SELECT
                COUNT(*) FILTER (WHERE c.is_expired AND c.days_until_expiry >= @MinExpiredDays) AS ExpiredCount,
                COUNT(*) FILTER (WHERE c.alert_level = 'CRITICAL' AND NOT c.is_expired) AS CriticalCount,
                COUNT(*) FILTER (WHERE c.alert_level = 'WARNING'  AND NOT c.is_expired) AS WarningCount,
                COUNT(*) FILTER (WHERE c.alert_level = 'OK'       AND NOT c.is_expired) AS OkCount
            FROM {Sql.Tables.Certificates} c
            LEFT JOIN {Sql.Tables.Servers} s ON UPPER(s.server_name) = UPPER(c.server_name) AND s.is_active
            WHERE c.is_active = TRUE
              AND (NOT c.is_expired OR c.days_until_expiry >= @MinExpiredDays)
              {lvlExtra}
        ", lvlArgs);
        top.Levels = new List<CertificateLevelCount>
        {
            new() { Level = "expired", TotalCount = (int)levelRow.expiredcount },
            new() { Level = "crit",    TotalCount = (int)levelRow.criticalcount },
            new() { Level = "warn",    TotalCount = (int)levelRow.warningcount },
            new() { Level = "ok",      TotalCount = (int)levelRow.okcount },
        };

        // BusinessUnits[] — GROUP BY business_unit under the level-scoped (BU-excluded) WHERE.
        var buRows = await Db.QueryAsync<CertificateBuCount>($@"
            SELECT
                COALESCE(s.business_unit, 'Unknown') AS BusinessUnit,
                COUNT(*) AS TotalCount
            FROM {Sql.Tables.Certificates} c
            LEFT JOIN {Sql.Tables.Servers} s ON UPPER(s.server_name) = UPPER(c.server_name) AND s.is_active
            WHERE c.is_active = TRUE
              AND (NOT c.is_expired OR c.days_until_expiry >= @MinExpiredDays)
              {buExtra}
            GROUP BY s.business_unit
            ORDER BY COUNT(*) DESC
        ", buArgs);
        top.BusinessUnits = buRows.ToList();

        return top;
    });

    public Task<IEnumerable<Certificate>> ListCertificatesAsync(
        string? alertLevel,
        string? server,
        int? daysUntil,
        int limit,
        string? businessUnit = null) => RunDbAsync(async () =>
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
                a.application_name AS ServiceName,
                s.business_unit AS BusinessUnit
            FROM {Sql.Tables.Certificates} c
            LEFT JOIN {Sql.Tables.Servers} s ON UPPER(s.server_name) = UPPER(c.server_name) AND s.is_active
            LEFT JOIN {Sql.Tables.Applications} a ON a.application_id = s.primary_application_id
            WHERE c.is_active = TRUE
              AND (NOT c.is_expired OR c.days_until_expiry >= @MinExpiredDays)";

        var p = new DynamicParameters();
        p.Add("MinExpiredDays", -ExpiredRetentionDays);

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

        if (!string.IsNullOrWhiteSpace(businessUnit))
        {
            sql += " AND s.business_unit = @BusinessUnit";
            p.Add("BusinessUnit", businessUnit);
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
                a.application_name AS ServiceName,
                s.business_unit AS BusinessUnit
            FROM {Sql.Tables.Certificates} c
            LEFT JOIN {Sql.Tables.Servers} s ON UPPER(s.server_name) = UPPER(c.server_name) AND s.is_active
            LEFT JOIN {Sql.Tables.Applications} a ON a.application_id = s.primary_application_id
            WHERE c.is_active = TRUE AND UPPER(c.server_name) = UPPER(@Server)
            ORDER BY c.valid_to
            LIMIT @Limit
        ", new { Server = server, Limit = limit })
    );
}

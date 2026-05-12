using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class EolService : BaseService<EolService>, IEolService
{
    private const string AlertLevelCase = @"
        CASE
            WHEN {0} IS NULL THEN 'unknown'
            WHEN {0} <= NOW() AND (COALESCE({1}, {0}) <= NOW()) THEN 'eol'
            WHEN {0} <= NOW() AND {1} > NOW() THEN 'extended'
            WHEN {0} <= NOW() + INTERVAL '6 months' THEN 'approaching'
            ELSE 'supported'
        END";

    private static string AlertLevel(string eolColumn = "p.eol_end_of_life", string extColumn = "p.eol_end_of_extended_support")
        => string.Format(AlertLevelCase, eolColumn, extColumn);

    // CTE that combines per-server software rows with Windows Server OS mapping.
    // When businessUnit is supplied, both branches are restricted to servers in
    // that BU via shared.servers - the EolSoftware branch tightens its existing
    // join, and the v_os_eol_mapping branch picks up an extra inner join (since
    // the view doesn't carry BU itself).
    private static string AllServers(string? businessUnit = null)
    {
        var hasBu = !string.IsNullOrWhiteSpace(businessUnit);
        var eolBranchBu = hasBu ? " AND s.business_unit = @BusinessUnit" : "";
        var osBranchBuJoin = hasBu
            ? $@" INNER JOIN shared.servers s2
                  ON UPPER(s2.server_name) = UPPER(m.machine_name)
                  AND s2.is_active = TRUE
                  AND s2.business_unit = @BusinessUnit"
            : "";
        return $@"
        all_servers AS (
            SELECT e.machine_name, e.eol_product, e.eol_product_version
            FROM {Sql.Tables.EolSoftware} e
            INNER JOIN shared.servers s ON UPPER(s.server_name) = UPPER(e.machine_name) AND s.is_active = TRUE{eolBranchBu}
            WHERE e.is_active = TRUE AND e.machine_name IS NOT NULL
            UNION
            SELECT m.machine_name, m.eol_product, m.eol_product_version
            FROM eol.v_os_eol_mapping m{osBranchBuJoin}
            WHERE m.eol_product_version IS NOT NULL
        )";
    }

    public EolService(IDbConnection db, ILogger<EolService> logger)
        : base(db, logger) { }

    public Task<EolSummary> GetSummaryAsync(bool hasServers = false, string? businessUnit = null) => RunDbAsync(() =>
    {
        var dp = new DynamicParameters();
        if (!string.IsNullOrWhiteSpace(businessUnit))
            dp.Add("BusinessUnit", businessUnit);
        return Db.QueryFirstAsync<EolSummary>($@"
            WITH {AllServers(businessUnit)},
            product_counts AS (
                SELECT
                    p.eol_product,
                    p.eol_product_version,
                    p.eol_end_of_life,
                    p.eol_end_of_extended_support,
                    COUNT(DISTINCT s.machine_name) AS server_count
                FROM {Sql.Tables.EolSoftware} p
                LEFT JOIN all_servers s
                    ON s.eol_product = p.eol_product
                    AND s.eol_product_version = p.eol_product_version
                WHERE p.is_active = TRUE AND p.machine_name IS NULL
                GROUP BY p.eol_product, p.eol_product_version, p.eol_end_of_life, p.eol_end_of_extended_support
            )
            SELECT
                COUNT(*) FILTER (WHERE eol_end_of_life <= NOW() AND COALESCE(eol_end_of_extended_support, eol_end_of_life) <= NOW()) AS EolCount,
                COUNT(*) FILTER (WHERE eol_end_of_life <= NOW() AND eol_end_of_extended_support > NOW()) AS ExtendedCount,
                COUNT(*) FILTER (WHERE eol_end_of_life > NOW() AND eol_end_of_life <= NOW() + INTERVAL '6 months') AS ApproachingCount,
                COUNT(*) FILTER (WHERE eol_end_of_life > NOW() + INTERVAL '6 months') AS SupportedCount,
                COUNT(*) FILTER (WHERE eol_end_of_life IS NULL) AS UnknownCount,
                COUNT(*) AS TotalCount,
                (SELECT COUNT(DISTINCT s.machine_name)
                 FROM all_servers s
                 JOIN {Sql.Tables.EolSoftware} pd ON pd.eol_product = s.eol_product
                    AND pd.eol_product_version = s.eol_product_version
                    AND pd.machine_name IS NULL AND pd.is_active = TRUE
                 WHERE pd.eol_end_of_life <= NOW() + INTERVAL '6 months'
                ) AS AffectedServers
            FROM product_counts
            {(hasServers ? "WHERE server_count > 0" : "")}
        ", dp);
    });

    public Task<IEnumerable<EolSoftware>> ListEolSoftwareAsync(
        string? alertLevel,
        string? product,
        int limit,
        bool hasServers = false,
        string? businessUnit = null) => RunDbAsync(async () =>
    {
        var sql = $@"
            WITH {AllServers(businessUnit)}
            SELECT
                p.eol_product AS Product,
                p.eol_product_version AS Version,
                p.eol_end_of_life AS EndOfLife,
                p.eol_end_of_extended_support AS EndOfExtendedSupport,
                p.eol_end_of_support AS EndOfSupport,
                {AlertLevel()} AS AlertLevel,
                COUNT(DISTINCT s.machine_name) AS AffectedAssets
            FROM {Sql.Tables.EolSoftware} p
            LEFT JOIN all_servers s
                ON s.eol_product = p.eol_product
                AND s.eol_product_version = p.eol_product_version
            WHERE p.is_active = TRUE AND p.machine_name IS NULL";

        var dp = new DynamicParameters();

        if (!string.IsNullOrWhiteSpace(businessUnit))
            dp.Add("BusinessUnit", businessUnit);

        if (!string.IsNullOrEmpty(product))
        {
            sql += " AND p.eol_product ILIKE @Product ESCAPE '\\'";
            dp.Add("Product", $"%{EscapeLike(product)}%");
        }

        if (!string.IsNullOrEmpty(alertLevel))
        {
            var alertFilter = alertLevel.ToLower() switch
            {
                "eol" => " AND p.eol_end_of_life <= NOW() AND COALESCE(p.eol_end_of_extended_support, p.eol_end_of_life) <= NOW()",
                "extended" => " AND p.eol_end_of_life <= NOW() AND p.eol_end_of_extended_support > NOW()",
                "approaching" => " AND p.eol_end_of_life > NOW() AND p.eol_end_of_life <= NOW() + INTERVAL '6 months'",
                "supported" => " AND p.eol_end_of_life > NOW() + INTERVAL '6 months'",
                _ => ""
            };
            if (alertFilter.Length == 0)
                Logger.LogWarning("Unknown alertLevel filter ignored: {AlertLevel}", alertLevel);
            else
                sql += alertFilter;
        }

        sql += " GROUP BY p.eol_product, p.eol_product_version, p.eol_end_of_life, p.eol_end_of_extended_support, p.eol_end_of_support";

        if (hasServers)
            sql += " HAVING COUNT(DISTINCT s.machine_name) > 0";

        sql += " ORDER BY COUNT(DISTINCT s.machine_name) DESC, p.eol_end_of_life NULLS LAST LIMIT @Limit";
        dp.Add("Limit", limit);

        return await Db.QueryAsync<EolSoftware>(sql, dp);
    });

    public Task<EolSoftwareDetail?> GetByProductVersionAsync(string product, string version) => RunDbAsync(async () =>
    {
        // Get lifecycle dates from product-level row
        var detail = await Db.QueryFirstOrDefaultAsync<EolSoftwareDetail>($@"
            WITH {AllServers()}
            SELECT
                p.eol_product AS Product,
                p.eol_product_version AS Version,
                p.eol_end_of_life AS EndOfLife,
                p.eol_end_of_extended_support AS EndOfExtendedSupport,
                p.eol_end_of_support AS EndOfSupport,
                MAX(p.tag) AS Tag,
                {AlertLevel()} AS AlertLevel,
                COUNT(DISTINCT s.machine_name) AS AffectedAssets
            FROM {Sql.Tables.EolSoftware} p
            LEFT JOIN all_servers s
                ON s.eol_product = p.eol_product
                AND s.eol_product_version = p.eol_product_version
            WHERE p.eol_product = @Product AND p.eol_product_version = @Version
              AND p.is_active = TRUE AND p.machine_name IS NULL
            GROUP BY p.eol_product, p.eol_product_version, p.eol_end_of_life, p.eol_end_of_extended_support, p.eol_end_of_support
        ", new { Product = product, Version = version });

        if (detail != null)
        {
            // Get affected server names from per-server rows + OS mapping
            var assets = await Db.QueryAsync<string>($@"
                WITH {AllServers()}
                SELECT DISTINCT s.machine_name
                FROM all_servers s
                WHERE s.eol_product = @Product AND s.eol_product_version = @Version
                ORDER BY s.machine_name
            ", new { Product = product, Version = version });
            detail.Assets = assets.ToList();
        }

        return detail;
    });

    public Task<IEnumerable<UnmatchedEolSoftware>> GetUnmatchedSoftwareAsync(int limit) => RunDbAsync(() =>
        Db.QueryAsync<UnmatchedEolSoftware>($@"
            SELECT
                unmatched_id          AS UnmatchedId,
                raw_software_name     AS RawSoftwareName,
                raw_software_version  AS RawSoftwareVersion,
                source_system         AS SourceSystem,
                sample_machine_name   AS SampleMachineName,
                status                AS Status,
                first_seen_at         AS FirstSeenAt,
                last_seen_at          AS LastSeenAt,
                occurrence_count      AS OccurrenceCount
            FROM {Sql.Tables.UnmatchedEolSoftware}
            WHERE status = 'pending'
            ORDER BY occurrence_count DESC, raw_software_name
            LIMIT @Limit
        ", new { Limit = limit })
    );

    public Task<IEnumerable<EolSoftware>> GetByServerAsync(string serverName, int limit = 500) => RunDbAsync(() =>
        Db.QueryAsync<EolSoftware>($@"
            WITH {AllServers()},
            server_products AS (
                SELECT DISTINCT eol_product, eol_product_version
                FROM all_servers
                WHERE UPPER(machine_name) = UPPER(@Server)
            ),
            product_counts AS (
                SELECT s.eol_product, s.eol_product_version, COUNT(DISTINCT s.machine_name)::INT AS affected_count
                FROM all_servers s
                JOIN server_products sp ON sp.eol_product = s.eol_product AND sp.eol_product_version = s.eol_product_version
                GROUP BY s.eol_product, s.eol_product_version
            )
            SELECT
                p.eol_product AS Product,
                p.eol_product_version AS Version,
                p.eol_end_of_life AS EndOfLife,
                p.eol_end_of_extended_support AS EndOfExtendedSupport,
                p.eol_end_of_support AS EndOfSupport,
                {AlertLevel()} AS AlertLevel,
                pc.affected_count AS AffectedAssets
            FROM server_products sp
            JOIN {Sql.Tables.EolSoftware} p
                ON p.eol_product = sp.eol_product
                AND p.eol_product_version = sp.eol_product_version
                AND p.machine_name IS NULL AND p.is_active = TRUE
            JOIN product_counts pc
                ON pc.eol_product = sp.eol_product
                AND pc.eol_product_version = sp.eol_product_version
            ORDER BY p.eol_end_of_life NULLS LAST
            LIMIT @Limit
        ", new { Server = serverName, Limit = limit })
    );
}

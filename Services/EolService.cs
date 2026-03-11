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
            WHEN {0} <= NOW() THEN 'eol'
            WHEN {0} <= NOW() + INTERVAL '6 months' THEN 'approaching'
            ELSE 'supported'
        END";

    private static string AlertLevel(string column = "eol_end_of_life")
        => string.Format(AlertLevelCase, column);

    public EolService(IDbConnection db, ILogger<EolService> logger)
        : base(db, logger) { }

    public Task<EolSummary> GetSummaryAsync() => RunDbAsync(() =>
        Db.QueryFirstAsync<EolSummary>($@"
            SELECT
                COUNT(*) FILTER (WHERE eol_end_of_life <= NOW()) AS EolCount,
                COUNT(*) FILTER (WHERE eol_end_of_life > NOW() AND eol_end_of_life <= NOW() + INTERVAL '6 months') AS ApproachingCount,
                COUNT(*) FILTER (WHERE eol_end_of_life > NOW() + INTERVAL '6 months') AS SupportedCount,
                COUNT(*) FILTER (WHERE eol_end_of_life IS NULL) AS UnknownCount,
                COUNT(*) AS TotalCount,
                COUNT(DISTINCT machine_name) FILTER (WHERE eol_end_of_life <= NOW() + INTERVAL '6 months') AS AffectedServers
            FROM {Sql.Tables.EolSoftware}
            WHERE is_active = TRUE
        ")
    );

    public Task<IEnumerable<EolSoftware>> ListEolSoftwareAsync(
        string? alertLevel,
        string? product,
        int limit) => RunDbAsync(async () =>
    {
        var sql = $@"
            SELECT
                eol_product AS Product,
                eol_product_version AS Version,
                eol_end_of_life AS EndOfLife,
                eol_end_of_extended_support AS EndOfExtendedSupport,
                eol_end_of_support AS EndOfSupport,
                {AlertLevel()} AS AlertLevel,
                COUNT(DISTINCT machine_name) AS AffectedAssets
            FROM {Sql.Tables.EolSoftware}
            WHERE is_active = TRUE";

        var p = new DynamicParameters();

        if (!string.IsNullOrEmpty(product))
        {
            sql += " AND eol_product ILIKE @Product ESCAPE '\\'";
            p.Add("Product", $"%{EscapeLike(product)}%");
        }

        if (!string.IsNullOrEmpty(alertLevel))
        {
            var alertFilter = alertLevel.ToLower() switch
            {
                "eol" => " AND eol_end_of_life <= NOW()",
                "approaching" => " AND eol_end_of_life > NOW() AND eol_end_of_life <= NOW() + INTERVAL '6 months'",
                "supported" => " AND eol_end_of_life > NOW() + INTERVAL '6 months'",
                _ => ""
            };
            if (alertFilter.Length == 0)
                Logger.LogWarning("Unknown alertLevel filter ignored: {AlertLevel}", alertLevel);
            else
                sql += alertFilter;
        }

        sql += " GROUP BY eol_product, eol_product_version, eol_end_of_life, eol_end_of_extended_support, eol_end_of_support";
        sql += " ORDER BY eol_end_of_life NULLS LAST LIMIT @Limit";
        p.Add("Limit", limit);

        return await Db.QueryAsync<EolSoftware>(sql, p);
    });

    public Task<EolSoftwareDetail?> GetByProductVersionAsync(string product, string version) => RunDbAsync(async () =>
    {
        var detail = await Db.QueryFirstOrDefaultAsync<EolSoftwareDetail>($@"
            SELECT
                eol_product AS Product,
                eol_product_version AS Version,
                eol_end_of_life AS EndOfLife,
                eol_end_of_extended_support AS EndOfExtendedSupport,
                eol_end_of_support AS EndOfSupport,
                MAX(tag) AS Tag,
                {AlertLevel()} AS AlertLevel,
                COUNT(DISTINCT machine_name) AS AffectedAssets
            FROM {Sql.Tables.EolSoftware}
            WHERE eol_product = @Product AND eol_product_version = @Version AND is_active = TRUE
            GROUP BY eol_product, eol_product_version, eol_end_of_life, eol_end_of_extended_support, eol_end_of_support
        ", new { Product = product, Version = version });

        if (detail != null)
        {
            var assets = await Db.QueryAsync<string>($@"
                SELECT DISTINCT machine_name
                FROM {Sql.Tables.EolSoftware}
                WHERE eol_product = @Product AND eol_product_version = @Version AND is_active = TRUE
                  AND machine_name IS NOT NULL
                ORDER BY machine_name
            ", new { Product = product, Version = version });
            detail.Assets = assets.ToList();
        }

        return detail;
    });

    public Task<IEnumerable<EolSoftware>> GetByServerAsync(string serverName, int limit = 500) => RunDbAsync(() =>
        Db.QueryAsync<EolSoftware>($@"
            WITH server_products AS (
                SELECT DISTINCT eol_product, eol_product_version
                FROM {Sql.Tables.EolSoftware}
                WHERE UPPER(machine_name) = UPPER(@Server) AND is_active = TRUE
            ),
            product_counts AS (
                SELECT e.eol_product, e.eol_product_version, COUNT(DISTINCT e.machine_name)::INT AS affected_count
                FROM {Sql.Tables.EolSoftware} e
                JOIN server_products sp ON sp.eol_product = e.eol_product AND sp.eol_product_version = e.eol_product_version
                WHERE e.is_active = TRUE
                GROUP BY e.eol_product, e.eol_product_version
            )
            SELECT
                e.eol_product AS Product,
                e.eol_product_version AS Version,
                e.eol_end_of_life AS EndOfLife,
                e.eol_end_of_extended_support AS EndOfExtendedSupport,
                e.eol_end_of_support AS EndOfSupport,
                {AlertLevel("e.eol_end_of_life")} AS AlertLevel,
                pc.affected_count AS AffectedAssets
            FROM {Sql.Tables.EolSoftware} e
            JOIN product_counts pc ON pc.eol_product = e.eol_product AND pc.eol_product_version = e.eol_product_version
            WHERE UPPER(e.machine_name) = UPPER(@Server) AND e.is_active = TRUE
            ORDER BY e.eol_end_of_life NULLS LAST
            LIMIT @Limit
        ", new { Server = serverName, Limit = limit })
    );
}

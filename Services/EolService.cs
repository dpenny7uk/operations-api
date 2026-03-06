using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class EolService : BaseService<EolService>, IEolService
{
    private const string AlertLevelCase = @"
        CASE
            WHEN eol_end_of_life IS NULL THEN 'unknown'
            WHEN eol_end_of_life <= NOW() THEN 'eol'
            WHEN eol_end_of_life <= NOW() + INTERVAL '6 months' THEN 'approaching'
            ELSE 'supported'
        END";

    public EolService(IDbConnection db, ILogger<EolService> logger)
        : base(db, logger) { }

    public async Task<EolSummary> GetSummaryAsync()
    {
        return await Db.QueryFirstAsync<EolSummary>($@"
            SELECT
                COUNT(*) FILTER (WHERE eol_end_of_life <= NOW()) AS EolCount,
                COUNT(*) FILTER (WHERE eol_end_of_life > NOW() AND eol_end_of_life <= NOW() + INTERVAL '6 months') AS ApproachingCount,
                COUNT(*) FILTER (WHERE eol_end_of_life > NOW() + INTERVAL '6 months') AS SupportedCount,
                COUNT(*) AS TotalCount,
                COUNT(DISTINCT asset) FILTER (WHERE eol_end_of_life <= NOW() + INTERVAL '6 months') AS AffectedServers
            FROM {Sql.Tables.EolSoftware}
            WHERE is_active = TRUE
        ");
    }

    public async Task<IEnumerable<EolSoftware>> ListEolSoftwareAsync(
        string? alertLevel,
        string? product,
        int limit)
    {
        var sql = $@"
            SELECT
                eol_product AS Product,
                eol_product_version AS Version,
                eol_end_of_life AS EndOfLife,
                eol_end_of_extended_support AS EndOfExtendedSupport,
                eol_end_of_support AS EndOfSupport,
                {AlertLevelCase} AS AlertLevel,
                COUNT(DISTINCT asset) AS AffectedAssets
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
                "supported" => " AND (eol_end_of_life > NOW() + INTERVAL '6 months' OR eol_end_of_life IS NULL)",
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
    }

    public async Task<EolSoftwareDetail?> GetByProductVersionAsync(string product, string version)
    {
        var detail = await Db.QueryFirstOrDefaultAsync<EolSoftwareDetail>($@"
            SELECT
                eol_product AS Product,
                eol_product_version AS Version,
                eol_end_of_life AS EndOfLife,
                eol_end_of_extended_support AS EndOfExtendedSupport,
                eol_end_of_support AS EndOfSupport,
                MAX(tag) AS Tag,
                {AlertLevelCase} AS AlertLevel,
                COUNT(DISTINCT asset) AS AffectedAssets
            FROM {Sql.Tables.EolSoftware}
            WHERE eol_product = @Product AND eol_product_version = @Version AND is_active = TRUE
            GROUP BY eol_product, eol_product_version, eol_end_of_life, eol_end_of_extended_support, eol_end_of_support
        ", new { Product = product, Version = version });

        if (detail != null)
        {
            var assets = await Db.QueryAsync<string>($@"
                SELECT DISTINCT asset
                FROM {Sql.Tables.EolSoftware}
                WHERE eol_product = @Product AND eol_product_version = @Version AND is_active = TRUE
                ORDER BY asset
            ", new { Product = product, Version = version });
            detail.Assets = assets.ToList();
        }

        return detail;
    }

    public async Task<IEnumerable<EolSoftware>> GetByServerAsync(string serverName, int limit = 500)
    {
        return await Db.QueryAsync<EolSoftware>($@"
            SELECT
                e.eol_product AS Product,
                e.eol_product_version AS Version,
                e.eol_end_of_life AS EndOfLife,
                e.eol_end_of_extended_support AS EndOfExtendedSupport,
                e.eol_end_of_support AS EndOfSupport,
                {AlertLevelCase.Replace("eol_end_of_life", "e.eol_end_of_life")} AS AlertLevel,
                (SELECT COUNT(DISTINCT e2.asset)::INT
                 FROM {Sql.Tables.EolSoftware} e2
                 WHERE e2.eol_product = e.eol_product
                   AND e2.eol_product_version = e.eol_product_version
                   AND e2.is_active = TRUE) AS AffectedAssets
            FROM {Sql.Tables.EolSoftware} e
            WHERE UPPER(e.asset) = UPPER(@Server) AND e.is_active = TRUE
            ORDER BY e.eol_end_of_life NULLS LAST
            LIMIT @Limit
        ", new { Server = serverName, Limit = limit });
    }
}

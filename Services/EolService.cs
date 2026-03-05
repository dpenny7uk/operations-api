using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

public class EolService : BaseService<EolService>, IEolService
{
    public EolService(IDbConnection db, ILogger<EolService> logger)
        : base(db, logger) { }

    public async Task<EolSummary> GetSummaryAsync()
    {
        return await Db.QueryFirstAsync<EolSummary>($@"
            SELECT
                COUNT(*) FILTER (WHERE eol_end_of_life <= NOW()) AS EolCount,
                COUNT(*) FILTER (WHERE eol_end_of_life > NOW() AND eol_end_of_life <= NOW() + INTERVAL '6 months') AS ApproachingCount,
                COUNT(*) FILTER (WHERE eol_end_of_life > NOW() + INTERVAL '6 months' OR eol_end_of_life IS NULL) AS SupportedCount,
                COUNT(*) AS TotalCount,
                COUNT(DISTINCT asset) FILTER (WHERE eol_end_of_life <= NOW() + INTERVAL '6 months') AS AffectedServers
            FROM {Sql.Tables.EolSoftware}
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
                CASE
                    WHEN eol_end_of_life <= NOW() THEN 'eol'
                    WHEN eol_end_of_life <= NOW() + INTERVAL '6 months' THEN 'approaching'
                    ELSE 'supported'
                END AS AlertLevel,
                COUNT(DISTINCT asset) AS AffectedAssets
            FROM {Sql.Tables.EolSoftware}
            WHERE 1=1";

        var p = new DynamicParameters();

        if (!string.IsNullOrEmpty(product))
        {
            sql += " AND eol_product ILIKE @Product";
            p.Add("Product", $"%{product}%");
        }

        if (!string.IsNullOrEmpty(alertLevel))
        {
            sql += alertLevel.ToLower() switch
            {
                "eol" => " AND eol_end_of_life <= NOW()",
                "approaching" => " AND eol_end_of_life > NOW() AND eol_end_of_life <= NOW() + INTERVAL '6 months'",
                "supported" => " AND (eol_end_of_life > NOW() + INTERVAL '6 months' OR eol_end_of_life IS NULL)",
                _ => ""
            };
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
                tag AS Tag,
                CASE
                    WHEN eol_end_of_life <= NOW() THEN 'eol'
                    WHEN eol_end_of_life <= NOW() + INTERVAL '6 months' THEN 'approaching'
                    ELSE 'supported'
                END AS AlertLevel,
                COUNT(DISTINCT asset) AS AffectedAssets
            FROM {Sql.Tables.EolSoftware}
            WHERE eol_product = @Product AND eol_product_version = @Version
            GROUP BY eol_product, eol_product_version, eol_end_of_life, eol_end_of_extended_support, eol_end_of_support, tag
        ", new { Product = product, Version = version });

        if (detail != null)
        {
            var assets = await Db.QueryAsync<string>($@"
                SELECT DISTINCT asset
                FROM {Sql.Tables.EolSoftware}
                WHERE eol_product = @Product AND eol_product_version = @Version
                ORDER BY asset
            ", new { Product = product, Version = version });
            detail.Assets = assets.ToList();
        }

        return detail;
    }

    public async Task<IEnumerable<EolSoftware>> GetByServerAsync(string serverName)
    {
        return await Db.QueryAsync<EolSoftware>($@"
            SELECT
                eol_product AS Product,
                eol_product_version AS Version,
                eol_end_of_life AS EndOfLife,
                eol_end_of_extended_support AS EndOfExtendedSupport,
                eol_end_of_support AS EndOfSupport,
                CASE
                    WHEN eol_end_of_life <= NOW() THEN 'eol'
                    WHEN eol_end_of_life <= NOW() + INTERVAL '6 months' THEN 'approaching'
                    ELSE 'supported'
                END AS AlertLevel,
                1 AS AffectedAssets
            FROM {Sql.Tables.EolSoftware}
            WHERE asset ILIKE @Server
            ORDER BY eol_end_of_life NULLS LAST
        ", new { Server = $"%{serverName}%" });
    }
}

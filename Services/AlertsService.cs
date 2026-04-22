using System.Data;
using Dapper;
using OperationsApi.Infrastructure;
using OperationsApi.Models;

namespace OperationsApi.Services;

// Recent alerts aggregator — surfaces the most recent notable events across
// unreachable scans, cert expiries, sync failures, and overdue exclusions.
// No dedicated table: everything is derived from existing data at query time.
public class AlertsService : BaseService<AlertsService>, IAlertsService
{
    public AlertsService(IDbConnection db, ILogger<AlertsService> logger)
        : base(db, logger) { }

    public Task<IEnumerable<RecentAlert>> GetRecentAlertsAsync(int limit) => RunDbAsync(async () =>
    {
        // UNION ALL over the four sources, ordered by timestamp, capped.
        var sql = $@"
            WITH alerts AS (
                -- Unreachable servers: each unresolved scan failure is one crit alert.
                SELECT
                    'server:' || sf.server_name AS Id,
                    sf.last_failure_at          AS ""When"",
                    (sf.server_name || ' unreachable') AS Sub,
                    COALESCE(sf.scan_type, 'Scan') || ' failure — ' || sf.failure_count::text || ' attempts' AS Detail,
                    'crit' AS Tone
                FROM {Sql.Tables.ScanFailures} sf
                WHERE NOT sf.is_resolved

                UNION ALL

                -- Certificate criticals (expired / ≤14d): one crit per cert
                SELECT
                    'cert:' || c.certificate_id::text  AS Id,
                    c.valid_to                  AS ""When"",
                    (c.subject_cn || ' expiring') AS Sub,
                    CASE
                        WHEN c.valid_to < CURRENT_DATE THEN 'Expired ' || (CURRENT_DATE - c.valid_to::date)::text || ' days ago'
                        ELSE 'Expires in ' || (c.valid_to::date - CURRENT_DATE)::text || ' days'
                    END AS Detail,
                    CASE WHEN c.valid_to < CURRENT_DATE THEN 'crit' ELSE 'warn' END AS Tone
                FROM certificates.inventory c
                WHERE c.valid_to < CURRENT_DATE + INTERVAL '14 days'

                UNION ALL

                -- Sync freshness: flag feeds with > max_age_hours lag
                SELECT
                    'sync:' || ss.sync_name     AS Id,
                    COALESCE(ss.last_success_at, CURRENT_TIMESTAMP) AS ""When"",
                    (ss.sync_name || ' sync lag') AS Sub,
                    CASE
                        WHEN ss.last_success_at IS NULL THEN 'No successful run on record'
                        ELSE 'Last success ' || EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ss.last_success_at))::int / 3600 || 'h ago'
                    END AS Detail,
                    CASE WHEN ss.consecutive_failures > 2 THEN 'crit' ELSE 'warn' END AS Tone
                FROM {Sql.Tables.SyncStatus} ss
                WHERE ss.last_success_at IS NULL
                   OR EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ss.last_success_at)) / 3600 > ss.max_age_hours

                UNION ALL

                -- Overdue exclusions
                SELECT
                    'exclusion:' || pe.exclusion_id::text AS Id,
                    pe.held_until::timestamptz  AS ""When"",
                    (pe.server_name || ' exclusion overdue') AS Sub,
                    'Hold expired ' || (CURRENT_DATE - pe.held_until)::text || ' days ago — ' || LEFT(pe.reason, 80) AS Detail,
                    'warn' AS Tone
                FROM patching.patch_exclusions pe
                WHERE pe.is_active AND pe.held_until < CURRENT_DATE
            )
            SELECT Id, ""When"", Sub, Detail, Tone
            FROM alerts
            ORDER BY ""When"" DESC
            LIMIT @Limit";

        return await Db.QueryAsync<RecentAlert>(sql, new { Limit = limit });
    });
}

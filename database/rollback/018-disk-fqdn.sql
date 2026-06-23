BEGIN;

-- Rollback: 018-disk-fqdn.sql
-- Removes monitoring.disk_snapshots.fqdn and recreates the disk_current matview
-- without it, restoring the column set and indexes from migration 015.
--
-- WARNING: roll back the application alongside this. The post-018 API selects
-- d.fqdn and filters on COALESCE(fqdn, server_name) for the prod/non-prod
-- (includeNonprod) feature; against a schema without the column those queries
-- error. Deploy the pre-018 build before (or with) this rollback.
--
-- The matview SELECTs * from disk_snapshots, so it depends on the fqdn column and
-- must be dropped before the column can be removed. The 015 SECURITY DEFINER
-- refresh/cleanup functions reference the matview by name only and survive the
-- drop/recreate; the next sync run repopulates the matview on refresh.

-- Drop the matview so the column it selects can be removed.
DROP MATERIALIZED VIEW IF EXISTS monitoring.disk_current;

ALTER TABLE monitoring.disk_snapshots DROP COLUMN IF EXISTS fqdn;

-- Recreate the matview (SELECT * now excludes fqdn), its indexes, and the grant,
-- matching the state left by migration 015.
CREATE MATERIALIZED VIEW monitoring.disk_current AS
SELECT DISTINCT ON (server_name, disk_label) *
FROM monitoring.disk_snapshots
ORDER BY server_name, disk_label, captured_at DESC;

CREATE UNIQUE INDEX idx_disk_current_pk
    ON monitoring.disk_current (server_name, disk_label);

CREATE INDEX idx_disk_current_alert_status
    ON monitoring.disk_current (alert_status DESC, percent_used DESC);

GRANT SELECT ON monitoring.disk_current TO ops_api;

DELETE FROM system.schema_migrations WHERE script_name = '018-disk-fqdn.sql';

COMMIT;

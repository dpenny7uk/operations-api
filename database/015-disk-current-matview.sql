-- Operations Platform - Convert monitoring.disk_current to a MATERIALIZED VIEW
--
-- Background: 013 created monitoring.disk_current as a plain VIEW computing
-- DISTINCT ON (server_name, disk_label) over monitoring.disk_snapshots. With
-- the disk sync writing one row per disk every 15 min and no retention, that
-- view scans an ever-growing history table on every read. The Service Ops
-- Health page issues ~10 of these scans per page load (one list, four-query
-- summary, then a BU-scoped second summary), causing the SPA's 15-second
-- client-side timer (frontend/js/api.js) to fire on /disks and /disks/summary.
--
-- This migration:
--   1. Replaces the VIEW with a MATERIALIZED VIEW so reads hit a small, hot,
--      pre-computed result set (one row per disk, bounded by inventory size).
--   2. Adds a UNIQUE index on (server_name, disk_label) — required by
--      REFRESH MATERIALIZED VIEW CONCURRENTLY (which we want, so reads are
--      never blocked during a refresh).
--   3. Adds a SECURITY DEFINER function monitoring.refresh_disk_current()
--      callable by ops_api. The matview is owned by ops_migrate (the strict
--      ownership rule); ops_api therefore cannot REFRESH it directly. The
--      DEFINER wrapper is the standard PostgreSQL idiom for this scenario:
--      no-args, single fixed statement, search_path pinned to prevent
--      schema-shadowing escalation, EXECUTE granted only to ops_api.
--   4. Adds a SECURITY DEFINER function monitoring.cleanup_disk_snapshots(...)
--      callable by ops_api. Same rationale: lets ops_api trigger a bounded
--      retention DELETE without granting blanket DELETE on disk_snapshots.
--      Wired into sync/maintenance/run_maintenance.py via a new TASKS entry,
--      driven by the new ops-cleanup-disk-snapshots ADO pipeline.
--   5. Updates the solarwinds_disks row in system.sync_status to reflect the
--      new hourly cadence (was 15 min). max_age_hours bumped from 1 → 2 so
--      transient run jitter doesn't trip the staleness threshold at the edge.
--
-- Refresh trigger: sync/disks/sync_solarwinds_disks.py calls the function
-- after the snapshot insert commits. Refresh failures warn-and-continue —
-- snapshot data is durable and the next sync's refresh catches up.
--
-- Idempotent: wrapped in BEGIN/COMMIT; partial failures roll back cleanly.

BEGIN;

-- ========================================================================
-- Replace the plain VIEW with a MATERIALIZED VIEW
-- ========================================================================

DROP VIEW IF EXISTS monitoring.disk_current;

CREATE MATERIALIZED VIEW monitoring.disk_current AS
SELECT DISTINCT ON (server_name, disk_label) *
FROM monitoring.disk_snapshots
ORDER BY server_name, disk_label, captured_at DESC;

-- Ownership: implicit. Prod runs migrations as ops_migrate so the matview is
-- created with that owner by default, matching the rest of the schema. The
-- key invariant — the owner has SELECT on monitoring.disk_snapshots so that
-- REFRESH (and SECURITY DEFINER refresh through it) succeeds — is upheld
-- transitively because ops_migrate owns disk_snapshots from migration 013.

-- Required by REFRESH MATERIALIZED VIEW CONCURRENTLY. Also serves as the
-- natural primary-key lookup for joins on (server_name, disk_label).
CREATE UNIQUE INDEX idx_disk_current_pk
    ON monitoring.disk_current (server_name, disk_label);

-- Mirrors the ORDER BY in DiskMonitoringService.ListDisksAsync so the paged
-- /api/disks list reads in index order. The matview is small (one row per
-- disk), so this index pays for itself even at this size.
CREATE INDEX idx_disk_current_alert_status
    ON monitoring.disk_current (alert_status DESC, percent_used DESC);

GRANT SELECT ON monitoring.disk_current TO ops_api;

-- ========================================================================
-- monitoring.refresh_disk_current()
-- SECURITY DEFINER wrapper so ops_api can refresh a matview owned by
-- ops_migrate. CONCURRENTLY does not block plain SELECTs (it only takes
-- EXCLUSIVE on internal matview state), so the API stays responsive
-- throughout. CONCURRENTLY requires the unique index above.
-- ========================================================================

CREATE OR REPLACE FUNCTION monitoring.refresh_disk_current()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, monitoring
AS $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY monitoring.disk_current;
$$;

REVOKE ALL ON FUNCTION monitoring.refresh_disk_current() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION monitoring.refresh_disk_current() TO ops_api;

-- ========================================================================
-- monitoring.cleanup_disk_snapshots(p_retain_days INTEGER)
-- Retention DELETE for the append-only history table. SECURITY DEFINER so
-- ops_api does not need DELETE on disk_snapshots. Returns the row count
-- deleted so the caller can log it.
--
-- Default retention: 90 days — three times the 30-day projection window
-- used by DiskMonitoringService.ProjectionWindowDays. Capped here to bound
-- matview refresh time (refresh scans the full snapshots table each run).
-- ========================================================================

CREATE OR REPLACE FUNCTION monitoring.cleanup_disk_snapshots(p_retain_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, monitoring
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM monitoring.disk_snapshots
    WHERE captured_at < CURRENT_TIMESTAMP - (p_retain_days || ' days')::INTERVAL;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION monitoring.cleanup_disk_snapshots(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION monitoring.cleanup_disk_snapshots(INTEGER) TO ops_api;

-- ========================================================================
-- Update sync_status row to reflect the new hourly cadence
-- ========================================================================

UPDATE system.sync_status
SET expected_schedule = 'Every hour',
    max_age_hours = 2
WHERE sync_name = 'solarwinds_disks';

-- ========================================================================
-- Migration tracking
-- ========================================================================

INSERT INTO system.schema_migrations (script_name, description)
VALUES (
    '015-disk-current-matview.sql',
    'Convert monitoring.disk_current to a materialized view; add SECURITY DEFINER refresh + cleanup functions; relax solarwinds_disks sync cadence from 15 min to hourly'
)
ON CONFLICT (script_name) DO NOTHING;

COMMIT;

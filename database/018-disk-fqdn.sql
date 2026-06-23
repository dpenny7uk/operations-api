-- Operations Platform - Add authoritative FQDN to disk monitoring
--
-- Background: the disk view's "Server" comes from SolarWinds Nodes.Caption, which
-- is inconsistent (sometimes an FQDN, sometimes a short name) and gives no
-- reliable way to tell production from non-production disks. The Environment tag
-- classifies by ROLE (Production / Shared Services / ...), not by deployment
-- domain, so non-prod boxes living in the *.hiscox.nonprod domain are tagged
-- production-class and slip into the default view.
--
-- This migration adds monitoring.disk_snapshots.fqdn, populated from SolarWinds
-- Nodes.DNS by sync/disks/sync_solarwinds_disks.py. The FQDN's domain
-- (.hiscox.nonprod vs .hiscox.com) is the authoritative prod/non-prod signal, and
-- a real FQDN also gives the SPA a dependable FQDN column (replacing the sparse,
-- unreliable shared.servers join).
--
-- disk_current is a MATERIALIZED VIEW (migration 015) defined as SELECT * over
-- disk_snapshots. A matview cannot be CREATE OR REPLACE'd to add a column, so we
-- drop and recreate it, re-creating its two indexes and the ops_api grant. The
-- SECURITY DEFINER refresh/cleanup functions from 015 reference the matview by
-- name only (string-body SQL functions track no dependency) and remain valid.
--
-- Existing rows get fqdn = NULL until the next sync run repopulates them.
-- Idempotent: ADD COLUMN IF NOT EXISTS + DROP ... IF EXISTS, wrapped in a txn.

BEGIN;

-- ========================================================================
-- Add the column to the append-only history table
-- ========================================================================

ALTER TABLE monitoring.disk_snapshots ADD COLUMN IF NOT EXISTS fqdn VARCHAR(500);

-- ========================================================================
-- Recreate the materialized view so SELECT * picks up the new column
-- ========================================================================

DROP MATERIALIZED VIEW IF EXISTS monitoring.disk_current;

CREATE MATERIALIZED VIEW monitoring.disk_current AS
SELECT DISTINCT ON (server_name, disk_label) *
FROM monitoring.disk_snapshots
ORDER BY server_name, disk_label, captured_at DESC;

-- Required by REFRESH MATERIALIZED VIEW CONCURRENTLY (used by
-- monitoring.refresh_disk_current()); also the natural PK lookup.
CREATE UNIQUE INDEX idx_disk_current_pk
    ON monitoring.disk_current (server_name, disk_label);

-- Mirrors the ORDER BY in DiskMonitoringService.ListDisksAsync.
CREATE INDEX idx_disk_current_alert_status
    ON monitoring.disk_current (alert_status DESC, percent_used DESC);

GRANT SELECT ON monitoring.disk_current TO ops_api;

-- ========================================================================
-- Migration tracking
-- ========================================================================

INSERT INTO system.schema_migrations (script_name, description)
VALUES (
    '018-disk-fqdn.sql',
    'Add fqdn (SolarWinds Nodes.DNS) to disk_snapshots; recreate disk_current matview to expose it (enables a reliable FQDN column and prod/non-prod domain classification)'
)
ON CONFLICT (script_name) DO NOTHING;

COMMIT;

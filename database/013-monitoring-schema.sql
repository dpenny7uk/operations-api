-- Operations Platform - Monitoring Schema (Disk Snapshots + Alerts)
-- Source: SolarWinds Orion via sync/disks/sync_solarwinds_disks.py
-- Replaces the Tableau disk-monitoring dashboard (decommissioned September 2026)
-- and closes the alerting gap (Tableau had no Teams notifications).
--
-- Alert thresholds replicate Tableau's calculated fields exactly:
--   warn (status=2): percent_used >= 80 (global, no per-disk override)
--   crit (status=3): percent_used >= IFNULL(Volumes.Alert Vol, 90)
-- Globals are configurable in appsettings.json so ops can tune without DDL.
--
-- Grants are included here (unlike 010 which needed 011 as a follow-up) so
-- ops_api can read snapshots and alert script can write to monitoring.alerts.
-- This migration is idempotent — safe to re-run.

BEGIN;

CREATE SCHEMA IF NOT EXISTS monitoring;

-- ========================================================================
-- monitoring.disk_snapshots
-- Append-only history table. Each sync run inserts one row per disk.
-- Owner / env / service / tier are denormalised onto every row so historical
-- snapshots stay correct even if Nodes ownership changes later.
-- ========================================================================

CREATE TABLE IF NOT EXISTS monitoring.disk_snapshots (
    snapshot_id        BIGSERIAL PRIMARY KEY,
    captured_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Server context (denormalised from SolarWinds Nodes)
    server_name        VARCHAR(255) NOT NULL,
    service            VARCHAR(255),
    environment        VARCHAR(100),
    technical_owner    VARCHAR(255),
    business_owner     VARCHAR(255),
    business_unit      VARCHAR(255),
    tier               VARCHAR(50),

    -- Disk
    disk_label         VARCHAR(255) NOT NULL,
    volume_size_gb     NUMERIC(12,2) NOT NULL,
    used_gb            NUMERIC(12,2) NOT NULL,
    free_gb            NUMERIC(12,2) NOT NULL,
    percent_used       NUMERIC(5,2) NOT NULL,

    -- Alert state at capture time
    alert_status       SMALLINT NOT NULL CHECK (alert_status IN (1, 2, 3)),
    threshold_warn_pct NUMERIC(5,2) NOT NULL,
    threshold_crit_pct NUMERIC(5,2) NOT NULL,

    -- Source traceability
    source_volume_id   INTEGER NOT NULL,
    source_node_id     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_disk_snap_server_disk_time
    ON monitoring.disk_snapshots (server_name, disk_label, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_disk_snap_captured_at
    ON monitoring.disk_snapshots (captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_disk_snap_alert_status
    ON monitoring.disk_snapshots (alert_status, captured_at DESC)
    WHERE alert_status >= 2;

-- ========================================================================
-- monitoring.disk_current
-- Latest snapshot per (server, disk). Used by /api/disks and the
-- AlertsService UNION for the in-app feed.
-- ========================================================================

CREATE OR REPLACE VIEW monitoring.disk_current AS
SELECT DISTINCT ON (server_name, disk_label) *
FROM monitoring.disk_snapshots
ORDER BY server_name, disk_label, captured_at DESC;

-- ========================================================================
-- monitoring.alerts
-- Tracks Teams-push notifications for de-duplication, mirroring the
-- certificates.alerts pattern. The alert script consults this table to
-- decide whether to fire a fresh card or stay quiet (cooldown).
-- ========================================================================

CREATE TABLE IF NOT EXISTS monitoring.alerts (
    alert_id              BIGSERIAL PRIMARY KEY,
    server_name           VARCHAR(255) NOT NULL,
    disk_label            VARCHAR(255) NOT NULL,
    alert_type            VARCHAR(50) NOT NULL CHECK (alert_type IN ('breach_warn', 'breach_crit', 'resolved')),
    alert_status_at_send  SMALLINT NOT NULL CHECK (alert_status_at_send IN (1, 2, 3)),
    percent_used_at_send  NUMERIC(5,2) NOT NULL,

    -- Notification tracking
    notification_sent     BOOLEAN NOT NULL DEFAULT FALSE,
    notification_sent_at  TIMESTAMPTZ,

    -- Resolution
    resolved              BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at           TIMESTAMPTZ,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Active (unresolved) alerts per disk — drives the cooldown lookup.
CREATE INDEX IF NOT EXISTS idx_disk_alerts_active
    ON monitoring.alerts (server_name, disk_label, notification_sent_at DESC)
    WHERE NOT resolved;

-- ========================================================================
-- Grants
-- ops_migrate creates; ops_api reads snapshots + reads/writes alerts.
-- ========================================================================

GRANT USAGE ON SCHEMA monitoring TO ops_api;

GRANT SELECT, INSERT ON monitoring.disk_snapshots TO ops_api;
GRANT SELECT ON monitoring.disk_current TO ops_api;
GRANT SELECT, INSERT, UPDATE ON monitoring.alerts TO ops_api;

GRANT USAGE ON SEQUENCE monitoring.disk_snapshots_snapshot_id_seq TO ops_api;
GRANT USAGE ON SEQUENCE monitoring.alerts_alert_id_seq TO ops_api;

-- ========================================================================
-- Migration tracking
-- ========================================================================

INSERT INTO system.schema_migrations (script_name, description)
VALUES ('013-monitoring-schema.sql', 'Disk monitoring: SolarWinds disk_snapshots + disk_current view + alerts log (Tableau replacement)')
ON CONFLICT (script_name) DO NOTHING;

COMMIT;

-- Design v2 column additions
-- Service Ops Console v2 design expects additional fields on servers, exclusions,
-- and can reuse known_issues.status / shared.servers.synced_at directly.
-- ALTER TABLE grants carry forward existing SELECT/INSERT/UPDATE permissions
-- automatically — no new GRANT statements required.
-- This migration is idempotent — safe to re-run.

BEGIN;

-- ========================================================================
-- shared.servers: service, func (function), last_seen_at
-- Populated by Databricks sync (sync_server_list.py) once columns exist.
-- Until then values are NULL and the frontend renders em-dashes.
-- ========================================================================

ALTER TABLE shared.servers
    ADD COLUMN IF NOT EXISTS service VARCHAR(255);

ALTER TABLE shared.servers
    ADD COLUMN IF NOT EXISTS func VARCHAR(500);

ALTER TABLE shared.servers
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- ========================================================================
-- patching.patch_exclusions: ticket, reason_slug, notes
-- The design's Add-exclusion wizard captures a reason preset (slug) + a
-- required ticket + free-text notes. The existing `reason` column stays
-- as the user-facing explanatory text (populated from preset label +
-- optional custom text).
-- ========================================================================

ALTER TABLE patching.patch_exclusions
    ADD COLUMN IF NOT EXISTS ticket VARCHAR(100);

ALTER TABLE patching.patch_exclusions
    ADD COLUMN IF NOT EXISTS reason_slug VARCHAR(50);

ALTER TABLE patching.patch_exclusions
    ADD COLUMN IF NOT EXISTS notes TEXT;

-- ========================================================================
-- Refresh the active-exclusions view to include the new columns so
-- downstream callers (alerts, frontend) can project them.
-- DROP + CREATE (not CREATE OR REPLACE): Postgres rejects replacing a view
-- when the new column list reorders or renames existing positions — it can
-- only append. The new columns (reason_slug, notes, ticket) sit mid-list.
-- ========================================================================

DROP VIEW IF EXISTS patching.v_active_exclusions;

CREATE VIEW patching.v_active_exclusions AS
SELECT
    pe.exclusion_id,
    pe.server_id,
    pe.server_name,
    s.environment,
    pe.reason,
    pe.reason_slug,
    pe.notes,
    pe.ticket,
    pe.held_until,
    pe.excluded_by,
    pe.excluded_at,
    (pe.held_until <= CURRENT_DATE) AS hold_expired
FROM patching.patch_exclusions pe
LEFT JOIN shared.servers s ON pe.server_id = s.server_id
WHERE pe.is_active
ORDER BY pe.held_until, pe.server_name;

-- ========================================================================
-- Migration tracking
-- ========================================================================

INSERT INTO system.schema_migrations (script_name, description)
VALUES ('012-design-v2-fields.sql', 'Service Ops Console v2: server service/func/last_seen_at; exclusion ticket/reason_slug/notes')
ON CONFLICT (script_name) DO NOTHING;

COMMIT;

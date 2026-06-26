BEGIN;

-- Rollback: 020-auditing-schema.sql
-- Drops the entire auditing schema (bindings, nominees, campaigns, packets,
-- subjects, decisions, email_log, and the AD-sync tables) and removes the
-- per-app audit-config columns added to shared.applications.
--
-- WARNING: roll back the application alongside this. The post-020 build wires
-- AuditingApplications/AuditingCampaigns controllers and the SPA's
-- /api/auditing/* calls to these tables; against a schema without them those
-- queries error. Deploy the pre-020 build (which serves Auditing from the
-- frontend demo fixture) before or with this rollback.
--
-- CASCADE removes all dependent tables, FKs, indexes, sequences, and the
-- updated_at trigger on application_groups in one step.

DROP SCHEMA IF EXISTS auditing CASCADE;

-- Drop the audit-config columns from shared.applications. Dropping
-- audit_routing_mode also drops its chk_app_routing_mode CHECK constraint.
ALTER TABLE shared.applications DROP COLUMN IF EXISTS audit_frequency_months;
ALTER TABLE shared.applications DROP COLUMN IF EXISTS auto_launch;
ALTER TABLE shared.applications DROP COLUMN IF EXISTS audit_routing_mode;
ALTER TABLE shared.applications DROP COLUMN IF EXISTS audit_due_period_days;

DELETE FROM system.schema_migrations WHERE script_name = '020-auditing-schema.sql';

COMMIT;

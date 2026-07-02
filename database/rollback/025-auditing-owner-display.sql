BEGIN;

-- Rollback: 025-auditing-owner-display.sql

ALTER TABLE shared.applications DROP COLUMN IF EXISTS business_owner_display;
ALTER TABLE shared.applications DROP COLUMN IF EXISTS technical_owner_display;

DELETE FROM system.schema_migrations WHERE script_name = '025-auditing-owner-display.sql';

COMMIT;

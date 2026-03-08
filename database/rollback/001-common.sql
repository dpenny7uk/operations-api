BEGIN;

-- Rollback: 001-common.sql
-- Removes utility functions and custom domains from the system schema.
--
-- WARNING: Run AFTER rolling back 002, 003, 004, 005, 006, 007.
-- The system schema itself is dropped last because later scripts depend on it.
-- If those rollback scripts have already been applied, it is safe to DROP SCHEMA
-- system CASCADE here — otherwise drop objects individually.

DROP FUNCTION IF EXISTS system.create_updated_at_trigger(TEXT, TEXT);
DROP FUNCTION IF EXISTS system.set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS system.normalize_server_name(TEXT);

DROP DOMAIN IF EXISTS system.criticality_type;
DROP DOMAIN IF EXISTS system.severity_type;
DROP DOMAIN IF EXISTS system.health_status_type;
DROP DOMAIN IF EXISTS system.sync_status_type;

-- Drop the system schema only if all dependent objects have already been removed
-- (i.e. all other rollback scripts have run). Use CASCADE with caution.
-- DROP SCHEMA IF EXISTS system CASCADE;

COMMIT;

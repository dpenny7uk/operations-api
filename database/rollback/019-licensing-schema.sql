BEGIN;

-- Rollback: 019-licensing-schema.sql
-- Drops the entire licensing schema (licences, renewals, alerts) and its
-- migration-tracking row.
--
-- WARNING: roll back the application alongside this. The post-019 build wires
-- LicensingController/LicensingService and the SPA's /api/licensing/* calls to
-- these tables; against a schema without them those queries error. Deploy the
-- pre-019 build (which serves Licensing from the frontend demo fixture) before
-- or with this rollback.
--
-- CASCADE removes the dependent renewals/alerts tables, their FKs, indexes,
-- sequences, and the updated_at trigger on licences in one step.

DROP SCHEMA IF EXISTS licensing CASCADE;

DELETE FROM system.schema_migrations WHERE script_name = '019-licensing-schema.sql';

COMMIT;

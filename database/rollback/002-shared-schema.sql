-- Rollback: 002-shared-schema.sql
-- Drops the shared schema (servers and applications) entirely.
--
-- WARNING: This will delete ALL server and application data.
-- Ensure a database backup exists before running.
-- Run BEFORE rolling back 001-common.sql.

DROP VIEW IF EXISTS shared.v_application_summary;
DROP TABLE IF EXISTS shared.servers CASCADE;
DROP TABLE IF EXISTS shared.applications CASCADE;
DROP SCHEMA IF EXISTS shared CASCADE;

-- Rollback: 004-patching-schema.sql
-- Drops the patching schema and all its contents.
--
-- WARNING: This will delete ALL patch cycle, schedule, window, and known issue data.
-- Ensure a database backup exists before running.
-- Run BEFORE rolling back 003-certificates-schema.sql.

DROP SCHEMA IF EXISTS patching CASCADE;

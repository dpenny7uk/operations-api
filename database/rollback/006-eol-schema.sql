-- Rollback: 006-eol-schema.sql
-- Drops the eol schema and all its contents.
--
-- WARNING: This will delete ALL end-of-life software tracking data.
-- Ensure a database backup exists before running.
-- Run BEFORE rolling back 005-system-health-schema.sql.

DROP SCHEMA IF EXISTS eol CASCADE;

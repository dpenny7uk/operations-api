-- Rollback: 003-certificates-schema.sql
-- Drops the certificates schema and all its contents.
--
-- WARNING: This will delete ALL certificate inventory, scan, and alert data.
-- Ensure a database backup exists before running.
-- Run BEFORE rolling back 002-shared-schema.sql.

DROP SCHEMA IF EXISTS certificates CASCADE;

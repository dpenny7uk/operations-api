-- Operations Platform - Required Extensions
-- Run FIRST with superuser privileges

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;  -- levenshtein(), soundex()
CREATE EXTENSION IF NOT EXISTS pg_trgm;        -- similarity(), trigram indexes
CREATE EXTENSION IF NOT EXISTS pgcrypto;       -- gen_random_uuid()

-- Verify installation
DO $$
BEGIN
    PERFORM levenshtein('test', 'tset');
    PERFORM similarity('test', 'tset');
    RAISE NOTICE 'All extensions installed successfully';
EXCEPTION WHEN undefined_function THEN
    RAISE EXCEPTION 'Extension installation failed - check superuser privileges';
END $$;

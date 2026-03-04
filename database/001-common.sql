-- Operations Platform - Common Types & Utilities

CREATE SCHEMA IF NOT EXISTS system;

-- ===========================================
-- CUSTOM DOMAINS (eliminate duplicate CHECKs)
-- ===========================================

DO $$ BEGIN
    CREATE DOMAIN system.sync_status_type AS VARCHAR(20)
        CHECK (VALUE IN ('running', 'success', 'error', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE DOMAIN system.health_status_type AS VARCHAR(20)
        CHECK (VALUE IN ('healthy', 'warning', 'error', 'unknown'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE DOMAIN system.severity_type AS VARCHAR(20)
        CHECK (VALUE IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE DOMAIN system.criticality_type AS VARCHAR(20)
        CHECK (VALUE IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================
-- UTILITY FUNCTIONS
-- ===========================================

-- Auto-update timestamp trigger function
CREATE OR REPLACE FUNCTION system.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helper to create updated_at triggers on any table
CREATE OR REPLACE FUNCTION system.create_updated_at_trigger(p_schema TEXT, p_table TEXT)
RETURNS VOID AS $$
DECLARE
    v_trigger_name TEXT := 'trg_' || p_table || '_updated_at';
BEGIN
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I', v_trigger_name, p_schema, p_table);
    EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I.%I 
         FOR EACH ROW EXECUTE FUNCTION system.set_updated_at()',
        v_trigger_name, p_schema, p_table
    );
END;
$$ LANGUAGE plpgsql;

-- Normalize server names for matching (removes domain suffixes, lowercases)
CREATE OR REPLACE FUNCTION system.normalize_server_name(raw_name TEXT)
RETURNS TEXT AS $$
BEGIN
    IF raw_name IS NULL THEN
        RETURN NULL;
    END IF;
    
    RETURN LOWER(TRIM(
        REGEXP_REPLACE(
            REGEXP_REPLACE(raw_name, 
                '\.(contoso\.com|corp\.local|domain\.local)$', '', 'i'),
            '\.(local|internal|com)$', '', 'i'
        )
    ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

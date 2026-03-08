BEGIN;

-- Operations Platform - End of Life Schema
-- Source: Databricks gold_asset_inventory.end_of_life_software

CREATE SCHEMA IF NOT EXISTS eol;

-- ===========================================
-- END OF LIFE SOFTWARE
-- ===========================================

CREATE TABLE IF NOT EXISTS eol.end_of_life_software (
    eol_id                      SERIAL PRIMARY KEY,

    -- Product identification
    eol_product                 VARCHAR(255) NOT NULL,
    eol_product_version         VARCHAR(100) NOT NULL,

    -- Lifecycle dates
    eol_end_of_life             TIMESTAMP,
    eol_end_of_support          TIMESTAMP,
    eol_end_of_extended_support TIMESTAMP,

    -- Asset association
    asset                       VARCHAR(255),
    tag                         VARCHAR(255),

    -- Sync tracking
    source_system               VARCHAR(50) DEFAULT 'databricks',
    is_active                   BOOLEAN DEFAULT TRUE,

    -- Timestamps
    created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    synced_at                   TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_eol_product_asset
    ON eol.end_of_life_software (eol_product, eol_product_version, COALESCE(asset, ''));

CREATE INDEX IF NOT EXISTS idx_eol_product ON eol.end_of_life_software(eol_product);
CREATE INDEX IF NOT EXISTS idx_eol_version ON eol.end_of_life_software(eol_product, eol_product_version);
CREATE INDEX IF NOT EXISTS idx_eol_asset ON eol.end_of_life_software(asset);
CREATE INDEX IF NOT EXISTS idx_eol_end_of_life ON eol.end_of_life_software(eol_end_of_life) WHERE is_active;

-- ===========================================
-- VIEWS
-- ===========================================

-- Summary of distinct product/version combinations with asset counts
CREATE OR REPLACE VIEW eol.v_software_summary AS
SELECT
    eol_product,
    eol_product_version,
    eol_end_of_life,
    eol_end_of_support,
    eol_end_of_extended_support,
    COUNT(DISTINCT asset) AS affected_assets,
    CASE
        WHEN eol_end_of_life <= CURRENT_TIMESTAMP THEN 'EOL'
        WHEN eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months' THEN 'APPROACHING'
        ELSE 'SUPPORTED'
    END AS alert_level
FROM eol.end_of_life_software
WHERE is_active
GROUP BY eol_product, eol_product_version, eol_end_of_life, eol_end_of_support, eol_end_of_extended_support
ORDER BY eol_end_of_life NULLS LAST;

-- Assets running EOL or approaching-EOL software, joined to servers
CREATE OR REPLACE VIEW eol.v_at_risk_servers AS
SELECT
    e.asset,
    s.server_id,
    s.server_name,
    s.environment,
    a.application_name,
    a.criticality,
    COUNT(*) FILTER (WHERE e.eol_end_of_life <= CURRENT_TIMESTAMP) AS eol_product_count,
    COUNT(*) FILTER (WHERE e.eol_end_of_life > CURRENT_TIMESTAMP
                       AND e.eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months') AS approaching_product_count,
    ARRAY_AGG(DISTINCT e.eol_product || ' ' || e.eol_product_version
              ORDER BY e.eol_product || ' ' || e.eol_product_version)
        FILTER (WHERE e.eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months') AS at_risk_products,
    -- Impact score for prioritization
    (
        COUNT(*) FILTER (WHERE e.eol_end_of_life <= CURRENT_TIMESTAMP) * 30 +
        COUNT(*) FILTER (WHERE e.eol_end_of_life > CURRENT_TIMESTAMP
                           AND e.eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months') * 10 +
        CASE WHEN s.environment ILIKE 'prod%' THEN 25 ELSE 0 END +
        CASE a.criticality
            WHEN 'CRITICAL' THEN 50
            WHEN 'HIGH' THEN 30
            ELSE 10
        END
    ) AS impact_score
FROM eol.end_of_life_software e
LEFT JOIN system.server_aliases sa ON UPPER(e.asset) = UPPER(sa.alias_name)
LEFT JOIN shared.servers s ON (UPPER(e.asset) = UPPER(s.server_name) OR (sa.canonical_name IS NOT NULL AND s.server_name = sa.canonical_name)) AND s.is_active
LEFT JOIN shared.applications a ON s.primary_application_id = a.application_id
WHERE e.is_active
  AND e.eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months'
GROUP BY e.asset, s.server_id, s.server_name, s.environment, a.application_name, a.criticality
ORDER BY impact_score DESC;

-- ===========================================
-- TRIGGERS
-- ===========================================

SELECT system.create_updated_at_trigger('eol', 'end_of_life_software');

COMMIT;

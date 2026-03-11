BEGIN;

-- Rollback: remove machine_name column, restore original indexes and views

-- Drop new indexes
DROP INDEX IF EXISTS eol.uq_eol_product_machine;
DROP INDEX IF EXISTS eol.idx_eol_machine_name_active;

-- Restore original unique index keyed on (product, version, asset)
CREATE UNIQUE INDEX IF NOT EXISTS uq_eol_product_asset
    ON eol.end_of_life_software (eol_product, eol_product_version, COALESCE(asset, ''));

-- Restore original v_software_summary using asset
CREATE OR REPLACE VIEW eol.v_software_summary AS
SELECT
    eol_product,
    eol_product_version,
    eol_end_of_life,
    eol_end_of_support,
    eol_end_of_extended_support,
    COUNT(DISTINCT asset) AS affected_assets,
    CASE
        WHEN eol_end_of_life IS NULL THEN 'UNKNOWN'
        WHEN eol_end_of_life <= CURRENT_TIMESTAMP THEN 'EOL'
        WHEN eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months' THEN 'APPROACHING'
        ELSE 'SUPPORTED'
    END AS alert_level
FROM eol.end_of_life_software
WHERE is_active
GROUP BY eol_product, eol_product_version, eol_end_of_life, eol_end_of_support, eol_end_of_extended_support
ORDER BY eol_end_of_life NULLS LAST;

-- Restore original v_at_risk_servers using asset with server_aliases lookup
CREATE OR REPLACE VIEW eol.v_at_risk_servers AS
SELECT
    COALESCE(e.asset, '') AS asset,
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
GROUP BY COALESCE(e.asset, ''), s.server_id, s.server_name, s.environment, a.application_name, a.criticality
ORDER BY impact_score DESC;

-- Drop machine_name column
ALTER TABLE eol.end_of_life_software DROP COLUMN IF EXISTS machine_name;

COMMIT;

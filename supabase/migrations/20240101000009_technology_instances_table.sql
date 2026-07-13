-- =============================================================================
-- Migration 009 – Technology instances table
-- =============================================================================
-- Stores every EquipmentInstance as its own row, related to the parent
-- Technology via a foreign key.  This enables:
--   • Direct instance queries (filter by country, lifecycle, year)
--   • Admin management of individual instances without rewriting full payload
--   • World-map and analytics queries without loading all 80 technology payloads
--   • Granular contributor approvals that append a single instance
--
-- The parent `technologies.payload` JSONB still contains nested instances
-- for fast full-object loading by the API.  Both are kept in sync:
--   • Seed script writes to both tables.
--   • Approval merges write to both tables.
--   • The loader reads from `technologies.payload` (no JOIN overhead).
--
-- RLS: all access through the FastAPI backend (service-role key only).
-- =============================================================================

CREATE TABLE IF NOT EXISTS technology_instances (
    id                  UUID        PRIMARY KEY,
    technology_uuid     UUID        NOT NULL REFERENCES technologies (id) ON DELETE CASCADE,
    technology_id       TEXT        NOT NULL,   -- denormalised slug for convenience
    instance_id         TEXT        NOT NULL,   -- slug within the technology, e.g. "ccgt_800mw_current"
    label               TEXT        NOT NULL,

    -- Lifecycle / provenance metadata (indexed for filtering)
    life_cycle_stage    TEXT        DEFAULT 'commercial'
                            CHECK (life_cycle_stage IN ('commercial', 'demonstration', 'projection', 'decommissioned')),
    reference_year      INT,
    country_iso2        TEXT,
    reference_source    TEXT,

    -- Key economic parameters (flat columns — fast range queries)
    capex_usd_per_kw    NUMERIC,
    opex_fixed_usd_per_kw_yr  NUMERIC,
    opex_var_usd_per_mwh      NUMERIC,
    efficiency_fraction NUMERIC,
    lifetime_years      NUMERIC,
    co2_t_per_mwh       NUMERIC,

    -- Full EquipmentInstance payload for round-tripping
    payload             JSONB       NOT NULL DEFAULT '{}',

    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (technology_uuid, instance_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_instances_technology_uuid
    ON technology_instances (technology_uuid);

CREATE INDEX IF NOT EXISTS idx_instances_lifecycle
    ON technology_instances (life_cycle_stage);

CREATE INDEX IF NOT EXISTS idx_instances_country
    ON technology_instances (country_iso2);

CREATE INDEX IF NOT EXISTS idx_instances_year
    ON technology_instances (reference_year);

CREATE INDEX IF NOT EXISTS idx_instances_active
    ON technology_instances (is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_instances_payload_gin
    ON technology_instances USING gin (payload);

-- ---------------------------------------------------------------------------
-- Auto-update updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _set_instance_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_instances_updated_at ON technology_instances;
CREATE TRIGGER trg_instances_updated_at
    BEFORE UPDATE ON technology_instances
    FOR EACH ROW EXECUTE FUNCTION _set_instance_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE technology_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON technology_instances
    TO service_role
    USING (true)
    WITH CHECK (true);

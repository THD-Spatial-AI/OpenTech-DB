-- =============================================================================
-- Migration 008 – Canonical Technologies table
-- =============================================================================
-- Stores every Technology as a row so Supabase is the primary data store
-- instead of the repo JSON files.
--
-- Schema design:
--   • Top-level indexed columns (id, technology_id, category, carrier …) allow
--     fast filtering without scanning JSONB.
--   • `payload` (JSONB) — full Pydantic-serialised Technology object, round-
--     trippable through model_validate(). Includes all instances and parameters.
--   • `is_active` — soft-delete flag; loaders only read WHERE is_active = TRUE.
--
-- RLS summary: all access goes through FastAPI with the service-role key.
-- =============================================================================

CREATE TABLE IF NOT EXISTS technologies (
    id              UUID        PRIMARY KEY,
    technology_id   TEXT        UNIQUE NOT NULL,   -- slug, e.g. "ccgt", "solar_pv_utility"
    name            TEXT        NOT NULL,
    category        TEXT        NOT NULL DEFAULT 'generation'
                        CHECK (category IN ('generation', 'storage', 'transmission', 'conversion')),
    carrier         TEXT,
    oeo_class       TEXT,
    oeo_uri         TEXT,
    description     TEXT,
    payload         JSONB       NOT NULL DEFAULT '{}',
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_technologies_category
    ON technologies (category);

CREATE INDEX IF NOT EXISTS idx_technologies_carrier
    ON technologies (carrier);

CREATE INDEX IF NOT EXISTS idx_technologies_active
    ON technologies (is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_technologies_payload_gin
    ON technologies USING gin (payload);

-- ---------------------------------------------------------------------------
-- Auto-update updated_at on every write
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _set_technology_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_technologies_updated_at ON technologies;
CREATE TRIGGER trg_technologies_updated_at
    BEFORE UPDATE ON technologies
    FOR EACH ROW EXECUTE FUNCTION _set_technology_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE technologies ENABLE ROW LEVEL SECURITY;

-- service_role (used by the FastAPI backend) — full access
CREATE POLICY "service_role_full_access" ON technologies
    TO service_role
    USING (true)
    WITH CHECK (true);

-- No browser-role policies: all reads/writes go through the backend.

-- Migration 002: Technology Catalogue
-- Run this in the Supabase SQL editor (https://app.supabase.com → SQL Editor)

-- Core technology definitions (master list)
CREATE TABLE IF NOT EXISTS technologies (
    technology_id    TEXT PRIMARY KEY,          -- e.g. "solar_pv_utility"
    technology_name  TEXT NOT NULL,             -- human-readable name
    domain           TEXT NOT NULL,             -- generation | storage | conversion | transmission | heating | transport
    carrier          TEXT,                      -- electricity | heat | hydrogen | gas | ...
    oeo_class        TEXT,                      -- Open Energy Ontology class URI (optional)
    description      TEXT,
    metadata         JSONB NOT NULL DEFAULT '{}'
);

-- Concrete technology instances scraped / curated from data catalogue
CREATE TABLE IF NOT EXISTS technology_instances (
    id                               BIGSERIAL PRIMARY KEY,
    instance_id                      TEXT UNIQUE NOT NULL,
    technology_id                    TEXT NOT NULL REFERENCES technologies(technology_id),
    instance_name                    TEXT NOT NULL,
    country                          TEXT,
    country_iso2                     TEXT,
    country_inference_source         TEXT,
    scale                            TEXT,                    -- utility | residential | industrial | ...
    typical_capacity_mw              NUMERIC,
    capex_usd_per_kw                 NUMERIC,
    opex_fixed_usd_per_kw_yr         NUMERIC,
    opex_var_usd_per_mwh             NUMERIC,
    efficiency_percent               NUMERIC,
    lifetime_years                   NUMERIC,
    co2_emission_factor_operational_g_per_kwh  NUMERIC,
    reference_source                 TEXT,
    extra_fields                     JSONB NOT NULL DEFAULT '{}'
);

-- Enable Row Level Security (Supabase best practice)
ALTER TABLE technologies ENABLE ROW LEVEL SECURITY;
ALTER TABLE technology_instances ENABLE ROW LEVEL SECURITY;

-- Allow unrestricted SELECT for the anon role (public read)
CREATE POLICY "Allow public read on technologies"
    ON technologies FOR SELECT
    USING (true);

CREATE POLICY "Allow public read on technology_instances"
    ON technology_instances FOR SELECT
    USING (true);

-- Allow service_role full access (used by backend / migration scripts)
CREATE POLICY "Allow service role full access on technologies"
    ON technologies FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role full access on technology_instances"
    ON technology_instances FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_technologies_domain   ON technologies (domain);
CREATE INDEX IF NOT EXISTS idx_tech_instances_tech   ON technology_instances (technology_id);
CREATE INDEX IF NOT EXISTS idx_tech_instances_scale  ON technology_instances (scale);
CREATE INDEX IF NOT EXISTS idx_tech_instances_country_iso2 ON technology_instances (country_iso2);

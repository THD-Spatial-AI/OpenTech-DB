-- Migration 003: Add country columns to technology_instances
-- Run this in the Supabase SQL editor after migration 002.

ALTER TABLE IF EXISTS technology_instances
    ADD COLUMN IF NOT EXISTS country TEXT,
    ADD COLUMN IF NOT EXISTS country_iso2 TEXT,
    ADD COLUMN IF NOT EXISTS country_inference_source TEXT;

CREATE INDEX IF NOT EXISTS idx_tech_instances_country_iso2
    ON technology_instances (country_iso2);

CREATE INDEX IF NOT EXISTS idx_tech_instances_country
    ON technology_instances (country);

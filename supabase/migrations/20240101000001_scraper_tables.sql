-- =============================================================================
-- Migration 001 – Scraper pipeline tables
-- =============================================================================
-- Run this once in the Supabase SQL Editor (or via supabase db push).
--
-- Tables
--   scraper_candidates  – one row per extracted paper candidate
--   scraper_runs        – one row per pipeline run
--
-- The backend uses the service-role key which bypasses RLS,
-- so no explicit policies are required for server-to-server writes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- scraper_candidates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scraper_candidates (
    candidate_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    scraped_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Workflow state
    status             TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
    review_notes       TEXT        NOT NULL DEFAULT '',
    reviewed_at        TIMESTAMPTZ,
    reviewed_by        TEXT,

    -- Source provenance
    technology_id      TEXT        NOT NULL,
    source             TEXT        NOT NULL,  -- open_alex | semantic_scholar | nrel_atb | irena …

    -- Paper metadata
    paper_doi          TEXT,
    paper_title        TEXT,
    paper_year         INTEGER,
    paper_url          TEXT,
    paper_venue        TEXT,
    paper_authors      JSONB       NOT NULL DEFAULT '[]',

    -- Extracted parameters (confidence-scored key→value map)
    extracted_params   JSONB       NOT NULL DEFAULT '{}',

    -- The proposed catalogue instance (ready to merge into the JSON catalogue)
    proposed_instance  JSONB
);

CREATE INDEX IF NOT EXISTS idx_candidates_status
    ON scraper_candidates (status);

CREATE INDEX IF NOT EXISTS idx_candidates_technology_id
    ON scraper_candidates (technology_id);

CREATE INDEX IF NOT EXISTS idx_candidates_scraped_at
    ON scraper_candidates (scraped_at DESC);

-- Row-Level Security (service-role bypasses RLS automatically)
ALTER TABLE scraper_candidates ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- scraper_runs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scraper_runs (
    id                       BIGSERIAL   PRIMARY KEY,
    run_id                   UUID        UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    started_at               TIMESTAMPTZ,
    finished_at              TIMESTAMPTZ,
    technologies_processed   INTEGER     DEFAULT 0,
    papers_fetched           INTEGER     DEFAULT 0,
    candidates_created       INTEGER     DEFAULT 0,
    errors                   JSONB       NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_runs_started_at
    ON scraper_runs (started_at DESC);

ALTER TABLE scraper_runs ENABLE ROW LEVEL SECURITY;

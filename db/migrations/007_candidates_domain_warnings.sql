-- =============================================================================
-- Migration 007 – Add technology_domain + validation_warnings to scraper_candidates
-- =============================================================================
-- Adds two missing columns to scraper_candidates:
--   technology_domain    - the catalogue file bucket (generation | storage |
--                          transmission | conversion).  Used by approve_candidate()
--                          to route the merged instance to the correct JSON file.
--                          Without this column the domain falls back to _infer_domain()
--                          which can mis-classify conversion techs like power_to_liquid.
--   validation_warnings  - parameter validation warnings produced at scrape time.
-- =============================================================================

ALTER TABLE scraper_candidates
    ADD COLUMN IF NOT EXISTS technology_domain   TEXT,
    ADD COLUMN IF NOT EXISTS validation_warnings JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_candidates_domain
    ON scraper_candidates (technology_domain);

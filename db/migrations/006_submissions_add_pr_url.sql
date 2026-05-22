-- =============================================================================
-- Migration 006 – Add pr_url column to technology_submissions
-- =============================================================================
-- The initial CREATE TABLE in migration 005 was applied before the pr_url
-- column was added to the schema definition.  This migration adds it safely
-- with IF NOT EXISTS so it is idempotent.
-- =============================================================================

ALTER TABLE technology_submissions
    ADD COLUMN IF NOT EXISTS pr_url TEXT;

COMMENT ON COLUMN technology_submissions.pr_url IS
    'GitHub Pull Request URL opened when a submission is approved; NULL until then.';

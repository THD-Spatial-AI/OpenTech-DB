-- =============================================================================
-- Migration 005 – Technology submissions table
-- =============================================================================
-- Stores human-contributed Technology/Instance records awaiting admin review.
-- Lifecycle: pending_review → approved | rejected
-- Approval triggers a GitHub PR that merges the payload into the JSON catalogue.
--
-- Distinct from scraper_candidates (automated pipeline output, in migration 001).
-- Both share the same lifecycle but carry different provenance metadata.
--
-- RLS summary: only service_role has access. Browser/user identities are
-- validated by FastAPI through the Go/Keycloak session boundary.
-- =============================================================================

CREATE TABLE IF NOT EXISTS technology_submissions (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Workflow state
    status            TEXT        NOT NULL DEFAULT 'pending_review'
                          CHECK (status IN ('pending_review', 'approved', 'rejected')),
    reviewed_at       TIMESTAMPTZ,
    reviewed_by       TEXT,
    rejection_reason  TEXT,
    pr_url            TEXT,       -- set when a GitHub PR is opened for approval

    user_id           TEXT,       -- immutable Keycloak subject; no local user-table FK
    submitter_email   TEXT,

    -- Technology metadata (denormalized for quick admin-panel display)
    technology_name   TEXT        NOT NULL,
    domain            TEXT,
    carrier           TEXT,
    oeo_class         TEXT,
    description       TEXT,

    -- Full OEO-aligned submission payload
    payload           JSONB       NOT NULL DEFAULT '{}'
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_submissions_status
    ON technology_submissions (status);

CREATE INDEX IF NOT EXISTS idx_submissions_user_id
    ON technology_submissions (user_id);

CREATE INDEX IF NOT EXISTS idx_submissions_submitted_at
    ON technology_submissions (submitted_at DESC);

-- ---------------------------------------------------------------------------
-- Auto-update updated_at on every write
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_submissions_updated_at ON technology_submissions;
CREATE TRIGGER trg_submissions_updated_at
    BEFORE UPDATE ON technology_submissions
    FOR EACH ROW EXECUTE FUNCTION _set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
-- All reads and writes go through the FastAPI backend (service-role key),
-- never from the frontend directly. The service_role policy is sufficient;
-- user_id is compared with the Go-validated Keycloak subject in FastAPI.
ALTER TABLE technology_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access"
    ON technology_submissions FOR ALL
    TO service_role
    USING (true) WITH CHECK (true);

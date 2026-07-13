-- =============================================================================
-- Migration 010 – Timeseries profile tables
-- =============================================================================
-- Moves timeseries profile storage from the filesystem (data/timeseries/) to
-- Supabase so that large JSONB data files (8 760 hourly points per profile)
-- do not bloat the git repository.
--
-- Two tables mirror the pending→approved admin review lifecycle:
--
--   timeseries_submissions  – all submissions (pending / approved / rejected)
--                             including full data points as JSONB.
--   timeseries_profiles     – approved profiles; metadata + points JSONB
--                             served by the public catalogue API.
--
-- After running this migration, re-point SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
-- in the backend env. The api/timeseries.py and timeseries_scraper/writer.py
-- will automatically use Supabase when those vars are present, and fall back to
-- the local filesystem (data/timeseries/) for local dev without Supabase.
--
-- Existing local files can be bulk-imported via:
--   python scripts/import_timeseries_to_supabase.py  (TBD utility script)
--
-- RLS summary (same pattern as technology_submissions, migration 005):
--   service_role  – full access (backend uses service-role key)
--   authenticated – no direct access
--   anon          – no access
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Pending / review workflow table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS timeseries_submissions (
    submission_id    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    name             TEXT        NOT NULL,
    type             TEXT        NOT NULL,
    resolution       TEXT        NOT NULL,
    location         TEXT        NOT NULL,
    source           TEXT        NOT NULL DEFAULT '',
    source_name      TEXT,                    -- pipeline identifier, e.g. "pvgis"
    carrier          TEXT        NOT NULL DEFAULT '',
    year             INT         NOT NULL DEFAULT 0,
    unit             TEXT        NOT NULL DEFAULT 'p.u.',
    description      TEXT        NOT NULL DEFAULT '',
    n_timesteps      INT         NOT NULL DEFAULT 0,
    submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitter_email  TEXT,
    status           TEXT        NOT NULL DEFAULT 'pending_review'
                         CHECK (status IN ('pending_review', 'approved', 'rejected')),
    rejection_reason TEXT,
    reviewed_at      TIMESTAMPTZ,
    reviewed_by      TEXT,
    profile_id       TEXT,                    -- set after approval
    points           JSONB       NOT NULL DEFAULT '[]',
    stats            JSONB
);

CREATE INDEX IF NOT EXISTS idx_ts_sub_status       ON timeseries_submissions (status);
CREATE INDEX IF NOT EXISTS idx_ts_sub_submitted_at ON timeseries_submissions (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ts_sub_fingerprint
    ON timeseries_submissions (location, carrier, year, type, source_name);

ALTER TABLE timeseries_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ts_sub_service_role_full_access"
    ON timeseries_submissions FOR ALL
    TO service_role
    USING (true) WITH CHECK (true);


-- ---------------------------------------------------------------------------
-- 2. Approved profiles catalogue table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS timeseries_profiles (
    profile_id   TEXT        PRIMARY KEY,
    name         TEXT        NOT NULL,
    type         TEXT        NOT NULL,
    resolution   TEXT        NOT NULL,
    location     TEXT        NOT NULL,
    source       TEXT        NOT NULL DEFAULT '',
    source_name  TEXT,                    -- pipeline identifier for deduplication
    carrier      TEXT        NOT NULL DEFAULT '',
    year         INT         NOT NULL DEFAULT 0,
    n_timesteps  INT         NOT NULL DEFAULT 0,
    description  TEXT        NOT NULL DEFAULT '',
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unit         TEXT        NOT NULL DEFAULT 'p.u.',
    points       JSONB       NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_ts_prof_type     ON timeseries_profiles (type);
CREATE INDEX IF NOT EXISTS idx_ts_prof_location ON timeseries_profiles (location);
CREATE INDEX IF NOT EXISTS idx_ts_prof_carrier  ON timeseries_profiles (carrier);
CREATE INDEX IF NOT EXISTS idx_ts_prof_fingerprint
    ON timeseries_profiles (location, carrier, year, type, source_name);

ALTER TABLE timeseries_profiles ENABLE ROW LEVEL SECURITY;

-- Catalogue metadata is public; data points require the service role.
CREATE POLICY "ts_prof_public_read_meta"
    ON timeseries_profiles FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "ts_prof_service_role_write"
    ON timeseries_profiles FOR ALL
    TO service_role
    USING (true) WITH CHECK (true);

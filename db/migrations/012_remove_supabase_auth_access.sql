-- =============================================================================
-- Migration 012 – Remove Supabase Auth/browser-role access
-- =============================================================================
-- Supabase remains a backend-only data service. Authentication and application
-- roles are owned exclusively by Keycloak. The built-in anon/authenticated
-- database roles may exist as PostgREST infrastructure, but receive no schema,
-- table, sequence, or function privileges.
-- =============================================================================

REVOKE ALL PRIVILEGES ON SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON FUNCTIONS FROM anon, authenticated;

-- Remove the only historical browser-readable policy. All public catalogue
-- access is now provided by FastAPI, not PostgREST.
DROP POLICY IF EXISTS "ts_prof_public_read_meta" ON timeseries_profiles;

-- Existing installations predate Keycloak attribution on time-series
-- submissions. This is an identity reference only; it deliberately has no
-- foreign key to an application-user table.
ALTER TABLE timeseries_submissions
    ADD COLUMN IF NOT EXISTS user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_ts_sub_user_id
    ON timeseries_submissions (user_id);

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO service_role;

COMMENT ON COLUMN technology_submissions.user_id IS
    'Immutable Keycloak subject. No local or Supabase Auth user record exists.';
COMMENT ON COLUMN timeseries_submissions.user_id IS
    'Immutable Keycloak subject. No local or Supabase Auth user record exists.';

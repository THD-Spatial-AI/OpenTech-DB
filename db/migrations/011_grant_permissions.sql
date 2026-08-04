-- =============================================================================
-- Migration 011 – Backend-only grants for local self-hosted Supabase
-- =============================================================================
-- Supabase is a server-side data service only. The service_role used by
-- FastAPI receives DML access; browser roles receive nothing.
--
-- Uses a PL/pgSQL loop so it reliably covers every table in the schema,
-- and sets ALTER DEFAULT PRIVILEGES so future tables inherit the same grants.
-- =============================================================================

-- ── Existing tables ───────────────────────────────────────────────────────────

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.'
                || quote_ident(r.tablename)
                || ' TO service_role';
    END LOOP;
END $$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ── Future tables ─────────────────────────────────────────────────────────────

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO service_role;

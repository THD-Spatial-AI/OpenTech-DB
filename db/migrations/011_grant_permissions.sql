-- =============================================================================
-- Migration 011 – Explicit role grants for local self-hosted Supabase
-- =============================================================================
-- Supabase cloud automatically grants DML to service_role / authenticated /
-- anon when a project is created.  Self-hosted local instances do NOT apply
-- these grants for tables created by custom migrations.
--
-- This migration replicates the Supabase cloud defaults:
--   service_role  – full DML on all tables (bypasses RLS; used by FastAPI backend)
--   authenticated – full DML on all tables (subject to RLS policies)
--   anon          – SELECT only (subject to RLS policies)
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
                || ' TO service_role, authenticated';

        EXECUTE 'GRANT SELECT ON public.'
                || quote_ident(r.tablename)
                || ' TO anon';
    END LOOP;
END $$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role, authenticated;

-- ── Future tables ─────────────────────────────────────────────────────────────

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO service_role, authenticated;

-- =============================================================================
-- Migration 013 – Personal API tokens linked to Keycloak subjects
-- =============================================================================
-- Keycloak remains the only user store. This table contains no password,
-- Keycloak token, or local user account; user_id is immutable realm attribution.
-- Only a SHA-256 digest of each 256-bit personal token is persisted.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.api_tokens (
    id            BIGSERIAL PRIMARY KEY,
    user_id       VARCHAR(255) NOT NULL,
    username      VARCHAR(255) NOT NULL,
    user_email    VARCHAR(320) NOT NULL,
    realm         VARCHAR(64)  NOT NULL DEFAULT 'opentechdb',
    name          VARCHAR(255) NOT NULL,
    token_hash    CHAR(64)     NOT NULL UNIQUE,
    token_prefix  VARCHAR(16)  NOT NULL,
    scope         VARCHAR(16)  NOT NULL DEFAULT 'read',
    roles         TEXT[]       NOT NULL DEFAULT '{}',
    created_by    VARCHAR(255) NOT NULL,
    expires_at    TIMESTAMPTZ,
    last_used_at  TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT api_tokens_realm_check
        CHECK (realm = 'opentechdb'),
    CONSTRAINT api_tokens_scope_check
        CHECK (scope IN ('read', 'full')),
    CONSTRAINT api_tokens_roles_check
        CHECK (roles <@ ARRAY['contributor']::TEXT[]),
    CONSTRAINT api_tokens_hash_format_check
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT api_tokens_prefix_format_check
        CHECK (token_prefix ~ '^otdb_[A-Za-z0-9_-]{8}$'),
    CONSTRAINT api_tokens_expiry_check
        CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user_created
    ON public.api_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_tokens_active_user
    ON public.api_tokens (user_id)
    WHERE revoked_at IS NULL;

-- Serialize token creation per Keycloak subject and enforce the same active
-- limit shown by the API. The advisory lock prevents two concurrent requests
-- from both observing nine tokens and creating an eleventh.
CREATE OR REPLACE FUNCTION public.enforce_api_token_active_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id, 0));
    IF (
        SELECT count(*)
        FROM public.api_tokens
        WHERE user_id = NEW.user_id
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
    ) >= 10 THEN
        RAISE EXCEPTION 'maximum active personal API tokens reached'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_api_token_active_limit()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_api_token_active_limit()
    TO service_role;

DROP TRIGGER IF EXISTS api_tokens_active_limit ON public.api_tokens;
CREATE TRIGGER api_tokens_active_limit
    BEFORE INSERT ON public.api_tokens
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_api_token_active_limit();

-- Defense in depth: browser-facing PostgREST roles have no table access and
-- row-level security has no browser policies. service_role bypasses RLS and is
-- held only by FastAPI.
ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_tokens_service_role_all
    ON public.api_tokens
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
REVOKE ALL PRIVILEGES ON public.api_tokens FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.api_tokens_id_seq FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_tokens TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.api_tokens_id_seq TO service_role;

COMMENT ON TABLE public.api_tokens IS
    'Hashed personal API tokens. Identity references Keycloak; no application user row exists.';
COMMENT ON COLUMN public.api_tokens.token_hash IS
    'SHA-256 digest of a 256-bit opaque token; plaintext is returned once and never stored.';
COMMENT ON COLUMN public.api_tokens.roles IS
    'Keycloak role snapshot constrained to contributor only; personal tokens can never be admin.';

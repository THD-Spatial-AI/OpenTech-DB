-- =============================================================================
-- Migration 014 – "simulate" scope for personal API tokens
-- =============================================================================
-- A simulate token can read (GET/HEAD) and submit Process simulations
-- (POST /api/v1/processes/simulate), nothing else. Simulations require an
-- authenticated user: a browser session or one of these tokens.
-- =============================================================================

ALTER TABLE public.api_tokens DROP CONSTRAINT IF EXISTS api_tokens_scope_check;
ALTER TABLE public.api_tokens
    ADD CONSTRAINT api_tokens_scope_check
        CHECK (scope IN ('read', 'simulate', 'full'));

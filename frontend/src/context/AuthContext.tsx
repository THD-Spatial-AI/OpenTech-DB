/**
 * context/AuthContext.tsx
 * ───────────────────────
 * Application-wide authentication state.
 *
 * Three login paths, one unified context
 * ───────────────────────────────────────
 * 1. Email / Password  — Supabase Auth (signInWithPassword / signUp)
 * 2. GitHub OAuth      — Supabase Auth (signInWithOAuth provider:"github")
 *    Both are tracked via supabase.auth.onAuthStateChange → no signIn() call
 *    needed from the UI; the context updates automatically.
 *
 * 3. ORCID OAuth       — FastAPI backend completes the OAuth dance and
 *    redirects to /?token=<jwt>.  <OAuthCallback> calls signIn(token) which
 *    stores the JWT in sessionStorage and fetches the user profile from
 *    GET /auth/me.  The ORCID token is kept separate from the Supabase
 *    session so the two flows don't interfere.
 *
 * Token used for FastAPI calls
 * ────────────────────────────
 * • Supabase session  → session.access_token (Supabase-signed JWT)
 * • ORCID             → custom JWT stored in sessionStorage
 * The context always exposes whichever token is active as `token`.
 *
 * React 19 patterns
 * ─────────────────
 * • Context rendered directly (no .Provider wrapper) — React 19 feature.
 * • Async hydration does NOT use useTransition here because Supabase's
 *   onAuthStateChange handles the timing; isLoading is derived from a plain
 *   boolean flag to avoid the React 19 transition warning on async effects.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import type { AuthUser } from "../types/api";
import { supabase } from "../lib/supabase";
import { fetchCurrentUser } from "../services/api";

// ── Constants ─────────────────────────────────────────────────────────────────

/** sessionStorage key for custom backend JWTs (ORCID, admin) */
const ORCID_TOKEN_KEY = "opentech_orcid_token";

// ── Supabase user mapper ───────────────────────────────────────────────────────

function mapSupabaseUser(sbUser: SupabaseUser): AuthUser {
  const meta = sbUser.user_metadata as Record<string, unknown>;
  const appMeta = sbUser.app_metadata as Record<string, unknown>;
  return {
    id: sbUser.id,
    username:
      (meta.user_name as string) ??
      (meta.name as string) ??
      sbUser.email?.split("@")[0] ??
      sbUser.id,
    email: sbUser.email ?? "",
    avatar_url: (meta.avatar_url as string) ?? null,
    // Supabase provider is "github", "email", etc.
    auth_provider: (appMeta.provider as string) ?? "email",
    // Stored in user_metadata by backend triggers; defaults false
    is_contributor: (meta.is_contributor as boolean) ?? false,
    // Set via Supabase dashboard → Authentication → Users → App Metadata
    // e.g.  { "is_admin": true }
    // OR via SQL: UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"is_admin":true}' WHERE email = '...'
    is_admin: (appMeta.is_admin as boolean) ?? false,
  };
}

// ── Context shape ─────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: AuthUser | null;
  /** Access token for Authorization: Bearer <token> headers to FastAPI */
  token: string | null;
  isLoading: boolean;
  /** True when the authenticated user has admin privileges */
  isAdmin: boolean;
  /**
   * Custom backend JWT path (ORCID, admin): store the JWT and fetch the user
   * profile. Supabase paths (email/password, GitHub) update the context
   * automatically via onAuthStateChange — no manual signIn() call needed.
   */
  signIn: (token: string) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  isLoading: true,
  isAdmin: false,
  signIn: () => {},
  signOut: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // ── 1. Bootstrap: check Supabase session first, then ORCID fallback ────────
    // We call refreshSession() instead of getSession() so that any changes to
    // app_metadata (e.g. granting is_admin via Supabase SQL/dashboard) are
    // reflected immediately on the next page load without requiring a sign-out.
    supabase.auth.refreshSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(mapSupabaseUser(session.user));
        setToken(session.access_token);
        setIsLoading(false);
      } else {
        // No Supabase session — check for a stored ORCID token
        const orcidToken = sessionStorage.getItem(ORCID_TOKEN_KEY);
        if (orcidToken) {
          fetchCurrentUser(orcidToken)
            .then((profile) => {
              setUser(profile);
              setToken(orcidToken);
            })
            .catch(() => {
              // Stale ORCID token — discard silently
              sessionStorage.removeItem(ORCID_TOKEN_KEY);
            })
            .finally(() => setIsLoading(false));
        } else {
          setIsLoading(false);
        }
      }
    });

    // ── 2. Live subscription: keep context in sync with Supabase state ─────────
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(mapSupabaseUser(session.user));
        setToken(session.access_token);
        // A Supabase session is authoritative — clear any ORCID token
        sessionStorage.removeItem(ORCID_TOKEN_KEY);
      } else if (!sessionStorage.getItem(ORCID_TOKEN_KEY)) {
        // No Supabase session AND no ORCID token → signed out
        setUser(null);
        setToken(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── signIn — ORCID custom JWT path only ────────────────────────────────────
  const signIn = useCallback((newToken: string) => {
    sessionStorage.setItem(ORCID_TOKEN_KEY, newToken);
    setToken(newToken);
    fetchCurrentUser(newToken)
      .then((profile) => setUser(profile))
      .catch(() => {
        sessionStorage.removeItem(ORCID_TOKEN_KEY);
        setToken(null);
        setUser(null);
      });
  }, []);

  // ── signOut — clears both Supabase session and ORCID token ─────────────────
  const signOut = useCallback(() => {
    sessionStorage.removeItem(ORCID_TOKEN_KEY);
    setUser(null);
    setToken(null);
    // Fire-and-forget — the onAuthStateChange listener will also run
    void supabase.auth.signOut();
  }, []);

  // React 19: render context directly without .Provider
  return (
    <AuthContext value={{ user, token, isLoading, isAdmin: user?.is_admin ?? false, signIn, signOut }}>
      {children}
    </AuthContext>
  );
}

// ── Consumer hook ─────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

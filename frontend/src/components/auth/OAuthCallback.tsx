/**
 * components/auth/OAuthCallback.tsx
 * ──────────────────────────────────
 * Handles the ORCID OAuth redirect callback.
 *
 * After the FastAPI backend completes the ORCID OAuth dance it redirects the
 * browser to /?token=<jwt>.  This component reads that param on mount, stores
 * the token via AuthContext.signIn(), then strips the query param so the JWT
 * is never visible in the browser history.
 *
 * GitHub OAuth is now handled entirely by Supabase; its client automatically
 * detects the OAuth code in the URL (detectSessionInUrl: true in supabase.ts)
 * and fires onAuthStateChange — no manual handling needed here.
 *
 * Rendered unconditionally inside App — it is a no-op when ?token is absent.
 *
 * React 19: useEffect is intentionally used here because this is a genuinely
 * side-effectful operation (URL mutation + storage write) that must only fire
 * once on mount.
 */

import { useEffect } from "react";
import { useAuth } from "../../context/AuthContext";

// Maps backend ?auth_error= codes to human-readable messages shown in AuthPage
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  orcid_not_configured: "ORCID login is not yet configured on this server. Please use email or GitHub.",
  orcid_denied:         "ORCID login was cancelled. Please try again.",
  orcid_token_exchange: "Could not complete ORCID login. Please try again later.",
};

export default function OAuthCallback({ onAuthError }: { onAuthError?: (msg: string) => void }) {
  const { signIn } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // ── ORCID custom JWT ───────────────────────────────────────────────────
    const token = params.get("token");
    if (token) {
      signIn(token);
      params.delete("token");
    }

    // ── ORCID / backend auth errors ────────────────────────────────────────
    const authError = params.get("auth_error");
    if (authError) {
      const msg = AUTH_ERROR_MESSAGES[authError] ?? "Authentication failed. Please try again.";
      onAuthError?.(msg);
      params.delete("auth_error");
    }

    // Strip handled params from the URL without adding a history entry
    if (token || authError) {
      const clean =
        window.location.pathname +
        (params.toString() ? `?${params.toString()}` : "");
      window.history.replaceState(null, "", clean);
    }
  }, [signIn, onAuthError]);

  return null;
}

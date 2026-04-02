/**
 * lib/supabase.ts
 * ───────────────
 * Singleton Supabase client shared across the entire app.
 *
 * Configuration
 * ─────────────
 * Set these in frontend/.env.local (never commit to source control):
 *   VITE_SUPABASE_URL      — https://<project-ref>.supabase.co
 *   VITE_SUPABASE_ANON_KEY — eyJ…  (public anon key from your project settings)
 *
 * Session persistence
 * ───────────────────
 * We use sessionStorage (instead of localStorage) so sessions end when the
 * browser tab closes — appropriate for a research tool used on shared machines.
 * Supabase will still auto-refresh the token while the tab is open.
 *
 * Providers configured
 * ─────────────────────
 * • Email / Password — handled by Supabase Auth natively
 * • GitHub           — handled by Supabase OAuth (configure in Supabase dashboard)
 * • ORCID            — handled by the FastAPI backend (custom OAuth dance),
 *                      returns a signed JWT via ?token= query param on redirect
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey = import.meta.env
  .VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY as string | undefined;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "[opentech-db] Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY. " +
      "Create frontend/.env.local and set both variables."
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    // Mirror JWT refresh lifecycle to sessionStorage so sessions clear on tab close
    storage: sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    // Supabase detects the OAuth code/token in the URL on page load automatically
    detectSessionInUrl: true,
  },
});

/**
 * services/api.ts
 * ───────────────
 * Thin API client for the opentech-db FastAPI backend.
 *
 * The backend can be served locally (Docker on :8000) or via a tunnel.
 * Set VITE_API_BASE_URL in frontend/.env.local to override the default.
 *
 * React 19 strategy
 * -----------------
 * We expose plain async functions that return Promises.  Components pass
 * those Promises to the React 19 `use()` hook inside a <Suspense> boundary —
 * the idiomatic pattern for async data fetching without useEffect/useState.
 *
 * Crucial for ngrok tunnels: include the `ngrok-skip-browser-warning`
 * header so ngrok doesn't serve its HTML interstitial page.  When talking
 * to localhost it is simply ignored.
 */

import type {
  Technology,
  TechnologyCategory,
  TechnologyCatalogueResponse,
  OntologySchema,
  CreateTechnologyPayload,
  AuthUser,
  SubmissionRecord,
  AdminLoginResponse,
} from "../types/api";

// ── Base URL ──────────────────────────────────────────────────────────────────
const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:8000/api/v1";

// ── Shared fetch wrapper ──────────────────────────────────────────────────────

const HEADERS: HeadersInit = {
  // Required to bypass the ngrok browser-warning interstitial when using a
  // tunnel URL; harmless for direct localhost requests.
  "ngrok-skip-browser-warning": "true",
  Accept: "application/json",
};

async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, { headers: HEADERS });

  if (!response.ok) {
    throw new Error(
      `API error ${response.status}: ${response.statusText} — ${BASE_URL}${path}`
    );
  }

  return response.json() as Promise<T>;
}

// ── Promise cache ─────────────────────────────────────────────────────────────
// Memoise in-flight / resolved Promises so React 19's `use()` reads the same
// Promise reference on re-renders, avoiding infinite suspension loops.

const promiseCache = new Map<string, Promise<unknown>>();

function cached<T>(key: string, factory: () => Promise<T>): Promise<T> {
  if (!promiseCache.has(key)) {
    promiseCache.set(key, factory());
  }
  return promiseCache.get(key) as Promise<T>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a stable Promise for the technology summaries of a given category.
 * The category endpoint returns { total, technologies: TechnologySummary[] }.
 * Safe to pass directly to the React 19 `use()` hook inside <Suspense>.
 */
export function fetchCategoryTechnologies(
  category: TechnologyCategory
): Promise<TechnologyCatalogueResponse> {
  return cached(`category:${category}`, () =>
    apiFetch<TechnologyCatalogueResponse>(
      `/technologies/category/${category}?limit=200`
    )
  );
}

/**
 * Returns a stable Promise for a single technology by ID (full detail with instances).
 * Safe to pass directly to the React 19 `use()` hook inside <Suspense>.
 */
export function fetchTechnology(id: string): Promise<Technology> {
  return cached(`tech:${id}`, () =>
    apiFetch<Technology>(`/technologies/${id}`)
  );
}

/**
 * Invalidates the promise cache for a category so the next call
 * triggers a fresh network request.
 */
export function invalidateCategory(category: TechnologyCategory): void {
  promiseCache.delete(`category:${category}`);
}

/** Invalidates the entire promise cache (e.g. on a global refresh). */
export function invalidateAll(): void {
  promiseCache.clear();
}

// ── Ontology schema ───────────────────────────────────────────────────────────

/**
 * Fetches the controlled-vocabulary lists that contributors must use.
 * Cached once per session — the values are stable between deploys.
 * Safe to pass to React 19 `use()` inside a <Suspense> boundary.
 */
export function fetchOntologySchema(): Promise<OntologySchema> {
  return cached("ontology:schema", () =>
    apiFetch<OntologySchema>("/ontology/schema")
  );
}

// ── Contributor endpoint ──────────────────────────────────────────────────────

/**
 * Posts a new technology to the database.
 * Returns the created technology's ID on success.
 * Throws an Error with a descriptive message on API failure.
 */
export async function submitTechnology(
  payload: CreateTechnologyPayload
): Promise<{ id: string; technology_name: string }> {
  const response = await fetch(`${BASE_URL}/technologies`, {
    method: "POST",
    headers: {
      ...HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    // Surface the backend's error detail when available
    let detail = `API error ${response.status}: ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(detail);
  }

  return response.json() as Promise<{ id: string; technology_name: string }>;
}

// ── Auth endpoints ────────────────────────────────────────────────────────────

/**
 * GET /auth/me
 * Validates and returns the current user for a custom JWT.
 * Called only for the ORCID path; Supabase sessions are managed by the
 * Supabase client directly and do not require this endpoint.
 */
export async function fetchCurrentUser(token: string): Promise<AuthUser> {
  const response = await fetch(`${BASE_URL}/auth/me`, {
    headers: {
      ...HEADERS,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) throw new Error("Session expired — please sign in again.");
  return response.json() as Promise<AuthUser>;
}

/**
 * Returns the backend URL that initiates the ORCID OAuth flow.
 * The FastAPI backend handles the full OAuth dance with ORCID's servers
 * and redirects back to the SPA with ?token=<jwt> on success.
 *
 * GitHub OAuth is now handled entirely by Supabase
 * (supabase.auth.signInWithOAuth({ provider: 'github' })).
 */
export function getOrcidOAuthUrl(): string {
  return `${BASE_URL}/auth/orcid`;
}

// ── Admin endpoints ────────────────────────────────────────────────────────────────

export async function adminLogin(
  email: string,
  password: string
): Promise<AdminLoginResponse> {
  const response = await fetch(`${BASE_URL}/auth/admin/login`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error("Invalid admin credentials.");
  }
  return response.json() as Promise<AdminLoginResponse>;
}

export async function fetchAdminSubmissions(
  token: string,
  statusFilter?: string
): Promise<SubmissionRecord[]> {
  const url = statusFilter
    ? `${BASE_URL}/admin/submissions?status=${encodeURIComponent(statusFilter)}`
    : `${BASE_URL}/admin/submissions`;
  const response = await fetch(url, {
    headers: { ...HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Failed to fetch submissions.");
  return response.json() as Promise<SubmissionRecord[]>;
}

export async function actOnSubmission(
  token: string,
  submissionId: string,
  action: "approve" | "reject",
  reason?: string
): Promise<{ status: string; submission_id: string }> {
  const response = await fetch(
    `${BASE_URL}/admin/submissions/${encodeURIComponent(submissionId)}`,
    {
      method: "POST",
      headers: { ...HEADERS, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    }
  );
  if (!response.ok) {
    let detail = `API error ${response.status}`;
    try { const b = (await response.json()) as { detail?: string }; if (b.detail) detail = b.detail; } catch { /**/ }
    throw new Error(detail);
  }
  return response.json() as Promise<{ status: string; submission_id: string }>;
}

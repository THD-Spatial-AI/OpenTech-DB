/**
 * services/api.ts
 * ───────────────
 * Thin API client for the opentech-db FastAPI backend.
 *
 * The backend can be served locally (Docker on :8000) or via a reverse proxy.
 * Set VITE_API_BASE_URL in frontend/.env.local to override the default.
 *
 * React 19 strategy
 * -----------------
 * We expose plain async functions that return Promises.  Components pass
 * those Promises to the React 19 `use()` hook inside a <Suspense> boundary —
 * the idiomatic pattern for async data fetching without useEffect/useState.
 */

import type {
  Technology,
  TechnologyCategory,
  TechnologyCatalogueResponse,
  OntologySchema,
  CreateTechnologyPayload,
  AuthUser,
  SubmissionRecord,
} from "../types/api";

// ── Base URL ──────────────────────────────────────────────────────────────────
const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:8000/api/v1";

const AUTH_BASE_URL =
  (import.meta.env.VITE_AUTH_API_BASE_URL as string | undefined) ??
  "/auth-api";

// Every browser request carries the encrypted HttpOnly Keycloak session
// cookies. Tokens are intentionally unavailable to JavaScript.
const fetch: typeof window.fetch = (input, init) =>
  window.fetch(input, { ...init, credentials: "include" });

// ── Shared fetch wrapper ──────────────────────────────────────────────────────

const HEADERS: HeadersInit = {
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
      `/technologies/category/${category}?limit=100`
    )
  );
}

/**
 * Fetches all technology summaries across all categories (up to 200).
 * Used by the Equipment Palette to show real catalogue entries alongside OEO classes.
 * Cached once per session. Safe to pass to React 19 `use()` inside <Suspense>.
 */
export function fetchAllCatalogueTechnologies(): Promise<TechnologyCatalogueResponse> {
  return cached("catalogue:all", () =>
    apiFetch<TechnologyCatalogueResponse>("/technologies?limit=100")
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
 * Fetch a single technology translated to a modeling-framework format.
 * NOT cached — every call hits the API fresh so instance_index changes are honoured.
 */
export type ModelFormat = "calliope" | "pypsa" | "osemosys" | "adoptnet0";
/** Calliope model-definition version ("0.6" nested / "0.7" flat). */
export type CalliopeVersion = "0.6" | "0.7";

export async function fetchTechModelExport(
  techId: string,
  format: ModelFormat,
  instanceIndex = 0,
  calliopeVersion?: CalliopeVersion,
): Promise<Record<string, unknown>> {
  const version =
    format === "calliope" && calliopeVersion ? `&version=${calliopeVersion}` : "";
  return apiFetch<Record<string, unknown>>(
    `/technologies/${techId}/${format}?instance_index=${instanceIndex}${version}`
  );
}

/**
 * Fetch ALL technologies translated to a modeling-framework format (full catalog export).
 * For Calliope the response shape is `{ techs: {...}, meta: {...} }`.
 * For PyPSA / OSeMOSYS / AdOpT-NET0 the shape is `{ technologies: {...}, meta: {...} }`.
 */
export async function fetchAllTechsModelExport(
  format: ModelFormat,
  calliopeVersion?: CalliopeVersion,
): Promise<Record<string, unknown>> {
  const version =
    format === "calliope" && calliopeVersion ? `?version=${calliopeVersion}` : "";
  return apiFetch<Record<string, unknown>>(`/technologies/${format}${version}`);
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
  payload: CreateTechnologyPayload,
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

export interface AuthSessionResponse {
  user: AuthUser;
  session?: { authenticated?: boolean; timeout_minutes?: number };
}

type AuthErrorBody = {
  detail?: string;
  error?: string;
  message?: string;
  errors?: Record<string, string>;
};

async function authError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as AuthErrorBody;
    const fieldError = body.errors && Object.values(body.errors)[0];
    return new Error(fieldError || body.detail || body.message || body.error || `Authentication error ${response.status}`);
  } catch {
    return new Error(`Authentication error ${response.status}`);
  }
}

async function csrfToken(): Promise<string> {
  const response = await fetch(`${AUTH_BASE_URL}/csrf-token`, { headers: HEADERS });
  if (!response.ok) throw await authError(response);
  const body = (await response.json()) as { csrf_token?: string };
  if (!body.csrf_token) throw new Error("Authentication service did not return a CSRF token.");
  return body.csrf_token;
}

async function authPost<T>(path: string, body?: unknown): Promise<T> {
  const csrf = await csrfToken();
  const response = await fetch(`${AUTH_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      ...HEADERS,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await authError(response);
  return response.json() as Promise<T>;
}

/** Return the public identity attached to the opaque Go-managed session. */
export async function refreshAuthSession(): Promise<AuthSessionResponse> {
  const response = await fetch(`${AUTH_BASE_URL}/auth/me`, { headers: HEADERS });
  if (!response.ok) throw new Error("No active Keycloak session.");
  return response.json() as Promise<AuthSessionResponse>;
}

export async function loginWithKeycloak(emailOrUsername: string, password: string): Promise<AuthSessionResponse> {
  return authPost<AuthSessionResponse>("/login", { username: emailOrUsername, password });
}

export async function registerWithKeycloak(
  username: string,
  email: string,
  password: string,
  passwordConfirmation: string,
): Promise<{ message: string; user: { username: string } }> {
  return authPost("/register", {
    username,
    email,
    password,
    password_confirmation: passwordConfirmation,
  });
}

export function getKeycloakProviderLoginUrl(
  provider: "github" | "orcid",
  returnTo = "/",
): string {
  const query = new URLSearchParams({ return_to: returnTo });
  return `${AUTH_BASE_URL}/auth/provider/${provider}?${query.toString()}`;
}

export async function logoutFromKeycloak(): Promise<void> {
  await authPost<{ success?: boolean }>("/logout");
}

export function getKeycloakAccountUrl(): string {
  return `${AUTH_BASE_URL}/auth/account`;
}

export async function keepKeycloakSessionAlive(): Promise<void> {
  const response = await fetch(`${AUTH_BASE_URL}/auth/keep-alive`, { headers: HEADERS });
  if (!response.ok) throw new Error("Keycloak session expired.");
}

// ── Personal API tokens ─────────────────────────────────────────────────────

export interface PersonalApiToken {
  id: number;
  name: string;
  token_prefix: string;
  scope: "read" | "full";
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface CreatedPersonalApiToken {
  id: number;
  name: string;
  /** Full plaintext secret. It is returned by the server only once. */
  token: string;
  token_prefix: string;
  scope: "read" | "full";
  expires_at: string | null;
  created_at: string;
}

export interface CreatePersonalApiTokenPayload {
  name: string;
  scope: "read" | "full";
  /** 0 means no automatic expiry; otherwise the backend caps this at 365. */
  expires_in_days: number;
}

async function personalTokenError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as { detail?: string };
    return new Error(body.detail || `API token error ${response.status}`);
  } catch {
    return new Error(`API token error ${response.status}`);
  }
}

/** List token metadata. The server never returns previously issued secrets. */
export async function fetchPersonalApiTokens(): Promise<PersonalApiToken[]> {
  const response = await fetch(`${BASE_URL}/profile/api-tokens`, { headers: HEADERS });
  if (!response.ok) throw await personalTokenError(response);
  return response.json() as Promise<PersonalApiToken[]>;
}

/** Generate a token. The plaintext in this response cannot be retrieved again. */
export async function createPersonalApiToken(
  payload: CreatePersonalApiTokenPayload,
): Promise<CreatedPersonalApiToken> {
  const response = await fetch(`${BASE_URL}/profile/api-tokens`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw await personalTokenError(response);
  return response.json() as Promise<CreatedPersonalApiToken>;
}

export async function revokePersonalApiToken(tokenId: number): Promise<void> {
  const response = await fetch(
    `${BASE_URL}/profile/api-tokens/${encodeURIComponent(String(tokenId))}`,
    { method: "DELETE", headers: HEADERS },
  );
  if (!response.ok) throw await personalTokenError(response);
}

// ── Admin endpoints ──────────────────────────────────────────────────────────

export async function fetchMySubmissions(): Promise<SubmissionRecord[]> {
  const response = await fetch(`${BASE_URL}/submissions/mine`, {
    headers: HEADERS,
  });
  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return response.json() as Promise<SubmissionRecord[]>;
}

export async function fetchAdminSubmissions(
  statusFilter?: string
): Promise<SubmissionRecord[]> {
  const url = statusFilter
    ? `${BASE_URL}/admin/submissions?status=${encodeURIComponent(statusFilter)}`
    : `${BASE_URL}/admin/submissions`;
  const response = await fetch(url, {
    headers: HEADERS,
  });
  if (!response.ok) {
    let detail = `Server error ${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return response.json() as Promise<SubmissionRecord[]>;
}

export async function actOnSubmission(
  submissionId: string,
  action: "approve" | "reject",
  reason?: string,
  editedPayload?: Record<string, unknown> | null,
  adminNotes?: string,
): Promise<{ status: string; submission_id: string; pr_url?: string }> {
  const response = await fetch(
    `${BASE_URL}/admin/submissions/${encodeURIComponent(submissionId)}`,
    {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        reason: reason || undefined,
        admin_notes: adminNotes || undefined,
        edited_payload: editedPayload || undefined,
      }),
    }
  );
  if (!response.ok) {
    let detail = `API error ${response.status}`;
    try { const b = (await response.json()) as { detail?: string }; if (b.detail) detail = b.detail; } catch { /**/ }
    throw new Error(detail);
  }
  return response.json() as Promise<{ status: string; submission_id: string }>;
}

// ── Admin catalogue management ────────────────────────────────────────────────

export interface CatalogueTechEntry {
  technology_id: string;
  technology_name: string;
  domain: string;
  carrier: string;
  oeo_class: string;
  description: string;
  instances: Record<string, unknown>[];
  source: string;
}

export async function fetchAdminCatalogueTechnologies(): Promise<CatalogueTechEntry[]> {
  const response = await fetch(`${BASE_URL}/admin/technologies`, {
    headers: HEADERS,
  });
  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return response.json() as Promise<CatalogueTechEntry[]>;
}

export async function adminEditTechnology(
  technologyId: string,
  patch: Partial<Omit<CatalogueTechEntry, "technology_id" | "source">>
): Promise<{ status: string; technology_id: string }> {
  const response = await fetch(
    `${BASE_URL}/admin/technologies/${encodeURIComponent(technologyId)}`,
    {
      method: "PATCH",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }
  );
  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return response.json() as Promise<{ status: string; technology_id: string }>;
}

export async function adminDeleteTechnology(
  technologyId: string
): Promise<{ status: string; technology_id: string; technology_name: string }> {
  const response = await fetch(
    `${BASE_URL}/admin/technologies/${encodeURIComponent(technologyId)}`,
    {
      method: "DELETE",
      headers: HEADERS,
    }
  );
  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return response.json() as Promise<{ status: string; technology_id: string; technology_name: string }>;
}

// ── Admin time-series profile submissions ─────────────────────────────────────

export interface ProfileStats {
  v_min:    number;
  v_max:    number;
  v_mean:   number;
  v_std:    number;
  v_p10:    number;
  v_p90:    number;
  first_ts: string;
  last_ts:  string;
}

export interface ProfileSubmissionRecord {
  submission_id:    string;
  name:             string;
  type:             string;
  resolution:       string;
  location:         string;
  source:           string;
  carrier:          string;
  year:             number;
  unit:             string;
  description:      string;
  n_timesteps:      number;
  submitted_at:     string;
  submitter_email?: string | null;
  status:           string;
  rejection_reason?: string | null;
  stats?:           ProfileStats | null;
}

export interface ProfileSubmissionData {
  submission_id: string;
  name:          string;
  unit:          string;
  points:        { timestamp: string; value: number }[];
}

export async function fetchAdminProfileSubmissions(
  statusFilter?: string
): Promise<ProfileSubmissionRecord[]> {
  const url = statusFilter
    ? `${BASE_URL}/admin/timeseries/submissions?status=${encodeURIComponent(statusFilter)}`
    : `${BASE_URL}/admin/timeseries/submissions`;
  const response = await fetch(url, {
    headers: HEADERS,
  });
  if (!response.ok) {
    let detail = `Server error ${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return response.json() as Promise<ProfileSubmissionRecord[]>;
}

export async function fetchAdminProfileSubmissionData(
  submissionId: string,
): Promise<ProfileSubmissionData> {
  const response = await fetch(
    `${BASE_URL}/admin/timeseries/submissions/${encodeURIComponent(submissionId)}/data`,
    { headers: HEADERS },
  );
  if (!response.ok) {
    let detail = `Server error ${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return response.json() as Promise<ProfileSubmissionData>;
}

export async function actOnProfileSubmission(
  submissionId: string,
  action: "approve" | "reject",
  reason?: string,
): Promise<{ status: string; submission_id: string }> {
  const response = await fetch(
    `${BASE_URL}/admin/timeseries/submissions/${encodeURIComponent(submissionId)}`,
    {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason: reason || undefined }),
    }
  );
  if (!response.ok) {
    let detail = `API error ${response.status}`;
    try { const b = (await response.json()) as { detail?: string }; if (b.detail) detail = b.detail; } catch { /**/ }
    throw new Error(detail);
  }
  return response.json() as Promise<{ status: string; submission_id: string }>;
}

// ── Scraper pipeline endpoints ────────────────────────────────────────────────

import type { ScraperStatus, ScraperCandidate, ScraperRun } from "../types/api";

/** The backend stores paper fields flat (paper_title, paper_year, …).
 *  This normalizes a raw row into the nested ScraperCandidate shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeCandidate(raw: any): ScraperCandidate {
  return {
    candidate_id:     raw.candidate_id,
    technology_id:    raw.technology_id ?? "",
    technology_name:  raw.technology_name ?? raw.technology_id ?? "",
    status:           raw.status ?? "pending",
    created_at:       raw.scraped_at ?? raw.created_at ?? "",
    reviewed_at:      raw.reviewed_at ?? null,
    reviewed_by:      raw.reviewed_by ?? null,
    review_notes:     raw.review_notes ?? null,
    paper: raw.paper ?? {
      title:    raw.paper_title   ?? null,
      authors:  raw.paper_authors ?? [],
      year:     raw.paper_year    ?? null,
      doi:      raw.paper_doi     ?? null,
      venue:    raw.paper_venue   ?? null,
      abstract: raw.paper_abstract ?? null,
      url:      raw.paper_url     ?? null,
      source:   raw.source        ?? "",
    },
    extracted_params:  raw.extracted_params  ?? {},
    proposed_instance: raw.proposed_instance ?? {},
  };
}

export async function fetchScraperStatus(): Promise<ScraperStatus> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/scraper/status`, { headers: HEADERS });
  } catch {
    throw new Error("Failed to fetch — is the backend server running?");
  }
  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return response.json() as Promise<ScraperStatus>;
}

export async function fetchScraperRuns(limit = 20): Promise<{ count: number; runs: ScraperRun[] }> {
  const response = await fetch(`${BASE_URL}/scraper/runs?limit=${limit}`, { headers: HEADERS });
  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return response.json() as Promise<{ count: number; runs: ScraperRun[] }>;
}

export async function triggerScraperRun(
  options?: { tech_ids?: string[]; sources?: string[] }
): Promise<{ status: string; message: string }> {
  const response = await fetch(`${BASE_URL}/scraper/run`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(options ?? {}),
  });
  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try {
      const body = await response.json() as { detail?: string; message?: string };
      detail = body.message ?? body.detail ?? detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  return response.json() as Promise<{ status: string; message: string }>;
}

export async function stopScraperRun(): Promise<{ status: string; message: string; run_id?: string }> {
  const response = await fetch(`${BASE_URL}/scraper/stop`, {
    method: "POST",
    headers: HEADERS,
  });
  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try {
      const body = await response.json() as { detail?: string; message?: string };
      detail = body.message ?? body.detail ?? detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  return response.json() as Promise<{ status: string; message: string; run_id?: string }>;
}

export async function fetchScraperCandidates(
  options?: { status?: string; technology_id?: string; limit?: number }
): Promise<{ count: number; candidates: ScraperCandidate[] }> {
  const params = new URLSearchParams();
  if (options?.status)        params.set("status", options.status);
  if (options?.technology_id) params.set("technology_id", options.technology_id);
  if (options?.limit)         params.set("limit", String(options.limit));
  const qs = params.toString();
  const response = await fetch(`${BASE_URL}/scraper/candidates${qs ? `?${qs}` : ""}`, {
    headers: HEADERS,
  });
  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  const data = await response.json() as { count: number; candidates: unknown[] };
  return { count: data.count, candidates: data.candidates.map(normalizeCandidate) };
}

export async function fetchScraperCandidate(candidateId: string): Promise<ScraperCandidate> {
  const response = await fetch(
    `${BASE_URL}/scraper/candidates/${encodeURIComponent(candidateId)}`,
    { headers: HEADERS }
  );
  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return normalizeCandidate(await response.json());
}

export async function approveScraperCandidate(
  candidateId: string,
  options?: { reviewed_by?: string; notes?: string }
): Promise<{ status: string; candidate: ScraperCandidate }> {
  const response = await fetch(
    `${BASE_URL}/scraper/candidates/${encodeURIComponent(candidateId)}/approve`,
    {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(options ?? {}),
    }
  );
  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  const data = await response.json() as { status: string; candidate: unknown };
  // Clear the promise cache so technology pages re-fetch and reflect the merged instance
  invalidateAll();
  return { status: data.status, candidate: normalizeCandidate(data.candidate) };
}

export async function rejectScraperCandidate(
  candidateId: string,
  reason?: string
): Promise<{ status: string; candidate: ScraperCandidate }> {
  const response = await fetch(
    `${BASE_URL}/scraper/candidates/${encodeURIComponent(candidateId)}/reject`,
    {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason ?? "", reviewed_by: undefined }),
    }
  );
  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  const data = await response.json() as { status: string; candidate: unknown };
  return { status: data.status, candidate: normalizeCandidate(data.candidate) };
}

// ── Timeseries pipeline trigger ───────────────────────────────────────────────

export async function runTimeseriesPipeline(): Promise<{ status: string; message: string }> {
  const response = await fetch(`${BASE_URL}/admin/timeseries/pipeline/run`, {
    method: "POST",
    headers: HEADERS,
  });
  if (!response.ok) {
    let detail = `Error ${response.status}`;
    try { detail = (await response.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return response.json() as Promise<{ status: string; message: string }>;
}

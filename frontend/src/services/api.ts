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

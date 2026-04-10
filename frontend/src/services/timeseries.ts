/**
 * services/timeseries.ts
 * ───────────────────────
 * API client for the time-series / profiles FastAPI endpoints.
 *
 * Follows the same Promise-caching pattern as services/api.ts so that
 * the same Promise reference is returned on repeated calls — required
 * for React 19's `use()` hook to avoid infinite Suspense loops.
 *
 * Endpoint contracts
 * ──────────────────
 * GET  /api/v1/timeseries              → TimeSeriesCatalogueResponse
 * GET  /api/v1/timeseries/{id}/data    → TimeSeriesData
 * POST /api/v1/timeseries/upload       → TimeSeriesUploadResponse (multipart)
 */

import type {
  TimeSeriesCatalogueResponse,
  TimeSeriesData,
  TimeSeriesUploadResponse,
} from "../types/timeseries";

// ── Base URL (shared with api.ts convention) ──────────────────────────────────

const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:8000/api/v1";

// ── Shared fetch wrapper ──────────────────────────────────────────────────────

const HEADERS: HeadersInit = {
  "ngrok-skip-browser-warning": "true",
  Accept: "application/json",
};

async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, { headers: HEADERS });

  if (!response.ok) {
    let detail = `API error ${response.status}: ${response.statusText} — ${BASE_URL}${path}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch { /* ignore parse failure */ }
    throw new Error(detail);
  }

  return response.json() as Promise<T>;
}

// ── Promise cache ─────────────────────────────────────────────────────────────

const promiseCache = new Map<string, Promise<unknown>>();

function cached<T>(key: string, factory: () => Promise<T>): Promise<T> {
  if (!promiseCache.has(key)) {
    promiseCache.set(key, factory());
  }
  return promiseCache.get(key) as Promise<T>;
}

// ── Catalogue endpoint ────────────────────────────────────────────────────────

/**
 * Returns a stable Promise for all profile catalogue entries (metadata only).
 * Safe to pass directly to the React 19 `use()` hook inside <Suspense>.
 *
 * If the backend returns 404 (endpoint not yet deployed) or the network is
 * unreachable, resolves with an empty catalogue instead of rejecting — the
 * TimeSeriesCatalogue component will show the empty state rather than the
 * ErrorBoundary.
 */
export function fetchTimeSeriesCatalogue(): Promise<TimeSeriesCatalogueResponse> {
  return cached("timeseries:catalogue", async () => {
    try {
      return await apiFetch<TimeSeriesCatalogueResponse>("/timeseries?limit=500");
    } catch (err) {
      // 404 means the endpoint is not yet available on this backend instance.
      // Treat as empty catalogue so the UI degrades gracefully.
      if (err instanceof Error && (
        err.message.includes("404") ||
        err.message.toLowerCase().includes("not found") ||
        err.message.includes("Failed to fetch")
      )) {
        return { total: 0, profiles: [] };
      }
      throw err;
    }
  });
}

/** Forces a fresh catalogue fetch on the next call (e.g., after upload). */
export function invalidateTimeSeriesCatalogue(): void {
  promiseCache.delete("timeseries:catalogue");
}

// ── Data endpoint (heavy array) ───────────────────────────────────────────────

/**
 * Returns a stable Promise for the full time-series data array of a profile.
 * Each call with the same `profileId` returns the same Promise reference —
 * safe for React 19 `use()` inside <Suspense>.
 *
 * The data array may contain up to ~35 000 points for 15-min annual profiles.
 * ECharts renders this via canvas without blocking the main thread.
 */
export function fetchTimeSeriesData(profileId: string): Promise<TimeSeriesData> {
  return cached(`timeseries:data:${profileId}`, () =>
    apiFetch<TimeSeriesData>(`/timeseries/${profileId}/data`)
  );
}

// ── Upload endpoint ───────────────────────────────────────────────────────────

/**
 * Uploads a new time-series profile.
 * Accepts a `FormData` object containing the CSV file and metadata fields.
 * Requires a valid Bearer token (contributor role).
 *
 * IMPORTANT: Do NOT set the `Content-Type` header manually — the browser
 * must set it automatically to include the multipart boundary string.
 */
export async function uploadTimeSeriesProfile(
  formData: FormData,
  token?: string | null
): Promise<TimeSeriesUploadResponse> {
  const response = await fetch(`${BASE_URL}/timeseries/upload`, {
    method: "POST",
    headers: {
      "ngrok-skip-browser-warning": "true",
      // Accept only — Content-Type deliberately omitted for multipart FormData
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  if (!response.ok) {
    let detail = `API error ${response.status}: ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }

  // Invalidate catalogue cache so the new profile appears immediately
  invalidateTimeSeriesCatalogue();

  return response.json() as Promise<TimeSeriesUploadResponse>;
}

// ── Delete endpoint ───────────────────────────────────────────────────────────

export async function deleteTimeSeriesProfile(
  profileId: string,
  token?: string | null,
): Promise<void> {
  const response = await fetch(
    `${BASE_URL}/timeseries/${encodeURIComponent(profileId)}`,
    {
      method: "DELETE",
      headers: {
        "ngrok-skip-browser-warning": "true",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );

  if (!response.ok) {
    let detail = `API error ${response.status}: ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }

  invalidateTimeSeriesCatalogue();
}

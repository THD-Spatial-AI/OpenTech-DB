/**
 * types/timeseries.ts
 * ────────────────────
 * TypeScript mirror of the time-series Pydantic models exposed by FastAPI.
 *
 * Endpoint contracts
 * ──────────────────
 * GET  /api/v1/timeseries              → TimeSeriesCatalogueResponse
 * GET  /api/v1/timeseries/{id}/data    → TimeSeriesData
 * POST /api/v1/timeseries/upload       → TimeSeriesUploadResponse
 */

// ── Discriminated string unions ───────────────────────────────────────────────

/** Semantic category of what the profile measures. */
export type ProfileType =
  | "load"
  | "generation"
  | "capacity_factor"
  | "weather"
  | "price";

/** Temporal granularity of a single time step. */
export type ProfileResolution = "15min" | "30min" | "hourly" | "daily";

// ── Catalogue entry (metadata only — no heavy arrays) ─────────────────────────

export interface TimeSeriesProfile {
  /** Unique identifier (UUID). */
  profile_id: string;
  /** Human-readable name, e.g. "DE Onshore Wind CF 2019". */
  name: string;
  type: ProfileType;
  resolution: ProfileResolution;
  /** ISO-3166 country or NUTS region code, e.g. "DE", "FR", "DE-BY". */
  location: string;
  /** Data provenance, e.g. "ERA5", "ENTSO-E", "oemof". */
  source: string;
  /** Number of time steps in the array. */
  n_timesteps: number;
  /** Reference year, when applicable. */
  year?: number | null;
  /** OEO-aligned carrier, e.g. "wind", "solar_irradiance". */
  carrier?: string | null;
  /** Optional free-text description. */
  description?: string | null;
  /** Physical unit of the series values, e.g. "p.u.", "MW", "EUR/MWh", "W/m²". */
  unit: string;
  /** ISO-8601 upload timestamp. */
  uploaded_at: string;
}

// ── Catalogue API response ────────────────────────────────────────────────────

export interface TimeSeriesCatalogueResponse {
  total: number;
  profiles: TimeSeriesProfile[];
}

// ── Heavy data payload ────────────────────────────────────────────────────────

/** A single (timestamp, value) observation. */
export interface TimeSeriesDataPoint {
  /** ISO-8601 timestamp, e.g. "2019-01-01T00:00:00Z". */
  timestamp: string;
  /** Dimensionless or dimensioned value (unit defined at profile level). */
  value: number;
}

/**
 * Full data payload returned by GET /timeseries/{id}/data.
 * May contain up to 35 040 points (15-min resolution, 1 year).
 */
export interface TimeSeriesData {
  profile_id: string;
  name: string;
  unit: string;
  points: TimeSeriesDataPoint[];
}

// ── Upload response ───────────────────────────────────────────────────────────

export interface TimeSeriesUploadResponse {
  submission_id: string;
  name:          string;
  n_timesteps:   number;
  status:        string;
}

// ── Filter state used by TimeSeriesCatalogue ──────────────────────────────────

export interface TimeSeriesFilterState {
  types:       Set<ProfileType>;
  resolutions: Set<ProfileResolution>;
  locationQuery: string;
}

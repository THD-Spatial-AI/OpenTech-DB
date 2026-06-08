/**
 * types/worldmap.ts
 * ─────────────────
 * Domain types for the Technology World Map view.
 * Covers country-level parameter data, tech/param selectors, and year range.
 */

// ── Tech identifiers shown on the map ────────────────────────────────────────

/** Dynamic technology id (UUID from /technologies endpoint). */
export type TechMapType = string;

// ── Parameters available for choropleth ──────────────────────────────────────

export type TechMapParam =
  | "capex"
  | "opex_fixed"
  | "capacity_factor"
  | "co2_emissions";

// ── Year-value pair ───────────────────────────────────────────────────────────

export interface YearValue {
  year: number;
  value: number;
}

// ── One time-series for a single (country, tech, param) triple ────────────────

export interface CountryTechSeries {
  tech: TechMapType;
  param: TechMapParam;
  /** Display unit, e.g. "USD/kW" or "%" */
  unit: string;
  /** Sorted ascending by year */
  series: YearValue[];
}

// ── All data for one country ──────────────────────────────────────────────────

export interface CountryMapData {
  /** ISO 3166-1 alpha-2, e.g. "DE" */
  iso2: string;
  /** ISO 3166-1 alpha-3, e.g. "DEU" — used to match GeoJSON feature ids */
  iso3: string;
  name: string;
  region: string;
  coverage: "direct" | "none";
  entries: CountryTechSeries[];
}

export interface WorldMapTechMeta {
  id: TechMapType;
  label: string;
  category: string;
  icon: string;
  color: string;
  carrierKey: "solar_irradiance" | "wind" | "water" | "electricity";
  availableParams: TechMapParam[];
}

export const PARAM_META: Record<TechMapParam, {
  label: string;
  unit: string;
  /** Whether a higher value is better (e.g. capacity factor) */
  higherIsBetter: boolean;
  /** Format a number value for display */
  format: (v: number) => string;
}> = {
  capex:           { label: "CAPEX",           unit: "USD/kW",     higherIsBetter: false, format: (v) => `$${v.toLocaleString()}` },
  opex_fixed:      { label: "Fixed O&M",       unit: "USD/kW/yr",  higherIsBetter: false, format: (v) => `$${v.toFixed(1)}`      },
  capacity_factor: { label: "Capacity Factor", unit: "%",           higherIsBetter: true,  format: (v) => `${v.toFixed(1)}%`      },
  co2_emissions:   { label: "CO₂ Emissions",   unit: "g/kWh",      higherIsBetter: false, format: (v) => `${v.toFixed(1)} g/kWh` },
};

/** The exact years for which data points exist in the service. */
export const MAP_YEARS = [2020, 2022, 2024, 2026, 2030, 2035] as const;
export type MapYear = (typeof MAP_YEARS)[number];

/** 5-colour quintile scale.  Index 0 = best quintile, 4 = worst. */
export function choroplethColor(
  value: number,
  min: number,
  max: number,
  higherIsBetter: boolean,
): string {
  if (max === min) return QUINTILE_COLORS[2];
  const t = (value - min) / (max - min); // 0 = lowest, 1 = highest
  const idx = Math.min(4, Math.floor(t * 5));
  return higherIsBetter ? QUINTILE_COLORS[4 - idx] : QUINTILE_COLORS[idx];
}

/** Green → yellow → red sequential quinile palette. */
export const QUINTILE_COLORS = [
  "#4ade80", // best  (green-400)
  "#a3e635", // good  (lime-400)
  "#facc15", // mid   (yellow-400)
  "#fb923c", // poor  (orange-400)
  "#f87171", // worst (red-400)
] as const;

export const NO_DATA_COLOR = "#d1d5db"; // gray-300

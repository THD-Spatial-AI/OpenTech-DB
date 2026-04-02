/**
 * types/api.ts
 * ────────────
 * TypeScript mirror of the Pydantic models exposed by the FastAPI backend.
 * Kept intentionally flat to ease serialisation / deserialisation.
 */

// ── Enums ────────────────────────────────────────────────────────────────────

export type TechnologyCategory =
  | "generation"
  | "storage"
  | "transmission"
  | "conversion";

export type EnergyCarrier =
  | "electricity"
  | "natural_gas"
  | "hydrogen"
  | "heat"
  | "cooling"
  | "steam"
  | "oil"
  | "coal"
  | "biomass"
  | "biogas"
  | "syngas"
  | "water"
  | "co2"
  | "ammonia"
  | "wind"
  | "solar_irradiance"
  | "nuclear_fuel";

export type LifeCycleStage =
  | "commercial"
  | "demonstration"
  | "projection"
  | "retired";

// ── Value with uncertainty ───────────────────────────────────────────────────

export interface ParameterValue {
  value: number;
  unit: string;
  min?: number | null;
  max?: number | null;
  source?: string | null;
  year?: number | null;
}

// ── Equipment Instance ───────────────────────────────────────────────────────

export interface EquipmentInstance {
  id: string;
  label: string;
  manufacturer?: string | null;
  reference_year?: number | null;
  life_cycle_stage: LifeCycleStage;
  // Economic
  capex_per_kw?: ParameterValue | null;
  opex_fixed_per_kw_yr?: ParameterValue | null;
  opex_variable_per_mwh?: ParameterValue | null;
  economic_lifetime_yr?: ParameterValue | null;
  discount_rate?: ParameterValue | null;
  // Technical
  electrical_efficiency?: ParameterValue | null;
  thermal_efficiency?: ParameterValue | null;
  capacity_kw?: ParameterValue | null;
  capacity_factor?: ParameterValue | null;
  // Environmental
  co2_emission_factor?: ParameterValue | null;
  // Operational
  ramp_up_rate?: ParameterValue | null;
  ramp_down_rate?: ParameterValue | null;
  min_stable_generation?: ParameterValue | null;
  start_up_cost?: ParameterValue | null;
  // Storage / conversion
  capex_per_kwh?: ParameterValue | null;
  fuel_cost_per_mwh?: ParameterValue | null;
  initial_soc?: ParameterValue | null;
  // Arbitrary extras
  extra: Record<string, unknown>;
}

// ── Technology (base) ─────────────────────────────────────────────────────────

export interface Technology {
  id: string;
  name: string;
  category: TechnologyCategory;
  description?: string | null;
  tags: string[];
  oeo_class?: string | null;
  oeo_uri?: string | null;
  input_carriers: EnergyCarrier[];
  output_carriers: EnergyCarrier[];
  instances: EquipmentInstance[];
  // Generation-specific (optional, present on PowerPlant / VREPlant)
  technology_type?: string | null;
  primary_fuel?: EnergyCarrier | null;
  is_dispatchable?: boolean;
  is_renewable?: boolean;
  // Storage-specific
  storage_technology_type?: string | null;
  // Transmission-specific
  transmission_type?: string | null;
  // Conversion-specific
  conversion_type?: string | null;
}

// ── Technology summary (returned by list / category endpoints) ────────────────
// Mirrors schemas/models.py :: TechnologySummary
// Full Technology (with instances) is only returned by GET /technologies/{id}

export interface TechnologySummary {
  id: string;
  name: string;
  category: TechnologyCategory;
  oeo_class: string | null;
  oeo_uri: string | null;
  n_instances: number;
}

// ── API list/catalogue response ───────────────────────────────────────────────
// Mirrors schemas/models.py :: TechnologyCatalogue

export interface TechnologyCatalogueResponse {
  total: number;
  technologies: TechnologySummary[];
}

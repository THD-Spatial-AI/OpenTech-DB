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
  slug: string | null;
  name: string;
  category: TechnologyCategory;
  oeo_class: string | null;
  oeo_uri: string | null;
  n_instances: number;
  input_carriers: EnergyCarrier[];
  output_carriers: EnergyCarrier[];
}

// ── API list/catalogue response ───────────────────────────────────────────────
// Mirrors schemas/models.py :: TechnologyCatalogue

export interface TechnologyCatalogueResponse {
  total: number;
  technologies: TechnologySummary[];
}

// ── Auth ─────────────────────────────────────────────────────────────────────

/** Public identity returned by the standalone Go authentication service. */
export interface AuthUser {
  id: string;
  username: string;
  email: string;
  realm: "opentechdb";
  roles: string[];
  avatar_url?: string | null;
  /** Keycloak itself or a provider brokered by this realm. */
  auth_provider: string;
  /** Whether the data-steward role has been granted */
  is_contributor: boolean;
  /** Whether this user has admin privileges */
  is_admin?: boolean;
}

// ── Ontology schema — returned by GET /api/v1/ontology/schema ────────────────
// Defines the controlled vocabularies that contributors MUST use when adding
// new technologies. All four arrays are sourced directly from the OEO.

export interface OntologySchema {
  allowed_domains: string[];
  allowed_carriers: string[];
  allowed_oeo_classes: string[];
  allowed_reference_sources: string[];
}

// ── Contributor payload — POST /api/v1/technologies ──────────────────────────

export interface CreateTechnologyInstancePayload {
  variant_name: string;
  capex_usd_per_kw: number;
  opex_fixed_usd_per_kw_yr: number;
  opex_var_usd_per_mwh: number;
  efficiency_percent: number;
  lifetime_years: number;
  co2_emission_factor_operational_g_per_kwh: number;
  reference_source: string;
}

export interface CreateTechnologyPayload {
  technology_name: string;
  domain: string;
  carrier: string;
  oeo_class: string;
  description: string;
  instances: CreateTechnologyInstancePayload[];
}

// ── Admin — pending submissions ───────────────────────────────────────────────

export interface SubmissionRecord {
  submission_id:    string;
  technology_name:  string;
  submitted_at:     string;
  status:           "pending_review" | "approved" | "rejected";
  domain:           string | null;
  oeo_class:        string | null;
  description:      string | null;
  submitter_email:  string | null;  // realm email claim used for attribution
  rejection_reason: string | null;  // populated when admin rejects
  pr_url:           string | null;  // GitHub PR URL created on approval
  filename:         string;          // empty for DB records
  payload:          CreateTechnologyPayload | null;  // full submission details
}

// ── Scraper pipeline ──────────────────────────────────────────────────────────

export type ScraperCandidateStatus = "pending" | "approved" | "rejected";

export interface ScraperSchedulerJob {
  id: string;
  name: string;
  next_run: string | null;
}

export interface ScraperSchedulerStatus {
  running: boolean;
  jobs: ScraperSchedulerJob[];
}

export interface ScraperCandidateCounts {
  pending: number;
  approved: number;
  rejected: number;
}

export interface ScraperLastRun {
  started_at: string | null;
  finished_at: string | null;
  papers_found: number;
  candidates_created: number;
  sources_used: string[];
  error: string | null;
}

export interface ScraperStatus {
  scheduler: ScraperSchedulerStatus;
  enabled_sources: string[];
  candidates: ScraperCandidateCounts;
  last_run: ScraperLastRun | null;
  current_run?: ScraperCurrentRun | null;
  current_log_tail?: string[];
}

export interface ScraperRunEvent {
  at: string;
  level: "info" | "warning" | "error" | string;
  message: string;
  phase?: string;
  technology_id?: string;
  source?: string;
  paper_id?: string;
}

export interface ScraperCurrentRun {
  run_id: string;
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  elapsed_seconds: number;
  current_phase: string | null;
  current_technology: string | null;
  current_source: string | null;
  technologies_total: number;
  technologies_processed: number;
  sources_total: number;
  papers_fetched: number;
  candidates_created: number;
  errors_count: number;
  events: ScraperRunEvent[];
  log_tail?: string[];
}

export interface ScraperRun {
  run_id: string;
  started_at: string | null;
  finished_at: string | null;
  technologies_processed: number;
  papers_fetched: number;
  candidates_created: number;
  errors: string[];
}

export interface ExtractedParam {
  value: number;
  unit: string;
  confidence: number;
  source_text?: string | null;
}

export interface ScraperCandidate {
  candidate_id: string;
  technology_id: string;
  technology_name: string;
  status: ScraperCandidateStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_notes: string | null;
  paper: {
    title: string;
    authors: string[];
    year: number | null;
    doi: string | null;
    venue: string | null;
    abstract: string | null;
    url: string | null;
    source: string;
  };
  extracted_params: Record<string, ExtractedParam>;
  proposed_instance: Record<string, unknown>;
}

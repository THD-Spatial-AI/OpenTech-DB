/**
 * ccsSimPayload.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds the canonical JSON payload for POST /api/ccs/simulate.
 *
 * Schema v2.0 — every field carries its unit in the key name for clarity
 * never has to guess.  The full structure is documented in the JSDoc below.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * REQUEST SCHEMA  (what we POST to the simulation service)
 * ──────────────────────────────────────────────────────────────────────────
 * {
 *   schema_version: "2.0",
 *
 *   simulation: {
 *     t_end_s:  number,   // simulation horizon [seconds]
 *     dt_s:     number,   // integration time-step [seconds]
 *   },
 *
 *   source: {
 *     tech_type:           string,  // "coal"|"gas"|"cement"|"steel"|"refinery"|"biomass"
 *     name:                string,
 *     capacity_kw:         number,  // rated electrical/thermal capacity [kW]
 *     efficiency_pct:      number|null, // plant efficiency [%]
 *     co2_emission_kg_kwh: number,  // CO₂ emission factor [kg CO₂/kWh]
 *     profile: [                     // flue gas CO₂ concentration time-series
 *       { time_s: number, co2_pct: number }, ...
 *     ]
 *   },
 *
 *   absorber: {
 *     tech_type:               string,  // "mea"|"advanced_amine"|"carbonate"|"membrane"|"calcium_loop"
 *     name:                    string,
 *     capture_rate_pct:        number,  // CO₂ capture efficiency [%]
 *     energy_requirement_gj_tco2: number, // specific energy [GJ/tCO₂]
 *     solvent_flow_rate_m3h:   number,  // solvent circulation [m³/h]
 *     absorption_temp_c:       number,  // absorber operating temp [°C]
 *   },
 *
 *   stripper: {
 *     tech_type:               string,  // "conventional"|"vapor_recomp"|"multi_pressure"|"flash"
 *     name:                    string,
 *     thermal_efficiency_pct:  number,  // regeneration efficiency [%]
 *     reboiler_temp_c:         number,  // reboiler temperature [°C]
 *     steam_pressure_bar:      number,  // steam supply pressure [bar]
 *   },
 *
 *   compressor: {
 *     tech_type:                  string,  // "multistage"|"supercritical"|"isothermal"
 *     name:                       string,
 *     isentropic_efficiency_frac: number,  // 0–1
 *     inlet_pressure_bar:         number,  // stripper outlet → compressor inlet [bar]
 *     target_pressure_bar:        number,  // pipeline/storage target [bar]
 *   },
 *
 *   storage: {
 *     tech_type:                  string,  // "saline_aquifer"|"depleted_gas"|"depleted_oil"|"basalt"|"pipeline"
 *     name:                       string,
 *     injection_rate_mtco2_yr:    number,  // injection rate [MtCO₂/yr]
 *     storage_depth_m:            number,  // geological depth [m]
 *     reservoir_pressure_bar:     number,  // formation pressure [bar]
 *     storage_efficiency_pct:     number,  // storage efficiency [%]
 *   }
 * }
 *
 * ──────────────────────────────────────────────────────────────────────────
 * EXPECTED RESPONSE SCHEMA  (what the simulation service returns)
 * ──────────────────────────────────────────────────────────────────────────
 * {
 *   time_s: number[],                  // simulation time axis
 *
 *   // Per-device time series
 *   source: {
 *     power_output_kw:      number[],  // source plant power output
 *     flue_gas_flow_kg_s:   number[],  // flue gas mass flow
 *     co2_concentration_pct: number[], // CO₂ concentration in flue gas
 *   },
 *   absorber: {
 *     co2_captured_kg_h:    number[],  // CO₂ capture rate [kg/h]
 *     solvent_temperature_c: number[], // absorber solvent temp
 *     capture_efficiency_pct: number[], // instantaneous capture efficiency
 *   },
 *   stripper: {
 *     thermal_input_kw:     number[],  // steam/heat input
 *     co2_released_kg_h:    number[],  // CO₂ desorption rate [kg/h]
 *     solvent_regeneration_pct: number[], // solvent regeneration efficiency
 *   },
 *   compressor: {
 *     power_consumed_kw:    number[],  // electrical power for compression
 *     outlet_pressure_bar:  number[],  // CO₂ outlet pressure
 *     outlet_temp_c:        number[],  // CO₂ outlet temperature
 *   },
 *   storage: {
 *     injection_rate_kg_h:  number[],  // CO₂ injection rate [kg/h]
 *     reservoir_pressure_bar: number[], // formation pressure
 *     cumulative_stored_tco2: number[], // cumulative CO₂ stored [tCO₂]
 *   },
 *
 *   // KPIs
 *   kpi: {
 *     total_co2_captured_tco2:      number,  // total CO₂ captured [tCO₂]
 *     total_co2_stored_tco2:        number,  // total CO₂ stored [tCO₂]
 *     avg_capture_rate_pct:         number,  // average capture efficiency [%]
 *     specific_energy_gj_tco2:      number,  // energy penalty [GJ/tCO₂]
 *     total_energy_consumed_gwh:    number,  // total energy consumed [GWh]
 *     avoided_emissions_tco2:       number,  // emissions avoided [tCO₂]
 *     capture_cost_usd_tco2:        number,  // estimated cost [USD/tCO₂]
 *   }
 * }
 */

// ─────────────────────────────────────────────────────────────────────────────
// Payload builder
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// tech_type enum mappers — UI ids → service enum values
// ─────────────────────────────────────────────────────────────────────────────
function mapSourceTechType(id = "") {
  const s = String(id).toLowerCase();
  if (s.includes("coal"))    return "coal_plant";
  if (s.includes("gas"))     return "gas_plant";
  if (s.includes("cement"))  return "cement";
  if (s.includes("steel"))   return "steel";
  if (s.includes("refinery") || s.includes("oil")) return "refinery";
  return "generic";
}
function mapAbsorberTechType(id = "") {
  const s = String(id).toLowerCase();
  if (s.includes("ammonia")) return "ammonia";
  if (s.includes("ionic"))   return "ionic_liquid";
  if (s.includes("amine"))   return "amine";
  return "mea"; // default — most common
}
function mapStripperTechType(id = "") {
  const s = String(id).toLowerCase();
  if (s.includes("vacuum"))         return "vacuum";
  if (s.includes("pressure_swing")) return "pressure_swing";
  return "thermal";
}
function mapCompressorTechType(id = "") {
  const s = String(id).toLowerCase();
  if (s.includes("isothermal"))       return "isothermal";
  if (s.includes("integrally"))       return "integrally_geared";
  return "multistage";
}
function mapStorageTechType(id = "") {
  const s = String(id).toLowerCase();
  if (s.includes("depleted") || s.includes("gas_field") || s.includes("oil_field")) return "depleted_field";
  if (s.includes("ocean"))   return "ocean";
  if (s.includes("mineral")) return "mineral";
  return "saline_aquifer";
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the complete simulation payload from UI state.
 * Maps UI-friendly field names to the exact schema required by the CCS service.
 *
 * @param {{
 *   sim: { t_end_s: number, dt_s: number },
 *   source, absorber, stripper, compressor, storage, selectedModels
 * }} params
 *
 * @returns {object} Schema v2.0 payload ready for POST /api/ccs/submit
 */
export function buildSimPayload(params) {
  const { sim, source, absorber, stripper, compressor, storage, selectedModels } = params;

  const t_end_s = sim.t_end_s ?? 86400;
  const dt_s    = sim.dt_s ?? 900;

  // ── Derive flue gas flow from plant capacity ───────────────────────────────
  // Natural gas combustion: ~0.9 Nm³ flue gas per kWh of thermal input.
  // Thermal input = capacity_kw / (efficiency_pct/100).
  const capacity_kw   = source.capacity_kw ?? selectedModels?.source?.capacity_kw ?? 400000;
  const efficiency_pct = source.efficiency_pct ?? selectedModels?.source?.efficiency_pct ?? 58;
  const co2_emission_kg_kwh = source.co2_emission_kg_kwh ?? selectedModels?.source?.co2_emission_kg_kwh ?? 0.38;
  const thermal_kw    = capacity_kw / (efficiency_pct / 100);
  // Flue gas ≈ 0.9 Nm³/kWh thermal × 3600 s/h ÷ 1000 = 3.24 Nm³/h per kW thermal
  const flue_gas_flow_nm3h = Math.round(thermal_kw * 3.24);

  // ── CO2 emission rate in t/h ───────────────────────────────────────────────
  // co2_tph = capacity_kw [kW] × co2_emission_kg_kwh [kg/kWh] ÷ 1000 [kg/t]
  const base_co2_tph = capacity_kw * co2_emission_kg_kwh / 1000;

  // ── Profile: [{time_s, co2_tph}] with slight variation ────────────────────
  const profile = generateFlueGasProfile(t_end_s, dt_s, base_co2_tph);

  // ── Absorber geometry defaults from flow rate / L:G ratio ─────────────────
  const solvent_flow_rate_m3h = absorber.solvent_flow_rate_m3h ?? 500;
  // Column diameter: approximate from volumetric gas flow (superficial velocity ~1.5 m/s)
  const col_diameter = Math.max(2, Math.round(Math.sqrt(flue_gas_flow_nm3h / 3600 / 1.5 / Math.PI) * 2 * 2) / 2);

  // ── Storage capacity from injection rate and horizon ──────────────────────
  const injection_rate_mtco2_yr = storage.injection_rate_mtco2_yr ?? 5;
  const injection_rate_tph      = Math.round((injection_rate_mtco2_yr * 1e6) / 8760 * 10) / 10;
  const sim_years               = t_end_s / 31536000;
  const capacity_tonnes         = Math.max(injection_rate_mtco2_yr * 1e6 * Math.max(1, sim_years * 10), 1e6);

  const reservoir_pressure_bar  = storage.reservoir_pressure_bar ?? 150;

  return {
    schema_version: "2.0",

    simulation: {
      t_end_s,
      dt_s,
    },

    source: {
      tech_type:            mapSourceTechType(source.tech_type ?? selectedModels?.source?.id),
      name:                 selectedModels?.source?.name ?? "Flue Gas Source",
      co2_concentration_pct: source.co2_concentration_pct ?? selectedModels?.source?.co2_concentration_pct ?? 12,
      flue_gas_flow_nm3h,
      temperature_c:        source.flue_gas_temp_c ?? 120,
      pressure_bar:         1.08,   // slightly above atmospheric (typical stack outlet)
      profile,
    },

    absorber: {
      tech_type:              mapAbsorberTechType(absorber.tech_type ?? selectedModels?.absorber?.id),
      name:                   selectedModels?.absorber?.name ?? "CO₂ Absorber",
      capture_efficiency_pct: absorber.capture_rate_pct ?? selectedModels?.absorber?.efficiency_pct ?? 90,
      solvent_flow_rate_m3h,
      packing_height_m:       20,
      column_diameter_m:      col_diameter,
      operating_temperature_c: absorber.absorption_temp_c ?? 40,
      operating_pressure_bar:  1.1,
    },

    stripper: {
      tech_type:                   mapStripperTechType(stripper.tech_type ?? selectedModels?.stripper?.id),
      name:                        selectedModels?.stripper?.name ?? "CO₂ Stripper",
      // 1 GJ/tCO₂ = 277.78 kWh/tCO₂
      regeneration_energy_kwh_tco2: (stripper.energy_input_gj_tco2 ?? 3.2) * 277.78,
      steam_pressure_bar:           stripper.steam_pressure_bar ?? 3.5,
      operating_temperature_c:      stripper.reboiler_temp_c ?? 120,
      co2_purity_pct:               98,
    },

    compressor: {
      tech_type:                  mapCompressorTechType(compressor.tech_type ?? selectedModels?.compressor?.id),
      name:                       selectedModels?.compressor?.name ?? "CO₂ Compressor",
      num_stages:                 compressor.number_stages ?? compressor.num_stages ?? 4,
      isentropic_efficiency_frac: compressor.isentropic_efficiency_frac ?? 0.82,
      inlet_pressure_bar:         compressor.inlet_pressure_bar ?? 1.5,
      target_pressure_bar:        compressor.target_pressure_bar ?? 110,
      intercooler_efficiency_pct: 80,
    },

    storage: {
      tech_type:        mapStorageTechType(storage.tech_type ?? selectedModels?.storage?.id),
      name:             selectedModels?.storage?.name ?? "CO₂ Storage",
      max_pressure_bar: reservoir_pressure_bar * 1.05,
      min_pressure_bar: reservoir_pressure_bar * 0.5,
      initial_fill_pct: 10,
      capacity_tonnes,
      injection_rate_tph,
      permeability_md:  storage.permeability_md ?? 200,
      porosity_pct:     storage.porosity_pct ?? 18,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile generators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a default flue gas CO₂ concentration profile based on source type.
 */
/**
 * Generate a flue gas CO₂ emission rate profile [{time_s, co2_tph}].
 * @param {number} t_end_s - simulation horizon in seconds
 * @param {number} dt_s    - time step in seconds
 * @param {number} base_co2_tph - base CO₂ emission rate [t/h]
 */
function generateFlueGasProfile(t_end_s, dt_s, base_co2_tph) {
  const steps = Math.min(Math.ceil(t_end_s / dt_s), 2000); // cap at 2000 points
  const profile = [];
  for (let i = 0; i <= steps; i++) {
    const time_s = i * dt_s;
    // ±5% random variation to simulate realistic load fluctuations
    const variation = 1 + (Math.random() - 0.5) * 0.1;
    profile.push({ time_s, co2_tph: parseFloat((base_co2_tph * variation).toFixed(2)) });
  }
  return profile;
}

// ─────────────────────────────────────────────────────────────────────────────
// Result normalizer (handles both nested v2 and flat v1 responses)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize the simulation result from the service to a consistent structure.
 * Handles both nested (v2) and flat (v1) response formats.
 */
export function normalizeSimResult(raw) {
  if (!raw) return null;

  // v2 flat format — service returns prefix_field_name style arrays
  // Check for v2 by presence of a v2-specific field
  const isV2 = raw.source_co2_tph !== undefined || raw.schema_version === "2.0";

  if (isV2) {
    return {
      schema_version: "2.0",
      time_s: raw.time_s ?? [],

      source: {
        co2_tph:               raw.source_co2_tph ?? [],
      },

      absorber: {
        co2_captured_tph:      raw.absorber_co2_captured_tph ?? [],
        solvent_flow_m3h:      raw.absorber_solvent_flow_m3h ?? [],
        power_kw:              raw.absorber_power_kw ?? [],
        temperature_c:         raw.absorber_temperature_c ?? [],
      },

      stripper: {
        co2_released_tph:      raw.stripper_co2_released_tph ?? [],
        heat_demand_kw:        raw.stripper_heat_demand_kw ?? [],
        temperature_c:         raw.stripper_temperature_c ?? [],
      },

      compressor: {
        power_kw:              raw.compressor_power_kw ?? [],
        outlet_pressure_bar:   raw.compressor_outlet_pressure_bar ?? [],
        temperature_c:         raw.compressor_temperature_c ?? [],
      },

      storage: {
        pressure_bar:          raw.storage_pressure_bar ?? [],
        fill_pct:              raw.storage_fill_pct ?? [],
        co2_mass_tonnes:       raw.storage_co2_mass_tonnes ?? [],
        injection_rate_tph:    raw.storage_injection_rate_tph ?? [],
      },

      kpi: raw.kpi ?? {},
    };
  }

  // Legacy v1 nested format — return as-is
  if (raw.source || raw.absorber || raw.stripper) {
    return raw;
  }

  // Legacy v1 flat format
  return {
    time_s: raw.time_s ?? [],

    source: {
      power_output_kw:       raw.source_power_kw ?? [],
      co2_concentration_pct: raw.source_co2_pct ?? [],
    },

    absorber: {
      co2_captured_tph:      raw.co2_captured_kg_h ? raw.co2_captured_kg_h.map(v => v / 1000) : [],
      temperature_c:         raw.absorber_temp_c ?? [],
      capture_efficiency_pct: raw.capture_efficiency_pct ?? [],
    },

    stripper: {
      heat_demand_kw:        raw.thermal_input_kw ?? [],
      co2_released_tph:      raw.co2_released_kg_h ? raw.co2_released_kg_h.map(v => v / 1000) : [],
    },

    compressor: {
      power_kw:              raw.compressor_power_kw ?? [],
      outlet_pressure_bar:   raw.compressor_outlet_bar ?? [],
      temperature_c:         raw.compressor_outlet_c ?? [],
    },

    storage: {
      pressure_bar:          raw.reservoir_pressure_bar ?? [],
      co2_mass_tonnes:       raw.cumulative_stored_tco2 ?? [],
      injection_rate_tph:    raw.injection_rate_kg_h ? raw.injection_rate_kg_h.map(v => v / 1000) : [],
    },

    kpi: raw.kpi ?? {},
  };
}

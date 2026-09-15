/**
 * h2SimPayload.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds the canonical JSON payload for POST /api/hydrogen/simulate.
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
 *     tech_type:      string,  // "solar"|"wind"|"nuclear"|"hydro"|"gas"|"coal"|"biomass"|"geothermal"|"generic"
 *     name:           string,
 *     capacity_kw:    number,  // rated electrical capacity [kW]
 *     efficiency_pct: number|null, // generator efficiency [%], null for renewables
 *     profile: [               // power time-series fed to the ELZ AC bus
 *       { time_s: number, power_kw: number }, ...
 *     ]
 *   },
 *
 *   electrolyzer: {
 *     tech_type:                  string,  // "pem"|"alkaline"|"soec"|"aem"
 *     name:                       string,
 *     capacity_kw:                number,  // rated AC input capacity [kW]
 *     nominal_efficiency_pct_hhv: number,  // efficiency at rated point, HHV basis [%]
 *     min_load_pct:               number,  // minimum partial load [%]
 *     max_load_pct:               number,  // 100 in most cases [%]
 *     operating_temperature_c:    number,  // stack temperature [°C]
 *     water_flow_rate_lpm:        number,  // DI water feed [L/min]
 *     h2_hhv_kwh_per_kg:          39.4,    // reference constant [kWh/kg] — specifies HHV basis
 *   },
 *
 *   compressor: {
 *     tech_type:                  string,  // "reciprocating"|"ionic"|"linear"
 *     name:                       string,
 *     isentropic_efficiency_frac: number,  // 0–1
 *     inlet_pressure_bar:         number,  // ELZ outlet → compressor inlet [bar]
 *     target_pressure_bar:        number,  // storage fill target [bar]
 *   },
 *
 *   storage: {
 *     tech_type:                  string,  // "compressed_h2"|"liquid_h2"|"metal_hydride"|"cavern"
 *     name:                       string,
 *     max_pressure_bar:           number,  // max allowable pressure [bar]
 *     min_pressure_bar:           number,  // min usable pressure [bar]
 *     initial_soc_pct:            number,  // initial state-of-charge [%]
 *     round_trip_efficiency_pct:  number,  // storage round-trip eff [%]
 *   },
 *
 *   fuel_cell: {
 *     tech_type:              string,  // "pem"|"sofc"|"mcfc"|"pafc"|"alkaline"
 *     name:                   string,
 *     rated_power_kw:         number,  // rated AC power output [kW]
 *     nominal_efficiency_pct: number,  // DC electrical efficiency, LHV basis [%]
 *     min_load_pct:           number,  // minimum load [%]
 *     h2_flow_rate_nm3h:      number,  // H₂ feed at rated power [Nm³/h]
 *     operating_pressure_bar: number,  // cathode/anode operating pressure [bar]
 *     cooling_capacity_kw:    number,  // thermal management [kW]
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
 *   electrolyzer: {
 *     power_in_kw:          number[],  // AC power consumed
 *     h2_production_nm3h:   number[],  // volumetric H₂ rate [Nm³/h]
 *     h2_production_kg_h:   number[],  // mass H₂ rate [kg/h]
 *     efficiency_pct:       number[],  // actual instantaneous efficiency [%]
 *     stack_temperature_c:  number[],  // optional
 *   },
 *   compressor: {
 *     power_consumed_kw:    number[],
 *     outlet_pressure_bar:  number[],
 *   },
 *   storage: {
 *     pressure_bar:         number[],
 *     soc_pct:              number[],
 *     h2_mass_kg:           number[],
 *   },
 *   fuel_cell: {
 *     power_output_kw:      number[],
 *     h2_consumed_nm3h:     number[],
 *     terminal_voltage_v:   number[],
 *     current_density_acm2: number[],
 *     efficiency_pct:       number[],
 *   },
 *
 *   // Aggregate KPIs
 *   kpi: {
 *     total_h2_produced_kg:          number,
 *     total_h2_consumed_kg:          number,
 *     total_energy_consumed_kwh:     number,
 *     overall_system_efficiency_pct: number,
 *     specific_energy_kwh_kg:        number,  // kWh per kg H₂ produced
 *     peak_h2_production_kg_h:       number,
 *     avg_electrolyzer_load_pct:     number,
 *     capacity_factor_pct:           number,
 *   },
 *
 *   // Backward-compat flat aliases (service may return either form)
 *   electrolyzer_power_kw:    number[],  // = electrolyzer.power_in_kw
 *   h2_production_nm3h:       number[],  // = electrolyzer.h2_production_nm3h
 *   tank_pressure_bar:        number[],  // = storage.pressure_bar
 *   fc_terminal_voltage_v:    number[],  // = fuel_cell.terminal_voltage_v
 *   fc_current_density_acm2:  number[],  // = fuel_cell.current_density_acm2
 *   fc_power_output_kw:       number[],  // = fuel_cell.power_output_kw
 * }
 */

import { detectSourceTechType, resolveSourceProfile } from './h2SourceProfiles.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

const safeN = (x) => { if (x == null) return null; const n = Number(x); return isFinite(n) ? n : null; };

function parseCapacityToKw(value, unitHint = null) {
  const toMultiplier = (u) => {
    const s = String(u ?? '').trim().toLowerCase();
    if (s === 'kw') return 1;
    if (s === 'mw') return 1000;
    if (s === 'gw') return 1000000;
    return null;
  };

  if (value == null) return null;

  if (typeof value === 'object') {
    const raw = value.value ?? value.amount ?? value.capacity ?? null;
    const unit = value.unit ?? value.units ?? unitHint;
    return parseCapacityToKw(raw, unit);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value * (toMultiplier(unitHint) ?? 1);
  }

  if (typeof value === 'string') {
    const s = value.trim();
    const m = s.match(/^([+-]?\d+(?:\.\d+)?)\s*([kmg]w)?$/i);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n * (toMultiplier(m[2] ?? unitHint) ?? 1);
  }

  return null;
}

function modelCapacityKw(model) {
  const unit = model?.capacity_unit ?? model?.unit ?? model?.units ?? model?.specs?.capacity_unit ?? model?.technical_specifications?.capacity_unit;
  const candidates = [
    [model?.capacity_kw, 'kw'],
    [model?.rated_power_kw, 'kw'],
    [model?.nominal_power_kw, 'kw'],
    [model?.power_kw, 'kw'],
    [model?.plant_capacity_kw, 'kw'],
    [model?.nameplate_capacity_kw, 'kw'],
    [model?.specs?.capacity_kw, 'kw'],
    [model?.specs?.rated_power_kw, 'kw'],
    [model?.technical_specifications?.capacity_kw, 'kw'],
    [model?.defaults?.capacity_kw, 'kw'],
    [model?.parameters?.capacity_kw, 'kw'],
    [model?.capacity_mw, 'mw'],
    [model?.rated_power_mw, 'mw'],
    [model?.nominal_power_mw, 'mw'],
    [model?.size_mw, 'mw'],
    [model?.plant_capacity_mw, 'mw'],
    [model?.nameplate_capacity_mw, 'mw'],
    [model?.specs?.capacity_mw, 'mw'],
    [model?.technical_specifications?.capacity_mw, 'mw'],
    [model?.defaults?.capacity_mw, 'mw'],
    [model?.parameters?.capacity_mw, 'mw'],
    [model?.capacity_gw, 'gw'],
    [model?.specs?.capacity_gw, 'gw'],
    [model?.technical_specifications?.capacity_gw, 'gw'],
    [model?.capacity, unit],
    [model?.rated_power, unit],
    [model?.nameplate_capacity, unit],
    [model?.specs?.capacity, model?.specs?.capacity_unit ?? unit],
    [model?.technical_specifications?.capacity, model?.technical_specifications?.capacity_unit ?? unit],
  ];

  for (const [raw, u] of candidates) {
    const kw = parseCapacityToKw(raw, u);
    if (kw != null) return kw;
  }
  return null;
}

function modelEfficiencyPct(model) {
  const pct = safeN(model?.efficiency_pct) ?? safeN(model?.efficiency_percent);
  if (pct != null) return pct;
  const frac = safeN(model?.efficiency) ?? safeN(model?.efficiency_frac);
  if (frac == null) return null;
  return frac <= 1 ? frac * 100 : frac;
}

function modelMinLoadPct(model) {
  const direct =
    safeN(model?.min_load_pct)
    ?? safeN(model?.minimum_load_pct)
    ?? safeN(model?.min_part_load_pct)
    ?? safeN(model?.technical_specifications?.min_load_pct)
    ?? safeN(model?.specs?.min_load_pct)
    ?? safeN(model?.defaults?.min_load_pct)
    ?? safeN(model?.parameters?.min_load_pct);
  if (direct != null) return direct;

  const frac =
    safeN(model?.min_load_frac)
    ?? safeN(model?.minimum_load_fraction)
    ?? safeN(model?.technical_specifications?.min_load_frac)
    ?? safeN(model?.specs?.min_load_frac);
  if (frac == null) return null;
  return frac <= 1 ? frac * 100 : frac;
}

function avgArray(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const vals = arr.map((v) => safeN(v?.power_kw ?? v)).filter((v) => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Detect ELZ tech type */
function detectElzTechType(model) {
  if (!model) return 'pem';
  const key = `${model.id ?? ''} ${model.name ?? ''}`.toLowerCase();
  if (/alkaline|alk/.test(key))             return 'alkaline';
  if (/soec|solid.oxide|high.temp/.test(key)) return 'soec';
  if (/aem|anion/.test(key))               return 'aem';
  return 'pem';
}

/** Detect fuel cell type */
function detectFcTechType(model) {
  if (!model) return 'pem';
  const key = `${model.id ?? ''} ${model.name ?? ''}`.toLowerCase();
  if (/sofc/.test(key))    return 'sofc';
  if (/mcfc/.test(key))    return 'mcfc';
  if (/pafc/.test(key))    return 'pafc';
  if (/alkaline/.test(key)) return 'alkaline';
  return 'pem';
}

/** Detect compressor type */
function detectCompressorType(model) {
  if (!model) return 'reciprocating';
  const key = `${model.id ?? ''} ${model.name ?? ''}`.toLowerCase();
  if (/ionic/.test(key))  return 'ionic';
  if (/linear/.test(key)) return 'linear';
  return 'reciprocating';
}

/** Detect storage type */
function detectStorageTechType(model) {
  if (!model) return 'compressed_h2';
  const key = `${model.id ?? ''} ${model.name ?? ''}`.toLowerCase();
  if (/liquid|lh2/.test(key))      return 'liquid_h2';
  if (/hydride|mh/.test(key))      return 'metal_hydride';
  if (/cavern|underground/.test(key)) return 'cavern';
  return 'compressed_h2';
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export — payload builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the full simulation payload for /api/hydrogen/simulate.
 *
 * @param {{
 *   selectedModels:   { source, electrolyzer, compressor, storage, fuel_cell }
 *   genParamOverrides: object   – overrides from generator panel
 *   elzParamOverrides: object   – overrides from electrolyzer panel
 *   elz:              { grid_power_kw, water_flow_rate_lpm, temperature_c }
 *   sto:              { compressor_efficiency, max_tank_pressure_bar }
 *   fc:               { h2_flow_rate_nm3h, oxidant_pressure_bar, cooling_capacity_kw }
 *   sim:              { t_end_s, dt_s }
 *   customProfile:    { data: Array } | null
 * }} opts
 * @returns {object} payload  ready for JSON.stringify
 */
export function buildSimPayload({
  selectedModels = {},
  sourceVariant = null,
  genParamOverrides = {},
  elzParamOverrides = {},
  elz = {},
  sto = {},
  fc  = {},
  sim = {},
  customProfile = null,
}) {
  const hintedElzCap = safeN(elzParamOverrides?.capacity_kw) ?? safeN(elz?.grid_power_kw) ?? null;

  // ── 1. SOURCE ─────────────────────────────────────────────────────────────
  const srcModel  = selectedModels?.source;
  const srcTech   = detectSourceTechType(sourceVariant ?? srcModel);
  const srcCapOverride = safeN(genParamOverrides?.capacity_kw);
  const srcCapModel = modelCapacityKw(srcModel);
  const srcCapOverrideLooksStale =
    srcCapOverride != null
    && srcCapModel != null
    && srcCapModel >= 5000
    && srcCapOverride <= 1000;
  const srcCap    = (srcCapOverrideLooksStale ? null : srcCapOverride) ?? srcCapModel ?? hintedElzCap ?? null;
  const srcEff    = safeN(genParamOverrides?.efficiency_pct) ?? modelEfficiencyPct(srcModel) ?? null;

  const profile = resolveSourceProfile({
    customProfile,
    sourceVariant,
    sourceModel: srcModel,
    capacityKw: srcCap,
    tEndS: safeN(sim.t_end_s) ?? 3600,
    dtS: safeN(sim.dt_s) ?? 60,
  });
  const srcCapFromProfile = profile?.length ? Math.max(...profile.map((pt) => safeN(pt.power_kw) ?? 0)) : null;

  // ── 2. ELECTROLYZER ───────────────────────────────────────────────────────
  const elzModel  = selectedModels?.electrolyzer;
  const elzTech   = detectElzTechType(elzModel);
  const elzCapOverride = safeN(elzParamOverrides?.capacity_kw);
  const elzCapOverrideLooksStale =
    elzCapOverride != null
    && srcCap != null
    && srcCap >= 5000
    && elzCapOverride <= 1000;
  // Detect if model capacity is small relative to source (e.g., 3 MW model with 300 MW source)
  // In this case, skip the model default and use source capacity instead
  const elzCapModel = modelCapacityKw(elzModel);
  const elzCapModelLooksUndersized =
    elzCapModel != null
    && srcCap != null
    && srcCap >= 5000
    && elzCapModel <= 5000;
  const elzCap    = (elzCapOverrideLooksStale ? null : elzCapOverride)
                 ?? (elzCapModelLooksUndersized ? null : elzCapModel)
                 ?? srcCap
                 ?? safeN(elz.grid_power_kw)
                 ?? hintedElzCap
                 ?? null;

  // DEBUG: Log scaling decisions
  if (typeof window !== 'undefined' && window.__H2_DEBUG) {
    console.error('[h2SimPayload-DEBUG]', {
      srcCapModel,
      srcCap,
      elzCapModel,
      elzCapModelLooksUndersized,
      elzCapOverride,
      elzCapFinal: elzCap,
      logic: `model=${elzCapModel} undersized=${elzCapModelLooksUndersized} → use_source=${srcCap}?`
    });
  }
  const elzEff    = safeN(elzParamOverrides?.efficiency_pct)
                 ?? modelEfficiencyPct(elzModel)
                 ?? safeN(elz?.efficiency_pct)
                 ?? 70;
  const elzMinLd  = safeN(elzParamOverrides?.min_load_pct)
                 ?? modelMinLoadPct(elzModel)
                 ?? safeN(elz?.min_load_pct)
                 ?? 0;

  // ── 3. COMPRESSOR ─────────────────────────────────────────────────────────
  const compModel = selectedModels?.compressor;
  const compType  = detectCompressorType(compModel);
  const compEff   = safeN(sto.compressor_efficiency) ?? safeN(compModel?.efficiency_pct != null ? compModel.efficiency_pct / 100 : null) ?? 0.78;
  const targetBar = safeN(sto.max_tank_pressure_bar)  ?? 350;

  // ── 4. STORAGE ────────────────────────────────────────────────────────────
  const stoModel  = selectedModels?.storage;
  const stoType   = detectStorageTechType(stoModel);

  // ── 5. FUEL CELL ──────────────────────────────────────────────────────────
  const fcModel   = selectedModels?.fuel_cell;
  const fcType    = detectFcTechType(fcModel);
  const fcCapModel = modelCapacityKw(fcModel);
  const fcEff     = modelEfficiencyPct(fcModel) ?? safeN(fc?.nominal_efficiency_pct) ?? 58;
  const fcEffFrac = Math.max((fcEff ?? 58) / 100, 0.1);

  // ── FC capacity derived from H₂ production potential (physics-based, not arbitrary) ──
  // H₂ production at max ELZ: [Nm³/h] = elzCap_kw * elz_efficiency / 3.542 kWh/Nm³
  // FC power from that H₂: = H₂_nm3h * 3.542 kWh/Nm³ * fc_efficiency
  // Simplified: FC_capacity = elzCap * (elz_eff / 100) * (fc_eff / 100)
  const fcCapDerivedFromH2 = elzCap != null ? Math.round(elzCap * (elzEff / 100) * fcEffFrac) : null;

  // FC capacity: use derived H₂-based capacity; fallback to model if very large; never use 300 kW floor
  const fcRatedKw = fcCapDerivedFromH2 ?? fcCapModel ?? (elzCap != null ? 0.35 * elzCap : null) ?? 0;

  // H₂ flow rate: physics-based = rated_power / (3.542 kWh_per_Nm3 * fc_efficiency)
  //   fc_power_kw = h2_consumed_nm3h * 3.542 * fc_efficiency
  //   h2_consumed_nm3h = fc_power_kw / (3.542 * fc_efficiency)
  const fcFlowDefaultNm3h = fcRatedKw > 0 ? Math.ceil(fcRatedKw / (3.542 * fcEffFrac)) : 40;
  const fcFlowInput = safeN(fc.h2_flow_rate_nm3h);
  // Stale detection: if the stored flow rate can only produce < 10% of rated power, it's from an
  // old session with a tiny FC — discard it and use the physics-correct value instead.
  const fcFlowMaxPowerKw = fcFlowInput != null ? fcFlowInput * 3.542 * fcEffFrac : null;
  const fcFlowLooksStale = fcFlowMaxPowerKw != null && fcRatedKw > 0 && fcFlowMaxPowerKw < 0.1 * fcRatedKw;
  const fcFlowNm3h = (fcFlowInput != null && fcFlowInput > 0 && !fcFlowLooksStale)
    ? fcFlowInput
    : fcFlowDefaultNm3h;

  // ── Assemble ──────────────────────────────────────────────────────────────
  return {
    schema_version: '2.0',

    simulation: {
      t_end_s: safeN(sim.t_end_s) ?? 3600,
      dt_s:    safeN(sim.dt_s)    ?? 60,
    },

    source: {
      tech_type:      srcTech,
      name:           srcModel?.name ?? null,
      capacity_kw:    srcCap ?? srcCapFromProfile,
      efficiency_pct: srcEff,       // null for renewables — simulation ignores
      profile,                       // [{time_s, power_kw}] — full input waveform
    },

    electrolyzer: {
      tech_type:                  elzTech,
      name:                       elzModel?.name ?? null,
      capacity_kw:                elzCap,
      nominal_efficiency_pct_hhv: elzEff,   // H₂ HHV basis
      min_load_pct:               elzMinLd,
      max_load_pct:               100,
      operating_temperature_c:    safeN(elz.temperature_c)        ?? 80,
      water_flow_rate_lpm:        safeN(elz.water_flow_rate_lpm)  ?? 90,
      h2_hhv_kwh_per_kg:          39.4,     // constant reference
    },

    compressor: {
      tech_type:                  compType,
      name:                       compModel?.name ?? null,
      isentropic_efficiency_frac: compEff,
      inlet_pressure_bar:         30,        // typical ELZ outlet to compressor
      target_pressure_bar:        targetBar,
    },

    storage: {
      tech_type:                  stoType,
      name:                       stoModel?.name ?? null,
      max_pressure_bar:           targetBar,
      min_pressure_bar:           20,
      initial_soc_pct:            20,
      round_trip_efficiency_pct:  safeN(stoModel?.efficiency_pct) ?? 99,
    },

    fuel_cell: {
      tech_type:               fcType,
      name:                    fcModel?.name ?? null,
      rated_power_kw:          fcRatedKw,
      nominal_efficiency_pct:  fcEff,
      min_load_pct:            modelMinLoadPct(fcModel) ?? safeN(fc?.min_load_pct) ?? 0,
      h2_flow_rate_nm3h:       fcFlowNm3h,
      operating_pressure_bar:  safeN(fc.oxidant_pressure_bar) ?? 2.5,
      cooling_capacity_kw:     safeN(fc.cooling_capacity_kw)  ?? 35,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Result normaliser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise the simulation API response into a flat object understood by all
 * existing chart components.  The service may return either the nested v2 schema
 * OR the legacy flat schema — this function handles both.
 *
 * Flat aliases produced:
 *   electrolyzer_power_kw       ← electrolyzer.power_in_kw  (v2)
 *   h2_production_nm3h          ← electrolyzer.h2_production_nm3h  (v2)
 *   h2_production_kg_h          ← electrolyzer.h2_production_kg_h  (v2)
 *   elz_efficiency_pct          ← electrolyzer.efficiency_pct  (v2)
 *   compressor_power_kw         ← compressor.power_consumed_kw  (v2)
 *   tank_pressure_bar           ← storage.pressure_bar  (v2)
 *   tank_soc_pct                ← storage.soc_pct  (v2)
 *   fc_power_output_kw          ← fuel_cell.power_output_kw  (v2)
 *   fc_terminal_voltage_v       ← fuel_cell.terminal_voltage_v  (v2)
 *   fc_current_density_acm2     ← fuel_cell.current_density_acm2  (v2)
 *
 * @param {object} raw  – raw API result
 * @returns {object}    – normalised result with flat + nested keys
 */
export function normalizeSimResult(raw) {
  if (!raw) return raw;

  const pick = (nested, flat) => nested ?? raw[flat] ?? null;
  const avg = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const nums = arr.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    if (!nums.length) return null;
    return nums.reduce((s, v) => s + v, 0) / nums.length;
  };

  const fcPower = pick(raw.fuel_cell?.power_output_kw, 'fc_power_output_kw');
  const srcPower =
    pick(raw.source?.power_output_kw, 'source_power_kw')
    ?? pick(raw.electrolyzer?.power_in_kw, 'electrolyzer_power_kw')
    ?? [];
  const elzPower = pick(raw.electrolyzer?.power_in_kw, 'electrolyzer_power_kw') ?? [];
  const h2ProdNm3h = pick(raw.electrolyzer?.h2_production_nm3h, 'h2_production_nm3h');
  const h2ConsNm3h = pick(raw.fuel_cell?.h2_consumed_nm3h, 'h2_consumption_nm3h');
  const tankPressure = pick(raw.storage?.pressure_bar, 'tank_pressure_bar');
  const dt_s = Number(raw.dt_s) || (Array.isArray(raw.time_s) && raw.time_s.length > 1 ? Number(raw.time_s[1]) - Number(raw.time_s[0]) : 0) || 60;
  const dt_h = dt_s / 3600;
  const kpi = raw.kpi ?? {};

  const sumEnergyKwh = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const nums = arr.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    if (!nums.length) return null;
    return nums.reduce((s, v) => s + v * dt_h, 0);
  };
  const maxVal = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const nums = arr.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    if (!nums.length) return null;
    return Math.max(...nums);
  };

  const sourceEnergyKwh = sumEnergyKwh(srcPower);
  const elzEnergyKwh = sumEnergyKwh(elzPower);
  const fcEnergyKwh = sumEnergyKwh(fcPower);
  const h2ProdTotalNm3 = sumEnergyKwh(h2ProdNm3h);
  const h2ConsTotalNm3 = sumEnergyKwh(h2ConsNm3h);
  const avgSourceKw = avg(srcPower);
  const avgElzKw = avg(elzPower);
  const avgFcKw = avg(fcPower);
  const peakSourceKw = maxVal(srcPower);
  const peakElzKw = maxVal(elzPower);
  const peakFcKw = maxVal(fcPower);
  const sourceCapacityKw = Number(raw?.source?.capacity_kw);
  const fcRatedKw = Number(raw?.fuel_cell?.rated_power_kw);
  const capFactorPctDerived = sourceCapacityKw > 0 && avgSourceKw != null
    ? (avgSourceKw / sourceCapacityKw) * 100
    : null;
  const fcCapacityFactorPct = fcRatedKw > 0 && avgFcKw != null
    ? (avgFcKw / fcRatedKw) * 100
    : null;

  return {
    // ── preserve everything as-is ──
    ...raw,

    // ── time axis ──
    time_s: raw.time_s ?? [],

    // ── flat aliases for backward compat with existing chart components ──
    electrolyzer_power_kw:   pick(raw.electrolyzer?.power_in_kw,          'electrolyzer_power_kw'),
    h2_production_nm3h:      pick(raw.electrolyzer?.h2_production_nm3h,   'h2_production_nm3h'),
    h2_production_kg_h:      pick(raw.electrolyzer?.h2_production_kg_h,   'h2_production_kg_h'),
    elz_efficiency_pct:      pick(raw.electrolyzer?.efficiency_pct,       'elz_efficiency_pct'),

    compressor_power_kw:     pick(raw.compressor?.power_consumed_kw,      'compressor_power_kw'),
    source_power_kw:
      pick(raw.source?.power_output_kw, 'source_power_kw')
      ?? pick(raw.electrolyzer?.power_in_kw, 'electrolyzer_power_kw')
      ?? [],

    tank_pressure_bar:       pick(raw.storage?.pressure_bar,             'tank_pressure_bar'),
    tank_soc_pct:            pick(raw.storage?.soc_pct,                  'tank_soc_pct'),
    h2_mass_kg:              pick(raw.storage?.h2_mass_kg,               'h2_mass_kg'),

    fc_power_output_kw:      pick(raw.fuel_cell?.power_output_kw,        'fc_power_output_kw'),
    h2_consumption_nm3h:     pick(raw.fuel_cell?.h2_consumed_nm3h,       'h2_consumption_nm3h'),
    fc_terminal_voltage_v:   pick(raw.fuel_cell?.terminal_voltage_v,     'fc_terminal_voltage_v'),
    fc_current_density_acm2: pick(raw.fuel_cell?.current_density_acm2,   'fc_current_density_acm2'),
    fc_efficiency_pct:       pick(raw.fuel_cell?.efficiency_pct,         'fc_efficiency_pct'),

    // ── KPI aliases for legacy UI cards/nodes ──
    kpi: {
      ...kpi,
      // Legacy keys used by flow-diagram cards
      avg_fc_power_kw:
        kpi.avg_fc_power_kw
        ?? avg(fcPower)
        ?? 0,
      avg_h2_production_nm3h:
        kpi.avg_h2_production_nm3h
        ?? avg(h2ProdNm3h)
        ?? 0,
      peak_tank_pressure_bar:
        kpi.peak_tank_pressure_bar
        ?? (Array.isArray(tankPressure) && tankPressure.length ? Math.max(...tankPressure.map((v) => Number(v) || 0)) : 0),
      system_efficiency_pct:
        kpi.system_efficiency_pct
        ?? kpi.overall_system_efficiency_pct
        ?? avg(raw.system_efficiency_pct)
        ?? 0,

      // Statistical and reporting KPIs for dashboard analytics
      total_source_energy_kwh:
        kpi.total_source_energy_kwh
        ?? sourceEnergyKwh
        ?? 0,
      total_elz_energy_kwh:
        kpi.total_elz_energy_kwh
        ?? kpi.total_energy_consumed_kwh
        ?? elzEnergyKwh
        ?? 0,
      total_fc_energy_kwh:
        kpi.total_fc_energy_kwh
        ?? fcEnergyKwh
        ?? 0,
      total_h2_produced_nm3:
        kpi.total_h2_produced_nm3
        ?? h2ProdTotalNm3
        ?? 0,
      total_h2_consumed_nm3:
        kpi.total_h2_consumed_nm3
        ?? h2ConsTotalNm3
        ?? 0,
      avg_source_power_kw:
        kpi.avg_source_power_kw
        ?? avgSourceKw
        ?? 0,
      avg_elz_power_kw:
        kpi.avg_elz_power_kw
        ?? avgElzKw
        ?? 0,
      peak_source_power_kw:
        kpi.peak_source_power_kw
        ?? peakSourceKw
        ?? 0,
      peak_elz_power_kw:
        kpi.peak_elz_power_kw
        ?? peakElzKw
        ?? 0,
      peak_fc_power_kw:
        kpi.peak_fc_power_kw
        ?? peakFcKw
        ?? 0,
      capacity_factor_pct:
        kpi.capacity_factor_pct
        ?? capFactorPctDerived
        ?? 0,
      fuel_cell_capacity_factor_pct:
        kpi.fuel_cell_capacity_factor_pct
        ?? fcCapacityFactorPct
        ?? 0,
    },
  };
}

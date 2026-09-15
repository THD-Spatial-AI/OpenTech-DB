/**
 * h2TechModels.js
 * ───────────────────────────────────────────────────────────────────────────
 * Maps hydrogen-plant component slots to opentech-db API queries.
 * Falls back gracefully to hardcoded catalog when the API is offline.
 *
 * Usage:
 *   import { fetchH2Models, H2_SLOTS, getBestModel } from './h2TechModels';
 *   const genModels = await fetchH2Models('source');
 */

import { fetchCategoryPickerModels, fetchTechInstances, isTechApiAvailable, instanceToParams } from './techDatabaseApi';
import { extractDefinedSourceProfile } from './h2SourceProfiles.js';

// ─────────────────────────────────────────────────────────────────────────────
// Component slot definitions
// Each slot maps to an opentech-db category + optional keyword filter
// ─────────────────────────────────────────────────────────────────────────────
export const H2_SLOTS = {
  source: {
    label: 'Power Source',
    category: 'generation',
    keywords: null,   // show all generation techs
    // NOTE: source slot does NOT override grid_power_kw (ELZ set-point) because
    // plant rated capacity ≠ electrolyzer AC input — these are configured independently.
    paramMap: {},
  },
  electrolyzer: {
    label: 'Electrolyzer',
    category: 'conversion',
    keywords: ['electrolyz', 'pem', 'alkaline', 'aec', 'soec', 'hydrogen production'],
    paramMap: {
      // efficiency_percent (0-100) → we expose as an info label, not a direct slider
    },
  },
  compressor: {
    label: 'H₂ Compressor',
    category: 'conversion',
    keywords: ['compress', 'pump', 'h2 compress', 'hydrogen compress'],
    paramMap: {
      compressor_efficiency: (inst) => {
        const pct = inst?.efficiency_percent;
        if (pct != null) return parseFloat((Number(pct) / 100).toFixed(3));
        const frac = inst?.electrical_efficiency ?? inst?.efficiency;
        if (frac != null) return parseFloat((Number(frac) > 1 ? Number(frac) / 100 : Number(frac)).toFixed(3));
        return null;
      },
    },
  },
  storage: {
    label: 'H₂ Storage Tank',
    category: 'storage',
    keywords: ['hydrogen', 'h2', 'compressed hydrogen', 'tank', 'pressure vessel'],
    paramMap: {},
  },
  fuel_cell: {
    label: 'Fuel Cell',
    category: 'conversion',
    keywords: ['fuel cell', 'fuelcell', 'pemfc', 'sofc', 'mcfc', 'pafc', 'h2 power'],
    paramMap: {
      // h2_flow_rate_nm3h, oxidant_pressure_bar are process-specific not in DB
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Hardcoded fallback catalog (used when API is offline)
// ─────────────────────────────────────────────────────────────────────────────
export const FALLBACK_CATALOG = {
  source: [
    { id: 'solar_pv',        name: 'Solar PV (Utility)',       category: 'generation', icon: '☀️', color: '#f59e0b', efficiency_pct: null,  capacity_kw: 10000, capex_usd_per_kw: 900,  lifetime_yr: 25, description: 'Large-scale ground-mounted photovoltaic', lifecycle: 'commercial' },
    { id: 'wind_onshore',    name: 'Wind Onshore',             category: 'generation', icon: '💨', color: '#60a5fa', efficiency_pct: null,  capacity_kw: 3000,  capex_usd_per_kw: 1200, lifetime_yr: 25, description: 'Onshore wind turbine (3 MW class)', lifecycle: 'commercial' },
    { id: 'wind_offshore',   name: 'Wind Offshore',            category: 'generation', icon: '🌊', color: '#3b82f6', efficiency_pct: null,  capacity_kw: 8000,  capex_usd_per_kw: 2900, lifetime_yr: 25, description: 'Offshore wind turbine (8 MW class)', lifecycle: 'commercial' },
    { id: 'natural_gas_ccgt',name: 'Natural Gas (CCGT)',        category: 'generation', icon: '🔥', color: '#f97316', efficiency_pct: 58,    capacity_kw: 400000,capex_usd_per_kw: 900,  lifetime_yr: 30, description: 'Combined-cycle gas turbine', lifecycle: 'commercial' },
    { id: 'coal_supercrit',  name: 'Coal (Supercritical)',      category: 'generation', icon: '⚫', color: '#374151', efficiency_pct: 43,    capacity_kw: 600000,capex_usd_per_kw: 2000, lifetime_yr: 40, description: 'Supercritical coal steam cycle', lifecycle: 'commercial' },
    { id: 'nuclear_pwr',     name: 'Nuclear (PWR)',             category: 'generation', icon: '⚛️', color: '#8b5cf6', efficiency_pct: 33,    capacity_kw: 1000000,capex_usd_per_kw:6500, lifetime_yr: 60, description: 'Pressurised water reactor', lifecycle: 'commercial' },
    { id: 'biomass_chp',     name: 'Biomass CHP',              category: 'generation', icon: '🌿', color: '#22c55e', efficiency_pct: 35,    capacity_kw: 5000,  capex_usd_per_kw: 2500, lifetime_yr: 25, description: 'Combined heat & power from biomass', lifecycle: 'commercial' },
    { id: 'hydro_ror',       name: 'Hydro (Run-of-River)',      category: 'generation', icon: '💧', color: '#06b6d4', efficiency_pct: 90,    capacity_kw: 5000,  capex_usd_per_kw: 2200, lifetime_yr: 60, description: 'Run-of-river hydropower', lifecycle: 'commercial' },
    { id: 'geothermal',      name: 'Geothermal',               category: 'generation', icon: '🌋', color: '#dc2626', efficiency_pct: 12,    capacity_kw: 50000, capex_usd_per_kw: 4000, lifetime_yr: 30, description: 'Single-flash geothermal plant', lifecycle: 'commercial' },
  ],
  electrolyzer: [
    { id: 'pem_elz',         name: 'PEM Electrolyzer',         category: 'conversion', icon: '⚗️', color: '#6366f1', efficiency_pct: 70, capacity_kw: 1000,  capex_usd_per_kw: 700,  lifetime_yr: 20, description: 'Proton-exchange membrane electrolyzer (state-of-art)', lifecycle: 'commercial' },
    { id: 'alkaline_elz',    name: 'Alkaline Electrolyzer',    category: 'conversion', icon: '⚗️', color: '#4f46e5', efficiency_pct: 65, capacity_kw: 2000,  capex_usd_per_kw: 500,  lifetime_yr: 25, description: 'Mature alkaline water electrolysis', lifecycle: 'commercial' },
    { id: 'soec_elz',        name: 'SOEC (High-Temp)',          category: 'conversion', icon: '🔬', color: '#7c3aed', efficiency_pct: 80, capacity_kw: 500,   capex_usd_per_kw: 1500, lifetime_yr: 15, description: 'Solid-oxide electrolyzer cell (1000°C steam)', lifecycle: 'demonstration' },
    { id: 'anion_elz',       name: 'Anion Exchange Membrane',  category: 'conversion', icon: '⚗️', color: '#8b5cf6', efficiency_pct: 68, capacity_kw: 200,   capex_usd_per_kw: 600,  lifetime_yr: 15, description: 'AEM electrolyzer — next-gen low-cost', lifecycle: 'demonstration' },
  ],
  compressor: [
    { id: 'recip_comp_350',  name: 'Reciprocating (350 bar)',   category: 'conversion', icon: '🔩', color: '#d97706', efficiency_pct: 80, capacity_kw: 100,  capex_usd_per_kw: 400,  lifetime_yr: 20, description: 'Multi-stage reciprocating compressor to 350 bar', lifecycle: 'commercial' },
    { id: 'recip_comp_700',  name: 'Reciprocating (700 bar)',   category: 'conversion', icon: '🔩', color: '#b45309', efficiency_pct: 75, capacity_kw: 150,  capex_usd_per_kw: 600,  lifetime_yr: 20, description: 'High-pressure reciprocating compressor to 700 bar', lifecycle: 'commercial' },
    { id: 'ionic_comp',      name: 'Ionic Liquid Compressor',   category: 'conversion', icon: '💧', color: '#92400e', efficiency_pct: 78, capacity_kw: 50,   capex_usd_per_kw: 900,  lifetime_yr: 15, description: 'Near-isothermal ionic liquid compressor', lifecycle: 'demonstration' },
    { id: 'linear_comp',     name: 'Linear Compressor',         category: 'conversion', icon: '🔩', color: '#78350f', efficiency_pct: 82, capacity_kw: 20,   capex_usd_per_kw: 800,  lifetime_yr: 15, description: 'Low-vibration linear compressor for small scale', lifecycle: 'demonstration' },
  ],
  storage: [
    { id: 'ch2_tank_350',    name: 'Compressed H₂ (350 bar)',   category: 'storage', icon: '🛢️', color: '#f59e0b', efficiency_pct: 99, capacity_kw: 5000,  capex_usd_per_kw: 15,   lifetime_yr: 30, description: 'Type-IV composite pressure vessel at 350 bar', lifecycle: 'commercial' },
    { id: 'ch2_tank_700',    name: 'Compressed H₂ (700 bar)',   category: 'storage', icon: '🛢️', color: '#d97706', efficiency_pct: 99, capacity_kw: 2000,  capex_usd_per_kw: 30,   lifetime_yr: 25, description: 'Type-IV pressure vessel at 700 bar for mobility', lifecycle: 'commercial' },
    { id: 'lh2_tank',        name: 'Liquid H₂ Tank',            category: 'storage', icon: '🧊', color: '#60a5fa', efficiency_pct: 85, capacity_kw: 50000, capex_usd_per_kw: 8,    lifetime_yr: 30, description: 'Cryogenic liquid hydrogen storage (–253 °C)', lifecycle: 'commercial' },
    { id: 'mh_storage',      name: 'Metal Hydride Storage',     category: 'storage', icon: '⚙️', color: '#10b981', efficiency_pct: 97, capacity_kw: 500,   capex_usd_per_kw: 200,  lifetime_yr: 20, description: 'Solid-state metal hydride H₂ storage', lifecycle: 'demonstration' },
    { id: 'cavern_storage',  name: 'Underground Cavern',        category: 'storage', icon: '🪨', color: '#6b7280', efficiency_pct: 98, capacity_kw: 500000,capex_usd_per_kw: 1,    lifetime_yr: 50, description: 'Salt cavern large-scale seasonal H₂ storage', lifecycle: 'commercial' },
  ],
  fuel_cell: [
    { id: 'pemfc',           name: 'PEM Fuel Cell',             category: 'conversion', icon: '⚡', color: '#8b5cf6', efficiency_pct: 58, capacity_kw: 1000,  capex_usd_per_kw: 800,  lifetime_yr: 15, description: 'Proton-exchange membrane fuel cell (stationary)', lifecycle: 'commercial' },
    { id: 'sofc',            name: 'Solid Oxide FC (SOFC)',      category: 'conversion', icon: '🔥', color: '#a78bfa', efficiency_pct: 65, capacity_kw: 200,   capex_usd_per_kw: 2000, lifetime_yr: 20, description: 'High-temperature solid oxide fuel cell + CHP', lifecycle: 'commercial' },
    { id: 'mcfc',            name: 'Molten Carbonate FC',       category: 'conversion', icon: '🔥', color: '#c4b5fd', efficiency_pct: 60, capacity_kw: 1400,  capex_usd_per_kw: 2500, lifetime_yr: 20, description: 'MCFC for utility-scale CHP applications', lifecycle: 'commercial' },
    { id: 'pafc',            name: 'Phosphoric Acid FC',        category: 'conversion', icon: '⚡', color: '#7c3aed', efficiency_pct: 42, capacity_kw: 400,   capex_usd_per_kw: 4000, lifetime_yr: 20, description: 'PAFC — robust, widely deployed', lifecycle: 'commercial' },
    { id: 'alkaline_fc',     name: 'Alkaline FC',               category: 'conversion', icon: '⚡', color: '#6d28d9', efficiency_pct: 55, capacity_kw: 100,   capex_usd_per_kw: 1000, lifetime_yr: 10, description: 'Alkaline fuel cell — low cost, pure H₂ required', lifecycle: 'commercial' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Scoring / "best model" selection
// Higher = better: prefer efficiency, then commercial lifecycle, penalise cost
// ─────────────────────────────────────────────────────────────────────────────
export function getBestModel(models) {
  if (!models?.length) return null;
  // Commercial lifecycle gets highest priority
  const scored = models.map((m) => {
    let score = 0;
    if (m.lifecycle === 'commercial') score += 100;
    if (m.lifecycle === 'projection') score += 50;
    score += (m.efficiency_pct ?? 50);
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].m;
}

// keyword filter helper
function matchesKeywords(model, keywords) {
  if (!keywords?.length) return true;
  const haystack = `${model.name} ${model.description || ''} ${model.id || ''}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

// Module-level cache  {slotKey → model[]}
const _cache = {};

/**
 * Fetch models for a given H2 component slot.
 * Tries the live opentech-db API first, falls back to FALLBACK_CATALOG.
 *
 * @param {'source'|'electrolyzer'|'compressor'|'storage'|'fuel_cell'} slotKey
 * @returns {Promise<Array>}
 */
export async function fetchH2Models(slotKey) {
  if (_cache[slotKey]) return _cache[slotKey];

  const slot = H2_SLOTS[slotKey];
  if (!slot) return FALLBACK_CATALOG[slotKey] ?? [];

  try {
    // Instance-enriched models (efficiency / capacity / capex flattened in).
    // Returns [] when the API is unreachable → we fall back below.
    const enriched = await fetchCategoryPickerModels(slot.category);
    const models = enriched
      .map((m) => ({
        ...m,
        icon: '',
        // source slot: surface a defined generation profile if the tech carries one
        profile: slotKey === 'source' ? extractDefinedSourceProfile(m) : null,
      }))
      .filter((m) => matchesKeywords(m, slot.keywords));

    // If no matches after filtering, use fallback catalog for this slot
    const result = models.length > 0 ? models : FALLBACK_CATALOG[slotKey] ?? [];
    _cache[slotKey] = result;
    return result;
  } catch {
    // Network/API error → use fallback
    const result = FALLBACK_CATALOG[slotKey] ?? [];
    _cache[slotKey] = result;
    return result;
  }
}

/**
 * Clear model cache (call after VITE_TECH_API_URL changes).
 */
export function clearH2ModelCache() {
  Object.keys(_cache).forEach((k) => delete _cache[k]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Year-based CAPEX/efficiency projections for synthetic fallback variants
// Based on IRENA/NREL cost-reduction trajectories per technology type
// ─────────────────────────────────────────────────────────────────────────────
const CAPEX_TRAJECTORIES = {
  // [ multiplier_2030, multiplier_2040 ]
  solar:      [0.65, 0.45],
  wind:       [0.80, 0.65],
  wind_off:   [0.78, 0.60],
  nuclear:    [0.95, 0.90],
  hydro:      [0.98, 0.95],
  geothermal: [0.92, 0.85],
  biomass:    [0.90, 0.82],
  coal:       [1.00, 1.00],
  gas:        [0.92, 0.88],
  electrolyz: [0.55, 0.35],
  fuel_cell:  [0.60, 0.40],
  default:    [0.85, 0.72],
};

function detectTrade(id, name) {
  const k = `${id} ${name}`.toLowerCase();
  if (/solar|pv/.test(k))           return 'solar';
  if (/offshore/.test(k))           return 'wind_off';
  if (/wind/.test(k))               return 'wind';
  if (/nuclear|pwr|bwr/.test(k))    return 'nuclear';
  if (/hydro|river/.test(k))        return 'hydro';
  if (/geotherm/.test(k))           return 'geothermal';
  if (/biomass|bio/.test(k))        return 'biomass';
  if (/coal|lignite/.test(k))       return 'coal';
  if (/gas|ccgt|methane/.test(k))   return 'gas';
  if (/electrolyz|pem|alkaline|soec|aec/.test(k)) return 'electrolyz';
  if (/fuel.cell|pemfc|sofc/.test(k)) return 'fuel_cell';
  return 'default';
}

function generateFallbackVariants(model) {
  const trade  = detectTrade(model.id ?? '', model.name ?? '');
  const traj   = CAPEX_TRAJECTORIES[trade] ?? CAPEX_TRAJECTORIES.default;
  const base   = model.capex_usd_per_kw;
  const baseEff = model.efficiency_pct;
  const baseLife = model.lifetime_yr;

  const mkVariant = (suffix, year, lifecycle, capexMult, effMult) => ({
    ...model,
    id:            `${model.id}_${suffix}`,
    name:          `${model.name} (${year})`,
    year,
    lifecycle,
    capex_usd_per_kw:  base   != null ? Math.round(base   * capexMult) : null,
    efficiency_pct:    baseEff != null ? Math.min(99, +(baseEff * effMult).toFixed(1)) : null,
    lifetime_yr:       baseLife,
    description:       `${model.description ?? model.name} — ${year} cost projection`,
  });

  return [
    { ...model, id: model.id + '_now', name: `${model.name} (Current)`, year: 2025,
      lifecycle: model.lifecycle ?? 'commercial', year: 2025 },
    mkVariant('2030', 2030, 'projection', traj[0], 1.0 + (1 - traj[0]) * 0.3),
    mkVariant('2040', 2040, 'projection', traj[1], 1.0 + (1 - traj[1]) * 0.5),
  ];
}

// Per-slot variants cache  { techId → variant[] }
const _variantCache = {};

/**
 * Fetch technology variants for a single selected model.
 * Tries the live opentech-db /instances endpoint first;
 * falls back to synthetic year-projection variants.
 *
 * @param {string} techId  – id of the selected model (e.g. 'solar_pv')
 * @param {Object} baseModel – the normalised model object (fallback source)
 * @returns {Promise<Array>}
 */
export async function fetchH2Variants(techId, baseModel) {
  if (!techId) return baseModel ? generateFallbackVariants(baseModel) : [];
  if (_variantCache[techId]) return _variantCache[techId];

  try {
    const available = await isTechApiAvailable(2000);
    if (!available) throw new Error('API offline');

    const raw = await fetchTechInstances(techId, { limit: 20 });
    if (!raw?.length) throw new Error('no instances');

    const variants = raw.map((inst, i) => {
      // Use the canonical instanceToParams() parser for consistent field extraction
      const parsed = instanceToParams(inst) ?? {};
      // always use pre-parsed numeric values — instanceToParams handles {value} OEO wrappers
      const capKw  = parsed.constraints?.energy_cap_max           // already sanitised number
                  ?? (typeof inst.capacity_kw === 'number' ? inst.capacity_kw : null)
                  ?? null;
      const effPct = parsed.constraints?.energy_eff != null
                  ? +(parsed.constraints.energy_eff * 100).toFixed(2)
                  : (typeof inst.efficiency_percent === 'number' ? inst.efficiency_percent : null);

      // Build a human-readable name: prefer instance_name/label, then
      // compose from lifecycle + capacity + year if none present
      let name = parsed.label ?? inst.instance_name ?? inst.name ?? inst.label ?? inst.title ?? null;
      if (!name || name === parsed.id) {
        const stage  = parsed.life_cycle_stage ?? inst.life_cycle_stage ?? 'commercial';
        const yr     = inst.year ?? inst.reference_year ?? null;
        const mwStr  = capKw != null ? ` ${(capKw / 1000).toFixed(0)} MW` : '';
        name = `${stage.charAt(0).toUpperCase() + stage.slice(1)}${mwStr}${yr ? ` (${yr})` : ''}`;
      }

      return {
        id:               parsed.id ?? inst.instance_id ?? `${techId}_v${i}`,
        name,
        year:             inst.year ?? inst.reference_year ?? null,
        lifecycle:        parsed.life_cycle_stage ?? 'commercial',
        capacity_kw:      capKw,
        efficiency_pct:   effPct,
        capex_usd_per_kw: parsed.monetary?.energy_cap ?? inst.capex_usd_per_kw ?? null,
        lifetime_yr:      parsed.constraints?.lifetime ?? inst.lifetime_years ?? null,
        opex_fixed:       parsed.monetary?.om_annual ?? inst.opex_fixed_usd_per_kw_year ?? null,
        opex_var:         parsed.monetary?.om_prod   ?? inst.opex_variable_usd_per_kwh ?? null,
        ramp_rate_frac_hr: parsed.constraints?.energy_ramping ?? null,
        description:      inst.description ?? null,
        profile:          baseModel?.category === 'generation' ? extractDefinedSourceProfile(inst) : null,
        // raw DB constraint + monetary objects for the constraints editor
        _constraints:     parsed.constraints ?? {},
        _monetary:        parsed.monetary    ?? {},
      };
    });

    _variantCache[techId] = variants;
    return variants;
  } catch {
    const variants = baseModel ? generateFallbackVariants(baseModel) : [];
    _variantCache[techId] = variants;
    return variants;
  }
}

/** Clear variant cache (e.g. after model change or API URL update) */
export function clearH2VariantCache() {
  Object.keys(_variantCache).forEach((k) => delete _variantCache[k]);
}

/**
 * Apply a selected model's parameters to the elz/sto/fc state objects.
 * Returns the partial patch object for setState merging.
 *
 * @param {string} slotKey
 * @param {Object} model
 * @returns {Object|null}
 */
export function applyModelParams(slotKey, model) {
  if (!model) return null;
  const slot = H2_SLOTS[slotKey];
  if (!slot?.paramMap) return null;

  const patch = {};
  for (const [stateKey, extractFn] of Object.entries(slot.paramMap)) {
    // The flattened picker model exposes efficiency_percent / capacity_kw etc.
    // at the top level; _raw (calliope tech) does not, so read the model first.
    const val = extractFn(model);
    if (val != null) patch[stateKey] = val;
  }
  return Object.keys(patch).length ? patch : null;
}

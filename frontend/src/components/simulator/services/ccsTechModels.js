/**
 * ccsTechModels.js
 * ───────────────────────────────────────────────────────────────────────────
 * Maps carbon-capture component slots to opentech-db API queries.
 * Falls back gracefully to hardcoded catalog when the API is offline.
 *
 * Usage:
 *   import { fetchCCSModels, CCS_SLOTS, getBestModel } from './ccsTechModels';
 *   const sources = await fetchCCSModels('source');
 */

import { fetchCategoryPickerModels, fetchTechInstances, isTechApiAvailable } from './techDatabaseApi';

// ─────────────────────────────────────────────────────────────────────────────
// Component slot definitions
// Each slot maps to an opentech-db category + optional keyword filter
// ─────────────────────────────────────────────────────────────────────────────
export const CCS_SLOTS = {
  source: {
    label: 'Flue Gas Source',
    category: 'generation',
    keywords: ['coal', 'gas', 'cement', 'steel', 'industrial', 'power plant'],
    paramMap: {},
  },
  absorber: {
    label: 'CO₂ Absorber',
    category: 'conversion',
    keywords: ['absorber', 'absorption', 'amine', 'mea', 'carbon capture', 'co2 capture'],
    paramMap: {
      capture_rate_pct: (inst) => inst?.efficiency_percent ?? 90,
      energy_requirement_gj_tco2: (inst) => inst?.energy_requirement ?? 3.5,
    },
  },
  stripper: {
    label: 'Stripper/Regenerator',
    category: 'conversion',
    keywords: ['stripper', 'regenerator', 'desorber', 'reboiler', 'solvent regeneration'],
    paramMap: {
      thermal_efficiency_pct: (inst) => {
        const pct = inst?.efficiency_percent;
        if (pct != null) return parseFloat(Number(pct).toFixed(1));
        return 85;
      },
    },
  },
  compressor: {
    label: 'CO₂ Compressor',
    category: 'conversion',
    keywords: ['compress', 'co2 compress', 'carbon dioxide compress', 'pipeline pressure'],
    paramMap: {
      compressor_efficiency: (inst) => {
        const pct = inst?.efficiency_percent;
        if (pct != null) return parseFloat((Number(pct) / 100).toFixed(3));
        const frac = inst?.electrical_efficiency ?? inst?.efficiency;
        if (frac != null) return parseFloat((Number(frac) > 1 ? Number(frac) / 100 : Number(frac)).toFixed(3));
        return 0.82;
      },
    },
  },
  storage: {
    label: 'CO₂ Storage/Transport',
    category: 'storage',
    keywords: ['co2 storage', 'geological storage', 'saline aquifer', 'depleted reservoir', 'pipeline'],
    paramMap: {},
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Hardcoded fallback catalog (used when API is offline)
// ─────────────────────────────────────────────────────────────────────────────
export const FALLBACK_CATALOG = {
  source: [
    { id: 'coal_pc',         name: 'Coal Power Plant (PC)',       category: 'generation', icon: '⚫', color: '#374151', efficiency_pct: 38, capacity_kw: 500000, co2_emission_kg_kwh: 0.95, capex_usd_per_kw: 2200, lifetime_yr: 40, description: 'Pulverized coal power plant', lifecycle: 'commercial' },
    { id: 'coal_igcc',       name: 'Coal IGCC',                   category: 'generation', icon: '⚫', color: '#4b5563', efficiency_pct: 42, capacity_kw: 450000, co2_emission_kg_kwh: 0.85, capex_usd_per_kw: 3500, lifetime_yr: 35, description: 'Integrated gasification combined cycle', lifecycle: 'commercial' },
    { id: 'gas_ccgt',        name: 'Natural Gas CCGT',            category: 'generation', icon: '🔥', color: '#f97316', efficiency_pct: 58, capacity_kw: 400000, co2_emission_kg_kwh: 0.35, capex_usd_per_kw: 900,  lifetime_yr: 30, description: 'Combined-cycle gas turbine', lifecycle: 'commercial' },
    { id: 'cement_plant',    name: 'Cement Production',           category: 'generation', icon: '🏭', color: '#78716c', efficiency_pct: null, capacity_kw: 50000,  co2_emission_kg_kwh: 0.82, capex_usd_per_kw: 1800, lifetime_yr: 30, description: 'Cement kiln with high CO₂ emissions', lifecycle: 'commercial' },
    { id: 'steel_blast',     name: 'Steel Blast Furnace',         category: 'generation', icon: '⚙️', color: '#57534e', efficiency_pct: null, capacity_kw: 120000, co2_emission_kg_kwh: 1.85, capex_usd_per_kw: 2500, lifetime_yr: 25, description: 'Integrated steel mill', lifecycle: 'commercial' },
    { id: 'refinery',        name: 'Oil Refinery',                category: 'generation', icon: '🛢️', color: '#92400e', efficiency_pct: null, capacity_kw: 200000, co2_emission_kg_kwh: 0.45, capex_usd_per_kw: 3200, lifetime_yr: 35, description: 'Petroleum refinery complex', lifecycle: 'commercial' },
    { id: 'biomass_power',   name: 'Biomass Power Plant',         category: 'generation', icon: '🌿', color: '#22c55e', efficiency_pct: 32, capacity_kw: 30000,  co2_emission_kg_kwh: 0.05, capex_usd_per_kw: 2800, lifetime_yr: 25, description: 'Dedicated biomass combustion (BECCS candidate)', lifecycle: 'commercial' },
  ],
  absorber: [
    { id: 'mea_absorb',      name: 'MEA Absorption (30%)',        category: 'conversion', icon: '🧪', color: '#3b82f6', efficiency_pct: 90, capacity_tco2_yr: 1000000, energy_gj_tco2: 3.7, capex_usd_per_tco2yr: 60, lifetime_yr: 25, description: 'Monoethanolamine chemical absorption (industry standard)', lifecycle: 'commercial' },
    { id: 'advanced_amine',  name: 'Advanced Amine Blend',        category: 'conversion', icon: '🧪', color: '#2563eb', efficiency_pct: 92, capacity_tco2_yr: 1200000, energy_gj_tco2: 3.0, capex_usd_per_tco2yr: 75, lifetime_yr: 25, description: 'Next-gen amine formulation (lower energy)', lifecycle: 'commercial' },
    { id: 'khi_carbonate',   name: 'KHI Hot Carbonate',           category: 'conversion', icon: '🔬', color: '#1d4ed8', efficiency_pct: 85, capacity_tco2_yr: 800000,  energy_gj_tco2: 4.2, capex_usd_per_tco2yr: 50, lifetime_yr: 30, description: 'Potassium carbonate high-temp absorption', lifecycle: 'commercial' },
    { id: 'membrane',        name: 'Membrane Separation',         category: 'conversion', icon: '📜', color: '#7c3aed', efficiency_pct: 75, capacity_tco2_yr: 500000,  energy_gj_tco2: 2.5, capex_usd_per_tco2yr: 90, lifetime_yr: 15, description: 'Polymer membrane CO₂ separation', lifecycle: 'demonstration' },
    { id: 'calcium_loop',    name: 'Calcium Looping',             category: 'conversion', icon: '♻️', color: '#0891b2', efficiency_pct: 88, capacity_tco2_yr: 600000,  energy_gj_tco2: 3.3, capex_usd_per_tco2yr: 65, lifetime_yr: 20, description: 'High-temp CaO/CaCO₃ cycle', lifecycle: 'demonstration' },
  ],
  stripper: [
    { id: 'conv_stripper',   name: 'Conventional Stripper',       category: 'conversion', icon: '♨️', color: '#dc2626', efficiency_pct: 82, thermal_req_gj_tco2: 3.5, capex_usd_per_tco2yr: 25, lifetime_yr: 25, description: 'Standard reboiler-based stripper column', lifecycle: 'commercial' },
    { id: 'vapor_recomp',    name: 'Vapor Recompression Stripper',category: 'conversion', icon: '♨️', color: '#ea580c', efficiency_pct: 88, thermal_req_gj_tco2: 2.8, capex_usd_per_tco2yr: 35, lifetime_yr: 25, description: 'Energy-efficient with vapor recompression', lifecycle: 'commercial' },
    { id: 'multi_pressure',  name: 'Multi-Pressure Stripper',     category: 'conversion', icon: '♨️', color: '#f97316', efficiency_pct: 85, thermal_req_gj_tco2: 3.1, capex_usd_per_tco2yr: 30, lifetime_yr: 25, description: 'Staged pressure levels for efficiency', lifecycle: 'demonstration' },
    { id: 'flash_regen',     name: 'Flash Regeneration',          category: 'conversion', icon: '⚡', color: '#fb923c', efficiency_pct: 90, thermal_req_gj_tco2: 2.5, capex_usd_per_tco2yr: 40, lifetime_yr: 20, description: 'Rapid flash desorption (experimental)', lifecycle: 'demonstration' },
  ],
  compressor: [
    { id: 'multistage_110',  name: 'Multi-Stage (110 bar)',       category: 'conversion', icon: '🔩', color: '#d97706', efficiency_pct: 82, capacity_kw: 15000, target_pressure_bar: 110, capex_usd_per_kw: 450, lifetime_yr: 25, description: 'Pipeline transport pressure (110 bar)', lifecycle: 'commercial' },
    { id: 'multistage_150',  name: 'Multi-Stage (150 bar)',       category: 'conversion', icon: '🔩', color: '#b45309', efficiency_pct: 80, capacity_kw: 18000, target_pressure_bar: 150, capex_usd_per_kw: 600, lifetime_yr: 25, description: 'High-pressure for long-distance pipelines', lifecycle: 'commercial' },
    { id: 'supercrit_comp',  name: 'Supercritical CO₂ Compressor',category: 'conversion', icon: '⚙️', color: '#92400e', efficiency_pct: 85, capacity_kw: 12000, target_pressure_bar: 200, capex_usd_per_kw: 800, lifetime_yr: 20, description: 'For supercritical CO₂ injection (>73.8 bar)', lifecycle: 'commercial' },
    { id: 'isothermal_comp', name: 'Near-Isothermal Compressor',  category: 'conversion', icon: '💧', color: '#78350f', efficiency_pct: 88, capacity_kw: 10000, target_pressure_bar: 120, capex_usd_per_kw: 950, lifetime_yr: 20, description: 'Liquid-piston isothermal compression', lifecycle: 'demonstration' },
  ],
  storage: [
    { id: 'saline_aquifer',  name: 'Saline Aquifer (Onshore)',    category: 'storage', icon: '🪨', color: '#0891b2', efficiency_pct: 99, capacity_mtco2: 500, injection_rate_mtco2_yr: 5, capex_usd_per_tco2: 8,  lifetime_yr: 100, description: 'Deep saline formation storage (800-3000m depth)', lifecycle: 'commercial' },
    { id: 'saline_offshore', name: 'Saline Aquifer (Offshore)',   category: 'storage', icon: '🌊', color: '#06b6d4', efficiency_pct: 99, capacity_mtco2: 1000, injection_rate_mtco2_yr: 10, capex_usd_per_tco2: 12, lifetime_yr: 100, description: 'Offshore saline aquifer (Sleipner-style)', lifecycle: 'commercial' },
    { id: 'depleted_gas',    name: 'Depleted Gas Field',          category: 'storage', icon: '⛽', color: '#0284c7', efficiency_pct: 98, capacity_mtco2: 300, injection_rate_mtco2_yr: 3, capex_usd_per_tco2: 6,  lifetime_yr: 100, description: 'Re-use of depleted natural gas reservoir', lifecycle: 'commercial' },
    { id: 'depleted_oil',    name: 'Depleted Oil Field (EOR)',    category: 'storage', icon: '🛢️', color: '#0369a1', efficiency_pct: 95, capacity_mtco2: 200, injection_rate_mtco2_yr: 2, capex_usd_per_tco2: 4,  lifetime_yr: 50,  description: 'Enhanced oil recovery with CO₂ injection', lifecycle: 'commercial' },
    { id: 'basalt_mineral',  name: 'Basalt Mineralization',       category: 'storage', icon: '🪨', color: '#475569', efficiency_pct: 100, capacity_mtco2: 1000, injection_rate_mtco2_yr: 1, capex_usd_per_tco2: 15, lifetime_yr: 200, description: 'Permanent mineralization in basaltic rock (CarbFix)', lifecycle: 'demonstration' },
    { id: 'pipeline_transp', name: 'CO₂ Pipeline (Transport)',    category: 'storage', icon: '🚇', color: '#64748b', efficiency_pct: 99, capacity_mtco2: 10, transport_dist_km: 200, capex_usd_per_tco2: 10, lifetime_yr: 40,  description: 'Dedicated CO₂ transport pipeline', lifecycle: 'commercial' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Fetch models for a given slot
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchCCSModels(slotKey) {
  const slot = CCS_SLOTS[slotKey];
  if (!slot) {
    console.warn(`[ccsTechModels] Unknown slot: ${slotKey}`);
    return FALLBACK_CATALOG[slotKey] ?? [];
  }

  // Try fetching from opentech-db API — instance-enriched picker models
  // (efficiency / capacity / capex flattened in). Returns [] when unreachable.
  try {
    let techs = await fetchCategoryPickerModels(slot.category);

    // Filter by keywords if specified (name + description + slug)
    if (slot.keywords && slot.keywords.length > 0) {
      const keywordPattern = new RegExp(slot.keywords.join('|'), 'i');
      techs = techs.filter((t) => {
        const searchText = `${t.slug ?? ''} ${t.name ?? ''} ${t.description ?? ''}`;
        return keywordPattern.test(searchText);
      });
    }

    if (techs.length > 0) {
      console.log(`[ccsTechModels] Fetched ${techs.length} models for ${slotKey} from API`);
      return techs;
    }
  } catch (err) {
    console.warn(`[ccsTechModels] API fetch failed for ${slotKey}:`, err.message);
  }

  // Fallback to hardcoded catalog
  console.log(`[ccsTechModels] Using fallback catalog for ${slotKey}`);
  return FALLBACK_CATALOG[slotKey] ?? [];
}

/**
 * Get the "best" default model from a list (prioritizes commercial lifecycle, highest efficiency).
 */
export function getBestModel(models) {
  if (!models || models.length === 0) return null;

  // Prefer commercial over demonstration
  const commercial = models.filter((m) => m.lifecycle === 'commercial');
  const candidates = commercial.length > 0 ? commercial : models;

  // Sort by efficiency (descending)
  const sorted = [...candidates].sort((a, b) => {
    const effA = a.efficiency_pct ?? a.efficiency_percent ?? 0;
    const effB = b.efficiency_pct ?? b.efficiency_percent ?? 0;
    return effB - effA;
  });

  return sorted[0];
}

/**
 * Apply model parameters to the simulation config using the slot's paramMap.
 */
export function applyModelParams(slotKey, model, currentParams) {
  const slot = CCS_SLOTS[slotKey];
  if (!slot || !model) return currentParams;

  const updated = { ...currentParams };
  Object.entries(slot.paramMap).forEach(([paramKey, mapFn]) => {
    const val = mapFn(model);
    if (val != null) updated[paramKey] = val;
  });

  return updated;
}

/**
 * Fetch technology variants (instances) for a specific model ID.
 * Example: user selects "MEA Absorption", we fetch 30% MEA, 35% MEA, etc.
 */
export async function fetchCCSVariants(modelId) {
  try {
    if (await isTechApiAvailable()) {
      const variants = await fetchTechInstances(modelId);
      if (variants && variants.length > 0) {
        console.log(`[ccsTechModels] Fetched ${variants.length} variants for ${modelId}`);
        return variants;
      }
    }
  } catch (err) {
    console.warn(`[ccsTechModels] Failed to fetch variants for ${modelId}:`, err.message);
  }
  return [];
}

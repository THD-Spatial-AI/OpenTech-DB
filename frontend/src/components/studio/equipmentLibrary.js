/**
 * equipmentLibrary.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Client-side registry of equipment types for the Process builder (ADR-0004).
 *
 * Each entry declares:
 *   label            – human name shown in the palette / node
 *   icon             – react-icons/fi component
 *   category         – catalogue category to browse when composing a Technology
 *                      (generation | conversion | storage | null for sources/sinks)
 *   group            – palette grouping
 *   ports            – typed Ports [{ id, carrier, direction }]
 *
 * `equipment_type` is the stable key that (in Phase 3) selects the Modelica
 * Component model; here it drives the default Port set and the catalogue picker.
 */

import {
  FiZap, FiCpu, FiBox, FiDroplet, FiWind, FiDatabase,
  FiActivity, FiArrowRightCircle, FiArrowLeftCircle, FiThermometer,
} from 'react-icons/fi';

// ── Carrier → colour (aligned with the app palette) ──────────────────────────
export const CARRIER_COLORS = {
  electricity: '#4d4b9e', // primary indigo
  hydrogen:    '#6f7dd6', // electric-400
  water:       '#3b82f6',
  co2:         '#5b5d72', // secondary
  flue_gas:    '#943700', // tertiary
  steam:       '#b45309',
  heat:        '#c2410c',
  natural_gas: '#a16207',
  oxygen:      '#0ea5e9',
  default:     '#737686', // outline
};

export const carrierColor = (c) => CARRIER_COLORS[c] ?? CARRIER_COLORS.default;

// ── Equipment registry ───────────────────────────────────────────────────────
const p = (id, carrier, direction) => ({ id, carrier, direction });

export const EQUIPMENT_TYPES = {
  power_source: {
    label: 'Power Source', icon: FiZap, category: 'generation', group: 'Sources',
    ports: [p('power_out', 'electricity', 'out')],
  },
  water_source: {
    label: 'Water Supply', icon: FiDroplet, category: null, group: 'Sources',
    ports: [p('water_out', 'water', 'out')],
  },
  flue_gas_source: {
    label: 'Flue Gas Source', icon: FiWind, category: 'generation', group: 'Sources',
    ports: [p('flue_out', 'flue_gas', 'out')],
  },
  electrolyzer_pem: {
    label: 'Electrolyzer', icon: FiCpu, category: 'conversion', group: 'Conversion',
    ports: [p('power_in', 'electricity', 'in'), p('water_in', 'water', 'in'), p('h2_out', 'hydrogen', 'out')],
  },
  fuel_cell_pem: {
    label: 'Fuel Cell', icon: FiActivity, category: 'conversion', group: 'Conversion',
    ports: [p('h2_in', 'hydrogen', 'in'), p('power_out', 'electricity', 'out')],
  },
  compressor: {
    label: 'Compressor', icon: FiCpu, category: 'conversion', group: 'Conversion',
    ports: [p('h2_in', 'hydrogen', 'in'), p('power_in', 'electricity', 'in'), p('h2_out', 'hydrogen', 'out')],
  },
  co2_absorber_amine: {
    label: 'CO₂ Absorber', icon: FiDatabase, category: 'conversion', group: 'Conversion',
    ports: [p('flue_in', 'flue_gas', 'in'), p('co2_rich_out', 'co2', 'out')],
  },
  solvent_stripper: {
    label: 'Stripper', icon: FiThermometer, category: 'conversion', group: 'Conversion',
    ports: [p('co2_rich_in', 'co2', 'in'), p('heat_in', 'steam', 'in'), p('co2_pure_out', 'co2', 'out')],
  },
  co2_compressor: {
    label: 'CO₂ Compressor', icon: FiCpu, category: 'conversion', group: 'Conversion',
    ports: [p('co2_in', 'co2', 'in'), p('power_in', 'electricity', 'in'), p('co2_out', 'co2', 'out')],
  },
  h2_tank: {
    label: 'H₂ Storage', icon: FiBox, category: 'storage', group: 'Storage',
    ports: [p('h2_in', 'hydrogen', 'in'), p('h2_out', 'hydrogen', 'out')],
  },
  co2_geological_storage: {
    label: 'CO₂ Storage', icon: FiBox, category: 'storage', group: 'Storage',
    ports: [p('co2_in', 'co2', 'in')],
  },
  grid_sink: {
    label: 'Grid / Load', icon: FiArrowRightCircle, category: null, group: 'Sinks',
    ports: [p('power_in', 'electricity', 'in')],
  },
};

/** Fallback descriptor for an unknown equipment_type (e.g. from a future seed). */
export function equipmentDef(type) {
  return EQUIPMENT_TYPES[type] ?? {
    label: type, icon: FiBox, category: null, group: 'Other', ports: [],
  };
}

/** Palette entries grouped for the sidebar. */
export const PALETTE_GROUPS = ['Sources', 'Conversion', 'Storage', 'Sinks'].map((group) => ({
  group,
  items: Object.entries(EQUIPMENT_TYPES)
    .filter(([, def]) => def.group === group)
    .map(([type, def]) => ({ type, ...def })),
}));

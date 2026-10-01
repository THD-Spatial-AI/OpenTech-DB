/**
 * CCSConfigPanel.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-world CCS scenario selector + inline parameter editor.
 * Placed above the flow diagram so users can quickly pick a reference
 * installation (Sleipner, Boundary Dam, Quest, etc.) and tune values.
 *
 * Props:
 *   ccsModels          {Object}   – { source:[], absorber:[], ... }
 *   selectedCcsModels  {Object}   – { source, absorber, ... }
 *   onSelectCcsModel   {Function} – (slotKey, model) => void
 *   ccsSource          {Object}   – current source parameter overrides
 *   ccsAbsorber        {Object}
 *   ccsStripper        {Object}
 *   ccsCompressor      {Object}
 *   ccsStorage         {Object}
 *   onSourceChange     {Function}
 *   onAbsorberChange   {Function}
 *   onStripperChange   {Function}
 *   onCompressorChange {Function}
 *   onStorageChange    {Function}
 *   simState           {string}
 */

import React, { useState } from "react";
import {
  FiZap, FiDroplet, FiWind, FiBox, FiDatabase,
  FiChevronDown, FiChevronUp, FiInfo, FiRefreshCw,
} from "react-icons/fi";

// ─────────────────────────────────────────────────────────────────────────────
// Real-world CCS reference scenarios
// Each preset maps to the parameter shape the dashboard/payload expects.
// Sources: IEA CCS Database, Global CCS Institute project profiles (public).
// ─────────────────────────────────────────────────────────────────────────────
const CCS_SCENARIOS = [
  {
    id: "custom",
    label: "Custom Configuration",
    icon: "⚙️",
    description: "Manually configure each component below.",
    region: "",
    status: "",
    source_id: null,
    absorber_id: null,
    stripper_id: null,
    compressor_id: null,
    storage_id: null,
    params: null,
  },
  {
    id: "sleipner",
    label: "Sleipner CO₂ Storage",
    icon: "🌊",
    description: "World's first offshore CCS project (1996). Statoil, Norway. Saline aquifer at 1000 m depth. ~1 Mt CO₂/yr.",
    region: "Norway · North Sea",
    status: "Operational",
    statusColor: "emerald",
    source_id: "gas_ccgt",
    absorber_id: "mea_absorb",
    stripper_id: "conv_stripper",
    compressor_id: "multistage_110",
    storage_id: "saline_offshore",
    params: {
      source:     { capacity_kw: 700000, efficiency_pct: 55, co2_emission_kg_kwh: 0.37, flue_gas_temp_c: 130, co2_concentration_pct: 4.0 },
      absorber:   { capture_rate_pct: 85, energy_requirement_gj_tco2: 3.9, solvent_flow_rate_m3_h: 600, absorption_temp_c: 40, l_g_ratio: 3.5 },
      stripper:   { reboiler_temp_c: 120, steam_pressure_bar: 3.5, thermal_efficiency_pct: 80, energy_input_gj_tco2: 3.5 },
      compressor: { target_pressure_bar: 110, number_stages: 4, isentropic_efficiency_pct: 80, intercooling_temp_c: 35 },
      storage:    { injection_rate_mtco2_yr: 1.0, reservoir_depth_m: 1000, reservoir_pressure_bar: 100, permeability_md: 1500, porosity_pct: 35, injection_efficiency_pct: 99 },
    },
  },
  {
    id: "boundary_dam",
    label: "Boundary Dam CCS",
    icon: "⚫",
    description: "First commercial CCS on a coal power plant (2014). SaskPower, Canada. Post-combustion amine capture. ~800 kt CO₂/yr design.",
    region: "Saskatchewan, Canada",
    status: "Operational",
    statusColor: "emerald",
    source_id: "coal_pc",
    absorber_id: "advanced_amine",
    stripper_id: "vapor_recomp",
    compressor_id: "multistage_150",
    storage_id: "depleted_oil",
    params: {
      source:     { capacity_kw: 110000, efficiency_pct: 38, co2_emission_kg_kwh: 0.95, flue_gas_temp_c: 140, co2_concentration_pct: 14.0 },
      absorber:   { capture_rate_pct: 90, energy_requirement_gj_tco2: 3.3, solvent_flow_rate_m3_h: 350, absorption_temp_c: 42, l_g_ratio: 4.0 },
      stripper:   { reboiler_temp_c: 125, steam_pressure_bar: 4.0, thermal_efficiency_pct: 83, energy_input_gj_tco2: 3.3 },
      compressor: { target_pressure_bar: 150, number_stages: 5, isentropic_efficiency_pct: 82, intercooling_temp_c: 30 },
      storage:    { injection_rate_mtco2_yr: 0.8, reservoir_depth_m: 1500, reservoir_pressure_bar: 140, permeability_md: 300, porosity_pct: 20, injection_efficiency_pct: 95 },
    },
  },
  {
    id: "quest",
    label: "Quest CCS (Shell)",
    icon: "🛢️",
    description: "Post-combustion CCS on hydrogen production from oil sands (2015). Alberta, Canada. ~1 Mt CO₂/yr.",
    region: "Alberta, Canada",
    status: "Operational",
    statusColor: "emerald",
    source_id: "refinery",
    absorber_id: "mea_absorb",
    stripper_id: "vapor_recomp",
    compressor_id: "multistage_110",
    storage_id: "saline_aquifer",
    params: {
      source:     { capacity_kw: 200000, efficiency_pct: 80, co2_emission_kg_kwh: 0.45, flue_gas_temp_c: 120, co2_concentration_pct: 18.0 },
      absorber:   { capture_rate_pct: 88, energy_requirement_gj_tco2: 3.6, solvent_flow_rate_m3_h: 400, absorption_temp_c: 40, l_g_ratio: 3.8 },
      stripper:   { reboiler_temp_c: 120, steam_pressure_bar: 3.5, thermal_efficiency_pct: 82, energy_input_gj_tco2: 3.2 },
      compressor: { target_pressure_bar: 110, number_stages: 4, isentropic_efficiency_pct: 82, intercooling_temp_c: 35 },
      storage:    { injection_rate_mtco2_yr: 1.0, reservoir_depth_m: 2300, reservoir_pressure_bar: 210, permeability_md: 200, porosity_pct: 18, injection_efficiency_pct: 99 },
    },
  },
  {
    id: "petra_nova",
    label: "Petra Nova (NRG Energy)",
    icon: "⚫",
    description: "Largest post-combustion CCS on a coal plant (2017, suspended 2020). Texas, USA. ~1.4 Mt CO₂/yr design capacity.",
    region: "Texas, USA",
    status: "Suspended",
    statusColor: "amber",
    source_id: "coal_pc",
    absorber_id: "advanced_amine",
    stripper_id: "vapor_recomp",
    compressor_id: "multistage_150",
    storage_id: "depleted_oil",
    params: {
      source:     { capacity_kw: 240000, efficiency_pct: 37, co2_emission_kg_kwh: 0.98, flue_gas_temp_c: 135, co2_concentration_pct: 13.5 },
      absorber:   { capture_rate_pct: 90, energy_requirement_gj_tco2: 3.1, solvent_flow_rate_m3_h: 700, absorption_temp_c: 40, l_g_ratio: 4.2 },
      stripper:   { reboiler_temp_c: 122, steam_pressure_bar: 3.8, thermal_efficiency_pct: 85, energy_input_gj_tco2: 3.1 },
      compressor: { target_pressure_bar: 150, number_stages: 5, isentropic_efficiency_pct: 83, intercooling_temp_c: 32 },
      storage:    { injection_rate_mtco2_yr: 1.4, reservoir_depth_m: 1400, reservoir_pressure_bar: 130, permeability_md: 400, porosity_pct: 25, injection_efficiency_pct: 95 },
    },
  },
  {
    id: "northern_lights",
    label: "Northern Lights (Longship)",
    icon: "🌊",
    description: "First open-access CO₂ transport & storage infrastructure (2024). Equinor, TotalEnergies, Shell. Aurora field, Norway.",
    region: "Norway · North Sea",
    status: "Operational",
    statusColor: "emerald",
    source_id: "cement_plant",
    absorber_id: "advanced_amine",
    stripper_id: "multi_pressure",
    compressor_id: "multistage_150",
    storage_id: "saline_offshore",
    params: {
      source:     { capacity_kw: 50000, efficiency_pct: 45, co2_emission_kg_kwh: 0.82, flue_gas_temp_c: 200, co2_concentration_pct: 20.0 },
      absorber:   { capture_rate_pct: 85, energy_requirement_gj_tco2: 3.0, solvent_flow_rate_m3_h: 300, absorption_temp_c: 45, l_g_ratio: 3.2 },
      stripper:   { reboiler_temp_c: 118, steam_pressure_bar: 3.2, thermal_efficiency_pct: 87, energy_input_gj_tco2: 3.0 },
      compressor: { target_pressure_bar: 150, number_stages: 4, isentropic_efficiency_pct: 84, intercooling_temp_c: 30 },
      storage:    { injection_rate_mtco2_yr: 1.5, reservoir_depth_m: 2600, reservoir_pressure_bar: 240, permeability_md: 800, porosity_pct: 30, injection_efficiency_pct: 99 },
    },
  },
  {
    id: "carbfix",
    label: "CarbFix Basalt Mineralization",
    icon: "🪨",
    description: "CO₂ dissolved in water and injected into basaltic rock for permanent mineral storage (Hellisheiði, Iceland). ~35 kt CO₂/yr.",
    region: "Iceland",
    status: "Operational",
    statusColor: "emerald",
    source_id: "gas_ccgt",
    absorber_id: "membrane",
    stripper_id: "flash_regen",
    compressor_id: "isothermal_comp",
    storage_id: "basalt_mineral",
    params: {
      source:     { capacity_kw: 90000, efficiency_pct: 30, co2_emission_kg_kwh: 0.05, flue_gas_temp_c: 110, co2_concentration_pct: 0.6 },
      absorber:   { capture_rate_pct: 75, energy_requirement_gj_tco2: 2.5, solvent_flow_rate_m3_h: 120, absorption_temp_c: 35, l_g_ratio: 2.8 },
      stripper:   { reboiler_temp_c: 100, steam_pressure_bar: 2.0, thermal_efficiency_pct: 90, energy_input_gj_tco2: 2.2 },
      compressor: { target_pressure_bar: 120, number_stages: 3, isentropic_efficiency_pct: 86, intercooling_temp_c: 25 },
      storage:    { injection_rate_mtco2_yr: 0.035, reservoir_depth_m: 400, reservoir_pressure_bar: 40, permeability_md: 5000, porosity_pct: 10, injection_efficiency_pct: 100 },
    },
  },
  {
    id: "beccs_drax",
    label: "Drax BECCS (Proposed)",
    icon: "🌿",
    description: "Bioenergy with CCS at Drax Power Station, UK. Biomass combustion + amine capture = negative emissions. ~8 Mt CO₂/yr target.",
    region: "Yorkshire, UK",
    status: "Development",
    statusColor: "blue",
    source_id: "biomass_power",
    absorber_id: "advanced_amine",
    stripper_id: "vapor_recomp",
    compressor_id: "multistage_110",
    storage_id: "depleted_gas",
    params: {
      source:     { capacity_kw: 660000, efficiency_pct: 32, co2_emission_kg_kwh: 0.04, flue_gas_temp_c: 130, co2_concentration_pct: 15.0 },
      absorber:   { capture_rate_pct: 95, energy_requirement_gj_tco2: 2.9, solvent_flow_rate_m3_h: 2000, absorption_temp_c: 40, l_g_ratio: 4.0 },
      stripper:   { reboiler_temp_c: 120, steam_pressure_bar: 3.5, thermal_efficiency_pct: 86, energy_input_gj_tco2: 2.9 },
      compressor: { target_pressure_bar: 110, number_stages: 4, isentropic_efficiency_pct: 83, intercooling_temp_c: 35 },
      storage:    { injection_rate_mtco2_yr: 8.0, reservoir_depth_m: 2000, reservoir_pressure_bar: 185, permeability_md: 600, porosity_pct: 22, injection_efficiency_pct: 99 },
    },
  },
  {
    id: "cement_holcim",
    label: "Holcim Cement CCS",
    icon: "🏭",
    description: "MEA post-combustion capture at a cement kiln. High CO₂ concentration from calcination process (~20 vol%). ~500 kt CO₂/yr.",
    region: "Europe (generic)",
    status: "Demonstration",
    statusColor: "blue",
    source_id: "cement_plant",
    absorber_id: "mea_absorb",
    stripper_id: "conv_stripper",
    compressor_id: "multistage_110",
    storage_id: "saline_aquifer",
    params: {
      source:     { capacity_kw: 50000, efficiency_pct: 40, co2_emission_kg_kwh: 0.82, flue_gas_temp_c: 220, co2_concentration_pct: 20.0 },
      absorber:   { capture_rate_pct: 90, energy_requirement_gj_tco2: 4.0, solvent_flow_rate_m3_h: 250, absorption_temp_c: 45, l_g_ratio: 3.5 },
      stripper:   { reboiler_temp_c: 125, steam_pressure_bar: 4.0, thermal_efficiency_pct: 81, energy_input_gj_tco2: 3.8 },
      compressor: { target_pressure_bar: 110, number_stages: 4, isentropic_efficiency_pct: 82, intercooling_temp_c: 35 },
      storage:    { injection_rate_mtco2_yr: 0.5, reservoir_depth_m: 1800, reservoir_pressure_bar: 165, permeability_md: 250, porosity_pct: 20, injection_efficiency_pct: 99 },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Status badge helper
// ─────────────────────────────────────────────────────────────────────────────
function StatusBadge({ status, color = "emerald" }) {
  const classes = {
    emerald: "bg-surface-container-high text-on-surface border-outline-variant/30",
    amber:   "bg-surface-container-high text-on-surface border-outline-variant/30",
    blue:    "bg-surface-container-high text-on-surface border-outline-variant/30",
    slate:   "bg-surface-container-high text-on-surface-variant border-outline-variant/30",
  };
  if (!status) return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${classes[color] ?? classes.slate}`}>
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline parameter row (slider + numeric input)
// ─────────────────────────────────────────────────────────────────────────────
function ParamRow({ label, unit, value, min, max, step = 1, decimals = 0, onChange, disabled }) {
  const clamped = Math.max(min, Math.min(max, Number(value) || min));
  const pct = ((clamped - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="w-40 text-[11px] text-on-surface-variant shrink-0">{label}</span>
      <div className="flex-1 relative h-1.5 bg-surface-container-high rounded-full">
        <div
          className="absolute left-0 top-0 h-1.5 rounded-full bg-gray-400 transition-all"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          disabled={disabled}
          className="absolute inset-0 w-full h-1.5 opacity-0 cursor-pointer disabled:cursor-not-allowed"
          min={min} max={max} step={step} value={clamped}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <input
          type="number"
          disabled={disabled}
          className="w-20 text-right text-xs font-mono font-semibold text-on-surface border border-outline-variant/30 rounded-lg px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50"
          min={min} max={max} step={step} value={decimals > 0 ? Number(value).toFixed(decimals) : value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
        />
        <span className="text-[10px] text-on-surface-variant/70 w-12">{unit}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component tab definitions — each has editable params
// ─────────────────────────────────────────────────────────────────────────────
const COMPONENT_TABS = [
  {
    key: "source",
    label: "Source",
    icon: FiZap,
    color: "text-on-surface-variant",
    border: "border-outline-variant/40",
    bg: "bg-surface-container",
    activeBg: "bg-surface-container0",
    params: (p) => ([
      { key: "capacity_kw",          label: "Plant Capacity",      unit: "MW",     value: (p.capacity_kw ?? 400000) / 1000, min: 10, max: 2000, step: 10,   decimals: 0, toState: (v) => ({ capacity_kw: v * 1000 }) },
      { key: "efficiency_pct",       label: "Thermal Efficiency",  unit: "%",      value: p.efficiency_pct ?? 58,          min: 20, max: 70,   step: 0.5,  decimals: 1, toState: (v) => ({ efficiency_pct: v }) },
      { key: "co2_emission_kg_kwh",  label: "CO₂ Emission Factor", unit: "kg/kWh", value: p.co2_emission_kg_kwh ?? 0.38,   min: 0.01, max: 2.0, step: 0.01, decimals: 2, toState: (v) => ({ co2_emission_kg_kwh: v }) },
      { key: "co2_concentration_pct",label: "CO₂ Concentration",   unit: "vol%",   value: p.co2_concentration_pct ?? 12,   min: 0.1, max: 30,   step: 0.1,  decimals: 1, toState: (v) => ({ co2_concentration_pct: v }) },
      { key: "flue_gas_temp_c",      label: "Flue Gas Temperature",unit: "°C",     value: p.flue_gas_temp_c ?? 120,        min: 50,  max: 300,  step: 5,    decimals: 0, toState: (v) => ({ flue_gas_temp_c: v }) },
    ]),
  },
  {
    key: "absorber",
    label: "Absorber",
    icon: FiDroplet,
    color: "text-on-surface-variant",
    border: "border-outline-variant/40",
    bg: "bg-surface-container",
    activeBg: "bg-surface-container0",
    params: (p) => ([
      { key: "capture_rate_pct",           label: "Capture Rate",       unit: "%",     value: p.capture_rate_pct ?? 90,          min: 50,   max: 99,   step: 0.5,  decimals: 1, toState: (v) => ({ capture_rate_pct: v }) },
      { key: "energy_requirement_gj_tco2", label: "Energy Requirement", unit: "GJ/t",  value: p.energy_requirement_gj_tco2 ?? 3.7, min: 1.5, max: 6.0, step: 0.05, decimals: 2, toState: (v) => ({ energy_requirement_gj_tco2: v }) },
      { key: "solvent_flow_rate_m3_h",     label: "Solvent Flow Rate",  unit: "m³/h",  value: p.solvent_flow_rate_m3_h ?? 500,   min: 50,   max: 5000, step: 50,   decimals: 0, toState: (v) => ({ solvent_flow_rate_m3_h: v }) },
      { key: "absorption_temp_c",          label: "Absorption Temp",    unit: "°C",    value: p.absorption_temp_c ?? 40,         min: 20,   max: 70,   step: 1,    decimals: 0, toState: (v) => ({ absorption_temp_c: v }) },
      { key: "l_g_ratio",                  label: "L/G Ratio",          unit: "L/Nm³", value: p.l_g_ratio ?? 3.5,                min: 1.5,  max: 8.0,  step: 0.1,  decimals: 1, toState: (v) => ({ l_g_ratio: v }) },
    ]),
  },
  {
    key: "stripper",
    label: "Stripper",
    icon: FiWind,
    color: "text-on-surface-variant",
    border: "border-outline-variant/40",
    bg: "bg-surface-container",
    activeBg: "bg-surface-container0",
    params: (p) => ([
      { key: "reboiler_temp_c",       label: "Reboiler Temperature", unit: "°C",    value: p.reboiler_temp_c ?? 120,       min: 80,  max: 150, step: 1,    decimals: 0, toState: (v) => ({ reboiler_temp_c: v }) },
      { key: "steam_pressure_bar",    label: "Steam Pressure",       unit: "bar",   value: p.steam_pressure_bar ?? 3.5,    min: 1.0, max: 8.0, step: 0.1,  decimals: 1, toState: (v) => ({ steam_pressure_bar: v }) },
      { key: "thermal_efficiency_pct",label: "Thermal Efficiency",   unit: "%",     value: p.thermal_efficiency_pct ?? 82, min: 60,  max: 95,  step: 0.5,  decimals: 1, toState: (v) => ({ thermal_efficiency_pct: v }) },
      { key: "energy_input_gj_tco2",  label: "Regen. Energy",        unit: "GJ/t",  value: p.energy_input_gj_tco2 ?? 3.2,  min: 1.5, max: 6.0, step: 0.05, decimals: 2, toState: (v) => ({ energy_input_gj_tco2: v }) },
    ]),
  },
  {
    key: "compressor",
    label: "Compressor",
    icon: FiBox,
    color: "text-on-surface-variant",
    border: "border-outline-variant/40",
    bg: "bg-surface-container",
    activeBg: "bg-surface-container0",
    params: (p) => ([
      { key: "target_pressure_bar",     label: "Target Pressure",         unit: "bar", value: p.target_pressure_bar ?? 110,       min: 50,   max: 300,  step: 5,   decimals: 0, toState: (v) => ({ target_pressure_bar: v }) },
      { key: "number_stages",           label: "Compression Stages",      unit: "",    value: p.number_stages ?? 4,               min: 1,    max: 8,    step: 1,   decimals: 0, toState: (v) => ({ number_stages: v }) },
      { key: "isentropic_efficiency_pct",label: "Isentropic Efficiency",  unit: "%",   value: p.isentropic_efficiency_pct ?? 82,  min: 50,   max: 95,   step: 0.5, decimals: 1, toState: (v) => ({ isentropic_efficiency_pct: v }) },
      { key: "intercooling_temp_c",     label: "Intercooler Temperature", unit: "°C",  value: p.intercooling_temp_c ?? 35,        min: 15,   max: 60,   step: 1,   decimals: 0, toState: (v) => ({ intercooling_temp_c: v }) },
    ]),
  },
  {
    key: "storage",
    label: "Storage",
    icon: FiDatabase,
    color: "text-on-surface-variant",
    border: "border-outline-variant/40",
    bg: "bg-surface-container",
    activeBg: "bg-surface-container0",
    params: (p) => ([
      { key: "injection_rate_mtco2_yr", label: "Injection Rate",      unit: "Mt/yr",  value: p.injection_rate_mtco2_yr ?? 5,      min: 0.01, max: 20,   step: 0.1,  decimals: 2, toState: (v) => ({ injection_rate_mtco2_yr: v }) },
      { key: "reservoir_depth_m",       label: "Reservoir Depth",     unit: "m",      value: p.reservoir_depth_m ?? 1500,         min: 200,  max: 5000, step: 50,   decimals: 0, toState: (v) => ({ reservoir_depth_m: v }) },
      { key: "reservoir_pressure_bar",  label: "Reservoir Pressure",  unit: "bar",    value: p.reservoir_pressure_bar ?? 150,     min: 20,   max: 400,  step: 5,    decimals: 0, toState: (v) => ({ reservoir_pressure_bar: v }) },
      { key: "permeability_md",         label: "Permeability",        unit: "mD",     value: p.permeability_md ?? 200,            min: 1,    max: 5000, step: 10,   decimals: 0, toState: (v) => ({ permeability_md: v }) },
      { key: "porosity_pct",            label: "Porosity",            unit: "%",      value: p.porosity_pct ?? 18,                min: 2,    max: 50,   step: 0.5,  decimals: 1, toState: (v) => ({ porosity_pct: v }) },
      { key: "injection_efficiency_pct",label: "Injection Efficiency",unit: "%",      value: p.injection_efficiency_pct ?? 99,    min: 50,   max: 100,  step: 0.5,  decimals: 1, toState: (v) => ({ injection_efficiency_pct: v }) },
    ]),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function CCSConfigPanel({
  ccsModels = {},
  selectedCcsModels = {},
  onSelectCcsModel,
  ccsSource = {},
  ccsAbsorber = {},
  ccsStripper = {},
  ccsCompressor = {},
  ccsStorage = {},
  onSourceChange,
  onAbsorberChange,
  onStripperChange,
  onCompressorChange,
  onStorageChange,
  simState,
}) {
  const [selectedScenario, setSelectedScenario] = useState("custom");
  const [activeTab, setActiveTab] = useState("source");
  const [expanded, setExpanded] = useState(true);
  const disabled = simState === "running" || simState === "queued";

  const scenario = CCS_SCENARIOS.find((s) => s.id === selectedScenario) ?? CCS_SCENARIOS[0];

  const handleScenarioChange = (scenarioId) => {
    setSelectedScenario(scenarioId);
    const sc = CCS_SCENARIOS.find((s) => s.id === scenarioId);
    if (!sc?.params) return;

    // Apply all parameter patches
    onSourceChange?.((p) => ({ ...p, ...sc.params.source }));
    onAbsorberChange?.((p) => ({ ...p, ...sc.params.absorber }));
    onStripperChange?.((p) => ({ ...p, ...sc.params.stripper }));
    onCompressorChange?.((p) => ({ ...p, ...sc.params.compressor }));
    onStorageChange?.((p) => ({ ...p, ...sc.params.storage }));

    // Apply model selections if we have them
    if (sc.source_id && ccsModels.source) {
      const m = ccsModels.source.find((x) => x.id === sc.source_id);
      if (m) onSelectCcsModel?.("source", m);
    }
    if (sc.absorber_id && ccsModels.absorber) {
      const m = ccsModels.absorber.find((x) => x.id === sc.absorber_id);
      if (m) onSelectCcsModel?.("absorber", m);
    }
    if (sc.stripper_id && ccsModels.stripper) {
      const m = ccsModels.stripper.find((x) => x.id === sc.stripper_id);
      if (m) onSelectCcsModel?.("stripper", m);
    }
    if (sc.compressor_id && ccsModels.compressor) {
      const m = ccsModels.compressor.find((x) => x.id === sc.compressor_id);
      if (m) onSelectCcsModel?.("compressor", m);
    }
    if (sc.storage_id && ccsModels.storage) {
      const m = ccsModels.storage.find((x) => x.id === sc.storage_id);
      if (m) onSelectCcsModel?.("storage", m);
    }
  };

  // Current params per component
  const paramState = {
    source: ccsSource,
    absorber: ccsAbsorber,
    stripper: ccsStripper,
    compressor: ccsCompressor,
    storage: ccsStorage,
  };
  const changeHandlers = {
    source: onSourceChange,
    absorber: onAbsorberChange,
    stripper: onStripperChange,
    compressor: onCompressorChange,
    storage: onStorageChange,
  };

  const activeTabDef = COMPONENT_TABS.find((t) => t.key === activeTab) ?? COMPONENT_TABS[0];
  const activeParams = activeTabDef.params(paramState[activeTab] ?? {});

  return (
    <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-sm overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-5 py-3.5 border-b border-outline-variant/20 cursor-pointer select-none bg-surface-container hover:bg-surface-container-high transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="p-1.5 rounded-lg bg-surface-container-high text-on-surface-variant">
          <FiDatabase size={14} />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-on-surface">CCS Process Configuration</p>
          <p className="text-[11px] text-on-surface-variant">
            {scenario.id === "custom"
              ? "Custom — configure each component manually"
              : `${scenario.icon} ${scenario.label} · ${scenario.region}`}
          </p>
        </div>
        {scenario.id !== "custom" && (
          <StatusBadge status={scenario.status} color={scenario.statusColor} />
        )}
        <button className="p-1 rounded-md hover:bg-surface-container-highest text-on-surface-variant/70 transition-colors" onClick={(e) => { e.stopPropagation(); setExpanded((e) => !e); }}>
          {expanded ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
        </button>
      </div>

      {expanded && (
        <div className="p-5 space-y-4">
          {/* ── Scenario Selector ─────────────────────────────────────────── */}
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-2 uppercase tracking-wide">Reference Installation</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {CCS_SCENARIOS.map((sc) => (
                <button
                  key={sc.id}
                  disabled={disabled}
                  onClick={() => handleScenarioChange(sc.id)}
                  className={`relative text-left px-3 py-2.5 rounded-xl border transition-all text-xs
                    ${selectedScenario === sc.id
                      ? "border-gray-400 bg-surface-container shadow-sm ring-1 ring-gray-300"
                      : "border-outline-variant/30 bg-surface-container-lowest hover:border-outline-variant/40 hover:bg-surface-container"
                    }
                    ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <div className="flex items-start gap-1.5 mb-1">
                    <span className="text-base leading-none mt-0.5">{sc.icon}</span>
                    <span className={`font-semibold leading-snug ${selectedScenario === sc.id ? "text-on-surface" : "text-on-surface"}`}>
                      {sc.label}
                    </span>
                  </div>
                  {sc.region && (
                    <p className="text-[10px] text-on-surface-variant/70 mt-0.5 line-clamp-1">{sc.region}</p>
                  )}
                  {sc.status && (
                    <div className="mt-1.5">
                      <StatusBadge status={sc.status} color={sc.statusColor} />
                    </div>
                  )}
                  {selectedScenario === sc.id && (
                    <span className="absolute top-1.5 right-1.5 text-on-surface-variant text-[10px] font-bold">✓</span>
                  )}
                </button>
              ))}
            </div>

            {/* Scenario description */}
            {scenario.description && (
              <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-surface-container rounded-xl border border-outline-variant/20">
                <FiInfo size={12} className="text-on-surface-variant/70 mt-0.5 shrink-0" />
                <p className="text-[11px] text-on-surface-variant leading-relaxed">{scenario.description}</p>
              </div>
            )}
          </div>

          {/* ── Component Parameter Tabs ─────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-1 mb-3 border-b border-outline-variant/20 pb-2">
              <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mr-2">Parameters</span>
              {COMPONENT_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all
                      ${isActive
                        ? `${tab.activeBg} text-white shadow-sm`
                        : `text-on-surface-variant hover:bg-surface-container-high ${tab.color}`
                      }`}
                  >
                    <Icon size={11} />
                    {tab.label}
                  </button>
                );
              })}
              <button
                title="Reset this component to scenario defaults"
                disabled={disabled || scenario.id === "custom"}
                onClick={() => {
                  if (scenario.params?.[activeTab]) {
                    changeHandlers[activeTab]?.((p) => ({ ...p, ...scenario.params[activeTab] }));
                  }
                }}
                className="ml-auto p-1.5 rounded-lg border border-outline-variant/30 text-on-surface-variant/70 hover:bg-surface-container-high hover:text-on-surface-variant disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <FiRefreshCw size={12} />
              </button>
            </div>

            {/* Model selector for active tab */}
            {ccsModels[activeTab]?.length > 0 && (
              <div className="mb-3">
                <label className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5 block">
                  Technology Model
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ccsModels[activeTab].map((m) => {
                    const isSelected = selectedCcsModels[activeTab]?.id === m.id;
                    return (
                      <button
                        key={m.id}
                        disabled={disabled}
                        onClick={() => onSelectCcsModel?.(activeTab, m)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border transition-all font-medium
                          ${isSelected
                            ? "border-gray-400 bg-surface-container text-on-surface shadow-sm"
                            : "border-outline-variant/30 bg-surface-container-lowest text-on-surface-variant hover:border-outline-variant/40"
                          }
                          ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          m.lifecycle === "commercial" ? "bg-gray-400" :
                          m.lifecycle === "demonstration" ? "bg-gray-400" : "bg-gray-400"
                        }`} />
                        {m.name}
                        {m.efficiency_pct != null && (
                          <span className="text-[10px] opacity-60">η{Number(m.efficiency_pct).toFixed(0)}%</span>
                        )}
                        {isSelected && <span className="text-on-surface-variant font-bold text-[9px]">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Parameter rows */}
            <div className={`rounded-xl border p-3 divide-y divide-outline-variant/15 ${activeTabDef.bg} ${activeTabDef.border}`}>
              {activeParams.map((param) => (
                <ParamRow
                  key={param.key}
                  label={param.label}
                  unit={param.unit}
                  value={param.value}
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  decimals={param.decimals}
                  disabled={disabled}
                  onChange={(v) => {
                    const patch = param.toState(v);
                    changeHandlers[activeTab]?.((p) => ({ ...p, ...patch }));
                    // Mark as custom once user manually edits
                    if (selectedScenario !== "custom") setSelectedScenario("custom");
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * HydrogenPlantDashboard.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Technology Simulation Hub — Digital Twin Platform.
 * Currently available: H₂ Power Plant (OpenModelica-based simulation).
 * Future: Biomass CHP, Carbon Capture, PV+Battery, etc.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import {
  FiZap,
  FiDatabase,
  FiCpu,
  FiPlay,
  FiStopCircle,
  FiRefreshCw,
  FiCheckCircle,
  FiAlertCircle,
  FiWifi,
  FiWifiOff,
  FiInfo,
  FiClock,
  FiWind,
  FiSettings,
  FiDroplet,
  FiBox,
  FiChevronRight,
} from "react-icons/fi";
import {
  runSimulation,
  checkHealth,
} from "../services/hydrogenService";
import { buildSimPayload, normalizeSimResult } from "../services/h2SimPayload";
import H2PlantFlowDiagram from "./H2PlantFlowDiagram";
import H2EnergyCharts from "./H2EnergyCharts";
import H2GeneratorPanel from "./H2GeneratorPanel";
import H2ElectrolyzerPanel from "./H2ElectrolyzerPanel";

// CCS imports
import { runCCSSimulation, checkHealth as checkCCSHealth } from "../services/ccsService";
import { buildSimPayload as buildCCSPayload, normalizeSimResult as normalizeCCSResult } from "../services/ccsSimPayload";
import CCSFlowDiagram from "./CCSFlowDiagram";
import CCSEnergyCharts from "./CCSEnergyCharts";
import CCSSourcePanel from "./CCSSourcePanel";
import CCSAbsorberPanel from "./CCSAbsorberPanel";
import CCSStripperPanel from "./CCSStripperPanel";
import CCSCompressorPanel from "./CCSCompressorPanel";
import CCSStoragePanel from "./CCSStoragePanel";
import { useUnitSimulation } from "../hooks/useUnitSimulation";

// ─────────────────────────────────────────────────────────────────────────────
// Detect source tech type from model (mirrors H2GeneratorPanel logic)
// ─────────────────────────────────────────────────────────────────────────────
function detectSourceTechType(model) {
  if (!model) return "generic";
  const key = `${model.id ?? ""} ${model.name ?? ""}`.toLowerCase();
  if (/solar|pv|photovoltaic/.test(key))    return "solar";
  if (/wind/.test(key))                      return "wind";
  if (/nuclear|pwr|bwr|smr/.test(key))      return "nuclear";
  if (/hydro|water|river|dam/.test(key))    return "hydro";
  if (/geotherm/.test(key))                 return "geothermal";
  if (/biomass|biogas|bio/.test(key))       return "biomass";
  if (/coal|lignite/.test(key))             return "coal";
  if (/gas|ccgt|ocgt|lng/.test(key))        return "gas";
  return "generic";
}

function parseCapacityToKw(value, unitHint = null) {
  const toMultiplier = (u) => {
    const s = String(u ?? "").trim().toLowerCase();
    if (s === "kw") return 1;
    if (s === "mw") return 1000;
    if (s === "gw") return 1000000;
    return null;
  };

  if (value == null) return null;
  if (typeof value === "object") {
    const raw = value.value ?? value.amount ?? value.capacity ?? null;
    const unit = value.unit ?? value.units ?? unitHint;
    return parseCapacityToKw(raw, unit);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value * (toMultiplier(unitHint) ?? 1);
  }
  if (typeof value === "string") {
    const s = value.trim();
    const m = s.match(/^([+-]?\d+(?:\.\d+)?)\s*([kmg]w)?$/i);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n * (toMultiplier(m[2] ?? unitHint) ?? 1);
  }
  return null;
}

function getModelCapacityKw(model) {
  const unit = model?.capacity_unit ?? model?.unit ?? model?.units ?? model?.specs?.capacity_unit ?? model?.technical_specifications?.capacity_unit;
  const candidates = [
    [model?.capacity_kw, "kw"],
    [model?.rated_power_kw, "kw"],
    [model?.nominal_power_kw, "kw"],
    [model?.power_kw, "kw"],
    [model?.plant_capacity_kw, "kw"],
    [model?.nameplate_capacity_kw, "kw"],
    [model?.specs?.capacity_kw, "kw"],
    [model?.technical_specifications?.capacity_kw, "kw"],
    [model?.defaults?.capacity_kw, "kw"],
    [model?.parameters?.capacity_kw, "kw"],
    [model?.capacity_mw, "mw"],
    [model?.rated_power_mw, "mw"],
    [model?.nominal_power_mw, "mw"],
    [model?.size_mw, "mw"],
    [model?.plant_capacity_mw, "mw"],
    [model?.nameplate_capacity_mw, "mw"],
    [model?.specs?.capacity_mw, "mw"],
    [model?.technical_specifications?.capacity_mw, "mw"],
    [model?.defaults?.capacity_mw, "mw"],
    [model?.parameters?.capacity_mw, "mw"],
    [model?.capacity_gw, "gw"],
    [model?.specs?.capacity_gw, "gw"],
    [model?.technical_specifications?.capacity_gw, "gw"],
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

import H2NodeModal from "./H2NodeModal";
import { fetchH2Models, getBestModel, applyModelParams, fetchH2Variants, H2_SLOTS } from "../services/h2TechModels";
import { fetchCCSModels, getBestModel as getBestCCSModel, applyModelParams as applyCCSParams, CCS_SLOTS, FALLBACK_CATALOG as CCS_FALLBACK_CATALOG } from "../services/ccsTechModels";

// ─────────────────────────────────────────────────────────────────────────────
// Simulation catalogue — add new tech simulations here
// ─────────────────────────────────────────────────────────────────────────────
const SIM_CATALOGUE = [
  {
    id:       "h2",
    label:    "H₂ Simulation",
    icon:     FiZap,
    color:    "text-on-surface-variant",
    bg:       "bg-surface-container",
    active:   "bg-primary text-white shadow-md",
    ready:    true,
    subtitle: "Electrolyzer · Compressor · Storage · Fuel Cell",
  },
  {
    id:       "biomass",
    label:    "Biomass CHP",
    icon:     FiSettings,
    color:    "text-on-surface-variant",
    bg:       "bg-surface-container",
    active:   "bg-primary text-white shadow-md",
    ready:    false,
    subtitle: "Coming soon",
  },
  {
    id:       "wind_battery",
    label:    "Wind + Battery",
    icon:     FiWind,
    color:    "text-on-surface-variant",
    bg:       "bg-surface-container",
    active:   "bg-primary text-white shadow-md",
    ready:    false,
    subtitle: "Coming soon",
  },
  {
    id:       "ccs",
    label:    "CCS Simulation",
    icon:     FiDatabase,
    color:    "text-on-surface-variant",
    bg:       "bg-surface-container",
    active:   "bg-slate-600 text-white shadow-md",
    ready:    true,
    subtitle: "Source · Absorber · Stripper · Compressor · Storage",
  },
];

const HORIZON_PRESETS = [
  { id: "day", label: "1 day", t_end_s: 86400 },
  { id: "week", label: "1 week", t_end_s: 7 * 86400 },
  { id: "month", label: "1 month", t_end_s: 30 * 86400 },
  { id: "year", label: "1 year", t_end_s: 365 * 86400 },
];

const DT_PRESETS = [
  { label: "5 min", value: 300 },
  { label: "15 min", value: 900 },
  { label: "1 h", value: 3600 },
  { label: "6 h", value: 21600 },
  { label: "24 h", value: 86400 },
];

const DEFAULT_TIME_ADVANCED = {
  target_samples: 672,
  resampling_strategy: "adaptive", // fixed | adaptive | rolling_window
  rolling_window_days: 7,
  auto_apply: true,
  performance_soft_limit: 5000,
  performance_hard_limit: 12000,
};

function suggestDtSeconds(tEndSeconds, sourceTechType) {
  const horizon = Math.max(300, Number(tEndSeconds) || 86400);
  const variableSource = ["solar", "wind", "hydro", "gas"].includes(sourceTechType);
  const targetPoints = Math.min(2200, Math.max(120, Math.round((horizon / 3600) * (variableSource ? 4 : 2))));
  const dtRaw = horizon / targetPoints;
  const candidates = DT_PRESETS.map((d) => d.value);
  return candidates.find((dt) => dt >= dtRaw) ?? candidates[candidates.length - 1];
}

function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const days = s / 86400;
  if (days >= 365) return `${(days / 365).toFixed(2)} years`;
  if (days >= 30) return `${(days / 30).toFixed(2)} months`;
  if (days >= 7) return `${(days / 7).toFixed(2)} weeks`;
  if (days >= 1) return `${days.toFixed(2)} days`;
  return `${(s / 3600).toFixed(2)} hours`;
}

function quantizeDtSeconds(value) {
  if (!Number.isFinite(value) || value <= 0) return 60;
  const minute = 60;
  return Math.max(minute, Math.round(value / minute) * minute);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny reusable primitives (matches app-wide Tailwind conventions)
// ─────────────────────────────────────────────────────────────────────────────

function Card({ children, className = "" }) {
  return (
    <div className={`bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ icon: Icon, label, color = "electric" }) {
  const colors = {
    electric: "bg-electric-50 text-electric-600",
    emerald:  "bg-surface-container text-on-surface-variant",
    violet:   "bg-surface-container text-on-surface-variant",
    amber:    "bg-surface-container text-on-surface-variant",
  };
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className={`p-2 rounded-xl ${colors[color] ?? colors.electric}`}>
        <Icon size={16} />
      </span>
      <h3 className="font-semibold text-on-surface text-sm tracking-wide uppercase">
        {label}
      </h3>
    </div>
  );
}



function KpiCard({ label, value, unit, color = "slate" }) {
  const ring = {
    electric: "border-electric-200 bg-electric-50",
    emerald:  "border-outline-variant/30 bg-surface-container",
    violet:   "border-outline-variant/30 bg-surface-container",
    amber:    "border-outline-variant/30 bg-surface-container",
    slate:    "border-outline-variant/30 bg-surface-container",
  };
  const text = {
    electric: "text-electric-700",
    emerald:  "text-on-surface",
    violet:   "text-on-surface",
    amber:    "text-on-surface",
    slate:    "text-on-surface",
  };
  return (
    <div className={`rounded-xl border p-3 ${ring[color] ?? ring.slate}`}>
      <p className="text-[11px] text-on-surface-variant mb-0.5">{label}</p>
      <p className={`font-headline text-xl font-bold ${text[color] ?? text.slate}`}>
        {value ?? "—"}
        {value != null && <span className="text-sm font-medium ml-1">{unit}</span>}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ECharts option builders
// ─────────────────────────────────────────────────────────────────────────────

function buildElzChart(result) {
  const time = (result?.time_s ?? []).map((t) => `${Math.round(t / 60)} min`);
  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { data: ["ELZ Power (kW)", "H₂ Production (Nm³/h)"], bottom: 0, textStyle: { fontSize: 11 } },
    grid: { top: 24, bottom: 48, left: 48, right: 52 },
    xAxis: { type: "category", data: time, axisLabel: { fontSize: 10 } },
    yAxis: [
      { type: "value", name: "kW",      nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
      { type: "value", name: "Nm³/h",   nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 }, splitLine: { show: false } },
    ],
    series: [
      {
        name: "ELZ Power (kW)",
        type: "line",
        data: result?.electrolyzer_power_kw ?? [],
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#6b7280", width: 2 },
        areaStyle: { color: "rgba(107,114,128,0.08)" },
        yAxisIndex: 0,
      },
      {
        name: "H₂ Production (Nm³/h)",
        type: "line",
        data: result?.h2_production_nm3h ?? [],
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#9ca3af", width: 2 },
        areaStyle: { color: "rgba(156,163,175,0.06)" },
        yAxisIndex: 1,
      },
    ],
  };
}

function buildTankChart(result) {
  const time = (result?.time_s ?? []).map((t) => `${Math.round(t / 60)} min`);
  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { data: ["Tank Pressure (bar)"], bottom: 0, textStyle: { fontSize: 11 } },
    grid: { top: 24, bottom: 48, left: 52, right: 20 },
    xAxis: { type: "category", data: time, axisLabel: { fontSize: 10 } },
    yAxis: { type: "value", name: "bar", axisLabel: { fontSize: 10 }, nameTextStyle: { fontSize: 10 } },
    series: [
      {
        name: "Tank Pressure (bar)",
        type: "line",
        data: result?.tank_pressure_bar ?? [],
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#6b7280", width: 2 },
        areaStyle: { color: "rgba(107,114,128,0.08)" },
      },
    ],
  };
}

function buildFcChart(result) {
  const time = (result?.time_s ?? []).map((t) => `${Math.round(t / 60)} min`);
  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { data: ["Terminal Voltage (V)", "Current Density (A/cm²)"], bottom: 0, textStyle: { fontSize: 11 } },
    grid: { top: 24, bottom: 48, left: 52, right: 60 },
    xAxis: { type: "category", data: time, axisLabel: { fontSize: 10 } },
    yAxis: [
      { type: "value", name: "V",      axisLabel: { fontSize: 10 }, nameTextStyle: { fontSize: 10 } },
      { type: "value", name: "A/cm²",  axisLabel: { fontSize: 10 }, nameTextStyle: { fontSize: 10 }, splitLine: { show: false } },
    ],
    series: [
      {
        name: "Terminal Voltage (V)",
        type: "line",
        data: result?.fc_terminal_voltage_v ?? [],
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#6b7280", width: 2 },
        yAxisIndex: 0,
      },
      {
        name: "Current Density (A/cm²)",
        type: "line",
        data: result?.fc_current_density_acm2 ?? [],
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#9ca3af", width: 2, type: "dashed" },
        yAxisIndex: 1,
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// localStorage helpers — persist user choices across navigation
// (The component unmounts on every route switch, so React state alone is not
// enough; we need to survive the unmount/remount cycle.)
// ─────────────────────────────────────────────────────────────────────────────
const LS_PREFIX = "h2dash_";
function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw != null ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function saveLS(key, val) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch { /* quota / private mode */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const SIM_STATES = { IDLE: "idle", QUEUED: "queued", RUNNING: "running", DONE: "done", ERROR: "error" };

export default function HydrogenPlantDashboard() {
  // ── Active simulation type (extendable) ────────────────────────────────
  const [simType, setSimType] = useState("h2");

  // ── Service health + simulation lifecycle (state machine in useUnitSimulation) ──
  const {
    simState, progress, result, errorMsg,
    health, healthError, pingHealth, run, stop, reset,
  } = useUnitSimulation(checkHealth);

  // ── Parameters  (restored from localStorage on every mount) ──────────────
  // H₂ Power Plant parameters
  const [elz, setElz] = useState(() => {
    const saved = loadLS("elz", { grid_power_kw: 10000, water_flow_rate_lpm: 90, temperature_c: 70 });
    if (saved.grid_power_kw != null && saved.grid_power_kw <= 300) {
      return { ...saved, grid_power_kw: 10000 };
    }
    return saved;
  });
  const [sto, setSto] = useState(() => loadLS("sto", { compressor_efficiency: 0.78, max_tank_pressure_bar: 350 }));
  const [fc,  setFc]  = useState(() => loadLS("fc",  { h2_flow_rate_nm3h: 40, oxidant_pressure_bar: 2.5, cooling_capacity_kw: 35 }));
  const [sim, setSim] = useState(() => {
    const saved = loadLS("sim", null);
    if (!saved || saved.t_end_s <= 7200) return { t_end_s: 86400, dt_s: 900 };
    return saved;
  });
  const [timeAdvanced, setTimeAdvanced] = useState(() => {
    const saved = loadLS("simAdvancedTime", null);
    return { ...DEFAULT_TIME_ADVANCED, ...(saved ?? {}) };
  });
  
  // CCS parameters (separate state for Carbon Capture System)
  const [ccsSource, setCcsSource] = useState(() => loadLS("ccsSource", {
    capacity_kw: 400000,
    efficiency_pct: 58,
    co2_emission_kg_kwh: 0.38,
    flue_gas_temp_c: 120,
    co2_concentration_pct: 12,
  }));
  const [ccsAbsorber, setCcsAbsorber] = useState(() => loadLS("ccsAbsorber", {
    capture_rate_pct: 90,
    energy_requirement_gj_tco2: 3.7,
    solvent_flow_rate_m3_h: 150,
    absorption_temp_c: 40,
    l_g_ratio: 3.5,
  }));
  const [ccsStripper, setCcsStripper] = useState(() => loadLS("ccsStripper", {
    reboiler_temp_c: 120,
    steam_pressure_bar: 3.5,
    thermal_efficiency_pct: 82,
    energy_input_gj_tco2: 3.2,
  }));
  const [ccsCompressor, setCcsCompressor] = useState(() => loadLS("ccsCompressor", {
    target_pressure_bar: 110,
    number_stages: 4,
    isentropic_efficiency_pct: 82,
    intercooling_temp_c: 35,
  }));
  const [ccsStorage, setCcsStorage] = useState(() => loadLS("ccsStorage", {
    injection_rate_mtco2_yr: 5,
    reservoir_depth_m: 1500,
    reservoir_pressure_bar: 150,
    permeability_md: 200,
    porosity_pct: 18,
    injection_efficiency_pct: 99,
  }));

  // ── Technology model catalogue (opentech-db / fallback) ───────────────────
  const [models,         setModels]         = useState({});
  const [selectedModels, setSelectedModels] = useState(() => loadLS("selectedModels", {}));
  
  // CCS-specific models (separate from H₂) — pre-seeded with fallback catalog so pickers are immediately visible
  const [ccsModels, setCcsModels] = useState(CCS_FALLBACK_CATALOG);
  const [selectedCcsModels, setSelectedCcsModels] = useState(() => {
    const saved = loadLS("selectedCcsModels", {});
    // Pre-select best from fallback catalog for any slot not already saved
    const bestFromFallback = Object.fromEntries(
      Object.entries(CCS_FALLBACK_CATALOG).map(([k, list]) => [k, getBestCCSModel(list)])
    );
    return { ...bestFromFallback, ...saved };
  });

  // ── Persist user selections & parameters to localStorage ──────────────────
  // Runs whenever any user-controlled value changes so navigation away and back
  // restores exactly the state the user left.
  useEffect(() => {
    saveLS("selectedModels", selectedModels);
  }, [selectedModels]);
  useEffect(() => { saveLS("elz", elz); }, [elz]);
  useEffect(() => { saveLS("sto", sto); }, [sto]);
  useEffect(() => { saveLS("fc",  fc);  }, [fc]);
  useEffect(() => { saveLS("sim", sim); }, [sim]);
  useEffect(() => { saveLS("simAdvancedTime", timeAdvanced); }, [timeAdvanced]);
  
  // Save CCS params
  useEffect(() => { saveLS("ccsSource", ccsSource); }, [ccsSource]);
  useEffect(() => { saveLS("ccsAbsorber", ccsAbsorber); }, [ccsAbsorber]);
  useEffect(() => { saveLS("ccsStripper", ccsStripper); }, [ccsStripper]);
  useEffect(() => { saveLS("ccsCompressor", ccsCompressor); }, [ccsCompressor]);
  useEffect(() => { saveLS("ccsStorage", ccsStorage); }, [ccsStorage]);
  useEffect(() => { saveLS("selectedCcsModels", selectedCcsModels); }, [selectedCcsModels]);

  // ── Load tech-model catalogue from opentech-db (with fallback) ────────────
  // H₂ models
  useEffect(() => {
    let alive = true;
    Promise.all(
      Object.keys(H2_SLOTS).map(async (k) => {
        const list = await fetchH2Models(k);
        return [k, list];
      })
    ).then((entries) => {
      if (!alive) return;
      const m    = Object.fromEntries(entries);
      const best = Object.fromEntries(entries.map(([k, list]) => [k, getBestModel(list)]));
      setModels(m);
      // Merge: only fill slots the user hasn't already chosen.
      // Without this, navigating away and back would reset user's selections.
      setSelectedModels((prev) => {
        const merged = { ...best };
        Object.entries(prev).forEach(([k, v]) => { if (v) merged[k] = v; });
        return merged;
      });
    });
    return () => { alive = false; };
  }, []);
  
  // CCS models
  useEffect(() => {
    let alive = true;
    Promise.all(
      Object.keys(CCS_SLOTS).map(async (k) => {
        const list = await fetchCCSModels(k);
        return [k, list];
      })
    ).then((entries) => {
      if (!alive) return;
      const m    = Object.fromEntries(entries);
      const best = Object.fromEntries(entries.map(([k, list]) => [k, getBestCCSModel(list)]));
      setCcsModels(m);
      setSelectedCcsModels((prev) => {
        const merged = { ...best };
        Object.entries(prev).forEach(([k, v]) => { if (v) merged[k] = v; });
        return merged;
      });
    });
    return () => { alive = false; };
  }, []);

  const handleSelectModel = useCallback((slotKey, model) => {
    setSelectedModels((p) => ({ ...p, [slotKey]: model }));
    const patch = applyModelParams(slotKey, model);
    if (!patch) return;
    if (slotKey === "source" || slotKey === "electrolyzer") setElz((p) => ({ ...p, ...patch }));
    if (slotKey === "compressor" || slotKey === "storage")  setSto((p) => ({ ...p, ...patch }));
    if (slotKey === "fuel_cell")                            setFc((p)  => ({ ...p, ...patch }));
  }, []);
  
  const handleSelectCcsModel = useCallback((slotKey, model) => {
    setSelectedCcsModels((p) => ({ ...p, [slotKey]: model }));
    const patch = applyCCSParams(slotKey, model);
    if (!patch) return;
    if (slotKey === "source")      setCcsSource((p) => ({ ...p, ...patch }));
    if (slotKey === "absorber")    setCcsAbsorber((p) => ({ ...p, ...patch }));
    if (slotKey === "stripper")    setCcsStripper((p) => ({ ...p, ...patch }));
    if (slotKey === "compressor")  setCcsCompressor((p) => ({ ...p, ...patch }));
    if (slotKey === "storage")     setCcsStorage((p) => ({ ...p, ...patch }));
  }, []);

  // ── Node detail panel (click any node in the PFD to open its analysis) ────
  const [activeNodeId, setActiveNodeId] = useState(null);
  const handleNodeClick = useCallback((_evt, node) => {
    setActiveNodeId((prev) => (prev === node.id ? null : node.id));
  }, []);

  // ── Custom CSV production profile for the Power Source node ──────────────
  const [customProfile, setCustomProfile] = useState(null);

  // ── Tech variants (lifecycle/year projections from opentech-db) ──────────
  const [variants, setVariants] = useState({});

  // Fetch variants whenever the source model changes
  const sourceModelId = selectedModels?.source?.id;
  useEffect(() => {
    if (!sourceModelId) return;
    fetchH2Variants(sourceModelId, selectedModels?.source)
      .then((v) => setVariants((p) => ({ ...p, source: v })));
  }, [sourceModelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch variants for the electrolyzer model
  const elzModelId = selectedModels?.electrolyzer?.id;
  useEffect(() => {
    if (!elzModelId) return;
    fetchH2Variants(elzModelId, selectedModels?.electrolyzer)
      .then((v) => setVariants((p) => ({ ...p, electrolyzer: v })));
  }, [elzModelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Local param overrides from the generator panel constraints editor
  const [genParamOverrides, setGenParamOverrides] = useState(() => loadLS("genParams", {}));
  // Local param overrides from the electrolyzer panel constraints editor
  const [elzParamOverrides, setElzParamOverrides] = useState(() => {
    const saved = loadLS("elzParams", {});
    const cap = Number(saved?.capacity_kw);
    // Legacy localStorage often carried a tiny 300 kW ELZ override.
    // Remove it so source-driven sizing can propagate through the chain.
    if (Number.isFinite(cap) && cap > 0 && cap <= 300) {
      const { capacity_kw, ...rest } = saved;
      return rest;
    }
    return saved;
  });
  
  // CCS parameter overrides (from CCS panels)
  const [ccsSourceParamOverrides, setCcsSourceParamOverrides] = useState(() => loadLS("ccsSourceParams", {}));
  const [ccsAbsorberParamOverrides, setCcsAbsorberParamOverrides] = useState(() => loadLS("ccsAbsorberParams", {}));
  const [ccsStripperParamOverrides, setCcsStripperParamOverrides] = useState(() => loadLS("ccsStripperParams", {}));
  const [ccsCompressorParamOverrides, setCcsCompressorParamOverrides] = useState(() => loadLS("ccsCompressorParams", {}));
  const [ccsStorageParamOverrides, setCcsStorageParamOverrides] = useState(() => loadLS("ccsStorageParams", {}));

  // Persist overrides too
  useEffect(() => { saveLS("genParams", genParamOverrides); }, [genParamOverrides]);
  useEffect(() => { saveLS("elzParams", elzParamOverrides); }, [elzParamOverrides]);
  useEffect(() => { saveLS("ccsSourceParams", ccsSourceParamOverrides); }, [ccsSourceParamOverrides]);
  useEffect(() => { saveLS("ccsAbsorberParams", ccsAbsorberParamOverrides); }, [ccsAbsorberParamOverrides]);
  useEffect(() => { saveLS("ccsStripperParams", ccsStripperParamOverrides); }, [ccsStripperParamOverrides]);
  useEffect(() => { saveLS("ccsCompressorParams", ccsCompressorParamOverrides); }, [ccsCompressorParamOverrides]);
  useEffect(() => { saveLS("ccsStorageParams", ccsStorageParamOverrides); }, [ccsStorageParamOverrides]);

  // ── Payload preview (must come after all state it depends on) ────────────
  const [showPayloadPreview, setShowPayloadPreview] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => loadLS("h2RightSidebarCollapsed", false));
  const activeSourceVariant = variants?.source?.find((variant) => variant.id === genParamOverrides?._variantId) ?? null;
  const previewPayload = useMemo(() => {
    if (simType === "h2") {
      return buildSimPayload({
        selectedModels,
        sourceVariant: activeSourceVariant,
        genParamOverrides,
        elzParamOverrides,
        elz,
        sto,
        fc,
        sim,
        customProfile,
      });
    } else if (simType === "ccs") {
      return buildCCSPayload({
        selectedModels,
        sim,
        source: { tech_type: "gas_ccgt", capacity_kw: 400000, efficiency_pct: 58, co2_emission_kg_kwh: 0.35 },
        absorber: { capture_rate_pct: 90, energy_requirement_gj_tco2: 3.7, solvent_flow_rate_m3h: 500, absorption_temp_c: 40 },
        stripper: { thermal_efficiency_pct: 82, reboiler_temp_c: 120, steam_pressure_bar: 3.5 },
        compressor: { isentropic_efficiency_frac: 0.82, inlet_pressure_bar: 1.5, target_pressure_bar: 110 },
        storage: { injection_rate_mtco2_yr: 5, storage_depth_m: 1500, reservoir_pressure_bar: 150, storage_efficiency_pct: 99 },
      });
    }
    return null;
  }, [simType, selectedModels, activeSourceVariant, genParamOverrides, elzParamOverrides, elz, sto, fc, sim, customProfile]);

  useEffect(() => {
    saveLS("h2RightSidebarCollapsed", !!rightSidebarCollapsed);
  }, [rightSidebarCollapsed]);

  // ── Sync generator capacity override → ELZ grid_power_kw ─────────────────
  // The generator feeds the electrolyzer — updating generator capacity should
  // immediately reflect in the ELZ input power shown in the flow diagram.
  useEffect(() => {
    const cap = genParamOverrides?.capacity_kw;
    if (cap != null && isFinite(Number(cap))) {
      setElz((p) => ({ ...p, grid_power_kw: Number(cap) }));
    }
  }, [genParamOverrides?.capacity_kw]); // eslint-disable-line react-hooks/exhaustive-deps

  // If a large source model is selected, ignore legacy/tiny generator capacity
  // overrides that would clamp the whole chain to a few hundred kW.
  useEffect(() => {
    const modelCap = getModelCapacityKw(selectedModels?.source);
    const overrideCap = Number(genParamOverrides?.capacity_kw);
    if (!isFinite(modelCap) || modelCap <= 5000) return;
    if (!isFinite(overrideCap) || overrideCap > 1000) return;

    setGenParamOverrides((p) => {
      if (!p || p.capacity_kw == null) return p;
      const { capacity_kw, ...rest } = p;
      return rest;
    });
  }, [selectedModels?.source?.id, selectedModels?.source?.capacity_kw, genParamOverrides?.capacity_kw]); // eslint-disable-line react-hooks/exhaustive-deps

  // If the selected source is large but a legacy ELZ panel override still clamps
  // capacity to <=300 kW, drop that override so payload sizing uses source capacity.
  useEffect(() => {
    const srcCap = Number(genParamOverrides?.capacity_kw) || getModelCapacityKw(selectedModels?.source);
    const elzOverrideCap = Number(elzParamOverrides?.capacity_kw);
    if (!isFinite(srcCap) || srcCap <= 5000) return;
    if (!isFinite(elzOverrideCap) || elzOverrideCap > 300) return;

    setElzParamOverrides((p) => {
      if (!p || p.capacity_kw == null) return p;
      const { capacity_kw, ...rest } = p;
      return rest;
    });
  }, [genParamOverrides?.capacity_kw, selectedModels?.source?.id, selectedModels?.source?.capacity_kw, elzParamOverrides?.capacity_kw]); // eslint-disable-line react-hooks/exhaustive-deps

  // If the user picks a generation template but hasn't overridden capacity,
  // default ELZ input power to the source capacity so template power is reflected.
  useEffect(() => {
    const hasManualGenCap = genParamOverrides?.capacity_kw != null && isFinite(Number(genParamOverrides.capacity_kw));
    if (hasManualGenCap) return;

    const srcCap = getModelCapacityKw(selectedModels?.source);
    if (!isFinite(srcCap) || srcCap <= 0) return;

    setElz((p) => ({ ...p, grid_power_kw: srcCap }));
  }, [selectedModels?.source?.id, selectedModels?.source?.capacity_kw, genParamOverrides?.capacity_kw]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep FC default H2 flow physically consistent with selected FC/template power.
  useEffect(() => {
    const srcCap = getModelCapacityKw(selectedModels?.source);
    const elzCap = Number(elz?.grid_power_kw);
    const fcCap = getModelCapacityKw(selectedModels?.fuel_cell);
    const fcRated = Math.max(
      isFinite(fcCap) && fcCap > 0 ? fcCap : 0,
      isFinite(srcCap) && srcCap > 0 ? srcCap * 0.25 : 0,
      isFinite(elzCap) && elzCap > 0 ? elzCap * 0.4 : 0
    );
    if (!isFinite(fcRated) || fcRated <= 0) return;

    setFc((p) => {
      const current = Number(p?.h2_flow_rate_nm3h);
      const isDefaultLike = !isFinite(current) || current <= 0;
      if (!isDefaultLike) return p;

      const eta = 0.58;
      const required = fcRated / (3.542 * eta);
      return { ...p, h2_flow_rate_nm3h: Math.round(required) };
    });
  }, [selectedModels?.fuel_cell?.id, selectedModels?.fuel_cell?.capacity_kw, selectedModels?.source?.id, selectedModels?.source?.capacity_kw, elz?.grid_power_kw]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync ELZ efficiency override → elz state (sent to simulation service) ────────────
  useEffect(() => {
    const eff = elzParamOverrides?.efficiency_pct;
    if (eff != null && isFinite(Number(eff))) {
      setElz((p) => ({ ...p, efficiency_pct: Number(eff) }));
    }
  }, [elzParamOverrides?.efficiency_pct]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Run simulation ────────────────────────────────────────────────────────
  const handleRun = () => run(() => {
      // ── Build the canonical v2.0 simulation payload ──────────────────────
      // Choose the correct payload builder and service based on simType
      let payload, runFn, normalizeFn;

      if (simType === "h2") {
        payload = buildSimPayload({
          selectedModels,
          sourceVariant: activeSourceVariant,
          genParamOverrides,
          elzParamOverrides,
          elz,
          sto,
          fc,
          sim,
          customProfile,
        });
        runFn = runSimulation;
        normalizeFn = normalizeSimResult;
      } else if (simType === "ccs") {
        // Merge selected models with parameter overrides
        const sourceMerged = { ...selectedCcsModels?.source, ...ccsSourceParamOverrides };
        const absorberMerged = { ...selectedCcsModels?.absorber, ...ccsAbsorberParamOverrides };
        const stripperMerged = { ...selectedCcsModels?.stripper, ...ccsStripperParamOverrides };
        const compressorMerged = { ...selectedCcsModels?.compressor, ...ccsCompressorParamOverrides };
        const storageMerged = { ...selectedCcsModels?.storage, ...ccsStorageParamOverrides };

        payload = buildCCSPayload({
          selectedModels: selectedCcsModels,
          sim,
          source: {
            tech_type: sourceMerged.id ?? "gas_ccgt",
            capacity_kw: sourceMerged.capacity_kw ?? ccsSource.capacity_kw,
            efficiency_pct: sourceMerged.efficiency_pct ?? ccsSource.efficiency_pct,
            co2_emission_kg_kwh: sourceMerged.co2_emission_kg_kwh ?? ccsSource.co2_emission_kg_kwh,
            flue_gas_temp_c: sourceMerged.flue_gas_temp_c ?? ccsSource.flue_gas_temp_c,
            co2_concentration_pct: sourceMerged.co2_concentration_pct ?? ccsSource.co2_concentration_pct,
          },
          absorber: {
            capture_rate_pct: absorberMerged.capture_rate_pct ?? ccsAbsorber.capture_rate_pct,
            energy_requirement_gj_tco2: absorberMerged.energy_requirement_gj_tco2 ?? ccsAbsorber.energy_requirement_gj_tco2,
            solvent_flow_rate_m3h: absorberMerged.solvent_flow_rate_m3_h ?? ccsAbsorber.solvent_flow_rate_m3_h,
            absorption_temp_c: absorberMerged.absorption_temp_c ?? ccsAbsorber.absorption_temp_c,
            l_g_ratio: absorberMerged.l_g_ratio ?? ccsAbsorber.l_g_ratio,
          },
          stripper: {
            thermal_efficiency_pct: stripperMerged.thermal_efficiency_pct ?? ccsStripper.thermal_efficiency_pct,
            reboiler_temp_c: stripperMerged.reboiler_temp_c ?? ccsStripper.reboiler_temp_c,
            steam_pressure_bar: stripperMerged.steam_pressure_bar ?? ccsStripper.steam_pressure_bar,
            energy_input_gj_tco2: stripperMerged.energy_input_gj_tco2 ?? ccsStripper.energy_input_gj_tco2,
          },
          compressor: {
            isentropic_efficiency_frac: (compressorMerged.isentropic_efficiency_pct ?? ccsCompressor.isentropic_efficiency_pct) / 100,
            inlet_pressure_bar: 1.5,  // Atmospheric + slight pressurization from stripper
            target_pressure_bar: compressorMerged.target_pressure_bar ?? ccsCompressor.target_pressure_bar,
            number_stages: compressorMerged.number_stages ?? ccsCompressor.number_stages,
            intercooling_temp_c: compressorMerged.intercooling_temp_c ?? ccsCompressor.intercooling_temp_c,
          },
          storage: {
            injection_rate_mtco2_yr: storageMerged.injection_rate_mtco2_yr ?? ccsStorage.injection_rate_mtco2_yr,
            storage_depth_m: storageMerged.reservoir_depth_m ?? ccsStorage.reservoir_depth_m,
            reservoir_pressure_bar: storageMerged.reservoir_pressure_bar ?? ccsStorage.reservoir_pressure_bar,
            storage_efficiency_pct: storageMerged.injection_efficiency_pct ?? ccsStorage.injection_efficiency_pct,
            permeability_md: storageMerged.permeability_md ?? ccsStorage.permeability_md,
            porosity_pct: storageMerged.porosity_pct ?? ccsStorage.porosity_pct,
          },
        });
        runFn = runCCSSimulation;
        normalizeFn = normalizeCCSResult;
      } else {
        throw new Error(`Unknown simulation type: ${simType}`);
      }

    return { runFn, payload, normalize: normalizeFn };
  });

  const handleStop = stop;
  const handleReset = reset;

  // ── KPIs from result ──────────────────────────────────────────────────────
  const kpi = result?.kpi ?? null;

  const fmt = (v, d = 1) => (v != null ? Number(v).toFixed(d) : null);
  const srcTechType = detectSourceTechType(selectedModels?.source);
  const recommendedDt = useMemo(() => suggestDtSeconds(sim.t_end_s, srcTechType), [sim.t_end_s, srcTechType]);
  const strategyDt = useMemo(() => {
    const tEnd = Math.max(3600, Number(sim.t_end_s) || 86400);
    const targetSamples = Math.max(24, Number(timeAdvanced.target_samples) || DEFAULT_TIME_ADVANCED.target_samples);

    if (timeAdvanced.resampling_strategy === "fixed") {
      return quantizeDtSeconds(sim.dt_s);
    }

    if (timeAdvanced.resampling_strategy === "rolling_window") {
      const rollingWindowSeconds = Math.max(86400, Number(timeAdvanced.rolling_window_days || 7) * 86400);
      const windowForResolution = Math.min(tEnd, rollingWindowSeconds);
      return quantizeDtSeconds(windowForResolution / targetSamples);
    }

    // adaptive
    return quantizeDtSeconds(tEnd / targetSamples);
  }, [sim.t_end_s, sim.dt_s, timeAdvanced.target_samples, timeAdvanced.rolling_window_days, timeAdvanced.resampling_strategy]);
  const sampleCount = useMemo(() => {
    const dt = Math.max(1, Number(sim.dt_s) || 1);
    const tEnd = Math.max(0, Number(sim.t_end_s) || 0);
    return Math.floor(tEnd / dt) + 1;
  }, [sim.dt_s, sim.t_end_s]);
  const performanceState = useMemo(() => {
    const soft = Math.max(500, Number(timeAdvanced.performance_soft_limit) || DEFAULT_TIME_ADVANCED.performance_soft_limit);
    const hard = Math.max(soft + 1, Number(timeAdvanced.performance_hard_limit) || DEFAULT_TIME_ADVANCED.performance_hard_limit);
    if (sampleCount >= hard) return "high";
    if (sampleCount >= soft) return "medium";
    return "ok";
  }, [sampleCount, timeAdvanced.performance_soft_limit, timeAdvanced.performance_hard_limit]);

  useEffect(() => {
    const tEnd = Math.max(3600, Number(sim.t_end_s) || 86400);
    const dt = Math.max(60, Number(sim.dt_s) || 900);
    const clampedDt = Math.min(dt, tEnd);
    if (clampedDt !== sim.dt_s) {
      setSim((p) => ({ ...p, dt_s: clampedDt }));
    }
  }, [sim.t_end_s, sim.dt_s]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!timeAdvanced.auto_apply) return;
    if (timeAdvanced.resampling_strategy === "fixed") return;
    if (!Number.isFinite(strategyDt) || strategyDt <= 0) return;
    if (strategyDt !== sim.dt_s) {
      setSim((p) => ({ ...p, dt_s: strategyDt }));
    }
  }, [timeAdvanced.auto_apply, timeAdvanced.resampling_strategy, strategyDt, sim.dt_s]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    // h-[calc(100vh-3.5rem)]: fill the viewport below the app's fixed 56px (pt-14) TopNavBar.
    // h-screen here overflows the app shell by the header height (double scrollbars).
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* ── Scrollable main content ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5 min-w-0">

      {/* ── Simulation switcher + service status ──────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Section label */}
        <div className="flex items-center gap-2 mr-2">
          <span className="p-1.5 rounded-lg bg-surface-container-high text-on-surface-variant"><FiZap size={15} /></span>
          <span className="font-bold text-on-surface text-sm tracking-wide uppercase">Tech Simulation</span>
        </div>

        {/* Type tabs */}
        {SIM_CATALOGUE.map((sim) => {
          const Icon = sim.icon;
          const isActive = simType === sim.id;
          return (
            <button
              key={sim.id}
              disabled={!sim.ready}
              title={sim.ready ? sim.subtitle : `${sim.label} — ${sim.subtitle}`}
              onClick={() => sim.ready && setSimType(sim.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold
                transition-all border
                ${ isActive
                    ? sim.active + " border-transparent"
                    : sim.ready
                      ? `${sim.bg} ${sim.color} border-transparent hover:border-outline-variant/30 hover:shadow-sm`
                      : "bg-surface-container text-on-surface-variant/50 border-outline-variant/20 cursor-not-allowed"
                  }`}
            >
              <Icon size={12} />
              {sim.label}
              {!sim.ready && <span className="text-[9px] font-normal opacity-60 ml-0.5">soon</span>}
            </button>
          );
        })}

        {/* Service status pill */}
        <button
          onClick={pingHealth}
          title={
            healthError
              ? `Error: ${healthError}`
              : health === null
                ? `Connecting to ${import.meta.env.VITE_H2_SERVICE_URL ?? "http://localhost:8765"}…`
                : health.engine_ready
                  ? `Engine ready · ${health._path ?? "/api/health"} · ${health.active_jobs ?? 0} active jobs`
                  : `Engine warming up · ${health.engine_error ?? "Simulation initializing"}`
          }
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium border
            transition-all hover:shadow-sm active:scale-95
            ${ healthError
                ? "bg-surface-container border-outline-variant/30 text-on-surface-variant"
                : health === null
                  ? "bg-surface-container border-outline-variant/30 text-on-surface-variant/70"
                  : health.engine_ready
                    ? "bg-surface-container border-outline-variant/30 text-on-surface"
                    : "bg-surface-container border-outline-variant/30 text-on-surface"
              }`}
        >
          { healthError      ? <FiWifiOff size={11} />
          : health === null  ? <FiWifi    size={11} className="animate-pulse" />
          : health.engine_ready ? <FiWifi size={11} />
                                : <FiClock size={11} className="animate-pulse" /> }
          { healthError         ? "Engine offline"
          : health === null     ? "Connecting…"
          : health.engine_ready ? "Engine ready"
                                : "Warming up…" }
          <FiRefreshCw size={10} className="opacity-50" />
        </button>
      </div>
      {/* ── Engine offline diagnostic banner ────────────────────────────────── */}
      {healthError && (
        <div className="rounded-2xl border border-outline-variant/30 bg-surface-container px-5 py-4 text-sm">
          <div className="flex items-start gap-3">
            <FiWifiOff className="mt-0.5 shrink-0 text-on-surface-variant" size={16} />
            <div className="flex-1">
              <p className="font-semibold text-on-surface mb-1">Cannot reach the simulation engine</p>
              <p className="text-on-surface-variant text-xs mb-3 font-mono break-all">
                Target: {import.meta.env.VITE_H2_SERVICE_URL ?? "http://localhost:8765"}
              </p>
              <ul className="text-on-surface-variant text-xs space-y-1 list-disc list-inside">
                <li><b>VPN / lab network</b> — the IP <code className="bg-surface-container-high px-1 rounded">{(import.meta.env.VITE_H2_SERVICE_URL ?? "").replace(/https?:\/\//, "").split(":")[0]}</code> is on a private subnet; connect to the VPN first.</li>
                <li><b>Docker not running</b> — on the server, run <code className="bg-surface-container-high px-1 rounded">docker compose up -d</code> and check <code className="bg-surface-container-high px-1 rounded">docker ps</code>.</li>
                <li><b>Wrong address</b> — update <code className="bg-surface-container-high px-1 rounded">VITE_H2_SERVICE_URL</code> in <code className="bg-surface-container-high px-1 rounded">.env</code>, then restart <code className="bg-surface-container-high px-1 rounded">npm run dev</code>.</li>
                <li><b>Run locally</b> — set <code className="bg-surface-container-high px-1 rounded">VITE_H2_SERVICE_URL=http://localhost:8765</code> and run the Docker container on this machine.</li>
              </ul>
            </div>
            <button onClick={pingHealth} title="Retry connection" className="shrink-0 p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant/70 transition-colors">
              <FiRefreshCw size={14} />
            </button>
          </div>
        </div>
      )}
      {/* ── Process Flow Diagram (Simulink-style interactive PFD) ──────────── */}
      {simType === "h2" && (
        <H2PlantFlowDiagram
          elz={elz} setElz={setElz}
          sto={sto} setSto={setSto}
          fc={fc}   setFc={setFc}
          simState={simState}
          kpi={kpi}
          models={models}
          selectedModels={selectedModels}
          onSelectModel={handleSelectModel}
          activeNodeId={activeNodeId}
          onNodeClick={handleNodeClick}
          customProfile={customProfile}
          onSetCustomProfile={setCustomProfile}
          genParamOverrides={genParamOverrides}
        />
      )}

      {simType === "ccs" && (
        <CCSFlowDiagram
          result={result}
          isRunning={simState === SIM_STATES.RUNNING}
          onNodeClick={(nodeId) => setActiveNodeId(nodeId)}
          ccsModels={ccsModels}
          selectedCcsModels={selectedCcsModels}
          onSelectCcsModel={handleSelectCcsModel}
          simState={simState}
          ccsSource={ccsSource}
          ccsAbsorber={ccsAbsorber}
          ccsStripper={ccsStripper}
          ccsCompressor={ccsCompressor}
          ccsStorage={ccsStorage}
          onSourceChange={setCcsSource}
          onAbsorberChange={setCcsAbsorber}
          onStripperChange={setCcsStripper}
          onCompressorChange={setCcsCompressor}
          onStorageChange={setCcsStorage}
        />
      )}

      {/* ── Node detail modals (portal → always on top) ─────────────────────── */}

      {/* Generator / power-source node */}
      <H2NodeModal
        open={activeNodeId === "grid"}
        onClose={() => setActiveNodeId(null)}
        title={selectedModels?.source?.name ?? "Power Source Analysis"}
        subtitle="Technology profile · energy conversion chain · simulation overlay"
        icon={<FiZap size={18} />}
        accentColor="bg-primary"
      >
        <H2GeneratorPanel
          selectedModel={selectedModels?.source}
          elzModel={selectedModels?.electrolyzer}
          elzParams={elz}
          result={result}
          simState={simState}
          customProfile={customProfile}
          variants={variants?.source}
          savedParams={genParamOverrides}
          onParamsChange={setGenParamOverrides}
        />
      </H2NodeModal>

      {/* Electrolyzer node */}
      <H2NodeModal
        open={activeNodeId === "electrolyzer"}
        onClose={() => setActiveNodeId(null)}
        title={selectedModels?.electrolyzer?.name ?? "Electrolyzer Analysis"}
        subtitle="Partial-load efficiency · H₂ production · constraints"
        icon={<FiZap size={18} />}
        accentColor="bg-primary"
      >
        <H2ElectrolyzerPanel
          selectedModel={selectedModels?.electrolyzer}
          savedParams={elzParamOverrides}
          genTechType={detectSourceTechType(selectedModels?.source)}
          genCapacityKw={(() => {
            // Prefer the user-overridden capacity from the generator panel;
            // fall back to the robust parsed value from the base model.
            const overridden = Number(genParamOverrides?.capacity_kw);
            if (isFinite(overridden) && overridden > 0) return overridden;
            return getModelCapacityKw(selectedModels?.source) ?? undefined;
          })()}
          result={result}
          simState={simState}
          variants={variants?.electrolyzer}
          onParamsChange={setElzParamOverrides}
        />
      </H2NodeModal>

        {/* ── Energy Evolution Charts ──────────────────────────────────────── */}
        {simType === "h2" && (
          <H2EnergyCharts
            result={result}
            simState={simState}
            progress={progress}
            sourceName={selectedModels?.source?.name}
            requestedSourceProfile={previewPayload?.source?.profile ?? []}
          />
        )}

        {simType === "ccs" && (
          <CCSEnergyCharts
            result={result}
          />
        )}

        {/* ── Idle placeholder ──────────────────────────────────────────────── */}
        {simState === SIM_STATES.IDLE && (
          <Card className="p-12 flex flex-col items-center justify-center text-center gap-4">
            <div className="p-5 rounded-full bg-surface-container border border-outline-variant/20">
              <FiZap size={32} className="text-on-surface-variant/50" />
            </div>
            <div>
              <p className="font-semibold text-on-surface">Configure parameters and run the simulation</p>
              <p className="text-sm text-on-surface-variant/70 mt-1">Results will appear in the flow diagram and charts above once the computation finishes.</p>
            </div>
          </Card>
        )}

      </div>
      {/* ── END scrollable main content ──────────────────────────────────── */}

      {/* ── Right sidebar — full-height collapsible ──────────────────────── */}
      <div className={`flex-shrink-0 transition-all duration-300 bg-surface-container-lowest border-l border-outline-variant/30 flex flex-col overflow-hidden ${rightSidebarCollapsed ? "w-14" : "w-96"}`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-outline-variant/30 flex-shrink-0">
          {!rightSidebarCollapsed && (
            <div className="flex items-center gap-2">
              <FiClock className="text-on-surface" size={18} />
              <h2 className="text-sm font-semibold text-on-surface">Simulation Settings</h2>
            </div>
          )}
          <button
            onClick={() => setRightSidebarCollapsed((p) => !p)}
            className={`p-2 hover:bg-surface-container-high rounded-lg transition-colors ${rightSidebarCollapsed ? "mx-auto" : "ml-auto"}`}
            title={rightSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {rightSidebarCollapsed ? <FiChevronRight size={18} /> : <FiChevronRight size={18} className="rotate-180" />}
          </button>
        </div>

        {/* Body */}
        {!rightSidebarCollapsed ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* ── Run Controls ──────────────────────────────────────────── */}
            <Card className="p-4">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-on-surface">Simulation Controls</p>
                  <p className="text-[11px] text-on-surface-variant mt-0.5">{sampleCount.toLocaleString()} samples · {formatDuration(sim.t_end_s)} · Δt {Math.round(sim.dt_s / 60)} min</p>
                </div>

                {/* Horizon presets */}
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Horizon</label>
                  <div className="flex flex-wrap gap-1.5">
                    {HORIZON_PRESETS.map((preset) => {
                      const active = sim.t_end_s === preset.t_end_s;
                      return (
                        <button
                          key={preset.id}
                          onClick={() => setSim((p) => ({ ...p, t_end_s: preset.t_end_s, dt_s: suggestDtSeconds(preset.t_end_s, srcTechType) }))}
                          className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                            active ? "bg-primary border-gray-700 text-white" : "bg-surface-container-lowest border-outline-variant/30 text-on-surface-variant hover:bg-surface-container"
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Horizon + interval inputs */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-outline-variant/30 bg-surface-container/50 p-2">
                    <label className="block text-[11px] font-medium text-on-surface-variant mb-1">Horizon (s)</label>
                    <input
                      type="number" min={3600} max={31536000} step={3600}
                      value={sim.t_end_s}
                      onChange={(e) => setSim((p) => ({ ...p, t_end_s: +e.target.value }))}
                      className="w-full border border-outline-variant/30 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-electric-400 bg-surface-container-lowest"
                    />
                    <p className="text-[10px] text-on-surface-variant/70 mt-1">{formatDuration(sim.t_end_s)}</p>
                  </div>
                  <div className="rounded-lg border border-outline-variant/30 bg-surface-container/50 p-2">
                    <label className="block text-[11px] font-medium text-on-surface-variant mb-1">Interval (s)</label>
                    <input
                      type="number" min={60} max={86400} step={60}
                      value={sim.dt_s}
                      onChange={(e) => setSim((p) => ({ ...p, dt_s: +e.target.value }))}
                      className="w-full border border-outline-variant/30 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-electric-400 bg-surface-container-lowest"
                    />
                    <button
                      onClick={() => setSim((p) => ({ ...p, dt_s: recommendedDt }))}
                      className="mt-1 w-full text-center px-1.5 py-0.5 rounded text-[10px] border border-outline-variant/30 text-on-surface-variant bg-surface-container hover:bg-surface-container-high"
                    >
                      Auto ({Math.round(recommendedDt / 60)} min)
                    </button>
                  </div>
                </div>

                {/* DT presets */}
                <div className="flex flex-wrap gap-1">
                  {DT_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => setSim((prev) => ({ ...prev, dt_s: p.value }))}
                      className="px-2 py-0.5 rounded text-[10px] border border-outline-variant/30 text-on-surface-variant bg-surface-container-lowest hover:bg-surface-container"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Run / Stop / Clear */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {simState === SIM_STATES.IDLE || simState === SIM_STATES.DONE || simState === SIM_STATES.ERROR ? (
                    <button
                      onClick={handleRun}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                        bg-gradient-to-r from-electric-500 to-electric-600 text-white font-semibold text-sm
                        shadow-md hover:shadow-lg hover:from-electric-600 hover:to-electric-700 transition-all active:scale-95"
                    >
                      <FiPlay size={14} />
                      {simState === SIM_STATES.DONE ? "Re-run" : "Run Simulation"}
                    </button>
                  ) : (
                    <button
                      onClick={handleStop}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                        bg-primary hover:bg-primary-container text-white font-semibold text-sm
                        shadow-md hover:shadow-lg transition-all active:scale-95"
                    >
                      <FiStopCircle size={14} />
                      Stop
                    </button>
                  )}
                  {(simState === SIM_STATES.DONE || simState === SIM_STATES.ERROR) && (
                    <button
                      onClick={handleReset}
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-outline-variant/30
                        text-on-surface-variant text-sm font-medium hover:bg-surface-container-high transition-all active:scale-95 bg-surface-container-lowest"
                    >
                      <FiRefreshCw size={13} />
                    </button>
                  )}
                </div>

                {/* Progress bar */}
                {(simState === SIM_STATES.QUEUED || simState === SIM_STATES.RUNNING) && (
                  <div>
                    <div className="flex justify-between text-xs text-on-surface-variant mb-1">
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-electric-400 animate-pulse" />
                        {simState === SIM_STATES.QUEUED ? "Queued…" : `Running ${progress.toFixed(0)}%`}
                      </span>
                      <span>{progress.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
                      <div
                        className="h-2 bg-gradient-to-r from-electric-400 to-electric-600 rounded-full transition-all duration-500"
                        style={{ width: `${simState === SIM_STATES.QUEUED ? 3 : progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Done banner */}
                {simState === SIM_STATES.DONE && (
                  <div className={`flex items-start gap-2 text-xs rounded-xl px-3 py-2 border ${
                    result?._local ? 'text-on-surface bg-surface-container border-outline-variant/30' : 'text-on-surface bg-surface-container border-outline-variant/30'
                  }`}>
                    <FiCheckCircle className="mt-0.5 shrink-0" size={13} />
                    <span>{result?._local ? `Local sim complete — ${result?.time_s?.length ?? 0} steps.` : `Done — ${result?.time_s?.length ?? 0} pts.`}</span>
                  </div>
                )}

                {/* Error banner */}
                {simState === SIM_STATES.ERROR && (
                  <div className="flex items-start gap-2 text-on-surface text-xs bg-surface-container border border-outline-variant/30 rounded-xl px-3 py-2">
                    <FiAlertCircle className="mt-0.5 shrink-0" size={13} />
                    <span><strong>Error:</strong> {errorMsg}</span>
                  </div>
                )}

                {/* Payload inspect */}
                <div className="border border-outline-variant/30 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setShowPayloadPreview((p) => !p)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-surface-container hover:bg-surface-container-high transition-colors text-xs font-medium text-on-surface-variant"
                  >
                    <span className="flex items-center gap-1.5"><FiInfo size={11} className="text-on-surface-variant" />Payload (v2.0)</span>
                    <span className="text-on-surface-variant/70 font-mono">{showPayloadPreview ? '▲' : '▼'}</span>
                  </button>
                  {showPayloadPreview && (
                    <div className="bg-slate-900 text-slate-100 p-3 max-h-48 overflow-auto">
                      <pre className="text-[10px] leading-relaxed font-mono whitespace-pre-wrap break-all">
                        {JSON.stringify(previewPayload, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {/* ── Advanced Time Settings ─────────────────────────────────── */}
            <Card className="p-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-on-surface">Advanced Time Settings</p>
                    <p className="text-xs text-on-surface-variant mt-0.5">Control sampling density, strategy, and performance behavior for long-horizon simulations.</p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-on-surface-variant shrink-0">
                    <input
                      type="checkbox"
                      checked={!!timeAdvanced.auto_apply}
                      onChange={(e) => setTimeAdvanced((p) => ({ ...p, auto_apply: e.target.checked }))}
                      className="rounded border-outline-variant/40 text-on-surface-variant focus:ring-gray-500"
                    />
                    Auto-apply
                  </label>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-on-surface-variant mb-1">Target number of samples</label>
                    <input
                      type="number"
                      min={24}
                      max={50000}
                      step={24}
                      value={timeAdvanced.target_samples}
                      onChange={(e) => setTimeAdvanced((p) => ({ ...p, target_samples: Math.max(24, Number(e.target.value) || 24) }))}
                      className="w-full border border-outline-variant/30 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-on-surface-variant mb-1">Auto-resample strategy</label>
                    <select
                      value={timeAdvanced.resampling_strategy}
                      onChange={(e) => setTimeAdvanced((p) => ({ ...p, resampling_strategy: e.target.value }))}
                      className="w-full border border-outline-variant/30 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    >
                      <option value="fixed">Fixed interval</option>
                      <option value="adaptive">Adaptive (target-based)</option>
                      <option value="rolling_window">Rolling window (recent detail)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-on-surface-variant mb-1">Rolling window horizon (days)</label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      step={1}
                      value={timeAdvanced.rolling_window_days}
                      disabled={timeAdvanced.resampling_strategy !== "rolling_window"}
                      onChange={(e) => setTimeAdvanced((p) => ({ ...p, rolling_window_days: Math.max(1, Number(e.target.value) || 1) }))}
                      className="w-full border border-outline-variant/30 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:bg-surface-container-high disabled:text-on-surface-variant/70"
                    />
                  </div>
                </div>

                <p className="text-[11px] text-on-surface-variant">Suggested interval from strategy: <span className="font-medium text-on-surface">{Math.round(strategyDt / 60)} min</span>.</p>

                <div className={`rounded-lg border px-3 py-2 text-xs ${
                  performanceState === "high"
                    ? "bg-surface-container-high border-outline-variant/40 text-on-surface"
                    : performanceState === "medium"
                      ? "bg-surface-container border-outline-variant/30 text-on-surface"
                      : "bg-surface-container border-outline-variant/30 text-on-surface"
                }`}>
                  {performanceState === "high" && (
                    <span>High computation load: {sampleCount.toLocaleString()} samples exceed the hard limit ({Number(timeAdvanced.performance_hard_limit).toLocaleString()}). Increase interval or reduce horizon.</span>
                  )}
                  {performanceState === "medium" && (
                    <span>Moderate computation load: {sampleCount.toLocaleString()} samples are above the soft limit ({Number(timeAdvanced.performance_soft_limit).toLocaleString()}).</span>
                  )}
                  {performanceState === "ok" && (
                    <span>Performance status good: sample count is within recommended bounds.</span>
                  )}
                </div>
              </div>
            </Card>

            {/* ── Simulation Statistics ─────────────────────────────────── */}
            {simType === "ccs" && result?.kpi && (
              <Card className="p-4">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-on-surface">CCS Simulation KPIs</p>
                  <p className="text-xs text-on-surface-variant">Results from the executed horizon.</p>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <KpiCard label="CO₂ Captured" value={fmt(result.kpi?.total_co2_captured_tonnes, 1)} unit="t" color="electric" />
                  <KpiCard label="CO₂ Stored" value={fmt(result.kpi?.total_co2_stored_tonnes, 1)} unit="t" color="emerald" />
                  <KpiCard label="Avg Capture Rate" value={fmt(result.kpi?.average_capture_rate_pct, 1)} unit="%" color="violet" />
                  <KpiCard label="Specific Energy" value={fmt(result.kpi?.specific_energy_kwh_tco2, 1)} unit="kWh/tCO₂" color="amber" />
                  <KpiCard label="Total Energy" value={fmt(result.kpi?.total_energy_kwh, 0)} unit="kWh" color="slate" />
                  <KpiCard label="Absorber Energy" value={fmt(result.kpi?.total_absorber_energy_kwh, 0)} unit="kWh" color="slate" />
                  <KpiCard label="Compressor Energy" value={fmt(result.kpi?.total_compressor_energy_kwh, 0)} unit="kWh" color="amber" />
                </div>
              </Card>
            )}
            {simType === "h2" && result?.kpi && (
              <Card className="p-4">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-on-surface">Simulation Statistics</p>
                  <p className="text-xs text-on-surface-variant">Operational KPIs from the executed horizon.</p>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <KpiCard label="Source Capacity Factor" value={fmt(kpi?.capacity_factor_pct, 1)} unit="%" color="electric" />
                  <KpiCard label="Fuel Cell Capacity Factor" value={fmt(kpi?.fuel_cell_capacity_factor_pct, 1)} unit="%" color="violet" />
                  <KpiCard label="Total Source Energy" value={fmt(kpi?.total_source_energy_kwh, 1)} unit="kWh" color="slate" />
                  <KpiCard label="Total Curtailed Energy" value={fmt(kpi?.total_curtailed_energy_kwh, 1)} unit="kWh" color="amber" />
                  <KpiCard label="ELZ Energy In" value={fmt(kpi?.total_elz_energy_kwh ?? kpi?.total_energy_consumed_kwh, 1)} unit="kWh" color="amber" />
                  <KpiCard label="Fuel Cell Energy Out" value={fmt(kpi?.total_fc_energy_kwh, 1)} unit="kWh" color="emerald" />
                  <KpiCard label="Avg Source Power" value={fmt(kpi?.avg_source_power_kw, 2)} unit="kW" color="electric" />
                  <KpiCard label="Avg Fuel Cell Power" value={fmt(kpi?.avg_fc_power_kw, 2)} unit="kW" color="emerald" />
                  <KpiCard label="Peak Source Power" value={fmt(kpi?.peak_source_power_kw, 2)} unit="kW" color="electric" />
                  <KpiCard label="Peak Fuel Cell Power" value={fmt(kpi?.peak_fc_power_kw, 2)} unit="kW" color="emerald" />
                  <KpiCard label="System Efficiency" value={fmt(kpi?.overall_system_efficiency_pct ?? kpi?.system_efficiency_pct, 1)} unit="%" color="violet" />
                </div>
              </Card>
            )}
          </div>
        ) : (
          /* Collapsed rail */
          <div className="flex-1 flex flex-col items-center justify-start pt-4 gap-3 text-on-surface-variant/70">
            <span className="p-2 rounded-lg bg-surface-container border border-outline-variant/30" title="Run Simulation">
              <FiPlay size={16} />
            </span>
            <span className="p-2 rounded-lg bg-surface-container border border-outline-variant/30" title="Advanced Time Settings">
              <FiClock size={16} />
            </span>
            <span className="p-2 rounded-lg bg-surface-container border border-outline-variant/30" title="Simulation Statistics">
              <FiDatabase size={16} />
            </span>
          </div>
        )}
      </div>
      {/* ── END right sidebar ─────────────────────────────────────────────── */}

    </div>
  );
}

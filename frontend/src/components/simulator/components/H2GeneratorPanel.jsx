/**
 * H2GeneratorPanel.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Always-visible generator analysis panel for the H₂ Digital Twin.
 * Shows tech-specific generation profiles, energy-conversion chain, and
 * (after simulation) actual power time series with H₂ yield overlay.
 *
 * Works with every electricity-generating technology:
 *   Solar PV · Wind (on/offshore) · CCGT · Coal · Nuclear · Biomass · Hydro · Geothermal
 *
 * Props:
 *   selectedModel  {Object}  – active source tech from opentech-db / fallback
 *   elzModel       {Object}  – active electrolyzer tech (for conversion chain)
 *   elzParams      {Object}  – { grid_power_kw, water_flow_rate_lpm, temperature_c }
 *   result         {Object}  – simulation result (optional – overlaid when present)
 *   simState       {string}  – 'idle'|'queued'|'running'|'done'|'error'
 */

import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import ReactECharts from "echarts-for-react";
import {
  FiSun, FiWind, FiZap, FiDroplet, FiActivity,
  FiBarChart2, FiTrendingUp, FiInfo, FiClock, FiUpload,
  FiSettings, FiLayers,
} from "react-icons/fi";
import MetricBadge from './ui/MetricBadge';
import { buildDisplaySourceProfile, detectSourceTechType } from "../services/h2SourceProfiles.js";

// ─────────────────────────────────────────────────────────────────────────────
// Robust capacity extraction — tries every field name and unit variant
// (mirrors HydrogenPlantDashboard / h2SimPayload helpers)
// ─────────────────────────────────────────────────────────────────────────────
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
  if (!model) return null;
  const unit = model.capacity_unit ?? model.unit ?? model.units
    ?? model.specs?.capacity_unit ?? model.technical_specifications?.capacity_unit;
  const candidates = [
    [model.capacity_kw, "kw"],
    [model.rated_power_kw, "kw"],
    [model.nominal_power_kw, "kw"],
    [model.power_kw, "kw"],
    [model.plant_capacity_kw, "kw"],
    [model.nameplate_capacity_kw, "kw"],
    [model.specs?.capacity_kw, "kw"],
    [model.technical_specifications?.capacity_kw, "kw"],
    [model.defaults?.capacity_kw, "kw"],
    [model.parameters?.capacity_kw, "kw"],
    [model.capacity_mw, "mw"],
    [model.rated_power_mw, "mw"],
    [model.nominal_power_mw, "mw"],
    [model.size_mw, "mw"],
    [model.plant_capacity_mw, "mw"],
    [model.nameplate_capacity_mw, "mw"],
    [model.specs?.capacity_mw, "mw"],
    [model.technical_specifications?.capacity_mw, "mw"],
    [model.defaults?.capacity_mw, "mw"],
    [model.parameters?.capacity_mw, "mw"],
    [model.capacity_gw, "gw"],
    [model.specs?.capacity_gw, "gw"],
    [model.technical_specifications?.capacity_gw, "gw"],
    [model.capacity, unit],
    [model.rated_power, unit],
    [model.nameplate_capacity, unit],
    [model.specs?.capacity, model.specs?.capacity_unit ?? unit],
    [model.technical_specifications?.capacity, model.technical_specifications?.capacity_unit ?? unit],
  ];
  for (const [raw, u] of candidates) {
    const kw = parseCapacityToKw(raw, u);
    if (kw != null) return kw;
  }
  return null;
}

function formatCapacityKw(kw) {
  if (kw == null || !Number.isFinite(kw)) return null;
  if (kw >= 1e6) return `${(kw / 1e6).toFixed(2)} GW`;
  if (kw >= 1000) return `${(kw / 1000).toFixed(1)} MW`;
  return `${Math.round(kw)} kW`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tech-type detection from model id / name (works for both API & fallback)
// ─────────────────────────────────────────────────────────────────────────────
// Per-tech metadata: colour scheme, icon, CO₂, capacity-factor range, tagline
const TECH_META = {
  solar:      { label: "Solar PV",       icon: FiSun,      hue: "#6b7280", bg: "bg-surface-container",   border: "border-outline-variant/30",  cf: [15, 28],  co2: 30,   tagline: "Daylight-driven variable generation" },
  wind:       { label: "Wind",           icon: FiWind,     hue: "#6b7280", bg: "bg-surface-container",   border: "border-outline-variant/30",  cf: [28, 50],  co2: 11,   tagline: "Variable — follows weather patterns" },
  nuclear:    { label: "Nuclear",        icon: FiZap,      hue: "#6b7280", bg: "bg-surface-container",   border: "border-outline-variant/30",  cf: [85, 95],  co2: 15,   tagline: "Firm baseload — very high availability" },
  hydro:      { label: "Hydropower",     icon: FiDroplet,  hue: "#6b7280", bg: "bg-surface-container",   border: "border-outline-variant/30",  cf: [40, 55],  co2: 8,    tagline: "Dispatchable — daily peaking profile" },
  geothermal: { label: "Geothermal",     icon: FiActivity, hue: "#6b7280", bg: "bg-surface-container",   border: "border-outline-variant/30",  cf: [80, 95],  co2: 35,   tagline: "Near-constant baseload resource" },
  biomass:    { label: "Biomass CHP",    icon: FiZap,      hue: "#6b7280", bg: "bg-surface-container",   border: "border-outline-variant/30",  cf: [60, 80],  co2: 120,  tagline: "Dispatchable — follows heat/power demand" },
  coal:       { label: "Coal",           icon: FiZap,      hue: "#374151", bg: "bg-surface-container",  border: "border-outline-variant/40",  cf: [50, 80],  co2: 900,  tagline: "High-capacity baseload — high CO₂" },
  gas:        { label: "Natural Gas",    icon: FiZap,      hue: "#6b7280", bg: "bg-surface-container",   border: "border-outline-variant/30",  cf: [40, 70],  co2: 430,  tagline: "Flexible mid-merit dispatchable" },
  generic:    { label: "Power Source",   icon: FiZap,      hue: "#6b7280", bg: "bg-surface-container",   border: "border-outline-variant/30",  cf: [40, 70],  co2: null, tagline: "Selected generation technology" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Generation statistics bar chart — pure generation metrics, no H₂ references
// Shows: rated capacity, typical peak, average output, minimum output
// ─────────────────────────────────────────────────────────────────────────────
function buildGenerationStatsChart(capacityKw, profile, meta, hue) {
  const cap    = capacityKw;
  const cfMin  = meta.cf[0] / 100;
  const cfMax  = meta.cf[1] / 100;
  const cfAvg  = profile.avgCF;

  const rated  = cap;
  const peak   = Math.round(cfMax * cap);
  const avg    = Math.round(cfAvg * cap);
  const min    = Math.round(cfMin * cap);

  const dailyMwh  = +((avg / 1000) * 24).toFixed(1);
  const annualMwh = +(dailyMwh * 365).toFixed(0);

  const categories = ["Rated Capacity", "Typical Peak", "Average Output", "Minimum Output"];
  const values     = [rated, peak, avg, min];
  const colors     = [hue, `${hue}cc`, `${hue}99`, `${hue}55`];

  return {
    chart: {
      animation: true,
      animationDuration: 600,
      tooltip: {
        trigger: "axis",
        formatter: (params) =>
          params.map((p) =>
            `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${p.color};margin-right:4px;"></span>`
            + `${p.name}: <b>${Number(p.value).toLocaleString()} kW</b>`
          ).join("<br/>"),
      },
      grid: { top: 20, bottom: 52, left: 64, right: 20 },
      xAxis: {
        type: "category",
        data: categories,
        axisLabel: { fontSize: 9, interval: 0, rotate: 10 },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        name: "kW",
        nameTextStyle: { fontSize: 9 },
        axisLabel: { fontSize: 9, formatter: (v) => v >= 1000 ? `${(v / 1000).toFixed(0)} MW` : v },
      },
      series: [{
        type: "bar",
        data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i], borderRadius: [5, 5, 0, 0] } })),
        barWidth: "48%",
        label: {
          show: true, position: "top", fontSize: 10,
          formatter: (p) => p.value >= 1000 ? `${(p.value / 1000).toFixed(1)} MW` : `${p.value} kW`,
        },
      }],
    },
    summary: { rated, peak, avg, min, dailyMwh, annualMwh },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV profile chart — shows the uploaded production time-series
// ─────────────────────────────────────────────────────────────────────────────
function buildCsvProfileChart(customProfile, hue) {
  const rows   = customProfile?.data ?? [];
  const hasTs  = rows[0]?.timestamp != null;

  // Down-sample to max 300 points for performance
  const step   = Math.max(1, Math.floor(rows.length / 300));
  const sample = rows.filter((_, i) => i % step === 0);

  const labels = sample.map((r) => {
    if (hasTs && r.timestamp) {
      // Show date + time but truncate to HH:mm to keep axis readable
      const ts = r.timestamp.replace("T", " ");
      return ts.length > 16 ? ts.slice(5, 16) : ts; // MM-DD HH:mm
    }
    const h = Math.floor(r.time_h);
    const m = Math.round((r.time_h - h) * 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  });

  const values = sample.map((r) => r.value_kw);
  const avg    = values.reduce((s, v) => s + v, 0) / values.length;
  const peak   = Math.max(...values);
  const min    = Math.min(...values);

  return {
    chart: {
      animation: false,
      tooltip: {
        trigger: "axis",
        formatter: (params) =>
          `<b>${params[0]?.axisValue}</b><br/>` +
          `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${hue};margin-right:4px;"></span>` +
          `Power: <b>${Number(params[0]?.value ?? 0).toLocaleString()} kW</b>`,
      },
      grid: { top: 16, bottom: 44, left: 64, right: 20 },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { fontSize: 9, interval: Math.max(0, Math.floor(labels.length / 12) - 1), rotate: labels.length > 40 ? 25 : 0 },
        boundaryGap: false,
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        name: "kW",
        min: 0,
        nameTextStyle: { fontSize: 9 },
        axisLabel: { fontSize: 9, formatter: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v },
      },
      series: [
        {
          name: "Power Output (kW)",
          type: "line",
          data: values,
          smooth: true,
          symbol: "none",
          color: hue,
          lineStyle: { color: hue, width: 2 },
          areaStyle: { color: hue.startsWith("#") ? `${hue}28` : `rgba(99,102,241,0.12)` },
        },
        {
          name: "Average (kW)",
          type: "line",
          data: labels.map(() => Math.round(avg)),
          symbol: "none",
          color: "#64748b",
          lineStyle: { color: "#64748b", width: 1.5, type: "dashed" },
        },
      ],
    },
    summary: { avg: Math.round(avg), peak: Math.round(peak), min: Math.round(min), rows: rows.length },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile ECharts option
// ─────────────────────────────────────────────────────────────────────────────
function buildProfileChart(profile, hue, techType) {
  const gradFill = techType === "solar"
    ? "rgba(245,158,11,0.18)"
    : techType === "wind"
      ? "rgba(96,165,250,0.18)"
      : "rgba(99,102,241,0.15)";

  return {
    animation: true,
    animationDuration: 800,
    tooltip: {
      trigger: "axis",
      formatter: (params) =>
        `<b>${params[0]?.axisValue}</b><br/>` +
        params.map((p) =>
          `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${p.color};margin-right:4px;"></span>`
          + `${p.seriesName}: <b>${Number(p.value ?? 0).toLocaleString()} kW</b>`
        ).join("<br/>"),
    },
    legend: { data: ["Generated Power (kW)"], bottom: 0, textStyle: { fontSize: 9 }, icon: 'roundRect' },
    grid: { top: 16, bottom: 44, left: 60, right: 20 },
    xAxis: { type: "category", data: profile.labels, axisLabel: { fontSize: 9, interval: 7 }, boundaryGap: false, axisTick: { show: false } },
    yAxis: {
      type: "value", name: "kW", min: 0,
      nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9, formatter: (v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v },
    },
    series: [
      {
        name: "Generated Power (kW)",
        type: "line",
        data: profile.fullKw,
        smooth: true,
        symbol: "none",
        color: hue,
        lineStyle: { color: hue, width: 2.5 },
        areaStyle: { color: gradFill },
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulation overlay — generator power delivered to busbar only (no H₂ axes)
// ─────────────────────────────────────────────────────────────────────────────
function buildActualOutputChart(result, hue, sourceName) {
  const t = (result?.time_s ?? []).map((s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m} min`;
  });
  const elzP = result?.electrolyzer_power_kw ?? [];   // ELZ input = generator AC output
  const avgPower  = elzP.length ? (elzP.reduce((s, v) => s + v, 0) / elzP.length).toFixed(1) : null;
  const peakPower = elzP.length ? Math.max(...elzP).toFixed(1) : null;

  return {
    chart: {
      animation: true,
      animationDuration: 600,
      tooltip: {
        trigger: "axis",
        formatter: (params) =>
          `<b>${params[0]?.axisValue}</b><br/>` +
          params.map((p) =>
            `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${p.color};margin-right:4px;"></span>`
            + `${p.seriesName}: <b>${Number(p.value ?? 0).toFixed(1)} kW</b>`
          ).join("<br/>"),
      },
      legend: {
        data: [`${sourceName ?? "Generator"} Output (kW)`, "Average (kW)"],
        bottom: 0, textStyle: { fontSize: 9 }, icon: 'roundRect',
      },
      grid: { top: 16, bottom: 44, left: 58, right: 20 },
      xAxis: { type: "category", data: t, axisLabel: { fontSize: 9, rotate: t.length > 30 ? 25 : 0 }, boundaryGap: false, axisTick: { show: false } },
      yAxis: [
        { type: "value", name: "kW", nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 } },
      ],
      series: [
        {
          name: `${sourceName ?? "Generator"} Output (kW)`,
          type: "line",
          data: elzP,
          smooth: true, symbol: "none",
          color: hue,
          lineStyle: { color: hue, width: 2.5 },
          areaStyle: { color: hue.startsWith("#") ? `${hue}22` : "rgba(99,102,241,0.12)" },
          yAxisIndex: 0,
        },
        {
          name: "Average (kW)",
          type: "line",
          data: avgPower ? t.map(() => +avgPower) : [],
          symbol: "none",
          color: "#64748b",
          lineStyle: { color: "#64748b", width: 1.5, type: "dashed" },
          yAxisIndex: 0,
        },
      ],
    },
    summary: { avgPower, peakPower },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact editable field — label + number input + unit + reset (no slider)
// ─────────────────────────────────────────────────────────────────────────────
function ConstraintRow({ label, unit, value, defaultValue, min, max, step = 1, onChange, onReset }) {
  const isOverridden = value !== null && value !== undefined;
  const display = isOverridden ? value : (defaultValue ?? "");
  return (
    <div className="flex items-center gap-1.5 group">
      <span className="text-[10px] text-on-surface-variant shrink-0 leading-tight" title={label}>{label}</span>
      <div className="flex items-center gap-1 ml-auto">
        <input
          type="number" min={min} max={max} step={step}
          value={display}
          placeholder={defaultValue != null ? String(defaultValue) : "—"}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
          className="w-[72px] text-right text-[11px] font-semibold bg-surface-container border border-outline-variant/30
            rounded-md px-1.5 py-[3px] focus:outline-none focus:ring-1 focus:ring-gray-400
            hover:border-gray-400 transition-colors"
          style={{ fontVariantNumeric: "tabular-nums", color: isOverridden ? "#4f46e5" : "#475569" }}
        />
        <span className="text-[10px] text-on-surface-variant/70 w-[38px] shrink-0 leading-none">{unit}</span>
        <button
          onClick={onReset}
          className={`w-4 text-[10px] leading-none transition-all
            ${isOverridden
              ? "text-on-surface-variant/70 hover:text-on-surface-variant opacity-100"
              : "text-slate-200 cursor-default opacity-0 group-hover:opacity-40"}`}
          title="Reset to default"
          disabled={!isOverridden}
        >✕</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small metric badge


// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
export default function H2GeneratorPanel({ selectedModel, elzModel, elzParams, result, simState, customProfile, variants, savedParams, onParamsChange }) {
  const techType   = detectSourceTechType(selectedModel);
  const meta       = TECH_META[techType] ?? TECH_META.generic;
  const Icon       = meta.icon;
  const hue        = meta.hue;

  // ── Local parameter overrides ──────────────────────────────────────────────
  // Initialise from savedParams so selections survive modal close/reopen.
  const [localParams, setLocalParams] = useState(() => savedParams ?? {});

  // Sync in if parent supplies pre-existing saved params on first mount
  const savedParamsRef = useRef(savedParams);
  useEffect(() => {
    if (savedParamsRef.current !== savedParams && Object.keys(localParams).length === 0) {
      setLocalParams(savedParams ?? {});
    }
    savedParamsRef.current = savedParams;
  }, [savedParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset overrides (but keep) when the selected model changes
  const modelId = selectedModel?.id;
  const prevModelIdRef = useRef(modelId);
  useEffect(() => {
    if (prevModelIdRef.current !== modelId) {
      setLocalParams({});
      onParamsChange?.({});
      prevModelIdRef.current = modelId;
    }
  }, [modelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleParam = useCallback((key, value) => {
    setLocalParams((p) => {
      const next = { ...p, [key]: value };
      onParamsChange?.(next);
      return next;
    });
  }, [onParamsChange]);

  const resetParam = useCallback((key) => {
    setLocalParams((p) => {
      const next = { ...p };
      delete next[key];
      onParamsChange?.(next);
      return next;
    });
  }, [onParamsChange]);

  const resetAllParams = useCallback(() => {
    setLocalParams({});
    onParamsChange?.({});
  }, [onParamsChange]);

  // ── Effective model = base model + local overrides ────────────────────────
  const effectiveModel = useMemo(() => {
    if (!selectedModel) return selectedModel;
    const safeNum = (x) => { const n = Number(x); return isFinite(n) ? n : undefined; };
    const ov = {};
    if (localParams.capacity_kw    != null) ov.capacity_kw      = safeNum(localParams.capacity_kw)    ?? localParams.capacity_kw;
    if (localParams.efficiency_pct != null) ov.efficiency_pct   = safeNum(localParams.efficiency_pct) ?? localParams.efficiency_pct;
    if (localParams.capex_usd_per_kw != null) ov.capex_usd_per_kw = safeNum(localParams.capex_usd_per_kw) ?? localParams.capex_usd_per_kw;
    if (localParams.lifetime_yr    != null) ov.lifetime_yr       = safeNum(localParams.lifetime_yr)    ?? localParams.lifetime_yr;
    return { ...selectedModel, ...ov };
  }, [selectedModel, localParams]);

  // Capacity-factor range — independently overrideable
  const effectiveCF   = [
    localParams.cf_min ?? meta.cf[0],
    localParams.cf_max ?? meta.cf[1],
  ];
  const effectiveMeta = { ...meta, cf: effectiveCF };

  // Robust capacity extraction — tries capacity_kw, capacity_mw, capacity_gw, etc.
  // Falls back to 10 000 kW (10 MW) only as a display sentinel; _modelHasCapacity
  // tells the render layer whether a real value was found.
  const _modelCapKw    = getModelCapacityKw(effectiveModel);
  const _modelHasCap   = _modelCapKw != null;
  const capacityKw     = _modelCapKw ?? 10000;
  const isDone         = simState === "done";

  // Resolve which variant (if any) is currently active
  const activeVariant = variants?.find((v) => v.id === localParams._variantId) ?? null;

  // ── Charts (all react to effectiveModel / effectiveMeta) ─────────────────
  const profile = useMemo(
    () => buildDisplaySourceProfile({
      sourceModel: effectiveModel,
      sourceVariant: activeVariant,
      capacityKw,
    }),
    [effectiveModel, activeVariant, capacityKw]
  );

  const genStats = useMemo(
    () => buildGenerationStatsChart(capacityKw, profile, effectiveMeta, hue),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [capacityKw, profile, effectiveCF[0], effectiveCF[1], hue]
  );

  const csvChart = useMemo(
    () => (customProfile?.data?.length > 0) ? buildCsvProfileChart(customProfile, hue) : null,
    [customProfile, hue]
  );

  const profileChart = useMemo(
    () => buildProfileChart(profile, hue, techType),
    [profile, hue, techType]
  );

  const actualChart = useMemo(
    () => isDone && result ? buildActualOutputChart(result, hue, effectiveModel?.name) : null,
    [isDone, result, hue, effectiveModel]
  );

  const [selectedGenChart, setSelectedGenChart] = useState("profile");

  if (!selectedModel) {
    return (
      <div className="bg-surface-container-lowest rounded-2xl border border-dashed border-outline-variant/30 p-8 flex flex-col items-center justify-center text-center gap-3">
        <span className="p-4 rounded-full bg-surface-container border border-outline-variant/30 text-on-surface-variant/70">
          <FiZap size={24} />
        </span>
        <p className="font-medium text-on-surface-variant">Select a power source technology in the flow diagram above</p>
        <p className="text-sm text-on-surface-variant/70">The generator analysis panel will appear once a model is chosen.</p>
      </div>
    );
  }

  // Pull DB-defined defaults for the constraints editor from the active variant
  const dbConstraints = activeVariant?._constraints ?? selectedModel?._constraints ?? {};
  const dbMonetary    = activeVariant?._monetary    ?? selectedModel?._monetary    ?? {};

  const cfMin = effectiveCF[0];
  const cfMax = effectiveCF[1];
  const hasOverrides = Object.keys(localParams).filter((k) => k !== "_variantId").length > 0;

  // Helper: default value for a constraint row — db value first, then fallback
  const cDef = (key, fbModelKey, fbValue) =>
    dbConstraints[key] != null ? dbConstraints[key]
    : fbModelKey != null && effectiveModel[fbModelKey] != null ? effectiveModel[fbModelKey]
    : fbValue ?? null;
  const mDef = (key, fbModelKey, fbValue) =>
    dbMonetary[key] != null ? dbMonetary[key]
    : fbModelKey != null && effectiveModel[fbModelKey] != null ? effectiveModel[fbModelKey]
    : fbValue ?? null;

  return (
    <div className="space-y-5">

      {/* ═══════════════════════════════════════════════════════════════════════
           SECTION A — Technology Identity
      ══════════════════════════════════════════════════════════════════════ */}
      <div className={`rounded-2xl border ${meta.border} ${meta.bg} p-4`}>
        <div className="flex flex-wrap items-start gap-4">
          {/* Icon + name */}
          <div className="flex items-center gap-3 flex-1 min-w-[200px]">
            <span className="p-2.5 rounded-xl text-white shadow"
              style={{ background: `linear-gradient(135deg, ${hue}, ${hue}bb)` }}>
              <Icon size={18} />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="text-sm font-bold text-on-surface">{effectiveModel.name}</h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface">
                  {effectiveModel.lifecycle ?? "commercial"}
                </span>
                {hasOverrides && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">✏ edited</span>
                )}
              </div>
              <p className="text-[11px] text-on-surface-variant mt-0.5">{meta.tagline}</p>
              {effectiveModel.description && (
                <p className="text-[10px] text-on-surface-variant/70 mt-0.5 italic leading-snug max-w-[300px] line-clamp-2">{effectiveModel.description}</p>
              )}
            </div>
          </div>
          {/* KPI badges — always render all 6 with "—" fallback */}
          <div className="grid grid-cols-3 gap-2 flex-1 min-w-[260px]">
            <MetricBadge
              label="Plant Capacity"
              value={_modelHasCap ? formatCapacityKw(capacityKw) : "—"}
              unit="" color="amber"
            />
            <MetricBadge
              label="CF range"
              value={`${cfMin}–${cfMax}`}
              unit="%" color="blue"
            />
            <MetricBadge
              label={effectiveModel.efficiency_pct != null ? "Gen. Efficiency" : "CO₂ Intensity"}
              value={effectiveModel.efficiency_pct != null
                ? Number(effectiveModel.efficiency_pct).toFixed(0)
                : meta.co2 ?? "N/A"}
              unit={effectiveModel.efficiency_pct != null ? "%" : "g/kWh"}
              color={effectiveModel.efficiency_pct != null ? "green"
                : meta.co2 != null && meta.co2 < 50 ? "green"
                : meta.co2 != null && meta.co2 < 300 ? "amber" : "red"}
            />
            <MetricBadge
              label="CAPEX"
              value={effectiveModel.capex_usd_per_kw != null
                ? effectiveModel.capex_usd_per_kw >= 1000
                  ? `${(effectiveModel.capex_usd_per_kw / 1000).toFixed(1)}k`
                  : String(effectiveModel.capex_usd_per_kw)
                : "—"}
              unit={effectiveModel.capex_usd_per_kw != null ? "$/kW" : ""}
              color="violet"
            />
            <MetricBadge
              label="Lifetime"
              value={effectiveModel.lifetime_yr ?? "—"}
              unit={effectiveModel.lifetime_yr != null ? "yr" : ""}
              color="slate"
            />
            <MetricBadge
              label="Annual Yield"
              value={genStats.summary.annualMwh.toLocaleString()}
              unit="MWh/yr"
              color="green"
            />
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
           SECTION B — Technology Variant selector
      ══════════════════════════════════════════════════════════════════════ */}
      {variants && variants.length > 1 && (() => {
        // Two-phase selection: choosing in the <select> only stages the value.
        // The green "Apply variant" button commits it → calls onParamsChange → saved to localStorage.
        const appliedVariantId = localParams._variantId ?? "";
        const stagedVariantId  = localParams._stagedVariantId ?? appliedVariantId;
        const isPending        = stagedVariantId !== appliedVariantId;

        const safeNum = (x) => { const n = Number(x); return isFinite(n) ? n : null; };

        const buildPatch = (v) => {
          const capKw     = safeNum(v.capacity_kw)    ?? safeNum(v._constraints?.energy_cap_max) ?? null;
          const effPct    = safeNum(v.efficiency_pct) ?? (v._constraints?.energy_eff != null
                              ? safeNum(+(v._constraints.energy_eff * 100).toFixed(1)) : null);
          const capex     = safeNum(v.capex_usd_per_kw) ?? safeNum(v._monetary?.energy_cap) ?? null;
          const lifetime  = safeNum(v.lifetime_yr)      ?? safeNum(v._constraints?.lifetime) ?? null;
          const opexFixed = safeNum(v.opex_fixed)        ?? safeNum(v._monetary?.om_annual)  ?? null;
          const opexVar   = safeNum(v.opex_var)          ?? safeNum(v._monetary?.om_prod)    ?? null;
          const patch = { _variantId: v.id };
          if (capKw    != null)  patch.capacity_kw       = capKw;
          if (effPct   != null)  patch.efficiency_pct    = effPct;
          if (capex    != null)  patch.capex_usd_per_kw  = capex;
          if (lifetime != null)  patch.lifetime_yr       = lifetime;
          if (opexFixed != null) patch.opex_fixed        = opexFixed;
          if (opexVar   != null) patch.opex_var          = opexVar;
          if (v.ramp_rate_frac_hr != null) patch.ramp_rate_frac_hr = v.ramp_rate_frac_hr;
          return patch;
        };

        const handleStage = (e) => {
          const vid = e.target.value;
          setLocalParams((p) => ({ ...p, _stagedVariantId: vid }));
        };

        const handleApply = () => {
          if (!stagedVariantId) {
            // "default" selected — reset everything
            setLocalParams({});
            onParamsChange?.({});
            return;
          }
          const v = variants.find((vv) => vv.id === stagedVariantId);
          if (!v) return;
          const patch = buildPatch(v);
          // Remove staging key — variant is now applied
          setLocalParams(patch);
          onParamsChange?.(patch);
        };

        const displayVariant = variants.find((v) => v.id === stagedVariantId) ?? null;
        const appliedVariantObj = variants.find((v) => v.id === appliedVariantId) ?? null;

        return (
          <div className={`bg-surface-container-lowest rounded-xl border shadow-sm px-4 py-3 flex flex-wrap items-start gap-3
            ${isPending ? "border-gray-400" : appliedVariantObj ? "border-gray-500" : "border-outline-variant/30"}`}>
            <FiLayers size={12} style={{ color: hue }} className="mt-1" />
            <div className="flex-1 min-w-[220px] space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-on-surface-variant">Technology Variant</span>
                {appliedVariantObj && !isPending && (
                  <span className="text-[10px] bg-surface-container-high text-on-surface font-semibold px-2 py-0.5 rounded-full">
                    ✓ Applied
                  </span>
                )}
                {isPending && (
                  <span className="text-[10px] bg-surface-container-highest text-on-surface font-semibold px-2 py-0.5 rounded-full">
                    ● Pending — click Apply
                  </span>
                )}
              </div>
              <select
                value={stagedVariantId}
                onChange={handleStage}
                className="w-full text-[12px] border border-outline-variant/30 rounded-lg px-2.5 py-1.5
                  bg-surface-container text-on-surface focus:outline-none focus:ring-2
                  focus:ring-gray-400 focus:border-transparent cursor-pointer"
              >
                <option value="">— opentech-db default —</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.lifecycle ? ` · ${v.lifecycle}` : ""}
                    {v.capex_usd_per_kw != null
                      ? ` · ${v.capex_usd_per_kw >= 1000
                          ? `${(v.capex_usd_per_kw / 1000).toFixed(0)}k$/kW`
                          : `${v.capex_usd_per_kw}$/kW`}`
                      : ""}
                  </option>
                ))}
              </select>
              {displayVariant?.description && (
                <p className="text-[10px] text-on-surface-variant/70 italic leading-snug">
                  {displayVariant.description}
                </p>
              )}
            </div>

            {/* Apply / Reset column */}
            <div className="flex flex-col gap-1.5 shrink-0">
              <button
                onClick={handleApply}
                disabled={!isPending && !appliedVariantId}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold
                  transition-all
                  ${isPending
                    ? "bg-primary text-white hover:bg-primary-container shadow-sm"
                    : appliedVariantId
                      ? "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest cursor-default"
                      : "bg-surface-container-high text-on-surface-variant/50 cursor-not-allowed"
                  }`}
              >
                {isPending ? "✓ Apply variant" : appliedVariantId ? "✓ Applied" : "Apply"}
              </button>
              {(appliedVariantId || isPending) && (
                <button
                  onClick={() => { setLocalParams({}); onParamsChange?.({}); }}
                  className="px-3 py-1 rounded-lg text-[10px] text-on-surface-variant/70 hover:text-on-surface-variant
                    hover:bg-surface-container-high border border-transparent hover:border-outline-variant/30 transition-all"
                >
                  ✕ Reset
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════════════
           SECTION C — Generation Charts  (single chart with dropdown)
      ══════════════════════════════════════════════════════════════════════ */}
      {(() => {
        const genChartOptions = [
          { id: "profile", label: csvChart ? "Custom CSV Profile" : "24 h Generation Profile" },
          { id: "stats",   label: "Generation Statistics" },
          ...(isDone && actualChart ? [{ id: "simulation", label: "Simulation Result" }] : []),
        ];
        const activeChart = genChartOptions.find((o) => o.id === selectedGenChart) ? selectedGenChart : "profile";

        return (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              {activeChart === "profile" && <FiClock size={13} style={{ color: hue }} />}
              {activeChart === "stats"   && <FiBarChart2 size={13} style={{ color: hue }} />}
              {activeChart === "simulation" && <FiActivity size={13} style={{ color: hue }} />}
              <h4 className="text-sm font-semibold text-on-surface">
                {activeChart === "profile" && (csvChart ? "Custom Production Profile" : `${meta.label} — Typical 24 h Profile`)}
                {activeChart === "stats"   && "Generation Statistics"}
                {activeChart === "simulation" && "Simulation Result"}
              </h4>
              <select
                value={activeChart}
                onChange={(e) => setSelectedGenChart(e.target.value)}
                className="ml-auto text-xs bg-surface-container-high border border-outline-variant/30 rounded-lg px-2 py-1 text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-gray-400"
              >
                {genChartOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>

            {activeChart === "profile" && csvChart && (
              <p className="text-xs text-on-surface-variant/70 mb-3">
                Avg: <b style={{ color: hue }}>{csvChart.summary.avg.toLocaleString()} kW</b>
                {" · "}Peak: <b style={{ color: hue }}>{csvChart.summary.peak.toLocaleString()} kW</b>
                {" · "}Min: <b className="text-on-surface-variant">{csvChart.summary.min.toLocaleString()} kW</b>
                {" · "}<span className="flex items-center gap-1 inline-flex"><FiInfo size={10} /> {csvChart.summary.rows?.toLocaleString() ?? "?"} data points</span>
              </p>
            )}
            {activeChart === "profile" && !csvChart && (
              <p className="text-xs text-on-surface-variant/70 mb-3">
                Avg CF: <b style={{ color: hue }}>{(profile.avgCF * 100).toFixed(0)}%</b>
                {" · "}Capacity: <b style={{ color: hue }}>{_modelHasCap ? formatCapacityKw(capacityKw) : "—"}</b>
                {" · "}Peak: <b className="text-on-surface-variant">{profile.peakKw >= 1000 ? `${(profile.peakKw / 1000).toFixed(1)} MW` : `${Math.round(profile.peakKw)} kW`}</b>
              </p>
            )}
            {activeChart === "stats" && (
              <p className="text-xs text-on-surface-variant/70 mb-3">
                Daily yield: <b style={{ color: hue }}>{genStats.summary.dailyMwh} MWh/day</b>
                {" · "}Annual: <b style={{ color: hue }}>{genStats.summary.annualMwh.toLocaleString()} MWh/yr</b>
              </p>
            )}
            {activeChart === "simulation" && actualChart && (
              <p className="text-xs text-on-surface-variant/70 mb-3">
                Avg: <b style={{ color: hue }}>{actualChart.summary.avgPower} kW</b>
                {" · "}Peak: <b style={{ color: hue }}>{actualChart.summary.peakPower} kW</b>
                {" · "}Dashed line = average
              </p>
            )}

            {activeChart === "profile" && (
              <ReactECharts key="profile" option={csvChart ? csvChart.chart : profileChart} style={{ height: 320 }} />
            )}
            {activeChart === "stats" && (
              <ReactECharts key="stats" option={genStats.chart} style={{ height: 320 }} />
            )}
            {activeChart === "simulation" && actualChart && (
              <ReactECharts key="simulation" option={actualChart.chart} style={{ height: 320 }} />
            )}
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════════════
           SECTION D — Energy Flow Chain Analysis
           Shows the full generation → ELZ → H₂ → FC chain with numbers
           derived from the selected tech's capacity and theoretical profile.
      ══════════════════════════════════════════════════════════════════════ */}
      {(() => {
        if (!_modelHasCap) return null;

        const avgPowerKw   = Math.round(capacityKw * profile.avgCF);
        const peakPowerKw  = Math.round(profile.peakKw);

        // ELZ conversion — derive from elzModel or elzParams
        const elzEffRaw = elzModel?.efficiency_pct ?? elzModel?.efficiency_percent ?? elzParams?.efficiency_pct ?? null;
        const elzEff    = elzEffRaw != null
          ? (Number(elzEffRaw) > 1 ? Number(elzEffRaw) : Number(elzEffRaw) * 100)
          : 70;
        const elzEffFrac = elzEff / 100;
        // HHV of H₂ = 39.4 kWh/kg;  density = 0.0899 kg/Nm³ → 1 Nm³ = 3.54 kWh (HHV)
        const h2RateKgH_avg  = +(avgPowerKw  * elzEffFrac / 39.4).toFixed(1);
        const h2RateNm3H_avg = +(avgPowerKw  * elzEffFrac / 3.54).toFixed(0);
        const h2RateKgH_peak = +(peakPowerKw * elzEffFrac / 39.4).toFixed(1);
        const h2RateNm3H_peak= +(peakPowerKw * elzEffFrac / 3.54).toFixed(0);

        // ELZ capacityKw for input sizing
        const elzCapKw  = getModelCapacityKw(elzModel) ?? avgPowerKw;

        // FC output estimate (from avg H₂ production at 58 % PEMFC efficiency)
        const fcEff          = 0.58;
        const fcPowerKw_avg  = Math.round(h2RateNm3H_avg * 3.0 * fcEff);

        // H₂ daily / annual totals
        const h2DailyKg  = +(h2RateKgH_avg * 24).toFixed(0);
        const h2AnnualT  = +((h2DailyKg * 365) / 1000).toFixed(1);

        const arrow = <span className="text-on-surface-variant/50 font-light text-base px-1">→</span>;
        const box = (label, value, unit, color) => (
          <div className={`flex flex-col items-center justify-center rounded-xl border px-3 py-2 min-w-[90px]
            bg-surface-container border-outline-variant/30
          `}>
            <p className="text-[9px] font-semibold uppercase tracking-wide text-on-surface-variant/70 mb-1 whitespace-nowrap">{label}</p>
            <p className="text-sm font-bold leading-tight text-on-surface">{value}</p>
            <p className="text-[9px] text-on-surface-variant/70 mt-0.5 whitespace-nowrap">{unit}</p>
          </div>
        );

        return (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <FiTrendingUp size={13} style={{ color: hue }} />
              <h4 className="text-sm font-semibold text-on-surface">Energy Flow Chain</h4>
              <span className="ml-auto text-[11px] text-on-surface-variant/70 flex items-center gap-1">
                <FiInfo size={10} /> Theoretical — based on selected capacity &amp; average CF
              </span>
            </div>

            {/* Flow chain: Generation → ELZ → H₂ → FC → AC */}
            <div className="flex flex-wrap items-center justify-center gap-1 mb-4">
              {box("Generation", formatCapacityKw(avgPowerKw), `avg · peak ${formatCapacityKw(peakPowerKw)}`, "amber")}
              {arrow}
              {box(`ELZ Input`, formatCapacityKw(Math.min(avgPowerKw, elzCapKw)), `η ${elzEff.toFixed(0)} %`, "indigo")}
              {arrow}
              {box("H₂ Rate", `${h2RateKgH_avg} kg/h`, `${h2RateNm3H_avg} Nm³/h`, "cyan")}
              {arrow}
              {box("Storage", "→ buffer", "compressed", "violet")}
              {arrow}
              {box("FC Output", `~${fcPowerKw_avg} kW`, `η ${Math.round(fcEff * 100)} %`, "green")}
            </div>

            {/* Daily / annual H₂ summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-outline-variant/20 bg-surface-container px-3 py-2">
                <p className="text-[9px] text-on-surface-variant uppercase tracking-wide font-semibold">Avg Supply</p>
                <p className="text-sm font-bold text-on-surface">{formatCapacityKw(avgPowerKw)}</p>
                <p className="text-[9px] text-on-surface-variant/70">avg AC power to ELZ</p>
              </div>
              <div className="rounded-xl border border-outline-variant/20 bg-surface-container px-3 py-2">
                <p className="text-[9px] text-on-surface-variant uppercase tracking-wide font-semibold">H₂ Production</p>
                <p className="text-sm font-bold text-on-surface">{h2RateKgH_avg} kg/h</p>
                <p className="text-[9px] text-on-surface-variant/70">{h2RateNm3H_avg} Nm³/h avg · {h2RateNm3H_peak} Nm³/h peak</p>
              </div>
              <div className="rounded-xl border border-outline-variant/20 bg-surface-container px-3 py-2">
                <p className="text-[9px] text-on-surface-variant uppercase tracking-wide font-semibold">Daily H₂</p>
                <p className="text-sm font-bold text-on-surface">{h2DailyKg.toLocaleString()} kg</p>
                <p className="text-[9px] text-on-surface-variant/70">per day at avg CF</p>
              </div>
              <div className="rounded-xl border border-outline-variant/20 bg-surface-container px-3 py-2">
                <p className="text-[9px] text-on-surface-variant uppercase tracking-wide font-semibold">Annual H₂</p>
                <p className="text-sm font-bold text-on-surface">{h2AnnualT.toLocaleString()} t/yr</p>
                <p className="text-[9px] text-on-surface-variant/70">metric tonnes per year</p>
              </div>
            </div>

            <p className="text-[10px] text-on-surface-variant/70 mt-2 flex items-center gap-1">
              <FiInfo size={9} />
              Theoretical estimate · ELZ η {elzEff.toFixed(0)} % HHV ·
              H₂ HHV = 39.4 kWh/kg · 3.54 kWh/Nm³ ·
              Run simulation for time-resolved results.
            </p>
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════════════
           SECTION F — KPI Footer
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-wide font-medium">Generator η</p>
          <p className="font-headline text-lg font-bold text-on-surface leading-tight">
            {selectedModel.efficiency_pct != null
              ? `${Number(selectedModel.efficiency_pct).toFixed(1)} %`
              : ["solar", "wind", "hydro", "geothermal"].includes(techType)
                ? "N/A (RE)"
                : "—"}
          </p>
          <p className="text-[10px] text-on-surface-variant/70">Fuel → electricity</p>
        </div>
        <div className="rounded-xl px-4 py-3 border" style={{ background: `${hue}14`, borderColor: `${hue}44` }}>
          <p className="text-[10px] uppercase tracking-wide font-medium" style={{ color: hue }}>Capacity Factor</p>
          <p className="font-headline text-lg font-bold leading-tight" style={{ color: hue }}>
            {meta.cf[0]}–{meta.cf[1]} <span className="text-sm font-normal">%</span>
          </p>
          <p className="text-[10px] text-on-surface-variant/70">Typical range for {meta.label}</p>
        </div>
        <div className="bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-wide font-medium">Daily Energy</p>
          <p className="font-headline text-lg font-bold text-on-surface leading-tight">
            {genStats.summary.dailyMwh} <span className="text-sm font-normal">MWh/day</span>
          </p>
          <p className="text-[10px] text-on-surface-variant/70">
            {isDone && actualChart?.summary.avgPower
              ? `Simulated avg: ${actualChart.summary.avgPower} kW`
              : _modelHasCap
                ? `Avg CF · plant ${formatCapacityKw(capacityKw)}`
                : "Avg CF · select model for capacity"}
          </p>
        </div>
        <div className="bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-wide font-medium">
            {meta.co2 != null ? "CO₂ Intensity" : "Annual yield"}
          </p>
          <p className="font-headline text-lg font-bold text-on-surface leading-tight">
            {meta.co2 != null
              ? <>{meta.co2} <span className="text-sm font-normal">g CO₂/kWh</span></>
              : <>{genStats.summary.annualMwh.toLocaleString()} <span className="text-sm font-normal">MWh/yr</span></>}
          </p>
          <p className="text-[10px] text-on-surface-variant/70">
            {meta.co2 != null ? "Lifecycle emissions" : "Estimated annual generation"}
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
           SECTION G — DB Constraints & Parameters  (compact, below charts)
           Values sourced from the active variant / opentech-db instance.
      ═══════════════════════════════════════════════════════════════════════ */}
      <details className="group bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-sm">
        <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none
          hover:bg-surface-container rounded-2xl transition-colors list-none">
          <FiSettings size={12} className="text-on-surface-variant/70 shrink-0" />
          <span className="text-[12px] font-semibold text-on-surface-variant">Constraints &amp; Parameters</span>
          <span className="text-[10px] text-on-surface-variant/70 ml-1">
            {activeVariant ? `– ${activeVariant.name}` : "– opentech-db defaults"}
          </span>
          {hasOverrides && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-surface-container-high text-on-surface-variant rounded-full font-medium">
              {Object.keys(localParams).filter((k) => k !== "_variantId").length} edited
            </span>
          )}
          <svg className="ml-auto w-3.5 h-3.5 text-on-surface-variant/70 transition-transform group-open:rotate-180 shrink-0"
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          {hasOverrides && (
            <button
              onClick={(e) => { e.preventDefault(); resetAllParams(); }}
              className="ml-2 text-[10px] text-on-surface-variant/70 hover:text-on-surface-variant font-medium px-2 py-0.5
                rounded hover:bg-surface-container-high transition-colors shrink-0"
            >Reset all</button>
          )}
        </summary>

        <div className="px-4 pb-4 pt-2 border-t border-outline-variant/20">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0">

            {/* Technical constraints column */}
            <div>
              <p className="text-[9px] font-bold text-on-surface-variant/50 uppercase tracking-widest mb-2">Technical</p>
              <div className="space-y-1.5">
                <ConstraintRow
                  label="Max Capacity"
                  unit="kW"
                  value={localParams.capacity_kw ?? null}
                  defaultValue={cDef("energy_cap_max", null, null) ?? _modelCapKw ?? null}
                  min={100}
                  max={Math.max((_modelCapKw ?? 10000) * 5, 200000)}
                  step={100}
                  onChange={(v) => handleParam("capacity_kw", v)}
                  onReset={() => resetParam("capacity_kw")}
                />
                {!["solar", "wind", "hydro", "geothermal"].includes(techType) && (
                  <ConstraintRow
                    label="Efficiency"
                    unit="%"
                    value={localParams.efficiency_pct ?? null}
                    defaultValue={
                      cDef("energy_eff", null, null) != null
                        ? +(cDef("energy_eff", null, null) * 100).toFixed(1)
                        : effectiveModel.efficiency_pct ?? null
                    }
                    min={5} max={100} step={0.5}
                    onChange={(v) => handleParam("efficiency_pct", v)}
                    onReset={() => resetParam("efficiency_pct")}
                  />
                )}
                <ConstraintRow
                  label="CF min"
                  unit="%"
                  value={localParams.cf_min ?? null}
                  defaultValue={meta.cf[0]}
                  min={1} max={Math.max(1, cfMax - 1)} step={1}
                  onChange={(v) => handleParam("cf_min", v)}
                  onReset={() => resetParam("cf_min")}
                />
                <ConstraintRow
                  label="CF max"
                  unit="%"
                  value={localParams.cf_max ?? null}
                  defaultValue={meta.cf[1]}
                  min={Math.min(99, cfMin + 1)} max={100} step={1}
                  onChange={(v) => handleParam("cf_max", v)}
                  onReset={() => resetParam("cf_max")}
                />
                <ConstraintRow
                  label="Ramp Rate"
                  unit="/hr"
                  value={localParams.ramp_rate_frac_hr ?? null}
                  defaultValue={cDef("energy_ramping", null, null)}
                  min={0} max={1} step={0.01}
                  onChange={(v) => handleParam("ramp_rate_frac_hr", v)}
                  onReset={() => resetParam("ramp_rate_frac_hr")}
                />
                <ConstraintRow
                  label="Lifetime"
                  unit="yr"
                  value={localParams.lifetime_yr ?? null}
                  defaultValue={cDef("lifetime", "lifetime_yr", 25)}
                  min={5} max={80} step={1}
                  onChange={(v) => handleParam("lifetime_yr", v)}
                  onReset={() => resetParam("lifetime_yr")}
                />
              </div>
            </div>

            {/* Economic parameters column */}
            <div>
              <p className="text-[9px] font-bold text-on-surface-variant/50 uppercase tracking-widest mb-2">Economic</p>
              <div className="space-y-1.5">
                <ConstraintRow
                  label="CAPEX"
                  unit="$/kW"
                  value={localParams.capex_usd_per_kw ?? null}
                  defaultValue={mDef("energy_cap", "capex_usd_per_kw", null)}
                  min={10} max={20000} step={10}
                  onChange={(v) => handleParam("capex_usd_per_kw", v)}
                  onReset={() => resetParam("capex_usd_per_kw")}
                />
                <ConstraintRow
                  label="Fixed O&M"
                  unit="$/kW/yr"
                  value={localParams.opex_fixed ?? null}
                  defaultValue={mDef("om_annual", null, null)}
                  min={0} max={500} step={1}
                  onChange={(v) => handleParam("opex_fixed", v)}
                  onReset={() => resetParam("opex_fixed")}
                />
                <ConstraintRow
                  label="Variable O&M"
                  unit="$/kWh"
                  value={localParams.opex_var ?? null}
                  defaultValue={mDef("om_prod", null, null)}
                  min={0} max={0.1} step={0.001}
                  onChange={(v) => handleParam("opex_var", v)}
                  onReset={() => resetParam("opex_var")}
                />
                <ConstraintRow
                  label="Interest Rate"
                  unit="%"
                  value={localParams.interest_rate ?? null}
                  defaultValue={
                    mDef("interest_rate", null, null) != null
                      ? +(mDef("interest_rate", null, 0.10) *
                          (mDef("interest_rate", null, 0.10) > 1 ? 1 : 100)).toFixed(1)
                      : 10
                  }
                  min={0} max={30} step={0.5}
                  onChange={(v) => handleParam("interest_rate", v)}
                  onReset={() => resetParam("interest_rate")}
                />
              </div>
            </div>
          </div>

          {/* Mini summary strip */}
          <div className="mt-3 px-3 py-2 rounded-lg text-[10px] text-on-surface-variant/70
            flex flex-wrap gap-x-5 gap-y-0.5"
            style={{ background: `${hue}08`, border: `1px solid ${hue}18` }}
          >
            <span>Capacity: <b className="text-on-surface-variant">{_modelHasCap ? formatCapacityKw(capacityKw) : "—"}</b></span>
            <span>CF: <b className="text-on-surface-variant">{cfMin}–{cfMax} %</b></span>
            <span>Daily: <b className="text-on-surface-variant">{genStats.summary.dailyMwh} MWh</b></span>
            <span>Annual: <b className="text-on-surface-variant">{genStats.summary.annualMwh.toLocaleString()} MWh/yr</b></span>
          </div>
        </div>
      </details>

    </div>
  );
}

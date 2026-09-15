/**
 * CCSStripperPanel.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Stripper/Regenerator parameter panel for CCS simulation.
 * Configures reboiler temperature, steam pressure, thermal efficiency, and energy requirements.
 *
 * Props:
 *   selectedModel  {Object}  – active stripper tech from opentech-db / fallback
 *   savedParams    {Object}  – local parameter overrides
 *   absorberParams {Object}  – upstream absorber parameters (for flow matching)
 *   result         {Object}  – simulation result (optional)
 *   simState       {string}  – 'idle'|'queued'|'running'|'done'|'error'
 *   variants       {Array}   – variant list from fetchCCSVariants
 *   onParamsChange {Function}– called whenever local overrides change
 */

import React, { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { FiWind, FiActivity, FiInfo, FiSettings, FiLayers } from "react-icons/fi";
import ParamSlider from './ui/ParamSlider';
import MetricBadge from './ui/MetricBadge';
import KpiCard from './ui/KpiCard';

// ─────────────────────────────────────────────────────────────────────────────
// Stripper type detection from model id / name
// ─────────────────────────────────────────────────────────────────────────────
function detectStripperType(model) {
  if (!model) return "conventional";
  const key = `${model.id ?? ""} ${model.name ?? ""}`.toLowerCase();
  if (/vapor|recompression|vrc/.test(key))      return "vapor_recompression";
  if (/multi|pressure|split/.test(key))         return "multi_pressure";
  if (/flash|regen/.test(key))                  return "flash_regen";
  if (/conventional|standard/.test(key))        return "conventional";
  return "conventional";
}

// Per-stripper-type metadata
const STRIPPER_META = {
  conventional: {
    label:   "Conventional Stripper",
    hue:     "#6b7280",
    bg:      "bg-surface-container",
    border:  "border-outline-variant/30",
    tagline: "Standard reboiler · 3.2-3.8 GJ/tCO₂ · 115-125°C",
    tempRange: [115, 125],
    energyRange: [3.2, 3.8],
    efficiency: [75, 85],
  },
  vapor_recompression: {
    label:   "Vapor Recompression",
    hue:     "#6b7280",
    bg:      "bg-surface-container",
    border:  "border-outline-variant/30",
    tagline: "Mechanical recompression · 2.5-3.0 GJ/tCO₂ · 105-115°C",
    tempRange: [105, 115],
    energyRange: [2.5, 3.0],
    efficiency: [82, 92],
  },
  multi_pressure: {
    label:   "Multi-Pressure Stripper",
    hue:     "#6b7280",
    bg:      "bg-surface-container",
    border:  "border-outline-variant/30",
    tagline: "Split-flow design · 2.8-3.3 GJ/tCO₂ · 110-120°C",
    tempRange: [110, 120],
    energyRange: [2.8, 3.3],
    efficiency: [80, 88],
  },
  flash_regen: {
    label:   "Flash Regeneration",
    hue:     "#6b7280",
    bg:      "bg-surface-container",
    border:  "border-outline-variant/30",
    tagline: "Flash stripping · 3.0-3.5 GJ/tCO₂ · 100-110°C",
    tempRange: [100, 110],
    energyRange: [3.0, 3.5],
    efficiency: [78, 86],
  },
};

export default function CCSStripperPanel({
  selectedModel,
  savedParams = {},
  absorberParams = {},
  result,
  simState,
  variants,
  onParamsChange,
}) {
  const stripperType = detectStripperType(selectedModel);
  const meta = STRIPPER_META[stripperType] ?? STRIPPER_META.conventional;

  // Local editable overrides (merged with saved)
  const [localParams, setLocalParams] = useState(() => ({
    reboiler_temp_c: savedParams.reboiler_temp_c ?? selectedModel?.reboiler_temp_c ?? 120,
    steam_pressure_bar: savedParams.steam_pressure_bar ?? selectedModel?.steam_pressure_bar ?? 3.5,
    thermal_efficiency_pct: savedParams.thermal_efficiency_pct ?? selectedModel?.thermal_efficiency_pct ?? 82,
    energy_input_gj_tco2: savedParams.energy_input_gj_tco2 ?? selectedModel?.energy_input_gj_tco2 ?? 3.4,
  }));

  // Update local params and propagate to parent
  const updateParam = (key, value) => {
    const updated = { ...localParams, [key]: value };
    setLocalParams(updated);
    onParamsChange?.(updated);
  };

  const [selectedChart, setSelectedChart] = useState("energy");

  // Build thermal energy vs. steam temperature curve
  const energyCurve = useMemo(() => {
    const temps = Array.from({ length: 41 }, (_, i) => 100 + i);
    const thermalEnergy = temps.map((temp) => {
      // Energy requirement increases with temperature (higher sensible heat)
      const baseEnergy = meta.energyRange[0];
      const tempFactor = (temp - 100) / 40;
      const energyIncrease = (meta.energyRange[1] - meta.energyRange[0]) * tempFactor;
      return baseEnergy + energyIncrease;
    });

    const purity = temps.map((temp) => {
      // CO₂ purity improves with temperature up to optimal point
      if (temp < 105) return 95 + (temp - 100) * 0.5;
      if (temp > 130) return 99.5 - (temp - 130) * 0.1;
      return 97.5 + (temp - 105) * 0.08;
    });

    return {
      animation: false,
      tooltip: { trigger: "axis" },
      legend: {
        data: ["Thermal Energy", "CO₂ Purity"],
        bottom: 0,
        textStyle: { fontSize: 9 }, icon: 'roundRect',
      },
      grid: { top: 24, bottom: 68, left: 48, right: 52 },
      xAxis: {
        type: "category",
        data: temps,
        name: "Reboiler Temperature (°C)",
        nameLocation: "middle",
        nameGap: 28,
        axisLabel: { fontSize: 9, rotate: 0 },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: "value",
          name: "GJ/tCO₂",
          nameTextStyle: { fontSize: 9 },
          axisLabel: { fontSize: 9 },
          min: 2.0,
          max: 4.5,
        },
        {
          type: "value",
          name: "Purity %",
          nameTextStyle: { fontSize: 9 },
          axisLabel: { fontSize: 9 },
          min: 95,
          max: 100,
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "Thermal Energy",
          type: "line",
          data: thermalEnergy,
          smooth: true,
          symbol: "none",
          color: meta.hue,
          lineStyle: { color: meta.hue, width: 2 },
          areaStyle: { color: `${meta.hue}33` },
          yAxisIndex: 0,
        },
        {
          name: "CO₂ Purity",
          type: "line",
          data: purity,
          smooth: true,
          symbol: "none",
          color: "#9ca3af",
          lineStyle: { color: "#9ca3af", width: 2 },
          yAxisIndex: 1,
        },
      ],
    };
  }, [meta]);

  // Steam demand vs absorber load
  const steamDemandChart = useMemo(() => {
    const loads   = Array.from({ length: 11 }, (_, i) => i * 10);
    const steamFlow  = loads.map(l => +(l * localParams.energy_input_gj_tco2 * 0.36).toFixed(1));
    const reboilerMW = loads.map(l => +(l * localParams.energy_input_gj_tco2 * 0.278).toFixed(1));
    return {
      animation: false,
      tooltip: { trigger: "axis" },
      legend: { data: ["Steam Flow", "Reboiler Duty"], bottom: 0, textStyle: { fontSize: 9 }, icon: 'roundRect', type: 'scroll' },
      grid: { top: 24, bottom: 68, left: 48, right: 52 },
      xAxis: { type: "category", data: loads.map(l => `${l}%`), name: "Absorber Load", nameLocation: "middle", nameGap: 28, axisLabel: { fontSize: 9 }, axisTick: { show: false } },
      yAxis: [
        { type: "value", name: "Steam (t/h)", nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 } },
        { type: "value", name: "MW",          nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 }, splitLine: { show: false } },
      ],
      series: [
        { name: "Steam Flow",   type: "bar",  data: steamFlow,   itemStyle: { color: meta.hue, opacity: 0.75 }, yAxisIndex: 0 },
        { name: "Reboiler Duty", type: "line", data: reboilerMW, symbol: "none", color: "#6b7280", lineStyle: { color: "#6b7280", width: 2 }, yAxisIndex: 1 },
      ],
    };
  }, [localParams.energy_input_gj_tco2, meta.hue]);

  // Stacked reboiler energy breakdown by temperature
  const energyBreakdownChart = useMemo(() => {
    const labels = ["100°C", "110°C", "120°C", "130°C", "140°C"];
    const desorp = [1.40, 1.41, 1.42, 1.43, 1.44];
    const sensib = [0.50, 0.65, 0.80, 0.95, 1.10];
    const vapour = [0.30, 0.38, 0.46, 0.54, 0.62];
    const losses = [0.10, 0.15, 0.20, 0.25, 0.30];
    return {
      animation: false,
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { data: ["Desorption", "Sensible Heat", "Vaporisation", "Losses"], bottom: 0, textStyle: { fontSize: 9 }, icon: 'roundRect', type: 'scroll' },
      grid: { top: 24, bottom: 68, left: 48, right: 16 },
      xAxis: { type: "category", data: labels, name: "Reboiler Temperature", nameLocation: "middle", nameGap: 28, axisLabel: { fontSize: 9 }, axisTick: { show: false } },
      yAxis: { type: "value", name: "GJ/tCO₂", nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 }, max: 4.5 },
      series: [
        { name: "Desorption",   type: "bar", stack: "total", data: desorp, itemStyle: { color: "#9ca3af" } },
        { name: "Sensible Heat", type: "bar", stack: "total", data: sensib, itemStyle: { color: "#6b7280" } },
        { name: "Vaporisation", type: "bar", stack: "total", data: vapour, itemStyle: { color: "#4b5563" } },
        { name: "Losses",       type: "bar", stack: "total", data: losses, itemStyle: { color: "#374151" } },
      ],
    };
  }, []);

  return (
    <div className="space-y-5">
      {/* ── Header — Technology Identity ───────────────────────────────────── */}
      <div className={`rounded-2xl border p-4 ${meta.border} ${meta.bg}`}>
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-[200px]">
            <span className="p-2.5 rounded-xl text-white shadow" style={{ background: `linear-gradient(135deg, ${meta.hue}, ${meta.hue}bb)` }}>
              <FiWind size={18} />
            </span>
            <div>
              <h3 className="text-sm font-bold text-on-surface">{meta.label}</h3>
              <p className="text-[11px] text-on-surface-variant mt-0.5">{meta.tagline}</p>
              {selectedModel && (
                <p className="text-[10px] text-on-surface-variant/70 mt-0.5 font-mono italic">{selectedModel.id ?? selectedModel.name}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 flex-1 min-w-[260px]">
            <MetricBadge label="Reboiler Temp" value={localParams.reboiler_temp_c} unit="°C" color="amber" />
            <MetricBadge label="Steam Pressure" value={localParams.steam_pressure_bar.toFixed(1)} unit="bar" color="slate" />
            <MetricBadge label="Efficiency" value={localParams.thermal_efficiency_pct} unit="%" color="green" />
            <MetricBadge label="Specific Energy" value={localParams.energy_input_gj_tco2.toFixed(2)} unit="GJ/tCO₂" color="red" />
            <MetricBadge label="CO₂ Purity" value={(95 + (localParams.reboiler_temp_c - 100) * 0.1).toFixed(1)} unit="%" color="violet" />
            <MetricBadge label="Heat Recovery" value={localParams.thermal_efficiency_pct} unit="%" color="blue" />
          </div>
        </div>
      </div>

      {/* ── Technology Variant ──────────────────────────────────────────────── */}
      {variants && variants.length > 1 && (() => {
        const appliedId = localParams._variantId ?? "";
        const stagedId  = localParams._stagedVariantId ?? appliedId;
        const isPending = stagedId !== appliedId;
        const handleStage = (e) => setLocalParams((p) => ({ ...p, _stagedVariantId: e.target.value }));
        const handleApply = () => {
          if (!stagedId) { setLocalParams({}); onParamsChange?.({}); return; }
          const v = variants.find((vv) => vv.id === stagedId);
          if (!v) return;
          const patch = { _variantId: v.id };
          if (v.reboiler_temp_c != null)          patch.reboiler_temp_c          = v.reboiler_temp_c;
          if (v.steam_pressure_bar != null)       patch.steam_pressure_bar       = v.steam_pressure_bar;
          if (v.thermal_efficiency_pct != null)   patch.thermal_efficiency_pct   = v.thermal_efficiency_pct;
          if (v.energy_input_gj_tco2 != null)     patch.energy_input_gj_tco2     = v.energy_input_gj_tco2;
          setLocalParams(patch); onParamsChange?.(patch);
        };
        const displayV = variants.find((v) => v.id === stagedId) ?? null;
        const appliedV = variants.find((v) => v.id === appliedId) ?? null;
        return (
          <div className={`bg-surface-container-lowest rounded-xl border shadow-sm px-4 py-3 flex flex-wrap items-start gap-3
            ${isPending ? "border-gray-400" : appliedV ? "border-outline-variant/40" : "border-outline-variant/30"}`}>
            <FiLayers size={12} style={{ color: meta.hue }} className="mt-1" />
            <div className="flex-1 min-w-[220px] space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-on-surface-variant">Technology Variant</span>
                {appliedV && !isPending && <span className="text-[10px] bg-surface-container-high text-on-surface font-semibold px-2 py-0.5 rounded-full">✓ Applied</span>}
                {isPending && <span className="text-[10px] bg-surface-container-high text-on-surface font-semibold px-2 py-0.5 rounded-full">● Pending — click Apply</span>}
              </div>
              <select value={stagedId} onChange={handleStage}
                className="w-full text-[12px] border border-outline-variant/30 rounded-lg px-2.5 py-1.5 bg-surface-container text-on-surface focus:outline-none focus:ring-2 focus:ring-gray-400 cursor-pointer">
                <option value="">— default —</option>
                {variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              {displayV?.description && <p className="text-[10px] text-on-surface-variant/70 italic leading-snug">{displayV.description}</p>}
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <button onClick={handleApply} disabled={!isPending && !appliedId}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all
                  ${isPending ? "bg-primary text-white hover:bg-primary-container shadow-sm" : appliedId ? "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest" : "bg-surface-container-high text-on-surface-variant/50 cursor-not-allowed"}`}>
                {isPending ? "✓ Apply variant" : appliedId ? "✓ Applied" : "Apply"}
              </button>
              {(appliedId || isPending) && (
                <button onClick={() => { setLocalParams({}); onParamsChange?.({}); }}
                  className="px-3 py-1 rounded-lg text-[10px] text-on-surface-variant hover:text-on-surface hover:bg-surface-container border border-transparent hover:border-outline-variant/30 transition-all">
                  ✕ Reset
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Performance Analysis ─────────────────────────────────────────────── */}
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <FiActivity size={13} style={{ color: meta.hue }} />
          <h4 className="text-sm font-semibold text-on-surface">Performance Analysis</h4>
          <select
            value={selectedChart}
            onChange={(e) => setSelectedChart(e.target.value)}
            className="ml-auto text-xs bg-surface-container-high border border-outline-variant/30 rounded-lg px-2 py-1 text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            <option value="energy">Thermal Energy vs Temperature</option>
            <option value="steam">Steam Demand vs Load</option>
            <option value="breakdown">Reboiler Energy Breakdown</option>
          </select>
        </div>
        <ReactECharts
          key={selectedChart}
          option={selectedChart === "energy" ? energyCurve : selectedChart === "steam" ? steamDemandChart : energyBreakdownChart}
          style={{ height: 320 }}
        />
      </div>

      {/* ── KPIs ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Steam Consumption"
          value={absorberParams.capture_rate_pct ? (
            (localParams.energy_input_gj_tco2 * 100 * 0.4).toFixed(1)
          ) : "—"}
          unit="t/h"
          color="amber"
        />
        <KpiCard
          label="Regeneration Energy"
          value={absorberParams.capture_rate_pct ? (
            (localParams.energy_input_gj_tco2 * 100 * 0.278).toFixed(0)
          ) : "—"}
          unit="MW"
          color="red"
        />
        <KpiCard
          label="CO₂ Purity"
          value={(95 + (localParams.reboiler_temp_c - 100) * 0.1).toFixed(1)}
          unit="%"
          color="emerald"
        />
        <KpiCard
          label="Heat Recovery"
          value={localParams.thermal_efficiency_pct.toFixed(0)}
          unit="%"
          color="slate"
        />
      </div>

      {/* ── Info Banner ────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 p-3 bg-surface-container border border-outline-variant/30 rounded-2xl text-xs text-on-surface">
        <FiInfo className="shrink-0 mt-0.5" size={14} />
        <p>
          <b>Stripper regenerates solvent:</b> by releasing captured CO₂ using steam heat.
          Higher temperatures improve regeneration but increase energy penalty. Optimal range is 115-125°C for MEA systems.
          Advanced configurations (VRC, multi-pressure) reduce specific energy requirements.
        </p>
      </div>

      {/* ── Configuration & Parameters ──────────────────────────────────────── */}
      <details className="group bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-sm">
        <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none hover:bg-surface-container rounded-2xl transition-colors list-none">
          <FiSettings size={12} style={{ color: meta.hue }} className="shrink-0" />
          <span className="text-[12px] font-semibold text-on-surface-variant">Configuration &amp; Parameters</span>
          <svg className="ml-auto w-3.5 h-3.5 text-on-surface-variant/70 transition-transform group-open:rotate-180 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="px-5 pb-5 pt-3 border-t border-outline-variant/20 space-y-4">
          <ParamSlider label="Reboiler Temperature" unit="°C" value={localParams.reboiler_temp_c} min={100} max={140} step={1} onChange={(v) => updateParam("reboiler_temp_c", v)} />
          <ParamSlider label="Steam Pressure" unit="bar" value={localParams.steam_pressure_bar} min={2.0} max={5.0} step={0.1} onChange={(v) => updateParam("steam_pressure_bar", v)} />
          <ParamSlider label="Thermal Efficiency" unit="%" value={localParams.thermal_efficiency_pct} min={75} max={92} step={1} onChange={(v) => updateParam("thermal_efficiency_pct", v)} />
          <ParamSlider label="Specific Energy Input" unit="GJ/tCO₂" value={localParams.energy_input_gj_tco2} min={2.5} max={4.0} step={0.05} onChange={(v) => updateParam("energy_input_gj_tco2", v)} />
        </div>
      </details>
    </div>
  );
}

// ──────────────��──────────────────────────────────────────────────────────────
// Helper components (reusable primitives)
// ─────────────────────────────────────────────────────────────────────────────







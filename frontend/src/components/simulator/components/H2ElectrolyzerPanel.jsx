/**
 * H2ElectrolyzerPanel.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Electrolyzer node detail panel — mirrors the H2GeneratorPanel structure.
 *
 * Key differences from the Generator panel:
 *  • NO CSV upload (ELZ is a consumer, not a source)
 *  • Chart 1: Nonlinear partial-load efficiency curve  (kWh/kg H₂ vs. load %)
 *  • Chart 2: Simulated 24 h H₂ production rate       (kg H₂/h vs. time)
 *  • KPIs are ELZ-specific: efficiency, specific energy consumption, H₂ output
 *
 * Props:
 *   selectedModel  {Object}  – active ELZ tech from opentech-db / fallback
 *   genTechType    {string}  – tech type of the upstream generator ('solar','wind',…)
 *   genCapacityKw  {number}  – rated capacity of upstream generator (kW)
 *   result         {Object}  – simulation result (optional)
 *   simState       {string}  – 'idle'|'queued'|'running'|'done'|'error'
 *   variants       {Array}   – variant list from fetchH2Variants
 *   onParamsChange {Function}– called whenever local overrides change
 */

import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import ReactECharts from "echarts-for-react";
import {
  FiZap, FiDroplet, FiActivity, FiBarChart2, FiTrendingUp,
  FiInfo, FiClock, FiSettings, FiLayers, FiCpu,
} from "react-icons/fi";
import MetricBadge from './ui/MetricBadge';

// ─────────────────────────────────────────────────────────────────────────────
// ELZ type detection from model id / name
// ─────────────────────────────────────────────────────────────────────────────
function detectElzType(model) {
  if (!model) return "pem";
  const key = `${model.id ?? ""} ${model.name ?? ""}`.toLowerCase();
  if (/pem|proton.exchange|proton membrane/.test(key)) return "pem";
  if (/alkaline|alk/.test(key))                        return "alkaline";
  if (/soec|solid.oxide|high.temp/.test(key))          return "soec";
  if (/aem|anion/.test(key))                           return "aem";
  return "pem";
}

// Per-ELZ-type metadata
const ELZ_META = {
  pem: {
    label:     "PEM Electrolyzer",
    hue:       "#6b7280",
    bg:        "bg-surface-container",
    border:    "border-outline-variant/30",
    tagline:   "Fast-response · wide partial-load range (5–100 %)",
    minLoad:   5,
    peakLoadPct: 55,
    effPeak:   74,
    h2hhv:     39.4,
    h2lhv:     33.3,
  },
  alkaline: {
    label:     "Alkaline Electrolyzer",
    hue:       "#6b7280",
    bg:        "bg-surface-container",
    border:    "border-outline-variant/30",
    tagline:   "Mature technology · high capacity stacks (20–100 %)",
    minLoad:   20,
    peakLoadPct: 68,
    effPeak:   67,
    h2hhv:     39.4,
    h2lhv:     33.3,
  },
  soec: {
    label:     "SOEC (High-Temp)",
    hue:       "#6b7280",
    bg:        "bg-surface-container",
    border:    "border-outline-variant/30",
    tagline:   "Steam electrolysis · thermally-assisted (30–100 %)",
    minLoad:   30,
    peakLoadPct: 58,
    effPeak:   87,
    h2hhv:     39.4,
    h2lhv:     33.3,
  },
  aem: {
    label:     "AEM Electrolyzer",
    hue:       "#6b7280",
    bg:        "bg-surface-container",
    border:    "border-outline-variant/30",
    tagline:   "Next-gen · PEM-like with lower-cost materials (5–100 %)",
    minLoad:   5,
    peakLoadPct: 50,
    effPeak:   70,
    h2hhv:     39.4,
    h2lhv:     33.3,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Partial-load efficiency model
//
// Combines two loss mechanisms:
//   • Activation / concentration losses at low loads (efficiency falls below ~20 %)
//   • Ohmic / mass-transport losses at high loads   (efficiency falls above peak)
//
// Returns efficiency as a fraction [0, 1].  Returns 0 for loads below minLoad.
// ─────────────────────────────────────────────────────────────────────────────
function partialLoadEff(loadFrac, elzType, effPeak_pct) {
  const { minLoad, peakLoadPct } = ELZ_META[elzType] ?? ELZ_META.pem;
  const effPeak = (effPeak_pct ?? ELZ_META[elzType]?.effPeak ?? 70) / 100;

  const loadPct = loadFrac * 100;
  if (loadPct <= 0)       return null;          // off
  if (loadPct < minLoad)  return 0;             // below minimum load → unit off

  const x     = loadFrac;
  const xPeak = peakLoadPct / 100;
  const xMin  = minLoad / 100;

  let drop;
  if (x >= xPeak) {
    // High-load ohmic losses — parabolic, reaches ~14 % relative drop at 100 %
    const range = Math.max(1 - xPeak, 0.01);
    drop = 0.14 * Math.min(1, ((x - xPeak) / range) ** 1.6);
  } else {
    // Low-load activation losses — steeper near minLoad
    const range = Math.max(xPeak - xMin, 0.01);
    drop = 0.12 * Math.min(1, ((xPeak - x) / range) ** 1.8);
  }

  return Math.max(0, effPeak * (1 - drop));
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart 1 — Partial-load efficiency curve
// Shows efficiency (%) and specific energy consumption (kWh/kg H₂) vs. load
// ─────────────────────────────────────────────────────────────────────────────
function buildEfficiencyCurveChart(elzType, effPct, hue) {
  const meta    = ELZ_META[elzType] ?? ELZ_META.pem;
  const H2HHV   = meta.h2hhv;          // 39.4 kWh/kg
  const minLoad = meta.minLoad;

  // Generate 25 evenly-spaced load points 0 → 100 %
  const loadPoints = Array.from({ length: 41 }, (_, i) => i * 2.5); // 0, 2.5, 5, … 100
  const effValues   = [];
  const secValues   = [];   // specific energy consumption (kWh/kg)
  const labels      = loadPoints.map((p) => `${p.toFixed(0)}%`);

  for (const lp of loadPoints) {
    const eff = partialLoadEff(lp / 100, elzType, effPct);
    if (eff === null || eff === 0 || lp < minLoad) {
      effValues.push(null);
      secValues.push(null);
    } else {
      const effPct_ = +(eff * 100).toFixed(2);
      effValues.push(effPct_);
      secValues.push(+(H2HHV / eff).toFixed(2));
    }
  }

  const peakEff = Math.max(...effValues.filter(Boolean));
  const peakIdx = effValues.indexOf(peakEff);

  return {
    chart: {
      animation: true,
      animationDuration: 700,
      tooltip: {
        trigger: "axis",
        formatter: (params) => {
          const label = params[0]?.axisValue ?? "";
          return (
            `<b>Load: ${label}</b><br/>` +
            params.filter((p) => p.value != null).map((p) =>
              `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;`+
              `background:${p.color};margin-right:4px;"></span>` +
              `${p.seriesName}: <b>${Number(p.value).toFixed(1)}${p.seriesName.includes("kWh") ? " kWh/kg" : " %"}</b>`
            ).join("<br/>")
          );
        },
      },
      legend: {
        data: ["Efficiency (%)", "Specific Energy (kWh/kg)"],
        bottom: 0,
        textStyle: { fontSize: 9 }, icon: 'roundRect',
      },
      grid: { top: 20, bottom: 68, left: 52, right: 60 },
      xAxis: {
        type: "category",
        data: labels,
        name: "Load",
        nameLocation: "middle",
        nameGap: 28,
        nameTextStyle: { fontSize: 9 },
        axisLabel: { fontSize: 9, interval: 3 },
        axisTick: { show: false },
        // Mark minimum load area
        splitArea: {
          show: true,
          areaStyle: {
            color: ["rgba(248,113,113,0.06)", "transparent"],
          },
        },
      },
      yAxis: [
        {
          type: "value",
          name: "η (%)",
          min: 0,
          max: 100,
          nameTextStyle: { fontSize: 9 },
          axisLabel: { fontSize: 9 },
        },
        {
          type: "value",
          name: "kWh/kg",
          nameTextStyle: { fontSize: 9 },
          axisLabel: { fontSize: 9 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "Efficiency (%)",
          type: "line",
          data: effValues,
          smooth: true,
          symbol: "none",
          connectNulls: false,
          color: hue,
          lineStyle: { color: hue, width: 2.5 },
          areaStyle: { color: hue.startsWith("#") ? `${hue}20` : "rgba(99,102,241,0.12)" },
          yAxisIndex: 0,
          markPoint: peakIdx >= 0 ? {
            symbol: "circle",
            symbolSize: 8,
            data: [{
              coord: [labels[peakIdx], peakEff],
              itemStyle: { color: hue },
              label: { show: true, formatter: `${peakEff.toFixed(1)}%`, fontSize: 10, color: hue, offset: [0, -16] },
            }],
          } : undefined,
        },
        {
          name: "Specific Energy (kWh/kg)",
          type: "line",
          data: secValues,
          smooth: true,
          symbol: "none",
          connectNulls: false,
          color: "#9ca3af",
          lineStyle: { color: "#9ca3af", width: 2, type: "dashed" },
          yAxisIndex: 1,
        },
      ],
    },
    summary: {
      peakEff: peakEff ?? effPct,
      minLoadPct: minLoad,
      peakLoad: meta.peakLoadPct,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generator power profile shape (mirrors H2GeneratorPanel theoreticalProfile)
// Returns array of 48 fractional values [0–1] for 30-min intervals over 24 h
// ─────────────────────────────────────────────────────────────────────────────
function genPowerFracts(genTechType) {
  const N    = 96; // 15-min points
  const pts  = Array.from({ length: N }, (_, i) => i * (24 / N));
  let fracs;

  switch (genTechType) {
    case "solar": {
      const peak   = 11.5, sigma = 2.8;
      fracs = pts.map((h) => {
        const raw = Math.exp(-0.5 * ((h - peak) / sigma) ** 2);
        return raw > 0.04 ? Math.min(1, raw * 1.05) : 0;
      });
      break;
    }
    case "wind": {
      fracs = pts.map((h) =>
        Math.min(1, Math.max(0,
          0.38
          + 0.18 * Math.sin(h * 0.65 + 1.2)
          + 0.12 * Math.sin(h * 1.7  + 0.5)
          + 0.07 * Math.sin(h * 3.1  + 2.0)
        ))
      );
      break;
    }
    case "nuclear":
    case "geothermal": {
      fracs = pts.map((h) => 0.90 + 0.015 * Math.sin((h / 24) * 2 * Math.PI));
      break;
    }
    case "coal":
    case "biomass": {
      fracs = pts.map((h) => {
        const base = h >= 7 && h < 22 ? 0.82 : 0.55;
        return base + 0.03 * Math.sin(h * 0.9);
      });
      break;
    }
    case "gas": {
      fracs = pts.map((h) =>
        Math.min(1, Math.max(0.15,
          0.45
          + 0.25 * Math.sin(((h - 6) / 24) * 2 * Math.PI)
          + 0.08 * Math.sin(h * 2.1)
        ))
      );
      break;
    }
    case "hydro": {
      fracs = pts.map((h) => {
        const morn = 0.55 * Math.exp(-0.5 * ((h - 8) / 2.2) ** 2);
        const eve  = 0.65 * Math.exp(-0.5 * ((h - 19) / 2.5) ** 2);
        return Math.min(1, Math.max(0.15, morn + eve + 0.18));
      });
      break;
    }
    default: {
      fracs = pts.map(() => 0.75);
    }
  }

  // Downsample to 48 points (30-min resolution)
  return {
    fracs: fracs.filter((_, i) => i % 2 === 0),
    labels: Array.from({ length: 48 }, (_, i) => {
      const h = Math.floor(i / 2);
      const m = i % 2 === 0 ? "00" : "30";
      return `${String(h).padStart(2, "0")}:${m}`;
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart 2 — 24 h H₂ production rate (step-by-step / hour-by-hour)
//
// Combines:
//   • The upstream generator's power profile shape  (from genTechType)
//   • The ELZ's nonlinear partial-load efficiency   (applied per step)
// => output: kg H₂/h at each 30-min step
// ─────────────────────────────────────────────────────────────────────────────
function buildH2ProductionChart(elzType, effPct, capacityKw, genTechType, hue) {
  const H2HHV = ELZ_META[elzType]?.h2hhv ?? 39.4;
  const { fracs, labels } = genPowerFracts(genTechType ?? "generic");

  const powerKw    = fracs.map((f) => f * capacityKw);
  const loadFracs  = fracs;

  const h2KgPerH   = powerKw.map((p, i) => {
    const eff = partialLoadEff(loadFracs[i], elzType, effPct);
    if (!eff) return 0;
    // Power in kW, time step = 0.5 h → energy = p * 0.5 kWh,  but we want rate per *hour*
    // H₂ mass rate [kg/h] = P_kW [kWh/h] * eff / H2HHV [kWh/kg]
    return +(p * eff / H2HHV).toFixed(3);
  });

  const effProfile = powerKw.map((_, i) => {
    const eff = partialLoadEff(loadFracs[i], elzType, effPct);
    return eff ? +(eff * 100).toFixed(1) : null;
  });

  const totalKgH2 = h2KgPerH.reduce((s, v) => s + v * 0.5, 0); // 0.5 h steps
  const avgH2Rate = h2KgPerH.reduce((s, v) => s + v, 0) / h2KgPerH.length;
  const peakH2Rate = Math.max(...h2KgPerH);

  return {
    chart: {
      animation: true,
      animationDuration: 800,
      tooltip: {
        trigger: "axis",
        formatter: (params) => {
          const lbl = params[0]?.axisValue ?? "";
          const h2p = params.find((p) => p.seriesName?.includes("H₂"));
          const effp = params.find((p) => p.seriesName?.includes("η"));
          return (
            `<b>${lbl}</b><br/>` +
            (h2p ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${hue};margin-right:4px;"></span>H₂ rate: <b>${Number(h2p.value ?? 0).toFixed(2)} kg/h</b><br/>` : "") +
            (effp && effp.value != null ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#9ca3af;margin-right:4px;"></span>η: <b>${Number(effp.value).toFixed(1)} %</b>` : "")
          );
        },
      },
      legend: {
        data: ["H₂ Production (kg/h)", "ELZ Efficiency (η %)"],
        bottom: 0,
        textStyle: { fontSize: 9 }, icon: 'roundRect',
      },
      grid: { top: 20, bottom: 44, left: 58, right: 58 },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { fontSize: 9, interval: 5 },
        boundaryGap: false,
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: "value",
          name: "kg/h",
          min: 0,
          nameTextStyle: { fontSize: 9 },
          axisLabel: { fontSize: 9 },
        },
        {
          type: "value",
          name: "η (%)",
          min: 0,
          max: 100,
          nameTextStyle: { fontSize: 9 },
          axisLabel: { fontSize: 9 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "H₂ Production (kg/h)",
          type: "line",
          data: h2KgPerH,
          smooth: true,
          symbol: "none",
          color: hue,
          lineStyle: { color: hue, width: 2.5 },
          areaStyle: { color: hue.startsWith("#") ? `${hue}22` : "rgba(99,102,241,0.12)" },
          yAxisIndex: 0,
        },
        {
          name: "ELZ Efficiency (η %)",
          type: "line",
          data: effProfile,
          smooth: true,
          symbol: "none",
          connectNulls: false,
          color: "#9ca3af",
          lineStyle: { color: "#9ca3af", width: 1.5, type: "dashed" },
          yAxisIndex: 1,
        },
      ],
    },
    summary: {
      totalKgH2:  +totalKgH2.toFixed(1),
      avgH2Rate:  +avgH2Rate.toFixed(2),
      peakH2Rate: +peakH2Rate.toFixed(2),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart 3 — Production statistics bar chart (similar to generator stats)
// ─────────────────────────────────────────────────────────────────────────────
function buildH2StatsChart(elzType, effPct, capacityKw, genTechType, hue) {
  const H2HHV   = ELZ_META[elzType]?.h2hhv ?? 39.4;
  const meta    = ELZ_META[elzType] ?? ELZ_META.pem;
  const { fracs }   = genPowerFracts(genTechType ?? "generic");

  const h2Rates = fracs.map((f) => {
    const eff = partialLoadEff(f, elzType, effPct);
    if (!eff) return 0;
    return (f * capacityKw * eff) / H2HHV; // kg/h
  });

  const peak  = Math.max(...h2Rates);
  const avg   = h2Rates.reduce((s, v) => s + v, 0) / h2Rates.length;
  const min   = Math.min(...h2Rates.filter((v) => v > 0));
  // Theoretical max: at peak eff and full capacity
  const maxEff = partialLoadEff(meta.peakLoadPct / 100, elzType, effPct);
  const rated  = capacityKw * (maxEff ?? effPct / 100) / H2HHV;

  const categories = ["Rated (peak η)", "Typical Peak", "Average", "Min (online)"];
  const values     = [+rated.toFixed(2), +peak.toFixed(2), +avg.toFixed(2), +min.toFixed(2)];
  const colors     = [hue, `${hue}cc`, `${hue}99`, `${hue}55`];

  const daily_kg  = +(avg * 24).toFixed(1);
  const annual_kg = +(daily_kg * 365).toFixed(0);

  return {
    chart: {
      animation: true,
      animationDuration: 600,
      tooltip: {
        trigger: "axis",
        formatter: (params) =>
          params.map((p) =>
            `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${p.color};margin-right:4px;"></span>` +
            `${p.name}: <b>${Number(p.value).toFixed(2)} kg/h</b>`
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
        name: "kg H₂/h",
        nameTextStyle: { fontSize: 9 },
        axisLabel: { fontSize: 9 },
      },
      series: [{
        type: "bar",
        data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i], borderRadius: [5, 5, 0, 0] } })),
        barWidth: "48%",
        label: {
          show: true, position: "top", fontSize: 10,
          formatter: (p) => `${p.value} kg/h`,
        },
      }],
    },
    summary: { rated: +rated.toFixed(2), peak: +peak.toFixed(2), avg: +avg.toFixed(2), min: +min.toFixed(2), daily_kg, annual_kg },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulation overlay — actual H₂ production from result
// ─────────────────────────────────────────────────────────────────────────────
function buildActualH2Chart(result, hue, elzName) {
  const t = (result?.time_s ?? []).map((s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m} min`;
  });

  const elzP  = result?.electrolyzer_power_kw ?? [];
  const h2Nm3 = result?.h2_production_nm3h    ?? [];

  // Convert Nm³/h → kg/h (density of H₂ = 0.0899 kg/Nm³)
  const h2Kg  = h2Nm3.map((v) => +(v * 0.0899).toFixed(3));

  const avgKg  = h2Kg.length  ? +(h2Kg.reduce((s, v) => s + v, 0) / h2Kg.length).toFixed(2)  : null;
  const peakKg = h2Kg.length  ? +Math.max(...h2Kg).toFixed(2) : null;
  const avgPwr = elzP.length  ? +(elzP.reduce((s, v) => s + v, 0) / elzP.length).toFixed(1) : null;

  return {
    chart: {
      animation: true,
      animationDuration: 600,
      tooltip: {
        trigger: "axis",
        formatter: (params) =>
          `<b>${params[0]?.axisValue}</b><br/>` +
          params.map((p) =>
            `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${p.color};margin-right:4px;"></span>` +
            `${p.seriesName}: <b>${Number(p.value ?? 0).toFixed(2)}</b>`
          ).join("<br/>"),
      },
      legend: {
        data: ["H₂ Production (kg/h)", "ELZ Power (kW)"],
        bottom: 0, textStyle: { fontSize: 9 }, icon: 'roundRect',
      },
      grid: { top: 16, bottom: 44, left: 58, right: 60 },
      xAxis: {
        type: "category", data: t,
        axisLabel: { fontSize: 9, rotate: t.length > 30 ? 25 : 0 },
        boundaryGap: false,
        axisTick: { show: false },
      },
      yAxis: [
        { type: "value", name: "kg/h", nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 } },
        { type: "value", name: "kW",   nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 }, splitLine: { show: false } },
      ],
      series: [
        {
          name: "H₂ Production (kg/h)",
          type: "line",
          data: h2Kg,
          smooth: true, symbol: "none",
          color: hue,
          lineStyle: { color: hue, width: 2.5 },
          areaStyle: { color: hue.startsWith("#") ? `${hue}22` : "rgba(99,102,241,0.12)" },
          yAxisIndex: 0,
        },
        {
          name: "ELZ Power (kW)",
          type: "line",
          data: elzP,
          smooth: true, symbol: "none",
          color: "#64748b",
          lineStyle: { color: "#64748b", width: 1.5, type: "dashed" },
          yAxisIndex: 1,
        },
      ],
    },
    summary: { avgKg, peakKg, avgPwr },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared UI primitives (self-contained to avoid circular imports)
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
            hover:border-outline-variant/40 transition-colors"
          style={{ fontVariantNumeric: "tabular-nums", color: isOverridden ? "#374151" : "#475569" }}
        />
        <span className="text-[10px] text-on-surface-variant/70 w-[42px] shrink-0 leading-none">{unit}</span>
        <button
          onClick={onReset}
          className={`w-4 text-[10px] leading-none transition-all
            ${isOverridden
              ? "text-on-surface-variant hover:text-on-surface opacity-100"
              : "text-slate-200 cursor-default opacity-0 group-hover:opacity-40"}`}
          title="Reset to default"
          disabled={!isOverridden}
        >✕</button>
      </div>
    </div>
  );
}



// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
export default function H2ElectrolyzerPanel({
  selectedModel,
  genTechType,
  genCapacityKw,
  result,
  simState,
  variants,
  savedParams,
  onParamsChange,
}) {
  const elzType = detectElzType(selectedModel);
  const meta    = ELZ_META[elzType] ?? ELZ_META.pem;
  const hue     = meta.hue;

  // ── Local parameter overrides ────────────────────────────────────────────
  // Lazy initialiser: restores savedParams when the modal re-opens.
  const [localParams, setLocalParams] = useState(() => savedParams ?? {});

  const isFirstRender = useRef(true);
  const modelId = selectedModel?.id;
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setLocalParams({});
    onParamsChange?.({});
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

  // ── Effective model ──────────────────────────────────────────────────────
  const effectiveModel = useMemo(() => {
    if (!selectedModel) return selectedModel;
    const safeNum = (x) => { const n = Number(x); return isFinite(n) ? n : undefined; };
    const ov = {};
    if (localParams.capacity_kw     != null) ov.capacity_kw      = safeNum(localParams.capacity_kw)     ?? localParams.capacity_kw;
    if (localParams.efficiency_pct  != null) ov.efficiency_pct   = safeNum(localParams.efficiency_pct)  ?? localParams.efficiency_pct;
    if (localParams.capex_usd_per_kw!= null) ov.capex_usd_per_kw = safeNum(localParams.capex_usd_per_kw)?? localParams.capex_usd_per_kw;
    if (localParams.lifetime_yr     != null) ov.lifetime_yr      = safeNum(localParams.lifetime_yr)     ?? localParams.lifetime_yr;
    return { ...selectedModel, ...ov };
  }, [selectedModel, localParams]);

  // Safe numeric values
  const rawCap      = effectiveModel?.capacity_kw;
  const capacityKw  = (rawCap != null && isFinite(Number(rawCap))) ? Number(rawCap) : 1000;

  const rawEff      = effectiveModel?.efficiency_pct
                   ?? (effectiveModel?._constraints?.energy_eff != null
                       ? +(Number(effectiveModel._constraints.energy_eff) * 100).toFixed(1)
                       : null);
  const effPct      = (rawEff != null && isFinite(Number(rawEff))) ? Number(rawEff) : meta.effPeak;

  const isDone      = simState === "done";

  // ── Upstream generator capacity  (ELZ is sized to the generator) ─────────
  // Use the passed genCapacityKw if present, otherwise use local capacityKw
  const upstreamKw  = (genCapacityKw != null && isFinite(Number(genCapacityKw)))
                    ? Number(genCapacityKw)
                    : capacityKw;

  // ── Charts ───────────────────────────────────────────────────────────────
  const effCurveChart = useMemo(
    () => buildEfficiencyCurveChart(elzType, effPct, hue),
    [elzType, effPct, hue]
  );

  const h2ProdChart = useMemo(
    () => buildH2ProductionChart(elzType, effPct, upstreamKw, genTechType, hue),
    [elzType, effPct, upstreamKw, genTechType, hue]
  );

  const h2StatsChart = useMemo(
    () => buildH2StatsChart(elzType, effPct, upstreamKw, genTechType, hue),
    [elzType, effPct, upstreamKw, genTechType, hue]
  );

  const actualChart = useMemo(
    () => isDone && result ? buildActualH2Chart(result, hue, effectiveModel?.name) : null,
    [isDone, result, hue, effectiveModel]
  );

  const [selectedElzChart, setSelectedElzChart] = useState("efficiency");

  // ── Variant resolution ───────────────────────────────────────────────────
  const activeVariant  = variants?.find((v) => v.id === localParams._variantId) ?? null;
  const dbConstraints  = activeVariant?._constraints ?? selectedModel?._constraints ?? {};
  const dbMonetary     = activeVariant?._monetary    ?? selectedModel?._monetary    ?? {};
  const hasOverrides   = Object.keys(localParams).filter((k) => k !== "_variantId").length > 0;

  const cDef = (key, fbModelKey, fbValue) =>
    dbConstraints[key] != null ? dbConstraints[key]
    : fbModelKey != null && effectiveModel?.[fbModelKey] != null ? effectiveModel[fbModelKey]
    : fbValue ?? null;
  const mDef = (key, fbModelKey, fbValue) =>
    dbMonetary[key] != null ? dbMonetary[key]
    : fbModelKey != null && effectiveModel?.[fbModelKey] != null ? effectiveModel[fbModelKey]
    : fbValue ?? null;

  // Specific energy consumption at current (average) efficiency
  const secKwhKg = effPct > 0 ? +((ELZ_META[elzType]?.h2hhv ?? 39.4) / (effPct / 100)).toFixed(1) : null;

  if (!selectedModel) {
    return (
      <div className="bg-surface-container-lowest rounded-2xl border border-dashed border-outline-variant/30 p-8 flex flex-col items-center justify-center text-center gap-3">
        <span className="p-4 rounded-full bg-surface-container border border-outline-variant/30 text-on-surface-variant/70">
          <FiCpu size={24} />
        </span>
        <p className="font-medium text-on-surface-variant">Select an electrolyzer technology in the flow diagram above</p>
        <p className="text-sm text-on-surface-variant/70">The electrolyzer analysis panel will appear once a model is chosen.</p>
      </div>
    );
  }

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
              <FiCpu size={18} />
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
              label="Rated Capacity"
              value={capacityKw >= 1000
                ? `${(capacityKw / 1000).toFixed(1)} MW`
                : `${capacityKw} kW`}
              unit="" color="indigo"
            />
            <MetricBadge
              label="Nom. Efficiency"
              value={`${effPct.toFixed(0)}`}
              unit="% (HHV)"
              color="green"
            />
            <MetricBadge
              label="Spec. Energy"
              value={secKwhKg ?? "—"}
              unit={secKwhKg ? "kWh/kg" : ""}
              color="amber"
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
              label="Daily H₂ Yield"
              value={h2StatsChart.summary.daily_kg >= 1000
                ? `${(h2StatsChart.summary.daily_kg / 1000).toFixed(1)} t`
                : `${h2StatsChart.summary.daily_kg}`}
              unit={h2StatsChart.summary.daily_kg >= 1000 ? "" : "kg/day"}
              color="blue"
            />
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
           SECTION B — Technology Variant selector
      ══════════════════════════════════════════════════════════════════════ */}
      {variants && variants.length > 1 && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 shadow-sm px-4 py-2.5
          flex flex-wrap items-center gap-3">
          <FiLayers size={12} style={{ color: hue }} />
          <span className="text-[11px] font-semibold text-on-surface-variant">Variant</span>
          <select
            value={localParams._variantId ?? ""}
            onChange={(e) => {
              const vid = e.target.value;
              if (!vid) { setLocalParams({}); onParamsChange?.({}); return; }
              const v = variants.find((vv) => vv.id === vid);
              if (!v) return;

              const safeNum = (x) => { const n = Number(x); return isFinite(n) ? n : null; };

              const capKw    = safeNum(v.capacity_kw)
                            ?? safeNum(v._constraints?.energy_cap_max)
                            ?? null;
              const effPct_  = safeNum(v.efficiency_pct)
                            ?? (v._constraints?.energy_eff != null
                                ? safeNum(+(v._constraints.energy_eff * 100).toFixed(1))
                                : null);
              const capex    = safeNum(v.capex_usd_per_kw) ?? safeNum(v._monetary?.energy_cap)  ?? null;
              const lifetime = safeNum(v.lifetime_yr)      ?? safeNum(v._constraints?.lifetime) ?? null;
              const opexFixed = safeNum(v.opex_fixed)      ?? safeNum(v._monetary?.om_annual)   ?? null;
              const opexVar   = safeNum(v.opex_var)        ?? safeNum(v._monetary?.om_prod)     ?? null;

              const patch = { _variantId: v.id };
              if (capKw     != null) patch.capacity_kw      = capKw;
              if (effPct_   != null) patch.efficiency_pct   = effPct_;
              if (capex     != null) patch.capex_usd_per_kw = capex;
              if (lifetime  != null) patch.lifetime_yr      = lifetime;
              if (opexFixed != null) patch.opex_fixed       = opexFixed;
              if (opexVar   != null) patch.opex_var         = opexVar;

              setLocalParams(patch);
              onParamsChange?.(patch);
            }}
            className="flex-1 min-w-[200px] max-w-xs text-[12px] border border-outline-variant/30 rounded-lg
              px-2.5 py-1.5 bg-surface-container text-on-surface focus:outline-none focus:ring-2
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
          {activeVariant && (
            <>
              <span className="text-[10px] text-on-surface-variant/70 italic truncate max-w-[200px]">
                {activeVariant.description ?? `${activeVariant.lifecycle ?? "commercial"} instance`}
              </span>
              <button
                onClick={() => { setLocalParams({}); onParamsChange?.({}); }}
                className="ml-auto text-[10px] text-on-surface-variant hover:text-on-surface font-medium whitespace-nowrap"
              >✕ Reset</button>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
           SECTION C — ELZ-specific Charts (single chart with dropdown)
      ══════════════════════════════════════════════════════════════════════ */}
      {(() => {
        const elzChartOptions = [
          { id: "efficiency", label: "Partial-Load Efficiency Curve" },
          { id: "h2Hourly",   label: "H₂ Production — Hourly Profile" },
          { id: "stats",      label: "H₂ Production Statistics" },
          ...(isDone && actualChart ? [{ id: "simulation", label: "Simulation Result" }] : []),
        ];
        const activeElz = elzChartOptions.find((o) => o.id === selectedElzChart) ? selectedElzChart : "efficiency";

        return (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              {activeElz === "efficiency"  && <FiTrendingUp size={13} style={{ color: hue }} />}
              {activeElz === "h2Hourly"   && <FiClock      size={13} style={{ color: hue }} />}
              {activeElz === "stats"      && <FiBarChart2  size={13} style={{ color: hue }} />}
              {activeElz === "simulation" && <FiActivity   size={13} style={{ color: hue }} />}
              <h4 className="text-sm font-semibold text-on-surface">
                {activeElz === "efficiency"  && "Partial-Load Efficiency Curve"}
                {activeElz === "h2Hourly"   && "H₂ Production — Hourly Profile"}
                {activeElz === "stats"      && "H₂ Production Statistics"}
                {activeElz === "simulation" && "Simulation Result — H₂ Production"}
              </h4>
              <select
                value={activeElz}
                onChange={(e) => setSelectedElzChart(e.target.value)}
                className="ml-auto text-xs bg-surface-container-high border border-outline-variant/30 rounded-lg px-2 py-1 text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                {elzChartOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>

            {activeElz === "efficiency" && (
              <p className="text-xs text-on-surface-variant/70 mb-3">
                Peak η: <b style={{ color: hue }}>{effCurveChart.summary.peakEff.toFixed(1)} %</b>
                {" · "}at <b style={{ color: hue }}>{effCurveChart.summary.peakLoad} % load</b>
                {" · "}Min load: <b className="text-on-surface-variant">{effCurveChart.summary.minLoadPct} %</b>
                {" · "}Dashed = specific energy (kWh/kg)
              </p>
            )}
            {activeElz === "h2Hourly" && (
              <p className="text-xs text-on-surface-variant/70 mb-3">
                Daily yield: <b style={{ color: hue }}>{h2ProdChart.summary.totalKgH2} kg H₂</b>
                {" · "}Avg: <b style={{ color: hue }}>{h2ProdChart.summary.avgH2Rate} kg/h</b>
                {" · "}Peak: <b className="text-on-surface-variant">{h2ProdChart.summary.peakH2Rate} kg/h</b>
              </p>
            )}
            {activeElz === "stats" && (
              <p className="text-xs text-on-surface-variant/70 mb-3">
                Annual output: <b style={{ color: hue }}>
                  {h2StatsChart.summary.annual_kg >= 1000
                    ? `${(h2StatsChart.summary.annual_kg / 1000).toFixed(1)} t H₂/yr`
                    : `${h2StatsChart.summary.annual_kg} kg H₂/yr`}
                </b>
                {" · "}at average generator CF · nonlinear ELZ efficiency
              </p>
            )}
            {activeElz === "simulation" && actualChart && (
              <p className="text-xs text-on-surface-variant/70 mb-3">
                Avg rate: <b style={{ color: hue }}>{actualChart.summary.avgKg} kg/h</b>
                {" · "}Peak: <b style={{ color: hue }}>{actualChart.summary.peakKg} kg/h</b>
                {" · "}ELZ power: <b className="text-on-surface-variant">{actualChart.summary.avgPwr} kW avg</b>
              </p>
            )}

            {activeElz === "efficiency"  && <ReactECharts key="efficiency"  option={effCurveChart.chart} style={{ height: 320 }} />}
            {activeElz === "h2Hourly"   && <ReactECharts key="h2Hourly"   option={h2ProdChart.chart}   style={{ height: 320 }} />}
            {activeElz === "stats"      && <ReactECharts key="stats"      option={h2StatsChart.chart}  style={{ height: 320 }} />}
            {activeElz === "simulation" && actualChart && <ReactECharts key="simulation" option={actualChart.chart} style={{ height: 320 }} />}
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════════════
           SECTION F — KPI Footer
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-wide font-medium">ELZ Efficiency</p>
          <p className="font-headline text-lg font-bold text-on-surface leading-tight">
            {effPct.toFixed(1)} <span className="text-sm font-normal">% (HHV)</span>
          </p>
          <p className="text-[10px] text-on-surface-variant/70">Nominal · at peak load</p>
        </div>
        <div className="rounded-xl px-4 py-3 border" style={{ background: `${hue}14`, borderColor: `${hue}44` }}>
          <p className="text-[10px] uppercase tracking-wide font-medium" style={{ color: hue }}>Spec. Energy</p>
          <p className="font-headline text-lg font-bold leading-tight" style={{ color: hue }}>
            {secKwhKg ?? "—"} <span className="text-sm font-normal">kWh/kg</span>
          </p>
          <p className="text-[10px] text-on-surface-variant/70">H₂ HHV = 39.4 kWh/kg</p>
        </div>
        <div className="bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-wide font-medium">Daily H₂</p>
          <p className="font-headline text-lg font-bold text-on-surface leading-tight">
            {h2StatsChart.summary.daily_kg >= 1000
              ? `${(h2StatsChart.summary.daily_kg / 1000).toFixed(2)} t`
              : `${h2StatsChart.summary.daily_kg} kg`}
            <span className="text-sm font-normal ml-1">H₂/day</span>
          </p>
          <p className="text-[10px] text-on-surface-variant/70">
            {isDone && actualChart?.summary.avgKg
              ? `Simulated avg: ${actualChart.summary.avgKg} kg/h`
              : `Avg generator CF · plant ${capacityKw >= 1000 ? `${(capacityKw / 1000).toFixed(1)} MW` : `${capacityKw} kW`}`}
          </p>
        </div>
        <div className="bg-surface-container border border-outline-variant/30 rounded-xl px-4 py-3">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-wide font-medium">Annual H₂</p>
          <p className="font-headline text-lg font-bold text-on-surface leading-tight">
            {h2StatsChart.summary.annual_kg >= 1000
              ? <>{(h2StatsChart.summary.annual_kg / 1000).toFixed(1)} <span className="text-sm font-normal">t H₂/yr</span></>
              : <>{h2StatsChart.summary.annual_kg} <span className="text-sm font-normal">kg H₂/yr</span></>}
          </p>
          <p className="text-[10px] text-on-surface-variant/70">Estimated annual output</p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
           SECTION G — DB Constraints & Parameters (collapsible)
      ══════════════════════════════════════════════════════════════════════ */}
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
              className="ml-2 text-[10px] text-on-surface-variant hover:text-on-surface font-medium px-2 py-0.5
                rounded hover:bg-surface-container transition-colors shrink-0"
            >Reset all</button>
          )}
        </summary>

        <div className="px-4 pb-4 pt-2 border-t border-outline-variant/20">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0">

            {/* Technical constraints */}
            <div>
              <p className="text-[9px] font-bold text-on-surface-variant/50 uppercase tracking-widest mb-2">Technical</p>
              <div className="space-y-1.5">
                <ConstraintRow
                  label="Max Capacity"
                  unit="kW"
                  value={localParams.capacity_kw ?? null}
                  defaultValue={cDef("energy_cap_max", "capacity_kw", 1000)}
                  min={10}
                  max={Math.max((cDef("energy_cap_max", "capacity_kw", 1000) ?? 1000) * 5, 50000)}
                  step={50}
                  onChange={(v) => handleParam("capacity_kw", v)}
                  onReset={() => resetParam("capacity_kw")}
                />
                <ConstraintRow
                  label="Efficiency"
                  unit="% (HHV)"
                  value={localParams.efficiency_pct ?? null}
                  defaultValue={
                    cDef("energy_eff", null, null) != null
                      ? +(Number(cDef("energy_eff", null, null)) * 100).toFixed(1)
                      : effectiveModel?.efficiency_pct ?? meta.effPeak
                  }
                  min={20} max={100} step={0.5}
                  onChange={(v) => handleParam("efficiency_pct", v)}
                  onReset={() => resetParam("efficiency_pct")}
                />
                <ConstraintRow
                  label="Min Load"
                  unit="%"
                  value={localParams.min_load_pct ?? null}
                  defaultValue={meta.minLoad}
                  min={0} max={50} step={1}
                  onChange={(v) => handleParam("min_load_pct", v)}
                  onReset={() => resetParam("min_load_pct")}
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
                  defaultValue={cDef("lifetime", "lifetime_yr", 20)}
                  min={5} max={50} step={1}
                  onChange={(v) => handleParam("lifetime_yr", v)}
                  onReset={() => resetParam("lifetime_yr")}
                />
              </div>
            </div>

            {/* Economic parameters */}
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
                  label="Fixed O&amp;M"
                  unit="$/kW/yr"
                  value={localParams.opex_fixed ?? null}
                  defaultValue={mDef("om_annual", null, null)}
                  min={0} max={500} step={1}
                  onChange={(v) => handleParam("opex_fixed", v)}
                  onReset={() => resetParam("opex_fixed")}
                />
                <ConstraintRow
                  label="Variable O&amp;M"
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
                      ? +(Number(mDef("interest_rate", null, 0.10)) *
                          (Number(mDef("interest_rate", null, 0.10)) > 1 ? 1 : 100)).toFixed(1)
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
            <span>Capacity: <b className="text-on-surface-variant">{capacityKw >= 1000 ? `${(capacityKw / 1000).toFixed(1)} MW` : `${capacityKw} kW`}</b></span>
            <span>η: <b className="text-on-surface-variant">{effPct.toFixed(1)} % (HHV)</b></span>
            <span>Spec. energy: <b className="text-on-surface-variant">{secKwhKg ?? "—"} kWh/kg</b></span>
            <span>Daily H₂: <b className="text-on-surface-variant">{h2StatsChart.summary.daily_kg >= 1000
              ? `${(h2StatsChart.summary.daily_kg / 1000).toFixed(2)} t`
              : `${h2StatsChart.summary.daily_kg} kg`}</b></span>
          </div>
        </div>
      </details>

    </div>
  );
}

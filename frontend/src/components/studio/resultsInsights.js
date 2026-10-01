/**
 * resultsInsights.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Presentation helpers for the Process Studio results panel (ADR-0004):
 *   - KPI registry (label + formatter + plain-language definition)
 *   - a deterministic narrative summary of a simulation result
 *   - an ECharts Sankey option built from the engine's pre-joined `flows`
 *
 * All deterministic — no AI, no network. The engine (services/processsim) does
 * the physics + energy accounting; this file only renders it.
 */

import { carrierColor } from './equipmentLibrary';

// ── Number formatting ────────────────────────────────────────────────────────
export const fmtPower = (kw) => {
  const v = Number(kw) || 0;
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} MW` : `${Math.round(v)} kW`;
};
export const fmtEur = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e6) return `€${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `€${(n / 1e3).toFixed(0)}k`;
  return `€${Math.round(n)}`;
};
const round = (v, d = 1) => (Number.isFinite(+v) ? +(+v).toFixed(d) : v);

// ── KPI registry ─────────────────────────────────────────────────────────────
export const KPI_META = {
  source_power_kw:           { label: 'Input Power',    fmt: fmtPower, info: 'Electrical power supplied by the process sources.' },
  output_power_kw:           { label: 'Output Power',   fmt: fmtPower, info: 'Electrical power delivered to the sinks (grid / load).' },
  round_trip_efficiency_pct: { label: 'Round-trip η',   fmt: (v) => `${v} %`, info: 'Electrical output ÷ electrical input, for power-to-power chains.' },
  overall_efficiency_pct:    { label: 'Overall η',      fmt: (v) => `${v} %`, info: 'Useful energy reaching the sinks ÷ energy entering from the sources.' },
  h2_production_kg_h:        { label: 'H₂ Production',   fmt: (v) => `${v} kg/h`, info: 'Hydrogen mass flow produced by the electrolyzer(s).' },
  co2_captured_kg_h:         { label: 'CO₂ Captured',    fmt: (v) => `${v} kg/h`, info: 'CO₂ mass flow separated by the capture units.' },
  co2_captured_mtco2_yr:     { label: 'CO₂ Captured',    fmt: (v) => `${v} Mt/yr`, info: 'Annualized captured CO₂ (kg/h × 8760 h).' },
  parasitic_load_kw:         { label: 'Parasitic Load', fmt: fmtPower, info: 'Auxiliary power drawn by compressors and other utilities.' },
  heat_output_kw:            { label: 'Heat Output',    fmt: fmtPower, info: 'Useful thermal power delivered (e.g. district heat from CHP).' },
  methane_output_kw:         { label: 'Methane Output', fmt: fmtPower, info: 'Energy content of the (bio/synthetic) methane delivered to the gas grid.' },
  total_loss_kw:             { label: 'Total Losses',   fmt: fmtPower, info: 'Sum of energy lost across all conversion units (in − out).' },
};

const prettify = (k) => k.replace(/_(kw|pct|kg_h|mtco2_yr)$/,'').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** All KPI entries, using the registry where known and a generic fallback otherwise. */
export function kpiEntries(kpi) {
  return Object.entries(kpi || {}).map(([key, value]) => {
    const meta = KPI_META[key];
    return {
      key,
      label: meta?.label ?? prettify(key),
      display: meta ? meta.fmt(value) : String(round(value)),
      info: meta?.info ?? null,
    };
  });
}

// ── Stream quantity formatting (for the Flows table) ─────────────────────────
const QTY_UNIT = {
  power_kw: 'kW', h2_kg_h: 'kg/h H₂', co2_kg_h: 'kg/h CO₂', ch4_kg_h: 'kg/h CH₄',
  ch4_kw: 'kW', biogas_kw: 'kW', fuel_kw: 'kW', heat_kw: 'kW', flue_kw: 'kW',
  biomass_kg_h: 'kg/h', water_kg_h: 'kg/h', pressure_bar: 'bar',
};
export function fmtQuantity(q) {
  return Object.entries(q || {})
    .filter(([k, v]) => QTY_UNIT[k] && typeof v === 'number')
    .slice(0, 3)
    .map(([k, v]) => `${round(v, 1)} ${QTY_UNIT[k]}`)
    .join(' · ') || '—';
}

// ── Narrative ────────────────────────────────────────────────────────────────
/** Deterministic plain-language summary computed from the result. */
export function buildNarrative(result) {
  if (!result) return '';
  const kpi = result.kpi ?? {};
  const units = result.units ?? {};
  const labels = {};
  (result.flows ?? []).forEach((f) => { labels[f.from_unit] = f.from_label; labels[f.to_unit] = f.to_label; });

  const parts = [];
  if (kpi.source_power_kw && kpi.output_power_kw) {
    parts.push(`converts ${fmtPower(kpi.source_power_kw)} of electricity into ${fmtPower(kpi.output_power_kw)} of electrical output`);
  } else if (kpi.methane_output_kw) {
    parts.push(`produces ${fmtPower(kpi.methane_output_kw)} of methane for the gas grid`);
  } else if (kpi.heat_output_kw && kpi.output_power_kw == null) {
    parts.push(`co-produces power and ${fmtPower(kpi.heat_output_kw)} of useful heat`);
  } else if (kpi.h2_production_kg_h) {
    parts.push(`produces ${kpi.h2_production_kg_h} kg/h of hydrogen`);
  } else if (kpi.co2_captured_kg_h) {
    parts.push(`captures ${kpi.co2_captured_kg_h} kg/h of CO₂ (${kpi.co2_captured_mtco2_yr ?? '—'} Mt/yr)`);
  }
  if (kpi.overall_efficiency_pct != null) parts.push(`an overall energy efficiency of ${kpi.overall_efficiency_pct}%`);

  let sentence = parts.length ? `This process ${parts.join(', ')}.` : 'Simulation complete.';

  // Dominant loss
  const losses = Object.entries(units)
    .map(([id, r]) => [id, (r.balance?.loss_kw) || 0])
    .filter(([, l]) => l > 0)
    .sort((a, b) => b[1] - a[1]);
  if (losses.length) {
    const [id, kw] = losses[0];
    sentence += ` The largest energy loss is at ${labels[id] ?? id} (${fmtPower(kw)}).`;
  }

  // Limiting-reactant hint (e.g. methanation)
  const limited = Object.entries(units).find(([, r]) => r.limiting_reactant);
  if (limited) {
    const [id, r] = limited;
    sentence += ` ${labels[id] ?? id} is ${r.limiting_reactant}-limited.`;
  }
  return sentence;
}

// ── Sankey ───────────────────────────────────────────────────────────────────
/** ECharts Sankey option from the engine's `flows` (energy-carrying links only). */
export function buildSankeyOption(flows) {
  const links = (flows ?? [])
    .filter((f) => (f.energy_kw || 0) > 0)
    .map((f) => ({
      source: f.from_unit, target: f.to_unit, value: f.energy_kw,
      lineStyle: { color: carrierColor(f.carrier), opacity: 0.45 },
    }));
  const labels = {};
  (flows ?? []).forEach((f) => { labels[f.from_unit] = f.from_label; labels[f.to_unit] = f.to_label; });
  const linked = new Set();
  links.forEach((l) => { linked.add(l.source); linked.add(l.target); });
  const nodes = [...linked].map((id) => ({ name: id, itemStyle: { color: '#4d4b9e' } }));

  return {
    animation: false,
    tooltip: {
      trigger: 'item',
      formatter: (p) => (p.dataType === 'edge'
        ? `${labels[p.data.source] ?? p.data.source} → ${labels[p.data.target] ?? p.data.target}<br/><b>${fmtPower(p.data.value)}</b>`
        : (labels[p.name] ?? p.name)),
    },
    series: [{
      type: 'sankey', emphasis: { focus: 'adjacency' },
      data: nodes, links,
      nodeWidth: 14, nodeGap: 14, draggable: false,
      label: { formatter: (p) => labels[p.name] ?? p.name, fontSize: 10, color: '#1b1b1f' },
      lineStyle: { curveness: 0.5 },
    }],
  };
}

// ── Dynamic traces (Modelica time-series) ────────────────────────────────────
export function buildTraceOption(ts) {
  const fmtT = (t) => (t >= 3600 ? `${(t / 3600).toFixed(1)}h` : `${Math.round(t / 60)}m`);
  return {
    animation: false,
    color: ['#4d4b9e', '#943700', '#5b5d72', '#6f7dd6', '#4d7c0f', '#a16207'],
    grid: { top: 22, bottom: 34, left: 56, right: 16 },
    tooltip: { trigger: 'axis' },
    legend: { data: ts.series.map((s) => s.name), bottom: 0, textStyle: { fontSize: 10 } },
    xAxis: { type: 'category', data: (ts.time_s ?? []).map(fmtT), axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10 }, name: ts.series[0]?.unit, nameTextStyle: { fontSize: 10 } },
    series: ts.series.map((s) => ({
      name: s.name, type: 'line', smooth: true, symbol: 'none',
      data: s.data, areaStyle: { opacity: 0.08 },
    })),
  };
}

/**
 * CompressorAnalysis.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Carrier-agnostic compressor analysis (H₂ or CO₂): specific compression work
 * vs outlet pressure, from the Unit's target pressure and isentropic efficiency
 * (mirrors the steady-state/Modelica physics `0.5·ln(p)/η`).
 */

import React from 'react';
import ReactECharts from 'echarts-for-react';

export default function CompressorAnalysis({ model }) {
  const pOut = Number(model?.target_pressure_bar ?? 350);
  const eta = Number(model?.isentropic_efficiency ?? 0.78);
  const stages = model?.number_stages != null ? Number(model.number_stages) : null;

  const pressures = [];
  for (let p = 10; p <= Math.max(pOut * 1.15, 20); p += Math.max(5, Math.round(pOut / 12))) pressures.push(p);
  const spec = (p) => +(0.5 * Math.log(Math.max(p, 2)) / Math.max(eta, 0.1)).toFixed(3); // kWh/kg
  const specAtTarget = spec(pOut);

  const option = {
    animation: false,
    color: ['#4d4b9e'],
    grid: { top: 26, bottom: 42, left: 56, right: 20 },
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${v} kWh/kg` },
    xAxis: { type: 'category', data: pressures.map((p) => `${p}`), name: 'Outlet pressure (bar)', nameLocation: 'middle', nameGap: 28, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', name: 'kWh/kg', axisLabel: { fontSize: 10 }, nameTextStyle: { fontSize: 10 } },
    series: [{
      name: 'Specific work', type: 'line', smooth: true, symbol: 'none',
      data: pressures.map(spec), areaStyle: { opacity: 0.08 },
      markLine: { silent: true, symbol: 'none', data: [{ xAxis: `${pressures.reduce((a, b) => (Math.abs(b - pOut) < Math.abs(a - pOut) ? b : a))}` }], lineStyle: { color: '#943700', type: 'dashed' }, label: { formatter: `target ${pOut} bar`, fontSize: 10 } },
    }],
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Target pressure" value={`${pOut} bar`} />
        <Stat label="Isentropic η" value={`${(eta * 100).toFixed(0)} %`} />
        <Stat label="Specific work" value={`${specAtTarget} kWh/kg`} />
        <Stat label="Stages" value={stages != null ? String(stages) : '—'} />
      </div>
      <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-primary text-[18px]">compress</span>
          <h3 className="font-headline text-sm font-bold text-on-surface">Compression Work vs Pressure</h3>
        </div>
        <ReactECharts option={option} style={{ height: 300 }} notMerge lazyUpdate />
        <p className="text-[11px] text-on-surface-variant/70 mt-2">
          Work grows with the log of the pressure ratio; higher isentropic efficiency lowers the parasitic draw.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">{label}</p>
      <p className="font-headline text-base font-bold text-on-surface">{value}</p>
    </div>
  );
}

/**
 * FuelCellAnalysis.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Compact analysis for a fuel-cell Unit (no dedicated panel existed in the old
 * simulator). Shows the efficiency-vs-load characteristic (fuel cells are most
 * efficient at part load) and power output vs load, from the composed
 * technology's nominal efficiency and capacity.
 */

import React from 'react';
import ReactECharts from 'echarts-for-react';

const HHV = 39.4; // kWh/kg H2

export default function FuelCellAnalysis({ model }) {
  const effNom = Number(model?.efficiency_pct ?? model?.nominal_efficiency_pct ?? 58);
  const ratedKw = Number(model?.capacity_kw ?? 1000);
  const minLoad = 10;

  // Fuel cells peak at low/mid load and decline toward full load.
  const loads = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);
  const eff = (x) => {
    if (x < minLoad) return null;
    const f = 1.14 - 0.26 * (x / 100);          // ~+14% at low load → ~−12% at full load
    return Math.max(20, Math.min(99, effNom * f));
  };
  const effSeries = loads.map(eff);
  const powerSeries = loads.map((x) => Math.round(ratedKw * (x / 100)));
  const peakEff = Math.max(...effSeries.filter((v) => v != null));
  const dailyH2 = +((ratedKw / (HHV * effNom / 100)) * 24 / 1000).toFixed(2); // t/day at nominal

  const option = {
    animation: false,
    color: ['#4d4b9e', '#6f7dd6'],
    grid: { top: 30, bottom: 42, left: 52, right: 56 },
    tooltip: { trigger: 'axis' },
    legend: { data: ['Efficiency (%)', 'Power (kW)'], bottom: 0, textStyle: { fontSize: 11 } },
    xAxis: { type: 'category', data: loads.map((x) => `${x}%`), name: 'Load', axisLabel: { fontSize: 10 } },
    yAxis: [
      { type: 'value', name: 'η (%)', min: 0, max: 100, axisLabel: { fontSize: 10 }, nameTextStyle: { fontSize: 10 } },
      { type: 'value', name: 'kW', axisLabel: { fontSize: 10 }, nameTextStyle: { fontSize: 10 }, splitLine: { show: false } },
    ],
    series: [
      { name: 'Efficiency (%)', type: 'line', smooth: true, symbol: 'circle', data: effSeries, yAxisIndex: 0, areaStyle: { opacity: 0.08 } },
      { name: 'Power (kW)', type: 'line', smooth: true, symbol: 'none', lineStyle: { type: 'dashed' }, data: powerSeries, yAxisIndex: 1 },
    ],
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Rated Power" value={ratedKw >= 1000 ? `${(ratedKw / 1000).toFixed(1)} MW` : `${ratedKw} kW`} />
        <Stat label="Nominal η" value={`${effNom.toFixed(0)} % (HHV)`} />
        <Stat label="Peak η" value={`${peakEff.toFixed(0)} %`} />
        <Stat label="H₂ demand" value={`${dailyH2} t/day`} />
      </div>
      <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-primary text-[18px]">bolt</span>
          <h3 className="font-headline text-sm font-bold text-on-surface">Part-Load Efficiency &amp; Power</h3>
        </div>
        <ReactECharts option={option} style={{ height: 300 }} notMerge lazyUpdate />
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

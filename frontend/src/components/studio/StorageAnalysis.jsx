/**
 * StorageAnalysis.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Storage/buffer analysis (H₂ tank, CO₂ reservoir): an illustrative
 * charge → hold → discharge state-of-charge cycle with the round-trip loss,
 * from the Unit's max pressure / round-trip efficiency (or injection rate).
 */

import React from 'react';
import ReactECharts from 'echarts-for-react';

export default function StorageAnalysis({ model }) {
  const maxP = model?.max_pressure_bar != null ? Number(model.max_pressure_bar) : null;
  const rte = Number(model?.round_trip_efficiency_pct ?? 99) / 100;
  const injection = model?.injection_rate_mtco2_yr != null ? Number(model.injection_rate_mtco2_yr) : null;
  const depth = model?.reservoir_depth_m != null ? Number(model.reservoir_depth_m) : null;

  // 24-slot cycle: charge to full (0–8h), hold (8–14h), discharge with RTE (14–24h).
  const hours = Array.from({ length: 25 }, (_, h) => h);
  const soc = hours.map((h) => {
    if (h <= 8) return Math.round((h / 8) * 100);
    if (h <= 14) return 100;
    const d = (h - 14) / 10;                       // 0..1 over discharge window
    return Math.max(0, Math.round(100 - d * 100 * rte));
  });

  const option = {
    animation: false,
    color: ['#4d4b9e'],
    grid: { top: 26, bottom: 40, left: 50, right: 20 },
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${v} %` },
    xAxis: { type: 'category', data: hours.map((h) => `${h}h`), name: 'Time', axisLabel: { fontSize: 10, interval: 3 } },
    yAxis: { type: 'value', name: 'State of charge (%)', min: 0, max: 100, axisLabel: { fontSize: 10 }, nameTextStyle: { fontSize: 10 } },
    series: [{ name: 'State of charge', type: 'line', smooth: true, symbol: 'none', data: soc, areaStyle: { opacity: 0.1 } }],
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {maxP != null && <Stat label="Max pressure" value={`${maxP} bar`} />}
        <Stat label="Round-trip η" value={`${(rte * 100).toFixed(0)} %`} />
        {injection != null && <Stat label="Injection rate" value={`${injection} Mt/yr`} />}
        {depth != null && <Stat label="Reservoir depth" value={`${depth} m`} />}
      </div>
      <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-primary text-[18px]">battery_charging_full</span>
          <h3 className="font-headline text-sm font-bold text-on-surface">Charge / Discharge Cycle</h3>
        </div>
        <ReactECharts option={option} style={{ height: 300 }} notMerge lazyUpdate />
        <p className="text-[11px] text-on-surface-variant/70 mt-2">
          Illustrative daily cycle — the round-trip efficiency sets how much of the stored energy is recovered on discharge.
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

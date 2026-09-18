/**
 * ResultsModal.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * The Process Studio results surface (ADR-0004) as a full pop-up so graphs,
 * tables and the economics breakdown have room to breathe.
 *
 *   Overview   – narrative + headline KPI cards + energy Sankey
 *   Flows      – every stream with carrier + computed quantity
 *   Units      – per-equipment energy balance + metrics (+ analysis charts)
 *   Economics  – annualized cost breakdown + per-unit split
 *   Dynamics   – time-series traces (OpenModelica) or a steady-state note
 *
 * Toolbar: Save (persist a snapshot) · Download (CSV / JSON / PNG) · Close.
 * Rendered via a portal so it always sits above the React Flow canvas.
 */

import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import ReactECharts from 'echarts-for-react';
import {
  FiBarChart2, FiX, FiInfo, FiActivity, FiTrendingDown, FiSave, FiDownload, FiChevronDown,
} from 'react-icons/fi';
import { equipmentDef, carrierColor } from './equipmentLibrary';
import UnitAnalysisModal, { hasAnalysis } from './UnitAnalysisModal';
import {
  kpiEntries, buildNarrative, buildSankeyOption, buildTraceOption,
  fmtPower, fmtEur, fmtQuantity,
} from './resultsInsights';

const TABS = [
  ['overview', 'Overview'], ['flows', 'Flows'], ['units', 'Units'],
  ['economics', 'Economics'], ['dynamics', 'Dynamics'],
];

// ── File helpers ─────────────────────────────────────────────────────────────
function download(filename, text, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

// Unwrap a Unit operating-condition value ({value, unit} or scalar).
function _ocNum(unit, key) {
  const v = unit?.operating_conditions?.[key];
  const raw = v && typeof v === 'object' ? v.value : v;
  return Number.isFinite(+raw) ? +raw : undefined;
}

function flowsCSV(result) {
  const rows = [['from', 'to', 'carrier', 'energy_kw', 'quantity']];
  (result.flows ?? []).forEach((f) => rows.push([f.from_label, f.to_label, f.carrier, f.energy_kw, fmtQuantity(f.quantity)]));
  return toCSV(rows);
}
function unitsCSV(result, graphById) {
  const rows = [['unit', 'equipment', 'in_kw', 'out_kw', 'loss_kw', 'metrics']];
  Object.entries(result.units ?? {}).forEach(([uid, r]) => {
    const b = r.balance ?? {};
    const metrics = Object.entries(r).filter(([k]) => k !== 'balance').map(([k, v]) => `${k}=${v}`).join('; ');
    rows.push([graphById[uid]?.name ?? uid, graphById[uid]?.equipment_type ?? '', b.in_kw ?? '', b.out_kw ?? '', b.loss_kw ?? '', metrics]);
  });
  return toCSV(rows);
}

export default function ResultsModal({ sim, open, onClose, onSave }) {
  const [tab, setTab] = useState('overview');
  const [analysisUnit, setAnalysisUnit] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);

  if (!open || !sim?.result) return null;
  const result = sim.result;
  const graph = sim.graph ?? { units: [], streams: [] };
  const graphById = Object.fromEntries((graph.units ?? []).map((u) => [u.id, u]));
  const slug = graph.slug || 'process';

  const exportPng = () => {
    const inst = chartRef.current?.getEchartsInstance?.();
    if (!inst) return;
    const a = document.createElement('a');
    a.href = inst.getDataURL({ pixelRatio: 2, backgroundColor: '#fff' });
    a.download = `${slug}_${tab}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const menu = [
    ['Flows (CSV)', () => download(`${slug}_flows.csv`, flowsCSV(result), 'text/csv')],
    ['Units (CSV)', () => download(`${slug}_units.csv`, unitsCSV(result, graphById), 'text/csv')],
    ['Full result (JSON)', () => download(`${slug}_result.json`, JSON.stringify(result, null, 2), 'application/json')],
    ['Current chart (PNG)', exportPng],
  ];

  return ReactDOM.createPortal(
    <>
      <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-[2px]"
        style={{ animation: 'otdb-fade 0.18s ease' }} onClick={onClose} aria-hidden />
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
        <div role="dialog" aria-modal="true" aria-label="Simulation Results"
          className="pointer-events-auto w-full max-w-[1400px] h-[90vh] flex flex-col bg-surface-container-lowest rounded-2xl shadow-2xl overflow-hidden"
          style={{ animation: 'otdb-pop 0.22s cubic-bezier(0.22,1,0.36,1)' }}
          onClick={(e) => e.stopPropagation()}>

          {/* Title bar */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-outline-variant/20 shrink-0">
            <span className="p-1.5 rounded-lg bg-primary/10 text-primary"><FiBarChart2 size={16} /></span>
            <div className="min-w-0">
              <h2 className="font-headline text-sm font-bold text-on-surface leading-tight truncate">Simulation Results</h2>
              <p className="text-[11px] text-on-surface-variant truncate">{graph.name ?? slug} · engine: {result.engine ?? '—'}</p>
            </div>
            <div className="ml-auto flex items-center gap-2 relative">
              <button onClick={() => { onSave?.(result); setSaved(true); setTimeout(() => setSaved(false), 1600); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  saved ? 'text-primary border-primary/40 bg-primary/5' : 'text-on-surface border-outline-variant/40 hover:bg-surface-container'}`}>
                <FiSave size={14} /> {saved ? 'Saved ✓' : 'Save'}
              </button>
              <button onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-on-surface border border-outline-variant/40 hover:bg-surface-container transition-colors">
                <FiDownload size={14} /> Download <FiChevronDown size={13} />
              </button>
              {menuOpen && (
                <div className="absolute right-9 top-full mt-1 w-52 rounded-xl bg-surface-container-lowest border border-outline-variant/30 shadow-2xl z-10 py-1"
                  onMouseLeave={() => setMenuOpen(false)}>
                  {menu.map(([label, fn]) => (
                    <button key={label} onClick={() => { fn(); setMenuOpen(false); }}
                      className="w-full text-left px-3 py-1.5 text-xs text-on-surface hover:bg-surface-container transition-colors">
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={onClose} className="p-1.5 text-on-surface-variant hover:text-on-surface" title="Close"><FiX size={18} /></button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 px-5 pt-2 shrink-0">
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  tab === id ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {tab === 'overview' && <OverviewTab result={result} chartRef={chartRef} />}
            {tab === 'flows' && <FlowsTab flows={result.flows} />}
            {tab === 'units' && <UnitsTab result={result} graphById={graphById} onAnalyse={setAnalysisUnit} />}
            {tab === 'economics' && <EconomicsTab econ={result.economics} />}
            {tab === 'dynamics' && <DynamicsTab result={result} chartRef={chartRef} />}
          </div>
        </div>
      </div>

      <UnitAnalysisModal open={!!analysisUnit} unit={analysisUnit}
        techModel={analysisUnit ? {
          name: analysisUnit.name,
          // carry the composed technology slug so the panel detects the real
          // source type (onshore_wind → wind profile, not a flat generic line)
          id: analysisUnit.technology_ref || analysisUnit.equipment_type,
        } : null}
        genCapacityKw={_ocNum(analysisUnit, 'capacity_kw')}
        onClose={() => setAnalysisUnit(null)} />

      <style>{`
        @keyframes otdb-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes otdb-pop  { from { opacity: 0; transform: scale(0.97) } to { opacity: 1; transform: scale(1) } }
      `}</style>
    </>,
    document.body,
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────
function OverviewTab({ result, chartRef }) {
  const entries = kpiEntries(result.kpi);
  const hasSankey = (result.flows ?? []).some((f) => (f.energy_kw || 0) > 0);
  return (
    <div className="space-y-4">
      <p className="text-sm text-on-surface leading-relaxed bg-surface-container rounded-xl px-4 py-3 border border-outline-variant/20">
        {buildNarrative(result)}
      </p>
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-2.5">
          {entries.map((e) => (
            <div key={e.key} title={e.info ?? undefined}
              className="rounded-xl border border-outline-variant/30 bg-surface-container px-4 py-2.5 min-w-[130px]">
              <p className="text-[10px] uppercase tracking-wide text-on-surface-variant flex items-center gap-1">
                {e.label} {e.info && <FiInfo size={10} className="opacity-60" />}
              </p>
              <p className="font-headline text-xl font-bold text-on-surface">{e.display}</p>
            </div>
          ))}
        </div>
      )}
      {hasSankey && (
        <div>
          <SectionLabel icon={FiActivity} text="Energy Flow" />
          <ReactECharts ref={chartRef} option={buildSankeyOption(result.flows)}
            style={{ height: '44vh', minHeight: 320 }} notMerge lazyUpdate />
        </div>
      )}
    </div>
  );
}

// ── Flows ────────────────────────────────────────────────────────────────────
function FlowsTab({ flows }) {
  if (!flows || flows.length === 0) return <Empty text="No streams to report." />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-on-surface-variant text-left border-b border-outline-variant/20">
          <th className="py-2 font-semibold">From → To</th>
          <th className="py-2 font-semibold">Carrier</th>
          <th className="py-2 font-semibold text-right">Energy</th>
          <th className="py-2 font-semibold text-right">Quantity</th>
        </tr>
      </thead>
      <tbody>
        {flows.map((f) => (
          <tr key={f.stream_id} className="border-b border-outline-variant/10">
            <td className="py-2 text-on-surface">{f.from_label} <span className="text-on-surface-variant">→</span> {f.to_label}</td>
            <td className="py-2">
              <span className="inline-flex items-center gap-1.5 text-on-surface-variant">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: carrierColor(f.carrier) }} />
                {f.carrier}
              </span>
            </td>
            <td className="py-2 text-right font-medium text-on-surface tabular-nums">{f.energy_kw ? fmtPower(f.energy_kw) : '—'}</td>
            <td className="py-2 text-right text-on-surface-variant tabular-nums">{fmtQuantity(f.quantity)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Units ────────────────────────────────────────────────────────────────────
function UnitsTab({ result, graphById, onAnalyse }) {
  const units = Object.entries(result.units ?? {});
  if (units.length === 0) return <Empty text="No unit results." />;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {units.map(([uid, r]) => {
        const gu = graphById[uid];
        const def = equipmentDef(gu?.equipment_type);
        const Icon = def.icon;
        const bal = r.balance ?? {};
        const metrics = Object.entries(r).filter(([k]) => k !== 'balance');
        const canAnalyse = gu && hasAnalysis(gu.equipment_type);
        return (
          <div key={uid} className="rounded-xl border border-outline-variant/30 bg-surface-container px-3.5 py-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Icon size={14} className="text-primary shrink-0" />
              <span className="text-sm font-bold text-on-surface truncate">{gu?.name ?? uid}</span>
              <span className="ml-auto text-[10px] text-on-surface-variant">{def.label}</span>
            </div>
            {(bal.in_kw > 0 || bal.out_kw > 0) && <BalanceBar bal={bal} />}
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
              {metrics.map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-on-surface-variant truncate">{k.replace(/_/g, ' ')}</span>
                  <span className="text-on-surface font-medium tabular-nums">{typeof v === 'number' ? v : String(v)}</span>
                </div>
              ))}
            </div>
            {canAnalyse && (
              <button onClick={() => onAnalyse(gu)}
                className="mt-2.5 w-full text-xs font-semibold text-primary hover:bg-primary/5 rounded-md py-1.5 border border-primary/25 transition-colors">
                View analysis charts
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BalanceBar({ bal }) {
  const inKw = bal.in_kw || 0;
  const out = bal.out_kw || 0;
  const loss = bal.loss_kw || 0;
  const base = Math.max(inKw, out + loss, 1);
  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-container-high">
        <div className="bg-primary" style={{ width: `${(out / base) * 100}%` }} title={`out ${fmtPower(out)}`} />
        <div className="bg-tertiary/70" style={{ width: `${(loss / base) * 100}%` }} title={`loss ${fmtPower(loss)}`} />
      </div>
      <div className="flex justify-between text-[10px] text-on-surface-variant mt-1">
        <span>in {fmtPower(inKw)}</span>
        <span>out {fmtPower(out)}{loss > 0 ? ` · loss ${fmtPower(loss)}` : ''}</span>
      </div>
    </div>
  );
}

// ── Economics ────────────────────────────────────────────────────────────────
function EconomicsTab({ econ }) {
  if (!econ) return <Empty text="No economics available." />;
  const a = econ.assumptions ?? {};
  const t = econ.total;
  const priced = (econ.per_unit ?? []).filter((p) => p.resolved);
  const maxUnit = Math.max(1, ...priced.map((p) => p.annualized_eur || 0));
  return (
    <div className="space-y-4">
      <p className="text-xs text-on-surface-variant">
        Assumptions: discount {Math.round((a.discount_rate ?? 0.07) * 100)}% · {a.hours ?? 8760} full-load h/yr
        <span className="opacity-70"> (per-instance discount rate overrides where present)</span>
      </p>
      {!t ? (
        <Empty text="No priced units — compose catalogue technologies that carry CAPEX/OPEX to see costs." />
      ) : (
        <>
          <div className="rounded-xl border border-outline-variant/30 bg-surface-container px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] uppercase tracking-wide text-on-surface-variant">Annualized system cost</span>
              <span className="font-headline text-2xl font-bold text-on-surface">{fmtEur(t.annualized_eur)}/yr</span>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden bg-surface-container-high mt-2.5">
              <div className="bg-primary" style={{ width: `${(t.capex_eur / t.annualized_eur) * 100}%` }} title="annualized capex" />
              <div className="bg-electric-400" style={{ width: `${(t.fixed_om_eur / t.annualized_eur) * 100}%` }} title="fixed O&M" />
              <div className="bg-tertiary/70" style={{ width: `${(t.var_om_eur / t.annualized_eur) * 100}%` }} title="variable O&M" />
            </div>
            <div className="flex gap-4 text-[11px] text-on-surface-variant mt-1.5">
              <span><b className="text-on-surface">{fmtEur(t.capex_eur)}</b> capex (CRF)</span>
              <span><b className="text-on-surface">{fmtEur(t.fixed_om_eur)}</b> fixed O&M</span>
              <span><b className="text-on-surface">{fmtEur(t.var_om_eur)}</b> variable O&M</span>
            </div>
          </div>
          <div>
            <SectionLabel icon={FiTrendingDown} text="Per-unit annualized cost" />
            <div className="space-y-1.5">
              {(econ.per_unit ?? []).map((p) => (
                <div key={p.unit_id} className="flex items-center gap-3 text-sm">
                  <span className="w-40 truncate text-on-surface-variant">{p.label}</span>
                  {p.resolved ? (
                    <>
                      <div className="flex-1 h-2.5 rounded-full bg-surface-container-high overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${(p.annualized_eur / maxUnit) * 100}%` }} />
                      </div>
                      <span className="w-24 text-right font-medium text-on-surface tabular-nums">{fmtEur(p.annualized_eur)}</span>
                    </>
                  ) : (
                    <span className="flex-1 text-on-surface-variant/60 italic">n/a — no catalogue cost data</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Dynamics ─────────────────────────────────────────────────────────────────
function DynamicsTab({ result, chartRef }) {
  const ts = result.time_series;
  if (ts && Array.isArray(ts.series) && ts.series.length > 0) {
    return <ReactECharts ref={chartRef} option={buildTraceOption(ts)} style={{ height: '52vh', minHeight: 340 }} notMerge lazyUpdate />;
  }
  return (
    <Empty text="The steady-state engine reports a single operating point — no time-series traces. Switch the service to the OpenModelica engine (PROCESS_ENGINE=openmodelica) for dynamic traces." />
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────
function SectionLabel({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <Icon size={13} className="text-primary" />
      <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">{text}</span>
    </div>
  );
}
function Empty({ text }) {
  return <p className="text-sm text-on-surface-variant py-8 text-center max-w-lg mx-auto">{text}</p>;
}

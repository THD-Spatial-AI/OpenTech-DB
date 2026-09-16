/**
 * ProcessStudio.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * The Process Studio (ADR-0004, Phase 2 — Builder MVP).
 *
 *   Browse  — the Process catalogue (from /api/v1/processes) + your local drafts
 *   Build   — an editable flowsheet canvas: add equipment from the palette,
 *             wire carrier-typed Streams, compose Catalogue Technologies per Unit,
 *             and save the result as a local draft.
 *
 * Draft persistence is localStorage for now; server-side drafts and the
 * publish→Submission→PR flow arrive in Phase 4.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import {
  FiEdit3, FiPlus, FiSave, FiArrowLeft, FiCheckCircle, FiBox, FiLayers,
  FiPlay, FiLoader, FiX, FiAlertCircle, FiUploadCloud, FiGitBranch, FiCheck,
  FiActivity,
} from 'react-icons/fi';
import {
  listProcesses, getProcess, submitProcess, listSubmissions, reviewSubmission,
  validateProcess,
} from './services/processApi';
import { runProcessSimulation } from './services/processSimApi';
import { PALETTE_GROUPS } from './equipmentLibrary';
import ProcessCanvas from './ProcessCanvas';

const DRAFTS_KEY = 'otdb_process_drafts';
const slugify = (s) => (s || 'untitled').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'untitled';

function loadDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY)) ?? []; } catch { return []; }
}
function saveDrafts(list) {
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

const EMPTY_META = { slug: '', name: 'Untitled Process', description: '', domain: '', status: 'draft' };

export default function ProcessStudio() {
  const [mode, setMode] = useState('browse');        // 'browse' | 'build'
  const [meta, setMeta] = useState(EMPTY_META);
  const [initialProcess, setInitialProcess] = useState({ units: [], streams: [] });
  const [canvasKey, setCanvasKey] = useState(0);     // bump to reseed the canvas
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState(null);
  const [sim, setSim] = useState({ status: 'idle', result: null, error: null }); // idle|running|done|error
  const canvasRef = useRef(null);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const runSim = useCallback(async () => {
    const graph = canvasRef.current?.getProcess();
    if (!graph || graph.units.length === 0) { flash('Add at least one unit first'); return; }
    setSim({ status: 'running', result: null, error: null, phase: 'queued', position: null });
    try {
      const result = await runProcessSimulation(graph, {
        onStatus: (job) => setSim((s) => (s.status === 'running'
          ? { ...s, phase: job.status, position: job.position } : s)),
      });
      setSim({ status: 'done', result, error: null });
    } catch (e) {
      setSim({ status: 'error', result: null, error: e.message });
    }
  }, []);

  const openProcess = useCallback((proc) => {
    setMeta({
      slug: proc.slug ?? '', name: proc.name ?? 'Untitled Process',
      description: proc.description ?? '', domain: proc.domain ?? '',
      status: proc.status ?? 'draft',
    });
    setInitialProcess({ units: proc.units ?? [], streams: proc.streams ?? [] });
    setCanvasKey((k) => k + 1);
    setDirty(false);
    setSim({ status: 'idle', result: null, error: null });
    setMode('build');
  }, []);

  const newProcess = useCallback(() => {
    openProcess({ ...EMPTY_META, units: [], streams: [] });
  }, [openProcess]);

  const saveDraft = useCallback(() => {
    const graph = canvasRef.current?.getProcess() ?? { units: [], streams: [] };
    const slug = meta.slug || slugify(meta.name);
    const draft = { ...meta, slug, status: 'draft', ...graph, savedAt: new Date().toISOString() };
    const drafts = loadDrafts().filter((d) => d.slug !== slug);
    saveDrafts([draft, ...drafts]);
    setMeta((m) => ({ ...m, slug }));
    setDirty(false);
    flash('Draft saved');
  }, [meta]);

  const [publishing, setPublishing] = useState(false);
  const publish = useCallback(async () => {
    const graph = canvasRef.current?.getProcess();
    if (!graph || graph.units.length === 0) { flash('Add at least one unit first'); return; }
    const slug = meta.slug || slugify(meta.name);
    setPublishing(true);
    try {
      await submitProcess({
        name: meta.name, slug, description: meta.description,
        domain: meta.domain || null, units: graph.units, streams: graph.streams,
      });
      flash('Submitted for review');
    } catch (e) {
      flash('Submit failed: ' + e.message);
    } finally {
      setPublishing(false);
    }
  }, [meta]);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden bg-surface">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-outline-variant/20 bg-surface-container-lowest shrink-0">
        <span className="p-1.5 rounded-lg bg-primary/10 text-primary"><FiLayers size={16} /></span>
        <h1 className="font-headline text-lg font-bold text-on-surface">Process Studio</h1>

        {mode === 'browse' ? (
          <div className="ml-auto flex items-center gap-2">
            <button onClick={newProcess}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold technical-gradient text-on-primary shadow-sm hover:shadow-md transition-all">
              <FiPlus size={14} /> New Process
            </button>
          </div>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            {dirty && <span className="text-[11px] text-tertiary font-medium">● unsaved</span>}
            <button onClick={() => setMode('browse')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-on-surface-variant hover:bg-surface-container transition-colors">
              <FiArrowLeft size={14} /> Browse
            </button>
            <button onClick={saveDraft}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-on-surface border border-outline-variant/40 hover:bg-surface-container transition-colors">
              <FiSave size={14} /> Save Draft
            </button>
            <button onClick={publish} disabled={publishing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-on-surface border border-outline-variant/40 hover:bg-surface-container transition-colors disabled:opacity-60">
              {publishing ? <FiLoader size={14} className="animate-spin" /> : <FiUploadCloud size={14} />} Publish
            </button>
            <button onClick={runSim} disabled={sim.status === 'running'}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold technical-gradient text-on-primary shadow-sm hover:shadow-md transition-all disabled:opacity-60">
              {sim.status === 'running' ? <FiLoader size={14} className="animate-spin" /> : <FiPlay size={14} />}
              {sim.status === 'running'
                ? (sim.phase === 'queued'
                    ? (sim.position ? `Queued #${sim.position}…` : 'Queued…')
                    : 'Running…')
                : 'Run Simulation'}
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className="absolute top-16 right-6 z-30 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-on-primary text-xs font-medium shadow-lg">
          <FiCheckCircle size={14} /> {toast}
        </div>
      )}

      {mode === 'browse'
        ? <BrowseView onOpen={openProcess} />
        : <BuildView meta={meta} setMeta={setMeta} initialProcess={initialProcess}
                     canvasKey={canvasKey} canvasRef={canvasRef} onDirty={() => setDirty(true)}
                     sim={sim} onCloseResults={() => setSim({ status: 'idle', result: null, error: null })} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Browse
// ─────────────────────────────────────────────────────────────────────────────
function BrowseView({ onOpen }) {
  const [catalogue, setCatalogue] = useState(null);
  const [subs, setSubs] = useState([]);
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState(loadDrafts());

  const refresh = useCallback(() => {
    listProcesses().then((d) => setCatalogue(d.processes ?? [])).catch((e) => setError(e.message));
    listSubmissions('pending_review').then(setSubs).catch(() => setSubs([]));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const openCatalogue = async (slug) => {
    try { onOpen(await getProcess(slug)); } catch (e) { setError(e.message); }
  };
  const forkCatalogue = async (slug) => {
    try {
      const full = await getProcess(slug);
      onOpen({ ...full, name: `${full.name} (fork)`, slug: '', status: 'draft' });
    } catch (e) { setError(e.message); }
  };
  const deleteDraft = (slug) => {
    const next = loadDrafts().filter((d) => d.slug !== slug);
    saveDrafts(next); setDrafts(next);
  };
  const review = async (id, action) => {
    try { await reviewSubmission(id, action); refresh(); }
    catch (e) { setError(e.message); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8">
      {/* Review queue */}
      {subs.length > 0 && (
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Review Queue</h2>
          <p className="text-[11px] text-on-surface-variant/70 mb-3">Contributed Processes awaiting approval (admin action).</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {subs.map((s) => (
              <SubmissionCard key={s.id} s={s}
                onApprove={() => review(s.id, 'approve')} onReject={() => review(s.id, 'reject')} />
            ))}
          </div>
        </section>
      )}

      {/* Drafts */}
      {drafts.length > 0 && (
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">My Drafts</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {drafts.map((d) => (
              <ProcessCard key={d.slug} p={d} isDraft onOpen={() => onOpen(d)} onDelete={() => deleteDraft(d.slug)} />
            ))}
          </div>
        </section>
      )}

      {/* Catalogue */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">Process Catalogue</h2>
        {error && <p className="text-sm text-tertiary mb-3">Could not load processes: {error}</p>}
        {catalogue === null && !error && <p className="text-sm text-on-surface-variant">Loading…</p>}
        {catalogue && catalogue.length === 0 && <p className="text-sm text-on-surface-variant">No processes yet.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(catalogue ?? []).map((p) => (
            <ProcessCard key={p.slug} p={p}
              onOpen={() => openCatalogue(p.slug)} onFork={() => forkCatalogue(p.slug)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function SubmissionCard({ s, onApprove, onReject }) {
  return (
    <article className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-5 flex flex-col">
      <div className="flex items-start justify-between mb-2">
        <span className="p-2 rounded-lg bg-tertiary/10 text-tertiary"><FiUploadCloud size={16} /></span>
        <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">
          pending
        </span>
      </div>
      <h3 className="font-headline text-base font-bold text-on-surface leading-tight mb-1">{s.name}</h3>
      {s.domain && <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant mb-2">{s.domain}</p>}
      <div className="mt-auto flex items-center gap-3 text-[11px] text-on-surface-variant mb-3">
        <span className="font-headline font-bold text-on-surface">{s.n_units}</span> units
        <span className="font-headline font-bold text-on-surface">{s.n_streams}</span> streams
      </div>
      <div className="flex gap-2">
        <button onClick={onApprove}
          className="flex-1 py-2 rounded-lg text-xs font-bold technical-gradient text-on-primary flex items-center justify-center gap-1.5 transition-all">
          <FiCheck size={13} /> Approve
        </button>
        <button onClick={onReject}
          className="px-3 rounded-lg text-xs font-medium text-on-surface-variant border border-outline-variant/40 hover:text-tertiary hover:bg-surface-container transition-colors">
          Reject
        </button>
      </div>
    </article>
  );
}

function ProcessCard({ p, isDraft, onOpen, onDelete, onFork }) {
  const nUnits = p.n_units ?? p.units?.length ?? 0;
  const nStreams = p.n_streams ?? p.streams?.length ?? 0;
  const carriers = p.carriers ?? [];
  return (
    <article className="group bg-surface-container-lowest rounded-xl border border-outline-variant/20 p-5 flex flex-col
                        transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5">
      <div className="flex items-start justify-between mb-2">
        <span className="p-2 rounded-lg bg-primary/10 text-primary"><FiBox size={16} /></span>
        <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">
          {isDraft ? 'draft' : p.status}
        </span>
      </div>
      <h3 className="font-headline text-base font-bold text-on-surface leading-tight mb-1">{p.name}</h3>
      {p.domain && <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant mb-2">{p.domain}</p>}
      {p.description && <p className="text-xs text-on-surface-variant line-clamp-2 mb-3">{p.description}</p>}

      <div className="mt-auto flex items-center gap-3 text-[11px] text-on-surface-variant mb-3">
        <span className="font-headline font-bold text-on-surface">{nUnits}</span> units
        <span className="font-headline font-bold text-on-surface">{nStreams}</span> streams
      </div>
      {carriers.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {carriers.map((c) => (
            <span key={c} className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant">{c}</span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={onOpen}
          className="flex-1 py-2 rounded-lg text-xs font-bold technical-gradient text-on-primary flex items-center justify-center gap-1.5 group-hover:shadow transition-all">
          <FiEdit3 size={13} /> {isDraft ? 'Edit' : 'Open'}
        </button>
        {onFork && !isDraft && (
          <button onClick={onFork} title="Fork as a new draft"
            className="px-2.5 rounded-lg text-xs font-medium text-on-surface-variant border border-outline-variant/40 hover:text-primary hover:bg-surface-container transition-colors flex items-center gap-1">
            <FiGitBranch size={12} /> Fork
          </button>
        )}
        {isDraft && (
          <button onClick={onDelete} className="px-2.5 rounded-lg text-xs text-on-surface-variant hover:text-tertiary hover:bg-surface-container transition-colors">✕</button>
        )}
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────
function BuildView({ meta, setMeta, initialProcess, canvasKey, canvasRef, onDirty, sim, onCloseResults }) {
  const addUnit = (type) => canvasRef.current?.addUnit(type);
  return (
    <div className="flex-1 flex flex-col min-h-0">
    <div className="flex-1 flex min-h-0">
      {/* Palette */}
      <aside className="w-52 shrink-0 border-r border-outline-variant/20 bg-surface-container-lowest overflow-y-auto p-3">
        <div className="mb-4">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Process name</label>
          <input
            value={meta.name}
            onChange={(e) => { setMeta((m) => ({ ...m, name: e.target.value })); onDirty(); }}
            className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-2.5 py-1.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
          />
          <input
            placeholder="domain (e.g. hydrogen)" value={meta.domain}
            onChange={(e) => { setMeta((m) => ({ ...m, domain: e.target.value })); onDirty(); }}
            className="w-full mt-2 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-2.5 py-1.5 text-[11px] text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">Add Equipment</p>
        <div className="space-y-3">
          {PALETTE_GROUPS.map(({ group, items }) => (
            <div key={group}>
              <p className="text-[9px] font-semibold uppercase tracking-wide text-on-surface-variant/60 mb-1">{group}</p>
              <div className="space-y-1">
                {items.map(({ type, label, icon: Icon }) => (
                  <button key={type} onClick={() => addUnit(type)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-on-surface
                               border border-outline-variant/30 bg-surface-container-lowest
                               hover:border-primary/40 hover:bg-primary/5 transition-all text-left">
                    <span className="text-primary"><Icon size={13} /></span>
                    <span className="truncate">{label}</span>
                    <FiPlus size={11} className="ml-auto text-on-surface-variant/50" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Canvas (+ inspector) — keyed so a fresh Process reseeds the graph */}
      <ProcessCanvas key={canvasKey} ref={canvasRef} initialProcess={initialProcess} onDirty={onDirty} />
    </div>

    {(sim.status === 'done' || sim.status === 'error') && (
      <ResultsBar sim={sim} onClose={onCloseResults} />
    )}
    </div>
  );
}

// KPI-friendly labels/units for the steady-state engine output.
const KPI_META = {
  source_power_kw:          { label: 'Source Power', fmt: (v) => fmtPower(v) },
  output_power_kw:          { label: 'Output Power', fmt: (v) => fmtPower(v) },
  round_trip_efficiency_pct:{ label: 'Round-trip η', fmt: (v) => `${v} %` },
  h2_production_kg_h:       { label: 'H₂ Production', fmt: (v) => `${v} kg/h` },
  co2_captured_kg_h:        { label: 'CO₂ Captured', fmt: (v) => `${v} kg/h` },
  co2_captured_mtco2_yr:    { label: 'CO₂ Captured', fmt: (v) => `${v} Mt/yr` },
  parasitic_load_kw:        { label: 'Parasitic Load', fmt: (v) => fmtPower(v) },
};
function fmtPower(v) { return v >= 1000 ? `${(v / 1000).toFixed(2)} MW` : `${v} kW`; }

function ResultsBar({ sim, onClose }) {
  if (sim.status === 'error') {
    return (
      <div className="shrink-0 border-t border-outline-variant/20 bg-surface-container-lowest px-6 py-3 flex items-center gap-2">
        <FiAlertCircle className="text-tertiary shrink-0" size={16} />
        <span className="text-sm text-on-surface">Simulation failed: {sim.error}</span>
        <button onClick={onClose} className="ml-auto text-on-surface-variant hover:text-on-surface"><FiX size={15} /></button>
      </div>
    );
  }
  const kpi = sim.result?.kpi ?? {};
  const entries = Object.entries(kpi).filter(([k]) => KPI_META[k]);
  const ts = sim.result?.time_series;
  const hasTraces = ts && Array.isArray(ts.series) && ts.series.length > 0;
  return (
    <div className="shrink-0 border-t border-outline-variant/20 bg-surface-container-lowest px-6 py-3 max-h-[42%] overflow-y-auto">
      <div className="flex items-center gap-2 mb-2">
        <FiCheckCircle className="text-primary" size={15} />
        <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Simulation Results</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant">
          engine: {sim.result?.engine ?? '—'}
        </span>
        <button onClick={onClose} className="ml-auto text-on-surface-variant hover:text-on-surface"><FiX size={15} /></button>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-on-surface-variant">No KPIs — add sources and connect the chain, then run again.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {entries.map(([k, v]) => {
            const meta = KPI_META[k];
            return (
              <div key={k} className="rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2 min-w-[110px]">
                <p className="text-[9px] uppercase tracking-wide text-on-surface-variant">{meta.label}</p>
                <p className="font-headline text-base font-bold text-on-surface">{meta.fmt(v)}</p>
              </div>
            );
          })}
        </div>
      )}

      {hasTraces && (
        <div className="mt-3">
          <div className="flex items-center gap-1.5 mb-1">
            <FiActivity size={12} className="text-primary" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Dynamic Traces</span>
          </div>
          <ReactECharts option={buildTraceOption(ts)} style={{ height: 170 }} notMerge lazyUpdate />
        </div>
      )}
    </div>
  );
}

function ValidationBadge({ validation, open, onToggle }) {
  if (!validation) return null;
  const nErr = validation.errors?.length ?? 0;
  const nWarn = validation.warnings?.length ?? 0;
  const state = nErr > 0 ? 'error' : nWarn > 0 ? 'warn' : 'ok';
  const cfg = {
    error: { cls: 'bg-red-50 text-red-700 border-red-200', Icon: FiAlertCircle, label: `${nErr} error${nErr > 1 ? 's' : ''}` },
    warn:  { cls: 'bg-amber-50 text-amber-700 border-amber-200', Icon: FiAlertTriangle, label: `${nWarn} warning${nWarn > 1 ? 's' : ''}` },
    ok:    { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: FiCheckCircle, label: 'Valid' },
  }[state];
  const { Icon } = cfg;
  return (
    <div className="relative">
      <button onClick={onToggle}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${cfg.cls}`}>
        <Icon size={13} /> {cfg.label}
      </button>
      {open && (nErr > 0 || nWarn > 0) && (
        <div className="absolute right-0 top-full mt-1 w-80 max-h-72 overflow-y-auto rounded-xl bg-surface-container-lowest border border-outline-variant/30 shadow-2xl z-[60] p-3 space-y-1.5">
          {validation.errors.map((e, i) => <IssueRow key={`e${i}`} err issue={e} />)}
          {validation.warnings.map((w, i) => <IssueRow key={`w${i}`} issue={w} />)}
        </div>
      )}
    </div>
  );
}

function IssueRow({ err, issue }) {
  return (
    <div className={`flex gap-2 rounded-lg px-2.5 py-1.5 ${err ? 'bg-red-50' : 'bg-amber-50'}`}>
      {err ? <FiAlertCircle className="text-red-500 shrink-0 mt-0.5" size={13} />
           : <FiAlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={13} />}
      <p className={`text-[11px] leading-relaxed ${err ? 'text-red-700' : 'text-amber-700'}`}>{issue.message}</p>
    </div>
  );
}

function buildTraceOption(ts) {
  const fmtT = (t) => (t >= 3600 ? `${(t / 3600).toFixed(1)}h` : `${Math.round(t / 60)}m`);
  return {
    animation: false,
    color: ['#4d4b9e', '#943700', '#5b5d72', '#6f7dd6'],
    grid: { top: 22, bottom: 34, left: 52, right: 16 },
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

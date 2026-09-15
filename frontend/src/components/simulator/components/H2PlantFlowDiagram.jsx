/**
 * H2PlantFlowDiagram.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Simulink-style interactive PFD for the Hydrogen Power Plant Digital Twin.
 * Built with @xyflow/react (React Flow v12).
 *
 * Props:
 *   elz, setElz, sto, setSto, fc, setFc   – parameter state + setters
 *   simState                               – 'idle'|'queued'|'running'|'done'|'error'
 *   kpi                                    – result KPIs (shown on nodes after done)
 *   models          {Object}               – { source, electrolyzer, compressor, storage, fuel_cell }
 *   selectedModels  {Object}               – currently active model per slot
 *   onSelectModel   {Function}             – (slotKey, model) callback
 *
 * nodeTypes MUST be defined at module scope to avoid infinite re-renders.
 */

import React, { createContext, memo, useContext, useMemo, useState, useRef, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useEdgesState,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FiZap, FiCpu } from "react-icons/fi";

// ─────────────────────────────────────────────────────────────────────────────
// Shared diagram context — nodes read state here instead of via `data` prop.
// This prevents liveNodes from being rebuilt on every state change, so
// React Flow never re-layouts the canvas unless nodes are physically dragged.
// ─────────────────────────────────────────────────────────────────────────────
const DiagramCtx = createContext(null);

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle badge colour helper
// ─────────────────────────────────────────────────────────────────────────────
function lifecycleDot(lifecycle) {
  return "bg-gray-400";
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
    const mult = toMultiplier(unitHint) ?? 1;
    return value * mult;
  }

  if (typeof value === "string") {
    const s = value.trim();
    const m = s.match(/^([+-]?\d+(?:\.\d+)?)\s*([kmg]w)?$/i);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    const mult = toMultiplier(m[2] ?? unitHint) ?? 1;
    return n * mult;
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

function formatCapacityKw(capKw) {
  if (capKw == null || !Number.isFinite(capKw) || capKw <= 0) return "— select model";
  if (capKw >= 1000000) return `${(capKw / 1000000).toFixed(2)} GW`;
  if (capKw >= 1000) return `${(capKw / 1000).toFixed(1)} MW`;
  return `${Math.round(capKw)} kW`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rich model picker — two-phase: choose → stage → Apply.
// The "Apply" button is the explicit commit — only then does onSelect fire.
// A green lock badge on the trigger shows what is currently active for sim.
// ─────────────────────────────────────────────────────────────────────────────
const ModelPicker = memo(function ModelPicker({ slotKey, models, selected, onSelect, disabled }) {
  const [open,    setOpen]    = useState(false);
  // `staged` = model the user has highlighted in the list but not yet applied
  const [staged,  setStaged]  = useState(null);

  if (!models?.length) return null;

  const stop   = (e) => e.stopPropagation();
  const toggle = (e) => { stop(e); if (!disabled) setOpen((o) => !o); };

  // Stage a model (highlight in list) without committing yet
  const stage = (e, m) => { stop(e); setStaged(m); };

  // Commit the staged (or directly-clicked) model
  const apply = (e, m) => {
    stop(e);
    const toApply = m ?? staged;
    if (!toApply) return;
    onSelect(slotKey, toApply);
    setStaged(null);
    setOpen(false);
  };

  const hasPending  = staged && staged.id !== selected?.id;
  const displayModel = hasPending ? staged : selected;   // show staged in trigger while pending

  return (
    <div className="mt-2 pt-2 border-t border-outline-variant/20 relative" onClick={stop}>
      {/* ── Trigger row: dropdown button + Apply button ─────────────────── */}
      <div className="flex items-center gap-1">
        <button
          disabled={disabled}
          onClick={toggle}
          className={`nodrag flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left
            border transition-all text-[11px]
            ${ hasPending
                ? "border-gray-400 bg-surface-container text-on-surface"
                : open
                  ? "border-gray-400 bg-surface-container text-on-surface"
                  : selected
                    ? "border-outline-variant/40 bg-surface-container text-on-surface"
                    : "border-outline-variant/30 bg-surface-container text-on-surface hover:bg-surface-container-lowest hover:border-outline-variant/40"
              }
            disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {displayModel ? (
            <>
              <span className={`shrink-0 w-2 h-2 rounded-full ${lifecycleDot(displayModel.lifecycle)}`} />
              <span className="flex-1 font-semibold truncate">{displayModel.name}</span>
              {displayModel.efficiency_pct != null && (
                <span className="shrink-0 text-[10px] opacity-70">η {Number(displayModel.efficiency_pct).toFixed(0)}%</span>
              )}
              {/* Lock badge — green = applied, amber = pending */}
              <span className={`shrink-0 text-[9px] font-bold ${hasPending ? "text-on-surface-variant" : "text-on-surface-variant"}`}>
                {hasPending ? "●" : "✓"}
              </span>
            </>
          ) : (
            <span className="text-on-surface-variant/70">— choose model —</span>
          )}
          <svg className={`shrink-0 w-3 h-3 text-on-surface-variant/70 transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </button>

        {/* Apply button — always visible; disabled when nothing pending */}
        <button
          disabled={disabled || !hasPending}
          onClick={(e) => apply(e)}
          title={hasPending ? `Apply "${staged.name}"` : "No pending change"}
          className={`nodrag shrink-0 flex items-center justify-center w-7 h-7 rounded-lg border text-[11px] font-bold
            transition-all
            ${ hasPending
                ? "border-gray-600 bg-primary text-white hover:bg-primary-container shadow-sm"
                : "border-outline-variant/30 bg-surface-container-high text-on-surface-variant/50 cursor-not-allowed"
              }`}
        >
          ✓
        </button>
      </div>

      {/* Pending label */}
      {hasPending && (
        <p className="text-[9px] text-on-surface-variant font-medium mt-0.5 ml-0.5">
          Staged — click ✓ to apply
        </p>
      )}

      {/* ── Dropdown panel ───────────────────────────────────────────────── */}
      {open && (
        <div
          className="absolute z-[9999] left-0 top-full mt-1 w-64 bg-surface-container-lowest border border-outline-variant/30
            rounded-xl shadow-xl overflow-hidden"
          onClick={stop}
        >
          <div className="px-3 py-2 border-b border-outline-variant/20 bg-surface-container flex items-center justify-between">
            <span className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wide">
              {models.length} variant{models.length !== 1 ? "s" : ""}
            </span>
            <button onClick={toggle} className="text-on-surface-variant/70 hover:text-on-surface-variant text-xs leading-none">✕</button>
          </div>
          <div className="max-h-52 overflow-y-auto divide-y divide-outline-variant/15">
            {models.map((m) => {
              const isApplied = selected?.id === m.id;
              const isStaged  = staged?.id === m.id;
              return (
                <div
                  key={m.id}
                  onClick={(e) => { stage(e, m); }}
                  className={`px-3 py-2 cursor-pointer transition-colors
                    ${ isStaged
                        ? "bg-surface-container border-l-2 border-gray-400"
                        : isApplied
                          ? "bg-surface-container border-l-2 border-outline-variant/40"
                          : "hover:bg-surface-container border-l-2 border-transparent"
                      }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${lifecycleDot(m.lifecycle)}`} />
                    <span className="text-[11px] font-semibold text-on-surface flex-1 truncate">{m.name}</span>
                    {m.efficiency_pct != null && (
                      <span className={`text-[10px] font-medium ${isStaged ? "text-on-surface-variant" : isApplied ? "text-on-surface-variant" : "text-on-surface-variant/70"}`}>
                        η {Number(m.efficiency_pct).toFixed(0)}%
                      </span>
                    )}
                    {isApplied && !isStaged && <span className="text-[9px] text-on-surface-variant font-bold">✓ active</span>}
                    {isStaged  && <span className="text-[9px] text-on-surface-variant font-bold">● staged</span>}
                  </div>
                  {m.capacity_kw != null && (
                    <p className="text-[10px] text-on-surface-variant/70 mt-0.5 ml-3.5">
                      {m.capacity_kw >= 1000
                        ? `${(m.capacity_kw / 1000).toFixed(1)} MW`
                        : `${m.capacity_kw} kW`}
                      {m.lifecycle ? ` · ${m.lifecycle}` : ""}
                    </p>
                  )}
                  {m.description && (
                    <p className="text-[10px] text-on-surface-variant/70 mt-0.5 ml-3.5 line-clamp-2">{m.description}</p>
                  )}
                  {/* Per-row apply button */}
                  {isStaged && (
                    <button
                      onClick={(e) => apply(e, m)}
                      className="nodrag mt-1.5 ml-3.5 px-2 py-0.5 rounded-md bg-primary text-white text-[10px] font-bold hover:bg-primary-container transition-colors"
                    >
                      Apply this model
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CSV profile uploader — attach a custom hourly production curve
// Expected format:  time_h,value_kw   (header required)
// ─────────────────────────────────────────────────────────────────────────────
const CsvUploader = memo(function CsvUploader({ customProfile, onSetCustomProfile, disabled }) {
  const fileRef = useRef(null);
  const stop    = (e) => e.stopPropagation();

  const handleChange = useCallback((e) => {
    stop(e);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const lines = text.trim().split(/\r?\n/);
      // Detect separator
      const sep = lines[0].includes(";") ? ";" : ",";
      const header = lines[0].toLowerCase().split(sep).map((h) => h.trim());
      const tIdx = header.findIndex((h) => h.includes("time") || h === "t" || h.includes("date") || h.includes("timestamp"));
      const vIdx = header.findIndex((h) => h.includes("value") || h.includes("kw") || h.includes("power") || h.includes("prod") || h.includes("mw"));
      if (tIdx === -1 || vIdx === -1) {
        alert(`CSV must have a time/date column and a value/kw/power column.\nDetected headers: ${header.join(", ")}`);
        return;
      }

      // ── Parse all rows ───────────────────────────────────────────────────
      const rawRows = lines.slice(1).map((row) => {
        const cols = row.split(sep);
        const rawTime  = cols[tIdx]?.trim() ?? "";
        const rawValue = parseFloat(cols[vIdx]);
        return { rawTime, rawValue };
      }).filter((r) => r.rawTime && !isNaN(r.rawValue));

      if (!rawRows.length) {
        alert("No valid data rows found.");
        return;
      }

      // ── Detect and convert timestamp format ──────────────────────────────
      // Supports:  YYYY-MM-DD HH:mm:ss  or  YYYY-MM-DD  or  numeric (hours)
      const firstRaw = rawRows[0].rawTime;
      const isDatetime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(firstRaw);
      const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(firstRaw);

      let data;
      if (isDatetime || isDateOnly) {
        const t0 = new Date(rawRows[0].rawTime.replace(" ", "T")).getTime();
        data = rawRows.map((r) => {
          const ms   = new Date(r.rawTime.replace(" ", "T")).getTime();
          const t_h  = (ms - t0) / (1000 * 3600);
          // Scale MW → kW automatically
          const vKw  = header[vIdx].includes("mw") ? r.rawValue * 1000 : r.rawValue;
          return { time_h: +t_h.toFixed(4), value_kw: vKw, timestamp: r.rawTime };
        });
      } else {
        // Assume numeric hours
        data = rawRows.map((r) => ({
          time_h:    parseFloat(r.rawTime),
          value_kw:  header[vIdx].includes("mw") ? r.rawValue * 1000 : r.rawValue,
          timestamp: null,
        })).filter((r) => !isNaN(r.time_h));
      }

      onSetCustomProfile({ filename: file.name, rows: data.length, data });
    };
    reader.readAsText(file);
    // Reset so same file can be re-uploaded
    e.target.value = "";
  }, [onSetCustomProfile]);

  return (
    <div className="mt-2 pt-2 border-t border-dashed border-outline-variant/30" onClick={stop}>
      <span className="text-[10px] font-medium text-on-surface-variant/70 uppercase tracking-wide block mb-1.5">Production profile</span>
      <input
        ref={fileRef} type="file" accept=".csv,.tsv,.txt"
        className="hidden"
        onChange={handleChange}
      />
      {customProfile ? (
        <div className="flex items-center gap-1.5 bg-surface-container border border-outline-variant/30 rounded-lg px-2 py-1.5">
          <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="#6b7280" strokeWidth="2.5">
            <path d="M3 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="flex-1 text-[10px] font-semibold text-on-surface truncate">
            {customProfile.filename}
          </span>
          <span className="shrink-0 text-[9px] text-on-surface-variant">{customProfile.rows} pts</span>
          <button
            onClick={(e) => { stop(e); onSetCustomProfile(null); }}
            className="shrink-0 text-[10px] text-on-surface-variant hover:text-on-surface leading-none ml-1"
            title="Remove custom profile"
          >✕</button>
        </div>
      ) : (
        <button
          onClick={(e) => { stop(e); fileRef.current?.click(); }}
          disabled={disabled}
          className={`nodrag w-full flex items-center justify-center gap-1.5 px-2 py-1.5
            border border-dashed rounded-lg text-[10px] font-medium transition-all
            ${ disabled
                ? "border-outline-variant/20 text-on-surface-variant/50 cursor-not-allowed"
                : "border-outline-variant/40 text-on-surface-variant hover:border-gray-400 hover:text-on-surface-variant hover:bg-surface-container"
              }`}
        >
          <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M10 3v10M5 8l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 17h14" strokeLinecap="round" />
          </svg>
          Upload CSV profile
        </button>
      )}
      {!customProfile && (
        <p className="text-[9px] text-on-surface-variant/50 mt-1">YYYY-MM-DD HH:mm:ss , value_kw — overrides model defaults</p>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Reusable compact field inside a node
// ─────────────────────────────────────────────────────────────────────────────
const NodeField = memo(function NodeField({ label, unit, value, min, max, step = 1, onChange, disabled }) {
  return (
    <div
      className="flex items-center justify-between gap-1 mt-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] text-on-surface-variant/70 whitespace-nowrap leading-none">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          onClick={(e) => e.stopPropagation()}
          className="nodrag w-16 text-right text-[11px] font-semibold text-on-surface bg-surface-container
            border border-outline-variant/30 rounded-md px-1.5 py-0.5
            focus:outline-none focus:ring-1 focus:ring-gray-400
            disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontVariantNumeric: "tabular-nums" }}
        />
        <span className="text-[10px] text-on-surface-variant/70 w-8 leading-none">{unit}</span>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Animated status dot
// ─────────────────────────────────────────────────────────────────────────────
const StatusDot = memo(function StatusDot({ simState, color = "bg-slate-300" }) {
  if (simState === "running" || simState === "queued") {
    return <span className={`ml-auto w-2 h-2 rounded-full ${color} animate-pulse`} />;
  }
  if (simState === "done") {
    return <span className={`ml-auto w-2 h-2 rounded-full bg-gray-400`} />;
  }
  return <span className={`ml-auto w-2 h-2 rounded-full bg-surface-container-highest`} />;
});

// ─────────────────────────────────────────────────────────────────────────────
// NODE: Grid / Power Source
// ─────────────────────────────────────────────────────────────────────────────
const GridNode = memo(function GridNode({ selected }) {
  const { simState, elz, setElz, models, selectedModels, onSelectModel,
          activeNodeId, customProfile, onSetCustomProfile, genParamOverrides } = useContext(DiagramCtx);
  const slotKey  = "source";
  const sel      = selectedModels?.[slotKey];
  // Prefer user-edited capacity (from variant/panel) over raw model value
  const overriddenCap = (genParamOverrides?.capacity_kw != null && isFinite(Number(genParamOverrides.capacity_kw)))
    ? Number(genParamOverrides.capacity_kw)
    : null;
  const sourceCapKw = overriddenCap ?? getModelCapacityKw(sel);
  const disabled = simState === "running" || simState === "queued";
  const isActive = activeNodeId === "grid";
  return (
    <div
      className={`bg-surface-container-lowest rounded-xl border-2 shadow-md px-3 py-2.5 w-52 cursor-pointer transition-colors duration-150
        ${ isActive
            ? "border-gray-700 shadow-gray-200 shadow-lg ring-2 ring-gray-400 ring-offset-1"
            : selected
              ? "border-gray-600 shadow-gray-100 shadow-lg ring-2 ring-gray-300 ring-offset-1"
              : "border-gray-400 hover:border-gray-500 hover:shadow-gray-100 hover:shadow-xl"
          }
      `}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="p-1 rounded-lg bg-surface-container-high text-on-surface-variant"><FiZap size={12} /></span>
        <span className="text-xs font-bold text-on-surface truncate max-w-[100px]">{sel?.name ?? "Power Source"}</span>
        <StatusDot simState={simState} color="bg-gray-400" />
      </div>
      {sel && !customProfile && (
        <p className="text-[10px] text-on-surface-variant font-semibold mb-1">
          {sel.efficiency_pct != null ? `η ${Number(sel.efficiency_pct).toFixed(0)}%` : "Generator"}
          {sourceCapKw != null ? ` · ${formatCapacityKw(sourceCapKw)}` : ""}
        </p>
      )}
      {customProfile && (
        <p className="text-[10px] text-on-surface-variant font-semibold mb-1">CSV profile active</p>
      )}
      {/* Read-only plant capacity from the selected model */}
      <div className="flex items-center justify-between mt-1 mb-0.5" onClick={(e) => e.stopPropagation()}>
        <span className="text-[10px] text-on-surface-variant/70 whitespace-nowrap leading-none">Plant Capacity</span>
        <span className="text-[11px] font-semibold text-on-surface-variant">
          {formatCapacityKw(sourceCapKw)}
        </span>
      </div>
      <ModelPicker
        slotKey={slotKey}
        models={models?.[slotKey]}
        selected={sel}
        onSelect={onSelectModel}
        disabled={disabled}
      />
      <CsvUploader
        customProfile={customProfile}
        onSetCustomProfile={onSetCustomProfile}
        disabled={disabled}
      />
      {/* Click-to-analyse affordance */}
      <div className={`mt-2 pt-1.5 border-t flex items-center justify-center gap-1 text-[10px] font-medium rounded-b transition-colors
        ${ isActive
            ? "border-gray-400 text-on-surface-variant"
            : "border-outline-variant/20 text-on-surface-variant/70 hover:text-on-surface-variant"
          }
      `}>
        <span>{isActive ? "▴ Close analysis" : "▾ Analyze generator"}</span>
      </div>
      <Handle type="source" position={Position.Right} id="elec-out"
        className="!bg-gray-400 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}, (p, n) => p.selected === n.selected);

// ─────────────────────────────────────────────────────────────────────────────
// NODE: Electrolyzer
// ─────────────────────────────────────────────────────────────────────────────
const ElzNode = memo(function ElzNode({ selected }) {
  const { simState, kpi, models, selectedModels, onSelectModel } = useContext(DiagramCtx);
  const slotKey  = "electrolyzer";
  const sel      = selectedModels?.[slotKey];
  const disabled = simState === "running" || simState === "queued";
  return (
    <div className={`bg-surface-container-lowest rounded-xl border-2 shadow-md px-3 py-2.5 w-56 transition-colors duration-150
      ${selected ? "border-gray-600 shadow-gray-100 shadow-lg ring-2 ring-gray-400 ring-offset-1" : "border-gray-400 hover:border-gray-500 hover:shadow-gray-100 hover:shadow-xl"}
      ${simState === "running" && !selected ? "shadow-lg shadow-gray-100" : ""}
    `}>
      <Handle type="target" position={Position.Left}   id="elec-in"
        className="!bg-gray-400 !w-3 !h-3 !border-2 !border-white" />
      <Handle type="target" position={Position.Bottom} id="water-in"
        className="!bg-gray-300 !w-3 !h-3 !border-2 !border-white" style={{ left: "28%" }} />

      <div className="flex items-center gap-1.5 mb-1">
        <span className="p-1 rounded-lg bg-surface-container-high text-on-surface-variant"><FiZap size={12} /></span>
        <span className="text-xs font-bold text-on-surface truncate max-w-[110px]">{sel?.name ?? "Electrolyzer"}</span>
        <StatusDot simState={simState} color="bg-gray-400" />
      </div>
      {sel?.efficiency_pct != null && (
        <p className="text-[10px] text-on-surface-variant font-semibold mb-1">η {Number(sel.efficiency_pct).toFixed(0)}%</p>
      )}

      <p className="text-[10px] text-on-surface-variant/70 mb-1">Parameters edited in right sidebar</p>

      {kpi?.avg_h2_production_nm3h != null && (
        <div className="mt-2 pt-1 border-t border-outline-variant/20 animate-in fade-in duration-500">
          <p className="text-[10px] font-semibold text-on-surface-variant">
            Avg H₂: {Number(kpi.avg_h2_production_nm3h).toFixed(1)} Nm³/h
          </p>
        </div>
      )}
      <ModelPicker slotKey={slotKey} models={models?.[slotKey]} selected={sel} onSelect={onSelectModel} disabled={disabled} />
      <Handle type="source" position={Position.Right} id="h2-out"
        className="!bg-surface-container0 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}, (p, n) => p.selected === n.selected);

// ─────────────────────────────────────────────────────────────────────────────
// NODE: H₂ Compressor
// ─────────────────────────────────────────────────────────────────────────────
const CompressorNode = memo(function CompressorNode({ selected }) {
  const { simState, models, selectedModels, onSelectModel } = useContext(DiagramCtx);
  const slotKey  = "compressor";
  const sel      = selectedModels?.[slotKey];
  const disabled = simState === "running" || simState === "queued";
  return (
    <div className={`bg-surface-container-lowest rounded-xl border-2 shadow-md px-3 py-2.5 w-48 transition-colors duration-150
      ${selected ? "border-gray-600 shadow-gray-100 shadow-lg ring-2 ring-gray-400 ring-offset-1" : "border-gray-500 hover:border-gray-600 hover:shadow-gray-100 hover:shadow-xl"}
    `}>
      <Handle type="target" position={Position.Left}  id="h2-in"
        className="!bg-surface-container0 !w-3 !h-3 !border-2 !border-white" />

      <div className="flex items-center gap-1.5 mb-1">
        <span className="p-1 rounded-lg bg-surface-container-high text-on-surface-variant">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
          </svg>
        </span>
        <span className="text-xs font-bold text-on-surface truncate max-w-[90px]">{sel?.name ?? "Compressor"}</span>
        <StatusDot simState={simState} color="bg-gray-400" />
      </div>
      {sel?.efficiency_pct != null && (
        <p className="text-[10px] text-on-surface-variant font-semibold mb-1">η {Number(sel.efficiency_pct).toFixed(0)}%</p>
      )}

      <p className="text-[10px] text-on-surface-variant/70 mb-1">Parameters edited in right sidebar</p>

      <ModelPicker slotKey={slotKey} models={models?.[slotKey]} selected={sel} onSelect={onSelectModel} disabled={disabled} />

      <Handle type="source" position={Position.Right} id="h2-out"
        className="!bg-surface-container0 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}, (p, n) => p.selected === n.selected);

// ─────────────────────────────────────────────────────────────────────────────
// NODE: H₂ Storage Tank
// ─────────────────────────────────────────────────────────────────────────────
const TankNode = memo(function TankNode({ selected }) {
  const { sto, simState, kpi, models, selectedModels, onSelectModel } = useContext(DiagramCtx);
  const slotKey  = "storage";
  const sel      = selectedModels?.[slotKey];
  const disabled = simState === "running" || simState === "queued";
  const peakP    = kpi?.peak_tank_pressure_bar;
  const maxP     = sto?.max_tank_pressure_bar ?? 350;
  const fillPct  = peakP ? Math.min(100, (peakP / maxP) * 100) : 0;

  return (
    <div className={`bg-surface-container-lowest rounded-xl border-2 shadow-md px-3 py-2.5 w-52 transition-colors duration-150
      ${selected ? "border-gray-700 shadow-gray-100 shadow-lg ring-2 ring-gray-400 ring-offset-1" : "border-gray-600 hover:border-gray-700 hover:shadow-gray-100 hover:shadow-xl"}
      ${simState === "running" && !selected ? "shadow-lg shadow-gray-100" : ""}
    `}>
      <Handle type="target" position={Position.Left}  id="h2-in"
        className="!bg-surface-container0 !w-3 !h-3 !border-2 !border-white" />

      <div className="flex items-center gap-1.5 mb-1">
        <span className="p-1 rounded-lg bg-surface-container-high text-on-surface-variant">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="4" y="6" width="16" height="12" rx="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
          </svg>
        </span>
        <span className="text-xs font-bold text-on-surface truncate max-w-[100px]">{sel?.name ?? "H₂ Storage"}</span>
        <StatusDot simState={simState} color="bg-surface-container0" />
      </div>

      <p className="text-[10px] text-on-surface-variant/70 mb-1">Parameters edited in right sidebar</p>

      {peakP && (
        <div className="mt-2 pt-1 border-t border-outline-variant/20 animate-in fade-in duration-500">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-on-surface-variant/70">Peak pressure</span>
            <span className="font-semibold text-on-surface-variant">{Number(peakP).toFixed(1)} bar</span>
          </div>
          <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
            <div className="h-2 rounded-full bg-gradient-to-r from-gray-400 to-gray-600 transition-all duration-1000"
              style={{ width: `${fillPct}%` }} />
          </div>
        </div>
      )}

      <ModelPicker slotKey={slotKey} models={models?.[slotKey]} selected={sel} onSelect={onSelectModel} disabled={disabled} />
      <Handle type="source" position={Position.Right} id="h2-out"
        className="!bg-surface-container0 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}, (p, n) => p.selected === n.selected);

// ─────────────────────────────────────────────────────────────────────────────
// NODE: Fuel Cell Stack
// ─────────────────────────────────────────────────────────────────────────────
const FuelCellNode = memo(function FuelCellNode({ selected }) {
  const { simState, kpi, models, selectedModels, onSelectModel } = useContext(DiagramCtx);
  const slotKey  = "fuel_cell";
  const sel      = selectedModels?.[slotKey];
  const disabled = simState === "running" || simState === "queued";
  return (
    <div className={`bg-surface-container-lowest rounded-xl border-2 shadow-md px-3 py-2.5 w-56 transition-colors duration-150
      ${selected ? "border-gray-600 shadow-gray-100 shadow-lg ring-2 ring-gray-300 ring-offset-1" : "border-gray-500 hover:border-gray-600 hover:shadow-gray-100 hover:shadow-xl"}
      ${simState === "running" && !selected ? "shadow-lg shadow-gray-100" : ""}
    `}>
      <Handle type="target" position={Position.Left}  id="h2-in"
        className="!bg-surface-container0 !w-3 !h-3 !border-2 !border-white" />

      <div className="flex items-center gap-1.5 mb-1">
        <span className="p-1 rounded-lg bg-surface-container-high text-on-surface-variant"><FiCpu size={12} /></span>
        <span className="text-xs font-bold text-on-surface truncate max-w-[110px]">{sel?.name ?? "Fuel Cell"}</span>
        <StatusDot simState={simState} color="bg-surface-container0" />
      </div>
      {sel?.efficiency_pct != null && (
        <p className="text-[10px] text-on-surface-variant font-semibold mb-1">η {Number(sel.efficiency_pct).toFixed(0)}%</p>
      )}

      <p className="text-[10px] text-on-surface-variant/70 mb-1">Parameters edited in right sidebar</p>

      {kpi && (
        <div className="mt-2 pt-1 border-t border-outline-variant/20 animate-in fade-in duration-500 space-y-0.5">
          <p className="text-[10px] font-semibold text-on-surface-variant">
            Avg output: {Number(kpi.avg_fc_power_kw).toFixed(1)} kW
          </p>
          <p className="text-[10px] text-on-surface-variant/70">
            η sys <span className="font-medium text-on-surface-variant">{Number(kpi.system_efficiency_pct).toFixed(1)} %</span>
          </p>
        </div>
      )}

      <ModelPicker slotKey={slotKey} models={models?.[slotKey]} selected={sel} onSelect={onSelectModel} disabled={disabled} />
      <Handle type="source" position={Position.Right} id="elec-out"
        className="!bg-gray-400 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}, (p, n) => p.selected === n.selected);

// ─────────────────────────────────────────────────────────────────────────────
// NODE: AC Load / Grid Output
// ─────────────────────────────────────────────────────────────────────────────
const LoadNode = memo(function LoadNode({ selected }) {
  const { simState, kpi } = useContext(DiagramCtx);
  return (
    <div className={`bg-surface-container-lowest rounded-xl border-2 shadow-md px-3 py-2.5 w-36 transition-colors duration-150
      ${selected ? "border-gray-600 shadow-gray-100 shadow-lg ring-2 ring-gray-300 ring-offset-1" : "border-gray-500 hover:border-gray-600 hover:shadow-gray-100 hover:shadow-xl"}
    `}>
      <Handle type="target" position={Position.Left} id="elec-in" className="!bg-gray-400 !w-3 !h-3 !border-2 !border-white" />

      <div className="flex items-center gap-1.5 mb-1">
        <span className="p-1 rounded-lg bg-surface-container-high text-on-surface-variant"><FiZap size={12} /></span>
        <span className="text-xs font-bold text-on-surface">AC Output</span>
        <StatusDot simState={simState} color="bg-gray-400" />
      </div>
      <p className="text-[10px] text-on-surface-variant/70 mb-1">Power to grid</p>
      {kpi ? (
        <p className="text-lg font-bold text-on-surface-variant leading-none animate-in fade-in duration-500">
          {Number(kpi.avg_fc_power_kw).toFixed(1)}
          <span className="text-xs font-normal text-on-surface-variant/70 ml-1">kW</span>
        </p>
      ) : (
        <p className="text-sm font-medium text-on-surface-variant/50 leading-none">— kW</p>
      )}
    </div>
  );
}, (p, n) => p.selected === n.selected);

// ─────────────────────────────────────────────────────────────────────────────
// NODE: Water Supply
// ─────────────────────────────────────────────────────────────────────────────
const WaterNode = memo(function WaterNode({ selected }) {
  return (
    <div className={`bg-surface-container-lowest rounded-xl border-2 shadow-sm px-3 py-2 w-32 transition-colors duration-150
      ${selected ? "border-gray-500 ring-2 ring-gray-200 ring-offset-1 shadow-md" : "border-outline-variant/40 hover:border-gray-400 hover:shadow-md"}
    `}>
      <div className="flex items-center gap-1.5">
        <span className="text-on-surface-variant/70">
          {/* Droplet SVG */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2C12 2 5 10 5 15a7 7 0 0014 0C19 10 12 2 12 2z" />
          </svg>
        </span>
        <span className="text-xs font-bold text-on-surface-variant">H₂O Supply</span>
      </div>
      <p className="text-[10px] text-on-surface-variant/70">Deionised water</p>
      <Handle type="source" position={Position.Top} id="water-out" className="!bg-gray-300 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}, (p, n) => p.selected === n.selected);

// ─────────────────────────────────────────────────────────────────────────────
// nodeTypes MUST be at module scope — not inside the component
// ─────────────────────────────────────────────────────────────────────────────
const nodeTypes = {
  grid:         GridNode,
  electrolyzer: ElzNode,
  compressor:   CompressorNode,
  tank:         TankNode,
  fuelcell:     FuelCellNode,
  load:         LoadNode,
  water:        WaterNode,
};

// ─────────────────────────────────────────────────────────────────────────────
// Fixed node positions (users can still drag to customise)
// ─────────────────────────────────────────────────────────────────────────────
const INITIAL_POSITIONS = {
  grid:         { x: 20,   y: 210 },
  electrolyzer: { x: 320,  y: 100 },
  compressor:   { x: 660,  y: 165 },
  tank:         { x: 980,  y: 110 },
  fuelcell:     { x: 1290, y: 100 },
  load:         { x: 1620, y: 210 },
  water:        { x: 330,  y: 430 },
};

// Edge style helpers
const elecEdge  = (id, src, tgt, srcH, tgtH, lbl) => ({
  id, source: src, target: tgt, sourceHandle: srcH, targetHandle: tgtH,
  type: "smoothstep", animated: true,
  style: { stroke: "#6b7280", strokeWidth: 2.5 },
  label: lbl, labelStyle: { fontSize: 10, fill: "#374151", fontWeight: 600 },
  labelBgStyle: { fill: "#f3f4f6", fillOpacity: 0.9 }, labelBgPadding: [4, 3], labelBgBorderRadius: 4,
  markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 16, height: 16 },
});

const h2Edge = (id, src, tgt, srcH, tgtH, lbl) => ({
  id, source: src, target: tgt, sourceHandle: srcH, targetHandle: tgtH,
  type: "smoothstep", animated: true,
  style: { stroke: "#9ca3af", strokeWidth: 2.5 },
  label: lbl, labelStyle: { fontSize: 10, fill: "#374151", fontWeight: 600 },
  labelBgStyle: { fill: "#f3f4f6", fillOpacity: 0.9 }, labelBgPadding: [4, 3], labelBgBorderRadius: 4,
  markerEnd: { type: MarkerType.ArrowClosed, color: "#9ca3af", width: 16, height: 16 },
});

const waterEdge = (id, src, tgt, srcH, tgtH, lbl) => ({
  id, source: src, target: tgt, sourceHandle: srcH, targetHandle: tgtH,
  type: "smoothstep", animated: true,
  style: { stroke: "#d1d5db", strokeWidth: 2 },
  label: lbl, labelStyle: { fontSize: 10, fill: "#374151", fontWeight: 600 },
  labelBgStyle: { fill: "#f3f4f6", fillOpacity: 0.9 }, labelBgPadding: [4, 3], labelBgBorderRadius: 4,
  markerEnd: { type: MarkerType.ArrowClosed, color: "#d1d5db", width: 14, height: 14 },
});

const INITIAL_EDGES = [
  elecEdge  ("e-grid-elz",  "grid",         "electrolyzer", "elec-out", "elec-in",  "AC Power"),
  waterEdge ("e-water-elz", "water",         "electrolyzer", "water-out","water-in", "H₂O"),
  h2Edge    ("e-elz-comp",  "electrolyzer",  "compressor",   "h2-out",   "h2-in",    "H₂ gas"),
  h2Edge    ("e-comp-tank", "compressor",    "tank",         "h2-out",   "h2-in",    "Compressed H₂"),
  h2Edge    ("e-tank-fc",   "tank",          "fuelcell",     "h2-out",   "h2-in",    "H₂ stored"),
  elecEdge  ("e-fc-load",   "fuelcell",      "load",         "elec-out", "elec-in",  "AC Power"),
];

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
export default function H2PlantFlowDiagram({
  elz, setElz, sto, setSto, fc, setFc,
  simState, kpi,
  models, selectedModels, onSelectModel,
  activeNodeId, onNodeClick,
  customProfile, onSetCustomProfile,
  genParamOverrides,
}) {
  const [edges, , onEdgesChange] = useEdgesState(INITIAL_EDGES);

  // Context value — nodes read from here; the nodes array never rebuilds on
  // state changes, so React Flow skips canvas re-layout on every update.
  const ctxValue = useMemo(
    () => ({ elz, setElz, sto, setSto, fc, setFc, simState, kpi,
             models, selectedModels, onSelectModel,
             activeNodeId, customProfile, onSetCustomProfile, genParamOverrides }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [elz, sto, fc, simState, kpi, selectedModels, models, activeNodeId, customProfile, genParamOverrides]
  );

  // Edges always flow — opacity shifts with sim state for visual feedback.
  const liveEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        animated: true,
        style: {
          ...e.style,
          opacity: simState === "idle" ? 0.45 : 1,
          transition: "opacity 0.4s ease",
        },
      })),
    [edges, simState]
  );

  return (
    <DiagramCtx.Provider value={ctxValue}>
    <div className="w-full rounded-2xl overflow-hidden border border-outline-variant/20 shadow-sm" style={{ height: 560 }}>
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-2 bg-surface-container border-b border-outline-variant/20 text-[11px]">
        <span className="font-semibold text-on-surface-variant mr-1">Legend:</span>
        <span className="flex items-center gap-1.5 text-on-surface-variant">
          <span className="inline-block w-5 h-0.5 bg-on-surface-variant/60 rounded" />
          Electrical
        </span>
        <span className="flex items-center gap-1.5 text-on-surface-variant">
          <span className="inline-block w-5 h-0.5 border-t-2 border-on-surface-variant/60" style={{ borderStyle: "dashed" }} />
          H₂ gas
        </span>
        <span className="flex items-center gap-1.5 text-on-surface-variant">
          <span className="inline-block w-5 h-0.5 border-t-2 border-on-surface-variant/40" style={{ borderStyle: "dashed" }} />
          Water
        </span>
        <span className="flex items-center gap-2 text-on-surface-variant">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary" />Commercial</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-secondary" />Demo</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-tertiary" />Projection</span>
        </span>
        <span className="ml-auto text-on-surface-variant/70 italic">Drag · zoom · click a node to open analysis</span>
      </div>

      <ReactFlow
        defaultNodes={Object.entries(INITIAL_POSITIONS).map(([id, position]) => ({
          id, type: id, position, data: {},
        }))}
        edges={liveEdges}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        onNodeClick={onNodeClick}
        minZoom={0.25}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        autoPanOnNodeDrag={false}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        style={{ background: "#f2f4f6" }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.5}
          color="#c3c6d7"
        />
        <Controls
          position="bottom-right"
          style={{
            background: "#ffffff",
            border: "1px solid #c3c6d7",
            borderRadius: "8px",
            overflow: "hidden",
          }}
        />
        <MiniMap
          nodeColor={(n) =>
            ({ grid: "#4d4b9e", electrolyzer: "#4d4b9e", compressor: "#943700",
               tank: "#943700", fuelcell: "#5b5d72", load: "#5b5d72", water: "#6f7dd6" }[n.type] ?? "#737686")
          }
          maskColor="rgba(120,124,140,0.15)"
          position="bottom-left"
          style={{
            background: "#eceef0",
            border: "1px solid #c3c6d7",
            borderRadius: "8px",
          }}
        />
      </ReactFlow>
    </div>
    </DiagramCtx.Provider>
  );
}

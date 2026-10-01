/**
 * CCSFlowDiagram.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Interactive CCS Process Flow Diagram matching H₂ plant architecture.
 * Built with @xyflow/react (React Flow v12) - draggable nodes with connections.
 *
 * Props:
 *   result            {Object}    – simulation results with component data arrays
 *   isRunning         {boolean}   – whether simulation is currently running
 *   onNodeClick       {Function}  – (nodeId) callback when component is clicked
 *   ccsModels         {Object}    – models from OpenTech-DB for each CCS component
 *   selectedCcsModels {Object}    – currently selected models
 *   onSelectCcsModel  {Function}  – (slotKey, model) callback for tech selection
 *   simState          {string}    – simulation state
 */

import React, { createContext, memo, useCallback, useContext, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import {
  FiZap, FiDroplet, FiWind, FiBox, FiDatabase,
  FiChevronDown, FiSettings,
} from "react-icons/fi";
import H2NodeModal from "./H2NodeModal.jsx";
import CCSSourcePanel from "./CCSSourcePanel.jsx";
import CCSAbsorberPanel from "./CCSAbsorberPanel.jsx";
import CCSStripperPanel from "./CCSStripperPanel.jsx";
import CCSCompressorPanel from "./CCSCompressorPanel.jsx";
import CCSStoragePanel from "./CCSStoragePanel.jsx";

// Shared context — nodes read state here, not via data prop
const DiagramCtx = createContext(null);

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Lifecycle badge color
// ─────────────────────────────────────────────────────────────────────────────
function lifecycleDot(lifecycle) {
  if (lifecycle === "commercial") return "bg-gray-400";
  if (lifecycle === "projection") return "bg-gray-400";
  if (lifecycle === "demonstration") return "bg-gray-400";
  return "bg-slate-300";
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Status indicator dot
// ─────────────────────────────────────────────────────────────────────────────
function StatusDot({ simState, color }) {
  if (simState !== "running" && simState !== "queued") return null;
  return (
    <span className={`ml-auto shrink-0 w-2 h-2 rounded-full ${color} animate-pulse`} />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Model picker component - Memoized for performance
// ─────────────────────────────────────────────────────────────────────────────
function ModelPicker({ slotKey, models, selected, onSelect, disabled }) {
  const [open,       setOpen]       = useState(false);
  const [staged,     setStaged]     = useState(null);
  const [popupStyle, setPopupStyle] = useState({});
  const buttonRef = useRef(null);

  if (!models?.length) return null;

  const stop   = (e) => e.stopPropagation();

  const toggle = (e) => {
    stop(e);
    if (disabled) return;
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPopupStyle({
        position: "fixed",
        top:   rect.bottom + 4,
        left:  rect.left,
        width: Math.max(rect.width, 220),
        zIndex: 99999,
      });
    }
    setOpen((o) => !o);
  };

  const stage = (e, m) => { stop(e); setStaged(m); };

  const apply = (e, m) => {
    stop(e);
    const toApply = m ?? staged;
    if (!toApply) return;
    onSelect(slotKey, toApply);
    setStaged(null);
    setOpen(false);
  };

  const hasPending  = staged && staged.id !== selected?.id;
  const displayModel = hasPending ? staged : selected;

  return (
    <div className="mt-2 pt-2 border-t border-outline-variant/20" onClick={stop}>
      <div className="flex items-center gap-1">
        <button
          ref={buttonRef}
          disabled={disabled}
          onClick={toggle}
          className={`nodrag flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left
            border transition-all text-[11px]
            ${ hasPending
                ? "border-outline-variant/40 bg-surface-container text-on-surface"
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

      {hasPending && (
        <p className="text-[9px] text-on-surface-variant font-medium mt-0.5 ml-0.5">
          Staged — click ✓ to apply
        </p>
      )}

      {open && createPortal(
        <div
          style={popupStyle}
          className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-xl overflow-hidden"
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
                          ? "bg-surface-container border-l-2 border-gray-400"
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
                  </div>
                  {m.description && (
                    <p className="text-[9px] text-on-surface-variant/70 mt-0.5 ml-3.5 line-clamp-2">{m.description}</p>
                  )}
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
        </div>,
        document.body
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE: Flue Gas Source
// ─────────────────────────────────────────────────────────────────────────────
const SourceNode = memo(function SourceNode({ selected }) {
  const { simState, models, selectedModels, onSelectModel, result } = useContext(DiagramCtx);
  const slotKey = "source";
  const sel = selectedModels?.[slotKey];
  const disabled = simState === "running" || simState === "queued";

  const latest = result?.source ? {
    flux: result.source.co2_tph?.[result.source.co2_tph.length - 1] ?? 0,
  } : null;

  return (
    <div className={`bg-surface-container-lowest rounded-xl border-2 shadow-md px-3 py-2.5 w-64 cursor-pointer transition-colors duration-150
      ${selected ? "border-gray-600 shadow-gray-100 ring-2 ring-gray-300 ring-offset-1" : "border-gray-400 hover:border-gray-500 hover:shadow-gray-100 hover:shadow-xl"}
      ${simState === "running" && !selected ? "shadow-lg shadow-gray-100" : ""}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="p-1 rounded-lg bg-surface-container text-on-surface-variant"><FiZap size={12} /></span>
        <span className="text-xs font-bold text-on-surface truncate max-w-[160px]">{sel?.name ?? "Flue Gas Source"}</span>
        <StatusDot simState={simState} color="bg-gray-400" />
      </div>
      {sel && (
        <p className="text-[10px] text-on-surface-variant font-semibold mb-1">
          {sel.capacity_kw ? `${(sel.capacity_kw / 1000).toFixed(0)} MW` : ""}
          {sel.co2_emission_kg_kwh ? ` · ${sel.co2_emission_kg_kwh.toFixed(2)} kg CO₂/kWh` : ""}
        </p>
      )}
      {latest && (
        <div className="mt-1 mb-1 p-1.5 bg-surface-container rounded">
          <p className="text-[10px] font-semibold text-on-surface">{latest.flux.toFixed(1)} t CO₂/h</p>
        </div>
      )}
      <ModelPicker slotKey={slotKey} models={models?.[slotKey]} selected={sel} onSelect={onSelectModel} disabled={disabled} />
      <Handle type="source" position={Position.Right} id="flue-out" className="!bg-gray-400 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}, (p, n) => p.selected === n.selected);

// ─────────────────────────────────────────────────────────────────────────────
// NODE: CO₂ Absorber
// ─────────────────────────────────────────────────────────────────────────────
const AbsorberNode = memo(function AbsorberNode({ selected }) {
  const { simState, models, selectedModels, onSelectModel, result } = useContext(DiagramCtx);
  const slotKey = "absorber";
  const sel = selectedModels?.[slotKey];
  const disabled = simState === "running" || simState === "queued";

  const srcArr = result?.source?.co2_tph ?? [];
  const capArr = result?.absorber?.co2_captured_tph ?? [];
  const latest = result?.absorber ? {
    captured: capArr[capArr.length - 1] ?? 0,
    eff: srcArr.length && capArr.length ? (capArr[capArr.length - 1] / (srcArr[srcArr.length - 1] || 1) * 100) : 0,
  } : null;

  return (
    <div className={`bg-surface-container-lowest rounded-xl border-2 shadow-md px-3 py-2.5 w-64 cursor-pointer transition-colors duration-150
      ${selected ? "border-gray-600 shadow-gray-100 ring-2 ring-gray-300 ring-offset-1" : "border-gray-400 hover:border-gray-500 hover:shadow-gray-100 hover:shadow-xl"}
      ${simState === "running" && !selected ? "shadow-lg shadow-gray-100" : ""}`}
    >
      <Handle type="target" position={Position.Left} id="flue-in" className="!bg-gray-400 !w-3 !h-3 !border-2 !border-white" />
      <div className="flex items-center gap-1.5 mb-1">
        <span className="p-1 rounded-lg bg-surface-container text-on-surface-variant"><FiDroplet size={12} /></span>
        <span className="text-xs font-bold text-on-surface truncate max-w-[110px]">{sel?.name ?? "CO₂ Absorber"}</span>
        <StatusDot simState={simState} color="bg-gray-400" />
      </div>
      {sel?.efficiency_pct && (
        <p className="text-[10px] text-on-surface-variant font-semibold mb-1">η {Number(sel.efficiency_pct).toFixed(0)}%</p>
      )}
      {latest && (
        <div className="mt-1 mb-1 p-1.5 bg-surface-container rounded">
          <p className="text-[10px] font-semibold text-on-surface">{latest.captured.toFixed(1)} t/h captured</p>
          <p className="text-[9px] text-on-surface-variant">{latest.eff.toFixed(0)}% efficiency</p>
        </div>
      )}
      <ModelPicker slotKey={slotKey} models={models?.[slotKey]} selected={sel} onSelect={onSelectModel} disabled={disabled} />
      <Handle type="source" position={Position.Right} id="rich-out" className="!bg-gray-600 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}, (p, n) => p.selected === n.selected);

// ─────────────────────────────────────────────────────────────────────────────
// NODE: Stripper/Regenerator
// ─────────────────────────────────────────────────────────────────────────────
const StripperNode = memo(function StripperNode({ selected }) {
  const { simState, models, selectedModels, onSelectModel, result } = useContext(DiagramCtx);
  const slotKey = "stripper";
  const sel = selectedModels?.[slotKey];
  const disabled = simState === "running" || simState === "queued";

  const latest = result?.stripper ? {
    thermal: result.stripper.heat_demand_kw?.[result.stripper.heat_demand_kw.length - 1] ?? 0,
  } : null;

  return (
    <div className={`bg-surface-container-lowest rounded-xl border-2 shadow-md px-3 py-2.5 w-64 cursor-pointer transition-colors duration-150
      ${selected ? "border-gray-600 shadow-gray-100 ring-2 ring-gray-300 ring-offset-1" : "border-gray-400 hover:border-gray-500 hover:shadow-gray-100 hover:shadow-xl"}
      ${simState === "running" && !selected ? "shadow-lg shadow-gray-100" : ""}`}
    >
      <Handle type="target" position={Position.Left} id="rich-in" className="!bg-gray-600 !w-3 !h-3 !border-2 !border-white" />
      <div className="flex items-center gap-1.5 mb-1">
        <span className="p-1 rounded-lg bg-surface-container text-on-surface-variant"><FiWind size={12} /></span>
        <span className="text-xs font-bold text-on-surface truncate max-w-[110px]">{sel?.name ?? "Stripper"}</span>
        <StatusDot simState={simState} color="bg-gray-400" />
      </div>
      {sel?.efficiency_pct && (
        <p className="text-[10px] text-on-surface-variant font-semibold mb-1">η {Number(sel.efficiency_pct).toFixed(0)}%</p>
      )}
      {latest && (
        <div className="mt-1 mb-1 p-1.5 bg-surface-container rounded">
          <p className="text-[10px] font-semibold text-on-surface">{Math.round(latest.thermal)} kW heat</p>
        </div>
      )}
      <ModelPicker slotKey={slotKey} models={models?.[slotKey]} selected={sel} onSelect={onSelectModel} disabled={disabled} />
      <Handle type="source" position={Position.Right} id="co2-out" className="!bg-surface-container0 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}, (p, n) => p.selected === n.selected);

// ─────────────────────────────────────────────────────────────────────────────
// NODE: CO₂ Compressor
// ─────────────────────────────────────────────────────────────────────────────
const CompressorNode = memo(function CompressorNode({ selected }) {
  const { simState, models, selectedModels, onSelectModel, result } = useContext(DiagramCtx);
  const slotKey = "compressor";
  const sel = selectedModels?.[slotKey];
  const disabled = simState === "running" || simState === "queued";

  const latest = result?.compressor ? {
    power: result.compressor.power_kw?.[result.compressor.power_kw.length - 1] ?? 0,
    pressure: result.compressor.outlet_pressure_bar?.[result.compressor.outlet_pressure_bar.length - 1] ?? 0,
  } : null;

  return (
    <div className={`bg-surface-container-lowest rounded-xl border-2 shadow-md px-3 py-2.5 w-64 cursor-pointer transition-colors duration-150
      ${selected ? "border-gray-600 shadow-gray-100 ring-2 ring-gray-300 ring-offset-1" : "border-gray-500 hover:border-gray-600 hover:shadow-gray-100 hover:shadow-xl"}
      ${simState === "running" && !selected ? "shadow-lg shadow-gray-100" : ""}`}
    >
      <Handle type="target" position={Position.Left} id="co2-in" className="!bg-surface-container0 !w-3 !h-3 !border-2 !border-white" />
      <div className="flex items-center gap-1.5 mb-1">
        <span className="p-1 rounded-lg bg-surface-container text-on-surface-variant"><FiBox size={12} /></span>
        <span className="text-xs font-bold text-on-surface truncate max-w-[110px]">{sel?.name ?? "Compressor"}</span>
        <StatusDot simState={simState} color="bg-gray-400" />
      </div>
      {sel?.efficiency_pct && (
        <p className="text-[10px] text-on-surface-variant font-semibold mb-1">η {Number(sel.efficiency_pct).toFixed(0)}%</p>
      )}
      {latest && (
        <div className="mt-1 mb-1 p-1.5 bg-surface-container rounded">
          <p className="text-[10px] font-semibold text-on-surface">{Math.round(latest.power)} kW</p>
          <p className="text-[9px] text-on-surface-variant">{Math.round(latest.pressure)} bar</p>
        </div>
      )}
      <ModelPicker slotKey={slotKey} models={models?.[slotKey]} selected={sel} onSelect={onSelectModel} disabled={disabled} />
      <Handle type="source" position={Position.Right} id="hp-out" className="!bg-gray-600 !w-3 !h-3 !border-2 !border-white" />
    </div>
  );
}, (p, n) => p.selected === n.selected);

// ─────────────────────────────────────────────────────────────────────────────
// NODE: CO₂ Storage
// ─────────────────────────────────────────────────────────────────────────────
const StorageNode = memo(function StorageNode({ selected }) {
  const { simState, models, selectedModels, onSelectModel, result } = useContext(DiagramCtx);
  const slotKey = "storage";
  const sel = selectedModels?.[slotKey];
  const disabled = simState === "running" || simState === "queued";

  const latest = result?.storage ? {
    rate: result.storage.injection_rate_tph?.[result.storage.injection_rate_tph.length - 1] ?? 0,
    total: result.storage.co2_mass_tonnes?.[result.storage.co2_mass_tonnes.length - 1] ?? 0,
  } : null;

  return (
    <div className={`bg-surface-container-lowest rounded-xl border-2 shadow-md px-3 py-2.5 w-64 cursor-pointer transition-colors duration-150
      ${selected ? "border-gray-600 shadow-gray-100 ring-2 ring-gray-300 ring-offset-1" : "border-gray-500 hover:border-gray-600 hover:shadow-gray-100 hover:shadow-xl"}
      ${simState === "running" && !selected ? "shadow-lg shadow-gray-100" : ""}`}
    >
      <Handle type="target" position={Position.Left} id="hp-in" className="!bg-gray-600 !w-3 !h-3 !border-2 !border-white" />
      <div className="flex items-center gap-1.5 mb-1">
        <span className="p-1 rounded-lg bg-surface-container text-on-surface-variant"><FiDatabase size={12} /></span>
        <span className="text-xs font-bold text-on-surface truncate max-w-[110px]">{sel?.name ?? "CO₂ Storage"}</span>
        <StatusDot simState={simState} color="bg-gray-400" />
      </div>
      {sel && (
        <p className="text-[10px] text-on-surface-variant font-semibold mb-1">
          {sel.capacity_tco2_yr ? `${(sel.capacity_tco2_yr / 1000000).toFixed(1)} Mt/yr` : "Geological"}
        </p>
      )}
      {latest && (
        <div className="mt-1 mb-1 p-1.5 bg-surface-container rounded">
          <p className="text-[10px] font-semibold text-on-surface">{latest.rate.toFixed(1)} t/h injected</p>
          <p className="text-[9px] text-on-surface-variant">{(latest.total / 1000).toFixed(1)} kt stored</p>
        </div>
      )}
      <ModelPicker slotKey={slotKey} models={models?.[slotKey]} selected={sel} onSelect={onSelectModel} disabled={disabled} />
    </div>
  );
}, (p, n) => p.selected === n.selected);

// ─────────────────────────────────────────────────────────────────────────────
// Real-world CCS reference scenarios
// ─────────────────────────────────────────────────────────────────────────────
const CCS_SCENARIOS = [
  { id: "custom", label: "Custom", icon: "⚙️", description: "Configure each component manually.", region: "", status: null,
    models: null, params: null },
  { id: "sleipner", label: "Sleipner CO₂ Storage", icon: "🌊", description: "First offshore CCS (1996). Statoil, Norway. ~1 Mt CO₂/yr.", region: "Norway · North Sea", status: "Operational", statusColor: "#34d399",
    models: { source: "gas_ccgt", absorber: "mea_absorb", stripper: "conv_stripper", compressor: "multistage_110", storage: "saline_offshore" },
    params: { source: { capacity_kw: 700000, efficiency_pct: 55, co2_emission_kg_kwh: 0.37, flue_gas_temp_c: 130, co2_concentration_pct: 4.0 }, absorber: { capture_rate_pct: 85, energy_requirement_gj_tco2: 3.9, solvent_flow_rate_m3_h: 600, absorption_temp_c: 40, l_g_ratio: 3.5 }, stripper: { reboiler_temp_c: 120, steam_pressure_bar: 3.5, thermal_efficiency_pct: 80, energy_input_gj_tco2: 3.5 }, compressor: { target_pressure_bar: 110, number_stages: 4, isentropic_efficiency_pct: 80, intercooling_temp_c: 35 }, storage: { injection_rate_mtco2_yr: 1.0, reservoir_depth_m: 1000, reservoir_pressure_bar: 100, permeability_md: 1500, porosity_pct: 35, injection_efficiency_pct: 99 } } },
  { id: "boundary_dam", label: "Boundary Dam CCS", icon: "⚫", description: "First commercial CCS on coal (2014). SaskPower, Canada. ~800 kt CO₂/yr.", region: "Saskatchewan, Canada", status: "Operational", statusColor: "#34d399",
    models: { source: "coal_pc", absorber: "advanced_amine", stripper: "vapor_recomp", compressor: "multistage_150", storage: "depleted_oil" },
    params: { source: { capacity_kw: 110000, efficiency_pct: 38, co2_emission_kg_kwh: 0.95, flue_gas_temp_c: 140, co2_concentration_pct: 14.0 }, absorber: { capture_rate_pct: 90, energy_requirement_gj_tco2: 3.3, solvent_flow_rate_m3_h: 350, absorption_temp_c: 42, l_g_ratio: 4.0 }, stripper: { reboiler_temp_c: 125, steam_pressure_bar: 4.0, thermal_efficiency_pct: 83, energy_input_gj_tco2: 3.3 }, compressor: { target_pressure_bar: 150, number_stages: 5, isentropic_efficiency_pct: 82, intercooling_temp_c: 30 }, storage: { injection_rate_mtco2_yr: 0.8, reservoir_depth_m: 1500, reservoir_pressure_bar: 140, permeability_md: 300, porosity_pct: 20, injection_efficiency_pct: 95 } } },
  { id: "quest", label: "Quest CCS (Shell)", icon: "🛢️", description: "Post-combustion CCS on oil sands H₂ production (2015). Alberta, Canada. ~1 Mt CO₂/yr.", region: "Alberta, Canada", status: "Operational", statusColor: "#34d399",
    models: { source: "refinery", absorber: "mea_absorb", stripper: "vapor_recomp", compressor: "multistage_110", storage: "saline_aquifer" },
    params: { source: { capacity_kw: 200000, efficiency_pct: 80, co2_emission_kg_kwh: 0.45, flue_gas_temp_c: 120, co2_concentration_pct: 18.0 }, absorber: { capture_rate_pct: 88, energy_requirement_gj_tco2: 3.6, solvent_flow_rate_m3_h: 400, absorption_temp_c: 40, l_g_ratio: 3.8 }, stripper: { reboiler_temp_c: 120, steam_pressure_bar: 3.5, thermal_efficiency_pct: 82, energy_input_gj_tco2: 3.2 }, compressor: { target_pressure_bar: 110, number_stages: 4, isentropic_efficiency_pct: 82, intercooling_temp_c: 35 }, storage: { injection_rate_mtco2_yr: 1.0, reservoir_depth_m: 2300, reservoir_pressure_bar: 210, permeability_md: 200, porosity_pct: 18, injection_efficiency_pct: 99 } } },
  { id: "petra_nova", label: "Petra Nova (NRG)", icon: "⚫", description: "Largest coal post-combustion CCS (2017, suspended 2020). Texas, USA. ~1.4 Mt CO₂/yr.", region: "Texas, USA", status: "Suspended", statusColor: "#fbbf24",
    models: { source: "coal_pc", absorber: "advanced_amine", stripper: "vapor_recomp", compressor: "multistage_150", storage: "depleted_oil" },
    params: { source: { capacity_kw: 240000, efficiency_pct: 37, co2_emission_kg_kwh: 0.98, flue_gas_temp_c: 135, co2_concentration_pct: 13.5 }, absorber: { capture_rate_pct: 90, energy_requirement_gj_tco2: 3.1, solvent_flow_rate_m3_h: 700, absorption_temp_c: 40, l_g_ratio: 4.2 }, stripper: { reboiler_temp_c: 122, steam_pressure_bar: 3.8, thermal_efficiency_pct: 85, energy_input_gj_tco2: 3.1 }, compressor: { target_pressure_bar: 150, number_stages: 5, isentropic_efficiency_pct: 83, intercooling_temp_c: 32 }, storage: { injection_rate_mtco2_yr: 1.4, reservoir_depth_m: 1400, reservoir_pressure_bar: 130, permeability_md: 400, porosity_pct: 25, injection_efficiency_pct: 95 } } },
  { id: "northern_lights", label: "Northern Lights", icon: "🌊", description: "First open-access CO₂ transport & storage (2024). Equinor/TotalEnergies/Shell. Aurora field, Norway.", region: "Norway · North Sea", status: "Operational", statusColor: "#34d399",
    models: { source: "cement_plant", absorber: "advanced_amine", stripper: "multi_pressure", compressor: "multistage_150", storage: "saline_offshore" },
    params: { source: { capacity_kw: 50000, efficiency_pct: 45, co2_emission_kg_kwh: 0.82, flue_gas_temp_c: 200, co2_concentration_pct: 20.0 }, absorber: { capture_rate_pct: 85, energy_requirement_gj_tco2: 3.0, solvent_flow_rate_m3_h: 300, absorption_temp_c: 45, l_g_ratio: 3.2 }, stripper: { reboiler_temp_c: 118, steam_pressure_bar: 3.2, thermal_efficiency_pct: 87, energy_input_gj_tco2: 3.0 }, compressor: { target_pressure_bar: 150, number_stages: 4, isentropic_efficiency_pct: 84, intercooling_temp_c: 30 }, storage: { injection_rate_mtco2_yr: 1.5, reservoir_depth_m: 2600, reservoir_pressure_bar: 240, permeability_md: 800, porosity_pct: 30, injection_efficiency_pct: 99 } } },
  { id: "carbfix", label: "CarbFix (Iceland)", icon: "🪨", description: "CO₂ mineralized in basaltic rock. Hellisheiði geothermal plant. Permanent mineral storage. ~35 kt CO₂/yr.", region: "Iceland", status: "Operational", statusColor: "#34d399",
    models: { source: "gas_ccgt", absorber: "membrane", stripper: "flash_regen", compressor: "isothermal_comp", storage: "basalt_mineral" },
    params: { source: { capacity_kw: 90000, efficiency_pct: 30, co2_emission_kg_kwh: 0.05, flue_gas_temp_c: 110, co2_concentration_pct: 0.6 }, absorber: { capture_rate_pct: 75, energy_requirement_gj_tco2: 2.5, solvent_flow_rate_m3_h: 120, absorption_temp_c: 35, l_g_ratio: 2.8 }, stripper: { reboiler_temp_c: 100, steam_pressure_bar: 2.0, thermal_efficiency_pct: 90, energy_input_gj_tco2: 2.2 }, compressor: { target_pressure_bar: 120, number_stages: 3, isentropic_efficiency_pct: 86, intercooling_temp_c: 25 }, storage: { injection_rate_mtco2_yr: 0.035, reservoir_depth_m: 400, reservoir_pressure_bar: 40, permeability_md: 5000, porosity_pct: 10, injection_efficiency_pct: 100 } } },
  { id: "drax_beccs", label: "Drax BECCS", icon: "🌿", description: "Bioenergy CCS at Drax Power Station, UK. Negative emissions. ~8 Mt CO₂/yr target.", region: "Yorkshire, UK", status: "Development", statusColor: "#60a5fa",
    models: { source: "biomass_power", absorber: "advanced_amine", stripper: "vapor_recomp", compressor: "multistage_110", storage: "depleted_gas" },
    params: { source: { capacity_kw: 660000, efficiency_pct: 32, co2_emission_kg_kwh: 0.04, flue_gas_temp_c: 130, co2_concentration_pct: 15.0 }, absorber: { capture_rate_pct: 95, energy_requirement_gj_tco2: 2.9, solvent_flow_rate_m3_h: 2000, absorption_temp_c: 40, l_g_ratio: 4.0 }, stripper: { reboiler_temp_c: 120, steam_pressure_bar: 3.5, thermal_efficiency_pct: 86, energy_input_gj_tco2: 2.9 }, compressor: { target_pressure_bar: 110, number_stages: 4, isentropic_efficiency_pct: 83, intercooling_temp_c: 35 }, storage: { injection_rate_mtco2_yr: 8.0, reservoir_depth_m: 2000, reservoir_pressure_bar: 185, permeability_md: 600, porosity_pct: 22, injection_efficiency_pct: 99 } } },
  { id: "cement_holcim", label: "Holcim Cement CCS", icon: "🏭", description: "MEA post-combustion at cement kiln. High CO₂ concentration from calcination (~20 vol%). ~500 kt CO₂/yr.", region: "Europe", status: "Demonstration", statusColor: "#60a5fa",
    models: { source: "cement_plant", absorber: "mea_absorb", stripper: "conv_stripper", compressor: "multistage_110", storage: "saline_aquifer" },
    params: { source: { capacity_kw: 50000, efficiency_pct: 40, co2_emission_kg_kwh: 0.82, flue_gas_temp_c: 220, co2_concentration_pct: 20.0 }, absorber: { capture_rate_pct: 90, energy_requirement_gj_tco2: 4.0, solvent_flow_rate_m3_h: 250, absorption_temp_c: 45, l_g_ratio: 3.5 }, stripper: { reboiler_temp_c: 125, steam_pressure_bar: 4.0, thermal_efficiency_pct: 81, energy_input_gj_tco2: 3.8 }, compressor: { target_pressure_bar: 110, number_stages: 4, isentropic_efficiency_pct: 82, intercooling_temp_c: 35 }, storage: { injection_rate_mtco2_yr: 0.5, reservoir_depth_m: 1800, reservoir_pressure_bar: 165, permeability_md: 250, porosity_pct: 20, injection_efficiency_pct: 99 } } },
];

// ─────────────────────────────────────────────────────────────────────────────
// Parameter field definitions per component
// ─────────────────────────────────────────────────────────────────────────────
const COMPONENT_PARAMS = {
  source: {
    label: "Flue Gas Source",
    Icon: FiZap,
    accent: "#6b7280",
    fields: [
      { key: "capacity_kw", label: "Plant Capacity", unit: "MW", min: 10, max: 2000, step: 10, decimals: 0, fromState: (v) => v / 1000, toState: (v) => ({ capacity_kw: v * 1000 }) },
      { key: "efficiency_pct", label: "Thermal Efficiency", unit: "%", min: 20, max: 70, step: 0.5, decimals: 1, fromState: (v) => v, toState: (v) => ({ efficiency_pct: v }) },
      { key: "co2_emission_kg_kwh", label: "CO₂ Emission Factor", unit: "kg/kWh", min: 0.01, max: 2.0, step: 0.01, decimals: 2, fromState: (v) => v, toState: (v) => ({ co2_emission_kg_kwh: v }) },
      { key: "co2_concentration_pct", label: "CO₂ Concentration", unit: "vol%", min: 0.1, max: 30, step: 0.1, decimals: 1, fromState: (v) => v, toState: (v) => ({ co2_concentration_pct: v }) },
      { key: "flue_gas_temp_c", label: "Flue Gas Temperature", unit: "°C", min: 50, max: 300, step: 5, decimals: 0, fromState: (v) => v, toState: (v) => ({ flue_gas_temp_c: v }) },
    ],
  },
  absorber: {
    label: "CO₂ Absorber",
    Icon: FiDroplet,
    accent: "#6b7280",
    fields: [
      { key: "capture_rate_pct", label: "Capture Rate", unit: "%", min: 50, max: 99, step: 0.5, decimals: 1, fromState: (v) => v, toState: (v) => ({ capture_rate_pct: v }) },
      { key: "energy_requirement_gj_tco2", label: "Energy Requirement", unit: "GJ/t", min: 1.5, max: 6.0, step: 0.05, decimals: 2, fromState: (v) => v, toState: (v) => ({ energy_requirement_gj_tco2: v }) },
      { key: "solvent_flow_rate_m3_h", label: "Solvent Flow Rate", unit: "m³/h", min: 50, max: 5000, step: 50, decimals: 0, fromState: (v) => v, toState: (v) => ({ solvent_flow_rate_m3_h: v }) },
      { key: "absorption_temp_c", label: "Absorption Temperature", unit: "°C", min: 20, max: 70, step: 1, decimals: 0, fromState: (v) => v, toState: (v) => ({ absorption_temp_c: v }) },
      { key: "l_g_ratio", label: "L/G Ratio", unit: "L/Nm³", min: 1.5, max: 8.0, step: 0.1, decimals: 1, fromState: (v) => v, toState: (v) => ({ l_g_ratio: v }) },
    ],
  },
  stripper: {
    label: "Stripper / Regenerator",
    Icon: FiWind,
    accent: "#6b7280",
    fields: [
      { key: "reboiler_temp_c", label: "Reboiler Temperature", unit: "°C", min: 80, max: 150, step: 1, decimals: 0, fromState: (v) => v, toState: (v) => ({ reboiler_temp_c: v }) },
      { key: "steam_pressure_bar", label: "Steam Pressure", unit: "bar", min: 1.0, max: 8.0, step: 0.1, decimals: 1, fromState: (v) => v, toState: (v) => ({ steam_pressure_bar: v }) },
      { key: "thermal_efficiency_pct", label: "Thermal Efficiency", unit: "%", min: 60, max: 95, step: 0.5, decimals: 1, fromState: (v) => v, toState: (v) => ({ thermal_efficiency_pct: v }) },
      { key: "energy_input_gj_tco2", label: "Regeneration Energy", unit: "GJ/t", min: 1.5, max: 6.0, step: 0.05, decimals: 2, fromState: (v) => v, toState: (v) => ({ energy_input_gj_tco2: v }) },
    ],
  },
  compressor: {
    label: "CO₂ Compressor",
    Icon: FiBox,
    accent: "#6b7280",
    fields: [
      { key: "target_pressure_bar", label: "Target Pressure", unit: "bar", min: 50, max: 300, step: 5, decimals: 0, fromState: (v) => v, toState: (v) => ({ target_pressure_bar: v }) },
      { key: "number_stages", label: "Compression Stages", unit: "", min: 1, max: 8, step: 1, decimals: 0, fromState: (v) => v, toState: (v) => ({ number_stages: v }) },
      { key: "isentropic_efficiency_pct", label: "Isentropic Efficiency", unit: "%", min: 50, max: 95, step: 0.5, decimals: 1, fromState: (v) => v, toState: (v) => ({ isentropic_efficiency_pct: v }) },
      { key: "intercooling_temp_c", label: "Intercooler Temperature", unit: "°C", min: 15, max: 60, step: 1, decimals: 0, fromState: (v) => v, toState: (v) => ({ intercooling_temp_c: v }) },
    ],
  },
  storage: {
    label: "CO₂ Storage",
    Icon: FiDatabase,
    accent: "#6b7280",
    fields: [
      { key: "injection_rate_mtco2_yr", label: "Injection Rate", unit: "Mt/yr", min: 0.01, max: 20, step: 0.1, decimals: 2, fromState: (v) => v, toState: (v) => ({ injection_rate_mtco2_yr: v }) },
      { key: "reservoir_depth_m", label: "Reservoir Depth", unit: "m", min: 200, max: 5000, step: 50, decimals: 0, fromState: (v) => v, toState: (v) => ({ reservoir_depth_m: v }) },
      { key: "reservoir_pressure_bar", label: "Reservoir Pressure", unit: "bar", min: 20, max: 400, step: 5, decimals: 0, fromState: (v) => v, toState: (v) => ({ reservoir_pressure_bar: v }) },
      { key: "permeability_md", label: "Permeability", unit: "mD", min: 1, max: 5000, step: 10, decimals: 0, fromState: (v) => v, toState: (v) => ({ permeability_md: v }) },
      { key: "porosity_pct", label: "Porosity", unit: "%", min: 2, max: 50, step: 0.5, decimals: 1, fromState: (v) => v, toState: (v) => ({ porosity_pct: v }) },
      { key: "injection_efficiency_pct", label: "Injection Efficiency", unit: "%", min: 50, max: 100, step: 0.5, decimals: 1, fromState: (v) => v, toState: (v) => ({ injection_efficiency_pct: v }) },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Dark-themed parameter slider row (for inline panel)
// ─────────────────────────────────────────────────────────────────────────────
function DarkParamRow({ field, stateValue, accent, onChange, disabled }) {
  const displayValue = field.fromState(stateValue ?? field.min);
  const clamped = Math.max(field.min, Math.min(field.max, displayValue));
  const pct = ((clamped - field.min) / (field.max - field.min)) * 100;
  return (
    <div className="py-2 border-b border-slate-700/50 last:border-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-on-surface-variant/70">{field.label}</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            disabled={disabled}
            className="w-16 text-right text-xs font-mono bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-slate-200 focus:outline-none focus:border-gray-500 disabled:opacity-40"
            min={field.min} max={field.max} step={field.step}
            value={field.decimals > 0 ? Number(displayValue).toFixed(field.decimals) : Math.round(displayValue)}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onChange(field.toState(v));
            }}
          />
          <span className="text-[10px] text-on-surface-variant w-10 shrink-0">{field.unit}</span>
        </div>
      </div>
      <div className="relative h-1.5 bg-slate-700 rounded-full">
        <div className="absolute left-0 top-0 h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: accent }} />
        <input
          type="range"
          disabled={disabled}
          className="absolute inset-0 w-full h-1.5 opacity-0 cursor-pointer disabled:cursor-not-allowed"
          min={field.min} max={field.max} step={field.step} value={clamped}
          onChange={(e) => onChange(field.toState(parseFloat(e.target.value)))}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario dropdown (dark themed, portal-based)
// ─────────────────────────────────────────────────────────────────────────────
function ScenarioDropdown({ selectedId, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [popupStyle, setPopupStyle] = useState({});
  const btnRef = useRef(null);
  const scenario = CCS_SCENARIOS.find((s) => s.id === selectedId) ?? CCS_SCENARIOS[0];

  const toggle = (e) => {
    e.stopPropagation();
    if (disabled) return;
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopupStyle({ position: "fixed", top: rect.bottom + 4, left: rect.left, minWidth: 320, zIndex: 99999 });
    }
    setOpen((o) => !o);
  };
  const pick = (id, e) => { e.stopPropagation(); onChange(id); setOpen(false); };

  return (
    <>
      <button
        ref={btnRef}
        disabled={disabled}
        onClick={toggle}
        className={`nodrag flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all
          ${open ? "border-primary bg-primary/10 text-primary" : "border-outline-variant/40 bg-surface-container-lowest text-on-surface-variant hover:border-outline-variant hover:bg-surface-container"}
          disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <FiSettings size={11} className="shrink-0" />
        <span className="max-w-[160px] truncate">{scenario.icon} {scenario.label}</span>
        <FiChevronDown size={11} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[99998]" onClick={() => setOpen(false)} />
          <div style={popupStyle} className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-2xl overflow-hidden z-[99999]">
            <div className="px-3 py-2 border-b border-outline-variant/20 flex items-center justify-between">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Reference Installation</span>
              <button onClick={() => setOpen(false)} className="text-on-surface-variant hover:text-on-surface text-xs">✕</button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {CCS_SCENARIOS.map((sc) => {
                const isActive = selectedId === sc.id;
                return (
                  <div
                    key={sc.id}
                    onClick={(e) => pick(sc.id, e)}
                    className={`px-3 py-2.5 cursor-pointer border-l-2 transition-colors
                      ${isActive ? "bg-primary/10 border-primary" : "border-transparent hover:bg-surface-container"}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">{sc.icon}</span>
                      <span className={`text-xs font-semibold ${isActive ? "text-primary" : "text-on-surface"}`}>{sc.label}</span>
                      {sc.status && (
                        <span className="ml-auto text-[9px] font-semibold px-1.5 py-0.5 rounded-full border" style={{ color: sc.statusColor, borderColor: sc.statusColor + "55", background: sc.statusColor + "22" }}>
                          {sc.status}
                        </span>
                      )}
                      {isActive && <span className="text-primary text-[10px] font-bold">✓</span>}
                    </div>
                    {sc.region && <p className="text-[10px] text-on-surface-variant/70 ml-7 mt-0.5">{sc.region}</p>}
                    {sc.description && <p className="text-[10px] text-on-surface-variant ml-7 mt-0.5 line-clamp-1">{sc.description}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline parameter panel (right-side dark panel, deployed on node click)
// ─────────────────────────────────────────────────────────────────────────────
function InlineParamPanel({ nodeId, paramState, onParamChange, ccsModels, selectedCcsModels, onSelectCcsModel, selectedScenario, onResetToScenario, simState, onClose }) {
  const disabled = simState === "running" || simState === "queued";
  const spec = COMPONENT_PARAMS[nodeId];
  if (!spec) return null;

  const { Icon, label, accent, fields } = spec;
  const state = paramState[nodeId] ?? {};
  const handler = onParamChange[nodeId];

  const currentModels = ccsModels?.[nodeId] ?? [];
  const currentSelected = selectedCcsModels?.[nodeId];
  const scenario = CCS_SCENARIOS.find((s) => s.id === selectedScenario);

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-700" style={{ width: 268 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700 shrink-0" style={{ borderLeftColor: accent, borderLeftWidth: 3 }}>
        <span className="p-1 rounded-md" style={{ background: accent + "22", color: accent }}>
          <Icon size={13} />
        </span>
        <span className="text-xs font-bold text-slate-200 flex-1">{label}</span>
        <div className="flex items-center gap-1">
          {scenario?.params?.[nodeId] && (
            <button
              disabled={disabled || selectedScenario === "custom"}
              onClick={onResetToScenario}
              title="Reset to scenario defaults"
              className="p-1 rounded text-on-surface-variant hover:text-on-surface-variant/50 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <FiRefreshCw size={11} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded text-on-surface-variant hover:text-on-surface-variant/50 hover:bg-slate-700 transition-colors"
          >
            <FiX size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Technology model picker */}
        {currentModels.length > 0 && (
          <div className="px-3 py-2 border-b border-slate-700/50">
            <p className="text-[9px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Technology Model</p>
            <div className="flex flex-col gap-1">
              {currentModels.map((m) => {
                const isSel = currentSelected?.id === m.id;
                return (
                  <button
                    key={m.id}
                    disabled={disabled}
                    onClick={() => onSelectCcsModel?.(nodeId, m)}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] border transition-all text-left
                      ${isSel ? "border-gray-500/50 bg-primary/30 text-on-surface-variant/50" : "border-slate-700 bg-slate-800 text-on-surface-variant/70 hover:border-slate-600 hover:text-on-surface-variant/50"}
                      disabled:opacity-40`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${lifecycleDot(m.lifecycle)}`} />
                    <span className="flex-1 font-medium truncate">{m.name}</span>
                    {m.efficiency_pct != null && <span className="opacity-60">η{Number(m.efficiency_pct).toFixed(0)}%</span>}
                    {isSel && <span className="text-on-surface-variant/70 font-bold">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Parameter sliders */}
        <div className="px-3 py-2">
          <p className="text-[9px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Parameters</p>
          {fields.map((field) => (
            <DarkParamRow
              key={field.key}
              field={field}
              stateValue={state[field.key]}
              accent={accent}
              disabled={disabled}
              onChange={(patch) => {
                handler?.((prev) => ({ ...prev, ...patch }));
              }}
            />
          ))}
        </div>
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-slate-700/50 shrink-0">
        <p className="text-[9px] text-on-surface-variant">Changes apply on next simulation run</p>
      </div>
    </div>
  );
}

const nodeTypes = {
  source:     SourceNode,
  absorber:   AbsorberNode,
  stripper:   StripperNode,
  compressor: CompressorNode,
  storage:    StorageNode,
};

// ─────────────────────────────────────────────────────────────────────────────
// Fixed node positions (users can drag to customize)
// ─────────────────────────────────────────────────────────────────────────────
const INITIAL_POSITIONS = {
  source:     { x: 30,   y: 50  },
  absorber:   { x: 330,  y: 250 },
  stripper:   { x: 630,  y: 50  },
  compressor: { x: 930,  y: 250 },
  storage:    { x: 1230, y: 50  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Edge styles for different flow types
// ─────────────────────────────────────────────────────────────────────────────
const flueGasEdge = (id, src, tgt, srcH, tgtH, lbl) => ({
  id, source: src, target: tgt, sourceHandle: srcH, targetHandle: tgtH,
  type: "smoothstep", animated: true,
  style: { stroke: "#9ca3af", strokeWidth: 2.5 },
  label: lbl, labelStyle: { fontSize: 10, fill: "#374151", fontWeight: 600 },
  labelBgStyle: { fill: "#f3f4f6", fillOpacity: 0.9 }, labelBgPadding: [4, 3], labelBgBorderRadius: 4,
  markerEnd: { type: MarkerType.ArrowClosed, color: "#9ca3af", width: 16, height: 16 },
});

const richSolventEdge = (id, src, tgt, srcH, tgtH, lbl) => ({
  id, source: src, target: tgt, sourceHandle: srcH, targetHandle: tgtH,
  type: "smoothstep", animated: true,
  style: { stroke: "#6b7280", strokeWidth: 2.5 },
  label: lbl, labelStyle: { fontSize: 10, fill: "#1f2937", fontWeight: 600 },
  labelBgStyle: { fill: "#e5e7eb", fillOpacity: 0.9 }, labelBgPadding: [4, 3], labelBgBorderRadius: 4,
  markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280", width: 16, height: 16 },
});

const pureCO2Edge = (id, src, tgt, srcH, tgtH, lbl) => ({
  id, source: src, target: tgt, sourceHandle: srcH, targetHandle: tgtH,
  type: "smoothstep", animated: true,
  style: { stroke: "#4b5563", strokeWidth: 2.5 },
  label: lbl, labelStyle: { fontSize: 10, fill: "#111827", fontWeight: 600 },
  labelBgStyle: { fill: "#d1d5db", fillOpacity: 0.9 }, labelBgPadding: [4, 3], labelBgBorderRadius: 4,
  markerEnd: { type: MarkerType.ArrowClosed, color: "#4b5563", width: 16, height: 16 },
});

const compressedCO2Edge = (id, src, tgt, srcH, tgtH, lbl) => ({
  id, source: src, target: tgt, sourceHandle: srcH, targetHandle: tgtH,
  type: "smoothstep", animated: true,
  style: { stroke: "#374151", strokeWidth: 3 },
  label: lbl, labelStyle: { fontSize: 10, fill: "#111827", fontWeight: 600 },
  labelBgStyle: { fill: "#e5e7eb", fillOpacity: 0.9 }, labelBgPadding: [4, 3], labelBgBorderRadius: 4,
  markerEnd: { type: MarkerType.ArrowClosed, color: "#374151", width: 18, height: 18 },
});

const INITIAL_EDGES = [
  flueGasEdge      ("e-source-absorber",  "source",     "absorber",   "flue-out", "flue-in",  "Flue Gas"),
  richSolventEdge  ("e-absorber-stripper","absorber",   "stripper",   "rich-out", "rich-in",  "Rich Solvent"),
  pureCO2Edge      ("e-stripper-comp",    "stripper",   "compressor", "co2-out",  "co2-in",   "Pure CO₂"),
  compressedCO2Edge("e-comp-storage",     "compressor", "storage",    "hp-out",   "hp-in",    "HP CO₂"),
];

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
export default function CCSFlowDiagram({
  result,
  isRunning,
  onNodeClick,
  ccsModels,
  selectedCcsModels,
  onSelectCcsModel,
  simState,
  // Inline parameter state (new)
  ccsSource = {},
  ccsAbsorber = {},
  ccsStripper = {},
  ccsCompressor = {},
  ccsStorage = {},
  onSourceChange,
  onAbsorberChange,
  onStripperChange,
  onCompressorChange,
  onStorageChange,
}) {
  const [edges, , onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const [activePanel, setActivePanel] = useState(null); // "source"|"absorber"|...
  const [selectedScenario, setSelectedScenario] = useState("custom");
  const [scenarioKey, setScenarioKey] = useState(0); // increments on scenario change to force panel remount

  const disabled = simState === "running" || simState === "queued";

  // Context value — nodes read state here; nodes array never rebuilds during drag.
  const ctxValue = useMemo(
    () => ({ simState, result, models: ccsModels, selectedModels: selectedCcsModels, onSelectModel: onSelectCcsModel }),
    [simState, result, ccsModels, selectedCcsModels, onSelectCcsModel]
  );

  // Edges always flow — opacity only shifts with sim state.
  const liveEdges = useMemo(
    () => edges.map((e) => ({
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

  // Handle node click — open inline panel + notify parent
  const handleNodeClick = useCallback((event, node) => {
    setActivePanel((prev) => prev === node.id ? null : node.id);
    onNodeClick?.(node.id);
  }, [onNodeClick]);

  // Apply a scenario preset to all component params + technology selections
  const handleScenarioChange = useCallback((scenarioId) => {
    setSelectedScenario(scenarioId);
    setScenarioKey((k) => k + 1);
    const sc = CCS_SCENARIOS.find((s) => s.id === scenarioId);
    if (!sc) return;

    // Apply parameter patches
    if (sc.params) {
      onSourceChange?.((p) => ({ ...p, ...sc.params.source }));
      onAbsorberChange?.((p) => ({ ...p, ...sc.params.absorber }));
      onStripperChange?.((p) => ({ ...p, ...sc.params.stripper }));
      onCompressorChange?.((p) => ({ ...p, ...sc.params.compressor }));
      onStorageChange?.((p) => ({ ...p, ...sc.params.storage }));
    }

    // Apply technology model selections
    if (sc.models) {
      const SLOTS = ["source", "absorber", "stripper", "compressor", "storage"];
      SLOTS.forEach((slot) => {
        const modelId = sc.models[slot];
        if (!modelId || !ccsModels?.[slot]) return;
        const match = ccsModels[slot].find((m) => m.id === modelId);
        if (match) onSelectCcsModel?.(slot, match);
      });
    }
  }, [onSourceChange, onAbsorberChange, onStripperChange, onCompressorChange, onStorageChange, onSelectCcsModel, ccsModels]);

  return (
    <DiagramCtx.Provider value={ctxValue}>
    <div className="w-full rounded-2xl overflow-hidden border border-outline-variant/20 shadow-sm">
      {/* ── Top bar: scenario dropdown + flow legend ─────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 bg-surface-container border-b border-outline-variant/20 text-[11px]">
        <ScenarioDropdown
          selectedId={selectedScenario}
          onChange={handleScenarioChange}
          disabled={disabled}
        />
        <span className="w-px h-4 bg-outline-variant/40 shrink-0" />
        <span className="flex items-center gap-1.5 text-on-surface-variant">
          <span className="inline-block w-5 h-0.5 border-t-2 border-on-surface-variant/60" style={{ borderStyle: "dashed" }} />
          Flue Gas
        </span>
        <span className="flex items-center gap-1.5 text-on-surface-variant">
          <span className="inline-block w-5 h-0.5 border-t-2 border-on-surface-variant/45" style={{ borderStyle: "dashed" }} />
          Rich Solvent
        </span>
        <span className="flex items-center gap-1.5 text-on-surface-variant">
          <span className="inline-block w-5 h-0.5 border-t-2 border-on-surface-variant/30" style={{ borderStyle: "dashed" }} />
          Pure CO₂
        </span>
        <span className="flex items-center gap-1.5 text-on-surface-variant">
          <span className="inline-block w-5 h-0.5 bg-on-surface-variant/70 rounded" />
          Compressed CO₂
        </span>
        <span className="flex items-center gap-2 text-on-surface-variant">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary" />Commercial</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-secondary" />Demo</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-tertiary" />Projection</span>
        </span>
        <span className="ml-auto text-on-surface-variant/70 italic hidden lg:block">
          Drag · zoom · click a node to open analysis
        </span>
      </div>

      {/* ── Body: flow canvas (full width) ─────────────────────────────── */}
      <div style={{ height: 500 }}>
        <ReactFlow
          defaultNodes={Object.entries(INITIAL_POSITIONS).map(([id, position]) => ({
            id, type: id, position, data: {},
          }))}
          edges={liveEdges}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          onNodeClick={handleNodeClick}
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
            nodeColor={(n) => {
              if (n.type === "source") return "#943700";
              if (n.type === "absorber") return "#4d4b9e";
              if (n.type === "stripper") return "#5b5d72";
              if (n.type === "compressor") return "#6f7dd6";
              if (n.type === "storage") return "#737686";
              return "#737686";
            }}
            position="bottom-left"
            style={{
              background: "#eceef0",
              border: "1px solid #c3c6d7",
              borderRadius: "8px",
            }}
            maskColor="rgba(120,124,140,0.15)"
          />
        </ReactFlow>
      </div>
    </div>

    {/* ── H2NodeModal portals — one per CCS component slot ─────────────── */}
    {activePanel === "source" && (
      <H2NodeModal
        open={true}
        onClose={() => setActivePanel(null)}
        title={selectedCcsModels?.source?.name ?? "Flue Gas Source"}
        subtitle="Emission source configuration"
        icon={<FiZap size={20} />}
        accentColor="bg-surface-container0"
      >
        <CCSSourcePanel
          key={`source-${scenarioKey}`}
          selectedModel={selectedCcsModels?.source}
          savedParams={ccsSource}
          result={result}
          simState={simState}
          onParamsChange={onSourceChange}
        />
      </H2NodeModal>
    )}
    {activePanel === "absorber" && (
      <H2NodeModal
        open={true}
        onClose={() => setActivePanel(null)}
        title={selectedCcsModels?.absorber?.name ?? "CO\u2082 Absorber"}
        subtitle="Post-combustion solvent capture"
        icon={<FiDroplet size={20} />}
        accentColor="bg-primary"
      >
        <CCSAbsorberPanel
          key={`absorber-${scenarioKey}`}
          selectedModel={selectedCcsModels?.absorber}
          savedParams={ccsAbsorber}
          sourceParams={ccsSource}
          result={result}
          simState={simState}
          onParamsChange={onAbsorberChange}
        />
      </H2NodeModal>
    )}
    {activePanel === "stripper" && (
      <H2NodeModal
        open={true}
        onClose={() => setActivePanel(null)}
        title={selectedCcsModels?.stripper?.name ?? "Stripper / Regenerator"}
        subtitle="Solvent regeneration & CO\u2082 release"
        icon={<FiWind size={20} />}
        accentColor="bg-gray-600"
      >
        <CCSStripperPanel
          key={`stripper-${scenarioKey}`}
          selectedModel={selectedCcsModels?.stripper}
          savedParams={ccsStripper}
          absorberParams={ccsAbsorber}
          result={result}
          simState={simState}
          onParamsChange={onStripperChange}
        />
      </H2NodeModal>
    )}
    {activePanel === "compressor" && (
      <H2NodeModal
        open={true}
        onClose={() => setActivePanel(null)}
        title={selectedCcsModels?.compressor?.name ?? "CO\u2082 Compressor"}
        subtitle="Compression to pipeline pressure"
        icon={<FiBox size={20} />}
        accentColor="bg-surface-container0"
      >
        <CCSCompressorPanel
          key={`compressor-${scenarioKey}`}
          selectedModel={selectedCcsModels?.compressor}
          savedParams={ccsCompressor}
          stripperParams={ccsStripper}
          result={result}
          simState={simState}
          onParamsChange={onCompressorChange}
        />
      </H2NodeModal>
    )}
    {activePanel === "storage" && (
      <H2NodeModal
        open={true}
        onClose={() => setActivePanel(null)}
        title={selectedCcsModels?.storage?.name ?? "CO\u2082 Storage"}
        subtitle="Geological CO\u2082 sequestration"
        icon={<FiDatabase size={20} />}
        accentColor="bg-primary"
      >
        <CCSStoragePanel
          key={`storage-${scenarioKey}`}
          selectedModel={selectedCcsModels?.storage}
          savedParams={ccsStorage}
          sourceParams={ccsSource}
          result={result}
          simState={simState}
          onParamsChange={onStorageChange}
        />
      </H2NodeModal>
    )}
    </DiagramCtx.Provider>
  );
}

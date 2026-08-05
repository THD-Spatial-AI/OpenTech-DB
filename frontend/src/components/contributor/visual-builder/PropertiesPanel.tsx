/**
 * visual-builder/PropertiesPanel.tsx
 * ─────────────────────────────────────
 * Right-side properties panel.  Updates reactively based on the currently
 * selected node in the Zustand store.
 *
 * Responsibilities
 * ────────────────
 * 1. Taxonomy fields — technology name, domain, OEO class, description,
 *    reference source.  Dropdowns are seeded exclusively from OntologySchema.
 * 2. Carrier port editor — add/remove/change input and output carriers.
 * 3. Technical — efficiency %, CO₂ factor, lifetime.
 * 4. Cost calculation — delegates to CostCalculatorWizard; applies results
 *    back to the node.
 * 5. Submission — useActionState form action that marshals node data into
 *    CreateTechnologyPayload and calls POST /api/v1/technologies.
 *
 * Validation
 * ──────────
 * Zod schema validates node data before submission.  Errors are shown
 * inline next to each field.
 */

import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod/v4";
import {
  useTechBuilderStore,
  CARRIER_COLORS,
  getCarrierFieldConfig,
  type TechNodeData,
  type CarrierNodeData,
  type CarrierPort,
} from "./useTechBuilderStore";
import CostCalculatorWizard from "./CostCalculatorWizard";
import { submitTechnology } from "../../../services/api";
import type { OntologySchema } from "../../../types/api";
import {
  getArchetypeForOeoClass,
  getDefaultValues,
  type ArchetypeSchema,
  type DerivedBadge,
} from "../../../lib/archetypeSchemas";

// ── Zod validation schema ─────────────────────────────────────────────────────

const nodeSubmitSchema = z.object({
  technology_name:  z.string().min(3, "Name must be ≥ 3 characters"),
  domain:           z.string().min(1, "Select a domain"),
  carrier:          z.string().min(1, "Select a primary carrier"),
  oeo_class:        z.string().min(1, "Select an OEO class"),
  description:      z.string().min(10, "Description must be ≥ 10 characters"),
  instances: z.array(
    z.object({
      variant_name:                            z.string().min(1),
      capex_usd_per_kw:                        z.number().min(0),
      opex_fixed_usd_per_kw_yr:               z.number().min(0),
      opex_var_usd_per_mwh:                   z.number().min(0),
      efficiency_percent:                      z.number().min(0),
      lifetime_years:                          z.number().int().min(1),
      co2_emission_factor_operational_g_per_kwh: z.number().min(0),
      reference_source:                        z.string().min(1, "Reference source required"),
    })
  ).min(1),
});

// ── Sub-components ────────────────────────────────────────────────────────────

/** Section accordion used throughout the panel. */
function PanelSection({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-outline-variant/15 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-surface-container/50 transition-colors text-left"
      >
        <span className="material-symbols-outlined text-[15px] text-primary">{icon}</span>
        <span className="text-[11px] font-bold text-on-surface uppercase tracking-wider flex-1">
          {title}
        </span>
        <span
          className={`material-symbols-outlined text-[14px] text-on-surface-variant/40 transition-transform ${open ? "" : "-rotate-90"}`}
        >
          expand_more
        </span>
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

/** Styled controlled select seeded from an ontology list. */
function OntologySelect({
  label,
  value,
  options,
  onChange,
  error,
  placeholder = "— select —",
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`
          w-full text-xs bg-surface-container border rounded-lg px-3 py-2 text-on-surface
          focus:outline-none focus:ring-2 focus:ring-primary/30
          ${error ? "border-red-400" : "border-outline-variant/30"}
        `}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt.includes("/") ? opt.split("/").pop() : opt.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      {error && <p className="text-[10px] text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

/** Carrier port row with change + delete. */
function CarrierPortRow({
  port,
  carriers,
  onCarrierChange,
  onRemove,
}: {
  port: CarrierPort;
  carriers: string[];
  onCarrierChange: (id: string, carrier: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ background: CARRIER_COLORS[port.carrier] ?? "#6366f1" }}
      />
      <select
        value={port.carrier}
        onChange={(e) => onCarrierChange(port.id, e.target.value)}
        className="flex-1 text-xs bg-surface-container border border-outline-variant/20 rounded-lg px-2 py-1.5 text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30"
      >
        {carriers.map((c) => (
          <option key={c} value={c}>
            {c.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onRemove(port.id)}
        className="text-on-surface-variant/40 hover:text-red-500 transition-colors"
        aria-label="Remove port"
      >
        <span className="material-symbols-outlined text-[14px]">delete</span>
      </button>
    </div>
  );
}

// ── Carrier properties panel ──────────────────────────────────────────────────────────

function CarrierPropertiesContent({
  nodeId,
  data,
}: {
  nodeId: string;
  data: CarrierNodeData;
}) {
  const updateCarrierNode = useTechBuilderStore((s) => s.updateCarrierNode);
  const updateNodeData    = useTechBuilderStore((s) => s.updateNodeData);
  const storeNodes        = useTechBuilderStore((s) => s.nodes);
  const storeEdges        = useTechBuilderStore((s) => s.edges);
  const color   = CARRIER_COLORS[data.carrier] ?? "#6366f1";
  const isInput = data.direction === "input";

  const update = useCallback(
    (patch: Partial<CarrierNodeData>) => updateCarrierNode(nodeId, patch),
    [nodeId, updateCarrierNode]
  );

  // ── Find connected tech node + archetype ────────────────────────────────────
  const techNodeId = useMemo(() => {
    // Input carrier: edge goes carrier→tech (source=carrier, target=tech)
    // Output carrier: edge goes tech→carrier (source=tech, target=carrier)
    return isInput
      ? storeEdges.find((e) => e.source === nodeId)?.target ?? null
      : storeEdges.find((e) => e.target === nodeId)?.source ?? null;
  }, [nodeId, isInput, storeEdges]);

  const techData = useMemo(() => {
    if (!techNodeId) return null;
    const n = storeNodes.find((n) => n.id === techNodeId && n.type === "techNode");
    return n ? (n.data as unknown as TechNodeData) : null;
  }, [techNodeId, storeNodes]);

  const archetype = useMemo(
    () => (techData?.oeoClass ? getArchetypeForOeoClass(techData.oeoClass) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [techData?.oeoClass]
  );

  // ── Write an archetype input value to the connected tech node ───────────────
  const updateArchInput = useCallback(
    (id: string, val: number) => {
      if (!techNodeId || !techData || !archetype) return;
      const newInputValues = { ...(techData.archetypeInputValues ?? {}), [id]: val };
      const effectiveValues = { ...getDefaultValues(archetype), ...newInputValues };
      const derived = archetype.derive(effectiveValues);
      updateNodeData(techNodeId, {
        archetypeInputValues: newInputValues,
        efficiencyPercent:    derived.efficiencyPercent,
        co2FactorGPerKwh:     derived.co2FactorGPerKwh,
      });
    },
    [techNodeId, techData, archetype, updateNodeData]
  );

  // ── Derived output flow for OUTPUT carrier panels ───────────────────────────
  const derivedOutputKw = useMemo(() => {
    if (isInput || !archetype || !techData || !techNodeId) return null;
    const inputEdges = storeEdges.filter((e) => e.target === techNodeId);
    let inputFlowKw = 0;
    inputEdges.forEach((e) => {
      const n = storeNodes.find((x) => x.id === e.source && x.type === "carrierNode");
      if (n) inputFlowKw += ((n.data as unknown as CarrierNodeData).flowRateKw) || 0;
    });
    if (inputFlowKw <= 0) return null;
    const effectiveValues = { ...getDefaultValues(archetype), ...(techData.archetypeInputValues ?? {}) };
    const outputFlows = archetype.deriveOutputFlowKw(inputFlowKw, effectiveValues);
    return outputFlows[data.carrier] ?? null;
  }, [isInput, archetype, techData, techNodeId, storeEdges, storeNodes, data.carrier]);

  // ── Sync derived flow back to the carrier node so the canvas card shows it ──
  useEffect(() => {
    if (!isInput && derivedOutputKw != null && derivedOutputKw !== data.flowRateKw) {
      update({ flowRateKw: derivedOutputKw });
    }
  }, [derivedOutputKw, isInput]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-outline-variant/15 flex-shrink-0 flex items-center gap-2">
        <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: color }} />
        <h2 className="text-sm font-bold text-on-surface flex-1 min-w-0 truncate capitalize">
          {data.carrier.replace(/_/g, " ")}
        </h2>
        <span
          className="text-[9px] font-bold px-2 py-0.5 rounded-full text-white flex-shrink-0"
          style={{ background: color }}
        >
          {isInput ? "INPUT" : "OUTPUT"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* ── Archetype-aware: INPUT physics inputs ──────────────────────────── */}
        {archetype && isInput && (
          <div className="rounded-lg bg-primary/5 border border-primary/15 p-3 space-y-3">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px] text-primary">{archetype.icon}</span>
              <p className="text-[10px] font-bold text-primary uppercase tracking-wider">
                {archetype.label} — Physics Inputs
              </p>
            </div>

            {/* Primary flow rate — renamed per archetype */}
            <div>
              <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
                {archetype.inputCarrierFlowLabel}
                <span className="ml-1 font-normal text-on-surface-variant/50">({archetype.inputCarrierFlowUnit})</span>
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={data.flowRateKw || ""}
                onChange={(e) => update({ flowRateKw: parseFloat(e.target.value) || 0 })}
                className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="e.g. 1000"
              />
            </div>

            {/* Carrier-level physics fields (e.g. tSourceC for heat pump) */}
            {archetype.inputCarrierFields?.map((field) => {
              const currentVal = Number((techData?.archetypeInputValues ?? {})[field.id] ?? field.defaultValue);
              const dp = field.step >= 1 ? 0 : 1;
              return (
                <div key={field.id}>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="flex items-center text-[10px] font-semibold text-on-surface-variant">
                      {field.label}
                      {field.tooltip && <InfoTooltip text={field.tooltip} />}
                    </span>
                    <span className="text-[11px] font-bold tabular-nums text-primary">
                      {currentVal.toFixed(dp)}&nbsp;{field.unit}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={currentVal}
                    onChange={(e) => updateArchInput(field.id, parseFloat(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[9px] text-on-surface-variant/40 mt-0.5">
                    <span>{field.min}&nbsp;{field.unit}</span>
                    <span>{field.max}&nbsp;{field.unit}</span>
                  </div>
                  {field.presets && field.presets.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {field.presets.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => updateArchInput(field.id, preset.value)}
                          className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                            Math.abs(currentVal - preset.value) < field.step / 2
                              ? "bg-primary text-white border-primary"
                              : "bg-surface-container border-outline-variant/30 text-on-surface-variant hover:border-primary/50 hover:text-primary"
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {field.description && (
                    <p className="text-[9px] text-on-surface-variant/50 mt-0.5 leading-relaxed">{field.description}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Archetype-aware: OUTPUT derived flow ───────────────────────────── */}
        {archetype && !isInput && (
          <div className={`rounded-lg border p-3 space-y-2 ${
            derivedOutputKw != null
              ? "bg-emerald-50 border-emerald-200"
              : "bg-surface-container border-outline-variant/20"
          }`}>
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px] text-emerald-600">functions</span>
              <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                Derived Output — {archetype.label}
              </p>
            </div>
            {derivedOutputKw != null ? (
              <div>
                <p className="text-lg font-bold text-emerald-900 tabular-nums">
                  {derivedOutputKw.toFixed(1)}
                  <span className="text-sm font-normal text-emerald-700 ml-1">kW</span>
                </p>
                <p className="text-[9px] text-emerald-700 mt-0.5">
                  {data.carrier.replace(/_/g, " ")} output — derived from input × conversion
                </p>
              </div>
            ) : (
              <p className="text-[9px] text-on-surface-variant/50 leading-relaxed">
                Set the input carrier <strong>flow rate</strong> to see derived output.
              </p>
            )}
          </div>
        )}

        {/* ── Generic flow rate (hidden for archetype input carriers — shown above) ── */}
        {(!archetype || !isInput) && (
          <div>
            <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
              Nominal Flow Rate (kW)
            </label>
            <input
              type="number"
              min={0}
              step={1}
              value={data.flowRateKw || ""}
              onChange={(e) => update({ flowRateKw: parseFloat(e.target.value) || 0 })}
              className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="e.g. 5000"
            />
            <p className="text-[10px] text-on-surface-variant/50 mt-0.5">
              Nominal power through this carrier link at rated conditions
            </p>
          </div>
        )}

        {/* ── Config-driven stream properties ────────────────────────────────── */}
        {(() => {
          const cfg = getCarrierFieldConfig(data.carrier);
          return (
            <>
              {cfg.showTemperature && (
                <div>
                  <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
                    {cfg.temperatureLabel ?? "Temperature (°C)"}
                  </label>
                  <input
                    type="number"
                    step={1}
                    value={data.temperatureC ?? ""}
                    onChange={(e) =>
                      update({ temperatureC: e.target.value === "" ? null : parseFloat(e.target.value) })
                    }
                    className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="e.g. 120"
                  />
                  {cfg.temperatureHint && (
                    <p className="text-[9px] text-on-surface-variant/50 mt-0.5 leading-relaxed">{cfg.temperatureHint}</p>
                  )}
                </div>
              )}

              {cfg.showPressure && (
                <div>
                  <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
                    {cfg.pressureLabel ?? "Pressure (bar)"}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={data.pressureBar ?? ""}
                    onChange={(e) =>
                      update({ pressureBar: e.target.value === "" ? null : parseFloat(e.target.value) })
                    }
                    className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="e.g. 30"
                  />
                  {cfg.pressureHint && (
                    <p className="text-[9px] text-on-surface-variant/50 mt-0.5 leading-relaxed">{cfg.pressureHint}</p>
                  )}
                </div>
              )}

              {cfg.showQualityNote && (
                <div>
                  <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
                    {cfg.qualityLabel ?? "Quality Note"}
                  </label>
                  <textarea
                    rows={3}
                    value={data.qualityNote}
                    onChange={(e) => update({ qualityNote: e.target.value })}
                    className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                    placeholder={cfg.qualityHint ?? "e.g. purity, grade, specification…"}
                  />
                  {cfg.qualityHint && (
                    <p className="text-[9px] text-on-surface-variant/50 mt-0.5 leading-relaxed">{cfg.qualityHint}</p>
                  )}
                </div>
              )}

              {/* ── Solid-fuel properties ───────────────────────────────── */}
              {cfg.showMoisture && (
                <div>
                  <div className="flex justify-between items-baseline mb-1">
                    <label className="text-[10px] font-semibold text-on-surface-variant">
                      Moisture Content (%)
                    </label>
                    <span className="text-[11px] font-bold tabular-nums text-primary">
                      {(data.moisturePercent ?? 30).toFixed(0)} %
                    </span>
                  </div>
                  <input
                    type="range" min={5} max={60} step={1}
                    value={data.moisturePercent ?? 30}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      update({ moisturePercent: val });
                      updateArchInput("moisturePercent", val);
                    }}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[9px] text-on-surface-variant/40 mt-0.5">
                    <span>5 % (pellets)</span><span>60 % (green chips)</span>
                  </div>
                  <p className="text-[9px] text-on-surface-variant/50 mt-0.5 leading-relaxed">
                    Every 10 pp extra moisture ≈ −1.5 MJ/kg LHV and +15 % transport cost per MWh.
                  </p>
                </div>
              )}
              {cfg.showLhv && (
                <div>
                  <div className="flex justify-between items-baseline mb-1">
                    <label className="text-[10px] font-semibold text-on-surface-variant">
                      LHV as-received (MJ/kg)
                    </label>
                    <span className="text-[11px] font-bold tabular-nums text-primary">
                      {(data.lhvMJPerKg ?? 12).toFixed(1)} MJ/kg
                    </span>
                  </div>
                  <input
                    type="range" min={6} max={34} step={0.5}
                    value={data.lhvMJPerKg ?? 12}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      update({ lhvMJPerKg: val });
                      updateArchInput("lhvMJPerKg", val);
                    }}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[9px] text-on-surface-variant/40 mt-0.5">
                    <span>6 (wet MSW)</span><span>34 (dry coal)</span>
                  </div>
                  <p className="text-[9px] text-on-surface-variant/50 mt-0.5 leading-relaxed">
                    Wood chips ~12, pellets ~17, straw ~14, bituminous coal ~26 MJ/kg.
                  </p>
                </div>
              )}
              {cfg.showAsh && (
                <div>
                  <div className="flex justify-between items-baseline mb-1">
                    <label className="text-[10px] font-semibold text-on-surface-variant">
                      Ash Content (%)
                    </label>
                    <span className="text-[11px] font-bold tabular-nums text-primary">
                      {(data.ashPercent ?? 2).toFixed(1)} %
                    </span>
                  </div>
                  <input
                    type="range" min={0} max={25} step={0.5}
                    value={data.ashPercent ?? 2}
                    onChange={(e) => update({ ashPercent: parseFloat(e.target.value) })}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[9px] text-on-surface-variant/40 mt-0.5">
                    <span>0 % (clean pellets)</span><span>25 % (lignite / MSW)</span>
                  </div>
                  <p className="text-[9px] text-on-surface-variant/50 mt-0.5 leading-relaxed">
                    High ash → grate fouling, slag removal cost, and fly-ash disposal requirement.
                  </p>
                </div>
              )}

              {/* ── Gas composition ─────────────────────────────────────── */}
              {cfg.showCh4Percent && (
                <div>
                  <div className="flex justify-between items-baseline mb-1">
                    <label className="text-[10px] font-semibold text-on-surface-variant">
                      CH₄ Content (vol-%)
                    </label>
                    <span className="text-[11px] font-bold tabular-nums text-primary">
                      {(data.ch4Percent ?? 60).toFixed(0)} vol-%
                    </span>
                  </div>
                  <input
                    type="range" min={40} max={99} step={1}
                    value={data.ch4Percent ?? 60}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      update({ ch4Percent: val });
                      updateArchInput("ch4Percent", val);
                    }}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[9px] text-on-surface-variant/40 mt-0.5">
                    <span>40 % (raw landfill gas)</span><span>99 % (biomethane)</span>
                  </div>
                  <p className="text-[9px] text-on-surface-variant/50 mt-0.5 leading-relaxed">
                    Raw biogas: 50–65 %. After upgrading (pressure swing / membranes): &gt; 97 %.
                  </p>
                </div>
              )}
              {cfg.showH2sPpm && (
                <div>
                  <div className="flex justify-between items-baseline mb-1">
                    <label className="text-[10px] font-semibold text-on-surface-variant">
                      H₂S Concentration (ppm)
                    </label>
                    <span className="text-[11px] font-bold tabular-nums text-primary">
                      {(data.h2sPpm ?? 300)} ppm
                      {(data.h2sPpm ?? 300) > 500 && (
                        <span className="ml-1 text-[9px] font-normal text-amber-600">⚠ scrubbing required</span>
                      )}
                    </span>
                  </div>
                  <input
                    type="range" min={0} max={5000} step={50}
                    value={data.h2sPpm ?? 300}
                    onChange={(e) => update({ h2sPpm: parseFloat(e.target.value) })}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[9px] text-on-surface-variant/40 mt-0.5">
                    <span>0 (scrubbed)</span><span>5 000 ppm (pig manure)</span>
                  </div>
                  <p className="text-[9px] text-on-surface-variant/50 mt-0.5 leading-relaxed">
                    Engines tolerate &lt; 200 ppm; fuel cells &lt; 1 ppm. H₂S scrubbing required above 500 ppm.
                  </p>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </>
  );
}

// ── Archetype Physics Section ────────────────────────────────────────────────
// Rendered in place of the flat "Technical Parameters" section whenever the
// selected node's OEO class is covered by a known physics archetype.

const BADGE_ACCENT_CLASSES: Record<string, { bg: string; border: string; label: string; value: string; unit: string }> = {
  green: { bg: "bg-emerald-50",  border: "border-emerald-200", label: "text-emerald-700", value: "text-emerald-900", unit: "text-emerald-600" },
  blue:  { bg: "bg-blue-50",     border: "border-blue-200",    label: "text-blue-700",    value: "text-blue-900",    unit: "text-blue-600" },
  amber: { bg: "bg-amber-50",    border: "border-amber-200",   label: "text-amber-700",   value: "text-amber-900",   unit: "text-amber-600" },
};

function DerivedBadgeChip({ badge }: { badge: DerivedBadge }) {
  const accent = BADGE_ACCENT_CLASSES[badge.accent ?? "green"];
  return (
    <div
      className={`flex flex-col items-center ${accent.bg} border ${accent.border} rounded-lg px-3 py-2 min-w-[76px]`}
      title={badge.description}
    >
      <span className={`text-[9px] font-bold ${accent.label} uppercase tracking-wider`}>
        {badge.label}
      </span>
      <span className={`text-sm font-bold ${accent.value} tabular-nums leading-tight`}>
        {badge.value}
      </span>
      {badge.unit && (
        <span className={`text-[8px] ${accent.unit} text-center leading-tight`}>{badge.unit}</span>
      )}
    </div>
  );
}

// ── Info tooltip helper ────────────────────────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center ml-1">
      <span className="material-symbols-outlined text-[12px] text-on-surface-variant/35 hover:text-primary cursor-help select-none">
        info
      </span>
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-50 w-60 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <span className="block bg-surface-container-highest border border-outline-variant/30 shadow-xl rounded-lg px-2.5 py-2 text-[9px] text-on-surface leading-relaxed text-left whitespace-normal">
          {text}
        </span>
      </span>
    </span>
  );
}

function ArchetypePhysicsSection({
  nodeId,
  data,
  archetype,
  update,
}: {
  nodeId: string;
  data: TechNodeData;
  archetype: ArchetypeSchema;
  update: (patch: Partial<TechNodeData>) => void;
}) {
  // Physics inputs live in archetypeInputValues on the Zustand node
  // so carrier panels can read/write the same values (e.g. tSourceC).
  const storeNodes        = useTechBuilderStore((s) => s.nodes);
  const storeEdges        = useTechBuilderStore((s) => s.edges);
  const updateCarrierNode = useTechBuilderStore((s) => s.updateCarrierNode);

  const storedValues = useMemo(
    () => (data.archetypeInputValues ?? {}) as Record<string, number | string>,
    [data.archetypeInputValues]
  );
  const defaults = useMemo(() => getDefaultValues(archetype), [archetype]);
  const values   = useMemo(() => ({ ...defaults, ...storedValues }), [defaults, storedValues]);

  // Seed defaults into the store on first mount — merge with any init overrides already set.
  useEffect(() => {
    // Always merge so defaults fill gaps, but init overrides (e.g. operatingMode:backpressure_chp) win.
    update({ archetypeInputValues: { ...defaults, ...storedValues } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const derived = useMemo(() => archetype.derive(values), [archetype, values]);

  // Keep derived technical outputs in sync on the node.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    update({ efficiencyPercent: derived.efficiencyPercent, co2FactorGPerKwh: derived.co2FactorGPerKwh });
  }, [derived.efficiencyPercent, derived.co2FactorGPerKwh]);

  // Push derived output carrier flows to connected output carrier nodes so
  // the canvas cards update live without needing to open each output panel.
  useEffect(() => {
    if (!archetype.deriveOutputFlowKw) return;
    const inputEdges  = storeEdges.filter((e) => e.target === nodeId);
    let inputFlowKw = 0;
    inputEdges.forEach((e) => {
      const n = storeNodes.find((x) => x.id === e.source && x.type === "carrierNode");
      if (n) inputFlowKw += ((n.data as unknown as CarrierNodeData).flowRateKw) || 0;
    });
    if (inputFlowKw <= 0) return;
    const outputFlows = archetype.deriveOutputFlowKw(inputFlowKw, values);
    const outputEdges = storeEdges.filter((e) => e.source === nodeId);
    outputEdges.forEach((e) => {
      const n = storeNodes.find((x) => x.id === e.target && x.type === "carrierNode");
      if (!n) return;
      const cData = n.data as unknown as CarrierNodeData;
      const derived_kw = outputFlows[cData.carrier];
      if (derived_kw !== undefined && derived_kw !== cData.flowRateKw) {
        updateCarrierNode(n.id, { flowRateKw: derived_kw });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived.efficiencyPercent, values, storeEdges, storeNodes]);

  const handleSlider = useCallback((id: string, val: number) => {
    update({ archetypeInputValues: { ...(data.archetypeInputValues ?? {}), [id]: val } });
  }, [data.archetypeInputValues, update]);

  const handleSelect = useCallback((id: string, val: string) => {
    update({ archetypeInputValues: { ...(data.archetypeInputValues ?? {}), [id]: val } });
  }, [data.archetypeInputValues, update]);

  // Decimal places inferred from step size.
  function decimalPlaces(step: number) {
    if (step >= 1) return 0;
    return String(step).split(".")[1]?.length ?? 1;
  }

  return (
    <PanelSection title="Physics Model" icon="calculate" defaultOpen>
      {/* Archetype badge */}
      <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/15 px-3 py-2.5">
        <span className="material-symbols-outlined text-[18px] text-primary flex-shrink-0 mt-0.5">
          {archetype.icon}
        </span>
        <div>
          <p className="text-[11px] font-bold text-primary">{archetype.label}</p>
          <p className="text-[9px] text-on-surface-variant/60 leading-relaxed mt-0.5">
            {archetype.description}
          </p>
        </div>
      </div>

      {/* Select inputs */}
      {archetype.selects?.map((sel) => (
        <div key={sel.id}>
          <label className="flex items-center text-[10px] font-semibold text-on-surface-variant mb-1">
            {sel.label}
            {sel.tooltip && <InfoTooltip text={sel.tooltip} />}
          </label>
          <select
            value={String(values[sel.id] ?? sel.defaultValue)}
            onChange={(e) => handleSelect(sel.id, e.target.value)}
            className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {sel.options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {sel.description && (
            <p className="text-[9px] text-on-surface-variant/50 mt-0.5 leading-relaxed">{sel.description}</p>
          )}
        </div>
      ))}

      {/* Slider inputs */}
      {archetype.sliders.map((slider) => {
        const currentVal = Number(values[slider.id] ?? slider.defaultValue);
        const dp = decimalPlaces(slider.step);
        return (
          <div key={slider.id}>
            <div className="flex justify-between items-baseline mb-1">
              <span className="flex items-center text-[10px] font-semibold text-on-surface-variant">
                {slider.label}
                {slider.tooltip && <InfoTooltip text={slider.tooltip} />}
              </span>
              <span className="text-[11px] font-bold tabular-nums text-primary">
                {currentVal.toFixed(dp)} {slider.unit}
              </span>
            </div>
            <input
              type="range"
              min={slider.min}
              max={slider.max}
              step={slider.step}
              value={currentVal}
              onChange={(e) => handleSlider(slider.id, parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[9px] text-on-surface-variant/40 mt-0.5">
              <span>{slider.min} {slider.unit}</span>
              <span>{slider.max} {slider.unit}</span>
            </div>
            {slider.presets && slider.presets.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {slider.presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handleSlider(slider.id, preset.value)}
                    className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                      Math.abs(currentVal - preset.value) < slider.step / 2
                        ? "bg-primary text-white border-primary"
                        : "bg-surface-container border-outline-variant/30 text-on-surface-variant hover:border-primary/50 hover:text-primary"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
            {slider.description && (
              <p className="text-[9px] text-on-surface-variant/50 mt-0.5 leading-relaxed">{slider.description}</p>
            )}
          </div>
        );
      })}

      {/* Derived output badges */}
      <div>
        <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-2">
          Derived Values
        </p>
        <div className="flex flex-wrap gap-2">
          {derived.badges.map((badge) => (
            <DerivedBadgeChip key={badge.label} badge={badge} />
          ))}
        </div>
      </div>

      {/* Lifetime — always required regardless of archetype */}
      <div>
        <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
          Technical Lifetime (years)
        </label>
        <input
          type="number" min={1} max={100}
          value={data.lifetimeYears}
          onChange={(e) => update({ lifetimeYears: parseInt(e.target.value, 10) || 25 })}
          className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
    </PanelSection>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-6 py-12 text-center">
      <span className="material-symbols-outlined text-5xl text-on-surface-variant/20">
        touch_app
      </span>
      <p className="text-sm font-semibold text-on-surface-variant">
        No node selected
      </p>
      <p className="text-xs text-on-surface-variant/60 leading-relaxed">
        Click a technology node on the canvas, or drag one from the Equipment
        Palette, to edit its properties here.
      </p>
    </div>
  );
}

// ── Submit result type ────────────────────────────────────────────────────────

type SubmitResult =
  | { ok: true; techId: string; techName: string }
  | { ok: false; error: string }
  | null;

// ── Main panel ────────────────────────────────────────────────────────────────

interface PropertiesPanelProps {
  schema: OntologySchema;
  onSubmitSuccess: (technologyName: string) => void;
}

export default function PropertiesPanel({ schema, onSubmitSuccess }: PropertiesPanelProps) {
  const { nodes, selectedNodeId, updateNodeData } = useTechBuilderStore();

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const nodeType = selectedNode?.type ?? null;

  // Resolve archetype schema for the selected tech node (null = no physics model for this OEO class yet).
  const data_preliminary = nodeType === "techNode" ? selectedNode!.data as unknown as TechNodeData : null;
  const archetype: ArchetypeSchema | null = useMemo(
    () => data_preliminary ? getArchetypeForOeoClass(data_preliminary.oeoClass) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data_preliminary?.oeoClass]
  );

  // Type-safe access to data based on node type
  const data         = nodeType === "techNode"    ? selectedNode!.data as unknown as TechNodeData    : null;
  const carrierData  = nodeType === "carrierNode"  ? selectedNode!.data as unknown as CarrierNodeData : null;

  // ── Field update helpers (tech node only) ──────────────────────────────

  const update = useCallback(
    (patch: Partial<TechNodeData>) => {
      if (selectedNodeId) updateNodeData(selectedNodeId, patch);
    },
    [selectedNodeId, updateNodeData]
  );

  const addInputPort = useCallback(() => {
    if (!data) return;
    const id = `${selectedNodeId}-in-${Date.now()}`;
    update({ inputPorts: [...data.inputPorts, { id, carrier: "electricity" }] });
  }, [data, selectedNodeId, update]);

  const addOutputPort = useCallback(() => {
    if (!data) return;
    const id = `${selectedNodeId}-out-${Date.now()}`;
    update({ outputPorts: [...data.outputPorts, { id, carrier: "heat" }] });
  }, [data, selectedNodeId, update]);

  const changeInputCarrier = useCallback(
    (portId: string, carrier: string) => {
      if (!data) return;
      update({
        inputPorts: data.inputPorts.map((p) => (p.id === portId ? { ...p, carrier } : p)),
      });
    },
    [data, update]
  );

  const changeOutputCarrier = useCallback(
    (portId: string, carrier: string) => {
      if (!data) return;
      update({
        outputPorts: data.outputPorts.map((p) =>
          p.id === portId ? { ...p, carrier } : p
        ),
      });
    },
    [data, update]
  );

  const removeInputPort = useCallback(
    (portId: string) => {
      if (!data) return;
      update({ inputPorts: data.inputPorts.filter((p) => p.id !== portId) });
    },
    [data, update]
  );

  const removeOutputPort = useCallback(
    (portId: string) => {
      if (!data) return;
      update({ outputPorts: data.outputPorts.filter((p) => p.id !== portId) });
    },
    [data, update]
  );

  // ── Action-state submission ───────────────────────────────────────────────
  // useActionState wraps the form — we read from the Zustand store snapshot
  // inside the action so the <form> itself has no native inputs.

  const [submitResult, formAction, isPending] = useActionState<SubmitResult, FormData>(
    async (_prev) => {
      const { nodes: currentNodes, selectedNodeId: selId } =
        useTechBuilderStore.getState();
      const node = currentNodes.find((n) => n.id === selId && n.type === "techNode");
      if (!node) return { ok: false, error: "No technology node selected." };

      const d = node.data as unknown as TechNodeData;
      const primaryInputCarrier =
        (d.inputPorts as Array<{carrier: string}>)[0]?.carrier ||
        (d.outputPorts as Array<{carrier: string}>)[0]?.carrier ||
        "electricity";

      const payload = {
        technology_name: d.label,
        domain:          d.domain,
        carrier:         primaryInputCarrier,
        oeo_class:       d.oeoClass,
        description:     d.description,
        instances: [
          {
            variant_name:                             d.variantName,
            capex_usd_per_kw:                         d.capexUsdPerKw,
            opex_fixed_usd_per_kw_yr:                d.opexFixedUsdPerKwYr,
            opex_var_usd_per_mwh:                    d.opexVarUsdPerMwh,
            efficiency_percent:                       d.efficiencyPercent,
            lifetime_years:                           d.lifetimeYears,
            co2_emission_factor_operational_g_per_kwh: d.co2FactorGPerKwh,
            reference_source:                         d.referenceSource,
          },
        ],
      };

      const parsed = nodeSubmitSchema.safeParse(payload);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        return {
          ok: false,
          error: `Validation: ${firstIssue.path.join(".")} — ${firstIssue.message}`,
        };
      }

      try {
        const result = await submitTechnology(parsed.data);
        onSubmitSuccess(result.technology_name);
        return { ok: true, techId: result.id, techName: result.technology_name };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    null
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (!selectedNode) {
    return (
      <aside className="h-full w-[336px] flex-shrink-0 border-l border-outline-variant/20 bg-surface-container-lowest flex flex-col overflow-hidden">
        <div className="px-4 py-3.5 border-b border-outline-variant/15 flex-shrink-0">
          <h2 className="text-sm font-bold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-primary">tune</span>
            Node Properties
          </h2>
        </div>
        <EmptyState />
      </aside>
    );
  }

  // ── Carrier node selected ──────────────────────────────────────────────────────
  if (nodeType === "carrierNode" && carrierData) {
    return (
      <aside className="h-full w-[336px] flex-shrink-0 border-l border-outline-variant/20 bg-surface-container-lowest flex flex-col overflow-hidden">
        <CarrierPropertiesContent nodeId={selectedNodeId!} data={carrierData} />
      </aside>
    );
  }

  // ── Technology node selected ───────────────────────────────────────────────
  if (!data) return null; // should not happen, but guards TypeScript

  return (
    <aside className="h-full w-[336px] flex-shrink-0 border-l border-outline-variant/20 bg-surface-container-lowest flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-outline-variant/15 flex-shrink-0 flex items-center gap-2">
        <span className="material-symbols-outlined text-[16px] text-primary">tune</span>
        <h2 className="text-sm font-bold text-on-surface flex-1 min-w-0 truncate">
          {data!.label}
        </h2>
        <span className="text-[9px] bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full font-semibold border border-outline-variant/20">
          {data.domain}
        </span>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

        {/* ── 1. Identity & Taxonomy ── */}
        <PanelSection title="Identity & Taxonomy" icon="label" defaultOpen>
          {/* Technology Name — locked (comes from OEO catalogue) */}
          <div>
            <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
              Technology Name
              <span className="ml-1 text-[9px] text-on-surface-variant/40 font-normal">(catalogue-defined)</span>
            </label>
            <div className="flex items-center gap-2 w-full text-xs bg-surface-container/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-on-surface">
              <span className="material-symbols-outlined text-[13px] text-on-surface-variant/40">lock</span>
              <span className="flex-1 font-medium">{data!.label}</span>
            </div>
            <p className="text-[10px] text-on-surface-variant/40 mt-0.5 leading-relaxed">
              Fixed by OEO ontology. Use "Variant Label" below for a custom instance name.
            </p>
          </div>

          {/* Variant name */}
          <div>
            <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
              Variant / Instance Label
            </label>
            <input
              type="text"
              value={data.variantName}
              onChange={(e) => update({ variantName: e.target.value })}
              className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="e.g. 2024 Utility-scale reference"
            />
          </div>

          <OntologySelect
            label="Domain"
            value={data.domain}
            options={schema.allowed_domains}
            onChange={(v) => update({ domain: v })}
          />

          <OntologySelect
            label="OEO Class"
            value={data.oeoClass}
            options={schema.allowed_oeo_classes}
            onChange={(v) => update({ oeoClass: v })}
            placeholder="— select OEO class —"
          />

          {/* Reference Source — free-text with datalist suggestions */}
          <div>
            <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
              Reference Source
            </label>
            <input
              list="ref-source-suggestions"
              type="text"
              value={data.referenceSource}
              onChange={(e) => update({ referenceSource: e.target.value })}
              className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="e.g. IRENA Green Hydrogen Cost Reduction 2020"
            />
            <datalist id="ref-source-suggestions">
              {schema.allowed_reference_sources.map((src) => (
                <option key={src} value={src} />
              ))}
            </datalist>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
              Description
            </label>
            <textarea
              rows={3}
              value={data.description}
              onChange={(e) => update({ description: e.target.value })}
              className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              placeholder="Describe the technology, its use case, and any notable characteristics…"
            />
          </div>
        </PanelSection>

        {/* ── 2. Carrier Ports ── */}
        <PanelSection title="Carrier Flows" icon="swap_horiz" defaultOpen>
          {/* Input ports */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">
                Inputs
              </p>
              <button
                type="button"
                onClick={addInputPort}
                className="text-[10px] text-primary hover:text-primary/70 font-semibold flex items-center gap-0.5"
              >
                <span className="material-symbols-outlined text-[13px]">add</span>
                Add
              </button>
            </div>
            <div className="space-y-2">
              {data.inputPorts.map((port) => (
                <CarrierPortRow
                  key={port.id}
                  port={port}
                  carriers={schema.allowed_carriers}
                  onCarrierChange={changeInputCarrier}
                  onRemove={removeInputPort}
                />
              ))}
              {data.inputPorts.length === 0 && (
                <p className="text-[10px] text-on-surface-variant/50 italic">No input carriers</p>
              )}
            </div>
          </div>

          {/* Output ports */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                Outputs
              </p>
              <button
                type="button"
                onClick={addOutputPort}
                className="text-[10px] text-primary hover:text-primary/70 font-semibold flex items-center gap-0.5"
              >
                <span className="material-symbols-outlined text-[13px]">add</span>
                Add
              </button>
            </div>
            <div className="space-y-2">
              {data.outputPorts.map((port) => (
                <CarrierPortRow
                  key={port.id}
                  port={port}
                  carriers={schema.allowed_carriers}
                  onCarrierChange={changeOutputCarrier}
                  onRemove={removeOutputPort}
                />
              ))}
              {data.outputPorts.length === 0 && (
                <p className="text-[10px] text-on-surface-variant/50 italic">No output carriers</p>
              )}
            </div>
          </div>
        </PanelSection>

        {/* ── 3. Technical Parameters ── */}
        {archetype ? (
          // Physics-model section — sliders derive efficiency & CO₂ automatically.
          // key={selectedNodeId} forces remount when the selected node changes,
          // so local physics-input state resets to archetype defaults.
          <ArchetypePhysicsSection
            key={selectedNodeId!}
            nodeId={selectedNodeId!}
            data={data}
            archetype={archetype}
            update={update}
          />
        ) : (
          // Fallback: flat manual fields for techs without a physics model yet.
          <PanelSection title="Technical Parameters" icon="engineering" defaultOpen={false}>
            {/* Efficiency slider */}
            <div>
              <div className="flex justify-between text-[10px] text-on-surface-variant mb-1">
                <span className="font-semibold">Conversion efficiency (η)</span>
                <span className="font-bold tabular-nums">{data.efficiencyPercent}%</span>
              </div>
              <input
                type="range" min={1} max={100} step={1}
                value={data.efficiencyPercent}
                onChange={(e) => update({ efficiencyPercent: parseFloat(e.target.value) })}
                className="w-full accent-primary"
              />
            </div>

            {/* Lifetime */}
            <div>
              <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
                Technical Lifetime (years)
              </label>
              <input
                type="number" min={1} max={100}
                value={data.lifetimeYears}
                onChange={(e) => update({ lifetimeYears: parseInt(e.target.value, 10) || 25 })}
                className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* CO2 factor */}
            <div>
              <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
                CO₂ Emission Factor (g/kWh)
              </label>
              <input
                type="number" min={0} step="any"
                value={data.co2FactorGPerKwh}
                onChange={(e) => update({ co2FactorGPerKwh: parseFloat(e.target.value) || 0 })}
                className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </PanelSection>
        )}

        {/* ── 4. Cost Calculator ── */}
        <PanelSection title="Cost Calculator" icon="calculate" defaultOpen={false}>
          <CostCalculatorWizard
            lifetimeYears={data.lifetimeYears}
            initialCapex={data.capexUsdPerKw}
            initialOpexFixed={data.opexFixedUsdPerKwYr}
            initialOpexVar={data.opexVarUsdPerMwh}
            onApply={(result) => update(result as Partial<TechNodeData>)}
          />
        </PanelSection>

        {/* ── 5. Submission ── */}
        <div className="px-4 py-4 border-t border-outline-variant/15">
          {/* Status feedback */}
          {submitResult?.ok === true && (
            <div className="flex items-start gap-2 rounded-xl bg-green-50 border border-green-200 px-3 py-2.5 mb-3">
              <span className="material-symbols-outlined text-[16px] text-green-600 flex-shrink-0">
                check_circle
              </span>
              <div>
                <p className="text-xs font-bold text-green-800">Submitted for review</p>
                <p className="text-[10px] text-green-700 mt-0.5">
                  {submitResult.techName} — ID: {submitResult.techId}
                </p>
              </div>
            </div>
          )}

          {submitResult?.ok === false && (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 mb-3">
              <span className="material-symbols-outlined text-[16px] text-red-500 flex-shrink-0">
                error
              </span>
              <p className="text-xs text-red-700">{submitResult.error}</p>
            </div>
          )}

          {/* Hidden form — all data comes from Zustand store snapshot in the action */}
          <form action={formAction}>
            <button
              type="submit"
              disabled={isPending}
              className="
                w-full flex items-center justify-center gap-2 py-3
                bg-primary text-on-primary rounded-xl text-sm font-bold
                hover:bg-primary/90 active:scale-[0.98] transition-all
                shadow-md shadow-primary/20
                disabled:opacity-60 disabled:cursor-not-allowed
              "
            >
              {isPending ? (
                <>
                  <span className="material-symbols-outlined text-[16px] animate-spin">autorenew</span>
                  Submitting…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px]">cloud_upload</span>
                  Submit to Database
                </>
              )}
            </button>
          </form>
          <p className="text-[9px] text-on-surface-variant/50 text-center mt-2 leading-relaxed">
            Submissions are reviewed by a data steward before appearing in the public catalogue.
          </p>
        </div>

      </div>
    </aside>
  );
}

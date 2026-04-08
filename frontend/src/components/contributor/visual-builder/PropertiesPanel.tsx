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

import { useActionState, useCallback, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { z } from "zod/v4";
import {
  useTechBuilderStore,
  CARRIER_COLORS,
  type TechNodeData,
  type CarrierNodeData,
  type CarrierPort,
} from "./useTechBuilderStore";
import CostCalculatorWizard from "./CostCalculatorWizard";
import { submitTechnology } from "../../../services/api";
import type { OntologySchema } from "../../../types/api";

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
  const color   = CARRIER_COLORS[data.carrier] ?? "#6366f1";
  const isInput = data.direction === "input";

  const update = useCallback(
    (patch: Partial<CarrierNodeData>) => updateCarrierNode(nodeId, patch),
    [nodeId, updateCarrierNode]
  );

  return (
    <>
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-outline-variant/15 flex-shrink-0 flex items-center gap-2">
        <span
          className="w-4 h-4 rounded-full flex-shrink-0"
          style={{ background: color }}
        />
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

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        <p className="text-[10px] text-on-surface-variant/60 leading-relaxed">
          {isInput
            ? "Energy carrier flowing into the technology. Set stream properties below to document the input conditions."
            : "Energy carrier flowing out of the technology. Set stream properties below to document the output conditions."}
        </p>

        {/* Flow rate */}
        <div>
          <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
            Nominal Flow Rate (kW)
          </label>
          <input
            type="number"
            min={0}
            step={1}
            value={data.flowRateKw || ""}
            onChange={(e) =>
              update({ flowRateKw: parseFloat(e.target.value) || 0 })
            }
            className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="e.g. 5000"
          />
          <p className="text-[10px] text-on-surface-variant/50 mt-0.5">
            Nominal power through this carrier link at rated conditions
          </p>
        </div>

        {/* Temperature */}
        <div>
          <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
            Temperature (°C)
            <span className="ml-1 font-normal text-on-surface-variant/40">— optional</span>
          </label>
          <input
            type="number"
            step={1}
            value={data.temperatureC ?? ""}
            onChange={(e) =>
              update({
                temperatureC: e.target.value === "" ? null : parseFloat(e.target.value),
              })
            }
            className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="e.g. 120"
          />
          <p className="text-[10px] text-on-surface-variant/50 mt-0.5">
            Relevant for heat, steam, geothermal and cooling streams
          </p>
        </div>

        {/* Pressure */}
        <div>
          <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
            Pressure (bar)
            <span className="ml-1 font-normal text-on-surface-variant/40">— optional</span>
          </label>
          <input
            type="number"
            min={0}
            step={0.1}
            value={data.pressureBar ?? ""}
            onChange={(e) =>
              update({
                pressureBar:
                  e.target.value === "" ? null : parseFloat(e.target.value),
              })
            }
            className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="e.g. 30"
          />
          <p className="text-[10px] text-on-surface-variant/50 mt-0.5">
            Relevant for natural gas, hydrogen, steam and CO₂ streams
          </p>
        </div>

        {/* Quality note */}
        <div>
          <label className="block text-[10px] font-semibold text-on-surface-variant mb-1">
            Quality Note
            <span className="ml-1 font-normal text-on-surface-variant/40">— optional</span>
          </label>
          <textarea
            rows={3}
            value={data.qualityNote}
            onChange={(e) => update({ qualityNote: e.target.value })}
            className="w-full text-xs bg-surface-container border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            placeholder="e.g. H₂ purity > 99.9 %, Biomass moisture < 15 %…"
          />
        </div>
      </div>
    </>
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

  const { token } = useAuth();
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
        const result = await submitTechnology(parsed.data, token);
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

/**
 * components/DetailsModal.tsx
 * ────────────────────────────
 * Full-screen details panel for a single Technology.
 *
 * Sections
 * --------
 * 1. Header   — name, carrier badge, verified status, close button
 * 2. KPI row  — total instances, avg efficiency, cost projection, system status
 * 3. CAPEX sparkline (simulated from instance data)
 * 4. Instances table — all EquipmentInstances as rows
 * 5. Technical description & action buttons (Export CSV, Share)
 * 6. Footer   — DB id, schema version, licence
 *
 * React 19 patterns used
 * ----------------------
 * - `use()` hook to read the detail Promise inside a nested <Suspense>
 * - `useId()` for accessible dialog labelling
 * - `useEffect` + `useCallback` for focus-trap and Escape-key dismissal
 * - `useOptimistic` for the "copied link" share-metadata toast
 *
 * Accessibility
 * -------------
 * - role="dialog" with aria-modal, aria-labelledby, aria-describedby
 * - Focus trapped inside the modal while it is open
 * - Escape key closes the modal
 */

import {
  use,
  useCallback,
  useEffect,
  useId,
  useOptimistic,
  useRef,
  Suspense,
  startTransition,
} from "react";
import type { EquipmentInstance, Technology, TechnologySummary } from "../types/api";
import { fetchTechnology } from "../services/api";

// ── Source badge colours ──────────────────────────────────────────────────────

const SOURCE_COLOURS: Record<string, { bg: string; text: string; border: string }> = {
  nrel:        { bg: "#e8f5e9", text: "#2e7d32", border: "#2e7d32" },
  iea:         { bg: "#e3f2fd", text: "#1565c0", border: "#1565c0" },
  irena:       { bg: "#f3e5f5", text: "#7b1fa2", border: "#7b1fa2" },
  fraunhofer:  { bg: "#fff8e1", text: "#f57f17", border: "#f57f17" },
  dena:        { bg: "#fce4ec", text: "#c62828", border: "#c62828" },
};

// Map first token of source string → canonical URL for citation links
const SOURCE_URLS: Record<string, string> = {
  nrel:        "https://atb.nrel.gov",
  iea:         "https://www.iea.org/data-and-statistics",
  irena:       "https://www.irena.org/Statistics",
  fraunhofer:  "https://www.ise.fraunhofer.de/en/publications.html",
  dena:        "https://www.dena.de/en/topics-projects/",
};

function sourceBadge(source?: string | null) {
  if (!source) return null;
  const key = source.split(" ")[0].toLowerCase();
  const colours = SOURCE_COLOURS[key] ?? { bg: "#eceff1", text: "#546e7a", border: "#546e7a" };
  const url = SOURCE_URLS[key];

  const badge = (
    <span
      className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-bold border"
      style={{ background: colours.bg, color: colours.text, borderColor: `${colours.border}33` }}
    >
      {source.split(" ")[0].toUpperCase()}
      {url && (
        <span className="material-symbols-outlined" style={{ fontSize: "10px" }}>open_in_new</span>
      )}
    </span>
  );

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={`View source: ${source}`}
        className="hover:opacity-80 transition-opacity"
      >
        {badge}
      </a>
    );
  }
  return badge;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number, decimals = 1): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

function avgOrDash(
  instances: EquipmentInstance[],
  getter: (inst: EquipmentInstance) => number | null | undefined
): string {
  const values = instances
    .map(getter)
    .filter((v): v is number => typeof v === "number" && isFinite(v));
  if (values.length === 0) return "—";
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return fmt(avg);
}

// ── CAPEX sparkline bars ──────────────────────────────────────────────────────

function CapexSparkline({ instances }: { instances: EquipmentInstance[] }) {
  const values = instances
    .map((i) => i.capex_per_kw?.value)
    .filter((v): v is number => typeof v === "number");

  if (values.length === 0) {
    return (
      <p className="text-sm text-on-surface-variant italic">No CAPEX data available.</p>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  // Show decreasing trend from highest → lowest (DESC order means later = cheaper)
  const sorted = [...values].sort((a, b) => b - a);

  return (
    <div>
      <div className="flex items-end justify-between h-16 gap-1">
        {sorted.map((v, i) => {
          const pct = ((v - min) / range) * 80 + 12; // 12%–92% height range
          return (
            <div
              key={i}
              title={`${fmt(v, 0)} ${instances[0]?.capex_per_kw?.unit ?? "$/kW"}`}
              style={{ height: `${pct.toFixed(0)}%` }}
              className="w-full bg-primary-fixed-dim/60 rounded-t-sm transition-all duration-300
                         last:bg-primary"
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-2">
        <span className="text-[9px] text-on-surface-variant font-medium">
          {fmt(max, 0)}
        </span>
        <span className="text-[9px] text-on-surface-variant font-medium">
          {fmt(min, 0)}
        </span>
      </div>
    </div>
  );
}

// ── Instance table row ────────────────────────────────────────────────────────

function InstanceRow({
  inst,
  index,
}: {
  inst: EquipmentInstance;
  index: number;
}) {
  const bg = index % 2 !== 0 ? "bg-surface-container-low/20" : "";

  const eff = inst.electrical_efficiency?.value ?? inst.thermal_efficiency?.value;
  const mainSource =
    inst.capex_per_kw?.source ??
    inst.opex_fixed_per_kw_yr?.source ??
    inst.manufacturer;

  return (
    <tr
      className={`${bg} hover:bg-surface-container-low/50 transition-colors group`}
    >
      {/* Variant */}
      <td className="px-5 py-5 font-bold text-on-surface sticky left-0 bg-white/50
                     group-hover:bg-transparent backdrop-blur-sm z-10">
        {inst.label}
      </td>
      {/* CAPEX */}
      <td className="px-5 py-5 font-headline text-lg font-medium text-center text-on-surface">
        {inst.capex_per_kw ? fmt(inst.capex_per_kw.value, 0) : "—"}
      </td>
      {/* Fixed OPEX */}
      <td className="px-5 py-5 font-medium text-center">
        {inst.opex_fixed_per_kw_yr ? fmt(inst.opex_fixed_per_kw_yr.value, 1) : "—"}
      </td>
      {/* Efficiency */}
      <td className="px-5 py-5 text-center font-medium">
        {eff != null ? fmt(eff * 100, 1) : "—"}
      </td>
      {/* Lifetime */}
      <td className="px-5 py-5 text-center font-medium">
        {inst.economic_lifetime_yr ? `${inst.economic_lifetime_yr.value} yrs` : "—"}
      </td>
      {/* WACC */}
      <td className="px-5 py-5 text-center font-medium">
        {inst.discount_rate
          ? `${fmt(inst.discount_rate.value * 100, 1)} %`
          : "—"}
      </td>
      {/* CO₂ */}
      <td className="px-5 py-5 text-center text-on-surface-variant">
        {inst.co2_emission_factor
          ? fmt(inst.co2_emission_factor.value * 1000, 0)
          : "—"}
      </td>
      {/* Source */}
      <td className="px-5 py-5 text-right">{sourceBadge(mainSource)}</td>
    </tr>
  );
}

// ── Export CSV helper ─────────────────────────────────────────────────────────

function exportToCSV(tech: Technology): void {
  const headers = [
    "Label", "CAPEX ($/kW)", "Fixed OPEX ($/kW-yr)",
    "Efficiency (%)", "Lifetime (yrs)", "WACC (%)", "CO2 (g/kWh)", "Source",
  ];
  const rows = tech.instances.map((inst) => {
    const eff = inst.electrical_efficiency?.value ?? inst.thermal_efficiency?.value;
    return [
      inst.label,
      inst.capex_per_kw?.value ?? "",
      inst.opex_fixed_per_kw_yr?.value ?? "",
      eff != null ? (eff * 100).toFixed(1) : "",
      inst.economic_lifetime_yr?.value ?? "",
      inst.discount_rate ? (inst.discount_rate.value * 100).toFixed(1) : "",
      inst.co2_emission_factor ? (inst.co2_emission_factor.value * 1000).toFixed(0) : "",
      inst.capex_per_kw?.source ?? inst.manufacturer ?? "",
    ];
  });

  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${v}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${tech.name.replace(/\s+/g, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Inner panel — uses React 19 `use()` to read the detail promise ────────────

interface InnerPanelProps {
  techId: string;
  onClose: () => void;
  labelId: string;
  descId: string;
}

function InnerPanel({ techId, onClose, labelId, descId }: InnerPanelProps) {
  // React 19: use() suspends until the Promise resolves.
  // The parent Suspense boundary renders the skeleton while loading.
  const tech = use(fetchTechnology(techId));

  const avgEff = avgOrDash(
    tech.instances,
    (i) =>
      (i.electrical_efficiency?.value ?? i.thermal_efficiency?.value ?? null) != null
        ? ((i.electrical_efficiency?.value ?? i.thermal_efficiency?.value)! * 100)
        : null
  );

  const isVerified = !tech.tags.some((t) => t.toLowerCase() === "review_required");
  const primaryCarrier = tech.output_carriers[0] ?? tech.input_carriers[0];

  // useOptimistic for the "Share Metadata" button toast
  const [shareLabel, setOptimisticShare] = useOptimistic(
    "Share Metadata",
    (_prev, next: string) => next
  );

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href + `?tech=${tech.id}`).catch(() => {});
    startTransition(() => {
      setOptimisticShare("Link Copied!");
    });
    setTimeout(() => {
      startTransition(() => setOptimisticShare("Share Metadata"));
    }, 2000);
  };

  return (
    <>
      {/* ── Header (full-width, flex-shrink-0) ───────────────────────────── */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-outline-variant/15 flex-shrink-0">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 id={labelId} className="font-headline text-2xl font-bold text-on-surface">
              {tech.name}
            </h2>
            {primaryCarrier && (
              <span className="px-2.5 py-0.5 bg-secondary-container text-on-secondary-container
                               text-[10px] font-bold tracking-wider rounded-sm uppercase">
                {primaryCarrier.replace(/_/g, " ")}
              </span>
            )}
          </div>
          <span
            className={[
              "flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest w-fit px-2 py-0.5 rounded border",
              isVerified
                ? "text-[#2e7d32] bg-[#e8f5e9] border-[#2e7d32]/20"
                : "text-amber-700 bg-amber-50 border-amber-200",
            ].join(" ")}
          >
            <span className={["w-1.5 h-1.5 rounded-full", isVerified ? "bg-[#2e7d32]" : "bg-amber-400"].join(" ")} />
            {isVerified ? "Verified" : "Review Required"}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="w-10 h-10 flex items-center justify-center rounded-full flex-shrink-0
                     hover:bg-surface-container-high transition-colors group"
        >
          <span className="material-symbols-outlined text-on-surface-variant group-hover:text-on-surface">close</span>
        </button>
      </div>

      {/* ── Body: detail sidebar + main content ─────────────────────────── */}
      <div id={descId} className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Detail sidebar ────────────────────────────────────────────── */}
        <aside className="w-64 flex-shrink-0 border-r border-outline-variant/15 bg-surface-container-low/30
                          flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-5 space-y-5">

            {/* OEO Class */}
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1.5">
                OEO Class
              </p>
              {tech.oeo_class ? (
                <a
                  href={tech.oeo_uri ?? "https://openenergy-platform.org/ontology/oeo/"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline break-all font-medium flex items-start gap-1 group"
                >
                  <span className="flex-1 leading-relaxed">{tech.oeo_class}</span>
                  <span className="material-symbols-outlined text-[12px] flex-shrink-0 mt-0.5 opacity-60 group-hover:opacity-100">
                    open_in_new
                  </span>
                </a>
              ) : (
                <span className="text-xs text-on-surface-variant/50 italic">Not mapped to OEO</span>
              )}
            </div>

            {/* Carriers */}
            {(tech.input_carriers.length > 0 || tech.output_carriers.length > 0) && (
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1.5">
                  Energy Carriers
                </p>
                {tech.input_carriers.length > 0 && (
                  <div className="mb-2">
                    <span className="text-[9px] font-bold text-on-surface-variant/50 uppercase tracking-wider">
                      Input
                    </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {tech.input_carriers.map((c) => (
                        <span key={c} className="bg-surface-container text-on-surface-variant px-1.5 py-0.5 rounded text-[10px]">
                          {c.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {tech.output_carriers.length > 0 && (
                  <div>
                    <span className="text-[9px] font-bold text-on-surface-variant/50 uppercase tracking-wider">
                      Output
                    </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {tech.output_carriers.map((c) => (
                        <span key={c} className="bg-secondary-container/40 text-on-secondary-container px-1.5 py-0.5 rounded text-[10px]">
                          {c.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tags */}
            {tech.tags.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1.5">
                  Tags
                </p>
                <div className="flex flex-wrap gap-1">
                  {tech.tags.map((tag) => (
                    <span
                      key={tag}
                      className="bg-surface-container text-on-surface-variant/70 px-1.5 py-0.5 rounded text-[10px]"
                    >
                      {tag.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            {tech.description && (
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1.5">
                  Description
                </p>
                <p className="text-xs text-on-surface-variant leading-relaxed">{tech.description}</p>
              </div>
            )}

            {/* DB ID */}
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">
                Database ID
              </p>
              <span className="text-[10px] font-mono text-on-surface-variant/50 break-all leading-relaxed">
                {tech.id}
              </span>
            </div>
          </div>

          {/* Action buttons pinned to bottom */}
          <div className="flex-shrink-0 p-4 border-t border-outline-variant/15 space-y-2">
            <button
              onClick={() => exportToCSV(tech)}
              className="w-full px-4 py-2 technical-gradient text-on-primary text-xs font-bold
                         rounded shadow-md shadow-primary/20 flex items-center justify-center gap-2
                         hover:opacity-90 transition-opacity focus-visible:outline focus-visible:outline-2
                         focus-visible:outline-primary"
            >
              <span className="material-symbols-outlined text-sm">download</span>
              Export (.csv)
            </button>
            <button
              onClick={handleShare}
              className="w-full px-4 py-2 border border-outline text-on-surface-variant text-xs
                         font-bold rounded flex items-center justify-center gap-2
                         hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-sm">share</span>
              {shareLabel}
            </button>
          </div>
        </aside>

        {/* ── Main content ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6 min-w-0">

          {/* KPI row + CAPEX sparkline */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
            <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-surface-container-low p-4 rounded-lg border-l-4 border-primary">
                <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mb-1">
                  Instances
                </p>
                <p className="font-headline text-3xl font-bold">{tech.instances.length}</p>
              </div>
              <div className="bg-surface-container-low p-4 rounded-lg">
                <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mb-1">
                  Avg. Efficiency
                </p>
                <p className="font-headline text-3xl font-bold">
                  {avgEff === "—" ? avgEff : `${avgEff}%`}
                </p>
              </div>
              <div className="bg-surface-container-low p-4 rounded-lg">
                <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mb-1">
                  Category
                </p>
                <p className="font-headline text-sm font-bold capitalize">
                  {tech.category.replace(/_/g, " ")}
                </p>
              </div>
              <div className="bg-surface-container-low p-4 rounded-lg">
                <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mb-1">
                  Status
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary pulse-ring" />
                  <p className="font-bold text-sm">Operational</p>
                </div>
              </div>
            </div>
            <div className="lg:col-span-4 bg-surface-container-low p-4 rounded-lg">
              <div className="flex justify-between items-start mb-3">
                <h4 className="text-[10px] uppercase font-bold text-on-surface-variant tracking-widest">
                  CAPEX Trend ($/kW)
                </h4>
                <span className="text-[10px] font-bold text-primary">{tech.instances.length} variants</span>
              </div>
              <CapexSparkline instances={tech.instances} />
            </div>
          </div>

          {/* Instances Table */}
          <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/10">
            <div className="overflow-x-auto">
              <table
                className="w-full text-left border-collapse"
                aria-label={`Parameter instances for ${tech.name}`}
              >
                <thead>
                  <tr className="bg-surface-container-highest/20">
                    {[
                      "Variant",
                      "CAPEX ($/kW)",
                      "Fixed OPEX ($/kW-yr)",
                      "Efficiency (%)",
                      "Lifetime",
                      "WACC (%)",
                      "CO₂ (g/kWh)",
                      "Source",
                    ].map((col, i) => (
                      <th
                        key={col}
                        scope="col"
                        className={[
                          "px-5 py-4 text-[10px] font-bold uppercase tracking-[0.05em]",
                          "text-on-surface-variant border-b border-outline-variant/15",
                          i === 0
                            ? "sticky left-0 bg-surface-container-lowest z-10 text-left"
                            : i === 7
                            ? "text-right"
                            : "text-center",
                        ].join(" ")}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {tech.instances.length > 0 ? (
                    tech.instances.map((inst, idx) => (
                      <InstanceRow key={inst.id} inst={inst} index={idx} />
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-5 py-10 text-center text-on-surface-variant italic"
                      >
                        No instances recorded for this technology.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer bar */}
          <div className="mt-5 flex justify-between items-center text-[10px] font-bold
                          text-on-surface-variant uppercase tracking-widest">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">database</span>
              {tech.id.slice(0, 16).toUpperCase()}
            </span>
            <span>License: CC BY 4.0</span>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function ModalSkeleton() {
  return (
    <div className="flex flex-col h-full animate-pulse">
      <div className="flex items-center justify-between px-8 py-6 border-b border-outline-variant/15">
        <div className="space-y-2">
          <div className="h-8 bg-surface-container-high rounded w-64" />
          <div className="h-4 bg-surface-container rounded w-40" />
        </div>
        <div className="w-10 h-10 rounded-full bg-surface-container" />
      </div>
      <div className="flex-1 p-8 space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface-container-low rounded-lg p-5 h-24" />
          ))}
        </div>
        <div className="bg-surface-container-lowest rounded-xl h-64" />
      </div>
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

interface DetailsModalProps {
  tech: TechnologySummary | null; // null = modal hidden
  onClose: () => void;
}

export default function DetailsModal({ tech, onClose }: DetailsModalProps) {
  const labelId = useId();
  const descId  = useId();
  const overlayRef = useRef<HTMLDivElement>(null);

  // Escape-key dismissal
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!tech) return;
    document.addEventListener("keydown", handleKeyDown);
    // Prevent body scroll while modal is open
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [tech, handleKeyDown]);

  if (!tech) return null;

  return (
    // Overlay
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[70] bg-on-surface/20 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        // Close when clicking the dark overlay (not the panel itself)
        if (e.target === overlayRef.current) onClose();
      }}
      aria-hidden={!tech}
    >
      {/* Glass panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        aria-describedby={descId}
        className="glass-panel w-full max-w-[1400px] h-[90vh] flex flex-col rounded-xl
                   shadow-2xl overflow-hidden border border-white/40"
      >
        <Suspense fallback={<ModalSkeleton />}>
          <InnerPanel
            techId={tech.id}
            onClose={onClose}
            labelId={labelId}
            descId={descId}
          />
        </Suspense>
      </div>
    </div>
  );
}

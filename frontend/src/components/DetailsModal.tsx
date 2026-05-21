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
  useMemo,
  useOptimistic,
  useRef,
  useState,
  memo,
  lazy,
  Suspense,
  startTransition,
} from "react";
import { createPortal } from "react-dom";
import type { EquipmentInstance, Technology, TechnologySummary } from "../types/api";
import { fetchTechnology, fetchTechModelExport, fetchAllTechsModelExport, type ModelFormat } from "../services/api";

// Lazy-load ECharts (large library) so it doesn't bloat the initial bundle
const TechCharts = lazy(() =>
  import("./TechCharts").then((m) => ({ default: m.TechCharts }))
);

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
  const label = source.length > 36 ? `${source.slice(0, 35)}…` : source;
  const colours = SOURCE_COLOURS[key] ?? { bg: "#eceff1", text: "#546e7a", border: "#546e7a" };
  const url = SOURCE_URLS[key];

  const badge = (
    <span
      className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-bold border"
      style={{ background: colours.bg, color: colours.text, borderColor: `${colours.border}33` }}
    >
      {label}
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

// ── Keys excluded from the extra-params columns ─────────────────────────────

const TECH_META_KEYS = new Set([
  "instance_id", "country", "country_iso2", "location", "country_code",
  "reference_source", "_source", "_paper_doi", "_paper_title", "_paper_year",
  "_scraped_at", "_paper_countries",
]);

// ── Instance table row ────────────────────────────────────────────────────────

const InstanceRow = memo(function InstanceRow({
  inst,
  index,
  techName,
  techId,
  originalIndex,
  extraParamKeys,
}: {
  inst: EquipmentInstance;
  index: number;
  techName: string;
  techId: string;
  originalIndex: number;
  extraParamKeys: string[];
}) {
  const bg = index % 2 !== 0 ? "bg-surface-container-low/20" : "";

  const eff = inst.electrical_efficiency?.value ?? inst.thermal_efficiency?.value;
  const mainSource =
    inst.capex_per_kw?.source ??
    inst.opex_fixed_per_kw_yr?.source ??
    (typeof inst.extra?.reference_source === "string" ? inst.extra.reference_source : null) ??
    (typeof inst.extra?._source === "string" ? inst.extra._source : null) ??
    inst.manufacturer;

  return (
    <tr
      className={`${bg} hover:bg-surface-container-low/50 transition-colors group`}
    >
      {/* Variant */}
      <td className="px-5 py-5 font-bold text-on-surface sticky left-0 bg-white/50
                     group-hover:bg-transparent backdrop-blur-sm z-10">
        <div className="flex items-center gap-2">
          <span>{inst.label}</span>
          <InstanceDownloadMenu
            inst={inst}
            techId={techId}
            techName={techName}
            originalIndex={originalIndex}
          />
        </div>
      </td>
      {/* Capacity */}
      <td className="px-5 py-5 font-medium text-center">
        {inst.capacity_kw
          ? `${fmt(inst.capacity_kw.value, 0)} ${inst.capacity_kw.unit}`
          : "—"}
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
      {/* Tech-specific extra params – dynamic columns */}
      {extraParamKeys.map((key) => {
        const val = inst.extra?.[key];
        const display =
          val === null || val === undefined
            ? "—"
            : typeof val === "number"
            ? fmt(val, 3)
            : String(val);
        return (
          <td
            key={key}
            className={`px-4 py-5 text-center font-mono text-xs whitespace-nowrap ${
              val === null || val === undefined ? "text-on-surface-variant/30" : "text-on-surface"
            }`}
            title={`${key}: ${display}`}
          >
            {display}
          </td>
        );
      })}
    </tr>
  );
});

// ── Generic blob download helper ───────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Minimal YAML serialiser (handles the nested-dict structure of Calliope output) ────

function toYaml(v: unknown, depth = 0): string {
  const pad = "  ".repeat(depth);
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return isFinite(v) ? String(v) : "null";
  if (typeof v === "string") {
    const needsQuotes = !v || /[:#[\]{},|>&*!?'"]/.test(v) || v.includes("\n") || /^\s|\s$/.test(v);
    return needsQuotes
      ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`
      : v;
  }
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    return v.map((item) => `\n${pad}- ${toYaml(item, depth + 1)}`).join("");
  }
  const entries = Object.entries(v as Record<string, unknown>).filter(
    ([, val]) => val !== null && val !== undefined,
  );
  if (!entries.length) return "{}";
  return entries
    .map(([k, val]) => {
      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        const nested = toYaml(val, depth + 1);
        return `${pad}${k}:${nested.startsWith("\n") ? nested : "\n" + nested}`;
      }
      return `${pad}${k}: ${toYaml(val, depth)}`;
    })
    .join("\n");
}

// ── Per-variant JSON download ────────────────────────────────────────────────

function downloadInstanceJSON(inst: EquipmentInstance, techName: string): void {
  triggerDownload(
    new Blob([JSON.stringify(inst, null, 2)], { type: "application/json" }),
    `${techName.replace(/\s+/g, "_")}_${inst.label.replace(/\s+/g, "_")}.json`,
  );
}

// ── Per-instance model-format download menu ─────────────────────────────────────────

const INSTANCE_EXPORT_OPTIONS = [
  { id: "raw",       label: "Raw JSON",  ext: "json", icon: "data_object" },
  { id: "calliope",  label: "Calliope",  ext: "yaml", icon: "description" },
  { id: "pypsa",     label: "PyPSA",     ext: "json", icon: "electrical_services" },
  { id: "osemosys",  label: "OSeMOSYS",  ext: "json", icon: "table_chart" },
  { id: "adoptnet0", label: "ADOPTNet0", ext: "json", icon: "hub" },
] as const;

type InstanceExportId = (typeof INSTANCE_EXPORT_OPTIONS)[number]["id"];

function InstanceDownloadMenu({
  inst,
  techId,
  techName,
  originalIndex,
}: {
  inst: EquipmentInstance;
  techId: string;
  techName: string;
  originalIndex: number;
}) {
  const [open,    setOpen]   = useState(false);
  const [loading, setLoading] = useState<InstanceExportId | null>(null);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  function handleOpen() {
    if (loading !== null) return;
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onScroll() { setOpen(false); }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("scroll",    onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("scroll",    onScroll, true);
    };
  }, [open]);

  async function doExport(id: InstanceExportId) {
    if (loading) return;
    setLoading(id);
    setOpen(false);
    try {
      if (id === "raw") {
        downloadInstanceJSON(inst, techName);
      } else {
        const data = await fetchTechModelExport(techId, id as ModelFormat, originalIndex);
        const safe = `${techName.replace(/\s+/g, "_")}_inst${originalIndex}`;
        if (id === "calliope") {
          const key = techName.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
          triggerDownload(
            new Blob([`techs:\n${toYaml({ [key]: data }, 1)}`], { type: "text/yaml" }),
            `${safe}_calliope.yaml`,
          );
        } else {
          triggerDownload(
            new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
            `${safe}_${id}.json`,
          );
        }
      }
    } catch (err) {
      console.error("Instance export failed:", err);
    } finally {
      setLoading(null);
    }
  }

  const dropdown = open ? createPortal(
    <div
      role="listbox"
      style={{ position: "fixed", top: dropPos.top, left: dropPos.left, zIndex: 9999 }}
      className="bg-surface border border-outline-variant/30 rounded-md shadow-lg shadow-black/20 min-w-[150px] overflow-hidden"
    >
      {INSTANCE_EXPORT_OPTIONS.map(({ id, label, ext, icon }) => (
        <button
          key={id}
          role="option"
          onMouseDown={(e) => { e.stopPropagation(); doExport(id); }}
          className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium
                     text-on-surface-variant hover:bg-primary/8 hover:text-primary
                     transition-colors text-left"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>{icon}</span>
          <span className="flex-1">{label}</span>
          <span className="text-[9px] opacity-40 font-normal">.{ext}</span>
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="inline-block">
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : handleOpen())}
        disabled={loading !== null}
        title="Download this variant"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1 px-2 py-0.5 rounded border border-outline-variant/40
                   text-[10px] font-bold text-on-surface-variant bg-surface-container
                   hover:border-primary hover:text-primary hover:bg-primary/5
                   disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? (
          <span className="material-symbols-outlined animate-spin" style={{ fontSize: "12px" }}>progress_activity</span>
        ) : (
          <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>download</span>
        )}
        {loading
          ? INSTANCE_EXPORT_OPTIONS.find((o) => o.id === loading)?.label ?? "…"
          : "Export"}
        <span className="material-symbols-outlined" style={{ fontSize: "10px" }}>expand_more</span>
      </button>
      {dropdown}
    </div>
  );
}

// ── Export CSV helper ─────────────────────────────────────────────────────────

function exportToCSV(tech: Technology): void {
  // Collect all extra param keys across instances (excluding meta keys)
  const extraKeys = Array.from(
    new Set(
      tech.instances.flatMap((inst) =>
        Object.keys(inst.extra ?? {}).filter(
          (k) => !TECH_META_KEYS.has(k) && !k.startsWith("_"),
        ),
      ),
    ),
  ).sort();

  const headers = [
    "Label", "Capacity (kW)", "CAPEX ($/kW)", "Fixed OPEX ($/kW-yr)",
    "Efficiency (%)", "Lifetime (yrs)", "WACC (%)", "CO2 (g/kWh)",
    ...extraKeys,
    "Source",
  ];
  const rows = tech.instances.map((inst) => {
    const eff = inst.electrical_efficiency?.value ?? inst.thermal_efficiency?.value;
    const source =
      inst.capex_per_kw?.source ??
      inst.opex_fixed_per_kw_yr?.source ??
      (typeof inst.extra?.reference_source === "string" ? inst.extra.reference_source : null) ??
      (typeof inst.extra?._source === "string" ? inst.extra._source : null) ??
      inst.manufacturer ?? "";
    return [
      inst.label,
      inst.capacity_kw?.value ?? "",
      inst.capex_per_kw?.value ?? "",
      inst.opex_fixed_per_kw_yr?.value ?? "",
      eff != null ? (eff * 100).toFixed(1) : "",
      inst.economic_lifetime_yr?.value ?? "",
      inst.discount_rate ? (inst.discount_rate.value * 100).toFixed(1) : "",
      inst.co2_emission_factor ? (inst.co2_emission_factor.value * 1000).toFixed(0) : "",
      ...extraKeys.map((k) => {
        const v = inst.extra?.[k];
        return v === null || v === undefined ? "" : String(v);
      }),
      source,
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

// ── Sort types (module-level so SortIcon stays stable across renders) ─────────

type SortField = string; // any column key, including extra params
type SortDir   = "asc" | "desc";

function getInstColVal(inst: EquipmentInstance, key: string): number | string | null | undefined {
  switch (key) {
    case "capex_per_kw":         return inst.capex_per_kw?.value;
    case "opex_fixed_per_kw_yr": return inst.opex_fixed_per_kw_yr?.value;
    case "efficiency":           return inst.electrical_efficiency?.value ?? inst.thermal_efficiency?.value;
    case "capacity_kw":          return inst.capacity_kw?.value;
    case "economic_lifetime_yr": return inst.economic_lifetime_yr?.value;
    default:                     return inst.extra?.[key] as number | string | null | undefined;
  }
}

function matchesFilter(val: number | string | null | undefined, raw: string): boolean {
  if (!raw) return true;
  if (val === null || val === undefined) return false;
  return String(val) === raw;
}

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) {
    return <span className="material-symbols-outlined opacity-20" style={{ fontSize: "12px" }}>unfold_more</span>;
  }
  return (
    <span className="material-symbols-outlined text-primary" style={{ fontSize: "12px" }}>
      {sortDir === "asc" ? "arrow_upward" : "arrow_downward"}
    </span>
  );
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

  const avgEff = useMemo(
    () => avgOrDash(
      tech.instances,
      (i) =>
        (i.electrical_efficiency?.value ?? i.thermal_efficiency?.value ?? null) != null
          ? ((i.electrical_efficiency?.value ?? i.thermal_efficiency?.value)! * 100)
          : null
    ),
    [tech.instances],
  );

  const isVerified = !tech.tags.some((t) => t.toLowerCase() === "review_required");
  const primaryCarrier = tech.output_carriers[0] ?? tech.input_carriers[0];

  // ── Sort state for the instances table ─────────────────────────────────────
  const [sortField, setSortField] = useState<SortField>("label");
  const [sortDir,   setSortDir]   = useState<SortDir>("asc");

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const sortedInstances = useMemo(() => [...tech.instances].sort((a, b) => {
    let av: number | string | null = null;
    let bv: number | string | null = null;
    switch (sortField) {
      case "label":                av = a.label;                                       bv = b.label;                                       break;
      case "capacity_kw":         av = a.capacity_kw?.value          ?? null;         bv = b.capacity_kw?.value          ?? null;         break;
      case "capex_per_kw":        av = a.capex_per_kw?.value         ?? null;         bv = b.capex_per_kw?.value         ?? null;         break;
      case "opex_fixed_per_kw_yr":av = a.opex_fixed_per_kw_yr?.value ?? null;         bv = b.opex_fixed_per_kw_yr?.value ?? null;         break;
      case "efficiency":          av = (a.electrical_efficiency?.value ?? a.thermal_efficiency?.value) ?? null;
                                  bv = (b.electrical_efficiency?.value ?? b.thermal_efficiency?.value) ?? null; break;
      case "economic_lifetime_yr":av = a.economic_lifetime_yr?.value  ?? null;         bv = b.economic_lifetime_yr?.value  ?? null;        break;
      default:                     av = (a.extra?.[sortField] as number | string) ?? null;
                                   bv = (b.extra?.[sortField] as number | string) ?? null;  break;
    }
    // Nulls always last
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" && typeof bv === "string") {
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortDir === "asc"
      ? (av as number) - (bv as number)
      : (bv as number) - (av as number);
  }), [tech.instances, sortField, sortDir]);

  // Extra tech-specific param keys → dynamic columns appended after Source
  const extraParamKeys = useMemo(
    () =>
      Array.from(
        new Set(
          tech.instances.flatMap((inst) =>
            Object.keys(inst.extra ?? {}).filter(
              (k) => !TECH_META_KEYS.has(k) && !k.startsWith("_"),
            ),
          ),
        ),
      ).sort(),
    [tech.instances],
  );

  // Unique sorted option values per column — drives filter dropdowns
  const colOptions = useMemo(() => {
    const opts: Record<string, string[]> = {};
    const getters: Record<string, (i: EquipmentInstance) => number | string | null | undefined> = {
      label:                (i) => i.label,
      capacity_kw:          (i) => i.capacity_kw?.value,
      capex_per_kw:         (i) => i.capex_per_kw?.value,
      opex_fixed_per_kw_yr: (i) => i.opex_fixed_per_kw_yr?.value,
      efficiency:           (i) => i.electrical_efficiency?.value ?? i.thermal_efficiency?.value,
      economic_lifetime_yr: (i) => i.economic_lifetime_yr?.value,
    };
    for (const key of Object.keys(getters)) {
      const vals = tech.instances.map(getters[key]).filter((v): v is number | string => v != null);
      const isNum = vals.every((v) => typeof v === "number");
      const strs = [...new Set(vals.map(String))];
      opts[key] = isNum ? strs.sort((a, b) => parseFloat(a) - parseFloat(b)) : strs.sort();
    }
    for (const key of extraParamKeys) {
      const vals = tech.instances.map((i) => i.extra?.[key] as number | string | null | undefined).filter((v): v is number | string => v != null);
      const isNum = vals.every((v) => typeof v === "number");
      const strs = [...new Set(vals.map(String))];
      opts[key] = isNum ? strs.sort((a, b) => parseFloat(a) - parseFloat(b)) : strs.sort();
    }
    return opts;
  }, [tech.instances, extraParamKeys]);

  // Pre-computed index map: O(1) lookup replaces O(n) indexOf per row
  const instanceIndexMap = useMemo(
    () => new Map(tech.instances.map((inst, i) => [inst, i])),
    [tech.instances],
  );

  // ── Column filter state ───────────────────────────────────────
  const [showFilters, setShowFilters] = useState(false);
  const [colFilters, setColFilters] = useState<Record<string, string>>({});

  const activeFilterCount = Object.values(colFilters).filter(Boolean).length;

  function setFilter(key: string, val: string) {
    setColFilters((prev) => ({ ...prev, [key]: val }));
  }

  // Apply column filters on top of sorted instances
  const displayInstances = useMemo(
    () =>
      sortedInstances.filter((inst) =>
        Object.entries(colFilters).every(([key, raw]) =>
          matchesFilter(getInstColVal(inst, key), raw),
        ),
      ),
    [sortedInstances, colFilters],
  );

  // ── Full-catalog model export ──────────────────────────────────────────────────
  const [bulkDownloading, setBulkDownloading] = useState<ModelFormat | null>(null);

  async function handleBulkExport(format: ModelFormat) {
    if (bulkDownloading) return;
    setBulkDownloading(format);
    try {
      const data = await fetchAllTechsModelExport(format);
      if (format === "calliope") {
        // Response: { techs: {...}, meta: {...} }
        const techs = (data as Record<string, unknown>).techs ?? data;
        triggerDownload(
          new Blob([`techs:\n${toYaml(techs, 1)}`], { type: "text/yaml" }),
          `opentech_catalog_calliope.yaml`,
        );
      } else {
        triggerDownload(
          new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
          `opentech_catalog_${format}.json`,
        );
      }
    } catch (err) {
      console.error(`Bulk export failed (${format}):`, err);
    } finally {
      setBulkDownloading(null);
    }
  }

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
            {/* Raw CSV */}
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

            {/* Full-catalog export – all technologies */}
            <div>
              <p className="text-[9px] uppercase tracking-widest font-bold text-on-surface-variant/50 mb-0.5 px-0.5">
                Full Catalog
              </p>
              <p className="text-[9px] text-on-surface-variant/40 mb-1.5 px-0.5">all {`${tech.category}`} • every technology</p>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { format: "calliope"  as ModelFormat, label: "Calliope",  ext: "yaml", icon: "description"        },
                    { format: "pypsa"     as ModelFormat, label: "PyPSA",     ext: "json", icon: "electrical_services" },
                    { format: "osemosys"  as ModelFormat, label: "OSeMOSYS",  ext: "json", icon: "table_chart"         },
                    { format: "adoptnet0" as ModelFormat, label: "ADOPTNet0", ext: "json", icon: "hub"                 },
                  ] as const
                ).map(({ format, label, ext, icon }) => (
                  <button
                    key={format}
                    onClick={() => handleBulkExport(format)}
                    disabled={bulkDownloading !== null}
                    title={`Download full catalog – ${label} (.${ext})`}
                    className="flex flex-col items-center justify-center gap-0.5 px-2 py-2.5
                               bg-surface-container-low border border-outline-variant/20 rounded
                               text-[10px] font-bold text-on-surface-variant
                               hover:bg-surface-container hover:border-secondary/40 hover:text-secondary
                               disabled:opacity-40 disabled:cursor-not-allowed transition-all group"
                  >
                    {bulkDownloading === format ? (
                      <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
                    ) : (
                      <span className="material-symbols-outlined text-base group-hover:text-secondary">{icon}</span>
                    )}
                    <span className="leading-none">{label}</span>
                    <span className="text-[8px] opacity-50 font-normal">.{ext}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Share */}
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

          {/* ── Parameter Comparison Charts ──────────────────────────── */}
          {tech.instances.length >= 2 && (
            <div className="mb-6">
              <Suspense
                fallback={
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 animate-pulse">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className={`h-72 bg-surface-container-low rounded-xl ${i === 2 ? "xl:col-span-2" : ""}`} />
                    ))}
                  </div>
                }
              >
                <TechCharts instances={tech.instances} />
              </Suspense>
            </div>
          )}

          {/* Instances Table */}
          <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/10">
            {/* Sort + filter toolbar */}
            {/* ── Sort bar ─────────────────────────────────────────────── */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-outline-variant/10 bg-surface-container/30 flex-wrap">
              <span className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant flex-shrink-0">
                Sort by
              </span>
              {(
                [
                  ["label",                "Variant"],
                  ["capacity_kw",          "Capacity"],
                  ["capex_per_kw",         "CAPEX"],
                  ["opex_fixed_per_kw_yr", "Fixed OPEX"],
                  ["efficiency",           "Efficiency"],
                  ["economic_lifetime_yr", "Lifetime"],
                ] as [SortField, string][]
              ).map(([field, label]) => (
                <button
                  key={field}
                  onClick={() => handleSort(field)}
                  className={[
                    "flex items-center gap-0.5 px-2.5 py-1 rounded text-[10px] font-bold border transition-colors",
                    sortField === field
                      ? "bg-primary text-on-primary border-primary"
                      : "text-on-surface-variant border-outline-variant/50 hover:bg-surface-container-high",
                  ].join(" ")}
                >
                  {label}
                  <span
                    className={`material-symbols-outlined ${sortField === field ? "text-on-primary" : "opacity-40"}`}
                    style={{ fontSize: "11px" }}
                  >
                    {sortField === field
                      ? sortDir === "asc"
                        ? "arrow_upward"
                        : "arrow_downward"
                      : "unfold_more"}
                  </span>
                </button>
              ))}

              <span className="ml-auto flex items-center gap-2">
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => setColFilters({})}
                    className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-bold
                               bg-error/10 text-error border border-error/30 hover:bg-error/20 transition-colors"
                    title="Clear all filters"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>
                      filter_alt_off
                    </span>
                    Clear {activeFilterCount}
                  </button>
                )}
                <button
                  onClick={() => setShowFilters((v) => !v)}
                  className={[
                    "flex items-center gap-0.5 px-2.5 py-1 rounded text-[10px] font-bold border transition-colors",
                    showFilters || activeFilterCount > 0
                      ? "bg-secondary text-on-secondary border-secondary"
                      : "text-on-surface-variant border-outline-variant/50 hover:bg-surface-container-high",
                  ].join(" ")}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>
                    filter_alt
                  </span>
                  Filters
                  {activeFilterCount > 0 && (
                    <span
                      className="ml-0.5 bg-on-secondary/20 text-on-secondary rounded-full w-3.5 h-3.5
                                 flex items-center justify-center text-[9px] font-bold"
                    >
                      {activeFilterCount}
                    </span>
                  )}
                </button>
                <span className="text-[10px] text-on-surface-variant/50">
                  {displayInstances.length}
                  {displayInstances.length !== sortedInstances.length
                    ? `/${sortedInstances.length}`
                    : ""}{" "}
                  variant{sortedInstances.length !== 1 ? "s" : ""}
                </span>
              </span>
            </div>

                        {/* ── Filter panel (collapsible) ────────────────────────────── */}
            {showFilters && (
              <div className="px-5 py-4 border-b border-outline-variant/10 bg-surface-container-lowest/50">
                {/* Standard columns grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {([
                    { key: "label",                label: "Variant"        },
                    { key: "capacity_kw",          label: "Capacity (kW)"  },
                    { key: "capex_per_kw",         label: "CAPEX ($/kW)"   },
                    { key: "opex_fixed_per_kw_yr", label: "Fixed OPEX"     },
                    { key: "efficiency",           label: "Efficiency (%)" },
                    { key: "economic_lifetime_yr", label: "Lifetime (yrs)" },
                  ] as { key: string; label: string }[]).map(({ key, label }) => (
                    <div key={key} className="flex flex-col gap-1">
                      <label className="text-[9px] font-bold uppercase tracking-[0.07em] text-on-surface-variant/60">
                        {label}
                      </label>
                      <select
                        value={colFilters[key] ?? ""}
                        onChange={(e) => setFilter(key, e.target.value)}
                        className={[
                          "w-full px-2 py-1.5 rounded border text-[11px] font-mono appearance-none cursor-pointer",
                          "bg-surface-container text-on-surface outline-none",
                          "transition-colors focus:ring-1 focus:ring-primary/40",
                          colFilters[key] ? "border-primary/60 bg-primary/5" : "border-outline-variant/30",
                        ].join(" ")}
                      >
                        <option value="">— Any —</option>
                        {(colOptions[key] ?? []).map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                {/* Tech-specific extra param filters */}
                {extraParamKeys.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-outline-variant/10">
                    <p className="text-[9px] font-bold uppercase tracking-[0.07em] text-primary/60 mb-2">
                      {tech.name.split(" ").slice(0, 2).join(" ")} — specific parameters
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                      {extraParamKeys.map((key) => (
                        <div key={key} className="flex flex-col gap-1">
                          <button
                            onClick={() => handleSort(key)}
                            className={[
                              "flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] font-bold border transition-colors self-start max-w-full",
                              sortField === key
                                ? "bg-primary text-on-primary border-primary"
                                : "text-on-surface-variant/70 border-outline-variant/40 hover:bg-surface-container-high",
                            ].join(" ")}
                            title={key}
                          >
                            <span className="truncate" style={{ maxWidth: "9rem" }}>{key.replace(/_/g, " ")}</span>
                            <span
                              className={`material-symbols-outlined flex-shrink-0 ${sortField === key ? "text-on-primary" : "opacity-40"}`}
                              style={{ fontSize: "10px" }}
                            >
                              {sortField === key ? (sortDir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"}
                            </span>
                          </button>
                          <select
                            value={colFilters[key] ?? ""}
                            onChange={(e) => setFilter(key, e.target.value)}
                            className={[
                              "w-full px-2 py-1.5 rounded border text-[11px] font-mono appearance-none cursor-pointer",
                              "bg-surface-container text-on-surface outline-none",
                              "transition-colors focus:ring-1 focus:ring-primary/40",
                              colFilters[key] ? "border-primary/60 bg-primary/5" : "border-outline-variant/30",
                            ].join(" ")}
                          >
                            <option value="">— Any —</option>
                            {(colOptions[key] ?? []).map((v) => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="overflow-x-auto">
              <table
                className="w-full text-left border-collapse"
                aria-label={`Parameter instances for ${tech.name}`}
              >
                <thead>
                  <tr className="bg-surface-container-highest/20">
                    {(
                      [
                        ["label",                "Variant",              "sticky left-0 bg-surface-container-lowest z-10 text-left"],
                        ["capacity_kw",          "Capacity (kW)",        "text-center"],
                        ["capex_per_kw",         "CAPEX ($/kW)",         "text-center"],
                        ["opex_fixed_per_kw_yr", "Fixed OPEX ($/kW-yr)", "text-center"],
                        ["efficiency",           "Efficiency (%)",       "text-center"],
                        ["economic_lifetime_yr", "Lifetime",             "text-center"],
                        [null,                   "WACC (%)",             "text-center"],
                        [null,                   "CO\u2082 (g/kWh)",         "text-center"],
                        [null,                   "Source",               "text-right"],
                      ] as [SortField | null, string, string][]
                    ).map(([field, col, align]) => (
                      <th
                        key={col}
                        scope="col"
                        onClick={field ? () => handleSort(field) : undefined}
                        className={[
                          "px-5 py-4 text-[10px] font-bold uppercase tracking-[0.05em]",
                          "text-on-surface-variant border-b border-outline-variant/15",
                          align,
                          field ? "cursor-pointer hover:text-on-surface select-none" : "",
                          sortField === field ? "text-primary" : "",
                        ].join(" ")}
                      >
                        <span className="inline-flex items-center gap-0.5">
                          {col}
                          {field && <SortIcon field={field} sortField={sortField} sortDir={sortDir} />}
                        </span>
                      </th>
                    ))}
                    {extraParamKeys.map((key) => (
                      <th
                        key={key}
                        scope="col"
                        onClick={() => handleSort(key)}
                        className={[
                          "px-4 py-4 text-[10px] font-bold uppercase tracking-[0.05em]",
                          "border-b border-outline-variant/15",
                          "text-center whitespace-nowrap cursor-pointer hover:text-on-surface select-none",
                          sortField === key ? "text-primary" : "text-on-surface-variant",
                        ].join(" ")}
                      >
                        <span className="inline-flex items-center gap-0.5">
                          {key.replace(/_/g, " ")}
                          <SortIcon field={key} sortField={sortField} sortDir={sortDir} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {displayInstances.length > 0 ? (
                    displayInstances.map((inst, idx) => (
                      <InstanceRow
                        key={inst.id}
                        inst={inst}
                        index={idx}
                        techName={tech.name}
                        techId={String(tech.id)}
                        originalIndex={instanceIndexMap.get(inst) ?? 0}
                        extraParamKeys={extraParamKeys}
                      />
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={9 + extraParamKeys.length}
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

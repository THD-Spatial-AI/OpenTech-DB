/**
 * visual-builder/EquipmentPalette.tsx
 * ─────────────────────────────────────
 * Left sidebar: draggable OEO equipment blocks grouped by domain.
 *
 * Drag protocol
 * ─────────────
 * Each palette item sets `dataTransfer` on dragStart with a JSON payload:
 *   { oeoClass: string; domain: string }
 *
 * The React Flow canvas (`VisualTechBuilder`) reads that payload in its
 * `onDrop` handler and calls `addEquipmentNode`.
 *
 * Strict ontology enforcement
 * ───────────────────────────
 * The palette is seeded exclusively from `OntologySchema.allowed_oeo_classes`
 * (live from the backend) plus the four fixed `allowed_domains`.
 * No hard-coded classes. No free-text addition.
 */

import { useState, useMemo } from "react";
import type { OntologySchema } from "../../../types/api";
import { CARRIER_COLORS, OEO_META, getOeoId } from "./useTechBuilderStore";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Human-readable name: prefer OEO_META label, fall back to ID. */
function resolveLabel(oeoClass: string): string {
  const id = getOeoId(oeoClass);
  if (OEO_META[id]) return OEO_META[id].label;
  return id
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Domain from OEO_META first; keyword heuristic as fallback for classes
 * not yet in the metadata table.
 */
function resolveDomain(oeoClass: string): string {
  const id = getOeoId(oeoClass);
  if (OEO_META[id]) return OEO_META[id].domain;

  const lower = oeoClass.toLowerCase();
  if (/wind|solar|pv|photovolt|hydro|biomass|geotherm|nuclear|generation|plant/.test(lower))
    return "generation";
  if (/batter|storage|pumped|flywheel|capacitor|tank|cavern|reservoir/.test(lower))
    return "storage";
  if (/transmission|cable|line|pipeline|grid|transformer|network/.test(lower))
    return "transmission";
  return "conversion";
}

// Domain display config
const DOMAIN_CONFIG: Record<
  string,
  { label: string; icon: string; headerBg: string; chipBg: string; chipText: string }
> = {
  generation:  {
    label: "Generation",
    icon: "bolt",
    headerBg: "bg-amber-50 border-amber-200",
    chipBg: "bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200 hover:border-amber-400",
    chipText: "text-amber-800",
  },
  storage:     {
    label: "Storage",
    icon: "battery_4_bar",
    headerBg: "bg-blue-50 border-blue-200",
    chipBg: "bg-gradient-to-r from-blue-50 to-cyan-50 border-blue-200 hover:border-blue-400",
    chipText: "text-blue-800",
  },
  transmission:{
    label: "Transmission",
    icon: "power",
    headerBg: "bg-slate-50 border-slate-200",
    chipBg: "bg-gradient-to-r from-slate-50 to-slate-100 border-slate-200 hover:border-slate-400",
    chipText: "text-slate-800",
  },
  conversion:  {
    label: "Conversion",
    icon: "sync_alt",
    headerBg: "bg-violet-50 border-violet-200",
    chipBg: "bg-gradient-to-r from-violet-50 to-purple-50 border-violet-200 hover:border-violet-400",
    chipText: "text-violet-800",
  },
};

// ── Carrier legend strip (bottom of palette) ──────────────────────────────────

function CarrierLegend({ carriers }: { carriers: string[] }) {
  return (
    <div className="px-3 py-3 border-t border-outline-variant/15">
      <p className="text-[9px] font-bold text-on-surface-variant/50 uppercase tracking-widest mb-2">
        Carriers
      </p>
      <div className="flex flex-wrap gap-1.5">
        {carriers.slice(0, 14).map((c) => (
          <span
            key={c}
            className="flex items-center gap-1 text-[9px] text-on-surface-variant/70 font-medium"
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: CARRIER_COLORS[c] ?? "#6366f1" }}
            />
            {c.replace(/_/g, " ")}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Draggable palette item ────────────────────────────────────────────────────

interface PaletteItemProps {
  oeoClass: string;
  domain: string;
}

function PaletteItem({ oeoClass, domain }: PaletteItemProps) {
  const cfg = DOMAIN_CONFIG[domain] ?? DOMAIN_CONFIG["conversion"];
  const label = resolveLabel(oeoClass);
  const meta  = OEO_META[getOeoId(oeoClass)];

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(
      "application/reactflow",
      JSON.stringify({ oeoClass, domain })
    );
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      title={meta?.hint ?? oeoClass}
      className={`
        flex items-start gap-2 rounded-lg border px-2.5 py-2
        cursor-grab active:cursor-grabbing transition-all
        ${cfg.chipBg}
        hover:shadow-sm
      `}
    >
      <span className={`material-symbols-outlined text-[14px] ${cfg.chipText} flex-shrink-0 mt-0.5`}>
        {cfg.icon}
      </span>
      <div className="flex-1 min-w-0">
        <span className={`text-[11px] font-semibold ${cfg.chipText} leading-tight block`}>
          {label}
        </span>
        {meta && (
          <div className="flex items-center gap-1.5 mt-1">
            {meta.inputs.map((c) => (
              <span
                key={`in-${c}`}
                className="flex items-center gap-0.5 text-[9px] text-slate-500 font-medium"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: CARRIER_COLORS[c] ?? "#6366f1" }} />
                {c.replace(/_/g, " ")}
              </span>
            ))}
            <span className="text-[9px] text-slate-300">→</span>
            {meta.outputs.map((c) => (
              <span
                key={`out-${c}`}
                className="flex items-center gap-0.5 text-[9px] text-slate-500 font-medium"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: CARRIER_COLORS[c] ?? "#6366f1" }} />
                {c.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className="material-symbols-outlined text-[12px] text-on-surface-variant/30 ml-auto flex-shrink-0 mt-0.5">
        drag_indicator
      </span>
    </div>
  );
}

// ── Collapsible domain group ──────────────────────────────────────────────────

interface DomainGroupProps {
  domain: string;
  classes: string[];
  defaultOpen?: boolean;
}

function DomainGroup({ domain, classes, defaultOpen = true }: DomainGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const cfg = DOMAIN_CONFIG[domain] ?? DOMAIN_CONFIG["conversion"];

  if (classes.length === 0) return null;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`
          w-full flex items-center gap-2 px-3 py-2 rounded-lg border
          font-semibold text-[11px] uppercase tracking-wider
          ${cfg.headerBg} transition-colors
        `}
      >
        <span className={`material-symbols-outlined text-[14px] ${cfg.chipText}`}>
          {cfg.icon}
        </span>
        <span className={cfg.chipText}>{cfg.label}</span>
        <span className="ml-auto text-[10px] text-on-surface-variant/50">
          {classes.length}
        </span>
        <span
          className={`material-symbols-outlined text-[14px] ${cfg.chipText} transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
        >
          expand_more
        </span>
      </button>

      {open && (
        <div className="mt-1.5 space-y-1 pl-1">
          {classes.map((cls) => (
            <PaletteItem key={cls} oeoClass={cls} domain={domain} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main palette component ────────────────────────────────────────────────────

interface EquipmentPaletteProps {
  schema: OntologySchema;
}

export default function EquipmentPalette({ schema }: EquipmentPaletteProps) {
  const [search, setSearch] = useState("");

  // Group OEO classes by resolved domain (OEO_META first, heuristic fallback)
  const grouped = useMemo(() => {
    const filtered = schema.allowed_oeo_classes.filter((cls) =>
      cls.toLowerCase().includes(search.toLowerCase()) ||
      resolveLabel(cls).toLowerCase().includes(search.toLowerCase())
    );

    const groups: Record<string, string[]> = {
      generation: [],
      storage: [],
      transmission: [],
      conversion: [],
    };

    for (const cls of filtered) {
      const domain = resolveDomain(cls);
      groups[domain].push(cls);
    }

    return groups;
  }, [schema.allowed_oeo_classes, search]);

  const totalShown = Object.values(grouped).reduce((s, arr) => s + arr.length, 0);

  return (
    <aside
      className="
        h-full w-[268px] flex-shrink-0 flex flex-col
        bg-surface-container-lowest border-r border-outline-variant/20
        overflow-hidden
      "
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-outline-variant/15 flex-shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-[18px] text-primary">
            widgets
          </span>
          <h2 className="text-sm font-bold text-on-surface">Equipment Palette</h2>
        </div>
        <p className="text-[10px] text-on-surface-variant/60 mb-3 leading-relaxed">
          Drag blocks onto the canvas to build your energy system topology. All classes are OEO-aligned.
        </p>

        {/* Search */}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-2.5 text-[14px] text-on-surface-variant/40">
            search
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter classes…"
            className="
              w-full bg-surface-container rounded-lg pl-8 pr-3 py-2
              text-xs text-on-surface placeholder:text-on-surface-variant/50
              border border-outline-variant/20
              focus:outline-none focus:ring-1 focus:ring-primary/40
            "
          />
        </div>

        {search && (
          <p className="text-[9px] text-on-surface-variant/50 mt-1.5">
            {totalShown} result{totalShown !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* Draggable groups */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-0">
        {Object.entries(grouped).map(([domain, classes]) => (
          <DomainGroup
            key={domain}
            domain={domain}
            classes={classes}
            defaultOpen={false}
          />
        ))}

        {totalShown === 0 && (
          <div className="text-center py-10">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant/20">
              search_off
            </span>
            <p className="text-xs text-on-surface-variant/60 mt-2">No classes match</p>
          </div>
        )}
      </div>

      {/* Carrier legend */}
      <CarrierLegend carriers={schema.allowed_carriers} />
    </aside>
  );
}

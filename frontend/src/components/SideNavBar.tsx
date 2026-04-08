/**
 * components/SideNavBar.tsx
 * ──────────────────────────
 * Collapsible left sidebar.
 *
 * Sections
 * ────────
 * 1. Brand + collapse toggle
 * 2. Category navigation  ← primary route switching (moved from TopNavBar)
 * 3. Filter groups:
 *      – OEO Coverage   (full / class-only / none)
 *      – Data Richness  (n_instances bucket)
 * 4. Documentation quick-links → served via FastAPI /project-docs/
 *
 * Collapsed mode: 64 px icon rail.
 */

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { TechnologyCategory } from "../types/api";
import { useAuth } from "../context/AuthContext";
import logoWithTitle from "../assets/icon_title.png";
import logoIconOnly from "../assets/icon_no_title.png";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace("/api/v1", "") ??
  "http://localhost:8000";

// ── Exported types ────────────────────────────────────────────────────────────

export interface FilterState {
  oeoCoverage:   Set<string>;  // "full" | "partial" | "none"
  instanceScale: Set<string>;  // "single" | "few" | "many"
}

export type ActiveView = "catalogue" | "contributor" | "profile" | "admin";

interface SideNavBarProps {
  activeCategory: TechnologyCategory;
  onCategoryChange: (next: TechnologyCategory) => void;
  filters: FilterState;
  onFilterChange: Dispatch<SetStateAction<FilterState>>;
  onCollapsedChange?: (collapsed: boolean) => void;
  activeView: ActiveView;
  onViewChange: (next: ActiveView) => void;
  onLoginClick: () => void;
}

// ── Category definitions ──────────────────────────────────────────────────────

const CATEGORIES: { icon: string; label: string; value: TechnologyCategory }[] = [
  { icon: "bolt",                  label: "Generation",   value: "generation"   },
  { icon: "battery_charging_full", label: "Storage",      value: "storage"      },
  { icon: "settings",              label: "Conversion",   value: "conversion"   },
  { icon: "cable",                 label: "Transmission", value: "transmission" },
];

// ── Documentation quick-links ─────────────────────────────────────────────────

const DOC_LINKS = [
  { label: "Introduction & Goals",    file: "01-introduction-goals.md"    },
  { label: "Context & Scope",         file: "03-context-scope.md"         },
  { label: "Solution Strategy",       file: "04-solution-strategy.md"     },
  { label: "Architectural Decisions", file: "09-architectural-decisions.md" },
  { label: "Glossary",               file: "12-glossary.md"              },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toggleSetItem(set: Set<string>, item: string): Set<string> {
  const next = new Set(set);
  next.has(item) ? next.delete(item) : next.add(item);
  return next;
}

function SectionHeading({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-2 px-2 mb-1.5">
      <span className="material-symbols-outlined text-sm text-primary/70">{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface">
        {label}
      </span>
    </div>
  );
}

function FilterCheck({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className="flex items-center gap-2.5 px-2 py-1.5 rounded cursor-pointer select-none
                 text-sm font-medium text-on-surface-variant
                 hover:bg-surface-container transition-all hover:translate-x-0.5 group"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="rounded text-primary focus:ring-primary border-outline-variant/30 flex-shrink-0"
      />
      <span className="flex-1 leading-tight">{label}</span>
      {hint && (
        <span
          className="text-[10px] text-on-surface-variant/40 font-bold tabular-nums
                     group-hover:text-on-surface-variant/70 transition-colors"
        >
          {hint}
        </span>
      )}
    </label>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SideNavBar({
  activeCategory,
  onCategoryChange,
  filters,
  onFilterChange,
  onCollapsedChange,
  activeView,
  onViewChange,
  onLoginClick,
}: SideNavBarProps) {
  const { user } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const toggle = (group: keyof FilterState, value: string) =>
    onFilterChange((prev) => ({
      ...prev,
      [group]: toggleSetItem(prev[group], value),
    }));

  const handleCollapseToggle = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    onCollapsedChange?.(next);
  };

  const clearAll = () =>
    onFilterChange({ oeoCoverage: new Set(), instanceScale: new Set() });

  const activeFilterCount = filters.oeoCoverage.size + filters.instanceScale.size;

  // ── Collapsed: icon rail ──────────────────────────────────────────────────

  if (isCollapsed) {
    return (
      <aside
        aria-label="Sidebar (collapsed)"
        className="h-screen w-16 fixed left-0 top-0 bg-surface-container-low
                   border-r border-outline-variant/15 flex-col items-center
                   pt-4 pb-6 z-[60] gap-3 hidden lg:flex"
      >
        {/* Logo icon + expand */}
        <div className="relative flex items-center justify-center">
          <img src={logoIconOnly} alt="OPENTECH|DB" className="w-9 h-9 object-contain" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary rounded-full text-[9px]
                              text-on-primary font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </div>
        <button
          onClick={handleCollapseToggle}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="w-9 h-9 flex items-center justify-center rounded-full
                     hover:bg-surface-container transition-colors"
        >
          <span className="material-symbols-outlined text-on-surface-variant text-lg">last_page</span>
        </button>

        {/* Icons hints */}
        <div className="flex flex-col items-center gap-4 mt-2">
          {CATEGORIES.filter((c) => c.value !== activeCategory).map((c) => (
            <button
              key={c.value}
              title={c.label}
              onClick={() => { onViewChange("catalogue"); onCategoryChange(c.value); }}
              className="w-8 h-8 flex items-center justify-center rounded-full
                         hover:bg-surface-container transition-colors text-on-surface-variant/50 hover:text-on-surface-variant"
            >
              <span className="material-symbols-outlined text-lg">{c.icon}</span>
            </button>
          ))}
          <span title="OEO filters" className="material-symbols-outlined text-on-surface-variant/30 text-xl mt-2">hub</span>
          <span title="Data richness" className="material-symbols-outlined text-on-surface-variant/30 text-xl">layers</span>
          {/* Contribute shortcut */}
          <button
            title="Contributor Workspace"
            onClick={() => onViewChange("contributor")}
            className={[
              "w-8 h-8 flex items-center justify-center rounded-full transition-colors mt-2",
              activeView === "contributor"
                ? "bg-primary/15 text-primary"
                : "hover:bg-surface-container text-on-surface-variant/50 hover:text-on-surface-variant",
            ].join(" ")}
          >
            <span className="material-symbols-outlined text-lg">add_circle</span>
          </button>
          {/* Profile shortcut */}
          {user && (
            <button
              title="Profile Settings"
              onClick={() => onViewChange("profile")}
              className={[
                "w-8 h-8 flex items-center justify-center rounded-full transition-colors mt-1",
                activeView === "profile"
                  ? "bg-primary/15 text-primary"
                  : "hover:bg-surface-container text-on-surface-variant/50 hover:text-on-surface-variant",
              ].join(" ")}
            >
              <span className="material-symbols-outlined text-lg">manage_accounts</span>
            </button>
          )}
        </div>
      </aside>
    );
  }

  // ── Expanded ──────────────────────────────────────────────────────────────

  return (
    <aside
      aria-label="Sidebar navigation and filters"
      className="h-screen w-64 fixed left-0 top-0 bg-surface-container-low
                 border-r border-outline-variant/15 flex-col z-[60] hidden lg:flex"
    >
      {/* Brand + collapse */}
      <div className="relative flex items-center justify-center px-4 py-2 border-b border-outline-variant/10 flex-shrink-0">
        <img src={logoWithTitle} alt="OPENTECH|DB" className="h-16 w-auto object-contain" />
        <button
          onClick={handleCollapseToggle}
          aria-label="Collapse sidebar"
          className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors"
        >
          <span className="material-symbols-outlined text-on-surface-variant text-lg">first_page</span>
        </button>
      </div>

      {/* Active filter pill */}
      {activeFilterCount > 0 && (
        <div className="flex items-center justify-between px-4 py-2 bg-primary/5 border-b border-primary/10 flex-shrink-0">
          <span className="text-xs font-bold text-primary">
            {activeFilterCount} active filter{activeFilterCount !== 1 ? "s" : ""}
          </span>
          <button
            onClick={clearAll}
            className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant hover:text-primary transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Scrollable content */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5 min-h-0">

        {/* ── Categories ────────────────────────────────────────────────── */}
        <div>
          <SectionHeading icon="category" label="Technology Category" />
          {CATEGORIES.map(({ icon, label, value }) => {
            const isActive = activeView === "catalogue" && value === activeCategory;
            return (
              <button
                key={value}
                onClick={() => { onViewChange("catalogue"); onCategoryChange(value); }}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "w-full flex items-center gap-3 px-2 py-2 rounded text-sm font-medium transition-all text-left",
                  isActive
                    ? "bg-primary/10 text-primary font-bold border-l-2 border-primary pl-[6px]"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface hover:translate-x-0.5",
                ].join(" ")}
              >
                <span className={["material-symbols-outlined text-lg", isActive ? "text-primary" : ""].join(" ")}>
                  {icon}
                </span>
                {label}
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* ── OEO Coverage ──────────────────────────────────────────────── */}
        <div className="border-t border-outline-variant/10 pt-4">
          <SectionHeading icon="hub" label="OEO Coverage" />
          <FilterCheck
            label="Fully Mapped"
            hint="class + URI"
            checked={filters.oeoCoverage.has("full")}
            onChange={() => toggle("oeoCoverage", "full")}
          />
          <FilterCheck
            label="Class Only"
            hint="no URI"
            checked={filters.oeoCoverage.has("partial")}
            onChange={() => toggle("oeoCoverage", "partial")}
          />
          <FilterCheck
            label="Not Mapped"
            hint="null"
            checked={filters.oeoCoverage.has("none")}
            onChange={() => toggle("oeoCoverage", "none")}
          />
        </div>

        {/* ── Data Richness ──────────────────────────────────────────────── */}
        <div>
          <SectionHeading icon="layers" label="Data Richness" />
          {[
            { label: "Single Instance", hint: "n = 1", value: "single" },
            { label: "Few Variants",    hint: "2 – 5", value: "few"    },
            { label: "Rich Dataset",    hint: "≥ 6",   value: "many"   },
          ].map(({ label, hint, value }) => (
            <FilterCheck
              key={value}
              label={label}
              hint={hint}
              checked={filters.instanceScale.has(value)}
              onChange={() => toggle("instanceScale", value)}
            />
          ))}
        </div>

        {/* ── Contribute ────────────────────────────────────────────────── */}
        <div className="border-t border-outline-variant/10 pt-4">
          <SectionHeading icon="add_circle" label="Contribute" />
          {user ? (
            <button
              onClick={() => onViewChange("contributor")}
              aria-current={activeView === "contributor" ? "page" : undefined}
              className={[
                "w-full flex items-center gap-3 px-2 py-2 rounded text-sm font-medium transition-all text-left",
                activeView === "contributor"
                  ? "bg-primary/10 text-primary font-bold border-l-2 border-primary pl-[6px]"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface hover:translate-x-0.5",
              ].join(" ")}
            >
              <span className={["material-symbols-outlined text-lg", activeView === "contributor" ? "text-primary" : ""].join(" ")}>
                add
              </span>
              Add Technology
              {activeView === "contributor" && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
              )}
            </button>
          ) : (
            <button
              onClick={onLoginClick}
              className="w-full flex items-center gap-3 px-2 py-2 rounded text-sm font-medium
                         text-on-surface-variant hover:bg-surface-container hover:text-on-surface
                         hover:translate-x-0.5 transition-all text-left group"
            >
              <span className="material-symbols-outlined text-lg">lock</span>
              Sign in to contribute
              <span className="ml-auto text-[10px] font-bold uppercase tracking-wide
                               text-on-surface-variant/40 group-hover:text-primary/60
                               transition-colors">
                Sign in
              </span>
            </button>
          )}
          {/* Profile link — only when signed in */}
          {user && (
            <button
              onClick={() => onViewChange("profile")}
              aria-current={activeView === "profile" ? "page" : undefined}
              className={[
                "w-full flex items-center gap-3 px-2 py-2 rounded text-sm font-medium transition-all text-left mt-1",
                activeView === "profile"
                  ? "bg-primary/10 text-primary font-bold border-l-2 border-primary pl-[6px]"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface hover:translate-x-0.5",
              ].join(" ")}
            >
              <span className={["material-symbols-outlined text-lg", activeView === "profile" ? "text-primary" : ""].join(" ")}>
                manage_accounts
              </span>
              Profile Settings
              {activeView === "profile" && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
              )}
            </button>
          )}
        </div>

        {/* ── Documentation quick-links ──────────────────────────────────── */}
        <div className="border-t border-outline-variant/10 pt-4">
          <SectionHeading icon="article" label="Documentation" />
          {DOC_LINKS.map(({ label, file }) => (
            <a
              key={file}
              href={`${API_BASE}/project-docs/content/${file}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2 py-1.5 text-xs text-on-surface-variant
                         hover:bg-surface-container hover:text-primary rounded transition-all hover:translate-x-0.5 group"
            >
              <span className="material-symbols-outlined text-sm opacity-50 group-hover:opacity-100">
                chevron_right
              </span>
              {label}
            </a>
          ))}
          <a
            href={`${API_BASE}/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-on-surface-variant
                       hover:bg-surface-container hover:text-primary rounded transition-all hover:translate-x-0.5 group mt-1"
          >
            <span className="material-symbols-outlined text-sm opacity-50 group-hover:opacity-100">api</span>
            API Reference (Swagger)
          </a>
        </div>
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-outline-variant/10 space-y-1 flex-shrink-0">
        <a
          href={`${API_BASE}/redoc`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-on-surface-variant
                     hover:bg-surface-container rounded transition-all hover:translate-x-0.5"
        >
          <span className="material-symbols-outlined text-sm">description</span> ReDoc
        </a>
        <a
          href="https://openenergy-platform.org/ontology/oeo/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-on-surface-variant
                     hover:bg-surface-container rounded transition-all hover:translate-x-0.5"
        >
          <span className="material-symbols-outlined text-sm">hub</span> OEO Ontology
        </a>
      </div>
    </aside>
  );
}


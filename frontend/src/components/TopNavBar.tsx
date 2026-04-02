/**
 * components/TopNavBar.tsx
 * ─────────────────────────
 * Sticky top bar: brand mark, contextual nav links, search, action icons.
 * Categories have moved to SideNavBar; this bar exposes cross-cutting
 * concerns (API docs, ontology reference, GitHub, search).
 */

import { useId } from "react";
import type { Dispatch, SetStateAction } from "react";

// Base URL for the backend (same as services/api.ts reads from env)
const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace("/api/v1", "") ?? "http://localhost:8000";

const NAV_LINKS = [
  {
    label:    "Catalogue",
    href:     "#",
    icon:     "grid_view",
    active:   true,
    external: false,
  },
  {
    label:  "API Reference",
    href:   `${API_BASE}/docs`,
    icon:   "api",
    active: false,
    external: true,
  },
  {
    label:  "ReDoc",
    href:   `${API_BASE}/redoc`,
    icon:   "description",
    active: false,
    external: true,
  },
  {
    label:  "OEO Ontology",
    href:   "https://openenergy-platform.org/ontology/oeo/",
    icon:   "hub",
    active: false,
    external: true,
  },
  {
    label:  "Project Docs",
    href:   `${API_BASE}/project-docs/content/01-introduction-goals.md`,
    icon:   "article",
    active: false,
    external: true,
  },
] as const;

interface TopNavBarProps {
  searchQuery: string;
  onSearchChange: Dispatch<SetStateAction<string>>;
}

export default function TopNavBar({ searchQuery, onSearchChange }: TopNavBarProps) {
  const searchId = useId();

  return (
    <header className="bg-surface-container-low font-headline text-on-surface top-0 z-50 sticky border-b border-outline-variant/15">
      <div className="flex justify-between items-center w-full px-8 py-3 max-w-[1440px] mx-auto">

        {/* Brand + Nav links */}
        <div className="flex items-center gap-10">
          <div className="flex flex-col leading-none">
            <span className="text-xl font-bold tracking-tighter text-on-surface">opentech-db</span>
            <span className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant/60 mt-0.5">
              OEO-aligned Energy Parameters
            </span>
          </div>

          <nav aria-label="Main navigation" className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map(({ label, href, icon, active, external }) => (
              <a
                key={label}
                href={href}
                target={external ? "_blank" : undefined}
                rel={external ? "noopener noreferrer" : undefined}
                className={[
                  "flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors",
                  active
                    ? "text-primary bg-primary/8 font-bold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container",
                ].join(" ")}
              >
                <span className="material-symbols-outlined text-[16px]">{icon}</span>
                {label}
                {external && (
                  <span className="material-symbols-outlined text-[11px] opacity-40">open_in_new</span>
                )}
              </a>
            ))}
          </nav>
        </div>

        {/* Search + GitHub icon */}
        <div className="flex items-center gap-3">
          <div className="relative hidden lg:block">
            <label htmlFor={searchId} className="sr-only">Search parameters</label>
            <input
              id={searchId}
              type="search"
              placeholder="Search technologies…"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="bg-surface-container border-none rounded-lg pl-9 pr-4 py-2 text-sm w-64
                         focus:outline-none focus:ring-2 focus:ring-primary/30 text-on-surface
                         placeholder:text-on-surface-variant/50"
            />
            <span
              aria-hidden="true"
              className="material-symbols-outlined absolute left-2.5 top-2 text-on-surface-variant text-[18px]"
            >
              search
            </span>
          </div>

          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            title="GitHub repository"
            className="p-2 rounded-full hover:bg-surface-container transition-colors text-on-surface-variant hover:text-on-surface"
          >
            {/* Simple GitHub SVG mark (no dependency needed) */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.483 0-.237-.009-.868-.014-1.703-2.782.605-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.004.07 1.532 1.032 1.532 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.349-1.088.635-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.03-2.682-.103-.253-.447-1.27.098-2.646 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844a9.59 9.59 0 012.504.337c1.909-1.294 2.747-1.025 2.747-1.025.547 1.376.202 2.394.1 2.646.64.698 1.026 1.591 1.026 2.682 0 3.841-2.337 4.687-4.565 4.935.359.309.678.919.678 1.852 0 1.337-.012 2.415-.012 2.744 0 .268.18.58.688.482A10.001 10.001 0 0022 12c0-5.523-4.477-10-10-10z"/>
            </svg>
          </a>

          <button
            aria-label="User account"
            className="p-2 rounded-full hover:bg-surface-container transition-colors text-on-surface-variant hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[20px]">account_circle</span>
          </button>
        </div>
      </div>
    </header>
  );
}


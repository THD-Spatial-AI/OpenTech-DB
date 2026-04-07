/**
 * components/TopNavBar.tsx
 * ─────────────────────────
 * Sticky top bar: brand mark, contextual nav links, search, action icons.
 * Categories have moved to SideNavBar; this bar exposes cross-cutting
 * concerns (API docs, ontology reference, GitHub, search).
 */

import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import type { ActiveView } from "./SideNavBar";

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
  onLoginClick: () => void;
  onViewChange: (v: ActiveView) => void;
  activeView: ActiveView;
}

export default function TopNavBar({ onLoginClick, onViewChange, activeView }: TopNavBarProps) {
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="bg-surface-container-low font-headline text-on-surface top-0 z-50 sticky border-b border-outline-variant/15">
      <div className="flex items-center w-full px-8 py-3 max-w-[1440px] mx-auto gap-4">

        {/* Brand + Nav links */}
        <div className="flex items-center gap-6 min-w-0 flex-1">
          <div className="flex flex-col leading-none flex-shrink-0">
            <span className="text-xl font-bold tracking-tighter text-on-surface">OpenTech DB</span>
            <span className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant/60 mt-0.5">
              OEO-aligned Energy Parameters
            </span>
          </div>

          <nav aria-label="Main navigation" className="hidden md:flex items-center gap-1 min-w-0 overflow-hidden">
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

        {/* GitHub icon + Auth area */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
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

          {/* ── Auth area ────────────────────────────────────────────────── */}
          {user ? (
            // ─ Signed-in user pill + dropdown
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="true"
                aria-expanded={menuOpen}
                aria-label={`Signed in as ${user.username}`}
                className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full
                           hover:bg-surface-container transition-colors
                           border border-outline-variant/30 text-sm font-medium
                           text-on-surface max-w-[220px]"
              >
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt=""
                    className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <span className="material-symbols-outlined text-[20px] text-primary">
                    account_circle
                  </span>
                )}
                <span className="hidden sm:inline max-w-[80px] truncate">
                  {user.username}
                </span>
                <span className="material-symbols-outlined text-[14px] text-on-surface-variant">
                  {menuOpen ? "expand_less" : "expand_more"}
                </span>
              </button>

              {/* Dropdown */}
              {menuOpen && (
                <>
                  {/* Backdrop — click outside to close */}
                  <div
                    className="fixed inset-0 z-[70]"
                    aria-hidden
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+8px)] z-[80] w-52
                               bg-surface-container-lowest rounded-xl border border-outline-variant/20
                               shadow-xl shadow-on-surface/10 py-1.5 overflow-hidden"
                  >
                    {/* User info */}
                    <div className="px-4 py-3 border-b border-outline-variant/10">
                      <p className="text-sm font-bold text-on-surface truncate">{user.username}</p>
                      <p className="text-xs text-on-surface-variant truncate mt-0.5">{user.email}</p>
                      {user.is_contributor && (
                        <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold
                                         text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                          <span className="material-symbols-outlined text-[11px]">verified</span>
                          Contributor
                        </span>
                      )}
                    </div>

                    {user.is_contributor && (
                      <button
                        role="menuitem"
                        onClick={() => { setMenuOpen(false); onViewChange("contributor"); }}
                        className={[
                          "w-full flex items-center gap-2.5 px-4 py-2.5 text-sm",
                          "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                          "transition-colors text-left",
                          activeView === "contributor" ? "text-primary font-semibold" : "",
                        ].join(" ")}
                      >
                        <span className="material-symbols-outlined text-[17px]">add_circle</span>
                        Add Technology
                      </button>
                    )}

                    <button
                      role="menuitem"
                      onClick={() => { setMenuOpen(false); onViewChange("profile"); }}
                      className={[
                        "w-full flex items-center gap-2.5 px-4 py-2.5 text-sm",
                        "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                        "transition-colors text-left",
                        activeView === "profile" ? "text-primary font-semibold" : "",
                      ].join(" ")}
                    >
                      <span className="material-symbols-outlined text-[17px]">manage_accounts</span>
                      Profile Settings
                    </button>

                    <button
                      role="menuitem"
                      onClick={() => { setMenuOpen(false); signOut(); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm
                                 text-tertiary hover:bg-tertiary-container/30
                                 transition-colors text-left"
                    >
                      <span className="material-symbols-outlined text-[17px]">logout</span>
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            // ─ Not signed in
            <button
              onClick={onLoginClick}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold
                         bg-primary text-on-primary hover:bg-primary-container
                         transition-all shadow-sm hover:shadow-md active:scale-[0.98]"
            >
              <span className="material-symbols-outlined text-[16px]">login</span>
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}


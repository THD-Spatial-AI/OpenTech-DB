/**
 * App.tsx
 * ────────
 * Root application shell for opentech-db frontend.
 *
 * Layout
 * ──────
 * ┌──────────────────────────────────────────────┐
 * │  SideNavBar (fixed, 256 px, hidden on mobile) │
 * │  ┌────────────────────────────────────────┐   │
 * │  │  TopNavBar (sticky, full width)        │   │
 * │  ├────────────────────────────────────────┤   │
 * │  │  <main>                                │   │
 * │  │    Hero title section                  │   │
 * │  │    <Suspense>                          │   │
 * │  │      CategoryContent                   │   │
 * │  │    </Suspense>                         │   │
 * │  │  </main>                               │   │
 * │  │  <footer>                              │   │
 * │  └────────────────────────────────────────┘   │
 * │  DetailsModal (fixed overlay)                  │
 * └──────────────────────────────────────────────┘
 *
 * React 19 patterns
 * ─────────────────
 * - startTransition wraps category changes so the current grid stays
 *   visible while the next category's data loads (no flicker).
 * - useDeferredValue defers the search query so typing stays responsive.
 * - <Suspense> + use() in TechGrid handles async data fetching.
 * - useOptimistic is used inside DetailsModal for share-button toast.
 * - Document metadata placed directly in the component (React 19 feature).
 */

import { startTransition, Suspense, use, useDeferredValue, useState } from "react";
import type { TechnologyCategory, TechnologySummary } from "./types/api";
import { fetchCategoryTechnologies, invalidateCategory } from "./services/api";
import logoWithTitle from "./assets/icon_title.png";

import SideNavBar, { type FilterState, type ActiveView } from "./components/SideNavBar";
import TopNavBar from "./components/TopNavBar";
import TechGrid from "./components/TechGrid";
import MetadataTable from "./components/MetadataTable";
import DetailsModal from "./components/DetailsModal";
import ErrorBoundary from "./components/ErrorBoundary";
import ContributorWorkspace from "./components/contributor/ContributorWorkspace";
import ProfilePage from "./components/profile/ProfilePage";
import AuthPage from "./components/auth/AuthPage";
import OAuthCallback from "./components/auth/OAuthCallback";
import AdminPanel from "./components/admin/AdminPanel";
import TimeSeriesCatalogue from "./components/timeseries/TimeSeriesCatalogue";
import { useAuth } from "./context/AuthContext";

// ── Grid loading skeleton ─────────────────────────────────────────────────────

function GridSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex gap-4 mb-10 pb-6 border-b border-outline-variant/15">
        <div className="h-6 bg-surface-container-high rounded w-32" />
        <div className="h-6 bg-surface-container rounded w-40" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-container-lowest rounded-xl overflow-hidden h-80"
          >
            <div className="h-48 bg-surface-container-high" />
            <div className="p-6 space-y-3">
              <div className="h-5 bg-surface-container-high rounded w-3/4" />
              <div className="h-4 bg-surface-container rounded w-full" />
              <div className="h-4 bg-surface-container rounded w-5/6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── CategoryContent — rendered inside Suspense ────────────────────────────────
// Uses a single `use()` call so that both TechGrid and MetadataTable share
// the same resolved data without a second network request.

function CategoryContent({
  category,
  searchQuery,
  filters,
  onOpenTech,
}: {
  category: TechnologyCategory;
  searchQuery: string;
  filters: FilterState;
  onOpenTech: (tech: TechnologySummary) => void;
}) {
  const { technologies } = use(fetchCategoryTechnologies(category));

  return (
    <>
      <TechGrid
        category={category}
        searchQuery={searchQuery}
        filters={filters}
        onOpenTech={onOpenTech}
      />
      <MetadataTable technologies={technologies} />
    </>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

const DEFAULT_FILTERS: FilterState = {
  oeoCoverage:   new Set(),
  instanceScale: new Set(),
};

export default function App() {
  const [activeCategory, setActiveCategory] =
    useState<TechnologyCategory>("generation");
  const [searchQuery, setSearchQuery]       = useState("");
  const [selectedTech, setSelectedTech]     = useState<TechnologySummary | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeView, setActiveView]         = useState<ActiveView>("catalogue");
  const [showAuth, setShowAuth]             = useState(false);
  const [authInitialError, setAuthInitialError] = useState<string | undefined>();

  // Filters are always empty — the filter UI was removed from the sidebar.
  // Kept as a stable constant so TechGrid's prop type is satisfied.
  const filters = DEFAULT_FILTERS;

  const { user } = useAuth();

  // useDeferredValue keeps typing responsive while Suspense re-renders
  const deferredSearch = useDeferredValue(searchQuery);

  // Wrap category change in startTransition so the UI doesn't suspend abruptly
  const handleCategoryChange = (next: TechnologyCategory) => {
    startTransition(() => {
      invalidateCategory(next); // force a fresh fetch on every tab-switch
      setActiveCategory(next);
    });
  };

  return (
    // React 19: <title>/<meta> are hoisted to <head> automatically
    <>
      <title>
        {activeView === "contributor"
          ? "OpenTech DB | Contributor Workspace"
          : activeView === "profile"
          ? "OpenTech DB | Profile Settings"
          : activeView === "admin"
          ? "OpenTech DB | Admin Panel"
          : activeView === "timeseries"
          ? "OpenTech DB | Time Series & Profiles"
          : "OpenTech DB | Technology Catalogue"}
      </title>
      <meta
        name="description"
        content="OEO-aligned open energy technology parameter database."
      />

      {/* Handles ?token= from ORCID OAuth redirect; ?auth_error= from failed OAuth */}
      <OAuthCallback
        onAuthError={(msg) => {
          setAuthInitialError(msg);
          setShowAuth(true);
        }}
      />

      {/* Full-page auth overlay */}
      {showAuth && !user && (
        <AuthPage
          onSuccess={() => { setShowAuth(false); setAuthInitialError(undefined); }}
          initialError={authInitialError}
        />
      )}

      <div className={showAuth && !user ? "hidden" : "bg-surface font-body text-on-surface antialiased min-h-screen"}>
        {/* ── Side nav ──────────────────────────────────────────────── */}
        <SideNavBar
          activeCategory={activeCategory}
          onCategoryChange={handleCategoryChange}
          onCollapsedChange={setSidebarCollapsed}
          activeView={activeView}
          onViewChange={setActiveView}
          onLoginClick={() => setShowAuth(true)}
        />

        {/* ── Main wrapper — offset by the fixed side nav on lg ─────── */}
        <div className={`${sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"} flex flex-col min-h-screen transition-[margin] duration-300`}>

          <TopNavBar
            onLoginClick={() => setShowAuth(true)}
            onViewChange={setActiveView}
            activeView={activeView}
          />

          {/* ── Page content ─────────────────────────────────────────── */}
          {activeView === "contributor" ? (
            <ContributorWorkspace key={user?.id ?? "anon"} />
          ) : activeView === "profile" ? (
            <ProfilePage onViewChange={setActiveView} />          ) : activeView === "admin" ? (
            <AdminPanel />          ) : activeView === "timeseries" ? (
            <TimeSeriesCatalogue />
          ) : (
            <main className="max-w-[1440px] mx-auto px-8 py-12 w-full flex-1">

              {/* Hero */}
              <section className="mb-12">
                <h1 className="font-headline text-5xl font-bold tracking-tight mb-4 text-on-surface">
                  Technology Catalogue
                </h1>
                <p className="text-on-surface-variant max-w-2xl text-lg leading-relaxed mb-6">
                  A standardised repository of technical and economic parameters for energy
                  system modelling, strictly aligned with the Open Energy Ontology (OEO).
                </p>
                {/* Search bar — inline under the hero title */}
                <div className="relative max-w-md">
                  <label htmlFor="catalogue-search" className="sr-only">Search technologies</label>
                  <input
                    id="catalogue-search"
                    type="search"
                    placeholder="Search technologies…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-surface-container-lowest border border-outline-variant/30
                               rounded-xl pl-10 pr-4 py-3 text-sm text-on-surface
                               placeholder:text-on-surface-variant/50
                               focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50
                               shadow-sm transition-all"
                  />
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined absolute left-3 top-3 text-on-surface-variant/60 text-[20px]"
                  >
                    search
                  </span>
                </div>
              </section>

              {/* Data grid — ErrorBoundary catches API failures gracefully */}
              <ErrorBoundary context={activeCategory}>
                <Suspense fallback={<GridSkeleton />}>
                  <CategoryContent
                    category={activeCategory}
                    searchQuery={deferredSearch}
                    filters={filters}
                    onOpenTech={setSelectedTech}
                  />
                </Suspense>
              </ErrorBoundary>
            </main>
          )}

          {/* ── Footer ───────────────────────────────────────────────── */}
          <footer className="bg-surface-container-low border-t border-outline-variant/15 px-8 py-12">
            <div className="max-w-[1440px] mx-auto flex flex-col md:flex-row justify-between gap-8">
              <div className="max-w-xs">
                <div className="flex items-center gap-3 mb-1">
                  <img src={logoWithTitle} alt="OPENTECH|DB" className="h-14 w-auto object-contain" />
                  <span className="font-headline font-bold text-on-surface text-lg">OPENTECH | DB</span>
                </div>
                <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">
                  Open-source energy technology database for researchers, policymakers, and
                  energy system modellers worldwide.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-8 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface mb-3">
                    Resources
                  </p>
                  {["Documentation", "API Reference", "Methodology"].map((l) => (
                    <a
                      key={l}
                      href="#"
                      className="block text-on-surface-variant hover:text-primary mb-2 transition-colors"
                    >
                      {l}
                    </a>
                  ))}
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface mb-3">
                    Community
                  </p>
                  {["GitHub Repository", "Discussions", "Support"].map((l) => (
                    <a
                      key={l}
                      href="#"
                      className="block text-on-surface-variant hover:text-primary mb-2 transition-colors"
                    >
                      {l}
                    </a>
                  ))}
                </div>
              </div>
            </div>
            <div
              className="max-w-[1440px] mx-auto mt-8 pt-8 border-t border-outline-variant/15
                          flex justify-between text-[11px] text-on-surface-variant"
            >
              <span>© 2024 OpenTech Energy Consortium</span>
              <span>All data licensed under CC BY 4.0</span>
            </div>
          </footer>
        </div>

        {/* ── Details modal (fixed overlay) ─────────────────────────── */}
        <DetailsModal tech={selectedTech} onClose={() => setSelectedTech(null)} />
      </div>
    </>
  );
}


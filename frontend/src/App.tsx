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

import SideNavBar, { type FilterState } from "./components/SideNavBar";
import TopNavBar from "./components/TopNavBar";
import TechGrid from "./components/TechGrid";
import MetadataTable from "./components/MetadataTable";
import DetailsModal from "./components/DetailsModal";
import ErrorBoundary from "./components/ErrorBoundary";

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
  const [filters, setFilters]               = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedTech, setSelectedTech]     = useState<TechnologySummary | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
      <title>opentech-db | Technology Catalogue</title>
      <meta
        name="description"
        content="OEO-aligned open energy technology parameter database."
      />

      <div className="bg-surface font-body text-on-surface antialiased min-h-screen">
        {/* ── Side nav ──────────────────────────────────────────────── */}
        <SideNavBar
          activeCategory={activeCategory}
          onCategoryChange={handleCategoryChange}
          filters={filters}
          onFilterChange={setFilters}
          onCollapsedChange={setSidebarCollapsed}
        />

        {/* ── Main wrapper — offset by the fixed side nav on lg ─────── */}
        <div className={`${sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"} flex flex-col min-h-screen transition-[margin] duration-300`}>

          <TopNavBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />

          {/* ── Page content ─────────────────────────────────────────── */}
          <main className="max-w-[1440px] mx-auto px-8 py-12 w-full flex-1">

            {/* Hero */}
            <section className="mb-12">
              <h1 className="font-headline text-5xl font-bold tracking-tight mb-4 text-on-surface">
                Technology Catalogue
              </h1>
              <p className="text-on-surface-variant max-w-2xl text-lg leading-relaxed">
                A standardised repository of technical and economic parameters for energy
                system modelling, strictly aligned with the Open Energy Ontology (OEO).
              </p>
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

          {/* ── Footer ───────────────────────────────────────────────── */}
          <footer className="bg-surface-container-low border-t border-outline-variant/15 px-8 py-12">
            <div className="max-w-[1440px] mx-auto flex flex-col md:flex-row justify-between gap-8">
              <div className="max-w-xs">
                <span className="font-headline font-bold text-on-surface text-lg">
                  opentech-db
                </span>
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


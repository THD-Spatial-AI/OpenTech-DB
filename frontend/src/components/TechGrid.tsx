/**
 * components/TechGrid.tsx
 * ────────────────────────
 * Renders the grid of TechCards for a category.
 *
 * React 19: placed inside a <Suspense> boundary in App.tsx.
 * Calls `use()` with the cached Promise from `fetchCategoryTechnologies()`.
 * The API returns { total, technologies: TechnologySummary[] } — lightweight
 * summaries.  Full instance data is fetched only when a modal is opened.
 */

import { use } from "react";
import type { TechnologySummary, TechnologyCategory } from "../types/api";
import type { FilterState } from "./SideNavBar";
import { fetchCategoryTechnologies } from "../services/api";
import TechCard from "./TechCard";

// ── Client-side filtering ─────────────────────────────────────────────────────

function applyFilters(
  techs: TechnologySummary[],
  searchQuery: string,
  filters: FilterState
): TechnologySummary[] {
  return techs.filter((tech) => {
    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matches =
        tech.name.toLowerCase().includes(q) ||
        tech.category.toLowerCase().includes(q) ||
        (tech.oeo_class ?? "").toLowerCase().includes(q);
      if (!matches) return false;
    }

    // OEO coverage filter (3-way)
    if (filters.oeoCoverage.size > 0) {
      let bucket: string;
      if (tech.oeo_class != null && tech.oeo_uri != null) bucket = "full";
      else if (tech.oeo_class != null)                    bucket = "partial";
      else                                                bucket = "none";
      if (!filters.oeoCoverage.has(bucket)) return false;
    }

    // Instance scale filter
    if (filters.instanceScale.size > 0) {
      const n = tech.n_instances;
      const bucket = n === 1 ? "single" : n <= 5 ? "few" : "many";
      if (!filters.instanceScale.has(bucket)) return false;
    }

    return true;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TechGridProps {
  category: TechnologyCategory;
  searchQuery: string;
  filters: FilterState;
  onOpenTech: (tech: TechnologySummary) => void;
}

export default function TechGrid({
  category,
  searchQuery,
  filters,
  onOpenTech,
}: TechGridProps) {
  // React 19: `use()` suspends here until the Promise resolves.
  const { technologies, total } = use(fetchCategoryTechnologies(category));

  const filtered = applyFilters(technologies, searchQuery, filters);

  return (
    <section>
      {/* Filter bar summary */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center
                      gap-6 mb-10 border-b border-outline-variant/15 pb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="bg-primary/10 text-primary px-3 py-1 text-xs font-bold rounded-sm
                           border border-primary/20 uppercase tracking-tighter">
            Active: {category}
          </span>
          <span className="bg-surface-container-highest text-on-surface-variant px-3 py-1
                           text-xs font-bold rounded-sm uppercase tracking-tighter">
            {filtered.length} / {total} Technologies
          </span>
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <span className="material-symbols-outlined text-5xl text-outline mb-4">
            search_off
          </span>
          <p className="font-headline text-xl font-bold text-on-surface mb-2">
            No technologies found
          </p>
          <p className="text-on-surface-variant text-sm max-w-xs">
            Try adjusting your search query or clearing the active filters.
          </p>
        </div>
      )}

      {/* Cards grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-8">
          {filtered.map((tech) => (
            <TechCard key={tech.id} tech={tech} onOpen={onOpenTech} />
          ))}
        </div>
      )}
    </section>
  );
}


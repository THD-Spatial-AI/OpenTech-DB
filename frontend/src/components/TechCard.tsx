/**
 * components/TechCard.tsx
 * ────────────────────────
 * A single technology card in the grid.
 *
 * Receives a TechnologySummary (the lightweight object returned by the
 * category list endpoint).  Full instance data is only loaded in the
 * DetailsModal, which calls the individual technology endpoint.
 *
 * Design: "Kinetic Monolith" — grayscale hero image that desaturates
 * on hover, tonal depth (no border lines), Space Grotesk numbers.
 */

import type { TechnologyCategory, TechnologySummary } from "../types/api";

// ── Category → human-readable carrier chip colour ────────────────────────────

const CATEGORY_CHIP: Record<TechnologyCategory, { label: string; className: string }> = {
  generation:   { label: "Generation",   className: "text-primary" },
  storage:      { label: "Storage",      className: "text-secondary" },
  conversion:   { label: "Conversion",   className: "text-on-surface-variant" },
  transmission: { label: "Transmission", className: "text-tertiary" },
};

// ── Deterministic hero image from Picsum (seeded by tech id) ─────────────────

function heroSrc(id: string): string {
  const seed = [...id].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 500;
  return `https://picsum.photos/seed/${seed}/600/300`;
}

// ── OEO class short display ───────────────────────────────────────────────────

function shortOeo(oeoClass: string | null): string {
  if (!oeoClass) return "—";
  // Strip "OEO_" prefix for a cleaner display
  return oeoClass.replace(/^OEO_/, "");
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TechCardProps {
  tech: TechnologySummary;
  onOpen: (tech: TechnologySummary) => void;
}

export default function TechCard({ tech, onOpen }: TechCardProps) {
  const chip = CATEGORY_CHIP[tech.category] ?? CATEGORY_CHIP.generation;

  return (
    <article
      className="group bg-surface-container-lowest flex flex-col h-full rounded-xl
                 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5"
    >
      {/* Hero image */}
      <div className="h-48 overflow-hidden rounded-t-xl relative">
        <img
          src={heroSrc(tech.id)}
          alt={tech.name}
          loading="lazy"
          className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
        />

        {/* Category chip */}
        <div className="absolute top-4 left-4">
          <span className={`bg-surface-container-lowest/90 backdrop-blur px-3 py-1
                            text-[10px] font-bold uppercase tracking-widest rounded-full shadow-sm
                            ${chip.className}`}>
            {chip.label}
          </span>
        </div>

        {/* Instance count badge */}
        <div className="absolute top-4 right-4">
          <span className="bg-surface-container-lowest/90 backdrop-blur pl-2 pr-2.5 py-1
                           text-[10px] font-bold uppercase tracking-widest text-on-surface-variant
                           rounded-full shadow-sm flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[13px]">dataset</span>
            {tech.n_instances} instances
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 flex flex-col flex-grow">
        <div className="flex justify-between items-start mb-3">
          <h3 className="font-headline text-xl font-bold text-on-surface leading-tight">
            {tech.name}
          </h3>
          {tech.oeo_uri && (
            <a
              href={tech.oeo_uri}
              target="_blank"
              rel="noopener noreferrer"
              title="View OEO class"
              aria-label={`OEO ontology link for ${tech.name}`}
              className="text-on-surface-variant hover:text-primary transition-colors flex-shrink-0"
            >
              <span className="material-symbols-outlined text-lg">account_tree</span>
            </a>
          )}
        </div>

        {/* OEO class display */}
        {tech.oeo_class && (
          <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-4">
            OEO: {shortOeo(tech.oeo_class)}
          </p>
        )}

        {/* Metrics grid + CTA */}
        <div className="mt-auto pt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 pb-4">
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-on-surface-variant font-bold mb-1">
                Instances
              </span>
              <span className="font-headline font-bold text-lg">{tech.n_instances}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-on-surface-variant font-bold mb-1">
                Domain
              </span>
              <span className="font-headline font-bold text-lg capitalize">{tech.category}</span>
            </div>
          </div>

          <button
            onClick={() => onOpen(tech)}
            aria-label={`View parameters for ${tech.name}`}
            className="technical-gradient text-on-primary w-full py-3 text-sm font-bold rounded-lg
                       flex items-center justify-center gap-2
                       group-hover:shadow-lg group-hover:shadow-primary/20 transition-all
                       focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="material-symbols-outlined text-sm">analytics</span>
            View Parameters
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>
      </div>
    </article>
  );
}


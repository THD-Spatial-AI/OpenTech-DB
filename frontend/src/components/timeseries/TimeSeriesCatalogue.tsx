/**
 * components/timeseries/TimeSeriesCatalogue.tsx
 *
 * Layout
 * ──────
 *  ┌─ page-wide top bar: title · search · type-chips ───────────────────┐
 *  ├─ profile selector strip (horizontal scroll, grouped by type) ───────┤
 *  └─ chart pane  ← fills ALL remaining height, full width ─────────────┘
 *
 * The profile list is a compact horizontal strip at the top.
 * The chart is the hero — it takes every pixel below the strip.
 */

import {
  Suspense,
  use,
  useState,
  useMemo,
  useRef,
  useTransition,
  useCallback,
} from "react";
import type { TimeSeriesProfile, ProfileType } from "../../types/timeseries";
import { fetchTimeSeriesCatalogue, fetchTimeSeriesData } from "../../services/timeseries";
import ProfileViewer from "./ProfileViewer";
import ErrorBoundary from "../ErrorBoundary";

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────
const PROFILE_TYPES: { value: ProfileType; label: string; icon: string }[] = [
  { value: "capacity_factor", label: "Cap. Factor",  icon: "speed"             },
  { value: "generation",      label: "Generation",   icon: "bolt"              },
  { value: "load",            label: "Load",         icon: "electric_meter"    },
  { value: "weather",         label: "Weather",      icon: "partly_cloudy_day" },
  { value: "price",           label: "Price",        icon: "payments"          },
];

const TYPE_META: Record<string, { chip: string; dot: string; border: string }> = {
  capacity_factor: { chip: "bg-amber-100 text-amber-700",   dot: "bg-amber-400",   border: "border-amber-300"  },
  generation:      { chip: "bg-green-100 text-green-700",   dot: "bg-green-500",   border: "border-green-300"  },
  load:            { chip: "bg-blue-100 text-blue-700",     dot: "bg-blue-500",    border: "border-blue-300"   },
  weather:         { chip: "bg-sky-100 text-sky-700",       dot: "bg-sky-500",     border: "border-sky-300"    },
  price:           { chip: "bg-purple-100 text-purple-700", dot: "bg-purple-500",  border: "border-purple-300" },
};
const fallbackMeta = { chip: "bg-surface-container text-on-surface-variant", dot: "bg-on-surface-variant/30", border: "border-outline-variant/20" };
const tm = (t: string) => TYPE_META[t] ?? fallbackMeta;

// ─────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────
function StripSkeleton() {
  return (
    <div className="animate-pulse">
      {/* top bar */}
      <div className="h-12 bg-surface-container-low border-b border-outline-variant/15" />
      {/* strip */}
      <div className="flex gap-2 px-4 py-2 border-b border-outline-variant/15">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-8 w-28 bg-surface-container rounded-lg flex-shrink-0" />
        ))}
      </div>
      {/* chart area */}
      <div className="flex-1 bg-surface-container/30 m-4 rounded-2xl" style={{ minHeight: 400 }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ProfileChip — single selectable item in the horizontal strip
// ─────────────────────────────────────────────────────────────────────
function ProfileChip({
  profile,
  isSelected,
  isPending,
  onSelect,
}: {
  profile: TimeSeriesProfile;
  isSelected: boolean;
  isPending: boolean;
  onSelect: () => void;
}) {
  const meta = tm(profile.type);
  return (
    <button
      onClick={onSelect}
      aria-pressed={isSelected}
      title={`${profile.name} · ${profile.location} · ${profile.unit}`}
      className={[
        "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-left",
        "transition-all flex-shrink-0 max-w-[180px] group",
        isSelected
          ? `${meta.chip} ${meta.border} ring-2 ring-offset-1 ring-current shadow-sm`
          : "border-outline-variant/20 bg-surface-container-lowest hover:bg-surface-container hover:border-outline-variant/40",
        isPending && isSelected ? "opacity-60" : "",
      ].join(" ")}
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
      <span className={[
        "text-[11px] font-semibold leading-tight truncate",
        isSelected ? "" : "text-on-surface",
      ].join(" ")}>
        {profile.name}
      </span>
      <span className="text-[9px] font-mono opacity-50 flex-shrink-0 hidden sm:block">{profile.location}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CatalogueContent — calls use(), inside Suspense
// ─────────────────────────────────────────────────────────────────────
function CatalogueContent({
  cataloguePromise,
  query,
  activeType,
  selectedProfileId,
  onSelectProfile,
  onDeleteProfile,
  isPending,
}: {
  cataloguePromise: Promise<{ total: number; profiles: TimeSeriesProfile[] }>;
  query: string;
  activeType: ProfileType | null;
  selectedProfileId: string | null;
  onSelectProfile: (p: TimeSeriesProfile) => void;
  onDeleteProfile: (id: string) => void;
  isPending: boolean;
}) {
  const { profiles } = use(cataloguePromise);

  // Filter
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    let result = profiles;
    if (activeType) result = result.filter((p) => p.type === activeType);
    if (q) result = result.filter(
      (p) => p.name.toLowerCase().includes(q) ||
             p.location.toLowerCase().includes(q) ||
             (p.carrier ?? "").toLowerCase().includes(q)
    );
    return result;
  }, [profiles, activeType, q]);

  // Group by type (preserve PROFILE_TYPES order)
  const groups = useMemo(() => {
    const map = new Map<ProfileType, TimeSeriesProfile[]>();
    for (const pt of PROFILE_TYPES) map.set(pt.value, []);
    for (const p of filtered) {
      const arr = map.get(p.type as ProfileType) ?? [];
      arr.push(p);
      map.set(p.type as ProfileType, arr);
    }
    return map;
  }, [filtered]);

  // Selected profile + data promise
  const selectedProfile = useMemo(
    () => profiles.find((p) => p.profile_id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );
  const dataPromise = useMemo(
    () => selectedProfileId ? fetchTimeSeriesData(selectedProfileId) : null,
    [selectedProfileId]
  );

  // Horizontal scroll ref for strip
  const stripRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">

      {/* ── PROFILE SELECTOR STRIP ──────────────────────────────── */}
      <div
        ref={stripRef}
        className="flex-shrink-0 border-b border-outline-variant/15 bg-surface-container-low/50"
      >
        {filtered.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-2 text-xs text-on-surface-variant/50">
            <span className="material-symbols-outlined text-[14px]">search_off</span>
            No profiles match
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Render each type group as a labeled horizontal row */}
            <div className="flex flex-col gap-0 divide-y divide-outline-variant/10 min-w-0">
              {PROFILE_TYPES.map(({ value: type, label, icon }) => {
                const items = groups.get(type) ?? [];
                if (items.length === 0) return null;
                const meta = tm(type);
                return (
                  <div key={type} className="flex items-center gap-2 px-3 py-1.5 min-w-max">
                    {/* Group label */}
                    <div className={`flex items-center gap-1 flex-shrink-0 w-28 ${meta.chip} rounded-lg px-2 py-0.5`}>
                      <span className="material-symbols-outlined text-[12px]">{icon}</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest leading-none">{label}</span>
                    </div>
                    {/* Chips */}
                    <div className="flex items-center gap-1.5">
                      {items.map((p) => (
                        <ProfileChip
                          key={p.profile_id}
                          profile={p}
                          isSelected={p.profile_id === selectedProfileId}
                          isPending={isPending && p.profile_id === selectedProfileId}
                          onSelect={() => onSelectProfile(p)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── CHART PANE — fills all remaining space ──────────────── */}
      <main className={[
        "flex-1 min-h-0 overflow-hidden transition-opacity",
        isPending ? "opacity-70" : "opacity-100",
      ].join(" ")}>
        {selectedProfile && dataPromise ? (
          <ProfileViewer
            profile={selectedProfile}
            dataPromise={dataPromise}
            onDelete={() => onDeleteProfile(selectedProfile.profile_id)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-primary/8 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary/40">show_chart</span>
            </div>
            <div>
              <p className="text-base font-bold text-on-surface mb-1">Select a profile above</p>
              <p className="text-sm text-on-surface-variant/60 max-w-sm">
                Click any chip in the selector strip to load its interactive chart with
                zoom presets, aggregation controls, and live statistics.
              </p>
            </div>
            {/* Quick-start suggestions */}
            {profiles.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 mt-1">
                {profiles.slice(0, 5).map((p) => {
                  const meta = tm(p.type);
                  return (
                    <button
                      key={p.profile_id}
                      onClick={() => onSelectProfile(p)}
                      className={`text-[11px] font-bold px-3 py-1.5 rounded-full border ${meta.chip} ${meta.border} transition-all hover:opacity-80`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Page root
// ─────────────────────────────────────────────────────────────────────
export default function TimeSeriesCatalogue() {
  const [query, setQuery]                          = useState("");
  const [activeType, setActiveType]                = useState<ProfileType | null>(null);
  const [selectedProfileId, setSelectedProfileId]  = useState<string | null>(null);
  const [catalogueVersion, setCatalogueVersion]    = useState(0);
  const [isPending, startTransitionRaw]            = useTransition();

  const cataloguePromise = useMemo(() => fetchTimeSeriesCatalogue(), [catalogueVersion]);

  const handleSelect = (p: TimeSeriesProfile) => {
    startTransitionRaw(() => setSelectedProfileId(p.profile_id));
  };

  const handleDelete = useCallback((id: string) => {
    setSelectedProfileId((prev) => (prev === id ? null : prev));
    setCatalogueVersion((v) => v + 1);
  }, []);

  const handleTypeChip = (t: ProfileType) => {
    setActiveType((prev) => (prev === t ? null : t));
  };

  return (
    <>
      <title>OpenTech DB | Time Series & Profiles</title>
      <meta name="description" content="Browse and visualize energy time-series profiles." />

      {/* Full viewport height minus TopNavBar (~57 px) */}
      <div className="flex flex-col overflow-hidden" style={{ height: "calc(100vh - 57px)" }}>

        {/* ── TOP BAR: title + search + type filters ─────────────── */}
        <div className="flex items-center gap-3 px-5 py-2.5 border-b border-outline-variant/15 flex-shrink-0 bg-surface-container-low flex-wrap">
          {/* Icon + title */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-base text-primary">show_chart</span>
            </div>
            <span className="font-headline text-base font-bold text-on-surface whitespace-nowrap">
              Time Series & Profiles
            </span>
          </div>

          {/* Search */}
          <div className="relative w-52 flex-shrink-0">
            <input
              type="search"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-surface-container-lowest border border-outline-variant/30
                         rounded-xl pl-7 pr-3 py-1.5 text-xs text-on-surface
                         placeholder:text-on-surface-variant/40
                         focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40
                         transition-all"
            />
            <span className="material-symbols-outlined absolute left-2 top-1.5 text-[13px] text-on-surface-variant/40">
              search
            </span>
          </div>

          {/* Type filter chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {PROFILE_TYPES.map(({ value, label, icon }) => {
              const active = activeType === value;
              const meta   = tm(value);
              return (
                <button
                  key={value}
                  onClick={() => handleTypeChip(value)}
                  className={[
                    "flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border transition-all",
                    active
                      ? `${meta.chip} ${meta.border}`
                      : "border-outline-variant/20 text-on-surface-variant/60 hover:bg-surface-container hover:text-on-surface-variant",
                  ].join(" ")}
                >
                  <span className="material-symbols-outlined text-[11px]">{icon}</span>
                  {label}
                </button>
              );
            })}
            {(activeType || query) && (
              <button
                onClick={() => { setActiveType(null); setQuery(""); }}
                className="text-[10px] font-bold text-on-surface-variant/50 hover:text-primary px-1 transition-colors"
              >
                ✕ clear
              </button>
            )}
          </div>
        </div>

        {/* ── Body: strip + chart ─────────────────────────────────── */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <ErrorBoundary context="time series catalogue">
            <Suspense fallback={<StripSkeleton />}>
              <CatalogueContent
                cataloguePromise={cataloguePromise}
                query={query}
                activeType={activeType}
                selectedProfileId={selectedProfileId}
                onSelectProfile={handleSelect}
                onDeleteProfile={handleDelete}
                isPending={isPending}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </>
  );
}

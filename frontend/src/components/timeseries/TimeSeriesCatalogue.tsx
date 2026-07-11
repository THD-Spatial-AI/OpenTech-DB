/**
 * components/timeseries/TimeSeriesCatalogue.tsx
 *
 * Layout
 * ──────
 *  ┌─ top bar: title ──────────────────────────────────────────────┐
 *  ├─ toolbar: [search + inline dropdown]  [Browse profiles ▾] ───┤
 *  └─ chart pane fills all remaining height ───────────────────────┘
 */

import {
  Suspense,
  use,
  useState,
  useEffect,
  useMemo,
  useRef,
  useTransition,
  useCallback,
  startTransition as _startTransition,
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
function PageSkeleton() {
  return (
    <div className="animate-pulse flex flex-col h-full">
      <div className="h-12 bg-surface-container-low border-b border-outline-variant/15" />
      <div className="flex-1 bg-surface-container/30 m-4 rounded-2xl" style={{ minHeight: 400 }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ProfileBrowserDropdown — two-level cascading dropdown
// ─────────────────────────────────────────────────────────────────────
function ProfileBrowserDropdown({
  profiles,
  selectedProfileId,
  onSelect,
  isPending,
}: {
  profiles: TimeSeriesProfile[];
  selectedProfileId: string | null;
  onSelect: (p: TimeSeriesProfile) => void;
  isPending: boolean;
}) {
  const [open, setOpen]                 = useState(false);
  const [openCategory, setOpenCategory] = useState<ProfileType | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Group by type
  const groups = useMemo(() => {
    const map = new Map<ProfileType, TimeSeriesProfile[]>();
    for (const { value } of PROFILE_TYPES) map.set(value, []);
    for (const p of profiles) {
      const bucket = map.get(p.type as ProfileType) ?? [];
      bucket.push(p);
      map.set(p.type as ProfileType, bucket);
    }
    return map;
  }, [profiles]);

  const selectedProfile = profiles.find((p) => p.profile_id === selectedProfileId);

  const handleProfileClick = (p: TimeSeriesProfile) => {
    onSelect(p);
    setOpen(false);
  };

  return (
    <div className="relative flex-shrink-0" ref={containerRef}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all",
          "min-w-[180px] max-w-[260px] justify-between",
          open
            ? "bg-surface-container border-outline-variant/50 text-on-surface"
            : "bg-surface-container-lowest border-outline-variant/30 text-on-surface hover:bg-surface-container hover:border-outline-variant/50",
        ].join(" ")}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectedProfile ? (
            <>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tm(selectedProfile.type).dot}`} />
              <span className={`truncate ${isPending ? "opacity-50" : ""}`}>
                {selectedProfile.name}
              </span>
            </>
          ) : (
            <span className="text-on-surface-variant/60">Browse profiles…</span>
          )}
        </div>
        <span className="material-symbols-outlined text-[16px] text-on-surface-variant/50 flex-shrink-0">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {/* Two-panel flyout */}
      {open && (
        <div className="absolute top-full right-0 mt-1.5 z-50 flex items-start gap-1">

          {/* Level 1 — categories */}
          <div className="w-52 bg-surface-container-lowest border border-outline-variant/25 rounded-2xl shadow-xl overflow-hidden">
            {PROFILE_TYPES.map(({ value, label, icon }) => {
              const items = groups.get(value) ?? [];
              if (items.length === 0) return null;
              const meta   = tm(value);
              const isActive = openCategory === value;
              return (
                <button
                  key={value}
                  onClick={() => setOpenCategory((prev) => (prev === value ? null : value))}
                  className={[
                    "flex items-center justify-between w-full px-4 py-2.5 transition-colors text-left",
                    "border-b border-outline-variant/10 last:border-b-0",
                    isActive ? "bg-surface-container" : "hover:bg-surface-container/60",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2">
                    <span className={`material-symbols-outlined text-[14px] ${isActive ? "text-primary" : "text-on-surface-variant/60"}`}>
                      {icon}
                    </span>
                    <span className={`text-xs font-semibold ${isActive ? "text-primary" : "text-on-surface"}`}>
                      {label}
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${meta.chip}`}>
                      {items.length}
                    </span>
                  </div>
                  <span className={`material-symbols-outlined text-[14px] ${isActive ? "text-primary" : "text-on-surface-variant/30"}`}>
                    chevron_right
                  </span>
                </button>
              );
            })}
          </div>

          {/* Level 2 — profiles flyout */}
          {openCategory && (groups.get(openCategory) ?? []).length > 0 && (() => {
            const items = groups.get(openCategory)!;
            const meta  = tm(openCategory);
            return (
              <div className="w-64 bg-surface-container-lowest border border-outline-variant/25 rounded-2xl shadow-xl max-h-[360px] overflow-y-auto">
                {items.map((p) => {
                  const isSelected = p.profile_id === selectedProfileId;
                  return (
                    <button
                      key={p.profile_id}
                      onClick={() => handleProfileClick(p)}
                      className={[
                        "flex items-start gap-3 w-full text-left px-4 py-2.5 transition-colors",
                        "border-b border-outline-variant/10 last:border-b-0 border-l-2",
                        isSelected
                          ? "bg-primary/5 border-l-primary"
                          : "border-l-transparent hover:bg-surface-container/60",
                      ].join(" ")}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${meta.dot}`} />
                      <div className="min-w-0">
                        <p className={`text-[11px] font-semibold leading-tight truncate ${isSelected ? "text-primary" : "text-on-surface"}`}>
                          {p.name}
                        </p>
                        <p className="text-[9px] font-mono text-on-surface-variant/50 mt-0.5">
                          {p.location} · {p.resolution}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CatalogueContent — calls use(), inside Suspense
// ─────────────────────────────────────────────────────────────────────
function CatalogueContent({
  cataloguePromise,
  selectedProfileId,
  onSelectProfile,
  onDeleteProfile,
}: {
  cataloguePromise: Promise<{ total: number; profiles: TimeSeriesProfile[] }>;
  selectedProfileId: string | null;
  onSelectProfile: (p: TimeSeriesProfile) => void;
  onDeleteProfile: (id: string) => void;
}) {
  const { profiles } = use(cataloguePromise);
  const [query, setQuery]               = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [isPending, startTransition]    = useTransition();
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Filter profiles by query
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return [];
    return profiles
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.location.toLowerCase().includes(q) ||
          (p.carrier ?? "").toLowerCase().includes(q) ||
          p.type.replace("_", " ").includes(q),
      )
      .slice(0, 30);
  }, [profiles, q]);

  const handleSearchSelect = (p: TimeSeriesProfile) => {
    startTransition(() => onSelectProfile(p));
    setQuery("");
    setShowDropdown(false);
  };

  const handleBrowseSelect = (p: TimeSeriesProfile) => {
    startTransition(() => onSelectProfile(p));
  };

  const handleClear = () => {
    setQuery("");
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.profile_id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );
  const dataPromise = useMemo(
    () => (selectedProfileId ? fetchTimeSeriesData(selectedProfileId) : null),
    [selectedProfileId],
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">

      {/* ── TOOLBAR: search + browse dropdown ───────────────────── */}
      <div className="flex-shrink-0 border-b border-outline-variant/15 bg-surface-container-low/50 px-4 py-2.5 flex items-center gap-3">

        {/* Search with inline dropdown */}
        <div className="relative flex-1 max-w-lg" ref={searchRef}>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-on-surface-variant/40 pointer-events-none">
              search
            </span>
            <input
              ref={inputRef}
              type="search"
              placeholder="Search by name, location, carrier or type…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
              onFocus={() => { if (query) setShowDropdown(true); }}
              className="w-full bg-surface-container-lowest border border-outline-variant/30
                         rounded-xl pl-9 pr-8 py-1.5 text-xs text-on-surface
                         placeholder:text-on-surface-variant/40
                         focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40
                         transition-all"
            />
            {query && (
              <button
                onClick={handleClear}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            )}
          </div>

          {/* Inline results list */}
          {showDropdown && q && (
            <div className="absolute top-full left-0 right-0 mt-1.5 z-50
                            bg-surface-container-lowest border border-outline-variant/25
                            rounded-2xl shadow-xl overflow-hidden max-h-80 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-3 text-xs text-on-surface-variant/50">
                  <span className="material-symbols-outlined text-[15px]">search_off</span>
                  No profiles match &ldquo;{query}&rdquo;
                </div>
              ) : (
                <>
                  <div className="px-4 py-2 border-b border-outline-variant/10">
                    <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wide">
                      {filtered.length} result{filtered.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {filtered.map((p) => {
                    const meta = tm(p.type);
                    const isSelected = p.profile_id === selectedProfileId;
                    return (
                      <button
                        key={p.profile_id}
                        onClick={() => handleSearchSelect(p)}
                        className={[
                          "flex items-center gap-3 w-full text-left px-4 py-2.5 transition-colors",
                          "border-b border-outline-variant/10 last:border-b-0",
                          isSelected ? "bg-primary/5" : "hover:bg-surface-container/60",
                        ].join(" ")}
                      >
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs font-semibold truncate ${isSelected ? "text-primary" : "text-on-surface"}`}>
                            {p.name}
                          </p>
                          <p className="text-[10px] text-on-surface-variant/50 mt-0.5 font-mono">
                            {p.location} · {p.year} · {p.resolution}
                          </p>
                        </div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${meta.chip}`}>
                          {p.type.replace("_", " ")}
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>

        {/* Browse profiles dropdown */}
        <ProfileBrowserDropdown
          profiles={profiles}
          selectedProfileId={selectedProfileId}
          onSelect={handleBrowseSelect}
          isPending={isPending}
        />
      </div>

      {/* ── CHART PANE ──────────────────────────────────────────── */}
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
              <p className="text-base font-bold text-on-surface mb-1">Select a profile</p>
              <p className="text-sm text-on-surface-variant/60 max-w-sm">
                Search by name, location, or carrier — or use <strong>Browse profiles</strong> to explore by category.
              </p>
            </div>
            {profiles.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 mt-1">
                {PROFILE_TYPES.map(({ value, label, icon }) => {
                  const count = profiles.filter((p) => p.type === value).length;
                  if (count === 0) return null;
                  const meta = tm(value);
                  return (
                    <button
                      key={value}
                      onClick={() => {
                        setQuery(value.replace("_", " "));
                        setShowDropdown(true);
                        inputRef.current?.focus();
                      }}
                      className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full border transition-all hover:opacity-80 ${meta.chip} ${meta.border}`}
                    >
                      <span className="material-symbols-outlined text-[12px]">{icon}</span>
                      {label}
                      <span className="opacity-60 font-normal">({count})</span>
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
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [catalogueVersion, setCatalogueVersion]   = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cataloguePromise = useMemo(() => fetchTimeSeriesCatalogue(), [catalogueVersion]);

  const handleDelete = useCallback((id: string) => {
    setSelectedProfileId((prev) => (prev === id ? null : prev));
    setCatalogueVersion((v) => v + 1);
  }, []);

  return (
    <>
      <title>OpenTech DB | Time Series & Profiles</title>
      <meta name="description" content="Browse and visualize energy time-series profiles." />

      <div className="flex flex-col overflow-hidden" style={{ height: "calc(100vh - 57px)" }}>

        {/* ── TOP BAR: title ──────────────────────────────────── */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-outline-variant/15 flex-shrink-0 bg-surface-container-low">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-base text-primary">show_chart</span>
          </div>
          <span className="font-headline text-base font-bold text-on-surface whitespace-nowrap">
            Time Series &amp; Profiles
          </span>
        </div>

        {/* ── Body ────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <ErrorBoundary context="time series catalogue">
            <Suspense fallback={<PageSkeleton />}>
              <CatalogueContent
                cataloguePromise={cataloguePromise}
                selectedProfileId={selectedProfileId}
                onSelectProfile={(p) => setSelectedProfileId(p.profile_id)}
                onDeleteProfile={handleDelete}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </>
  );
}

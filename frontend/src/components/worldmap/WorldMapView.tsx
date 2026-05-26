/**
 * components/worldmap/WorldMapView.tsx
 * ──────────────────────────────────────
 * Full-page Technology World Map view.
 *
 * Layout (lg+)
 * ────────────
 *  ┌─ control bar: title · tech chips · param chips · year slider ───────┐
 *  ├─ map pane (flex-1)   │ country panel (320 px, slide-in) ────────────┤
 *  └─ legend bar ────────────────────────────────────────────────────────┘
 *
 * The control bar stays sticky at the top of this section.
 * On mobile the country panel stacks below the map.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type { TechMapType, TechMapParam } from "../../types/worldmap";
import {
  PARAM_META,
  MAP_YEARS,
  QUINTILE_COLORS,
  NO_DATA_COLOR,
} from "../../types/worldmap";
import {
  getGlobalRange,
  getTechnologyMeta,
  getWorldMapCountries,
  getWorldMapTechnologies,
} from "../../services/worldmap.ts";

import TechGeoMap from "./TechGeoMap";
import CountryPanel from "./CountryPanel";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLegendVal(v: number, param: TechMapParam): string {
  return PARAM_META[param].format(v);
}

const CONTINENT_BY_ISO3: Record<string, string> = {
  // Europe
  DEU: "Europe", FRA: "Europe", ESP: "Europe", ITA: "Europe", GRC: "Europe", DNK: "Europe",
  GBR: "Europe", NOR: "Europe", NLD: "Europe", PRT: "Europe", POL: "Europe", BEL: "Europe",
  IRL: "Europe", SWE: "Europe", FIN: "Europe", CHE: "Europe", AUT: "Europe",
  CZE: "Europe", HUN: "Europe", ROU: "Europe", BGR: "Europe", HRV: "Europe", SVK: "Europe",
  SVN: "Europe", EST: "Europe", LVA: "Europe", LTU: "Europe", LUX: "Europe", CYP: "Europe",
  MLT: "Europe", UKR: "Europe", SRB: "Europe", TUR: "Europe", ISL: "Europe",
  // North America
  USA: "North America", CAN: "North America", MEX: "North America",
  // South America
  BRA: "South America", ARG: "South America", CHL: "South America",
  COL: "South America", PER: "South America", URY: "South America",
  // Asia
  CHN: "Asia", IND: "Asia", JPN: "Asia", KOR: "Asia", TWN: "Asia",
  IDN: "Asia", VNM: "Asia", THA: "Asia", MYS: "Asia", SGP: "Asia",
  PAK: "Asia", BGD: "Asia", PHL: "Asia", MNG: "Asia",
  SAU: "Asia", ARE: "Asia", QAT: "Asia", IRN: "Asia", IRQ: "Asia",
  ISR: "Asia", JOR: "Asia", OMN: "Asia", KWT: "Asia", BHR: "Asia", YEM: "Asia",
  // Oceania
  AUS: "Oceania", NZL: "Oceania",
  // Africa
  ZAF: "Africa", EGY: "Africa", MAR: "Africa", NGA: "Africa", KEN: "Africa",
  ETH: "Africa", TZA: "Africa", GHA: "Africa", SEN: "Africa", MOZ: "Africa",
  NAM: "Africa", BWA: "Africa", ZMB: "Africa", ZWE: "Africa",
  // Russia / Central Asia
  RUS: "Asia", KAZ: "Asia", UZB: "Asia",
};

function getContinent(iso3: string): string {
  return CONTINENT_BY_ISO3[iso3] ?? "Other";
}

function getTechGroup(label: string, carrier: string): string {
  const s = `${label} ${carrier}`.toLowerCase();
  if (s.includes("solar") || s.includes("pv") || s.includes("csp")) return "Solar";
  if (s.includes("wind") || s.includes("offshore") || s.includes("onshore")) return "Wind";
  if (s.includes("hydro") || s.includes("water") || s.includes("reservoir") || s.includes("ror")) return "Hydro";
  if (s.includes("coal") || s.includes("lignite")) return "Coal";
  if (s.includes("gas") || s.includes("ccgt") || s.includes("ocgt")) return "Gas";
  if (s.includes("nuclear") || s.includes("uranium")) return "Nuclear";
  if (s.includes("hydrogen") || s.includes("h2")) return "Hydrogen";
  if (s.includes("battery") || s.includes("storage") || s.includes("pumped")) return "Storage";
  if (s.includes("transmission") || s.includes("grid") || s.includes("line") || s.includes("cable")) return "Grid";
  return "Other";
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WorldMapView() {
  const [catalogueVersion, setCatalogueVersion] = useState(0);
  const [tech,          setTech]          = useState<TechMapType>("");
  const [param,         setParam]         = useState<TechMapParam>("capacity_factor");
  const [techFilter,    setTechFilter]    = useState("");
  const [continentFilter, setContinentFilter] = useState<string>("all");
  const [countryFilterIso3, setCountryFilterIso3] = useState<string>("all");
  const [yearIdx,       setYearIdx]       = useState<number>(2); // 2024
  const [selectedIso3,  setSelectedIso3]  = useState<string | null>(null);
  const [, setSelectedName]  = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const techOptions = useMemo(() => getWorldMapTechnologies(), [catalogueVersion]);
  const countryOptions = useMemo(
    () => getWorldMapCountries().filter((c) => c.entries.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalogueVersion],
  );
  const continentOptions = useMemo(() => {
    const set = new Set(countryOptions.map((c) => getContinent(c.iso3)));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [countryOptions]);
  const filteredCountryOptions = useMemo(() => {
    if (continentFilter === "all") return countryOptions;
    return countryOptions.filter((c) => getContinent(c.iso3) === continentFilter);
  }, [countryOptions, continentFilter]);
  const filteredTechOptions = useMemo(() => {
    const q = techFilter.trim().toLowerCase();
    if (!q) return techOptions;
    const filtered = techOptions.filter((t) =>
      t.label.toLowerCase().includes(q) || t.category.toLowerCase().includes(q),
    );
    if (tech && !filtered.some((t) => t.id === tech)) {
      const selected = techOptions.find((t) => t.id === tech);
      if (selected) return [selected, ...filtered];
    }
    return filtered;
  }, [techOptions, techFilter, tech]);
  const groupedTechOptions = useMemo(() => {
    const groups = new Map<string, typeof filteredTechOptions>();
    for (const t of filteredTechOptions) {
      const g = getTechGroup(t.label, t.carrierKey);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)?.push(t);
    }

    const orderedGroups = ["Solar", "Wind", "Hydro", "Coal", "Gas", "Nuclear", "Hydrogen", "Storage", "Grid", "Other"];
    return orderedGroups
      .filter((g) => (groups.get(g)?.length ?? 0) > 0)
      .map((g) => ({ group: g, options: (groups.get(g) ?? []).sort((a, b) => a.label.localeCompare(b.label)) }));
  }, [filteredTechOptions]);
  const selectedMeta = getTechnologyMeta(tech);
  const availableParams = selectedMeta?.availableParams ?? ["capacity_factor"];
  const activeTech = tech || "__bootstrap__";
  const activeParam: TechMapParam = tech ? param : "capacity_factor";

  useEffect(() => {
    if (techOptions.length === 0) return;
    if (!tech || !techOptions.some((t) => t.id === tech)) {
      const first = techOptions.find((t) => t.availableParams.includes("capacity_factor")) ?? techOptions[0];
      setTech(first.id);
      setParam(first.availableParams.includes("capacity_factor") ? "capacity_factor" : first.availableParams[0]);
    }
  }, [techOptions, tech]);

  const year = MAP_YEARS[yearIdx];

  const handleCountrySelect = useCallback((iso3: string, name: string) => {
    setSelectedIso3(iso3);
    setSelectedName(name);
    setContinentFilter(getContinent(iso3));
    setCountryFilterIso3(iso3);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedIso3(null);
    setSelectedName(null);
    setCountryFilterIso3("all");
  }, []);

  useEffect(() => {
    if (countryFilterIso3 === "all") return;
    const found = filteredCountryOptions.find((c) => c.iso3 === countryFilterIso3);
    if (!found) {
      setCountryFilterIso3("all");
      setSelectedIso3(null);
      setSelectedName(null);
      return;
    }

    setSelectedIso3(found.iso3);
    setSelectedName(found.name);
  }, [countryFilterIso3, filteredCountryOptions]);

  // When tech changes, keep param if valid; otherwise reset to "capex"
  const handleTechChange = (next: TechMapType) => {
    const meta = getTechnologyMeta(next);
    if (!meta) return;
    setTech(next);
    if (!meta.availableParams.includes(param)) {
      setParam(meta.availableParams.includes("capacity_factor") ? "capacity_factor" : meta.availableParams[0]);
    }
    setSelectedIso3(null);
    setSelectedName(null);
  };

  // Called from CountryPanel pie-chart click — switches tech but keeps country open
  const handleTechSelectFromPanel = useCallback((next: TechMapType) => {
    const meta = getTechnologyMeta(next);
    if (!meta) return;
    setTech(next);
    if (!meta.availableParams.includes(param)) {
      setParam(meta.availableParams.includes("capacity_factor") ? "capacity_factor" : meta.availableParams[0]);
    }
  }, [param]);

  // Legend range
  const [min, max] = tech ? getGlobalRange(tech, param) : [0, 1];
  const { higherIsBetter } = PARAM_META[activeParam];
  const legendColors = higherIsBetter ? [...QUINTILE_COLORS].reverse() : [...QUINTILE_COLORS];

  return (
    <div className="flex flex-col overflow-hidden bg-surface" style={{ height: "calc(100vh - 57px)" }}>

      {/* ── Control bar ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-[100] bg-surface-container-low border-b
                      border-outline-variant/15 px-6 py-4 flex-shrink-0">

        {/* Title row */}
        <div className="flex items-center gap-3 mb-4">
          <span className="material-symbols-outlined text-primary text-2xl">public</span>
          <div>
            <h1 className="font-headline font-bold text-on-surface text-xl leading-tight">
              Technology World Map
            </h1>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Explore energy technology parameters country by country
            </p>
          </div>
        </div>

        {/* Controls ──────────────────────────────────────────────────────── */}
        <div className="space-y-2">

          {/* Row 1: Technology · Parameter · Year */}
          <div className="flex flex-wrap gap-3 items-end">

            {/* ── Technology combo ──────────────────────────────────────── */}
            <div className="flex flex-col gap-1 min-w-[260px] flex-1 max-w-[420px]">
              <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                Technology
              </span>
              <div className="flex gap-1">
                <input
                  type="search"
                  value={techFilter}
                  onChange={(e) => setTechFilter(e.target.value)}
                  placeholder="Search…"
                  className="h-9 px-3 rounded-lg border border-outline-variant/30 bg-surface-container-lowest
                             text-sm text-on-surface placeholder:text-on-surface-variant/50
                             focus:outline-none focus:ring-2 focus:ring-primary/25 w-28 shrink-0"
                />
                <select
                  value={tech}
                  onChange={(e) => handleTechChange(e.target.value)}
                  className="h-9 flex-1 px-3 rounded-lg border border-outline-variant/30 bg-surface-container-lowest
                             text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                >
                  {groupedTechOptions.map(({ group, options }) => (
                    <optgroup key={group} label={group}>
                      {options.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>

            {/* ── Parameter pills ───────────────────────────────────────── */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                Parameter
              </span>
              <div className="flex flex-wrap gap-1">
                {availableParams.map((p) => (
                  <button
                    key={p}
                    onClick={() => setParam(p)}
                    className={`h-9 px-3 rounded-lg text-sm font-medium transition-colors ${
                      param === p
                        ? "bg-primary text-on-primary"
                        : "bg-surface-container-lowest border border-outline-variant/30 text-on-surface-variant hover:border-primary/50 hover:text-on-surface"
                    }`}
                  >
                    {PARAM_META[p].label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Year pills ────────────────────────────────────────────── */}
            <div className="flex flex-col gap-1 ml-auto">
              <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                Year
              </span>
              <div className="flex gap-1">
                {MAP_YEARS.map((y, i) => (
                  <button
                    key={y}
                    onClick={() => setYearIdx(i)}
                    className={`h-9 px-3 rounded-lg text-sm font-medium transition-colors ${
                      yearIdx === i
                        ? "bg-primary text-on-primary"
                        : "bg-surface-container-lowest border border-outline-variant/30 text-on-surface-variant hover:border-primary/50 hover:text-on-surface"
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: Continent · Country (secondary filter row) */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/50">
              Refine:
            </span>

            {/* ── Continent ─────────────────────────────────────────────── */}
            <select
              value={continentFilter}
              onChange={(e) => {
                setContinentFilter(e.target.value);
                setCountryFilterIso3("all");
              }}
              className="h-8 px-3 rounded-lg border border-outline-variant/30 bg-surface-container-lowest
                         text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
            >
              <option value="all">All continents</option>
              {continentOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            {/* ── Country ───────────────────────────────────────────────── */}
            <select
              value={countryFilterIso3}
              onChange={(e) => setCountryFilterIso3(e.target.value)}
              className="h-8 px-3 rounded-lg border border-outline-variant/30 bg-surface-container-lowest
                         text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/25 min-w-[200px]"
            >
              <option value="all">All countries with data</option>
              {filteredCountryOptions.map((c) => (
                <option key={c.iso3} value={c.iso3}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Map + panel row ────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative">

        {/* Map */}
        <div className="flex-1 min-h-0 p-4">
          <TechGeoMap
            tech={activeTech}
            param={activeParam}
            year={year}
            selectedIso3={selectedIso3}
            onCountrySelect={handleCountrySelect}
            onCatalogueReady={() => setCatalogueVersion((v) => v + 1)}
          />
        </div>

        {/* Country panel — slide in from right */}
        {selectedIso3 && (
          <div
            className="w-[440px] flex-shrink-0 border-l border-outline-variant/15
                       bg-surface-container-lowest overflow-hidden
                       animate-slideInRight
                       flex flex-col min-h-0"
            style={{ maxHeight: "100%" }}
          >
            {tech && (
              <CountryPanel
                iso3={selectedIso3}
                tech={tech}
                param={param}
                year={year}
                onClose={handleClosePanel}
                onTechSelect={handleTechSelectFromPanel}
              />
            )}
          </div>
        )}

        {/* Hint when nothing is selected */}
        {!selectedIso3 && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2
                          bg-surface-container-lowest/90 backdrop-blur-sm
                          rounded-full px-4 py-2 text-xs text-on-surface-variant
                          shadow border border-outline-variant/15
                          flex items-center gap-1.5 pointer-events-none">
            <span className="material-symbols-outlined text-sm">touch_app</span>
            Click any country to see values and coverage
          </div>
        )}
      </div>

      {/* ── Legend bar ──────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-surface-container-low border-t
                      border-outline-variant/15 px-6 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            {PARAM_META[activeParam].label} — {selectedMeta?.label ?? "Technology"}
          </span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-on-surface-variant mr-1">
              {higherIsBetter ? "Low" : "Low·best"}
            </span>
            <span className="text-[10px] text-on-surface-variant">
              {formatLegendVal(min, param)}
            </span>
            {legendColors.map((c, i) => (
              <div
                key={i}
                className="w-8 h-4 rounded-sm"
                style={{ backgroundColor: c, opacity: 0.85 }}
                title={`Quintile ${i + 1}`}
              />
            ))}
            <span className="text-[10px] text-on-surface-variant">
              {formatLegendVal(max, param)}
            </span>
            <span className="text-[10px] text-on-surface-variant ml-1">
              {higherIsBetter ? "High·best" : "High"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <div
              className="w-5 h-4 rounded-sm"
              style={{ backgroundColor: NO_DATA_COLOR, opacity: 0.5 }}
            />
            <span className="text-[10px] text-on-surface-variant">No data</span>
          </div>
        </div>
      </div>
    </div>
  );
}

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

import { useCallback, useState } from "react";

import type { TechMapType, TechMapParam, MapYear } from "../../types/worldmap";
import {
  TECH_META,
  PARAM_META,
  MAP_YEARS,
  QUINTILE_COLORS,
  NO_DATA_COLOR,
} from "../../types/worldmap";
import { getGlobalRange } from "../../services/worldmap";

import TechGeoMap from "./TechGeoMap";
import CountryPanel from "./CountryPanel";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLegendVal(v: number, param: TechMapParam): string {
  return PARAM_META[param].format(v);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WorldMapView() {
  const [tech,          setTech]          = useState<TechMapType>("solar_pv_utility");
  const [param,         setParam]         = useState<TechMapParam>("capex");
  const [yearIdx,       setYearIdx]       = useState<number>(2); // 2024
  const [selectedIso3,  setSelectedIso3]  = useState<string | null>(null);
  const [selectedName,  setSelectedName]  = useState<string | null>(null);

  const year = MAP_YEARS[yearIdx];

  const handleCountrySelect = useCallback((iso3: string, name: string) => {
    setSelectedIso3(iso3);
    setSelectedName(name);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedIso3(null);
    setSelectedName(null);
  }, []);

  // When tech changes, keep param if valid; otherwise reset to "capex"
  const handleTechChange = (next: TechMapType) => {
    setTech(next);
    if (next === "battery_li_ion" && param === "co2_emissions") setParam("capex");
    setSelectedIso3(null);
    setSelectedName(null);
  };

  // Legend range
  const [min, max] = getGlobalRange(tech, param);
  const { higherIsBetter } = PARAM_META[param];
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

        {/* Controls row */}
        <div className="flex flex-wrap gap-4 items-end">

          {/* ── Technology chips ───────────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Technology
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(TECH_META) as TechMapType[]).map((t) => {
                const { label, icon, color } = TECH_META[t];
                const active = t === tech;
                return (
                  <button
                    key={t}
                    onClick={() => handleTechChange(t)}
                    style={active ? { backgroundColor: `${color}22`, borderColor: color, color } : {}}
                    className={[
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium",
                      "border transition-all select-none",
                      active
                        ? "border-current font-bold shadow-sm"
                        : "border-outline-variant/30 text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                    ].join(" ")}
                  >
                    <span className="material-symbols-outlined text-sm">{icon}</span>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Parameter chips ────────────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Parameter
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(PARAM_META) as TechMapParam[]).map((p) => {
                // Battery doesn't have CO2 data
                if (tech === "battery_li_ion" && p === "co2_emissions") return null;
                const { label } = PARAM_META[p];
                const active = p === param;
                return (
                  <button
                    key={p}
                    onClick={() => setParam(p)}
                    className={[
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-all select-none",
                      active
                        ? "bg-primary/10 border-primary/50 text-primary font-bold"
                        : "border-outline-variant/30 text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Year slider ────────────────────────────────────────────── */}
          <div className="flex flex-col gap-1 ml-auto">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Year —{" "}
              <span className="text-primary font-headline text-sm">{year}</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-on-surface-variant w-10 text-right">
                {MAP_YEARS[0]}
              </span>
              <input
                type="range"
                min={0}
                max={MAP_YEARS.length - 1}
                step={1}
                value={yearIdx}
                onChange={(e) => setYearIdx(Number(e.target.value))}
                className="w-44 accent-primary cursor-pointer"
                aria-label="Select year"
              />
              <span className="text-xs text-on-surface-variant w-10">
                {MAP_YEARS[MAP_YEARS.length - 1]}
              </span>
            </div>
            {/* Year ticks */}
            <div className="flex justify-between text-[9px] text-on-surface-variant/50 px-10">
              {MAP_YEARS.map((y) => (
                <span
                  key={y}
                  className={y === year ? "text-primary font-bold" : ""}
                >
                  {y}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Map + panel row ────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 relative">

        {/* Map */}
        <div className="flex-1 min-h-0 p-4">
          <TechGeoMap
            tech={tech}
            param={param}
            year={year}
            selectedIso3={selectedIso3}
            onCountrySelect={handleCountrySelect}
          />
        </div>

        {/* Country panel — slide in from right */}
        {selectedIso3 && (
          <div
            className="w-80 flex-shrink-0 border-l border-outline-variant/15
                       bg-surface-container-lowest overflow-hidden
                       animate-slideInRight
                       flex flex-col min-h-0"
            style={{ maxHeight: "100%" }}
          >
            <CountryPanel
              iso3={selectedIso3}
              tech={tech}
              param={param}
              year={year}
              onClose={handleClosePanel}
            />
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
            Click a highlighted country to see details
          </div>
        )}
      </div>

      {/* ── Legend bar ──────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-surface-container-low border-t
                      border-outline-variant/15 px-6 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            {PARAM_META[param].label} — {TECH_META[tech].label}
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

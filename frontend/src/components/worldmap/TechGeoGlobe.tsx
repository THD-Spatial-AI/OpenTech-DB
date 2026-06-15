/**
 * TechGeoGlobe.tsx
 * ──────────────────
 * 3D choropleth globe for the Technology World Map view.
 * Uses globe.gl (wraps three-globe) so polygon click/hover work out of the box.
 *
 * Visual style: light theme matching the app palette (Kinetic Monolith).
 *   - Ocean:      #dbeafe  (blue-100, same tint as the 2D map background)
 *   - Background: #f2f4f6  (surface-container-low)
 *   - Atmosphere: #4d4b9e  (primary indigo)
 *   - Selected border: #4d4b9e
 *
 * Interactions:
 *   - Auto-rotates on load
 *   - Click pauses rotation; resumes after 3 s
 *   - Click fires onCountrySelect → CountryPanel slides in (parent handles this)
 *   - Camera flies to selected country with adaptive altitude (large = zoomed out)
 *   - Hover shows a white-card tooltip (country name + formatted param value)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Globe from "globe.gl";
import * as THREE from "three";

import type { TechMapType, TechMapParam } from "../../types/worldmap";
import { choroplethColor, PARAM_META, NO_DATA_COLOR } from "../../types/worldmap";
import { getParamValues, getGlobalRange } from "../../services/worldmap";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TechGeoGlobeProps {
  tech: TechMapType;
  param: TechMapParam;
  year: number;
  selectedIso3: string | null;
  onCountrySelect: (iso3: string, name: string) => void;
}

interface GeoFeature {
  id?: string | number;
  properties?: { name?: string };
  geometry?: GeoJSON.Geometry;
}

type GlobeInstance = InstanceType<ReturnType<typeof Globe>>;

// ── Constants ─────────────────────────────────────────────────────────────────

const GEOJSON_URL =
  "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json";

const RESUME_DELAY_MS = 3000;

// Minimum bounding-box span (degrees) a feature must have to appear when it has no data.
// Hides micro-territories like Bermuda (~0.15°) that look like glitches near larger countries.
const MIN_DISPLAY_SPAN = 0.5;

// Shared transparent material for polygon sides — avoids Three.js black fallback
// when passing the string "transparent" (which is not a valid THREE.Color input).
const TRANSPARENT_SIDE_MAT = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Recursively flatten all [lng, lat] coordinate pairs from any GeoJSON geometry. */
function extractCoords(geometry: GeoJSON.Geometry): [number, number][] {
  const out: [number, number][] = [];
  function walk(g: GeoJSON.Geometry) {
    switch (g.type) {
      case "Point":
        out.push(g.coordinates as [number, number]);
        break;
      case "MultiPoint":
      case "LineString":
        g.coordinates.forEach((c) => out.push(c as [number, number]));
        break;
      case "MultiLineString":
      case "Polygon":
        g.coordinates.forEach((ring) => ring.forEach((c) => out.push(c as [number, number])));
        break;
      case "MultiPolygon":
        g.coordinates.forEach((poly) =>
          poly.forEach((ring) => ring.forEach((c) => out.push(c as [number, number]))),
        );
        break;
      case "GeometryCollection":
        g.geometries.forEach(walk);
        break;
    }
  }
  walk(geometry);
  return out;
}

/**
 * Compute the camera point-of-view for a country feature.
 * Altitude is adaptive: large countries (Russia ~170°) zoom out (~2.5),
 * small countries (Luxembourg <1°) zoom in (~0.25).
 * Formula: altitude ≈ max_bbox_span / 65, clamped to [0.25, 2.5].
 */
function computePOV(feature: GeoFeature): { lat: number; lng: number; altitude: number } {
  if (!feature.geometry) return { lat: 20, lng: 10, altitude: 2.5 };
  const coords = extractCoords(feature.geometry);
  if (coords.length === 0) return { lat: 20, lng: 10, altitude: 2.5 };

  const lngs = coords.map((c) => c[0]);
  const lats  = coords.map((c) => c[1]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats), maxLat  = Math.max(...lats);

  const centerLng  = (minLng + maxLng) / 2;
  const centerLat  = (minLat + maxLat) / 2;
  const maxSpan    = Math.max(maxLng - minLng, maxLat - minLat);
  const altitude   = Math.min(Math.max(maxSpan / 65, 0.25), 2.5);

  return { lat: centerLat, lng: centerLng, altitude };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TechGeoGlobe({
  tech,
  param,
  year,
  selectedIso3,
  onCountrySelect,
}: TechGeoGlobeProps) {
  const containerRef    = useRef<HTMLDivElement>(null); // React's outer div
  const globeDivRef     = useRef<HTMLDivElement>(null); // globe.gl's isolated inner div
  const globeRef        = useRef<GlobeInstance | null>(null);
  const resumeTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [geoData, setGeoData] = useState<GeoJSON.FeatureCollection | null>(null);

  // Keep latest callback in a ref so polygon click handler never goes stale.
  const selectRef = useRef(onCountrySelect);
  useEffect(() => { selectRef.current = onCountrySelect; });

  // Mutable refs for polygon accessor closures — avoids re-registering handlers
  // on every tech/param/year change.
  const polyValuesRef  = useRef(new Map<string, number>());
  const polyMinRef     = useRef(0);
  const polyMaxRef     = useRef(0);
  const polyHigherRef  = useRef(false);
  const polySelRef     = useRef<string | null>(null);
  const polyParamRef   = useRef<TechMapParam>(param);
  // Precomputed bounding-box max-span per feature (populated once when geoData loads).
  const featureSpanRef = useRef(new Map<string, number>());

  // ── 1. Globe initialisation (once) ────────────────────────────────────────

  useEffect(() => {
    // globeDiv is a plain div React renders but never updates its children,
    // so globe.gl can safely inject its canvas there without conflicting with
    // React's reconciler (which only manages containerRef's React children).
    const globeDiv    = globeDivRef.current;
    const outerDiv    = containerRef.current;
    if (!globeDiv || !outerDiv || globeRef.current) return;

    const globe = new (Globe())(globeDiv);

    globe
      .width(outerDiv.clientWidth  || 600)
      .height(outerDiv.clientHeight || 400)
      .backgroundColor("#f2f4f6")
      .showAtmosphere(true)
      .atmosphereColor("#4d4b9e")
      .atmosphereAltitude(0.15)
      .globeImageUrl("")
      .globeMaterial(new THREE.MeshLambertMaterial({ color: "#dbeafe" }))
      .polygonsTransitionDuration(0);

    const ctrl = globe.controls();
    ctrl.autoRotate      = true;
    ctrl.autoRotateSpeed = 0.6;
    ctrl.enableDamping   = true;
    ctrl.dampingFactor   = 0.08;
    ctrl.rotateSpeed     = 0.5;

    // Drag start: always stop rotation and cancel any pending resume.
    // Drag end: only resume if no country is currently selected.
    ctrl.addEventListener("start", () => {
      if (globeRef.current) globeRef.current.controls().autoRotate = false;
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    });
    ctrl.addEventListener("end", () => {
      if (!polySelRef.current) {
        resumeTimerRef.current = setTimeout(() => {
          if (globeRef.current) globeRef.current.controls().autoRotate = true;
        }, RESUME_DELAY_MS);
      }
    });

    globeRef.current = globe;

    // Resize observer watches the outer div (true container size)
    const ro = new ResizeObserver(() => {
      globe.width(outerDiv.clientWidth).height(outerDiv.clientHeight);
    });
    ro.observe(outerDiv);

    return () => {
      ro.disconnect();
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      try { globe.renderer()?.dispose(); } catch { /* noop */ }
      // Only clear globe.gl's own div — never touch React-managed DOM nodes.
      while (globeDiv.firstChild) globeDiv.removeChild(globeDiv.firstChild);
      globeRef.current = null;
    };
  }, []);

  // ── 2. GeoJSON fetch (once) ────────────────────────────────────────────────

  useEffect(() => {
    fetch(GEOJSON_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`GeoJSON fetch failed: ${r.status}`);
        return r.json() as Promise<GeoJSON.FeatureCollection>;
      })
      .then((data) => { setGeoData(data); setLoading(false); })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  // ── Accessor closures — stable, read from refs ─────────────────────────────

  const polygonAltitude = useCallback((d: unknown) => {
    const iso3 = String((d as GeoFeature).id ?? "").toUpperCase();
    return iso3 === polySelRef.current ? 0.06 : 0.01;
  }, []);

  const polygonCapColor = useCallback((d: unknown) => {
    const iso3 = String((d as GeoFeature).id ?? "").toUpperCase();
    const val  = polyValuesRef.current.get(iso3);
    return val != null
      ? hexToRgba(choroplethColor(val, polyMinRef.current, polyMaxRef.current, polyHigherRef.current), 0.85)
      : hexToRgba(NO_DATA_COLOR, 0.4);
  }, []);

  const polygonStrokeColor = useCallback((d: unknown) => {
    const iso3 = String((d as GeoFeature).id ?? "").toUpperCase();
    return iso3 === polySelRef.current ? "#4d4b9e" : "rgba(100,100,150,0.25)";
  }, []);

  const polygonLabel = useCallback((d: unknown) => {
    const feature   = d as GeoFeature;
    const iso3      = String(feature.id ?? "").toUpperCase();
    const name      = feature.properties?.name ?? iso3;
    const val       = polyValuesRef.current.get(iso3);
    const formatted = val != null ? PARAM_META[polyParamRef.current].format(val) : null;
    return `
      <div style="
        background:#fff;
        border:1px solid rgba(0,0,0,0.08);
        border-radius:8px;
        padding:6px 10px;
        font-size:12px;
        font-family:Inter,system-ui,sans-serif;
        color:#191c1e;
        box-shadow:0 4px 12px rgba(0,0,0,0.10);
        pointer-events:none
      ">
        <b>${name}</b><br/>
        ${formatted != null
          ? formatted
          : '<span style="color:#9ca3af">No data</span>'
        }
      </div>`;
  }, []);

  // ── 3. Polygon setup + interactions (once geoData + globe are ready) ───────

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !geoData) return;

    // Precompute bounding-box spans so micro-territory filtering is O(1) on updates.
    geoData.features.forEach((f) => {
      const iso3 = String(f.id ?? "").toUpperCase();
      if (!f.geometry) return;
      const coords = extractCoords(f.geometry as GeoJSON.Geometry);
      if (coords.length === 0) return;
      const lngs = coords.map((c) => c[0]);
      const lats  = coords.map((c) => c[1]);
      featureSpanRef.current.set(iso3, Math.max(
        Math.max(...lngs) - Math.min(...lngs),
        Math.max(...lats) - Math.min(...lats),
      ));
    });

    // Prime the refs with initial values
    polyValuesRef.current = getParamValues(tech, param, year);
    const [gMin, gMax]    = getGlobalRange(tech, param);
    polyMinRef.current    = gMin;
    polyMaxRef.current    = gMax;
    polyHigherRef.current = PARAM_META[param].higherIsBetter;
    polySelRef.current    = selectedIso3;
    polyParamRef.current  = param;

    const visibleFeatures = geoData.features.filter((f) => {
      const iso3 = String(f.id ?? "").toUpperCase();
      return polyValuesRef.current.has(iso3) || (featureSpanRef.current.get(iso3) ?? 0) >= MIN_DISPLAY_SPAN;
    });

    globe
      .polygonsData(visibleFeatures)
      .polygonAltitude(polygonAltitude)
      .polygonCapColor(polygonCapColor)
      .polygonSideMaterial(() => TRANSPARENT_SIDE_MAT)
      .polygonStrokeColor(polygonStrokeColor)
      .polygonLabel(polygonLabel)
      .onPolygonClick((polygon: unknown) => {
        const feature = polygon as GeoFeature;
        const iso3    = String(feature.id ?? "").toUpperCase();
        const name    = feature.properties?.name ?? iso3;

        // Cancel pending resume — selectedIso3 effect will stop rotation when parent updates.
        if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);

        selectRef.current(iso3, name);
      });
  // polygonAltitude / polygonCapColor / polygonStrokeColor / polygonLabel are
  // stable useCallback refs — safe to exclude from the dep array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoData]);

  // ── 4. Data update (re-sync refs, re-trigger accessor evaluation) ──────────

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !geoData) return;

    polyValuesRef.current = getParamValues(tech, param, year);
    const [gMin, gMax]    = getGlobalRange(tech, param);
    polyMinRef.current    = gMin;
    polyMaxRef.current    = gMax;
    polyHigherRef.current = PARAM_META[param].higherIsBetter;
    polySelRef.current    = selectedIso3;
    polyParamRef.current  = param;

    // Filter micro-territories with no data, then spread so globe.gl sees a new reference
    // and re-evaluates all accessor functions with the updated ref values.
    const visibleFeatures = geoData.features.filter((f) => {
      const iso3 = String(f.id ?? "").toUpperCase();
      return polyValuesRef.current.has(iso3) || (featureSpanRef.current.get(iso3) ?? 0) >= MIN_DISPLAY_SPAN;
    });
    globe.polygonsData(visibleFeatures);
  }, [tech, param, year, selectedIso3, geoData]);

  // ── 5. Fly to selected country (adaptive altitude) ─────────────────────────

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !selectedIso3 || !geoData) return;

    const feature = geoData.features.find(
      (f) => String(f.id ?? "").toUpperCase() === selectedIso3,
    );
    if (!feature) return;

    globe.pointOfView(computePOV(feature as GeoFeature), 900);
  }, [selectedIso3, geoData]);

  // ── 6. Stop rotation when country selected; resume when deselected ─────────

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    if (selectedIso3) {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      globe.controls().autoRotate = false;
    } else {
      resumeTimerRef.current = setTimeout(() => {
        if (globeRef.current) globeRef.current.controls().autoRotate = true;
      }, RESUME_DELAY_MS);
    }
  }, [selectedIso3]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full rounded-xl overflow-hidden bg-[#f2f4f6]"
    >
      {/* globe.gl owns this div — React never updates its children */}
      <div ref={globeDivRef} className="absolute inset-0" />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center
                        bg-surface-container/80 backdrop-blur-sm rounded-xl z-[1000]">
          <div className="flex flex-col items-center gap-3">
            <span className="material-symbols-outlined text-primary text-4xl animate-spin">
              progress_activity
            </span>
            <p className="text-sm text-on-surface-variant">Loading globe…</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center
                        bg-surface-container/90 rounded-xl z-[1000]">
          <div className="text-center max-w-xs">
            <span className="material-symbols-outlined text-error text-3xl block mb-2">
              wifi_off
            </span>
            <p className="text-sm text-on-surface-variant">
              Could not load map data. Check your connection.
            </p>
            <p className="text-[11px] text-on-surface-variant/70 mt-2 break-words">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}

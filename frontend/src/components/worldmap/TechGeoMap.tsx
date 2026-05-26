/**
 * components/worldmap/TechGeoMap.tsx
 * ────────────────────────────────────
 * Leaflet choropleth world map for the Technology World Map view.
 *
 * - Fetches GeoJSON from Natural Earth / johan/world.geo.json (feature.id = Alpha-3)
 * - Colours each country based on the choroplethColor() function
 * - Hover tooltip shows country name + current parameter value
 * - Click selects country → calls onCountrySelect
 * - Lazy loads GeoJSON; shows spinner while loading
 * - No external tile provider; avoids repeated-world tile fetch noise
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { TechMapType, TechMapParam } from "../../types/worldmap";
import { choroplethColor, PARAM_META, NO_DATA_COLOR } from "../../types/worldmap";
import { ensureWorldMapCatalogue, getParamValues, getGlobalRange, getCountryByIso3 } from "../../services/worldmap.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TechGeoMapProps {
  tech: TechMapType;
  param: TechMapParam;
  year: number;
  selectedIso3: string | null;
  onCountrySelect: (iso3: string, name: string) => void;
  onCatalogueReady?: () => void;
}

// ── GeoJSON source ─────────────────────────────────────────────────────────────
// johan/world.geo.json — feature.id = ISO Alpha-3  |  properties.name = country name
const GEOJSON_URL =
  "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getFeatureStyle(
  iso3: string,
  values: Map<string, number>,
  min: number,
  max: number,
  higherIsBetter: boolean,
  isSelected: boolean,
): L.PathOptions {
  const val = values.get(iso3);
  const fillColor = val != null
    ? choroplethColor(val, min, max, higherIsBetter)
    : NO_DATA_COLOR;

  return {
    fillColor,
    fillOpacity: val != null ? 0.78 : 0.35,
    color: isSelected ? "#4d4b9e" : "#fff",
    weight: isSelected ? 2.5 : 0.6,
    opacity: 1,
  };
}

function getFeatureCentroid(feature: GeoJSON.Feature): { lat: number; lon: number } | null {
  try {
    const bounds = L.geoJSON(feature as GeoJSON.GeoJsonObject).getBounds();
    const center = bounds.getCenter();
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null;
    return { lat: center.lat, lon: center.lng };
  } catch {
    return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TechGeoMap({
  tech,
  param,
  year,
  selectedIso3,
  onCountrySelect,
  onCatalogueReady,
}: TechGeoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const geoLayerRef  = useRef<L.GeoJSON | null>(null);
  const tooltipRef   = useRef<L.Tooltip | null>(null);

  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState<string | null>(null);
  const [catalogueVersion, setCatalogueVersion] = useState(0);

  // Cache GeoJSON so we don't re-fetch on prop changes
  const geoDataRef = useRef<GeoJSON.FeatureCollection | null>(null);

  // ── 1. Init Leaflet map once ─────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center:          [20, 10],
      zoom:            2,
      minZoom:         2,
      maxZoom:         7,
      zoomControl:     true,
      attributionControl: true,
      worldCopyJump:   false,
      maxBounds: [[-85, -180], [85, 180]],
      maxBoundsViscosity: 1.0,
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── 2. Fetch GeoJSON (once) ──────────────────────────────────────────────

  useEffect(() => {
    if (geoDataRef.current) return; // already fetched
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    fetch(GEOJSON_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`GeoJSON fetch failed: ${r.status}`);
        return r.json() as Promise<GeoJSON.FeatureCollection>;
      })
      .then(async (data) => {
        geoDataRef.current = data;
        const countries = data.features
          .map((f) => {
            const centroid = getFeatureCentroid(f);
            return {
              iso3: String(f.id ?? "").toUpperCase(),
              name: String((f.properties as { name?: string } | undefined)?.name ?? f.id ?? ""),
              lat: centroid?.lat,
              lon: centroid?.lon,
            };
          })
          .filter((c) => /^[A-Z]{3}$/.test(c.iso3));

        await ensureWorldMapCatalogue(countries);
        setCatalogueVersion((v) => v + 1);
        onCatalogueReady?.();
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError((e instanceof Error ? e.message : String(e)));
        setLoading(false);
      });
  }, [onCatalogueReady]);

  // ── 3. Re-draw choropleth whenever tech/param/year/selection change ───────
  // useLayoutEffect guarantees the Leaflet layer is rebuilt before the browser
  // paints, so the map colours change on the same frame as any React state update.

  useLayoutEffect(() => {
    const map = mapRef.current;
    const geo = geoDataRef.current;
    if (!map || !geo) return;

    // Remove previous layer
    if (geoLayerRef.current) {
      geoLayerRef.current.remove();
      geoLayerRef.current = null;
    }

    const values         = getParamValues(tech, param, year);
    const [min, max]     = getGlobalRange(tech, param);
    const { higherIsBetter, format } = PARAM_META[param];

    const layer = L.geoJSON(geo, {
      style: (feature) => {
        const iso3 = feature?.id as string ?? "";
        return getFeatureStyle(iso3, values, min, max, higherIsBetter, iso3 === selectedIso3);
      },

      onEachFeature: (feature, layer) => {
        const iso3 = feature.id as string ?? "";
        const name = (feature.properties as { name?: string }).name ?? iso3;
        const val  = values.get(iso3);
        const countryData = getCountryByIso3(iso3);

        // Hover events
        layer.on({
          mouseover(e) {
            const target = e.target as L.Path;
            const curStyle = target.options;
            target.setStyle({
              fillOpacity: Math.min((curStyle.fillOpacity ?? 0.78) + 0.14, 0.95),
              weight: iso3 === selectedIso3 ? 2.5 : 1.5,
              color: iso3 === selectedIso3 ? "#4d4b9e" : "#6366f1",
            });

            // Tooltip
            const content = val != null
              ? `<b>${name}</b><br/>${format(val)}`
              : `<b>${name}</b><br/><span style="color:#9ca3af">No data</span>${countryData ? `<br/><span style="color:#6b7280">Coverage: ${countryData.region}</span>` : ""}`;

            if (tooltipRef.current) map.closeTooltip(tooltipRef.current);
            tooltipRef.current = L.tooltip({
              sticky: true,
              className: "tech-map-tooltip",
              offset: [10, 0],
            })
              .setContent(content)
              .setLatLng((e as L.LeafletMouseEvent).latlng);
            tooltipRef.current.addTo(map);
          },

          mousemove(e) {
            tooltipRef.current?.setLatLng((e as L.LeafletMouseEvent).latlng);
          },

          mouseout() {
            const target = (layer as L.Path);
            target.setStyle(
              getFeatureStyle(iso3, values, min, max, higherIsBetter, iso3 === selectedIso3),
            );
            if (tooltipRef.current) {
              map.closeTooltip(tooltipRef.current);
              tooltipRef.current = null;
            }
          },

          click() {
            onCountrySelect(iso3, name);
          },
        });
      },
    });

    layer.addTo(map);
    geoLayerRef.current = layer;
  }, [tech, param, year, selectedIso3, onCountrySelect, catalogueVersion]);

  // ── 4. Pan+zoom to selected country ─────────────────────────────────────

  useEffect(() => {
    const map   = mapRef.current;
    const layer = geoLayerRef.current;
    if (!map || !layer || !selectedIso3) return;

    layer.eachLayer((l) => {
      const f = (l as L.GeoJSON & { feature?: GeoJSON.Feature }).feature;
      if (f && (f.id as string) === selectedIso3) {
        const bounds = (l as L.Path & { getBounds?: () => L.LatLngBounds }).getBounds?.();
        if (bounds) map.fitBounds(bounds, { maxZoom: 5, padding: [60, 60] });
      }
    });
  }, [selectedIso3]);

  // ── 5. Trigger Leaflet resize when container resizes ─────────────────────

  useEffect(() => {
    const map = mapRef.current;
    const el  = containerRef.current;
    if (!map || !el) return;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden bg-[#dbeafe]">
      {/* Map container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center
                        bg-surface-container/80 backdrop-blur-sm rounded-xl z-[1000]">
          <div className="flex flex-col items-center gap-3">
            <span className="material-symbols-outlined text-primary text-4xl animate-spin">
              progress_activity
            </span>
            <p className="text-sm text-on-surface-variant">Loading world map…</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
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
            <p className="text-[11px] text-on-surface-variant/70 mt-2 break-words">
              {error}
            </p>
          </div>
        </div>
      )}

      {/* Tooltip CSS — injected once via <style> */}
      <style>{`
        .tech-map-tooltip {
          background: #fff;
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: 8px;
          padding: 6px 10px;
          font-size: 12px;
          font-family: 'Inter', system-ui, sans-serif;
          color: #191c1e;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          pointer-events: none;
        }
        .tech-map-tooltip::before { display: none; }
      `}</style>
    </div>
  );
}

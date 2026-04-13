/**
 * components/timeseries/MapPickerModal.tsx
 * ─────────────────────────────────────────
 * Full-screen Leaflet map popup for picking a geographic point.
 * Uses OpenStreetMap tiles (no API key needed).
 * Reverse-geocodes the clicked point via Nominatim to show country info.
 *
 * Usage:
 *   <MapPickerModal
 *     initialLat={lat}
 *     initialLon={lon}
 *     onConfirm={(lat, lon, label) => { ... }}
 *     onClose={() => { ... }}
 *   />
 */

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet's default icon path broken by bundlers
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon   from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl:       markerIcon,
  shadowUrl:     markerShadow,
});

interface MapPickerModalProps {
  initialLat?: number | null;
  initialLon?: number | null;
  onConfirm: (lat: number, lon: number, label: string) => void;
  onClose: () => void;
}

interface NominatimResult {
  display_name: string;
  address?: {
    country?: string;
    country_code?: string;
  };
}

export default function MapPickerModal({
  initialLat,
  initialLon,
  onConfirm,
  onClose,
}: MapPickerModalProps) {
  const mapDivRef  = useRef<HTMLDivElement>(null);
  const mapRef     = useRef<L.Map | null>(null);
  const markerRef  = useRef<L.Marker | null>(null);

  const [picked,   setPicked]   = useState<{ lat: number; lon: number } | null>(
    initialLat != null && initialLon != null ? { lat: initialLat, lon: initialLon } : null
  );
  const [label,    setLabel]    = useState<string>("");
  const [geocoding, setGeocoding] = useState(false);

  // ── Reverse-geocode via Nominatim ─────────────────────────────────
  const reverseGeocode = async (lat: number, lon: number) => {
    setGeocoding(true);
    setLabel("");
    try {
      const url =
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
        `&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&zoom=5&addressdetails=1`;
      const res  = await fetch(url, {
        headers: { "Accept-Language": "en", "User-Agent": "opentech-db/1.0" },
      });
      if (res.ok) {
        const data: NominatimResult = await res.json();
        const country     = data.address?.country ?? "";
        const countryCode = (data.address?.country_code ?? "").toUpperCase();
        setLabel(countryCode ? `${country} (${countryCode})` : data.display_name);
      }
    } catch {
      /* ignore — label stays blank */
    } finally {
      setGeocoding(false);
    }
  };

  // ── Init Leaflet ──────────────────────────────────────────────────
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;

    const centerLat = initialLat ?? 20;
    const centerLon = initialLon ?? 10;
    const zoom      = initialLat != null ? 6 : 2;

    const map = L.map(mapDivRef.current, {
      center:    [centerLat, centerLon],
      zoom,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    // Place initial marker if coordinates given
    if (initialLat != null && initialLon != null) {
      markerRef.current = L.marker([initialLat, initialLon]).addTo(map);
      reverseGeocode(initialLat, initialLon);
    }

    // Click handler
    map.on("click", (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      setPicked({ lat, lon: lng });

      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng]).addTo(map);
      }

      reverseGeocode(lat, lng);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current  = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirm = () => {
    if (!picked) return;
    onConfirm(picked.lat, picked.lon, label);
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-4xl overflow-hidden"
           style={{ height: "min(85vh, 680px)" }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-indigo-500 text-[20px]">location_on</span>
            <h3 className="font-bold text-slate-800 text-base">Pick Location on Map</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                       hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* ── Map ── */}
        <div ref={mapDivRef} className="flex-1 w-full" />

        {/* ── Footer ── */}
        <div className="px-5 py-3.5 border-t border-slate-200 shrink-0 flex items-center gap-4">
          {/* Picked info */}
          <div className="flex-1 min-w-0">
            {picked ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="material-symbols-outlined text-[15px] text-indigo-500">pin_drop</span>
                <span className="font-mono text-sm text-slate-700">
                  {picked.lat.toFixed(5)}, {picked.lon.toFixed(5)}
                </span>
                {geocoding ? (
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px] animate-spin">autorenew</span>
                    Looking up…
                  </span>
                ) : label ? (
                  <span className="text-sm text-slate-500 truncate">· {label}</span>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-slate-400">Click anywhere on the map to place a pin</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm text-slate-500 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!picked}
              onClick={handleConfirm}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold
                         bg-indigo-600 hover:bg-indigo-700 text-white transition-colors
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[16px]">check</span>
              Confirm Location
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

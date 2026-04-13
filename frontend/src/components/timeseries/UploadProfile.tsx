/**
 * components/timeseries/UploadProfile.tsx
 * ─────────────────────────────────────────
 * Upload form for contributor-supplied time-series data.
 *
 * Accepts CSV or JSON — the user picks the format.
 *
 * CSV expected format
 * ───────────────────
 *   timestamp,value
 *   2019-01-01 00:00:00,0.142
 *   2019-01-01 01:00:00,0.198
 *
 * JSON accepted shapes
 * ────────────────────
 *   [{timestamp,value}, ...]
 *   {points:[{timestamp,value},...]}  
 *   [[timestamp, value], ...]
 *   {"2019-01-01 00:00:00": 0.142, ...}
 *
 * React 19 patterns
 * ─────────────────
 * useActionState + useFormStatus — drives async submission without extra
 * useTransition / useState for isPending.
 */

import { useActionState, useEffect, useRef, useState, useCallback } from "react";
import { useFormStatus } from "react-dom";
import { z } from "zod";
import {
  uploadTimeSeriesProfile,
} from "../../services/timeseries";
import { useAuth } from "../../context/AuthContext";
import type { ProfileType, ProfileResolution } from "../../types/timeseries";
import MapPickerModal from "./MapPickerModal";

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────
const PROFILE_TYPE_VALUES  = ["capacity_factor", "generation", "load", "weather", "price"] as const;
const RESOLUTION_VALUES    = ["15min", "30min", "hourly", "daily"]                          as const;

const CARRIER_OPTIONS = [
  "electricity", "natural_gas", "hydrogen", "heat", "cooling",
  "steam", "oil", "coal", "biomass", "biogas", "syngas",
  "water", "co2", "ammonia", "wind", "solar_irradiance", "nuclear_fuel",
] as const;

const PROFILE_TYPE_OPTIONS: { value: ProfileType; label: string; icon: string }[] = [
  { value: "capacity_factor", label: "Capacity Factor (0 – 1 p.u.)", icon: "speed"             },
  { value: "generation",      label: "Generation (MW / MWh)",         icon: "bolt"              },
  { value: "load",            label: "Load / Demand (MW)",            icon: "electric_meter"    },
  { value: "weather",         label: "Weather (°C, m/s, W/m²…)",     icon: "partly_cloudy_day" },
  { value: "price",           label: "Price (€/MWh)",                 icon: "payments"          },
];

const RESOLUTION_OPTIONS: { value: ProfileResolution; label: string; pts: string }[] = [
  { value: "15min",  label: "15-minute", pts: "35 040 pts/yr" },
  { value: "30min",  label: "30-minute", pts: "17 520 pts/yr" },
  { value: "hourly", label: "Hourly",    pts:  "8 760 pts/yr" },
  { value: "daily",  label: "Daily",     pts:    "365 pts/yr" },
];

const UNIT_OPTIONS: { group: string; units: { value: string; label: string }[] }[] = [
  {
    group: "Dimensionless / Ratio",
    units: [
      { value: "p.u.",  label: "p.u. — per unit (0–1)" },
      { value: "%",     label: "% — percent" },
    ],
  },
  {
    group: "Power",
    units: [
      { value: "W",   label: "W — Watt" },
      { value: "kW",  label: "kW — Kilowatt" },
      { value: "MW",  label: "MW — Megawatt" },
      { value: "GW",  label: "GW — Gigawatt" },
      { value: "TW",  label: "TW — Terawatt" },
    ],
  },
  {
    group: "Energy",
    units: [
      { value: "Wh",  label: "Wh — Watt-hour" },
      { value: "kWh", label: "kWh — Kilowatt-hour" },
      { value: "MWh", label: "MWh — Megawatt-hour" },
      { value: "GWh", label: "GWh — Gigawatt-hour" },
      { value: "TWh", label: "TWh — Terawatt-hour" },
    ],
  },
  {
    group: "Price",
    units: [
      { value: "EUR/MWh", label: "EUR/MWh" },
      { value: "USD/MWh", label: "USD/MWh" },
      { value: "EUR/kWh", label: "EUR/kWh" },
      { value: "EUR/GJ",  label: "EUR/GJ" },
    ],
  },
  {
    group: "Weather / Environment",
    units: [
      { value: "W/m²", label: "W/m² — Irradiance" },
      { value: "m/s",  label: "m/s — Wind speed" },
      { value: "°C",   label: "°C — Temperature" },
      { value: "K",    label: "K — Kelvin" },
      { value: "mm",   label: "mm — Precipitation" },
      { value: "Pa",   label: "Pa — Pressure" },
    ],
  },
  {
    group: "Mass / Flow",
    units: [
      { value: "kg",  label: "kg — Kilogram" },
      { value: "t",   label: "t — Tonne" },
      { value: "t/h", label: "t/h — Tonnes per hour" },
      { value: "m³",  label: "m³ — Cubic metre" },
      { value: "m³/s",label: "m³/s — Flow rate" },
    ],
  },
];

// Flat list used for validation / default check
const ALL_PRESET_UNITS = UNIT_OPTIONS.flatMap((g) => g.units.map((u) => u.value));

// ─────────────────────────────────────────────────────────────────────
// Country list  (ISO 3166-1 alpha-2 + common name)
// ─────────────────────────────────────────────────────────────────────
const COUNTRIES: { code: string; name: string }[] = [
  { code: "AF", name: "Afghanistan" }, { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria" }, { code: "AD", name: "Andorra" },
  { code: "AO", name: "Angola" }, { code: "AR", name: "Argentina" },
  { code: "AM", name: "Armenia" }, { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" }, { code: "AZ", name: "Azerbaijan" },
  { code: "BS", name: "Bahamas" }, { code: "BH", name: "Bahrain" },
  { code: "BD", name: "Bangladesh" }, { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" }, { code: "BZ", name: "Belize" },
  { code: "BJ", name: "Benin" }, { code: "BT", name: "Bhutan" },
  { code: "BO", name: "Bolivia" }, { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "BW", name: "Botswana" }, { code: "BR", name: "Brazil" },
  { code: "BN", name: "Brunei" }, { code: "BG", name: "Bulgaria" },
  { code: "BF", name: "Burkina Faso" }, { code: "BI", name: "Burundi" },
  { code: "CV", name: "Cabo Verde" }, { code: "KH", name: "Cambodia" },
  { code: "CM", name: "Cameroon" }, { code: "CA", name: "Canada" },
  { code: "CF", name: "Central African Republic" }, { code: "TD", name: "Chad" },
  { code: "CL", name: "Chile" }, { code: "CN", name: "China" },
  { code: "CO", name: "Colombia" }, { code: "KM", name: "Comoros" },
  { code: "CD", name: "Congo (DRC)" }, { code: "CG", name: "Congo (Republic)" },
  { code: "CR", name: "Costa Rica" }, { code: "HR", name: "Croatia" },
  { code: "CU", name: "Cuba" }, { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czech Republic" }, { code: "DK", name: "Denmark" },
  { code: "DJ", name: "Djibouti" }, { code: "DO", name: "Dominican Republic" },
  { code: "EC", name: "Ecuador" }, { code: "EG", name: "Egypt" },
  { code: "SV", name: "El Salvador" }, { code: "GQ", name: "Equatorial Guinea" },
  { code: "ER", name: "Eritrea" }, { code: "EE", name: "Estonia" },
  { code: "SZ", name: "Eswatini" }, { code: "ET", name: "Ethiopia" },
  { code: "FJ", name: "Fiji" }, { code: "FI", name: "Finland" },
  { code: "FR", name: "France" }, { code: "GA", name: "Gabon" },
  { code: "GM", name: "Gambia" }, { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany" }, { code: "GH", name: "Ghana" },
  { code: "GR", name: "Greece" }, { code: "GT", name: "Guatemala" },
  { code: "GN", name: "Guinea" }, { code: "GW", name: "Guinea-Bissau" },
  { code: "GY", name: "Guyana" }, { code: "HT", name: "Haiti" },
  { code: "HN", name: "Honduras" }, { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" }, { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" }, { code: "IR", name: "Iran" },
  { code: "IQ", name: "Iraq" }, { code: "IE", name: "Ireland" },
  { code: "IL", name: "Israel" }, { code: "IT", name: "Italy" },
  { code: "JM", name: "Jamaica" }, { code: "JP", name: "Japan" },
  { code: "JO", name: "Jordan" }, { code: "KZ", name: "Kazakhstan" },
  { code: "KE", name: "Kenya" }, { code: "KW", name: "Kuwait" },
  { code: "KG", name: "Kyrgyzstan" }, { code: "LA", name: "Laos" },
  { code: "LV", name: "Latvia" }, { code: "LB", name: "Lebanon" },
  { code: "LS", name: "Lesotho" }, { code: "LR", name: "Liberia" },
  { code: "LY", name: "Libya" }, { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" }, { code: "LU", name: "Luxembourg" },
  { code: "MG", name: "Madagascar" }, { code: "MW", name: "Malawi" },
  { code: "MY", name: "Malaysia" }, { code: "MV", name: "Maldives" },
  { code: "ML", name: "Mali" }, { code: "MT", name: "Malta" },
  { code: "MR", name: "Mauritania" }, { code: "MU", name: "Mauritius" },
  { code: "MX", name: "Mexico" }, { code: "MD", name: "Moldova" },
  { code: "MC", name: "Monaco" }, { code: "MN", name: "Mongolia" },
  { code: "ME", name: "Montenegro" }, { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" }, { code: "MM", name: "Myanmar" },
  { code: "NA", name: "Namibia" }, { code: "NP", name: "Nepal" },
  { code: "NL", name: "Netherlands" }, { code: "NZ", name: "New Zealand" },
  { code: "NI", name: "Nicaragua" }, { code: "NE", name: "Niger" },
  { code: "NG", name: "Nigeria" }, { code: "MK", name: "North Macedonia" },
  { code: "NO", name: "Norway" }, { code: "OM", name: "Oman" },
  { code: "PK", name: "Pakistan" }, { code: "PA", name: "Panama" },
  { code: "PG", name: "Papua New Guinea" }, { code: "PY", name: "Paraguay" },
  { code: "PE", name: "Peru" }, { code: "PH", name: "Philippines" },
  { code: "PL", name: "Poland" }, { code: "PT", name: "Portugal" },
  { code: "QA", name: "Qatar" }, { code: "RO", name: "Romania" },
  { code: "RU", name: "Russia" }, { code: "RW", name: "Rwanda" },
  { code: "SA", name: "Saudi Arabia" }, { code: "SN", name: "Senegal" },
  { code: "RS", name: "Serbia" }, { code: "SL", name: "Sierra Leone" },
  { code: "SG", name: "Singapore" }, { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" }, { code: "SO", name: "Somalia" },
  { code: "ZA", name: "South Africa" }, { code: "SS", name: "South Sudan" },
  { code: "ES", name: "Spain" }, { code: "LK", name: "Sri Lanka" },
  { code: "SD", name: "Sudan" }, { code: "SR", name: "Suriname" },
  { code: "SE", name: "Sweden" }, { code: "CH", name: "Switzerland" },
  { code: "SY", name: "Syria" }, { code: "TW", name: "Taiwan" },
  { code: "TJ", name: "Tajikistan" }, { code: "TZ", name: "Tanzania" },
  { code: "TH", name: "Thailand" }, { code: "TL", name: "Timor-Leste" },
  { code: "TG", name: "Togo" }, { code: "TT", name: "Trinidad and Tobago" },
  { code: "TN", name: "Tunisia" }, { code: "TR", name: "Turkey" },
  { code: "TM", name: "Turkmenistan" }, { code: "UG", name: "Uganda" },
  { code: "UA", name: "Ukraine" }, { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" }, { code: "US", name: "United States" },
  { code: "UY", name: "Uruguay" }, { code: "UZ", name: "Uzbekistan" },
  { code: "VE", name: "Venezuela" }, { code: "VN", name: "Vietnam" },
  { code: "YE", name: "Yemen" }, { code: "ZM", name: "Zambia" },
  { code: "ZW", name: "Zimbabwe" },
  // EU / NUTS top-level regions
  { code: "EU", name: "European Union" },
  { code: "EEA", name: "European Economic Area" },
];

// ─────────────────────────────────────────────────────────────────────
// LocationPicker — country combobox + map picker modal
// ─────────────────────────────────────────────────────────────────────
function LocationPicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (val: string) => void;
  error?: string;
}) {
  const [query,   setQuery]   = useState(() => {
    const match = COUNTRIES.find((c) => c.code === value);
    return match ? `${match.name} (${match.code})` : value;
  });
  const [open,    setOpen]    = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = query.trim() === ""
    ? COUNTRIES
    : COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.code.toLowerCase().includes(query.toLowerCase())
      );

  const selectCountry = (c: { code: string; name: string }) => {
    onChange(c.code);
    setQuery(`${c.name} (${c.code})`);
    setOpen(false);
  };

  const BASE_CLS =
    "w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-3 py-2.5 " +
    "text-sm text-on-surface placeholder:text-on-surface-variant/40 " +
    "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all" +
    (error ? " border-red-400 focus:ring-red-200" : "");

  // Parse stored coords to re-open map at same spot
  const storedCoords: { lat: number; lon: number } | null = (() => {
    const parts = value.split(",");
    if (parts.length === 2) {
      const la = parseFloat(parts[0]); const lo = parseFloat(parts[1]);
      if (!isNaN(la) && !isNaN(lo)) return { lat: la, lon: lo };
    }
    return null;
  })();

  return (
    <>
      <div ref={wrapRef} className="relative flex items-center gap-2">
        {/* Country search input */}
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-slate-400 pointer-events-none">
            search
          </span>
          <input
            id="up-location"
            type="text"
            autoComplete="off"
            value={query}
            placeholder="Search country or type code…"
            onFocus={() => { setOpen(true); if (query) setQuery(""); }}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); onChange(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && filtered.length > 0) {
                e.preventDefault();
                selectCountry(filtered[0]);
              }
            }}
            className={`${BASE_CLS} pl-9`}
          />
          {/* Country dropdown */}
          {open && (
            <ul
              className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto
                         bg-white border border-slate-200 rounded-xl shadow-lg py-1"
            >
              {filtered.length === 0 && (
                <li className="px-4 py-2 text-sm text-slate-400">No matches</li>
              )}
              {filtered.map((c) => (
                <li key={c.code}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); selectCountry(c); }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-indigo-50 hover:text-indigo-700
                               flex items-center gap-3"
                  >
                    <span className="font-mono text-[11px] font-bold text-slate-400 w-8 shrink-0">{c.code}</span>
                    <span>{c.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Open map picker button */}
        <button
          type="button"
          title="Pick exact location on map"
          onClick={() => { setOpen(false); setMapOpen(true); }}
          className="shrink-0 h-[42px] px-3 flex items-center gap-1.5 rounded-xl
                     border border-slate-300 bg-slate-50 text-slate-600 text-[12px] font-semibold
                     hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 transition-colors"
        >
          <span className="material-symbols-outlined text-[15px]">map</span>
          Map
        </button>
      </div>

      {/* Pinned coords badge shown after map pick */}
      {storedCoords && (
        <p className="text-[11px] text-slate-400 font-mono mt-1 flex items-center gap-1">
          <span className="material-symbols-outlined text-[12px] text-indigo-400">pin_drop</span>
          {storedCoords.lat.toFixed(5)}, {storedCoords.lon.toFixed(5)}
          <button
            type="button"
            onClick={() => { onChange(""); setQuery(""); }}
            className="ml-2 text-slate-300 hover:text-red-400 transition-colors"
          >
            × clear
          </button>
        </p>
      )}

      {/* Map modal */}
      {mapOpen && (
        <MapPickerModal
          initialLat={storedCoords?.lat}
          initialLon={storedCoords?.lon}
          onConfirm={(lat, lon, label) => {
            const coordStr = `${lat.toFixed(5)},${lon.toFixed(5)}`;
            onChange(coordStr);
            setQuery(label || coordStr);
            setMapOpen(false);
          }}
          onClose={() => setMapOpen(false)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Zod schema
// ─────────────────────────────────────────────────────────────────────
const schema = z.object({
  name:        z.string().min(3, "At least 3 characters").max(120),
  carrier:     z.string().min(1, "Required"),
  type:        z.enum(PROFILE_TYPE_VALUES),
  resolution:  z.enum(RESOLUTION_VALUES),
  location:    z.string().min(1, "Required").max(60),
  source:      z.string().min(1, "Required").max(120),
  year:        z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number().int().min(1900).max(2100).optional()
  ),
  unit:        z.string().min(1, "Required").max(30),
  description: z.string().max(500).optional(),
});

type Fields = z.infer<typeof schema>;
type FieldErrors = Partial<Record<keyof Fields | "file" | "_root", string>>;

// ─────────────────────────────────────────────────────────────────────
// Form state
// ─────────────────────────────────────────────────────────────────────
type FormState =
  | { status: "idle" }
  | { status: "validationError"; errors: FieldErrors }
  | { status: "success"; profileId: string; name: string; n: number }
  | { status: "error"; message: string };

const INITIAL: FormState = { status: "idle" };

const EMPTY_FIELDS = {
  name: "", carrier: "", type: "" as string, resolution: "" as string,
  location: "", source: "", year: "", unit: "p.u.", description: "",
};

// ─────────────────────────────────────────────────────────────────────
// Shared styling
// ─────────────────────────────────────────────────────────────────────
const INPUT =
  "w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-3 py-2.5 " +
  "text-sm text-on-surface placeholder:text-on-surface-variant/40 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all";
const INPUT_ERR = "border-red-400 focus:ring-red-200";

// ─────────────────────────────────────────────────────────────────────
// LabeledField
// ─────────────────────────────────────────────────────────────────────
function LF({
  id, label, hint, error, required,
  children,
}: {
  id: string; label: string; hint?: string; error?: string;
  required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-bold text-on-surface-variant uppercase tracking-wide">
        {label}{required && <span className="text-primary ml-0.5">*</span>}
      </label>
      {children}
      {error
        ? <p role="alert" className="text-xs text-red-600 font-medium flex items-center gap-1">
            <span className="material-symbols-outlined text-[12px]">error</span>{error}
          </p>
        : hint
        ? <p className="text-[11px] text-on-surface-variant/50">{hint}</p>
        : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SubmitButton
// ─────────────────────────────────────────────────────────────────────
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex items-center gap-2 px-7 py-3 rounded-xl font-bold text-sm
                 bg-primary text-on-primary shadow-sm transition-all
                 hover:brightness-105 active:scale-95
                 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending
        ? <><span className="material-symbols-outlined text-[18px] animate-spin">autorenew</span>Uploading…</>
        : <><span className="material-symbols-outlined text-[18px]">cloud_upload</span>Upload Profile</>}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FilePreview — shows first few rows of the picked file
// ─────────────────────────────────────────────────────────────────────
function FilePreview({ file }: { file: File }) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    let cancelled = false;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (cancelled) return;
      const text = e.target?.result as string;
      setPreview(text.split("\n").slice(0, 8).join("\n"));
    };
    reader.readAsText(file.slice(0, 2 * 1024 * 1024));
    return () => { cancelled = true; };
  }, [file]);

  if (!preview) return null;
  return (
    <div className="mt-3 bg-surface-container rounded-xl border border-outline-variant/20 p-3 overflow-x-auto">
      <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/40 mb-1.5">
        Preview (first 8 rows)
      </p>
      <pre className="text-[11px] font-mono text-on-surface/70 leading-relaxed whitespace-pre">
        {preview}
      </pre>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// DropZone
// ─────────────────────────────────────────────────────────────────────
function DropZone({
  fileRef,
  file,
  onFile,
  error,
  format,
}: {
  fileRef: React.RefObject<HTMLInputElement | null>;
  file: File | null;
  onFile: (f: File) => void;
  error?: string;
  format: "csv" | "json";
}) {
  const [dragging, setDragging] = useState(false);

  const accept = format === "csv" ? ".csv,text/csv" : ".json,application/json";
  const hint   = format === "csv"
    ? "CSV — two columns: timestamp, value"
    : "JSON — array, {points:[]}, or mapping";

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile]);

  return (
    <div>
      <label
        htmlFor="up-file"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={[
          "relative flex flex-col items-center justify-center gap-3",
          "border-2 border-dashed rounded-2xl px-6 py-10 cursor-pointer transition-all",
          dragging         ? "border-primary bg-primary/5 scale-[1.01]"              : "",
          error            ? "border-red-400 bg-red-50"                               : "",
          !dragging && !error ? "border-outline-variant/35 hover:border-primary/40 hover:bg-primary/3" : "",
        ].join(" ")}
      >
        {file ? (
          <>
            <span className="material-symbols-outlined text-4xl text-primary">
              {format === "csv" ? "table" : "data_object"}
            </span>
            <div className="text-center">
              <p className="text-sm font-bold text-on-surface">{file.name}</p>
              <p className="text-xs text-on-surface-variant/50 mt-0.5">
                {(file.size / 1024).toFixed(1)} KB — click to replace
              </p>
            </div>
          </>
        ) : (
          <>
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/25">
              upload_file
            </span>
            <div className="text-center">
              <p className="text-sm font-bold text-on-surface">Drop file here or click to browse</p>
              <p className="text-xs text-on-surface-variant/50 mt-0.5">{hint} · max 50 MB</p>
            </div>
          </>
        )}
        <input
          id="up-file"
          ref={fileRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        />
      </label>

      {error && (
        <p role="alert" className="text-xs text-red-600 font-medium flex items-center gap-1 mt-1.5">
          <span className="material-symbols-outlined text-[12px]">error</span>{error}
        </p>
      )}

      {file && <FilePreview file={file} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Format samples
// ─────────────────────────────────────────────────────────────────────
const CSV_SAMPLE = `timestamp,value
2019-01-01 00:00:00,0.142
2019-01-01 01:00:00,0.198
2019-01-01 02:00:00,0.231
…`;

const JSON_SAMPLE = `[
  { "timestamp": "2019-01-01 00:00:00", "value": 0.142 },
  { "timestamp": "2019-01-01 01:00:00", "value": 0.198 },
  …
]
// also accepted: {points:[...]}, [[ts,v],...], {"ts":v,...}`;

// ─────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────
interface UploadProfileProps {
  onUploadSuccess?: (profileId: string, name: string) => void;
}

export default function UploadProfile({ onUploadSuccess }: UploadProfileProps) {
  const { token }   = useAuth();
  const fileRef     = useRef<HTMLInputElement>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [format, setFormat]         = useState<"csv" | "json">("csv");
  const [customUnit, setCustomUnit] = useState(false);

  const [fields, setFields] = useState({ ...EMPTY_FIELDS });
  const set = (k: keyof typeof fields) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setFields((p) => ({ ...p, [k]: e.target.value }));

  const [formState, formAction] = useActionState(
    async (_prev: FormState, _fd: FormData): Promise<FormState> => {
      // 1 — Validate metadata
      const parsed = schema.safeParse({ ...fields });
      const errs: FieldErrors = {};
      if (!parsed.success) {
        const fe = parsed.error.flatten().fieldErrors;
        (Object.entries(fe) as [keyof Fields, string[] | undefined][])
          .forEach(([k, v]) => { if (v?.[0]) errs[k] = v[0]; });
      }

      // 2 — Validate file
      const file = pickedFile;
      if (!file) {
        errs.file = "A file is required.";
      } else if (file.size > 50 * 1024 * 1024) {
        errs.file = "File must be smaller than 50 MB.";
      } else if (
        format === "csv" && !file.name.toLowerCase().endsWith(".csv")
      ) {
        errs.file = "Expected a .csv file.";
      } else if (
        format === "json" && !file.name.toLowerCase().endsWith(".json")
      ) {
        errs.file = "Expected a .json file.";
      }

      if (Object.keys(errs).length > 0) return { status: "validationError", errors: errs };

      // 3 — Build multipart payload
      const fd = new FormData();
      fd.append("name",        fields.name);
      fd.append("carrier",     fields.carrier);
      fd.append("type",        fields.type);
      fd.append("resolution",  fields.resolution);
      fd.append("location",    fields.location);
      fd.append("source",      fields.source);
      fd.append("unit",        fields.unit || "p.u.");
      if (fields.year)        fd.append("year",        fields.year);
      if (fields.description) fd.append("description", fields.description);
      fd.append("file", file!);

      try {
        const result = await uploadTimeSeriesProfile(fd, token);
        onUploadSuccess?.(result.submission_id, result.name);
        return { status: "success", profileId: result.submission_id, name: result.name, n: result.n_timesteps };
      } catch (err) {
        return { status: "error", message: err instanceof Error ? err.message : "Upload failed." };
      }
    },
    INITIAL
  );

  const errors = formState.status === "validationError" ? formState.errors : {};

  // ── Success screen ───────────────────────────────────────────────
  if (formState.status === "success") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto">
        <div className="flex flex-col items-center gap-6 max-w-md text-center py-16 px-8">
          <div className="w-20 h-20 rounded-3xl bg-amber-100 flex items-center justify-center">
            <span className="material-symbols-outlined text-4xl text-amber-600">pending</span>
          </div>
          <div>
            <h3 className="font-headline text-2xl font-bold text-on-surface">Submitted for Review</h3>
            <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">
              <strong>{formState.name}</strong> with {formState.n.toLocaleString()} time steps
              has been submitted for admin review. It will appear in the Time Series catalogue
              once an administrator approves it.
            </p>
            <p className="text-[11px] font-mono text-on-surface-variant/30 mt-2">Submission ID: {formState.profileId}</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => { setFields({ ...EMPTY_FIELDS }); setPickedFile(null); }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary/8 hover:bg-primary/15
                         text-primary font-bold text-sm border border-primary/20 transition-all"
            >
              <span className="material-symbols-outlined text-[17px]">add</span>
              Upload Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Two-column full-screen form ──────────────────────────────────
  return (
    <form action={formAction} noValidate className="flex h-full min-h-0">

      {/* ─── LEFT PANEL: scrollable metadata form ────────────────────── */}
      <div className="w-[560px] flex-shrink-0 flex flex-col min-h-0 border-r border-outline-variant/15">

        {/* Left header */}
        <div className="flex-shrink-0 flex items-center gap-2.5 px-6 py-3.5
                        border-b border-outline-variant/15 bg-surface-container-low/50">
          <span className="material-symbols-outlined text-[17px] text-primary">label</span>
          <span className="text-sm font-bold text-on-surface">Profile Metadata</span>
        </div>

        {/* Scrollable form fields */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Inline error banner */}
          {formState.status === "error" && (
            <div role="alert" className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
              <span className="material-symbols-outlined text-lg text-red-600 flex-shrink-0 mt-0.5">error</span>
              <div>
                <p className="text-sm font-bold text-red-800">Upload failed</p>
                <p className="text-xs text-red-700">{formState.message}</p>
              </div>
            </div>
          )}

          <div className="space-y-7">

            {/* Name */}
            <LF id="up-name" label="Profile Name" required error={errors.name}
              hint="Descriptive name, e.g. DE Onshore Wind CF 2023">
              <input id="up-name" type="text" value={fields.name} onChange={set("name")}
                placeholder="DE Offshore Wind Capacity Factor 2023"
                className={`${INPUT} ${errors.name ? INPUT_ERR : ""}`} />
            </LF>

            {/* Profile type — card picker */}
            <div>
              <p className="block text-xs font-bold text-on-surface-variant uppercase tracking-wide mb-2">
                Profile Type <span className="text-primary">*</span>
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {PROFILE_TYPE_OPTIONS.map(({ value, label, icon }) => {
                  const active = fields.type === value;
                  return (
                    <button key={value} type="button"
                      onClick={() => setFields((p) => ({ ...p, type: value }))}
                      className={[
                        "flex flex-col items-center gap-1 py-3 px-2 rounded-xl border transition-all text-center",
                        active
                          ? "border-primary/40 bg-primary/8 text-primary"
                          : "border-outline-variant/20 bg-surface-container text-on-surface-variant hover:border-outline-variant/40",
                      ].join(" ")}
                    >
                      <span className="material-symbols-outlined text-xl">{icon}</span>
                      <span className="text-[10px] font-bold leading-tight">{label.split(" (")[0]}</span>
                    </button>
                  );
                })}
              </div>
              {errors.type && (
                <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">error</span>{errors.type}
                </p>
              )}
            </div>

            {/* Resolution — button group */}
            <div>
              <p className="block text-xs font-bold text-on-surface-variant uppercase tracking-wide mb-2">
                Temporal Resolution <span className="text-primary">*</span>
              </p>
              <div className="flex gap-2 flex-wrap">
                {RESOLUTION_OPTIONS.map(({ value, label, pts }) => {
                  const active = fields.resolution === value;
                  return (
                    <button key={value} type="button"
                      onClick={() => setFields((p) => ({ ...p, resolution: value }))}
                      className={[
                        "flex flex-col items-start px-4 py-2.5 rounded-xl border transition-all",
                        active
                          ? "border-primary/40 bg-primary/8 text-primary"
                          : "border-outline-variant/20 text-on-surface-variant hover:border-outline-variant/40",
                      ].join(" ")}
                    >
                      <span className="text-sm font-bold">{label}</span>
                      <span className="text-[9px] font-mono opacity-60">{pts}</span>
                    </button>
                  );
                })}
              </div>
              {errors.resolution && (
                <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">error</span>{errors.resolution}
                </p>
              )}
            </div>

            {/* ── divider ──────────────────────────────────────── */}
            <div className="border-t border-outline-variant/15" />

            {/* ── 2-col grid for smaller fields ────────────────── */}
            <div className="grid grid-cols-2 gap-5">

              {/* Carrier — full width */}
              <div className="col-span-2">
                <LF id="up-carrier" label="Energy Carrier" required error={errors.carrier}
                  hint="OEO-aligned carrier type">
                  <select id="up-carrier" value={fields.carrier} onChange={set("carrier")}
                    className={`${INPUT} ${errors.carrier ? INPUT_ERR : ""}`}>
                    <option value="">— select —</option>
                    {CARRIER_OPTIONS.map((c) => (
                      <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </LF>
              </div>

              {/* Location */}
              <LF id="up-location" label="Location" required error={errors.location}
                hint="Select a country or enter exact coordinates (lat, lon)">
                <LocationPicker
                  value={fields.location}
                  onChange={(val) => setFields((p) => ({ ...p, location: val }))}
                  error={errors.location}
                />
              </LF>

              {/* Source */}
              <LF id="up-source" label="Data Source" required error={errors.source}
                hint="Provenance: ERA5, ENTSO-E, Renewables.ninja, OPSD…">
                <input id="up-source" type="text" value={fields.source} onChange={set("source")}
                  placeholder="ERA5 reanalysis" className={`${INPUT} ${errors.source ? INPUT_ERR : ""}`} />
              </LF>

              {/* Unit */}
              <LF id="up-unit" label="Unit" required error={errors.unit}
                hint="Choose a common unit or press + to enter a custom one">
                <div className="flex items-center gap-2">
                  {customUnit ? (
                    // ── Custom text input mode ──
                    <>
                      <input
                        id="up-unit"
                        type="text"
                        autoFocus
                        value={fields.unit}
                        onChange={set("unit")}
                        placeholder="e.g. kg/s, t CO₂/MWh…"
                        className={`flex-1 ${INPUT} ${errors.unit ? INPUT_ERR : ""}`}
                      />
                      <button
                        type="button"
                        title="Back to preset list"
                        onClick={() => {
                          setCustomUnit(false);
                          // reset to first preset only if current value isn't a preset
                          if (!ALL_PRESET_UNITS.includes(fields.unit)) {
                            setFields((p) => ({ ...p, unit: "p.u." }));
                          }
                        }}
                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg
                                   border border-slate-300 text-slate-500 hover:bg-slate-100
                                   transition-colors text-[15px] font-bold"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </>
                  ) : (
                    // ── Dropdown mode ──
                    <>
                      <select
                        id="up-unit"
                        value={fields.unit}
                        onChange={set("unit")}
                        className={`flex-1 ${INPUT} ${errors.unit ? INPUT_ERR : ""}`}
                      >
                        {UNIT_OPTIONS.map((group) => (
                          <optgroup key={group.group} label={group.group}>
                            {group.units.map((u) => (
                              <option key={u.value} value={u.value}>{u.label}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <button
                        type="button"
                        title="Enter a custom unit"
                        onClick={() => {
                          setCustomUnit(true);
                          setFields((p) => ({ ...p, unit: "" }));
                        }}
                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg
                                   border border-slate-300 bg-slate-50 text-indigo-600
                                   hover:bg-indigo-50 hover:border-indigo-400
                                   transition-colors font-bold text-lg leading-none"
                      >
                        +
                      </button>
                    </>
                  )}
                </div>
              </LF>

              {/* Reference year */}
              <LF id="up-year" label="Reference Year" error={errors.year}
                hint="Leave blank if multi-year or unspecified">
                <input id="up-year" type="number" min={1900} max={2100}
                  value={fields.year} onChange={set("year")} placeholder="2023"
                  className={`${INPUT} ${errors.year ? INPUT_ERR : ""}`} />
              </LF>

            </div>

            {/* Description — full width */}
            <LF id="up-desc" label="Description" error={errors.description}
              hint="Optional methodology notes or caveats (max 500 chars)">
              <textarea id="up-desc" rows={4} maxLength={500}
                value={fields.description} onChange={set("description")}
                placeholder="Hourly capacity factor derived from ERA5 for Germany, weather year 2023."
                className={`${INPUT} resize-none ${errors.description ? INPUT_ERR : ""}`} />
            </LF>
          </div>
        </div>

        {/* Sticky submit bar */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4
                        border-t border-outline-variant/15 bg-surface-container-low/40">
          <p className="text-xs text-on-surface-variant/50">
            <span className="text-primary font-bold">*</span> required
          </p>
          <SubmitButton />
        </div>
      </div>

      {/* ─── RIGHT PANEL: file upload ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">

        {/* Right header — format toggle lives here */}
        <div className="flex-shrink-0 flex items-center gap-2.5 px-6 py-3.5
                        border-b border-outline-variant/15 bg-surface-container-low/50">
          <span className="material-symbols-outlined text-[17px] text-primary">upload_file</span>
          <span className="text-sm font-bold text-on-surface">Data File</span>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs text-on-surface-variant/50 mr-1">Format:</span>
            {(["csv", "json"] as const).map((f) => (
              <button key={f} type="button"
                onClick={() => { setFormat(f); setPickedFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                className={[
                  "px-3 py-1 rounded-lg text-xs font-bold border transition-all",
                  format === f
                    ? "bg-primary text-on-primary border-transparent"
                    : "border-outline-variant/30 text-on-surface-variant hover:bg-surface-container",
                ].join(" ")}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Right body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5 space-y-5">

          {/* Format hint */}
          <div className="bg-surface-container rounded-xl border border-outline-variant/15 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant/50 mb-1.5">
              Expected {format.toUpperCase()} format
            </p>
            <pre className="text-[11px] font-mono text-on-surface/70 leading-relaxed overflow-x-auto whitespace-pre-wrap">
              {format === "csv" ? CSV_SAMPLE : JSON_SAMPLE}
            </pre>
          </div>

          {/* Drop zone */}
          <DropZone
            fileRef={fileRef}
            file={pickedFile}
            onFile={setPickedFile}
            error={errors.file}
            format={format}
          />
        </div>
      </div>

    </form>
  );
}

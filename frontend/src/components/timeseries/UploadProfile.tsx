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
 *   2019-01-01T00:00:00Z,0.142
 *   2019-01-01T01:00:00Z,0.198
 *
 * JSON accepted shapes
 * ────────────────────
 *   [{timestamp,value}, ...]
 *   {points:[{timestamp,value},...]}
 *   [[timestamp, value], ...]
 *   {"2019-01-01T00:00:00Z": 0.142, ...}
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
  invalidateTimeSeriesCatalogue,
} from "../../services/timeseries";
import { useAuth } from "../../context/AuthContext";
import type { ProfileType, ProfileResolution } from "../../types/timeseries";

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

const UNIT_SUGGESTIONS = ["p.u.", "MW", "MWh", "EUR/MWh", "W/m²", "m/s", "°C", "GW", "GWh", "t/h", "%"];

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
2019-01-01T00:00:00Z,0.142
2019-01-01T01:00:00Z,0.198
2019-01-01T02:00:00Z,0.231
…`;

const JSON_SAMPLE = `[
  { "timestamp": "2019-01-01T00:00:00Z", "value": 0.142 },
  { "timestamp": "2019-01-01T01:00:00Z", "value": 0.198 },
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
        invalidateTimeSeriesCatalogue();
        onUploadSuccess?.(result.profile_id, result.name);
        return { status: "success", profileId: result.profile_id, name: result.name, n: result.n_timesteps };
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
          <div className="w-20 h-20 rounded-3xl bg-green-100 flex items-center justify-center">
            <span className="material-symbols-outlined text-4xl text-green-600">check_circle</span>
          </div>
          <div>
            <h3 className="font-headline text-2xl font-bold text-on-surface">Profile Uploaded</h3>
            <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">
              <strong>{formState.name}</strong> with {formState.n.toLocaleString()} time steps
              is now available in the Time Series catalogue.
            </p>
            <p className="text-[11px] font-mono text-on-surface-variant/30 mt-2">ID: {formState.profileId}</p>
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

          <div className="grid grid-cols-1 gap-5">

            {/* Name */}
            <div className="md:col-span-2">
              <LF id="up-name" label="Profile Name" required error={errors.name}
                hint="Descriptive name, e.g. DE Onshore Wind CF 2023">
                <input id="up-name" type="text" value={fields.name} onChange={set("name")}
                  placeholder="DE Offshore Wind Capacity Factor 2023"
                  className={`${INPUT} ${errors.name ? INPUT_ERR : ""}`} />
              </LF>
            </div>

            {/* Profile type — card picker */}
            <div className="md:col-span-2">
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
            <div className="md:col-span-2">
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

            {/* ── 2-col grid for smaller fields ────────────────── */}
            <div className="grid grid-cols-2 gap-4">

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
                hint="ISO-3166 country or NUTS code, e.g. DE, FR, DE-BY">
                <input id="up-location" type="text" value={fields.location} onChange={set("location")}
                  placeholder="DE" className={`${INPUT} ${errors.location ? INPUT_ERR : ""}`} />
              </LF>

              {/* Source */}
              <LF id="up-source" label="Data Source" required error={errors.source}
                hint="Provenance: ERA5, ENTSO-E, Renewables.ninja, OPSD…">
                <input id="up-source" type="text" value={fields.source} onChange={set("source")}
                  placeholder="ERA5 reanalysis" className={`${INPUT} ${errors.source ? INPUT_ERR : ""}`} />
              </LF>

              {/* Unit */}
              <LF id="up-unit" label="Unit" required error={errors.unit}
                hint="Physical unit of each value, e.g. p.u., MW, EUR/MWh">
                <input id="up-unit" type="text" list="up-unit-list"
                  value={fields.unit} onChange={set("unit")} placeholder="p.u."
                  className={`${INPUT} ${errors.unit ? INPUT_ERR : ""}`} />
                <datalist id="up-unit-list">
                  {UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}
                </datalist>
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
              <textarea id="up-desc" rows={3} maxLength={500}
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
      <div className="flex-1 flex flex-col min-h-0">

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
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

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

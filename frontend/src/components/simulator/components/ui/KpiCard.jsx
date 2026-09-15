// Compact uppercase KPI card shared by the five CCS unit panels (Absorber,
// Compressor, Source, Storage, Stripper), which each carried an identical copy.
// Every colour except `electric`/`slate` renders the same neutral grey.
// Note: HydrogenPlantDashboard uses a visually different KpiCard and keeps its own.
export default function KpiCard({ label, value, unit, color = "slate" }) {
  const ring = {
    electric: "border-electric-200 bg-electric-50",
    emerald:  "border-outline-variant/30 bg-surface-container",
    amber:    "border-outline-variant/30 bg-surface-container",
    blue:     "border-outline-variant/30 bg-surface-container",
    violet:   "border-outline-variant/30 bg-surface-container",
    slate:    "border-outline-variant/30 bg-surface-container",
  };
  const text = {
    electric: "text-electric-700",
    emerald:  "text-on-surface",
    amber:    "text-on-surface",
    blue:     "text-on-surface",
    violet:   "text-on-surface",
    slate:    "text-on-surface",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${ring[color] ?? ring.slate}`}>
      <p className="text-[10px] text-on-surface-variant uppercase tracking-wide font-medium">{label}</p>
      <p className={`font-headline text-lg font-bold leading-tight ${text[color] ?? text.slate}`}>
        {value ?? "—"}
        {value != null && <span className="text-sm font-medium ml-1">{unit}</span>}
      </p>
    </div>
  );
}

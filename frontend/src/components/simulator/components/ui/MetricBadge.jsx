// Small labelled metric tile used across the H2 and CCS plant-simulation panels.
// Extracted from seven near-identical copies; the differences between them were
// CSS-irrelevant whitespace, key ordering, and the H2-only `wide`/`indigo`
// additions, so this superset behaves identically for every caller. Every colour
// except `slate` intentionally renders the same neutral grey.
export default function MetricBadge({ label, value, unit, color = "slate", wide = false }) {
  const palettes = {
    amber:  "bg-surface-container border-outline-variant/30 text-on-surface",
    green:  "bg-surface-container border-outline-variant/30 text-on-surface",
    violet: "bg-surface-container border-outline-variant/30 text-on-surface",
    blue:   "bg-surface-container border-outline-variant/30 text-on-surface",
    slate:  "bg-surface-container border-outline-variant/30 text-on-surface",
    red:    "bg-surface-container border-outline-variant/30 text-on-surface",
    indigo: "bg-surface-container border-outline-variant/30 text-on-surface",
  };
  return (
    <div className={`rounded-xl border px-3 py-2 ${palettes[color] ?? palettes.slate} ${wide ? "col-span-2" : ""}`}>
      <p className="text-[10px] text-on-surface-variant font-medium leading-none mb-1">{label}</p>
      <p className="font-headline text-sm font-bold leading-none">
        {value ?? "—"}
        {value != null && unit && <span className="text-xs font-normal ml-1 text-on-surface-variant">{unit}</span>}
      </p>
    </div>
  );
}

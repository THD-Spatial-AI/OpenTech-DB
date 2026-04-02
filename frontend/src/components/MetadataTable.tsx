/**
 * components/MetadataTable.tsx
 * ─────────────────────────────
 * "Metadata Quick-Reference" dense table shown below the tech grid.
 * Lists tech ID, OEO alignment, status, source, and last updated.
 * The data comes from the same resolved list already read by TechGrid,
 * so we accept the array as a prop — no extra fetch needed.
 */

import type { TechnologySummary } from "../types/api";

interface MetadataTableProps {
  technologies: TechnologySummary[];
}

export default function MetadataTable({ technologies }: MetadataTableProps) {
  if (technologies.length === 0) return null;

  // Limit to first 10 entries in the dense view
  const rows = technologies.slice(0, 10);

  return (
    <section className="mt-16">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="font-headline text-xl font-bold text-on-surface">
            Metadata Quick-Reference
          </h2>
          <span className="bg-surface-container-highest text-on-surface-variant px-2 py-0.5
                           text-[10px] font-bold uppercase tracking-wider rounded">
            Dense View
          </span>
        </div>
        <button
          aria-label="Export all as JSON"
          className="text-primary text-sm font-bold flex items-center gap-1 hover:underline"
          onClick={() => {
            const blob = new Blob([JSON.stringify(technologies, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "technologies.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export All (.JSON)
          <span className="material-symbols-outlined text-sm">download</span>
        </button>
      </div>

      <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/10">
        <table className="w-full text-left border-collapse" aria-label="Metadata quick reference">
          <thead>
            <tr className="bg-surface-container-highest/20">
              {["Technology ID", "OEO Alignment", "Category", "Instances"].map(
                (h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-5 py-4 text-[10px] font-bold uppercase tracking-[0.05em]
                               text-on-surface-variant border-b border-outline-variant/15"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/10">
            {rows.map((tech, idx) => {
              const shortId = tech.id.slice(0, 20).toUpperCase();

              return (
                <tr
                  key={tech.id}
                  className={[
                    idx % 2 !== 0 ? "bg-surface-container-low/20" : "",
                    "hover:bg-surface-container-low/40 transition-colors",
                  ].join(" ")}
                >
                  <td className="px-5 py-4 font-label text-sm font-bold text-on-surface">
                    {shortId}
                  </td>
                  <td className="px-5 py-4 text-sm text-on-surface-variant">
                    {tech.oeo_class ?? "—"}
                  </td>
                  <td className="px-5 py-4 text-sm text-on-surface-variant capitalize">
                    {tech.category.replace(/_/g, " ")}
                  </td>
                  <td className="px-5 py-4 text-sm text-on-surface-variant">
                    {tech.n_instances}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

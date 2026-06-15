/**
 * components/worldmap/CountryPanel.tsx
 * ──────────────────────────────────────
 * Slide-in side panel showing:
 *  1. Country header (flag emoji + name + region)
 *  2. ECharts line chart — evolution of the selected parameter over all years
 *  3. Compact data table — all parameters for the selected tech at the chosen year
 *  4. Multi-tech comparison — same parameter across technologies (current year)
 */

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import type { TechMapType, TechMapParam } from "../../types/worldmap";

type EChartsPieParams = { name: string; value: number; percent?: number; dataIndex: number };
import { PARAM_META, MAP_YEARS } from "../../types/worldmap";
import { getCountryByIso3, getParamValues, getTechnologyMeta, getWorldMapTechnologies } from "../../services/worldmap.ts";

// Register ECharts modules (tree-shakeable)
echarts.use([
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

// ── Design tokens ─────────────────────────────────────────────────────────────

const PRIMARY  = "#4d4b9e";
const FONT     = "'Inter', 'Space Grotesk', system-ui, sans-serif";
const GRID_LINE = "rgba(0,0,0,0.05)";
const LABEL    = "#546e7a";

const BASE_TOOLTIP = {
  backgroundColor: "#fff",
  borderColor: "rgba(0,0,0,0.08)",
  borderWidth: 1,
  padding: [8, 12] as [number, number],
  textStyle: { fontFamily: FONT, fontSize: 12, color: "#1a1a2e" },
  extraCssText: "box-shadow:0 4px 16px rgba(0,0,0,0.12);border-radius:8px;",
};

const COVERAGE_META = {
  direct: {
    label: "Direct country data",
    classes: "bg-emerald-100 text-emerald-700",
  },
  none: {
    label: "No country records",
    classes: "bg-slate-200 text-slate-700",
  },
} as const;

// ── Flag emoji helper ─────────────────────────────────────────────────────────

function flagEmoji(iso2: string): string {
  if (!/^[A-Z]{2}$/i.test(iso2)) return "🌍";
  // Convert ISO2 → regional indicator symbols
  return iso2
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + 127397))
    .join("");
}

// ── ECharts generic hook ──────────────────────────────────────────────────────

function useEChart(option: echarts.EChartsCoreOption | null) {
  const ref      = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(ref.current, undefined, { renderer: "canvas" });
    }
    if (option) chartRef.current.setOption(option, { notMerge: true });
  }, [option]);

  useEffect(() => {
    if (!ref.current || !chartRef.current) return;
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => { chartRef.current?.dispose(); chartRef.current = null; }, []);

  return ref;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface CountryPanelProps {
  iso3: string;
  tech: TechMapType;
  param: TechMapParam;
  year: number;
  onClose: () => void;
  onTechSelect?: (tech: TechMapType) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CountryPanel({
  iso3,
  tech,
  param,
  year,
  onClose,
  onTechSelect,
}: CountryPanelProps) {
  const country = getCountryByIso3(iso3);

  // ── Evolution line chart ─────────────────────────────────────────────────

  const evolutionSeries = useMemo(() => {
    if (!country) return null;
    return country.entries.find((e) => e.tech === tech && e.param === param) ?? null;
  }, [country, tech, param]);

  const evolutionOption = useMemo((): echarts.EChartsCoreOption | null => {
    if (!evolutionSeries) return null;

    return {
      grid:   { top: 28, right: 16, bottom: 48, left: 56, containLabel: false },
      tooltip: { ...BASE_TOOLTIP, trigger: "axis" },
      xAxis: {
        type: "category",
        data: evolutionSeries.series.map((yv) => String(yv.year)),
        axisLabel: { fontFamily: FONT, color: LABEL, fontSize: 11 },
        axisLine:  { lineStyle: { color: GRID_LINE } },
        axisTick:  { show: false },
      },
      yAxis: {
        type:        "value",
        name:        evolutionSeries.unit,
        nameTextStyle: { fontFamily: FONT, color: LABEL, fontSize: 10 },
        axisLabel:   { fontFamily: FONT, color: LABEL, fontSize: 10 },
        splitLine:   { lineStyle: { color: GRID_LINE } },
        axisLine:    { show: false },
        axisTick:    { show: false },
      },
      series: [
        {
          type:        "line",
          data:        evolutionSeries.series.map((yv) => yv.value),
          smooth:      true,
          symbol:      "circle",
          symbolSize:  6,
          lineStyle:   { color: PRIMARY, width: 2.5 },
          itemStyle:   { color: PRIMARY },
          areaStyle:   { color: `${PRIMARY}18` },
          markLine: {
            silent: true,
            data: [{ xAxis: String(year) }],
            lineStyle: { color: "#f59e0b", type: "dashed", width: 1.5 },
            label: { show: false },
          },
        },
      ],
    };
  }, [evolutionSeries, year]);

  const evolutionRef = useEChart(evolutionOption);

  // ── All-params table for this country/tech/year ──────────────────────────

  const paramRows = useMemo(() => {
    if (!country) return [];
    return (["capex", "opex_fixed", "capacity_factor", "co2_emissions"] as TechMapParam[])
      .map((p) => {
        const entry = country.entries.find((e) => e.tech === tech && e.param === p);
        if (!entry) return null;
        const yv = entry.series.find((s) => s.year === year)
               ?? entry.series.at(-1); // nearest available year
        return { param: p, value: yv?.value ?? null, unit: entry.unit };
      })
      .filter(Boolean) as { param: TechMapParam; value: number | null; unit: string }[];
  }, [country, tech, year]);

  // ── Cross-tech comparison bar chart ─────────────────────────────────────

  const crossTechValues = useMemo(() => {
    if (!country) return [];
    const techTypes: TechMapType[] = getWorldMapTechnologies().map((t) => t.id);
    return techTypes
      .map((t) => {
        const entry = country.entries.find((e) => e.tech === t && e.param === param);
        if (!entry) return null;
        const yv = entry.series.find((s) => s.year === year) ?? entry.series.at(-1);
        return { tech: t, value: yv?.value ?? null };
      })
      .filter(Boolean) as { tech: TechMapType; value: number | null }[];
  }, [country, param, year]);

  const crossTechOption = useMemo((): echarts.EChartsCoreOption | null => {
    const rows = crossTechValues
      .filter((r) => r.value != null)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    if (rows.length === 0) return null;

    const pInfo = PARAM_META[param];
    return {
      animation: false,
      stateAnimation: { duration: 0 },
      tooltip: {
        ...BASE_TOOLTIP,
        trigger: "item",
        formatter: (p: EChartsPieParams) => {
          const val = pInfo?.format(p.value as number) ?? p.value;
          const unit = pInfo?.unit ?? "";
          return `${p.name}<br/><b>${val}</b> ${unit} (${p.percent?.toFixed(1)}%)`;
        },
      },
      legend: {
        orient: "vertical",
        right: 0,
        top: "middle",
        type: "scroll",
        textStyle: { fontFamily: FONT, fontSize: 9, color: LABEL },
        itemHeight: 8,
        itemWidth: 8,
        formatter: (name: string) =>
          name.length > 22 ? name.slice(0, 20) + "\u2026" : name,
      },
      series: [
        {
          type: "pie",
          radius: ["36%", "62%"],
          center: ["36%", "50%"],
          cursor: "pointer",
          data: rows.map((r) => {
            const isActive = r.tech === tech;
            return {
              name:      getTechnologyMeta(r.tech)?.label ?? r.tech,
              value:     r.value,
              itemStyle: {
                color:       getTechnologyMeta(r.tech)?.color ?? PRIMARY,
                borderWidth: isActive ? 2.5 : 0,
                borderColor: "#fff",
              },
            };
          }),
          label:     { show: false },
          labelLine: { show: false },
          emphasis:  { disabled: true },
        },
      ],
    };
  }, [crossTechValues, param, tech]);

  // Stable ref so the click proxy never needs to be re-attached to ECharts
  const crossTechClickRef = useRef<((p: EChartsPieParams) => void) | null>(null);
  const crossTechRows = useMemo(
    () => crossTechValues.filter((r) => r.value != null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    [crossTechValues],
  );
  crossTechClickRef.current = onTechSelect
    ? (p: EChartsPieParams) => { const row = crossTechRows[p.dataIndex]; if (row) onTechSelect(row.tech); }
    : null;

  const crossTechRef = useEChart(crossTechOption);

  // Attach click once after chart init; the proxy always calls the latest handler
  useEffect(() => {
    const el = crossTechRef.current;
    if (!el) return;
    const chart = echarts.getInstanceByDom(el);
    if (!chart) return;
    const proxy = (p: EChartsPieParams) => crossTechClickRef.current?.(p);
    chart.on("click", proxy);
    return () => { chart.off("click", proxy); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Global rank for selected param ──────────────────────────────────────

  const rank = useMemo(() => {
    if (!country) return null;
    const all    = getParamValues(tech, param, year);
    const myVal  = all.get(iso3);
    if (myVal == null) return null;
    const sorted = [...all.values()].sort((a, b) =>
      PARAM_META[param].higherIsBetter ? b - a : a - b,
    );
    const pos    = sorted.indexOf(myVal) + 1;
    return { pos, total: sorted.length };
  }, [iso3, tech, param, year, country]);

  // ── YoY change (last known year vs chosen year) ──────────────────────────

  const yoyChange = useMemo(() => {
    if (!evolutionSeries) return null;
    const yearData = evolutionSeries.series;
    const idx      = yearData.findIndex((yv) => yv.year === year);
    if (idx <= 0) return null;
    const prev = yearData[idx - 1];
    const curr = yearData[idx];
    const pct  = ((curr.value - prev.value) / prev.value) * 100;
    return pct;
  }, [evolutionSeries, year]);

  // ── No data fallback ─────────────────────────────────────────────────────

  if (!country) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <span className="material-symbols-outlined text-on-surface-variant/40 text-5xl mb-3">
          public_off
        </span>
        <p className="text-sm text-on-surface-variant">No data available for this country.</p>
        <button
          onClick={onClose}
          className="mt-4 text-xs text-primary hover:underline"
        >
          Close
        </button>
      </div>
    );
  }

  const paramInfo  = PARAM_META[param];
  const techInfo   = getTechnologyMeta(tech) ?? {
    label: tech,
    icon: "blur_on",
    color: "#4d4b9e",
  };
  const coverageMeta = COVERAGE_META[country.coverage];
  const currentVal = evolutionSeries?.series.find((s) => s.year === year)?.value ?? null;
  const paramUnit  = evolutionSeries?.unit ?? "";

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-surface-container-lowest">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-surface-container-lowest border-b
                      border-outline-variant/15 px-5 py-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl leading-none" role="img" aria-label={country.name}>
            {flagEmoji(country.iso2)}
          </span>
          <div>
            <h2 className="font-headline font-semibold text-on-surface text-base leading-tight">
              {country.name}
            </h2>
            <p className="text-xs text-on-surface-variant mt-0.5">{country.region}</p>
            <span
              className={`inline-flex mt-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${coverageMeta.classes}`}
            >
              {coverageMeta.label}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container
                     rounded-full w-8 h-8 flex-shrink-0 flex items-center justify-center
                     transition-colors"
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>

      {/* ── Key metric card ──────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-3">
        <div className="bg-primary/8 rounded-xl p-4">
          {!evolutionSeries && (
            <div className="mb-3 rounded-lg bg-surface-container px-3 py-2 text-xs text-on-surface-variant">
              This country has no records for this technology/parameter combination.
            </div>
          )}
          <div className="flex items-center gap-2 mb-1">
            <span
              className="material-symbols-outlined text-lg"
              style={{ color: techInfo.color }}
            >
              {techInfo.icon}
            </span>
            <span className="text-xs font-bold text-on-surface">{techInfo.label}</span>
            <span className="ml-1 text-xs text-on-surface-variant">— {paramInfo.label}</span>
          </div>
          <div className="flex items-end gap-3 mt-2">
            <span className="font-headline text-2xl font-bold text-on-surface">
              {currentVal != null ? paramInfo.format(currentVal) : "N/A"}
            </span>
            <span className="text-xs text-on-surface-variant mb-0.5">{paramUnit}</span>
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-on-surface-variant">
            {rank && (
              <span>
                <b className="text-primary">#{rank.pos}</b> of {rank.total} countries
              </span>
            )}
            {yoyChange != null && (
              <span
                className={
                  yoyChange < 0
                    ? "text-green-600 font-medium"
                    : yoyChange > 0
                    ? "text-red-500 font-medium"
                    : ""
                }
              >
                {yoyChange > 0 ? "▲" : "▼"}{" "}
                {Math.abs(yoyChange).toFixed(1)}% vs {
                  MAP_YEARS[MAP_YEARS.findIndex(y => y === year) - 1] ?? "previous"
                }
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Evolution chart ──────────────────────────────────────────────── */}
      <div className="px-5 pb-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">
          Historical & projected evolution
        </h3>
        {evolutionSeries ? (
          <div ref={evolutionRef} className="w-full h-44" />
        ) : (
          <p className="text-xs text-on-surface-variant/60 italic">No evolution data.</p>
        )}
      </div>

      {/* ── Parameter table ──────────────────────────────────────────────── */}
      <div className="px-5 pb-4 border-t border-outline-variant/10 pt-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-3">
          All parameters — {year}
        </h3>
        <div className="space-y-1.5">
          {paramRows.map(({ param: p, value, unit }) => {
            const pInfo = PARAM_META[p];
            const isSelected = p === param;
            return (
              <div
                key={p}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm
                            ${isSelected ? "bg-primary/8 ring-1 ring-primary/20" : "bg-surface-container"}`}
              >
                <span className={`font-medium ${isSelected ? "text-primary" : "text-on-surface"}`}>
                  {pInfo.label}
                </span>
                <span className="text-on-surface-variant text-xs">
                  {value != null ? (
                    <><b className="text-on-surface">{pInfo.format(value)}</b> {unit}</>
                  ) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Cross-tech comparison ─────────────────────────────────────────── */}
      {crossTechValues.some((r) => r.value != null) && (
        <div className="px-5 pb-6 border-t border-outline-variant/10 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">
            {paramInfo.label} — all technologies ({year})
          </h3>
          <div ref={crossTechRef} className="w-full h-56" />
        </div>
      )}
    </div>
  );
}

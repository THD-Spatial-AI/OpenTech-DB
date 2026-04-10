/**
 * components/timeseries/ProfileViewer.tsx
 * ─────────────────────────────────────────
 * Full-screen-first interactive chart for a single time-series profile.
 *
 * Layout (when a profile is selected)
 * ────────────────────────────────────
 *  ┌─ header: name · badges · source · download ─────────────────────┐
 *  ├─ toolbar: window presets  |  aggregation  |  chart-type toggle ──┤
 *  ├─ chart  (flex-1, fills remaining height)  ───────────────────────┤
 *  └─ stats strip: min · p10 · mean · p90 · max · std · CV  ──────────┘
 *
 * Time-window presets ("zoom shortcuts")
 * ───────────────────────────────────────
 *  15 min · 30 min · 1 h · 3 h · 6 h · 12 h
 *  1 day · 1 week · Summer · Winter · Full year
 *
 * Aggregation ("downsample for readability")
 * ───────────────────────────────────────────
 *  Raw · Hourly avg · Daily avg · Weekly avg
 *
 * Statistics strip
 * ─────────────────
 *  Min / P10 / Mean / P90 / Max / Std-dev / CV (%) / IQR
 */

import {
  Suspense,
  use,
  useEffect,
  useRef,
  useMemo,
  useState,
  useCallback,
  useTransition,
} from "react";
import type { CSSProperties } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import type { TimeSeriesData, TimeSeriesProfile } from "../../types/timeseries";
import ErrorBoundary from "../ErrorBoundary";
import { useAuth } from "../../context/AuthContext";
import { deleteTimeSeriesProfile } from "../../services/timeseries";

// ────────────────────────────────────────────────────────────────────
// Type palette
// ────────────────────────────────────────────────────────────────────
const TYPE_PALETTE: Record<string, { bg: string; text: string; color: string }> = {
  capacity_factor: { bg: "bg-amber-100",  text: "text-amber-800",  color: "#f59e0b" },
  generation:      { bg: "bg-green-100",  text: "text-green-800",  color: "#22c55e" },
  load:            { bg: "bg-blue-100",   text: "text-blue-800",   color: "#3b82f6" },
  weather:         { bg: "bg-sky-100",    text: "text-sky-800",    color: "#0ea5e9" },
  price:           { bg: "bg-purple-100", text: "text-purple-800", color: "#a855f7" },
};
const fallbackPalette = { bg: "bg-surface-container", text: "text-on-surface-variant", color: "#4d4b9e" };
const getPalette = (type: string) => TYPE_PALETTE[type] ?? fallbackPalette;

// ────────────────────────────────────────────────────────────────────
// Window presets
// ────────────────────────────────────────────────────────────────────
type WindowPreset =
  | "15min" | "30min" | "1h" | "3h" | "6h" | "12h"
  | "1d" | "1w" | "summer" | "winter" | "full";

interface PresetDef {
  key: WindowPreset;
  label: string;
  group: "sub-day" | "days" | "seasons";
}

const PRESETS: PresetDef[] = [
  { key: "15min",  label: "15 min",  group: "sub-day"  },
  { key: "30min",  label: "30 min",  group: "sub-day"  },
  { key: "1h",     label: "1 h",     group: "sub-day"  },
  { key: "3h",     label: "3 h",     group: "sub-day"  },
  { key: "6h",     label: "6 h",     group: "sub-day"  },
  { key: "12h",    label: "12 h",    group: "sub-day"  },
  { key: "1d",     label: "1 day",   group: "days"     },
  { key: "1w",     label: "1 week",  group: "days"     },
  { key: "summer", label: "Summer",  group: "seasons"  },
  { key: "winter", label: "Winter",  group: "seasons"  },
  { key: "full",   label: "Full year", group: "seasons"},
];

// Returns [startMs, endMs] for a preset relative to the first point
function resolvePreset(preset: WindowPreset, firstMs: number, lastMs: number): [number, number] {
  const H = 3_600_000;
  switch (preset) {
    case "15min":  return [firstMs, firstMs + 0.25 * H];
    case "30min":  return [firstMs, firstMs + 0.5  * H];
    case "1h":     return [firstMs, firstMs + 1    * H];
    case "3h":     return [firstMs, firstMs + 3    * H];
    case "6h":     return [firstMs, firstMs + 6    * H];
    case "12h":    return [firstMs, firstMs + 12   * H];
    case "1d":     return [firstMs, firstMs + 24   * H];
    case "1w":     return [firstMs, firstMs + 168  * H];
    // Summer: Jun–Aug
    case "summer": {
      const year = new Date(firstMs).getUTCFullYear();
      return [Date.UTC(year, 5, 1), Date.UTC(year, 8, 1)];
    }
    // Winter: Dec + Jan–Feb
    case "winter": {
      const year = new Date(firstMs).getUTCFullYear();
      return [Date.UTC(year, 11, 1), Date.UTC(year + 1, 2, 1)];
    }
    case "full":
    default:
      return [firstMs, lastMs];
  }
}

// ────────────────────────────────────────────────────────────────────
// Aggregation
// ────────────────────────────────────────────────────────────────────
type AggMode = "raw" | "hourly" | "daily" | "weekly";

interface AggDef { key: AggMode; label: string; bucketMs: number }
const AGG_OPTIONS: AggDef[] = [
  { key: "raw",    label: "Raw",         bucketMs: 0             },
  { key: "hourly", label: "Hourly avg",  bucketMs: 3_600_000     },
  { key: "daily",  label: "Daily avg",   bucketMs: 86_400_000    },
  { key: "weekly", label: "Weekly avg",  bucketMs: 604_800_000   },
];

interface RawPoint { ts: number; v: number }

function aggregate(points: RawPoint[], bucketMs: number): RawPoint[] {
  if (bucketMs === 0 || points.length === 0) return points;
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const { ts, v } of points) {
    const key = Math.floor(ts / bucketMs) * bucketMs;
    const b = buckets.get(key) ?? { sum: 0, n: 0 };
    b.sum += v; b.n++;
    buckets.set(key, b);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([ts, { sum, n }]) => ({ ts, v: sum / n }));
}

// ────────────────────────────────────────────────────────────────────
// Statistics helpers
// ────────────────────────────────────────────────────────────────────
interface Stats {
  min: number; max: number; mean: number; median: number;
  p10: number; p90: number; stddev: number; cv: number; iqr: number;
  sum: number; n: number;
}

function computeStats(values: number[]): Stats {
  if (values.length === 0) {
    const z = 0;
    return { min: z, max: z, mean: z, median: z, p10: z, p90: z, stddev: z, cv: z, iqr: z, sum: z, n: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n   = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  const pct = (p: number) => {
    const idx = (p / 100) * (n - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };

  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  return {
    min:    sorted[0],
    max:    sorted[n - 1],
    mean,
    median: pct(50),
    p10:    pct(10),
    p90:    pct(90),
    stddev,
    cv:     mean !== 0 ? (stddev / Math.abs(mean)) * 100 : 0,
    iqr:    pct(75) - pct(25),
    sum,
    n,
  };
}

function fmt(v: number, unit: string): string {
  const abs = Math.abs(v);
  const s = abs >= 10_000 ? `${(v / 1000).toFixed(2)}k`
          : abs >= 100    ? v.toFixed(1)
          : abs >= 1      ? v.toFixed(3)
          :                 v.toFixed(4);
  return `${s} ${unit}`;
}

// ────────────────────────────────────────────────────────────────────
// CSV download
// ────────────────────────────────────────────────────────────────────
function downloadCSV(data: TimeSeriesData) {
  const header = `timestamp,${data.unit ?? "value"}`;
  const rows   = data.points.map((p) => `${p.timestamp},${p.value}`);
  const blob   = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement("a");
  a.href = url;
  a.download = `${data.name.replace(/\s+/g, "_")}_${data.profile_id.slice(0, 8)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ────────────────────────────────────────────────────────────────────
// ECharts canvas wrapper
// ────────────────────────────────────────────────────────────────────
interface EChartCanvasProps {
  option: EChartsOption;
  className?: string;
  style?: CSSProperties;
  onZoomChange?: (startMs: number, endMs: number) => void;
}

function EChartCanvas({ option, className, style, onZoomChange }: EChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: "canvas", locale: "EN" });
    chartRef.current = chart;
    chart.setOption(option);

    // Force correct canvas size after flex layout resolves
    requestAnimationFrame(() => { if (chartRef.current) chartRef.current.resize(); });

    // Forward zoom events so the stats strip can react
    chart.on("dataZoom", () => {
      if (!onZoomChange) return;
      const opt = chart.getOption() as { dataZoom?: Array<{ startValue?: number; endValue?: number }> };
      const dz  = opt.dataZoom?.[0];
      if (dz?.startValue != null && dz?.endValue != null) {
        onZoomChange(dz.startValue, dz.endValue);
      }
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.dispose(); chartRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ ...style, overflow: "hidden" }}
      role="img"
      aria-label="Time series chart"
    />
  );
}

// ────────────────────────────────────────────────────────────────────
// Skeleton
// ────────────────────────────────────────────────────────────────────
function ChartSkeleton() {
  return (
    <div className="flex flex-col h-full animate-pulse p-6 gap-4">
      <div className="flex items-center gap-3">
        <div className="h-6 bg-surface-container-high rounded w-56" />
        <div className="h-5 bg-surface-container rounded w-20" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-7 bg-surface-container rounded-lg w-14" />
        ))}
      </div>
      <div className="flex-1 bg-surface-container rounded-2xl" />
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 bg-surface-container-high rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Stat card
// ────────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, accent,
}: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={[
      "rounded-xl border px-3 py-2.5 flex flex-col gap-0.5 min-w-0",
      accent
        ? "border-primary/25 bg-primary/5"
        : "border-outline-variant/20 bg-surface-container-lowest",
    ].join(" ")}>
      <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/50 truncate">{label}</p>
      <p className={`text-sm font-bold tabular-nums leading-tight truncate ${accent ? "text-primary" : "text-on-surface"}`}>
        {value}
      </p>
      {sub && <p className="text-[9px] text-on-surface-variant/40 font-mono truncate">{sub}</p>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Toolbar button
// ────────────────────────────────────────────────────────────────────
function ToolBtn({
  active, onClick, children, title,
}: { active?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={[
        "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all select-none whitespace-nowrap",
        active
          ? "bg-primary text-on-primary shadow-sm"
          : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// Inner content — calls use(), must sit inside Suspense
// ────────────────────────────────────────────────────────────────────
function ProfileViewerContent({
  dataPromise,
  profile,
  onDelete,
}: {
  dataPromise: Promise<TimeSeriesData>;
  profile: TimeSeriesProfile;
  onDelete?: () => void;
}) {
  const data = use(dataPromise);
  const { token } = useAuth();

  const { color } = getPalette(profile.type);

  // Convert once to numeric timestamps
  const rawPoints = useMemo<RawPoint[]>(
    () => data.points.map((p) => ({ ts: new Date(p.timestamp).getTime(), v: p.value })),
    [data.points]
  );

  const firstMs = rawPoints[0]?.ts ?? 0;
  const lastMs  = rawPoints[rawPoints.length - 1]?.ts ?? 0;

  // ── State ────────────────────────────────────────────────────────
  const [preset, setPreset]           = useState<WindowPreset>("full");
  const [agg, setAgg]                 = useState<AggMode>("raw");
  const [chartType, setChartType]     = useState<"line" | "bar">("line");
  const [zoomMs, setZoomMs]           = useState<[number, number] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]       = useState(false);
  const [, startT]                    = useTransition();

  // ── Derived: visible window ───────────────────────────────────── ─
  const [winStart, winEnd] = useMemo(
    () => resolvePreset(preset, firstMs, lastMs),
    [preset, firstMs, lastMs]
  );

  // ── Derived: aggregated visible slice ────────────────────────────
  const visibleAggPoints = useMemo<RawPoint[]>(() => {
    const slice = rawPoints.filter((p) => p.ts >= winStart && p.ts <= winEnd);
    const bucketMs = AGG_OPTIONS.find((a) => a.key === agg)!.bucketMs;
    return aggregate(slice, bucketMs);
  }, [rawPoints, winStart, winEnd, agg]);

  // ── Stats — respect the interactive zoom viewport when it exists ─
  const statsPoints = useMemo<number[]>(() => {
    const [sMs, eMs] = zoomMs ?? [winStart, winEnd];
    return visibleAggPoints.filter((p) => p.ts >= sMs && p.ts <= eMs).map((p) => p.v);
  }, [visibleAggPoints, zoomMs, winStart, winEnd]);

  const stats = useMemo(() => computeStats(statsPoints), [statsPoints]);

  // ── ECharts option ────────────────────────────────────────────────
  const chartOption = useMemo<EChartsOption>(() => {
    const seriesData = visibleAggPoints.map((p) => [p.ts, p.v]);
    return {
      animation: false,
      backgroundColor: "transparent",
      grid: { top: 16, right: 18, bottom: 72, left: 60, containLabel: false },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", lineStyle: { color: color, opacity: 0.35 } },
        formatter: (params: unknown) => {
          const p = (params as Array<{ value: [number, number] }>)[0];
          if (!p) return "";
          const dt = new Date(p.value[0]);
          const dateStr = dt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
          return `<div style="font-family:Inter,sans-serif;font-size:11px;color:#434655;">${dateStr}</div>
                  <strong style="font-size:13px;color:${color}">${fmt(p.value[1], data.unit)}</strong>`;
        },
        backgroundColor: "#fff",
        borderColor: "#e0e3e5",
        borderWidth: 1,
      },
      xAxis: {
        type: "time",
        min: winStart,
        max: winEnd,
        axisLine:  { lineStyle: { color: "#c3c6d7" } },
        axisLabel: { color: "#434655", fontFamily: "Inter,sans-serif", fontSize: 11, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: data.unit,
        nameTextStyle: { color: "#737686", fontSize: 11, fontFamily: "Inter,sans-serif", padding: [0, 8, 0, 0] },
        axisLabel: {
          color: "#434655", fontFamily: "Inter,sans-serif", fontSize: 11,
          formatter: (v: number) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`,
        },
        splitLine: { lineStyle: { color: "#c3c6d7", opacity: 0.35 } },
      },
      dataZoom: [
        {
          type: "slider", xAxisIndex: 0, bottom: 8, height: 26,
          borderColor: "#c3c6d7", backgroundColor: "#f2f4f6",
          dataBackground:         { lineStyle: { color, opacity: 0.45 }, areaStyle: { color, opacity: 0.08 } },
          selectedDataBackground: { lineStyle: { color }, areaStyle: { color, opacity: 0.22 } },
          fillerColor: `${color}22`,
          handleStyle:    { color, borderColor: color },
          moveHandleStyle:{ color },
          textStyle: { color: "#434655", fontFamily: "Inter,sans-serif", fontSize: 10 },
        },
        { type: "inside", xAxisIndex: 0 },
      ],
      series: [
        chartType === "line"
          ? {
              type: "line",
              name: profile.name,
              data: seriesData,
              symbol: "none",
              lineStyle: { color, width: 1.8 },
              areaStyle: { color, opacity: 0.07 },
              large: true, largeThreshold: 2000,
            }
          : {
              type: "bar",
              name: profile.name,
              data: seriesData,
              itemStyle: { color, borderRadius: [2, 2, 0, 0] },
              barMaxWidth: 6,
              large: true, largeThreshold: 2000,
            },
      ],
    };
  }, [visibleAggPoints, winStart, winEnd, color, data.unit, profile.name, chartType]);

  const handleDownload = useCallback(() => downloadCSV(data), [data]);

  const handleDelete = useCallback(async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await deleteTimeSeriesProfile(profile.profile_id, token);
      onDelete();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [onDelete, profile.profile_id, token]);

  const pal = getPalette(profile.type);

  // ── Preset group separator helper ────────────────────────────────
  const groups: PresetDef["group"][] = ["sub-day", "days", "seasons"];

  return (
    <div className="flex flex-col h-full gap-0 min-h-0 overflow-hidden">

      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 flex-wrap flex-shrink-0">
        <div className="min-w-0">
          <h2 className="font-headline text-lg font-bold text-on-surface leading-tight truncate max-w-[520px]">
            {profile.name}
          </h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full ${pal.bg} ${pal.text}`}>
              {profile.type.replace("_", " ")}
            </span>
            <span className="text-[10px] font-mono text-on-surface-variant/50">{data.unit}</span>
            <span className="text-[10px] text-on-surface-variant/40">·</span>
            <span className="text-[10px] text-on-surface-variant/50">{profile.resolution}</span>
            <span className="text-[10px] text-on-surface-variant/40">·</span>
            <span className="text-[10px] font-mono text-on-surface-variant/50">{profile.location}</span>
            {profile.year && (
              <>
                <span className="text-[10px] text-on-surface-variant/40">·</span>
                <span className="text-[10px] text-on-surface-variant/50">{profile.year}</span>
              </>
            )}
            <span className="text-[10px] text-on-surface-variant/40">·</span>
            <span className="text-[10px] text-on-surface-variant/35 italic">{profile.source}</span>
          </div>
        </div>
        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                       bg-primary/8 hover:bg-primary/15 text-primary
                       text-xs font-bold border border-primary/20 hover:border-primary/35
                       transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-[15px]">download</span>
            CSV
          </button>

          {onDelete && !confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                         bg-red-50 hover:bg-red-100 text-red-600
                         text-xs font-bold border border-red-200 hover:border-red-300
                         transition-all active:scale-95"
            >
              <span className="material-symbols-outlined text-[15px]">delete</span>
              Delete
            </button>
          )}

          {onDelete && confirmDelete && (
            <>
              <span className="text-xs text-on-surface-variant/60 hidden sm:block">
                Delete this profile?
              </span>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-outline-variant/30
                           hover:bg-surface-container transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1 text-xs font-bold px-3 py-1.5
                           rounded-lg bg-red-600 hover:bg-red-700 text-white
                           border border-red-700 transition-all disabled:opacity-60"
              >
                {deleting
                  ? <><span className="material-symbols-outlined text-[13px] animate-spin">autorenew</span>Deleting…</>
                  : "Confirm"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── TOOLBAR ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 pb-3 flex-wrap flex-shrink-0 border-b border-outline-variant/10">

        {/* Window presets — grouped */}
        <div className="flex items-center gap-1 flex-wrap">
          {groups.map((grp, gi) => (
            <span key={grp} className="flex items-center gap-1">
              {gi > 0 && <span className="w-px h-4 bg-outline-variant/25 mx-0.5" />}
              {PRESETS.filter((p) => p.group === grp).map((p) => (
                <ToolBtn
                  key={p.key}
                  active={preset === p.key}
                  onClick={() => { startT(() => { setPreset(p.key); setZoomMs(null); }); }}
                  title={`Show ${p.label} window`}
                >
                  {p.label}
                </ToolBtn>
              ))}
            </span>
          ))}
        </div>

        {/* Divider */}
        <span className="w-px h-5 bg-outline-variant/25 hidden sm:block" />

        {/* Aggregation */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40 mr-1 hidden sm:block">
            Agg
          </span>
          {AGG_OPTIONS.map((a) => (
            <ToolBtn key={a.key} active={agg === a.key} onClick={() => setAgg(a.key)}>
              {a.label}
            </ToolBtn>
          ))}
        </div>

        {/* Divider */}
        <span className="w-px h-5 bg-outline-variant/25 hidden sm:block" />

        {/* Chart type */}
        <div className="flex items-center gap-1">
          <ToolBtn active={chartType === "line"} onClick={() => setChartType("line")} title="Line chart">
            <span className="material-symbols-outlined text-[14px] leading-none">show_chart</span>
          </ToolBtn>
          <ToolBtn active={chartType === "bar"} onClick={() => setChartType("bar")} title="Bar chart">
            <span className="material-symbols-outlined text-[14px] leading-none">bar_chart</span>
          </ToolBtn>
        </div>

        {/* Live point count */}
        <span className="ml-auto text-[10px] font-mono text-on-surface-variant/35 hidden md:block">
          {visibleAggPoints.length.toLocaleString()} pts visible
        </span>
      </div>

      {/* ── CHART ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 px-1 overflow-hidden">
        <EChartCanvas
          option={chartOption}
          className="w-full h-full"
          style={{ minHeight: 280 }}
          onZoomChange={(s, e) => setZoomMs([s, e])}
        />
      </div>

      {/* ── STATS STRIP ─────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-5 pb-4 pt-2 border-t border-outline-variant/10 overflow-x-auto">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <StatCard label="Min"    value={fmt(stats.min,    data.unit)} />
          <StatCard label="P10"    value={fmt(stats.p10,    data.unit)} />
          <StatCard label="Mean"   value={fmt(stats.mean,   data.unit)} accent />
          <StatCard label="Median" value={fmt(stats.median, data.unit)} />
          <StatCard label="P90"    value={fmt(stats.p90,    data.unit)} />
          <StatCard label="Max"    value={fmt(stats.max,    data.unit)} />
          <StatCard
            label="Std dev"
            value={fmt(stats.stddev, data.unit)}
            sub={`CV ${stats.cv.toFixed(1)} %`}
          />
          <StatCard
            label="IQR"
            value={fmt(stats.iqr, data.unit)}
            sub={`n = ${stats.n.toLocaleString()}`}
          />
        </div>
        <p className="text-[10px] text-on-surface-variant/30 text-center mt-2">
          Stats computed on the current zoom window · drag slider or use presets to update
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Public component
// ────────────────────────────────────────────────────────────────────
export interface ProfileViewerProps {
  profile: TimeSeriesProfile;
  dataPromise: Promise<TimeSeriesData>;
  onDelete?: () => void;
}

export default function ProfileViewer({ profile, dataPromise, onDelete }: ProfileViewerProps) {
  return (
    <ErrorBoundary context={`profile "${profile.name}"`}>
      <Suspense fallback={<ChartSkeleton />}>
        <ProfileViewerContent dataPromise={dataPromise} profile={profile} onDelete={onDelete} />
      </Suspense>
    </ErrorBoundary>
  );
}

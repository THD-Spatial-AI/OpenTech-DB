/**
 * components/TechCharts.tsx
 * ──────────────────────────
 * Three interactive Apache ECharts comparing key parameters across all
 * equipment variants of a technology:
 *
 *  1. Scatter — Capacity (kW) vs CAPEX ($/kW)
 *  2. Grouped bar — CAPEX + Fixed OPEX per variant
 *  3. Scatter — Efficiency (%) vs Economic Lifetime (yrs)
 *
 * Uses vanilla echarts (useEffect + useRef) — React 19 compatible,
 * no extra wrapper library needed.
 */

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { ScatterChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EquipmentInstance } from "../types/api";

// Register only what we use (tree-shakeable)
echarts.use([
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
  CanvasRenderer,
]);

// ── Design tokens (match Tailwind theme colour palette) ───────────────────────
const PRIMARY   = "#5b7cf6";  // roughly --color-primary from the theme
const SECONDARY = "#8b5cf6";  // purple accent
const TERTIARY  = "#06b6d4";  // cyan accent
const GRID_LINE = "rgba(0,0,0,0.06)";
const LABEL_CLR = "#546e7a";
const FONT      = "'Inter', 'Space Grotesk', system-ui, sans-serif";

const BASE_TOOLTIP = {
  backgroundColor: "#fff",
  borderColor: "rgba(0,0,0,0.08)",
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { fontFamily: FONT, fontSize: 12, color: "#1a1a2e" },
  extraCssText: "box-shadow:0 4px 16px rgba(0,0,0,0.12);border-radius:8px;",
};

const TOOLBOX = {
  right: 8,
  top: 4,
  itemSize: 14,
  feature: {
    dataZoom:  { yAxisIndex: "none", title: { zoom: "Zoom", back: "Reset zoom" } },
    restore:   { title: "Reset" },
    saveAsImage: { title: "Save PNG" },
  },
};

// ── Generic chart hook ────────────────────────────────────────────────────────

function useEChart(option: echarts.EChartsCoreOption | null) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(ref.current, undefined, { renderer: "canvas" });
    }
    if (option) chartRef.current.setOption(option, { notMerge: true });
  }, [option]);

  // Resize on container resize
  useEffect(() => {
    if (!ref.current || !chartRef.current) return;
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return ref;
}

// ── Chart 1: Capacity vs CAPEX scatter ───────────────────────────────────────

function CapacityVsCapexChart({ instances }: { instances: EquipmentInstance[] }) {
  const points = instances.filter(
    (i) => i.capacity_kw?.value != null && i.capex_per_kw?.value != null
  );

  const option: echarts.EChartsCoreOption | null =
    points.length < 2
      ? null
      : {
          animation: true,
          grid: { left: 60, right: 24, top: 36, bottom: 52 },
          toolbox: TOOLBOX,
          tooltip: {
            ...BASE_TOOLTIP,
            trigger: "item",
            formatter: (p: { data: [number, number, string] }) =>
              `<b>${p.data[2]}</b><br/>` +
              `Capacity: <b>${p.data[0].toLocaleString()} kW</b><br/>` +
              `CAPEX: <b>$${p.data[1].toLocaleString()} /kW</b>`,
          },
          xAxis: {
            name: "Capacity (kW)",
            nameLocation: "middle",
            nameGap: 32,
            nameTextStyle: { fontFamily: FONT, fontSize: 11, color: LABEL_CLR, fontWeight: "bold" },
            axisLabel: { fontFamily: FONT, fontSize: 10, color: LABEL_CLR },
            splitLine: { lineStyle: { color: GRID_LINE } },
          },
          yAxis: {
            name: "CAPEX ($/kW)",
            nameLocation: "middle",
            nameGap: 48,
            nameTextStyle: { fontFamily: FONT, fontSize: 11, color: LABEL_CLR, fontWeight: "bold" },
            axisLabel: { fontFamily: FONT, fontSize: 10, color: LABEL_CLR },
            splitLine: { lineStyle: { color: GRID_LINE } },
          },
          series: [
            {
              type: "scatter",
              symbolSize: 10,
              itemStyle: { color: PRIMARY, opacity: 0.85, borderColor: "#fff", borderWidth: 1.5 },
              emphasis: { itemStyle: { opacity: 1, symbolSize: 14 } },
              label: {
                show: points.length <= 12,
                position: "top",
                formatter: (p: { data: [number, number, string] }) => p.data[2],
                fontFamily: FONT,
                fontSize: 9,
                color: LABEL_CLR,
              },
              data: points.map((i) => [
                i.capacity_kw!.value,
                i.capex_per_kw!.value,
                i.label,
              ]),
            },
          ],
        };

  const ref = useEChart(option);

  if (points.length < 2) {
    return <EmptyChart msg="Not enough capacity or CAPEX data across variants." />;
  }
  return <div ref={ref} className="w-full h-56" />;
}

// ── Chart 2: Capacity vs CO₂ Emission Factor scatter ───────────────────────
// X = Capacity (kW), Y = CO₂ emission factor (g/kWh).
// Shows the environmental footprint at different plant capacities.

function CapacityVsCO2Chart({ instances }: { instances: EquipmentInstance[] }) {
  const points = instances.filter(
    (i) => i.capacity_kw?.value != null && i.co2_emission_factor?.value != null
  );

  const option: echarts.EChartsCoreOption | null =
    points.length < 2
      ? null
      : {
          animation: true,
          grid: { left: 68, right: 24, top: 36, bottom: 52 },
          toolbox: TOOLBOX,
          tooltip: {
            ...BASE_TOOLTIP,
            trigger: "item",
            formatter: (p: { data: [number, number, string] }) =>
              `<b>${p.data[2]}</b><br/>` +
              `Capacity: <b>${p.data[0].toLocaleString()} kW</b><br/>` +
              `CO₂ factor: <b>${(p.data[1] * 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} g/kWh</b>`,
          },
          xAxis: {
            name: "Capacity (kW)",
            nameLocation: "middle",
            nameGap: 32,
            nameTextStyle: { fontFamily: FONT, fontSize: 11, color: LABEL_CLR, fontWeight: "bold" },
            axisLabel: { fontFamily: FONT, fontSize: 10, color: LABEL_CLR },
            splitLine: { lineStyle: { color: GRID_LINE } },
          },
          yAxis: {
            name: "CO₂ Emission (g/kWh)",
            nameLocation: "middle",
            nameGap: 56,
            nameTextStyle: { fontFamily: FONT, fontSize: 11, color: LABEL_CLR, fontWeight: "bold" },
            axisLabel: {
              fontFamily: FONT,
              fontSize: 10,
              color: LABEL_CLR,
              formatter: (v: number) => (v * 1000).toFixed(0),
            },
            splitLine: { lineStyle: { color: GRID_LINE } },
          },
          series: [
            {
              type: "scatter",
              symbolSize: 11,
              itemStyle: { color: SECONDARY, opacity: 0.88, borderColor: "#fff", borderWidth: 1.5 },
              emphasis: { itemStyle: { opacity: 1 }, scale: 1.4 },
              label: {
                show: points.length <= 12,
                position: "top",
                formatter: (p: { data: [number, number, string] }) => p.data[2],
                fontFamily: FONT,
                fontSize: 9,
                color: LABEL_CLR,
              },
              data: points.map((i) => [
                i.capacity_kw!.value,
                i.co2_emission_factor!.value,
                i.label,
              ]),
            },
          ],
        };

  const ref = useEChart(option);

  if (points.length < 2) {
    return <EmptyChart msg="Need capacity + CO₂ data on ≥ 2 variants to plot." />;
  }
  return <div ref={ref} className="w-full h-56" />;
}

// ── Chart 3: Efficiency vs Lifetime scatter ───────────────────────────────────

function EfficiencyVsLifetimeChart({ instances }: { instances: EquipmentInstance[] }) {
  const points = instances.filter(
    (i) =>
      (i.electrical_efficiency?.value ?? i.thermal_efficiency?.value) != null &&
      i.economic_lifetime_yr?.value != null
  );

  const option: echarts.EChartsCoreOption | null =
    points.length < 2
      ? null
      : {
          animation: true,
          grid: { left: 60, right: 24, top: 36, bottom: 52 },
          toolbox: TOOLBOX,
          tooltip: {
            ...BASE_TOOLTIP,
            trigger: "item",
            formatter: (p: { data: [number, number, string] }) =>
              `<b>${p.data[2]}</b><br/>` +
              `Efficiency: <b>${p.data[0].toFixed(1)} %</b><br/>` +
              `Lifetime: <b>${p.data[1]} yrs</b>`,
          },
          xAxis: {
            name: "Efficiency (%)",
            nameLocation: "middle",
            nameGap: 32,
            nameTextStyle: { fontFamily: FONT, fontSize: 11, color: LABEL_CLR, fontWeight: "bold" },
            axisLabel: { fontFamily: FONT, fontSize: 10, color: LABEL_CLR },
            splitLine: { lineStyle: { color: GRID_LINE } },
          },
          yAxis: {
            name: "Economic Lifetime (yrs)",
            nameLocation: "middle",
            nameGap: 48,
            nameTextStyle: { fontFamily: FONT, fontSize: 11, color: LABEL_CLR, fontWeight: "bold" },
            axisLabel: { fontFamily: FONT, fontSize: 10, color: LABEL_CLR },
            splitLine: { lineStyle: { color: GRID_LINE } },
          },
          series: [
            {
              type: "scatter",
              symbolSize: 10,
              itemStyle: { color: TERTIARY, opacity: 0.85, borderColor: "#fff", borderWidth: 1.5 },
              emphasis: { itemStyle: { opacity: 1 } },
              label: {
                show: points.length <= 12,
                position: "top",
                formatter: (p: { data: [number, number, string] }) => p.data[2],
                fontFamily: FONT,
                fontSize: 9,
                color: LABEL_CLR,
              },
              data: points.map((i) => [
                ((i.electrical_efficiency?.value ?? i.thermal_efficiency?.value)! * 100),
                i.economic_lifetime_yr!.value,
                i.label,
              ]),
            },
          ],
        };

  const ref = useEChart(option);

  if (points.length < 2) {
    return <EmptyChart msg="Not enough efficiency or lifetime data across variants." />;
  }
  return <div ref={ref} className="w-full h-56" />;
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyChart({ msg }: { msg: string }) {
  return (
    <div className="w-full h-56 flex flex-col items-center justify-center gap-2 text-on-surface-variant/50">
      <span className="material-symbols-outlined text-3xl">bar_chart</span>
      <p className="text-xs italic text-center max-w-[200px]">{msg}</p>
    </div>
  );
}

// ── Chart card wrapper ────────────────────────────────────────────────────────

function ChartCard({ title, subtitle, children }: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-sm overflow-hidden">
      <div className="px-5 pt-4 pb-2">
        <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">{title}</p>
        <p className="text-[11px] text-on-surface-variant/60 mt-0.5">{subtitle}</p>
      </div>
      <div className="px-3 pb-3">
        {children}
      </div>
    </div>
  );
}

// ── Public export ─────────────────────────────────────────────────────────────

export function TechCharts({ instances }: { instances: EquipmentInstance[] }) {
  if (instances.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-primary" style={{ fontSize: "16px" }}>insights</span>
        <h3 className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
          Parameter Comparison Charts
        </h3>
        <span className="ml-1 px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded-full">
          Interactive
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard
          title="Capacity vs CAPEX"
          subtitle="Installed capacity (kW) plotted against capital cost ($/kW) per variant"
        >
          <CapacityVsCapexChart instances={instances} />
        </ChartCard>

        <ChartCard
          title="Capacity vs CO₂ Emissions"
          subtitle="Installed capacity (kW) vs. CO₂ emission factor (g/kWh) — hover for variant details"
        >
          <CapacityVsCO2Chart instances={instances} />
        </ChartCard>
      </div>

      <ChartCard
        title="Efficiency vs Economic Lifetime"
        subtitle="Technical performance (%) vs. expected service life (years) per variant"
      >
        <EfficiencyVsLifetimeChart instances={instances} />
      </ChartCard>
    </div>
  );
}

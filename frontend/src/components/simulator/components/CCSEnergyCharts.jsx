/**
 * CCSEnergyCharts.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Time-series charts for CCS simulation results.
 * Uses ECharts for interactive, high-performance plotting.
 */

import React, { useState } from "react";
import ReactECharts from "echarts-for-react";

const CHART_OPTIONS = [
  { id: "capture",    label: "CO₂ Capture & Injection" },
  { id: "energy",     label: "Energy Consumption" },
  { id: "compressor", label: "Compressor Performance" },
  { id: "storage",    label: "Cumulative CO₂ Stored" },
];

export default function CCSEnergyCharts({ result }) {
  const [selectedChart, setSelectedChart] = useState("capture");

  if (!result || !result.time_s || result.time_s.length === 0) {
    return (
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-8 text-center text-on-surface-variant/70">
        <p className="text-sm">No simulation results yet. Run a simulation to see charts.</p>
      </div>
    );
  }

  const optionMap = {
    capture:    buildCaptureChart(result),
    energy:     buildEnergyChart(result),
    compressor: buildCompressorChart(result),
    storage:    buildStorageChart(result),
  };

  return (
    <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-on-surface">Simulation Results</h4>
        <select
          value={selectedChart}
          onChange={(e) => setSelectedChart(e.target.value)}
          className="text-xs border border-outline-variant/30 rounded-lg px-3 py-1.5 bg-surface-container text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-gray-400 cursor-pointer"
        >
          {CHART_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
      </div>
      <ReactECharts
        key={selectedChart}
        option={optionMap[selectedChart]}
        style={{ height: 340 }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ECharts option builders
// ─────────────────────────────────────────────────────────────────────────────

function buildCaptureChart(result) {
  const time = (result.time_s ?? []).map(t => `${Math.round(t / 60)} min`);

  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: {
      data: ["CO₂ Captured (t/h)", "CO₂ Injected (t/h)"],
      bottom: 0,
      textStyle: { fontSize: 9 },
      icon: 'roundRect',
    },
    grid: { top: 24, bottom: 48, left: 56, right: 16 },
    xAxis: { type: "category", data: time, axisLabel: { fontSize: 9 }, axisTick: { show: false } },
    yAxis: {
      type: "value",
      name: "t/h",
      nameTextStyle: { fontSize: 9 },
      axisLabel: { fontSize: 9 },
    },
    series: [
      {
        name: "CO₂ Captured (t/h)",
        type: "line",
        data: result.absorber?.co2_captured_tph ?? [],
        smooth: true,
        symbol: "none",
        color: "#6b7280",
        lineStyle: { color: "#6b7280", width: 2 },
        areaStyle: { color: "rgba(107,114,128,0.1)" },
      },
      {
        name: "CO₂ Injected (t/h)",
        type: "line",
        data: result.storage?.injection_rate_tph ?? [],
        smooth: true,
        symbol: "none",
        color: "#9ca3af",
        lineStyle: { color: "#9ca3af", width: 2 },
        areaStyle: { color: "rgba(156,163,175,0.08)" },
      },
    ],
  };
}

function buildEnergyChart(result) {
  const time = (result.time_s ?? []).map(t => `${Math.round(t / 60)} min`);

  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: {
      data: ["Stripper Thermal (kW)", "Compressor Power (kW)"],
      bottom: 0,
      textStyle: { fontSize: 9 },
      icon: 'roundRect',
    },
    grid: { top: 24, bottom: 48, left: 56, right: 16 },
    xAxis: { type: "category", data: time, axisLabel: { fontSize: 9 }, axisTick: { show: false } },
    yAxis: {
      type: "value",
      name: "kW",
      nameTextStyle: { fontSize: 9 },
      axisLabel: { fontSize: 9 },
    },
    series: [
      {
        name: "Stripper Thermal (kW)",
        type: "line",
        data: result.stripper?.heat_demand_kw ?? [],
        smooth: true,
        symbol: "none",
        color: "#4b5563",
        lineStyle: { color: "#4b5563", width: 2 },
        areaStyle: { color: "rgba(75,85,99,0.1)" },
      },
      {
        name: "Compressor Power (kW)",
        type: "line",
        data: result.compressor?.power_kw ?? [],
        smooth: true,
        symbol: "none",
        color: "#9ca3af",
        lineStyle: { color: "#9ca3af", width: 2 },
        areaStyle: { color: "rgba(156,163,175,0.08)" },
      },
    ],
  };
}

function buildCompressorChart(result) {
  const time = (result.time_s ?? []).map(t => `${Math.round(t / 60)} min`);

  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: {
      data: ["Outlet Pressure (bar)", "Outlet Temp (°C)"],
      bottom: 0,
      textStyle: { fontSize: 9 },
      icon: 'roundRect',
    },
    grid: { top: 24, bottom: 48, left: 56, right: 60 },
    xAxis: { type: "category", data: time, axisLabel: { fontSize: 9 }, axisTick: { show: false } },
    yAxis: [
      {
        type: "value",
        name: "bar",
        nameTextStyle: { fontSize: 9 },
        axisLabel: { fontSize: 9 },
      },
      {
        type: "value",
        name: "°C",
        nameTextStyle: { fontSize: 9 },
        axisLabel: { fontSize: 9 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "Outlet Pressure (bar)",
        type: "line",
        data: result.compressor?.outlet_pressure_bar ?? [],
        smooth: true,
        symbol: "none",
        color: "#6b7280",
        lineStyle: { color: "#6b7280", width: 2 },
        yAxisIndex: 0,
      },
      {
        name: "Outlet Temp (°C)",
        type: "line",
        data: result.compressor?.temperature_c ?? [],
        smooth: true,
        symbol: "none",
        color: "#374151",
        lineStyle: { color: "#374151", width: 2, type: "dashed" },
        yAxisIndex: 1,
      },
    ],
  };
}

function buildStorageChart(result) {
  const time = (result.time_s ?? []).map(t => `${Math.round(t / 60)} min`);

  return {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: {
      data: ["Cumulative Stored (tCO₂)"],
      bottom: 0,
      textStyle: { fontSize: 9 },
      icon: 'roundRect',
    },
    grid: { top: 24, bottom: 48, left: 56, right: 16 },
    xAxis: { type: "category", data: time, axisLabel: { fontSize: 9 }, axisTick: { show: false } },
    yAxis: {
      type: "value",
      name: "tCO₂",
      nameTextStyle: { fontSize: 9 },
      axisLabel: { fontSize: 9 },
    },
    series: [
      {
        name: "Cumulative Stored (tCO₂)",
        type: "line",
        data: result.storage?.co2_mass_tonnes ?? [],
        smooth: true,
        symbol: "none",
        color: "#4b5563",
        lineStyle: { color: "#4b5563", width: 2.5 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(75,85,99,0.3)" },
              { offset: 1, color: "rgba(75,85,99,0.05)" },
            ],
          },
        },
      },
    ],
  };
}

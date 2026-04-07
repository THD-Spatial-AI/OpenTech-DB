/**
 * visual-builder/CarrierNode.tsx
 * ────────────────────────────────
 * React Flow node representing a single energy carrier linked to a
 * technology.  Each dragged technology spawns one CarrierNode per input
 * carrier (positioned left) and one per output carrier (positioned right).
 *
 * Visual anatomy
 * ──────────────────────────────────────
 *  ●  (source handle — for input carriers)
 *  ┌─────────────────────────────┐
 *  │ ● electricity     in │      │
 *  │  Click to set params  │      │
 *  └─────────────────────────────┘
 *  ●  (target handle — for output carriers)
 */

import { memo, useCallback } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { CARRIER_COLORS, useTechBuilderStore, type CarrierNodeData } from "./useTechBuilderStore";

// ── Carrier icon map (Material Symbols names) ─────────────────────────────────

const CARRIER_ICONS: Record<string, string> = {
  electricity:      "bolt",
  natural_gas:      "local_fire_department",
  hydrogen:         "water_drop",
  heat:             "device_thermostat",
  cooling:          "ac_unit",
  steam:            "cloud",
  oil:              "oil_barrel",
  coal:             "energy_program_saving",
  biomass:          "forest",
  biogas:           "biotech",
  syngas:           "science",
  water:            "water",
  co2:              "co2",
  ammonia:          "science",
  wind:             "air",
  solar_irradiance: "wb_sunny",
  nuclear_fuel:     "join_inner",
};

// ── Main component ────────────────────────────────────────────────────────────

function CarrierNode({ id, data, selected }: NodeProps<Node<CarrierNodeData>>) {
  const setSelectedNode = useTechBuilderStore((s) => s.setSelectedNode);

  const handleClick = useCallback(() => setSelectedNode(id), [id, setSelectedNode]);

  const color   = CARRIER_COLORS[data.carrier] ?? "#6366f1";
  const isInput = data.direction === "input";
  const icon    = CARRIER_ICONS[data.carrier] ?? "electric_bolt";

  // Summary of set parameters
  const params: string[] = [];
  if (data.flowRateKw > 0)        params.push(`${data.flowRateKw.toLocaleString()} kW`);
  if (data.temperatureC !== null)  params.push(`${data.temperatureC} °C`);
  if (data.pressureBar  !== null)  params.push(`${data.pressureBar} bar`);

  return (
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events */
    <div
      role="button"
      tabIndex={0}
      aria-label={`Carrier node: ${data.carrier} (${data.direction})`}
      onClick={handleClick}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
      className={`
        relative min-w-[150px] max-w-[190px] rounded-xl shadow-md cursor-pointer select-none
        border-2 transition-all bg-white
        ${selected
          ? "border-indigo-500 shadow-indigo-200 shadow-xl ring-2 ring-indigo-300"
          : "border-slate-200 hover:border-slate-300 hover:shadow-lg"
        }
      `}
    >
      {/* Input carrier: source handle on right → connects to tech node */}
      {isInput && (
        <Handle
          type="source"
          position={Position.Right}
          style={{
            width: 10,
            height: 10,
            background: color,
            border: "2px solid white",
            boxShadow: `0 0 0 1px ${color}`,
          }}
        />
      )}

      {/* Output carrier: target handle on left ← receives from tech node */}
      {!isInput && (
        <Handle
          type="target"
          position={Position.Left}
          style={{
            width: 10,
            height: 10,
            background: color,
            border: "2px solid white",
            boxShadow: `0 0 0 1px ${color}`,
          }}
        />
      )}

      {/* ── Header ── */}
      <div
        className="rounded-t-[10px] px-3 py-2 flex items-center gap-2"
        style={{
          background: `${color}18`,
          borderBottom: `1.5px solid ${color}30`,
        }}
      >
        <span
          className="material-symbols-outlined text-[15px] flex-shrink-0"
          style={{ color }}
        >
          {icon}
        </span>
        <span className="text-xs font-bold text-slate-700 truncate flex-1 capitalize">
          {data.carrier.replace(/_/g, " ")}
        </span>
        <span
          className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white flex-shrink-0"
          style={{ background: color }}
        >
          {isInput ? "IN" : "OUT"}
        </span>
      </div>

      {/* ── Body ── */}
      <div className="px-3 py-2">
        {params.length > 0 ? (
          <div className="space-y-0.5">
            {data.flowRateKw > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1 py-0.5 rounded uppercase tracking-wide">
                  Flow
                </span>
                <span className="text-[10px] font-semibold text-slate-700 tabular-nums">
                  {data.flowRateKw.toLocaleString()} kW
                </span>
              </div>
            )}
            {data.temperatureC !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1 py-0.5 rounded uppercase tracking-wide">
                  Temp
                </span>
                <span className="text-[10px] font-semibold text-slate-700 tabular-nums">
                  {data.temperatureC} °C
                </span>
              </div>
            )}
            {data.pressureBar !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1 py-0.5 rounded uppercase tracking-wide">
                  Press
                </span>
                <span className="text-[10px] font-semibold text-slate-700 tabular-nums">
                  {data.pressureBar} bar
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[10px] text-slate-400 italic">Click to set parameters</p>
        )}
      </div>
    </div>
  );
}

export default memo(CarrierNode);

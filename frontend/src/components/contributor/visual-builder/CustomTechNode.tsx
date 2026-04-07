/**
 * visual-builder/CustomTechNode.tsx
 * ───────────────────────────────────
 * A card-style React Flow node representing one energy technology.
 *
 * Visual anatomy
 * ───────────────────────────────────────────────────────────────
 *  ┌──────────────────────────────┐
 *  │  [domain color]  Label       │  ← colored header per domain
 *  │  OEO class (truncated URI)   │
 *  ├──────────────────────────────┤
 *  │  η ██████████░░░  85 %       │  ← efficiency bar
 *  │  CAPEX  $ 1,200 /kW          │  ← cost preview
 *  └──────────────────────────────┘
 *  ●  input handles (left)           output handles (right)  ●
 *
 * Each handle is colour-coded by carrier type.  Labels appear on hover
 * via Tailwind group/peer trick (no JS tooltip state needed).
 */

import { memo, useCallback } from "react";
import {
  Handle,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  CARRIER_COLORS,
  useTechBuilderStore,
  getOeoId,
  OEO_META,
  type TechNodeData,
} from "./useTechBuilderStore";

// ── Domain → header gradient map ─────────────────────────────────────────────

const DOMAIN_STYLES: Record<string, { bg: string; text: string; icon: string }> = {
  generation:  { bg: "from-amber-500 to-orange-500",  text: "text-white", icon: "bolt"       },
  storage:     { bg: "from-blue-500 to-cyan-500",     text: "text-white", icon: "battery_4_bar" },
  transmission:{ bg: "from-slate-500 to-slate-600",   text: "text-white", icon: "power"       },
  conversion:  { bg: "from-violet-500 to-purple-600", text: "text-white", icon: "sync_alt"    },
};

// ── Carrier handle pill ───────────────────────────────────────────────────────

interface HandlePillProps {
  id: string;
  carrier: string;
  position: Position;
  index: number;
  total: number;
}

function HandlePill({ id, carrier, position, index, total }: HandlePillProps) {
  const color = CARRIER_COLORS[carrier] ?? "#6366f1";
  const isLeft = position === Position.Left;

  // Distribute handles vertically with 24px spacing, centred in node body
  const topPct = total === 1 ? 50 : 30 + (index / (total - 1)) * 40;

  return (
    <div
      className="absolute group/handle"
      style={{
        [isLeft ? "left" : "right"]: -10,
        top: `${topPct}%`,
        transform: "translateY(-50%)",
      }}
    >
      {/* Carrier label on hover */}
      <span
        className={`
          absolute whitespace-nowrap text-[9px] font-semibold px-1.5 py-0.5 rounded
          bg-slate-800 text-white opacity-0 group-hover/handle:opacity-100
          transition-opacity pointer-events-none z-50
          ${isLeft ? "left-4 top-1/2 -translate-y-1/2" : "right-4 top-1/2 -translate-y-1/2"}
        `}
      >
        {carrier.replace(/_/g, " ")}
      </span>

      <Handle
        id={id}
        type={isLeft ? "target" : "source"}
        position={position}
        style={{
          width: 10,
          height: 10,
          background: color,
          border: "2px solid white",
          boxShadow: `0 0 0 1px ${color}`,
          position: "relative",
          top: "auto",
          left: "auto",
          right: "auto",
          transform: "none",
        }}
        className="!static"
      />
    </div>
  );
}

// ── Main node component ───────────────────────────────────────────────────────

function CustomTechNode({ id, data, selected }: NodeProps<Node<TechNodeData>>) {
  const setSelectedNode = useTechBuilderStore((s) => s.setSelectedNode);

  const handleClick = useCallback(() => {
    setSelectedNode(id);
  }, [id, setSelectedNode]);

  const domainStyle = DOMAIN_STYLES[data.domain] ?? DOMAIN_STYLES["conversion"];

  // Format CAPEX for display
  const capexDisplay =
    data.capexUsdPerKw > 0
      ? `$${data.capexUsdPerKw.toLocaleString(undefined, { maximumFractionDigits: 0 })} /kW`
      : "CAPEX not set";

  // Show the OEO domain label (e.g. "generation") as a subtle subtitle rather than the raw URI
  const oeoId = getOeoId(data.oeoClass);
  const meta  = OEO_META[oeoId];
  const domainLabel = meta ? data.domain.charAt(0).toUpperCase() + data.domain.slice(1) : oeoId;

  return (
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events */
    <div
      role="button"
      tabIndex={0}
      aria-label={`Technology node: ${data.label}`}
      onClick={handleClick}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
      className={`
        relative min-w-[200px] max-w-[240px] rounded-xl shadow-lg
        border-2 transition-all cursor-pointer select-none
        bg-white
        ${selected
          ? "border-indigo-500 shadow-indigo-200 shadow-xl ring-2 ring-indigo-300"
          : "border-slate-200 hover:border-slate-300 hover:shadow-xl"
        }
      `}
    >
      {/* ── Header ── */}
      <div className={`bg-gradient-to-r ${domainStyle.bg} rounded-t-[10px] px-3 py-2.5`}>
        <div className="flex items-center gap-2">
          <span className={`material-symbols-outlined text-[16px] ${domainStyle.text}`}>
            {domainStyle.icon}
          </span>
          <p className={`text-xs font-bold ${domainStyle.text} truncate flex-1`}>
            {data.label}
          </p>
        </div>
        <p className="text-[9px] opacity-70 text-white truncate mt-0.5 pl-6">
          {domainLabel}
        </p>
      </div>

      {/* ── Body ── */}
      <div className="px-3 py-2.5 space-y-2">
        {/* Efficiency bar */}
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-bold text-slate-500 w-4"
            title="Conversion efficiency"
          >
            η
          </span>
          <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
              style={{ width: `${Math.min(100, data.efficiencyPercent)}%` }}
            />
          </div>
          <span className="text-[10px] font-semibold text-slate-600 tabular-nums w-8 text-right">
            {data.efficiencyPercent}%
          </span>
        </div>

        {/* CAPEX chip */}
        <div className="flex items-center gap-1.5">
          <span
            className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase tracking-wide"
          >
            CAPEX
          </span>
          <span className="text-[10px] font-semibold text-slate-700">{capexDisplay}</span>
        </div>

        {/* Carrier port summary */}
        <div className="flex items-center gap-2 pt-0.5">
          <div className="flex items-center gap-0.5">
            {data.inputPorts.map((p) => (
              <span
                key={p.id}
                className="w-2 h-2 rounded-full border border-white"
                style={{ background: CARRIER_COLORS[p.carrier] ?? "#6366f1" }}
                title={p.carrier}
              />
            ))}
          </div>
          <span className="text-[9px] text-slate-300">→</span>
          <div className="flex items-center gap-0.5">
            {data.outputPorts.map((p) => (
              <span
                key={p.id}
                className="w-2 h-2 rounded-full border border-white"
                style={{ background: CARRIER_COLORS[p.carrier] ?? "#6366f1" }}
                title={p.carrier}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Input handles (left side) ── */}
      <div
        className="absolute inset-y-0 left-0 flex flex-col justify-center pointer-events-none"
        aria-hidden
      >
        {data.inputPorts.map((port, i) => (
          <HandlePill
            key={port.id}
            id={port.id}
            carrier={port.carrier}
            position={Position.Left}
            index={i}
            total={data.inputPorts.length}
          />
        ))}
      </div>

      {/* ── Output handles (right side) ── */}
      <div
        className="absolute inset-y-0 right-0 flex flex-col justify-center pointer-events-none"
        aria-hidden
      >
        {data.outputPorts.map((port, i) => (
          <HandlePill
            key={port.id}
            id={port.id}
            carrier={port.carrier}
            position={Position.Right}
            index={i}
            total={data.outputPorts.length}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(CustomTechNode);

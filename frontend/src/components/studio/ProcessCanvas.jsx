/**
 * ProcessCanvas.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * The editable flowsheet surface for a Process (ADR-0004, Phase 2).
 *
 * Renders Units as nodes with carrier-typed Port handles and Streams as edges.
 * Connections are validated: a Stream may only join an OUT port to an IN port
 * whose carriers match. The canvas owns the graph state during a Build session;
 * the parent extracts the built Process via the imperative `getProcess()`.
 */

import React, {
  forwardRef, memo, useCallback, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap,
  Handle, Position, MarkerType, addEdge, useNodesState, useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { equipmentDef, carrierColor } from './equipmentLibrary';
import { fmtPower } from './resultsInsights';
import UnitInspector from './UnitInspector';

let _uidCounter = 0;
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${(_uidCounter++).toString(36)}`;

// Headline metric shown as a node badge when simulation results are overlaid.
const _fmtFlow = (v) => `${(+v).toFixed(+v < 10 ? 1 : 0)} kg/h`;
const NODE_METRICS = [
  ['power_kw', fmtPower], ['ch4_kw', fmtPower], ['heat_kw', fmtPower],
  ['biogas_kw', fmtPower], ['fuel_input_kw', fmtPower],
  ['h2_kg_h', _fmtFlow], ['co2_captured_kg_h', _fmtFlow], ['co2_kg_h', _fmtFlow],
];
function nodeBadge(res) {
  if (!res) return null;
  for (const [k, fmt] of NODE_METRICS) if (res[k] != null) return fmt(res[k]);
  const out = res.balance?.out_kw;
  return out ? fmtPower(out) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom node: a Unit with typed Port handles
// ─────────────────────────────────────────────────────────────────────────────
const UnitNode = memo(function UnitNode({ data, selected }) {
  const { unit } = data;
  const def = equipmentDef(unit.equipment_type);
  const Icon = def.icon;
  const ins  = unit.ports.filter((p) => p.direction === 'in');
  const outs = unit.ports.filter((p) => p.direction === 'out');
  const slotTop = (i, n) => `${((i + 1) / (n + 1)) * 100}%`;

  return (
    <div
      className={`relative rounded-xl bg-surface-container-lowest border shadow-sm w-48 transition-all
        ${selected ? 'border-primary ring-2 ring-primary/30' : 'border-outline-variant/40'}`}
    >
      {data.badge && (
        <span className="absolute -top-2.5 -right-2 z-10 px-1.5 py-0.5 rounded-full bg-primary text-on-primary text-[9px] font-bold shadow-md whitespace-nowrap">
          {data.badge}
        </span>
      )}
      {ins.map((port, i) => (
        <Handle
          key={port.id} type="target" position={Position.Left} id={port.id}
          style={{ top: slotTop(i, ins.length), width: 9, height: 9, background: carrierColor(port.carrier), border: '1.5px solid #fff' }}
        />
      ))}
      {outs.map((port, i) => (
        <Handle
          key={port.id} type="source" position={Position.Right} id={port.id}
          style={{ top: slotTop(i, outs.length), width: 9, height: 9, background: carrierColor(port.carrier), border: '1.5px solid #fff' }}
        />
      ))}

      <div className="flex items-center gap-2 px-3 py-2 border-b border-outline-variant/20">
        <span className="p-1.5 rounded-lg bg-primary/10 text-primary"><Icon size={14} /></span>
        <div className="min-w-0">
          <p className="font-headline text-xs font-bold text-on-surface truncate leading-tight">{unit.name}</p>
          <p className="text-[10px] text-on-surface-variant truncate">{def.label}</p>
        </div>
      </div>

      <div className="px-3 py-1.5">
        <p className="text-[10px] text-on-surface-variant truncate">
          {unit.technology_ref
            ? <span className="text-primary font-medium">◆ {unit.technology_ref}</span>
            : <span className="italic text-on-surface-variant/60">no technology</span>}
        </p>
      </div>

      {/* Port labels */}
      <div className="flex justify-between px-2 pb-1.5 gap-1">
        <div className="flex flex-col gap-0.5">
          {ins.map((p) => (
            <span key={p.id} className="text-[8px] text-on-surface-variant/70 leading-tight" style={{ color: carrierColor(p.carrier) }}>◖ {p.carrier}</span>
          ))}
        </div>
        <div className="flex flex-col gap-0.5 items-end">
          {outs.map((p) => (
            <span key={p.id} className="text-[8px] text-on-surface-variant/70 leading-tight" style={{ color: carrierColor(p.carrier) }}>{p.carrier} ◗</span>
          ))}
        </div>
      </div>
    </div>
  );
});

const nodeTypes = { unit: UnitNode };

// ─────────────────────────────────────────────────────────────────────────────
// Graph <-> Process conversion
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_POS = { x: 200, y: 160 };

function unitToNode(unit) {
  return { id: unit.id, type: 'unit', position: unit.position ?? { ...DEFAULT_POS }, data: { unit } };
}

function streamToEdge(s) {
  const color = carrierColor(s.carrier);
  return {
    id: s.id,
    source: s.source.unit_id, sourceHandle: s.source.port_id,
    target: s.target.unit_id, targetHandle: s.target.port_id,
    data: { carrier: s.carrier },
    animated: true,
    style: { stroke: color, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas
// ─────────────────────────────────────────────────────────────────────────────
const ProcessCanvas = forwardRef(function ProcessCanvas({ initialProcess, onDirty, results }, ref) {
  const [nodes, setNodes, onNodesChange] = useNodesState(
    (initialProcess?.units ?? []).map(unitToNode)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    (initialProcess?.streams ?? []).map(streamToEdge)
  );
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const errTimer = useRef(null);

  // ── Simulation-result overlay (edge flow labels/width + node badges) ────────
  const overlayOn = showOverlay && !!results;
  const energyByStream = useMemo(() => {
    const m = {};
    (results?.flows ?? []).forEach((f) => { m[f.stream_id] = f.energy_kw || 0; });
    return m;
  }, [results]);
  const maxEnergy = useMemo(() => Math.max(1, ...Object.values(energyByStream)), [energyByStream]);

  const displayNodes = useMemo(() => (
    overlayOn ? nodes.map((n) => ({ ...n, data: { ...n.data, badge: nodeBadge(results.units?.[n.id]) } })) : nodes
  ), [nodes, overlayOn, results]);

  const displayEdges = useMemo(() => {
    if (!overlayOn) return edges;
    return edges.map((e) => {
      const en = energyByStream[e.id] || 0;
      return {
        ...e, animated: false,
        style: { ...e.style, strokeWidth: en > 0 ? 1.5 + (en / maxEnergy) * 6 : 1.5 },
        label: en > 0 ? fmtPower(en) : undefined,
        labelStyle: { fontSize: 10, fontWeight: 600, fill: '#1b1b1f' },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.85 },
        labelBgPadding: [3, 2], labelBgBorderRadius: 3,
      };
    });
  }, [edges, overlayOn, energyByStream, maxEnergy]);

  const flash = useCallback((msg) => {
    setError(msg);
    clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setError(null), 3200);
  }, []);

  const markDirty = useCallback(() => onDirty?.(), [onDirty]);

  // ── Port lookup for connection validation ──────────────────────────────────
  const portOf = useCallback((nodeId, portId) => {
    const node = nodes.find((n) => n.id === nodeId);
    return node?.data.unit.ports.find((p) => p.id === portId) ?? null;
  }, [nodes]);

  const onConnect = useCallback((params) => {
    const src = portOf(params.source, params.sourceHandle);
    const dst = portOf(params.target, params.targetHandle);
    if (!src || !dst) return;
    if (src.carrier !== dst.carrier) {
      flash(`Cannot connect ${src.carrier} → ${dst.carrier}: carriers must match.`);
      return;
    }
    const edge = streamToEdge({
      id: uid('s'),
      source: { unit_id: params.source, port_id: params.sourceHandle },
      target: { unit_id: params.target, port_id: params.targetHandle },
      carrier: src.carrier,
    });
    setEdges((eds) => addEdge(edge, eds));
    markDirty();
  }, [portOf, flash, setEdges, markDirty]);

  const onNodeClick = useCallback((_e, node) => setSelectedId(node.id), []);
  const onPaneClick = useCallback(() => setSelectedId(null), []);

  const selectedUnit = useMemo(
    () => nodes.find((n) => n.id === selectedId)?.data.unit ?? null,
    [nodes, selectedId]
  );

  const updateUnit = useCallback((unitId, patch) => {
    setNodes((nds) => nds.map((n) =>
      n.id === unitId ? { ...n, data: { ...n.data, unit: { ...n.data.unit, ...patch } } } : n
    ));
    markDirty();
  }, [setNodes, markDirty]);

  const deleteUnit = useCallback((unitId) => {
    setNodes((nds) => nds.filter((n) => n.id !== unitId));
    setEdges((eds) => eds.filter((e) => e.source !== unitId && e.target !== unitId));
    setSelectedId(null);
    markDirty();
  }, [setNodes, setEdges, markDirty]);

  // ── Imperative API for the Studio shell (palette add / save) ───────────────
  useImperativeHandle(ref, () => ({
    addUnit(equipmentType) {
      const def = equipmentDef(equipmentType);
      const id = uid(equipmentType);
      const unit = {
        id, name: def.label, equipment_type: equipmentType,
        technology_ref: null, instance_ref: null,
        operating_conditions: {},
        ports: def.ports.map((pt) => ({ ...pt })),
        position: { x: 120 + Math.random() * 120, y: 120 + Math.random() * 160 },
      };
      setNodes((nds) => nds.concat(unitToNode(unit)));
      setSelectedId(id);
      markDirty();
    },
    getProcess() {
      return {
        units: nodes.map((n) => ({
          ...n.data.unit,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        })),
        streams: edges.map((e) => ({
          id: e.id,
          source: { unit_id: e.source, port_id: e.sourceHandle },
          target: { unit_id: e.target, port_id: e.targetHandle },
          carrier: e.data?.carrier,
        })),
      };
    },
  }), [nodes, edges, setNodes, markDirty]);

  return (
    <div className="flex-1 flex min-w-0" data-tour="canvas">
      <div className="flex-1 relative min-w-0">
        {error && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-lg
                          bg-tertiary text-on-tertiary text-xs font-medium shadow-lg">
            {error}
          </div>
        )}
        {results && (
          <button onClick={() => setShowOverlay((v) => !v)}
            className="absolute top-3 left-3 z-20 px-2.5 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-xs font-semibold text-on-surface shadow-sm hover:bg-surface-container transition-colors">
            {showOverlay ? 'Hide results' : 'Show results'}
          </button>
        )}
        <ReactFlow
          nodes={displayNodes} edges={displayEdges}
          onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type === 'position' && x.dragging === false)) markDirty(); }}
          onEdgesChange={(c) => { onEdgesChange(c); if (c.some((x) => x.type === 'remove')) markDirty(); }}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={['Backspace', 'Delete']}
          style={{ background: '#f2f4f6' }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#c3c6d7" />
          <Controls position="bottom-right" style={{ background: '#fff', border: '1px solid #c3c6d7', borderRadius: 8, overflow: 'hidden' }} />
          <MiniMap
            position="bottom-left"
            nodeColor="#4d4b9e"
            maskColor="rgba(120,124,140,0.15)"
            style={{ background: '#eceef0', border: '1px solid #c3c6d7', borderRadius: 8 }}
          />
        </ReactFlow>
      </div>

      <UnitInspector
        unit={selectedUnit}
        onChange={(patch) => selectedUnit && updateUnit(selectedUnit.id, patch)}
        onDelete={() => selectedUnit && deleteUnit(selectedUnit.id)}
      />
    </div>
  );
});

// Wrap in a provider so multiple canvases / remounts keep isolated RF state.
const ProcessCanvasWrapped = forwardRef(function ProcessCanvasWrapped(props, ref) {
  return (
    <ReactFlowProvider>
      <ProcessCanvas {...props} ref={ref} />
    </ReactFlowProvider>
  );
});

export default ProcessCanvasWrapped;

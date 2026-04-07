/**
 * visual-builder/VisualTechBuilder.tsx
 * ──────────────────────────────────────
 * Main orchestrator for the drag-and-drop technology topology builder.
 *
 * Layout (three-column, full-height)
 * ─────────────────────────────────────────────────────────────────────────
 *  ┌──────────────────┬──────────────────────────────┬──────────────────┐
 *  │ Equipment Palette│       React Flow Canvas       │ Properties Panel │
 *  │     268 px       │         flex-1 (grow)         │     336 px       │
 *  └──────────────────┴──────────────────────────────┴──────────────────┘
 *
 * React Flow integration
 * ──────────────────────
 * - Custom node type "techNode" → CustomTechNode
 * - Nodes/edges owned by Zustand (useTechBuilderStore)
 * - BackgroundVariant.Dots for engineering-tool feel
 * - MiniMap and Controls for large topologies
 *
 * Drag-and-drop protocol
 * ──────────────────────
 * EquipmentPalette items set dataTransfer "application/reactflow" JSON.
 * This component's onDrop reads that, converts screen→flow coords via
 * useReactFlow().screenToFlowPosition, then calls addEquipmentNode.
 */

import "@xyflow/react/dist/style.css";

import { use, useCallback, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
  Panel,
  type NodeTypes,
} from "@xyflow/react";
import type { OntologySchema } from "../../../types/api";
import { useTechBuilderStore } from "./useTechBuilderStore";
import CustomTechNode from "./CustomTechNode";
import EquipmentPalette from "./EquipmentPalette";
import PropertiesPanel from "./PropertiesPanel";

// ── Node type registry (stable reference outside component) ───────────────────

const NODE_TYPES: NodeTypes = {
  techNode: CustomTechNode,
};

// ── Canvas toolbar ────────────────────────────────────────────────────────────

function CanvasToolbar() {
  const { nodes, clearGraph, selectedNodeId } = useTechBuilderStore();

  const { fitView } = useReactFlow();

  return (
    <Panel position="top-center">
      <div
        className="flex items-center gap-1 bg-white/90 backdrop-blur border border-slate-200
                   rounded-2xl shadow-lg px-3 py-2"
      >
        {/* Node count */}
        <span className="text-[10px] font-semibold text-slate-500 pr-2 border-r border-slate-200 mr-1">
          {nodes.length} {nodes.length === 1 ? "node" : "nodes"}
        </span>

        {/* Fit view */}
        <button
          type="button"
          onClick={() => fitView({ padding: 0.2, duration: 400 })}
          className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-indigo-600
                     px-2 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors font-medium"
          title="Fit all nodes into view"
        >
          <span className="material-symbols-outlined text-[14px]">fit_screen</span>
          Fit
        </button>

        {/* Clear graph */}
        {nodes.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Clear the entire canvas? This cannot be undone.")) {
                clearGraph();
              }
            }}
            className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-700
                       px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors font-medium"
            title="Clear all nodes and edges"
          >
            <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
            Clear
          </button>
        )}

        {selectedNodeId && (
          <span className="flex items-center gap-1 text-[10px] text-indigo-600 font-semibold
                           bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5 ml-1">
            <span className="material-symbols-outlined text-[12px]">edit</span>
            Editing node
          </span>
        )}
      </div>
    </Panel>
  );
}

// ── Drop-enabled canvas ───────────────────────────────────────────────────────

function FlowCanvas() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    setSelectedNode,
    addEquipmentNode,
  } = useTechBuilderStore();

  const { screenToFlowPosition } = useReactFlow();

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/reactflow");
      if (!raw) return;

      let parsed: { oeoClass: string; domain: string };
      try {
        parsed = JSON.parse(raw) as { oeoClass: string; domain: string };
      } catch {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addEquipmentNode(parsed.oeoClass, parsed.domain, position);
    },
    [screenToFlowPosition, addEquipmentNode]
  );

  return (
    <div
      className="flex-1 h-full"
      style={{ background: "#f5f7fb" }}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={() => setSelectedNode(null)}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode="Delete"
        proOptions={{ hideAttribution: true }}
        className="!bg-transparent"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#cbd5e1"
        />
        <Controls
          position="bottom-left"
          className="!shadow-md !rounded-xl !border-slate-200"
        />
        <MiniMap
          position="bottom-right"
          nodeColor={(node) => {
            const domain = (node.data as { domain?: string })?.domain ?? "";
            const colors: Record<string, string> = {
              generation:   "#f59e0b",
              storage:      "#3b82f6",
              transmission: "#64748b",
              conversion:   "#8b5cf6",
            };
            return colors[domain] ?? "#6366f1";
          }}
          maskColor="rgba(0,0,0,0.06)"
          className="!rounded-xl !border !border-slate-200 !shadow-md"
        />
        <CanvasToolbar />
      </ReactFlow>
    </div>
  );
}

// ── Empty canvas hint ─────────────────────────────────────────────────────────

function EmptyCanvasHint() {
  const { nodes } = useTechBuilderStore();
  if (nodes.length > 0) return null;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
      <span className="material-symbols-outlined text-6xl text-slate-300 mb-4">
        account_tree
      </span>
      <p className="text-slate-400 font-semibold text-base">
        Drag equipment blocks here
      </p>
      <p className="text-slate-300 text-sm mt-1">
        From the Equipment Palette on the left
      </p>
    </div>
  );
}

// ── Main exported component ───────────────────────────────────────────────────

interface VisualTechBuilderProps {
  /**
   * A stable Promise for OntologySchema — passed from ContributorWorkspace
   * where it is memoised.  React 19 use() suspends while it resolves;
   * the parent <Suspense> boundary handles the loading state.
   */
  schemaPromise: Promise<OntologySchema>;
  onSubmitSuccess: (technologyName: string) => void;
}

/**
 * Wraps everything in <ReactFlowProvider> so that nested components can use
 * useReactFlow() hooks (required for screenToFlowPosition etc.).
 */
export default function VisualTechBuilder({
  schemaPromise,
  onSubmitSuccess,
}: VisualTechBuilderProps) {
  // React 19 use() — suspends until the schema promise resolves.
  // The <Suspense> boundary in ContributorWorkspace renders the skeleton.
  const schema = use(schemaPromise);

  // Memoised node types so the object reference is stable across re-renders
  const nodeTypes = useMemo(() => NODE_TYPES, []);
  void nodeTypes; // used inside FlowCanvas via the module-level constant

  return (
    <div className="flex h-full min-h-0 rounded-2xl overflow-hidden border border-outline-variant/20 shadow-sm">
      {/* Left — Equipment Palette */}
      <EquipmentPalette schema={schema} />

      {/* Centre — React Flow Canvas */}
      <ReactFlowProvider>
        <div className="relative flex-1 min-w-0 h-full">
          <FlowCanvas />
          <EmptyCanvasHint />
        </div>
      </ReactFlowProvider>

      {/* Right — Properties & Cost Panel */}
      <PropertiesPanel schema={schema} onSubmitSuccess={onSubmitSuccess} />
    </div>
  );
}

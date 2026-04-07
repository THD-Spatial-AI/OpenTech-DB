/**
 * visual-builder/useTechBuilderStore.ts
 * ──────────────────────────────────────
 * Zustand store that is the single source of truth for the visual topology
 * canvas. Owns nodes, edges, and the currently-selected node ID.
 *
 * Why Zustand (not plain React context)?
 * The React Flow library triggers many fine-grained change events (drag,
 * resize, connect). Routing all of those through a React context would
 * cause entire subtrees to re-render on every mouse-move. Zustand's
 * selector-based subscriptions make it O(1) per subscriber.
 */

import { create } from "zustand";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";

// ── Carrier port descriptor ───────────────────────────────────────────────────

export interface CarrierPort {
  /** Must be unique within the node; used as React Flow Handle id. */
  id: string;
  /** OEO carrier name, e.g. "electricity", "natural_gas". */
  carrier: string;
}

// ── Node data shape ───────────────────────────────────────────────────────────
// Extends Record<string,unknown> as required by @xyflow/react v12.

export interface TechNodeData extends Record<string, unknown> {
  // Identity / taxonomy
  label: string;
  oeoClass: string;
  domain: string;
  description: string;
  variantName: string;
  referenceSource: string;

  // Topology
  inputPorts: CarrierPort[];
  outputPorts: CarrierPort[];

  // Technical
  efficiencyPercent: number;
  co2FactorGPerKwh: number;
  lifetimeYears: number;

  // Economics (final values; derived by CostCalculatorWizard)
  capexUsdPerKw: number;
  opexFixedUsdPerKwYr: number;
  opexVarUsdPerMwh: number;
}

// ── Carrier node data shape ─────────────────────────────────────────────────

export interface CarrierNodeData extends Record<string, unknown> {
  /** OEO carrier name, e.g. "electricity", "natural_gas". */
  carrier: string;
  /** Whether this is an input to or output from the technology. */
  direction: "input" | "output";
  /** Display label (human-readable carrier name). */
  label: string;
  /** Nominal energy flow [kW]. 0 = not yet set. */
  flowRateKw: number;
  /** Stream temperature [°C] — for thermal/steam/geothermal flows. */
  temperatureC: number | null;
  /** Stream pressure [bar] — for gas/H₂/steam flows. */
  pressureBar: number | null;
  /** Free-text quality note (e.g. "H₂ purity > 99.9 %"). */
  qualityNote: string;
}

// ── Store shape ───────────────────────────────────────────────────────────────

interface TechBuilderState {
  /** Mixed array — contains techNode and carrierNode React Flow nodes. */
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  /** Non-null when a user action cannot be completed (e.g. adding a second tech node). */
  canvasWarning: string | null;

  // React Flow change-handlers (wire directly to <ReactFlow> props)
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  // Domain actions
  setSelectedNode: (id: string | null) => void;
  setCanvasWarning: (w: string | null) => void;
  updateNodeData: (id: string, patch: Partial<TechNodeData>) => void;
  updateCarrierNode: (id: string, patch: Partial<CarrierNodeData>) => void;
  addEquipmentNode: (oeoClass: string, domain: string, position: XYPosition) => void;
  clearGraph: () => void;
}

// ── OEO Technology Metadata ──────────────────────────────────────────────────
// Keyed by the short OEO ID (e.g. "OEO_00000165"), extracted from the full URI.
// Provides human labels, domain classification, pre-filled carrier ports,
// and realistic literature-based default parameters for each technology.

export interface OeoMeta {
  label: string;
  domain: "generation" | "storage" | "transmission" | "conversion";
  /** Suggested input energy carriers */
  inputs: string[];
  /** Suggested output energy carriers */
  outputs: string[];
  /** Conversion efficiency [%] */
  efficiencyPct: number;
  /** Operational CO₂ factor [g/kWh_out] */
  co2GPerKwh: number;
  /** Technical lifetime [years] */
  lifetimeYrs: number;
  /** Capital cost [USD/kW] */
  capexPerKw: number;
  /** Fixed O&M [USD/kW/yr] */
  opexFixedPerKwYr: number;
  /** Variable O&M [USD/MWh] */
  opexVarPerMwh: number;
  /** Suggested description to pre-fill */
  hint: string;
}

export const OEO_META: Record<string, OeoMeta> = {
  // ── Generation ────────────────────────────────────────────────────────────
  OEO_00000165: {
    label: "Solar PV Utility-scale",
    domain: "generation",
    inputs:  ["solar_irradiance"],
    outputs: ["electricity"],
    efficiencyPct: 20, co2GPerKwh: 0, lifetimeYrs: 25,
    capexPerKw: 950, opexFixedPerKwYr: 9, opexVarPerMwh: 0,
    hint: "Large-scale photovoltaic plant converting solar irradiance to electricity. Typically fixed-tilt or single-axis tracking on open land.",
  },
  OEO_00000361: {
    label: "Solar PV Distributed",
    domain: "generation",
    inputs:  ["solar_irradiance"],
    outputs: ["electricity"],
    efficiencyPct: 18, co2GPerKwh: 0, lifetimeYrs: 25,
    capexPerKw: 1400, opexFixedPerKwYr: 12, opexVarPerMwh: 0,
    hint: "Rooftop or building-integrated photovoltaic system at residential or commercial scale.",
  },
  OEO_00000389: {
    label: "Concentrated Solar Power (CSP)",
    domain: "generation",
    inputs:  ["solar_irradiance"],
    outputs: ["electricity"],
    efficiencyPct: 16, co2GPerKwh: 0, lifetimeYrs: 30,
    capexPerKw: 4500, opexFixedPerKwYr: 65, opexVarPerMwh: 3,
    hint: "Parabolic trough or power tower CSP plant. Mirrors focus sunlight to drive a steam turbine. Can include thermal storage.",
  },
  OEO_00000311: {
    label: "Onshore Wind",
    domain: "generation",
    inputs:  ["wind"],
    outputs: ["electricity"],
    efficiencyPct: 40, co2GPerKwh: 0, lifetimeYrs: 25,
    capexPerKw: 1300, opexFixedPerKwYr: 35, opexVarPerMwh: 1,
    hint: "Land-based wind turbine farm. Capacity factor depends on site wind resource.",
  },
  OEO_00000308: {
    label: "Offshore Wind Floating",
    domain: "generation",
    inputs:  ["wind"],
    outputs: ["electricity"],
    efficiencyPct: 45, co2GPerKwh: 0, lifetimeYrs: 25,
    capexPerKw: 3200, opexFixedPerKwYr: 90, opexVarPerMwh: 2,
    hint: "Floating offshore wind turbine installed in deep waters. Higher capacity factor than onshore; higher CAPEX.",
  },
  OEO_00000192: {
    label: "Geothermal Power",
    domain: "generation",
    inputs:  ["water"],
    outputs: ["electricity", "heat"],
    efficiencyPct: 12, co2GPerKwh: 38, lifetimeYrs: 30,
    capexPerKw: 4000, opexFixedPerKwYr: 80, opexVarPerMwh: 2,
    hint: "Flash steam or binary cycle geothermal plant extracting heat from the earth. Can provide baseload power and district heat.",
  },
  OEO_00010087: {
    label: "Hydroelectric Run-of-River",
    domain: "generation",
    inputs:  ["water"],
    outputs: ["electricity"],
    efficiencyPct: 90, co2GPerKwh: 4, lifetimeYrs: 60,
    capexPerKw: 2000, opexFixedPerKwYr: 20, opexVarPerMwh: 1,
    hint: "Run-of-river hydroelectric plant with minimal reservoir storage. Generation follows river flow.",
  },
  OEO_00010094: {
    label: "Hydroelectric Reservoir",
    domain: "generation",
    inputs:  ["water"],
    outputs: ["electricity"],
    efficiencyPct: 88, co2GPerKwh: 10, lifetimeYrs: 80,
    capexPerKw: 2800, opexFixedPerKwYr: 25, opexVarPerMwh: 1,
    hint: "Large-reservoir hydroelectric dam with significant storage. Dispatchable; lifetime > 80 years.",
  },
  OEO_00010086: {
    label: "Marine Energy",
    domain: "generation",
    inputs:  ["wind"],
    outputs: ["electricity"],
    efficiencyPct: 35, co2GPerKwh: 0, lifetimeYrs: 20,
    capexPerKw: 5000, opexFixedPerKwYr: 130, opexVarPerMwh: 5,
    hint: "Tidal stream or wave energy converter. Still at early commercial stage; high CAPEX.",
  },
  OEO_00000089: {
    label: "Coal Power Plant",
    domain: "generation",
    inputs:  ["coal"],
    outputs: ["electricity", "heat"],
    efficiencyPct: 38, co2GPerKwh: 820, lifetimeYrs: 40,
    capexPerKw: 3000, opexFixedPerKwYr: 40, opexVarPerMwh: 5,
    hint: "Pulverised coal or subcritical steam power plant. High CO₂ emissions; being phased out under net-zero pathways.",
  },
  OEO_00000303: {
    label: "Nuclear Power",
    domain: "generation",
    inputs:  ["nuclear_fuel"],
    outputs: ["electricity", "heat"],
    efficiencyPct: 33, co2GPerKwh: 12, lifetimeYrs: 60,
    capexPerKw: 7000, opexFixedPerKwYr: 95, opexVarPerMwh: 5,
    hint: "Light-water reactor nuclear power plant. Very low lifecycle CO₂; high capital cost and long construction time.",
  },
  OEO_00000184: {
    label: "Internal Combustion Engine",
    domain: "generation",
    inputs:  ["natural_gas"],
    outputs: ["electricity", "heat"],
    efficiencyPct: 42, co2GPerKwh: 480, lifetimeYrs: 20,
    capexPerKw: 800, opexFixedPerKwYr: 20, opexVarPerMwh: 12,
    hint: "Reciprocating gas engine for distributed generation or CHP. Fast-ramping peak supply or backup.",
  },
  OEO_00000004: {
    label: "Biogas Power Plant",
    domain: "generation",
    inputs:  ["biogas"],
    outputs: ["electricity"],
    efficiencyPct: 38, co2GPerKwh: 230, lifetimeYrs: 20,
    capexPerKw: 2200, opexFixedPerKwYr: 60, opexVarPerMwh: 8,
    hint: "Anaerobic digestion biogas fed to gas engine or turbine for electricity generation.",
  },
  OEO_00000036: {
    label: "Biomass Power Plant",
    domain: "generation",
    inputs:  ["biomass"],
    outputs: ["electricity"],
    efficiencyPct: 35, co2GPerKwh: 230, lifetimeYrs: 25,
    capexPerKw: 2800, opexFixedPerKwYr: 75, opexVarPerMwh: 8,
    hint: "Dedicated solid biomass steam-cycle power plant. Carbon-neutral when sustainably sourced.",
  },
  OEO_00000440: {
    label: "Waste-to-Energy",
    domain: "generation",
    inputs:  ["biomass"],
    outputs: ["electricity", "heat"],
    efficiencyPct: 22, co2GPerKwh: 300, lifetimeYrs: 30,
    capexPerKw: 3500, opexFixedPerKwYr: 85, opexVarPerMwh: 10,
    hint: "Municipal solid waste incineration with energy recovery. Combined heat and power possible.",
  },

  // ── Storage ───────────────────────────────────────────────────────────────
  OEO_00000248: {
    label: "Lithium-ion Battery Storage",
    domain: "storage",
    inputs:  ["electricity"],
    outputs: ["electricity"],
    efficiencyPct: 92, co2GPerKwh: 0, lifetimeYrs: 15,
    capexPerKw: 400, opexFixedPerKwYr: 8, opexVarPerMwh: 0.5,
    hint: "Grid-scale Li-ion battery energy storage system (BESS). Ideal for short-duration (2–4 h) shifting and frequency regulation.",
  },
  OEO_00010089: {
    label: "Pumped Hydro Storage",
    domain: "storage",
    inputs:  ["electricity", "water"],
    outputs: ["electricity"],
    efficiencyPct: 82, co2GPerKwh: 0, lifetimeYrs: 80,
    capexPerKw: 2500, opexFixedPerKwYr: 15, opexVarPerMwh: 1,
    hint: "Pumped-storage hydropower. Surplus electricity pumps water uphill; released through turbines when needed.",
  },
  OEO_00000169: {
    label: "Redox Flow Batteries",
    domain: "storage",
    inputs:  ["electricity"],
    outputs: ["electricity"],
    efficiencyPct: 75, co2GPerKwh: 0, lifetimeYrs: 20,
    capexPerKw: 700, opexFixedPerKwYr: 20, opexVarPerMwh: 1,
    hint: "Vanadium or other redox flow battery. Scalable energy capacity; suited to 4–12 h storage.",
  },
  OEO_00000377: {
    label: "Sodium-Sulfur Batteries",
    domain: "storage",
    inputs:  ["electricity"],
    outputs: ["electricity"],
    efficiencyPct: 85, co2GPerKwh: 0, lifetimeYrs: 15,
    capexPerKw: 500, opexFixedPerKwYr: 12, opexVarPerMwh: 0.5,
    hint: "High-temperature sodium–sulfur (NaS) battery for bulk energy storage.",
  },
  OEO_00280014: {
    label: "Lead-Acid Batteries",
    domain: "storage",
    inputs:  ["electricity"],
    outputs: ["electricity"],
    efficiencyPct: 80, co2GPerKwh: 0, lifetimeYrs: 10,
    capexPerKw: 250, opexFixedPerKwYr: 8, opexVarPerMwh: 0.5,
    hint: "Mature, low-cost battery technology. Heavy and lower cycle life vs. Li-ion.",
  },
  OEO_00000399: {
    label: "Liquid Air Energy Storage (LAES)",
    domain: "storage",
    inputs:  ["electricity"],
    outputs: ["electricity"],
    efficiencyPct: 60, co2GPerKwh: 0, lifetimeYrs: 25,
    capexPerKw: 1200, opexFixedPerKwYr: 25, opexVarPerMwh: 2,
    hint: "Cryogenic energy storage: air is liquefied using surplus power and expanded through a turbine for discharge.",
  },
  OEO_00020250: {
    label: "Compressed Air Energy Storage (CAES)",
    domain: "storage",
    inputs:  ["electricity"],
    outputs: ["electricity"],
    efficiencyPct: 65, co2GPerKwh: 0, lifetimeYrs: 30,
    capexPerKw: 900, opexFixedPerKwYr: 18, opexVarPerMwh: 2,
    hint: "Compressed air stored in geological caverns. Adiabatic CAES avoids gas combustion during expansion.",
  },
  OEO_00000429: {
    label: "Hydrogen Underground Storage",
    domain: "storage",
    inputs:  ["hydrogen"],
    outputs: ["hydrogen"],
    efficiencyPct: 98, co2GPerKwh: 0, lifetimeYrs: 30,
    capexPerKw: 350, opexFixedPerKwYr: 5, opexVarPerMwh: 0.5,
    hint: "Hydrogen stored in salt caverns or depleted reservoirs for seasonal energy storage.",
  },
  OEO_00020363: {
    label: "Hydrogen Storage Tanks",
    domain: "storage",
    inputs:  ["hydrogen"],
    outputs: ["hydrogen"],
    efficiencyPct: 99, co2GPerKwh: 0, lifetimeYrs: 20,
    capexPerKw: 600, opexFixedPerKwYr: 8, opexVarPerMwh: 0.5,
    hint: "Above-ground pressurised or cryogenic hydrogen tanks for short-to-medium duration storage.",
  },
  OEO_00310037: {
    label: "Sensible Thermal Storage",
    domain: "storage",
    inputs:  ["heat"],
    outputs: ["heat"],
    efficiencyPct: 90, co2GPerKwh: 0, lifetimeYrs: 25,
    capexPerKw: 80, opexFixedPerKwYr: 2, opexVarPerMwh: 0.2,
    hint: "Hot-water tank or pit thermal energy storage (PTES) using sensible heat capacity.",
  },
  OEO_00310043: {
    label: "Latent Thermal Storage (PCM)",
    domain: "storage",
    inputs:  ["heat"],
    outputs: ["heat"],
    efficiencyPct: 88, co2GPerKwh: 0, lifetimeYrs: 20,
    capexPerKw: 200, opexFixedPerKwYr: 5, opexVarPerMwh: 0.5,
    hint: "Phase change material thermal storage. Higher energy density than sensible storage.",
  },

  // ── Transmission ──────────────────────────────────────────────────────────
  OEO_00000047: {
    label: "HVAC Overhead Lines",
    domain: "transmission",
    inputs:  ["electricity"],
    outputs: ["electricity"],
    efficiencyPct: 97, co2GPerKwh: 0, lifetimeYrs: 40,
    capexPerKw: 400, opexFixedPerKwYr: 5, opexVarPerMwh: 0.3,
    hint: "High-voltage AC overhead transmission lines. Dominant technology for medium-to-long distance bulk power transfer.",
  },
  OEO_00000127: {
    label: "HVDC Converter Stations",
    domain: "transmission",
    inputs:  ["electricity"],
    outputs: ["electricity"],
    efficiencyPct: 98, co2GPerKwh: 0, lifetimeYrs: 40,
    capexPerKw: 700, opexFixedPerKwYr: 7, opexVarPerMwh: 0.2,
    hint: "High-voltage direct current link. Lower losses over very long distances; enables asynchronous grid interconnection.",
  },
  OEO_00020006: {
    label: "Hydrogen Pipelines",
    domain: "transmission",
    inputs:  ["hydrogen"],
    outputs: ["hydrogen"],
    efficiencyPct: 99, co2GPerKwh: 0, lifetimeYrs: 40,
    capexPerKw: 1200, opexFixedPerKwYr: 10, opexVarPerMwh: 0.5,
    hint: "Dedicated hydrogen transmission pipeline. Can repurpose natural gas infrastructure for H₂ blends.",
  },
  OEO_00020005: {
    label: "Water Transmission Pipeline",
    domain: "transmission",
    inputs:  ["water"],
    outputs: ["water"],
    efficiencyPct: 99, co2GPerKwh: 0, lifetimeYrs: 50,
    capexPerKw: 800, opexFixedPerKwYr: 8, opexVarPerMwh: 0.2,
    hint: "Large-diameter pipeline for water transmission. Used in hydropower, desalination, or irrigation systems.",
  },
  OEO_00020007: {
    label: "Oil / Petroleum Products Pipeline",
    domain: "transmission",
    inputs:  ["oil"],
    outputs: ["oil"],
    efficiencyPct: 99, co2GPerKwh: 0, lifetimeYrs: 40,
    capexPerKw: 900, opexFixedPerKwYr: 9, opexVarPerMwh: 0.3,
    hint: "Crude oil or refined petroleum product transmission pipeline.",
  },
  OEO_00150002: {
    label: "Biomass Truck Transport",
    domain: "transmission",
    inputs:  ["biomass"],
    outputs: ["biomass"],
    efficiencyPct: 95, co2GPerKwh: 15, lifetimeYrs: 10,
    capexPerKw: 150, opexFixedPerKwYr: 10, opexVarPerMwh: 5,
    hint: "Road freight transport of solid biomass feedstock to power plants or biorefineries.",
  },

  // ── Conversion ────────────────────────────────────────────────────────────
  OEO_00000009: {
    label: "Heat Pump (Air-Source)",
    domain: "conversion",
    inputs:  ["electricity"],
    outputs: ["heat"],
    efficiencyPct: 320, co2GPerKwh: 0, lifetimeYrs: 20,
    capexPerKw: 1000, opexFixedPerKwYr: 20, opexVarPerMwh: 0.5,
    hint: "Reverse-cycle heat pump extracting ambient air heat. COP of 3–4 in heating mode; higher with ground-source.",
  },
  OEO_00000016: {
    label: "Solid Oxide Fuel Cell (SOFC)",
    domain: "conversion",
    inputs:  ["hydrogen"],
    outputs: ["electricity", "heat"],
    efficiencyPct: 60, co2GPerKwh: 0, lifetimeYrs: 20,
    capexPerKw: 3000, opexFixedPerKwYr: 50, opexVarPerMwh: 5,
    hint: "High-temperature solid oxide fuel cell converting hydrogen to electricity with useful heat by-product.",
  },
  OEO_00140134: {
    label: "PEM Fuel Cell",
    domain: "conversion",
    inputs:  ["hydrogen"],
    outputs: ["electricity", "heat"],
    efficiencyPct: 58, co2GPerKwh: 0, lifetimeYrs: 15,
    capexPerKw: 1500, opexFixedPerKwYr: 30, opexVarPerMwh: 3,
    hint: "Proton exchange membrane fuel cell running on hydrogen. Low-temperature operation; fast start-up.",
  },
  OEO_00010021: {
    label: "Alkaline Electrolyzer (AWE)",
    domain: "conversion",
    inputs:  ["electricity", "water"],
    outputs: ["hydrogen"],
    efficiencyPct: 70, co2GPerKwh: 0, lifetimeYrs: 20,
    capexPerKw: 800, opexFixedPerKwYr: 15, opexVarPerMwh: 0.5,
    hint: "Water electrolysis using an alkaline electrolyte. Mature technology for large-scale green hydrogen production.",
  },
  OEO_00310015: {
    label: "Electric Boiler",
    domain: "conversion",
    inputs:  ["electricity"],
    outputs: ["heat", "steam"],
    efficiencyPct: 99, co2GPerKwh: 0, lifetimeYrs: 25,
    capexPerKw: 150, opexFixedPerKwYr: 3, opexVarPerMwh: 0.2,
    hint: "Electrode or resistance boiler converting electricity to process heat or steam. Useful for industrial decarbonisation.",
  },
  OEO_00000269: {
    label: "Methanation Reactor",
    domain: "conversion",
    inputs:  ["hydrogen", "co2"],
    outputs: ["biogas"],
    efficiencyPct: 78, co2GPerKwh: 0, lifetimeYrs: 20,
    capexPerKw: 900, opexFixedPerKwYr: 20, opexVarPerMwh: 2,
    hint: "Sabatier process reactor converting surplus H₂ and CO₂ into synthetic methane (power-to-gas).",
  },
  OEO_00010020: {
    label: "Fischer-Tropsch Synthesis",
    domain: "conversion",
    inputs:  ["hydrogen", "co2"],
    outputs: ["syngas", "oil"],
    efficiencyPct: 65, co2GPerKwh: 0, lifetimeYrs: 25,
    capexPerKw: 2500, opexFixedPerKwYr: 50, opexVarPerMwh: 5,
    hint: "Catalytic process producing synthetic liquid fuels (e-fuels) from H₂ and CO₂ syngas.",
  },
  OEO_00010139: {
    label: "Direct Air Capture (DAC)",
    domain: "conversion",
    inputs:  ["electricity", "heat"],
    outputs: ["co2"],
    efficiencyPct: 70, co2GPerKwh: 0, lifetimeYrs: 20,
    capexPerKw: 4000, opexFixedPerKwYr: 80, opexVarPerMwh: 20,
    hint: "Chemical or physical process capturing CO₂ directly from the atmosphere. High energy and capital intensity.",
  },
  OEO_00010141: {
    label: "Carbon Capture Systems (CCS)",
    domain: "conversion",
    inputs:  ["co2", "electricity"],
    outputs: ["co2"],
    efficiencyPct: 90, co2GPerKwh: 0, lifetimeYrs: 30,
    capexPerKw: 1500, opexFixedPerKwYr: 30, opexVarPerMwh: 8,
    hint: "Post-combustion or pre-combustion carbon capture unit attached to a power plant or industrial facility.",
  },
  OEO_00240011: {
    label: "Biomass CHP",
    domain: "conversion",
    inputs:  ["biomass"],
    outputs: ["electricity", "heat"],
    efficiencyPct: 85, co2GPerKwh: 230, lifetimeYrs: 25,
    capexPerKw: 2500, opexFixedPerKwYr: 55, opexVarPerMwh: 6,
    hint: "Combined heat and power plant burning solid biomass. Total fuel utilisation up to 90%.",
  },
  OEO_00000420: {
    label: "Heat Network Substation",
    domain: "conversion",
    inputs:  ["heat"],
    outputs: ["heat"],
    efficiencyPct: 95, co2GPerKwh: 0, lifetimeYrs: 30,
    capexPerKw: 300, opexFixedPerKwYr: 6, opexVarPerMwh: 0.5,
    hint: "District heating substation and heat exchanger transferring heat from network to building systems.",
  },
  OEO_00330010: {
    label: "Haber-Bosch Process",
    domain: "conversion",
    inputs:  ["hydrogen"],
    outputs: ["ammonia"],
    efficiencyPct: 65, co2GPerKwh: 0, lifetimeYrs: 30,
    capexPerKw: 1800, opexFixedPerKwYr: 35, opexVarPerMwh: 5,
    hint: "Catalytic nitrogen fixation to produce green ammonia from electrolytic hydrogen and air-separated nitrogen.",
  },
};

/** Extract the short OEO numeric ID from a full URI or return the string as-is. */
export function getOeoId(raw: string): string {
  const match = raw.match(/(OEO_\d+)/);
  return match ? match[1] : raw;
}

/** Human-readable label: looks up OEO_META first; falls back to ID formatting. */
export function shortLabel(raw: string): string {
  const id = getOeoId(raw);
  if (OEO_META[id]) return OEO_META[id].label;
  // Fallback: clean up enum strings like "solar_irradiance"
  return id
    .replace(/^OEO_\d+$/, id)          // keep raw OEO code if unknown
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Domain for a given OEO class; falls back to 'conversion'. */
export function getDomain(raw: string): "generation" | "storage" | "transmission" | "conversion" {
  const id = getOeoId(raw);
  return OEO_META[id]?.domain ?? "conversion";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let nodeCounter = 1;

// Carrier → accent color mapping used by nodes and handle dots
export const CARRIER_COLORS: Record<string, string> = {
  electricity:      "#eab308",
  natural_gas:      "#f97316",
  hydrogen:         "#06b6d4",
  heat:             "#ef4444",
  cooling:          "#3b82f6",
  steam:            "#8b5cf6",
  oil:              "#92400e",
  coal:             "#44403c",
  biomass:          "#16a34a",
  biogas:           "#65a30d",
  syngas:           "#d97706",
  water:            "#0ea5e9",
  co2:              "#71717a",
  ammonia:          "#a21caf",
  wind:             "#10b981",
  solar_irradiance: "#f59e0b",
  nuclear_fuel:     "#7c3aed",
};

// ── Store factory ─────────────────────────────────────────────────────────────

export const useTechBuilderStore = create<TechBuilderState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  canvasWarning: null,

  // ── React Flow wired handlers ─────────────────────────────────────────────

  onNodesChange: (changes) =>
    set({ nodes: applyNodeChanges(changes, get().nodes) }),

  onEdgesChange: (changes) =>
    set({ edges: applyEdgeChanges(changes, get().edges) }),

  onConnect: (connection) =>
    set({
      edges: addEdge(
        {
          ...connection,
          animated: true,
          style: { stroke: "#6366f1", strokeWidth: 2 },
          labelStyle: { fill: "#6366f1", fontWeight: 600 },
        },
        get().edges
      ),
    }),

  // ── Domain actions ────────────────────────────────────────────────────────

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  setCanvasWarning: (w) => set({ canvasWarning: w }),

  updateNodeData: (id, patch) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
      ),
    }),

  updateCarrierNode: (id, patch) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
      ),
    }),

  addEquipmentNode: (oeoClass, _domain, position) => {
    // ── Enforce single technology node ──────────────────────────────────────
    const existingTech = get().nodes.find((n) => n.type === "techNode");
    if (existingTech) {
      set({
        canvasWarning: "Only one technology per canvas. Clear it first to add a different one.",
        selectedNodeId: existingTech.id,
      });
      return;
    }

    const techId  = `tech-${nodeCounter++}`;
    const oeoId   = getOeoId(oeoClass);
    const meta    = OEO_META[oeoId];
    const label   = meta?.label ?? shortLabel(oeoClass);
    const domain  = meta?.domain ?? "conversion";

    const rawInputs  = meta?.inputs  ?? (domain === "generation" ? ["solar_irradiance"] : ["electricity"]);
    const rawOutputs = meta?.outputs ?? ["electricity"];

    // ── Carrier nodes + edges ────────────────────────────────────────────────
    const carrierNodes: Node[] = [];
    const carrierEdges: Edge[] = [];

    rawInputs.forEach((carrier, i) => {
      const cid     = `carrier-in-${nodeCounter++}`;
      const yOffset = (i - (rawInputs.length - 1) / 2) * 130;
      carrierNodes.push({
        id: cid,
        type: "carrierNode",
        position: { x: position.x - 240, y: position.y + yOffset },
        data: {
          carrier,
          direction: "input",
          label: carrier.replace(/_/g, " "),
          flowRateKw: 0,
          temperatureC: null,
          pressureBar: null,
          qualityNote: "",
        },
      });
      carrierEdges.push({
        id: `edge-${cid}-${techId}`,
        source: cid,
        target: techId,
        animated: true,
        style: { stroke: CARRIER_COLORS[carrier] ?? "#6366f1", strokeWidth: 2.5 },
      });
    });

    rawOutputs.forEach((carrier, i) => {
      const cid     = `carrier-out-${nodeCounter++}`;
      const yOffset = (i - (rawOutputs.length - 1) / 2) * 130;
      carrierNodes.push({
        id: cid,
        type: "carrierNode",
        position: { x: position.x + 270, y: position.y + yOffset },
        data: {
          carrier,
          direction: "output",
          label: carrier.replace(/_/g, " "),
          flowRateKw: 0,
          temperatureC: null,
          pressureBar: null,
          qualityNote: "",
        },
      });
      carrierEdges.push({
        id: `edge-${techId}-${cid}`,
        source: techId,
        target: cid,
        animated: true,
        style: { stroke: CARRIER_COLORS[carrier] ?? "#6366f1", strokeWidth: 2.5 },
      });
    });

    // ── Tech node (centre) ──────────────────────────────────────────────────
    const techNode: Node = {
      id: techId,
      type: "techNode",
      position,
      data: {
        label,
        oeoClass,
        domain,
        description: meta?.hint ?? "",
        variantName: `${label} — 2024 Reference`,
        referenceSource: "",
        // Keep inputPorts/outputPorts for submission payload
        inputPorts:  rawInputs.map((c, idx) => ({ id: `${techId}-in-${idx}`, carrier: c })),
        outputPorts: rawOutputs.map((c, idx) => ({ id: `${techId}-out-${idx}`, carrier: c })),
        efficiencyPercent:   meta?.efficiencyPct     ?? 85,
        co2FactorGPerKwh:    meta?.co2GPerKwh        ?? 0,
        lifetimeYears:       meta?.lifetimeYrs       ?? 25,
        capexUsdPerKw:       meta?.capexPerKw        ?? 0,
        opexFixedUsdPerKwYr: meta?.opexFixedPerKwYr  ?? 0,
        opexVarUsdPerMwh:    meta?.opexVarPerMwh     ?? 0,
      },
    };

    set({
      nodes:          [...get().nodes, ...carrierNodes, techNode],
      edges:          [...get().edges, ...carrierEdges],
      selectedNodeId: techId,
      canvasWarning:  null,
    });
  },

  clearGraph: () => set({ nodes: [], edges: [], selectedNodeId: null, canvasWarning: null }),
}));

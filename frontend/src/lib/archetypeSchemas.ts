/**
 * lib/archetypeSchemas.ts
 * ────────────────────────
 * Config-driven archetype registry.
 *
 * Each archetype covers one physics family (e.g. "gas_turbine" covers CCGT,
 * OCGT, and ICE — same Brayton-cycle / heat-rate derivation).
 *
 * Adding a new archetype:
 *   1. Add math to archetypeFormulas.ts
 *   2. Add an entry to ARCHETYPE_SCHEMAS below
 *   3. Map the relevant OEO short IDs in OEO_TO_ARCHETYPE
 *
 * First-release archetypes: gas_turbine | heat_pump | solar_pv | electrolyzer
 */

import {
  deriveGasTurbine,
  deriveHeatPump,
  deriveSolarPV,
  deriveElectrolyzer,
  deriveSteamCycle,
  deriveNuclear,
  deriveWindTurbine,
  deriveBatteryStorage,
} from "./archetypeFormulas";

// ── Shared types ──────────────────────────────────────────────────────────────

/** A slider input field shown in the Physics Model panel section. */
export interface ArchetypeSlider {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  /** Short helper text shown below the slider. */
  description?: string;
  /** Technical definition shown in a hover tooltip next to the label. */
  tooltip?: string;
  /** Quick-pick preset values rendered as clickable chips below the slider. */
  presets?: { label: string; value: number }[];
}

/** A select (dropdown) input shown in the Physics Model panel section. */
export interface ArchetypeSelect {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  defaultValue: string;
  description?: string;
  /** Technical definition shown in a hover tooltip next to the label. */
  tooltip?: string;
}

/** A derived-value badge displayed after inputs. */
export interface DerivedBadge {
  /** Short metric label (e.g. "COP", "η_el"). */
  label: string;
  /** Computed value — number or pre-formatted string. */
  value: number | string;
  unit: string;
  /** Tooltip / explanation text. */
  description?: string;
  /** Optional colour accent: "green" (default) | "blue" | "amber". */
  accent?: "green" | "blue" | "amber";
}

/** Result of a derivation call — written back to TechNodeData. */
export interface DeriveResult {
  efficiencyPercent: number;
  co2FactorGPerKwh: number;
  badges: DerivedBadge[];
}

/**
 * An input field shown on the CARRIER NODE panel when connected to this archetype.
 * Each field id must also appear as a slider in the archetype so values are shared.
 */
export interface ArchetypeCarrierField {
  /** Must match a slider id in the same archetype (shares archetypeInputValues key). */
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  description?: string;
  /** Technical definition shown in a hover tooltip next to the label. */
  tooltip?: string;
  /** Quick-pick preset values rendered as clickable chips below the slider. */
  presets?: { label: string; value: number }[];
}

/** Complete description of one technology archetype. */
export interface ArchetypeSchema {
  archetypeKey: string;
  /** Human label for the physics model section header. */
  label: string;
  /** Material Symbol icon name. */
  icon: string;
  /** One-line description of what the model computes. */
  description: string;
  sliders: ArchetypeSlider[];
  selects?: ArchetypeSelect[];
  /**
   * Pure function: input values → derived technical outputs.
   * Called on every slider/select change; result is written to the Zustand node.
   */
  derive: (values: Record<string, number | string>) => DeriveResult;

  // ── Carrier-node awareness ──────────────────────────────────────────────
  /** Renamed label for the primary input flow rate field on the carrier panel. */
  inputCarrierFlowLabel: string;
  /** Unit string for the primary input flow rate (e.g. "kW_th", "kW_el", "kWp"). */
  inputCarrierFlowUnit: string;
  /**
   * Extra input fields shown on the INPUT carrier node panel.
   * Each id must also appear as a slider so both panels share archetypeInputValues.
   */
  inputCarrierFields?: ArchetypeCarrierField[];
  /**
   * Derive output flow rates from input flow + current archetype input values.
   * Returns a map keyed by output carrier name (e.g. "electricity", "heat", "hydrogen").
   * One entry per expected output carrier.
   */
  deriveOutputFlowKw: (inputFlowKw: number, values: Record<string, number | string>) => Record<string, number>;
}

/**
 * Build a default-values map from an archetype's sliders and selects.
 * Used both for initializing the store and for computing derived values when
 * archetypeInputValues is not yet fully populated.
 */
export function getDefaultValues(archetype: ArchetypeSchema): Record<string, number | string> {
  const defaults: Record<string, number | string> = {};
  archetype.sliders.forEach((s) => { defaults[s.id] = s.defaultValue; });
  archetype.selects?.forEach((s) => { defaults[s.id] = s.defaultValue; });
  return defaults;
}

// ── OEO class → archetype key mapping ────────────────────────────────────────
// Key = short OEO ID (last path segment of the full URI).

export const OEO_TO_ARCHETYPE: Record<string, string> = {
  // Gas turbines / combustion engines
  OEO_00000184: "gas_turbine",  // CCGT, OCGT, ICE
  OEO_00000004: "gas_turbine",  // Biogas combustion engine (same Brayton/Otto cycle)

  // Heat pumps (same OEO class covers both ASHP and GSHP — subtype selects correct correction)
  OEO_00000009: "heat_pump",

  // Solar PV (all variants use same irradiance→yield model)
  OEO_00000165: "solar_pv",   // Utility-scale
  OEO_00000361: "solar_pv",   // Distributed / balcony

  // Electrolyzers (AWE, PEM, SOEC — same electrochemical model, different voltage range)
  OEO_00010021: "electrolyzer",

  // Solid-fuel Rankine steam cycle (biomass, coal, waste)
  OEO_00000036: "biomass_steam",  // Biomass Power Plant (condensing)
  OEO_00000440: "biomass_steam",  // Waste-to-Energy
  OEO_00240011: "biomass_steam",  // Biomass CHP (back-pressure default)
  OEO_00000089: "biomass_steam",  // Coal Power Plant

  // Nuclear thermal cycle
  OEO_00000303: "nuclear",

  // Wind turbines (onshore and offshore — same CF model, different defaults)
  OEO_00000311: "wind_turbine",  // Onshore wind
  OEO_00000308: "wind_turbine",  // Offshore floating wind

  // Battery storage (all chemistries — same RTE model, different default ranges)
  OEO_00000248: "battery_storage",  // Lithium-ion
  OEO_00000169: "battery_storage",  // Vanadium redox flow
  OEO_00000377: "battery_storage",  // Sodium-sulfur (NaS)
  OEO_00280014: "battery_storage",  // Lead-acid
};

// ── Archetype definitions ─────────────────────────────────────────────────────

export const ARCHETYPE_SCHEMAS: Record<string, ArchetypeSchema> = {

  // ── Gas Turbine / ICE ───────────────────────────────────────────────────────
  gas_turbine: {
    archetypeKey: "gas_turbine",
    label:       "Gas Turbine / Combustion Engine",
    icon:        "local_fire_department",
    description: "Enter net electrical efficiency (LHV) and fuel type → CO₂ factor and heat rate are derived automatically.",
    inputCarrierFlowLabel: "Fuel Thermal Power Input",
    inputCarrierFlowUnit:  "kW_th",
    // No extra carrier-level fields — η_el and fuel type are system design choices, not stream properties.
    deriveOutputFlowKw(inputFlowKw, values) {
      const eta = Number(values.electricalEfficiencyPct ?? 42) / 100;
      return { electricity: parseFloat((inputFlowKw * eta).toFixed(1)) };
    },
    sliders: [
      {
        id:           "electricalEfficiencyPct",
        label:        "Net Electrical Efficiency (η_el)",
        unit:         "%",
        min:          25,
        max:          65,
        step:         0.5,
        defaultValue: 42,
        description:  "LHV basis. CCGT: 50–60 % · OCGT: 35–42 % · ICE: 38–46 %",
        tooltip:      "Net LHV efficiency = electricity out / fuel heat input. LHV excludes condensation heat in exhaust. Each +1 % point saves ~5 g CO₂/kWh_el when burning natural gas. CCGT recovers waste heat in a secondary steam cycle, reaching 55–60 %.",
        presets: [
          { label: "OCGT 38 %",  value: 38 },
          { label: "ICE 43 %",   value: 43 },
          { label: "CCGT 57 %",  value: 57 },
        ],
      },
    ],
    selects: [
      {
        id:           "fuelType",
        label:        "Fuel Type",
        options: [
          { value: "natural_gas", label: "Natural Gas (202 gCO₂/kWh_th)" },
          { value: "hydrogen",    label: "Green Hydrogen (0 gCO₂/kWh_th)" },
          { value: "biomethane",  label: "Biomethane (0 gCO₂/kWh_th, biogenic)" },
        ],
        defaultValue: "natural_gas",
        description:  "Sets operational CO₂ emission factor (IPCC AR5 combustion factors)",
        tooltip:      "Determines the stack CO₂ intensity. Green H₂ and biomethane emit zero CO₂ at combustion; upstream lifecycle emissions are modelled separately. Switching from natural gas to green H₂ reduces the CO₂ factor from ~480 to 0 g/kWh_el.",
      },
    ],
    derive(values) {
      const r = deriveGasTurbine({
        electricalEfficiencyPct: Number(values.electricalEfficiencyPct),
        fuelType: values.fuelType as "natural_gas" | "hydrogen" | "biomethane",
      });
      return {
        efficiencyPercent: r.efficiencyPercent,
        co2FactorGPerKwh:  r.co2FactorGPerKwh,
        badges: [
          { label: "η_el",      value: `${r.efficiencyPercent.toFixed(1)} %`, unit: "",            accent: "green", description: "Net electrical efficiency (LHV)" },
          { label: "Heat Rate", value: r.heatRateKjPerKwh,                   unit: "kJ/kWh_el",   accent: "blue",  description: "Thermal input per kWh output (= 3600 / η_el)" },
          { label: "CO₂",       value: r.co2FactorGPerKwh,                   unit: "g/kWh_el",    accent: values.fuelType === "natural_gas" ? "amber" : "green", description: "Operational CO₂ emission factor" },
        ],
      };
    },
  },

  // ── Heat Pump ───────────────────────────────────────────────────────────────
  heat_pump: {
    archetypeKey: "heat_pump",
    label:       "Heat Pump",
    icon:        "heat",
    description: "Enter source/sink temperatures → COP derived via Carnot efficiency × real-machine correction (EN 14511).",
    inputCarrierFlowLabel: "Electrical Power Input",
    inputCarrierFlowUnit:  "kW_el",
    // tSourceC appears on the INPUT carrier panel — it's a property of the source energy stream.
    inputCarrierFields: [
      {
        id:           "tSourceC",
        label:        "Source Temperature (T_source)",
        unit:         "°C",
        min:          -15,
        max:          25,
        step:         1,
        defaultValue: 7,
        description:  "Ambient air (ASHP) or ground temperature (GSHP). Primary driver of COP.",
        tooltip:      "Temperature of the low-grade heat source. Higher temperature → better COP. ASHP outdoor air: −15 to 15 °C; GSHP borehole ground stays at 8–12 °C year-round for consistent performance.",
        presets: [
          { label: "Winter −7 °C",  value: -7  },
          { label: "Spring 7 °C",   value:  7  },
          { label: "Ground 10 °C",  value: 10  },
        ],
      },
    ],
    deriveOutputFlowKw(inputFlowKw, values) {
      const r = deriveHeatPump({
        tSourceC: Number(values.tSourceC ?? 7),
        tSinkC:   Number(values.tSinkC   ?? 55),
        subtype:  (values.subtype as "ashp" | "gshp") ?? "ashp",
      });
      return { heat: parseFloat((inputFlowKw * r.cop).toFixed(1)) };
    },
    sliders: [
      {
        id:           "tSourceC",
        label:        "Source Temperature (T_source)",
        unit:         "°C",
        min:          -15,
        max:          25,
        step:         1,
        defaultValue: 7,
        description:  "Outdoor air (ASHP) or ground temperature (GSHP). Affects COP strongly.",
        tooltip:      "Temperature of the heat source medium. Higher source temp → smaller temperature lift → better COP. ASHP outdoor air ranges −15 to 20 °C seasonally; GSHP borehole stays near 10 °C year-round for more consistent performance.",
        presets: [
          { label: "Winter −7 °C",  value: -7  },
          { label: "Spring 7 °C",   value:  7  },
          { label: "Ground 10 °C",  value: 10  },
        ],
      },
      {
        id:           "tSinkC",
        label:        "Sink Temperature (T_sink)",
        unit:         "°C",
        min:          30,
        max:          90,
        step:         1,
        defaultValue: 55,
        description:  "Heat distribution system: floor heating 35–45 °C · radiators 55–70 °C · DHW 60–70 °C",
        tooltip:      "Supply temperature delivered to the heat emitter circuit. Each 5 °C reduction in sink temperature improves COP by ~10 %. Underfloor heating (35–45 °C) is optimal; high-temp radiators or DHW pre-heat (65 °C) significantly reduces efficiency.",
        presets: [
          { label: "Floor 35 °C",    value: 35 },
          { label: "Radiator 55 °C", value: 55 },
          { label: "DHW 65 °C",      value: 65 },
        ],
      },
    ],
    selects: [
      {
        id:           "subtype",
        label:        "Heat Pump Type",
        options: [
          { value: "ashp", label: "Air-Source (ASHP) — correction factor 0.45" },
          { value: "gshp", label: "Ground-Source (GSHP) — correction factor 0.50" },
        ],
        defaultValue: "ashp",
        description:  "Carnot correction factor from field data (Staffell et al. 2012)",
        tooltip:      "Sets the exergetic (Carnot) correction factor. ASHP (0.45) extracts heat from outdoor air — cheaper to install but COP varies with weather. GSHP (0.50) uses stable ground temperature via boreholes — ~11 % higher average COP, higher upfront cost.",
      },
    ],
    derive(values) {
      const r = deriveHeatPump({
        tSourceC: Number(values.tSourceC),
        tSinkC:   Number(values.tSinkC),
        subtype:  values.subtype as "ashp" | "gshp",
      });
      return {
        efficiencyPercent: r.efficiencyPercent,
        co2FactorGPerKwh:  0,
        badges: [
          { label: "COP",         value: r.cop.toFixed(2),        unit: "",          accent: "green", description: "Coefficient of Performance (heat out / electricity in)" },
          { label: "COP_Carnot",  value: r.copCarnot.toFixed(2),  unit: "",          accent: "blue",  description: "Theoretical maximum COP (reversible heat pump)" },
          { label: "η stored as", value: `${r.efficiencyPercent} %`, unit: "(COP×100)", accent: "blue",  description: "COP × 100 — stored as efficiencyPercent for modelling" },
        ],
      };
    },
  },

  // ── Solar PV ────────────────────────────────────────────────────────────────
  solar_pv: {
    archetypeKey: "solar_pv",
    label:       "Solar PV",
    icon:        "wb_sunny",
    description: "Enter module efficiency, system losses, and peak sun hours → AC efficiency, specific yield, and capacity factor.",
    // flowRateKw on the solar input carrier = installed capacity (kWp), not a power flow.
    inputCarrierFlowLabel: "Installed Capacity",
    inputCarrierFlowUnit:  "kWp",
    deriveOutputFlowKw(inputFlowKw, values) {
      const r = deriveSolarPV({
        moduleEfficiencyPct:  Number(values.moduleEfficiencyPct  ?? 21),
        systemLossesPct:      Number(values.systemLossesPct      ?? 14),
        peakSunHoursPerDay:   Number(values.peakSunHoursPerDay   ?? 4.5),
      });
      // Average power output = capacity × capacity factor
      return { electricity: parseFloat((inputFlowKw * r.capacityFactorPct / 100).toFixed(1)) };
    },
    sliders: [
      {
        id:           "moduleEfficiencyPct",
        label:        "Module Efficiency",
        unit:         "%",
        min:          12,
        max:          28,
        step:         0.5,
        defaultValue: 21,
        description:  "STC efficiency. Mono-Si: 18–23 % · HJT: 22–25 % · Thin-film (CdTe/CIGS): 12–18 %",
        tooltip:      "DC power output per module area at Standard Test Conditions (1000 W/m², 25 °C cell, AM1.5 spectrum). Higher efficiency = smaller array footprint per kWp. Does not change energy yield per kWp — that depends on site irradiation and system losses.",
        presets: [
          { label: "Thin-film 14 %", value: 14 },
          { label: "Mono-Si 21 %",   value: 21 },
          { label: "HJT 24 %",       value: 24 },
        ],
      },
      {
        id:           "systemLossesPct",
        label:        "System Losses",
        unit:         "%",
        min:          5,
        max:          30,
        step:         1,
        defaultValue: 14,
        description:  "Wiring, inverter, soiling, mismatch, shading, temperature. PR = 1 − losses. Typical: 10–20 %",
        tooltip:      "Total losses from module DC output to grid AC delivery: inverter ~3 %, DC cables ~1 %, soiling ~2 %, temperature derating ~3 %, mismatch, shading. Performance Ratio = 1 − losses/100. Utility-scale PR: 0.78–0.85.",
        presets: [
          { label: "Optimal 10 %", value: 10 },
          { label: "Typical 14 %", value: 14 },
          { label: "Rooftop 18 %", value: 18 },
        ],
      },
      {
        id:           "peakSunHoursPerDay",
        label:        "Peak Sun Hours",
        unit:         "h/day",
        min:          2.5,
        max:          7.5,
        step:         0.1,
        defaultValue: 4.5,
        description:  "Annual average PSH. N. Europe: 2.5–3.5 · C. Europe: 3.5–4.5 · S. Europe / MENA: 5–7",
        tooltip:      "Annual global horizontal irradiation (kWh/m²/yr) ÷ 365, normalised to 1 kW/m². One PSH = 1 kWh/m²/day. Multiply by installed kWp to get expected daily energy yield (before inverter and cable losses).",
        presets: [
          { label: "N.Europe 2.8 h",  value: 2.8 },
          { label: "C.Europe 4.5 h",  value: 4.5 },
          { label: "MENA 6.5 h",      value: 6.5 },
        ],
      },
    ],
    derive(values) {
      const r = deriveSolarPV({
        moduleEfficiencyPct:    Number(values.moduleEfficiencyPct),
        systemLossesPct:        Number(values.systemLossesPct),
        peakSunHoursPerDay:     Number(values.peakSunHoursPerDay),
      });
      return {
        efficiencyPercent: r.efficiencyPercent,
        co2FactorGPerKwh:  0,
        badges: [
          { label: "AC Efficiency",    value: `${r.acEfficiencyPct.toFixed(1)} %`,          unit: "",              accent: "green", description: "Module efficiency × performance ratio" },
          { label: "Specific Yield",   value: r.specificYieldKwhPerKwpYr,                    unit: "kWh/kWp/yr",    accent: "blue",  description: "Annual energy per installed kWp" },
          { label: "Capacity Factor",  value: `${r.capacityFactorPct.toFixed(1)} %`,          unit: "",              accent: "amber", description: "Fraction of full-rated output averaged over a year" },
        ],
      };
    },
  },

  // ── Electrolyzer ────────────────────────────────────────────────────────────
  electrolyzer: {
    archetypeKey: "electrolyzer",
    label:       "Electrolyzer (Water Electrolysis)",
    icon:        "science",
    description: "Enter stack voltage and Faradaic efficiency → H₂ system efficiency derived from thermoneutral voltage (1.481 V).",
    inputCarrierFlowLabel: "Electrical Power Input",
    inputCarrierFlowUnit:  "kW_el",
    deriveOutputFlowKw(inputFlowKw, values) {
      const r = deriveElectrolyzer({
        stackVoltageV:        Number(values.stackVoltageV        ?? 1.75),
        faradicEfficiencyPct: Number(values.faradicEfficiencyPct ?? 98),
      });
      return { hydrogen: parseFloat((inputFlowKw * r.systemEfficiencyPct / 100).toFixed(1)) };
    },
    sliders: [
      {
        id:           "stackVoltageV",
        label:        "Stack Cell Voltage",
        unit:         "V/cell",
        min:          1.0,
        max:          2.2,
        step:         0.01,
        defaultValue: 1.75,
        description:  "Operating voltage per cell. AWE: 1.7–2.0 V · PEM: 1.6–2.0 V · SOEC (high-temp): 1.0–1.5 V",
        tooltip:      "Cell operating voltage at nominal current density. Thermoneutral voltage = 1.481 V (no heat exchange). Above it → exothermic operation (needs cooling). Below (SOEC) → endothermic (heat input needed). Lower voltage = higher electrical efficiency but lower H₂ throughput per cm² of electrode.",
        presets: [
          { label: "SOEC 1.30 V", value: 1.30 },
          { label: "PEM 1.75 V",  value: 1.75 },
          { label: "AWE 1.85 V",  value: 1.85 },
        ],
      },
      {
        id:           "faradicEfficiencyPct",
        label:        "Faradaic Efficiency",
        unit:         "%",
        min:          85,
        max:          100,
        step:         0.5,
        defaultValue: 98,
        description:  "Fraction of charge that produces H₂. Losses from gas crossover and parasitic reactions.",
        tooltip:      "Fraction of electrical charge (coulombs) that actually reduces H₂O to H₂. Losses arise from H₂ crossover through the separator membrane, especially at low current density. Critical for H₂ purity, safety certification, and downstream purification cost.",
        presets: [
          { label: "Aged 96 %",        value: 96   },
          { label: "Standard 98 %",    value: 98   },
          { label: "Hi-purity 99.5 %", value: 99.5 },
        ],
      },
    ],
    derive(values) {
      const r = deriveElectrolyzer({
        stackVoltageV:        Number(values.stackVoltageV),
        faradicEfficiencyPct: Number(values.faradicEfficiencyPct),
      });
      return {
        efficiencyPercent: r.efficiencyPercent,
        co2FactorGPerKwh:  0,
        badges: [
          { label: "η_voltage",     value: `${r.voltageEfficiencyPct.toFixed(1)} %`,        unit: "",                  accent: "blue",  description: "V_thermoneutral / V_stack = 1.481 / V_cell" },
          { label: "η_system",      value: `${r.systemEfficiencyPct.toFixed(1)} %`,          unit: "",                  accent: "green", description: "Overall H₂ production efficiency (η_V × η_Faradaic)" },
          { label: "Spec. Energy",  value: r.specificEnergyKwhPerNm3.toFixed(2),             unit: "kWh_el/Nm³ H₂",    accent: "amber", description: "Electrical energy per Nm³ H₂ (HHV basis, IRENA 2020)" },
        ],
      };
    },
  },

  // ── Biomass / Solid-Fuel Steam Cycle ────────────────────────────────────────
  biomass_steam: {
    archetypeKey: "biomass_steam",
    label:       "Solid-Fuel Steam Cycle (Biomass / Coal / Waste)",
    icon:        "compost",
    description: "Combustion + Rankine cycle: set fuel type and sustainability claim → stack CO₂ (physical) and net CO₂ (after biogenic credit) are derived separately. Activate CHP mode to add a back-pressure heat output via the heat-to-power ratio.",
    inputCarrierFlowLabel: "Fuel Thermal Power Input",
    inputCarrierFlowUnit:  "kW_th",
    deriveOutputFlowKw(inputFlowKw, values) {
      const eta   = Number(values.electricalEfficiencyPct ?? 35) / 100;
      const alpha = values.operatingMode === "backpressure_chp"
        ? Number(values.heatToPowerRatio ?? 1.0)
        : 0;
      const elKw   = parseFloat((inputFlowKw * eta).toFixed(1));
      const heatKw = parseFloat((elKw * alpha).toFixed(1));
      return { electricity: elKw, heat: heatKw };
    },
    sliders: [
      {
        id:           "electricalEfficiencyPct",
        label:        "Net Electrical Efficiency (η_el)",
        unit:         "%",
        min:          18,
        max:          48,
        step:         0.5,
        defaultValue: 35,
        description:  "LHV basis. Biomass: 25–35 % · Coal: 35–45 % · MSW/WtE: 18–28 %",
        tooltip:      "Net LHV electrical efficiency of the steam turbine cycle. Biomass plants typically reach 25–35 % due to lower steam temperatures vs coal. CHP back-pressure mode trades electrical efficiency for heat output — total fuel utilisation can reach 80–90 %.",
        presets: [
          { label: "WtE 22 %",       value: 22 },
          { label: "Biomass 32 %",   value: 32 },
          { label: "Coal SCPC 42 %", value: 42 },
        ],
      },
      {
        id:           "heatToPowerRatio",
        label:        "Heat-to-Power Ratio (α)",
        unit:         "kW_th / kW_el",
        min:          0.2,
        max:          3.0,
        step:         0.1,
        defaultValue: 1.0,
        description:  "α = Q_heat / P_el. Only active in CHP back-pressure mode. Typical range: 0.5–2.5.",
        tooltip:      "Ratio of thermal heat output to net electrical output. In back-pressure CHP, low-pressure steam extraction provides district heat or industrial process heat. Higher α = more heat, less electricity from the same fuel. Total fuel utilisation = η_el × (1 + α).",
        presets: [
          { label: "Low α 0.5",   value: 0.5 },
          { label: "Typical 1.0", value: 1.0 },
          { label: "High α 2.0",  value: 2.0 },
        ],
      },
      {
        id:           "boilerEfficiencyPct",
        label:        "Boiler / Combustion Efficiency (η_boiler)",
        unit:         "%",
        min:          75,
        max:          96,
        step:         0.5,
        defaultValue: 88,
        description:  "Fuel LHV → steam energy. Grate stoker: 82–88 % · Fluidised bed (CFB): 86–92 % · Pellet boiler: 88–94 %",
        tooltip:      "Fraction of fuel lower heating value converted to useful steam. Main losses: dry flue gas sensible heat (~5–8 %), moisture in flue gas (~2–4 %), unburned carbon in ash (<1 % for CFB). Stack temperature, excess air (λ), and fuel moisture are the primary drivers. CFB boilers reach higher efficiency at partial load than grate stokers due to better burn-out.",
        presets: [
          { label: "Grate stoker 84 %", value: 84 },
          { label: "CFB 90 %",          value: 90 },
          { label: "Pellet boiler 93 %", value: 93 },
        ],
      },
      {
        id:           "auxiliaryConsumptionPct",
        label:        "Plant Auxiliary Consumption (Eigenverbrauch)",
        unit:         "%",
        min:          2,
        max:          12,
        step:         0.5,
        defaultValue: 5,
        description:  "Internal electricity use for pumps, fans, fuel handling, controls. Gross − auxiliary = net grid output.",
        tooltip:      "Self-consumption of the plant's own electrical generation before grid export. Includes: induced-draft fans (1.5–2 %), forced-draft fans (0.5–1 %), feed-water pumps (0.5–1 %), fuel conveyors and ash handling (0.5–1 %), instrumentation and lighting (0.3–0.5 %). WtE and CFB plants typically have higher auxiliary loads (6–10 %) than simple stoker grates (3–5 %).",
        presets: [
          { label: "Simple stoker 4 %", value: 4 },
          { label: "CFB / WtE 7 %",     value: 7 },
          { label: "High aux 10 %",      value: 10 },
        ],
      },
      {
        id:           "fullLoadHoursPerYr",
        label:        "Annual Full-Load Hours",
        unit:         "h/yr",
        min:          3000,
        max:          8760,
        step:         100,
        defaultValue: 7000,
        description:  "Operating hours at rated power. District heat baseload: 7000–8000 h · Industrial CHP: 6000–8000 h · Grid peaking: 3000–5000 h",
        tooltip:      "Number of hours per year the plant operates at rated thermal input. Biomass baseload plants with district heating connections typically achieve 7000–8500 h/yr. Plants with seasonal fuel constraints or used for grid balancing see fewer hours. Annual energy = rated capacity × FLH.",
        presets: [
          { label: "Grid peak 4000 h",  value: 4000 },
          { label: "Industrial 7000 h", value: 7000 },
          { label: "Baseload 8000 h",   value: 8000 },
        ],
      },
    ],
    selects: [
      {
        id:           "fuelType",
        label:        "Fuel Type",
        options: [
          { value: "wood_chips",   label: "Wood Chips  (stack ~994 gCO₂/kWh_el, biogenic)" },
          { value: "wood_pellets", label: "Wood Pellets (stack ~991 gCO₂/kWh_el, biogenic)" },
          { value: "straw",        label: "Straw / Agri-Residue (stack ~966 gCO₂/kWh_el, biogenic)" },
          { value: "msw_mixed",    label: "Municipal Solid Waste — mixed (~150 gCO₂/kWh_el net)" },
          { value: "coal",         label: "Bituminous Coal (~839 gCO₂/kWh_el net, fossil)" },
        ],
        defaultValue: "wood_chips",
        description:  "Sets combustion CO₂ factors. Biogenic fuels (wood, straw) emit CO₂ at stack but it is net-zero when sustainably sourced.",
        tooltip:      "Physical CO₂ at the chimney is HIGHER for biomass than coal (~994 vs ~853 g/kWh_el at η=35 %) because wood has lower energy density. However, this CO₂ is biogenic — recently photosynthesised from the atmosphere — so it is net-zero in GHG inventories when sustainably sourced (IPCC AFOLU, EU RED II). Only supply-chain transport and processing (15–28 g/kWh_el) remains as net CO₂. Coal emits full fossil CO₂ with no credit. MSW counts only the fossil fraction (~40 % of mixed waste).",
      },
      {
        id:           "sustainabilityClaim",
        label:        "Biomass Sustainability Claim",
        options: [
          { value: "sustainable",   label: "Certified sustainable (IPCC AFOLU / EU RED II)" },
          { value: "unsustainable", label: "Uncertified / unsustainably sourced" },
        ],
        defaultValue: "sustainable",
        description:  "Only affects biogenic fuels (wood, straw). Uncertified sourcing removes the biogenic CO₂ credit, treating stack CO₂ as fully reportable.",
        tooltip:      "Under EU RED II and IPCC AFOLU methodology, biogenic CO₂ from sustainably managed forests or agricultural residues is counted as zero in national GHG inventories. If sourcing is uncertified — e.g. from old-growth forest clearance — the full stack CO₂ (~990 g/kWh_el) is counted. Setting has no effect for coal or MSW which follow fossil and mixed-fraction rules respectively.",
      },
      {
        id:           "operatingMode",
        label:        "Operating Mode",
        options: [
          { value: "condensing",       label: "Condensing — electricity only" },
          { value: "backpressure_chp", label: "Back-Pressure CHP — electricity + heat" },
        ],
        defaultValue: "condensing",
        description:  "Back-pressure CHP adds a heat output; total fuel utilisation rises to 70–90 %.",
        tooltip:      "Condensing turbines exhaust steam near vacuum pressure, maximising electricity but rejecting all heat to a cooling tower. Back-pressure turbines exhaust at elevated pressure to a heat exchanger, delivering district heat or industrial process steam at the cost of reduced electrical output. CHP can roughly double the total useful energy extracted from the same fuel input.",
      },
    ],
    derive(values) {
      const lhvOverride      = values.lhvMJPerKg      ? Number(values.lhvMJPerKg)      : undefined;
      const ch4Override      = values.ch4Percent      ? Number(values.ch4Percent)      : undefined;
      const moistureOverride = values.moisturePercent ? Number(values.moisturePercent) : undefined;
      const r = deriveSteamCycle({
        electricalEfficiencyPct: Number(values.electricalEfficiencyPct),
        operatingMode:           values.operatingMode as "condensing" | "backpressure_chp",
        heatToPowerRatio:        Number(values.heatToPowerRatio),
        fuelType:                values.fuelType as "wood_chips" | "wood_pellets" | "straw" | "msw_mixed" | "coal",
        sustainabilityClaim:     ((values.sustainabilityClaim ?? "sustainable") as "sustainable" | "unsustainable"),
        lhvMJPerKg:              lhvOverride,
        ch4Percent:              ch4Override,
        moisturePercent:         moistureOverride,
        boilerEfficiencyPct:     Number(values.boilerEfficiencyPct    ?? 88),
        auxiliaryConsumptionPct: Number(values.auxiliaryConsumptionPct ?? 5),
        fullLoadHoursPerYr:      Number(values.fullLoadHoursPerYr      ?? 7000),
      });
      const isCoal = values.fuelType === "coal";
      const isMsw  = values.fuelType === "msw_mixed";
      const isBiogenicSustainable = !isCoal && !isMsw && (values.sustainabilityClaim ?? "sustainable") !== "unsustainable";
      const badges: DerivedBadge[] = [
        {
          label: "η_el", value: `${r.efficiencyPercent.toFixed(1)} %`, unit: "",
          accent: "green", description: "Net electrical efficiency (LHV basis)",
        },
        {
          label: "Heat Rate", value: r.heatRateKjPerKwh, unit: "kJ/kWh_el",
          accent: "blue", description: "Thermal fuel input per kWh electricity (= 3600 / η_el)",
        },
        {
          label: "Stack CO₂", value: r.stackCo2GPerKwhEl, unit: "g/kWh_el",
          accent: isCoal ? "amber" : "blue",
          description: "Physical CO₂ at chimney — includes biogenic CO₂ for wood/straw (not fossil)",
        },
        {
          label: "Net CO₂", value: r.netCo2GPerKwhEl, unit: "g/kWh_el",
          accent: (isCoal || isMsw || !isBiogenicSustainable) ? "amber" : "green",
          description: isBiogenicSustainable
            ? "Net lifecycle CO₂ — supply-chain only (biogenic credit applied, RED II)"
            : "Net lifecycle CO₂ — fossil or uncertified biogenic (full stack counted)",
        },
      ];
      if (r.specificFuelConsumptionKgPerMwhEl !== undefined) {
        badges.push({
          label: "Fuel Rate",
          value: r.specificFuelConsumptionKgPerMwhEl,
          unit:  "kg/MWh_el",
          accent: "blue",
          description: `Specific fuel consumption at LHV ${lhvOverride} MJ/kg and η_el ${r.efficiencyPercent.toFixed(1)} %`,
        });
      }
      if (r.volumetricEnergyMjPerNm3 !== undefined) {
        badges.push({
          label: "Gas Energy",
          value: r.volumetricEnergyMjPerNm3.toFixed(1),
          unit:  "MJ/Nm³",
          accent: "green",
          description: `Biogas volumetric energy density at ${ch4Override} vol-% CH₄`,
        });
      }
      // ── Efficiency chain decomposition ──────────────────────────────────────
      badges.push({
        label: "η_gross",
        value: `${r.grossElecEfficiencyPct.toFixed(1)} %`,
        unit:  "",
        accent: "blue",
        description: `Gross electrical efficiency before auxiliary consumption = η_net / (1 − ${Number(values.auxiliaryConsumptionPct ?? 5)} %)`,
      });
      badges.push({
        label: "η_boiler",
        value: `${Number(values.boilerEfficiencyPct ?? 88).toFixed(1)} %`,
        unit:  "",
        accent: "green",
        description: "Combustion & boiler efficiency — fuel LHV converted to steam thermal energy",
      });
      badges.push({
        label: "η_Rankine",
        value: `${r.rankineEfficiencyPct.toFixed(1)} %`,
        unit:  "",
        accent: "blue",
        description: `Rankine steam cycle efficiency = η_net / (η_boiler × (1 − η_aux)) — steam → gross electricity`,
      });
      badges.push({
        label: "Ann. Yield",
        value: r.annualSpecificYieldKwhPerKwTh,
        unit:  "kWh_el / kW_th / yr",
        accent: "green",
        description: `Annual electricity per rated thermal input kW at ${Number(values.fullLoadHoursPerYr ?? 7000).toLocaleString()} h/yr full-load hours`,
      });
      if (values.operatingMode === "backpressure_chp") {
        badges.push({ label: "η_heat",  value: `${r.heatEfficiencyPct.toFixed(1)} %`,       unit: "",             accent: "blue",  description: "Heat output efficiency = η_el × α" });
        badges.push({ label: "η_total", value: `${r.totalFuelUtilizationPct.toFixed(1)} %`, unit: "",             accent: "blue",  description: "Total fuel utilisation (electricity + heat)" });
        badges.push({ label: "α",       value: r.heatOutputPerElKw.toFixed(2),              unit: "kW_th/kW_el", accent: "green", description: "Heat output per unit of electrical output" });
      }
      return {
        efficiencyPercent: r.efficiencyPercent,
        co2FactorGPerKwh:  r.co2FactorGPerKwh,
        badges,
      };
    },
  },

  // ── Nuclear Power ──────────────────────────────────────────────────────────
  nuclear: {
    archetypeKey: "nuclear",
    label:       "Nuclear Power Plant",
    icon:        "energy_program_time_used",
    description: "Enter net thermal efficiency and capacity factor → heat rate and full-load hours derived. Lifecycle CO₂ fixed at 12 g/kWh_el (IPCC AR6 median).",
    inputCarrierFlowLabel: "Reactor Thermal Power",
    inputCarrierFlowUnit:  "kW_th",
    deriveOutputFlowKw(inputFlowKw, values) {
      const eta = Number(values.thermalEfficiencyPct ?? 33) / 100;
      return { electricity: parseFloat((inputFlowKw * eta).toFixed(1)) };
    },
    sliders: [
      {
        id:           "thermalEfficiencyPct",
        label:        "Net Thermal Efficiency (η_th)",
        unit:         "%",
        min:          28,
        max:          40,
        step:         0.5,
        defaultValue: 33,
        description:  "Net electrical output / reactor thermal power. PWR: 32–36 % · BWR: 30–34 % · CANDU: 29–33 % · SMR: 30–36 %",
        tooltip:      "Fraction of reactor thermal power converted to net electricity, after subtracting auxiliary loads (pumps, cooling, instrumentation). Limited by the temperature of the steam cycle — nuclear steam is typically 280–320 °C (much lower than coal), giving lower Rankine efficiency. Advanced HTGRs and Gen-IV designs can reach 45–48 %.",
        presets: [
          { label: "CANDU 31 %", value: 31 },
          { label: "PWR 33 %",   value: 33 },
          { label: "SMR 35 %",   value: 35 },
        ],
      },
      {
        id:           "capacityFactorPct",
        label:        "Capacity Factor (Annual)",
        unit:         "%",
        min:          60,
        max:          100,
        step:         1,
        defaultValue: 90,
        description:  "Fraction of maximum annual output actually delivered. Global LWR average: ~88 % (IAEA PRIS 2022).",
        tooltip:      "Ratio of actual annual energy output to the theoretical maximum (rated power × 8760 h). Nuclear plants achieve the highest capacity factors of any generator (~88 % globally) due to long refuelling cycles and few weather-driven curtailments. Refuelling outages typically 4–6 weeks every 18–24 months reduce this from 100 %.",
        presets: [
          { label: "Refuelling yr 75 %", value: 75 },
          { label: "Fleet avg 88 %",     value: 88 },
          { label: "Best-in-class 95 %", value: 95 },
        ],
      },
    ],
    selects: [
      {
        id:           "reactorType",
        label:        "Reactor Technology",
        options: [
          { value: "pwr",   label: "PWR — Pressurised Water Reactor" },
          { value: "bwr",   label: "BWR — Boiling Water Reactor" },
          { value: "candu", label: "CANDU — Pressurised Heavy Water" },
          { value: "smr",   label: "SMR — Small Modular Reactor (projected)" },
        ],
        defaultValue: "pwr",
        description:  "Informational — select to load typical efficiency presets for that design.",
        tooltip:      "PWR (most common globally, ~70 % of fleet) uses pressurised water as both coolant and moderator. BWR lets coolant boil in the reactor vessel. CANDU uses heavy water, enabling online refuelling. SMRs (< 300 MWe) are under construction or design — aim for factory modularisation and passive safety.",
      },
    ],
    derive(values) {
      const r = deriveNuclear({
        thermalEfficiencyPct: Number(values.thermalEfficiencyPct),
        capacityFactorPct:    Number(values.capacityFactorPct),
        reactorType:          values.reactorType as "pwr" | "bwr" | "smr" | "candu",
      });
      return {
        efficiencyPercent: r.efficiencyPercent,
        co2FactorGPerKwh:  r.co2FactorGPerKwh,
        badges: [
          { label: "η_th",          value: `${r.efficiencyPercent.toFixed(1)} %`,         unit: "",            accent: "green" as const, description: "Net thermal-to-electrical efficiency" },
          { label: "Heat Rate",     value: r.heatRateKjPerKwh,                            unit: "kJ/kWh_el",   accent: "blue"  as const, description: "Thermal reactor power per kWh electricity" },
          { label: "Full-load h",   value: r.fullLoadHoursPerYr,                          unit: "h/yr",        accent: "blue"  as const, description: "Annual full-load equivalent hours (CF × 8760)" },
          { label: "CO₂ (LCA)",     value: r.co2FactorGPerKwh,                            unit: "g/kWh_el",    accent: "green" as const, description: "Lifecycle CO₂ — IPCC AR6 WG3 median (construction + fuel + O&M)" },
        ],
      };
    },
  },

  // ── Wind Turbine ──────────────────────────────────────────────────────────
  wind_turbine: {
    archetypeKey: "wind_turbine",
    label:       "Wind Turbine",
    icon:        "air",
    description: "Enter gross capacity factor, availability, and wake losses → net CF, full-load hours, and specific yield derived.",
    inputCarrierFlowLabel: "Installed Capacity",
    inputCarrierFlowUnit:  "kW",
    deriveOutputFlowKw(inputFlowKw, values) {
      const r = deriveWindTurbine({
        grossCapacityFactorPct: Number(values.grossCapacityFactorPct ?? 38),
        availabilityPct:        Number(values.availabilityPct        ?? 97),
        wakeLossesPct:          Number(values.wakeLossesPct          ??  8),
      });
      return { electricity: parseFloat((inputFlowKw * r.netCapacityFactorPct / 100).toFixed(1)) };
    },
    sliders: [
      {
        id:           "grossCapacityFactorPct",
        label:        "Gross Capacity Factor",
        unit:         "%",
        min:          15,
        max:          65,
        step:         1,
        defaultValue: 38,
        description:  "Before availability and wake losses. IEC Class I (high wind): 42–55 % · Class II: 35–45 % · Class III: 28–38 %",
        tooltip:      "Ratio of actual energy production to rated power × 8760 h, before accounting for turbine downtime and array wake effects. Primarily driven by the annual mean wind speed at hub height. Use site-specific MERRA-2 or ERA5 data; PVGIS Wind can provide annual CF estimates for European sites.",
        presets: [
          { label: "Low wind 28 %",       value: 28 },
          { label: "Onshore avg 38 %",    value: 38 },
          { label: "Offshore 50 %",       value: 50 },
        ],
      },
      {
        id:           "availabilityPct",
        label:        "Technical Availability",
        unit:         "%",
        min:          90,
        max:          99,
        step:         0.5,
        defaultValue: 97,
        description:  "Turbine + balance-of-plant availability. Onshore: 96–98 % · Offshore: 93–97 % (IEC 61400-26).",
        tooltip:      "Fraction of time the turbine is technically available to produce power. Excludes weather-driven curtailments (grid, noise). Offshore availability is typically lower due to vessel access restrictions in high seas. Includes planned maintenance and unplanned repairs.",
        presets: [
          { label: "Offshore 94 %", value: 94 },
          { label: "Onshore 97 %",  value: 97 },
          { label: "New fleet 98 %", value: 98 },
        ],
      },
      {
        id:           "wakeLossesPct",
        label:        "Wake & Electrical Losses",
        unit:         "%",
        min:          2,
        max:          18,
        step:         0.5,
        defaultValue: 8,
        description:  "Array wake deficit + electrical collection losses. Onshore: 4–8 % · Offshore large array: 8–15 %.",
        tooltip:      "Turbines downstream extract energy from the wake of upstream turbines, reducing their output (velocity deficit + added turbulence). Electrical losses include HV cable and transformer ohmic losses. Combined offshore losses are typically 8–15 % for large arrays; onshore 4–8 %.",
        presets: [
          { label: "Single turbine 3 %", value: 3 },
          { label: "Onshore farm 7 %",   value: 7 },
          { label: "Offshore array 12 %", value: 12 },
        ],
      },
    ],
    derive(values) {
      const r = deriveWindTurbine({
        grossCapacityFactorPct: Number(values.grossCapacityFactorPct),
        availabilityPct:        Number(values.availabilityPct),
        wakeLossesPct:          Number(values.wakeLossesPct),
      });
      return {
        efficiencyPercent: r.efficiencyPercent,
        co2FactorGPerKwh:  0,
        badges: [
          { label: "Net CF",         value: `${r.netCapacityFactorPct.toFixed(1)} %`, unit: "",         accent: "green" as const, description: "Net capacity factor (gross CF × availability × (1 − wake losses))" },
          { label: "Full-load h",    value: r.fullLoadHoursPerYr,                     unit: "h/yr",     accent: "blue"  as const, description: "Annual equivalent full-load hours" },
          { label: "Spec. Yield",    value: r.annualSpecificYieldKwhPerKw,             unit: "kWh/kW/yr", accent: "blue" as const, description: "Annual energy output per installed kW" },
        ],
      };
    },
  },

  // ── Battery Storage ────────────────────────────────────────────────────────
  battery_storage: {
    archetypeKey: "battery_storage",
    label:       "Battery Energy Storage (BESS)",
    icon:        "battery_charging_full",
    description: "Enter round-trip efficiency, duration, and depth of discharge → one-way efficiency and usable energy per rated kW derived.",
    inputCarrierFlowLabel: "Charge Power Input",
    inputCarrierFlowUnit:  "kW_el",
    deriveOutputFlowKw(inputFlowKw, values) {
      const rte = Number(values.roundTripEfficiencyPct ?? 92) / 100;
      return { electricity: parseFloat((inputFlowKw * rte).toFixed(1)) };
    },
    sliders: [
      {
        id:           "roundTripEfficiencyPct",
        label:        "Round-Trip Efficiency (RTE)",
        unit:         "%",
        min:          65,
        max:          98,
        step:         0.5,
        defaultValue: 92,
        description:  "AC-to-AC efficiency including power electronics and thermal losses. Li-ion: 87–95 % · Vanadium: 70–80 % · NaS: 82–88 %.",
        tooltip:      "AC-to-AC round-trip efficiency: energy discharged / energy charged. Includes power electronics (inverter/rectifier ~1–2 % each way), thermal management, and auxiliary loads. High RTE reduces operating costs (less energy wasted) and is critical for high-cycling applications like frequency regulation.",
        presets: [
          { label: "Vanadium 75 %",  value: 75 },
          { label: "NaS 86 %",       value: 86 },
          { label: "Li-ion 92 %",    value: 92 },
        ],
      },
      {
        id:           "durationH",
        label:        "Discharge Duration",
        unit:         "h",
        min:          0.5,
        max:          12,
        step:         0.5,
        defaultValue: 4,
        description:  "Energy / rated power at full discharge. Short-duration: 1–4 h · Long-duration: 4–12 h.",
        tooltip:      "Ratio of stored energy capacity (kWh) to rated discharge power (kW). Determines how long the battery can sustain full output. 1–2 h: frequency/voltage regulation; 2–4 h: peak shifting; 4–12 h: load shifting and renewable integration. Does not depend on chemistry once the energy-to-power ratio is set.",
        presets: [
          { label: "2 h freq. reg.",  value: 2  },
          { label: "4 h peak shift",  value: 4  },
          { label: "8 h long-dur.",   value: 8  },
        ],
      },
      {
        id:           "depthOfDischargePct",
        label:        "Depth of Discharge (DoD)",
        unit:         "%",
        min:          60,
        max:          100,
        step:         1,
        defaultValue: 90,
        description:  "Usable fraction of nameplate capacity. Higher DoD → more energy but faster degradation. Li-ion: 80–95 %.",
        tooltip:      "Maximum state-of-charge swing per cycle. Operating at 100 % DoD maximises energy per cycle but accelerates capacity fade. Battery management systems typically limit Li-ion to 80–95 % DoD to extend calendar and cycle life. Vanadium flow batteries can cycle at 100 % DoD without degradation.",
        presets: [
          { label: "Conservative 80 %", value: 80 },
          { label: "Standard 90 %",     value: 90 },
          { label: "Max DoD 100 %",     value: 100 },
        ],
      },
    ],
    selects: [
      {
        id:           "chemistryType",
        label:        "Battery Chemistry",
        options: [
          { value: "liion",      label: "Lithium-ion (NMC / LFP)" },
          { value: "vanadium",   label: "Vanadium Redox Flow" },
          { value: "nas",        label: "Sodium-Sulfur (NaS)" },
          { value: "lead_acid",  label: "Lead-Acid (VRLA)" },
        ],
        defaultValue: "liion",
        description:  "Informational — select to load chemistry-typical defaults for RTE, duration, and DoD.",
        tooltip:      "Li-ion (NMC/LFP): highest RTE, best energy density, dominant for short-duration. Vanadium flow: unlimited cycle life, independent power/energy scaling, ideal for 4–12 h. NaS: operates at 300 °C, high energy density, large-scale utility storage. Lead-acid: cheapest, shortest life, heavy.",
      },
    ],
    derive(values) {
      const r = deriveBatteryStorage({
        roundTripEfficiencyPct: Number(values.roundTripEfficiencyPct),
        durationH:              Number(values.durationH),
        depthOfDischargePct:    Number(values.depthOfDischargePct),
      });
      return {
        efficiencyPercent: r.efficiencyPercent,
        co2FactorGPerKwh:  0,
        badges: [
          { label: "RTE",          value: `${r.efficiencyPercent.toFixed(1)} %`,    unit: "",         accent: "green" as const, description: "AC-to-AC round-trip efficiency" },
          { label: "η_one-way",    value: `${r.chargeEfficiencyPct.toFixed(1)} %`,  unit: "(√RTE)",   accent: "blue"  as const, description: "Symmetric charge = discharge efficiency = √RTE" },
          { label: "Usable E/P",   value: r.usableEnergyKwhPerKw.toFixed(2),        unit: "kWh/kW",   accent: "blue"  as const, description: "Usable energy per rated power (duration × DoD/100)" },
        ],
      };
    },
  },

};

// ── Lookup helper ─────────────────────────────────────────────────────────────

/**
 * Returns the ArchetypeSchema for a given full OEO class URI (or short ID),
 * or null if this technology family has no physics model yet.
 */
export function getArchetypeForOeoClass(oeoClassUri: string): ArchetypeSchema | null {
  const shortId     = oeoClassUri.includes("/") ? oeoClassUri.split("/").pop()! : oeoClassUri;
  const archetypeKey = OEO_TO_ARCHETYPE[shortId];
  return archetypeKey ? (ARCHETYPE_SCHEMAS[archetypeKey] ?? null) : null;
}

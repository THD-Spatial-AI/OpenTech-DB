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

  // Heat pumps (same OEO class covers both ASHP and GSHP — subtype selects correct correction)
  OEO_00000009: "heat_pump",

  // Solar PV (all variants use same irradiance→yield model)
  OEO_00000165: "solar_pv",   // Utility-scale
  OEO_00000361: "solar_pv",   // Distributed / balcony

  // Electrolyzers (AWE, PEM, SOEC — same electrochemical model, different voltage range)
  OEO_00010021: "electrolyzer",
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

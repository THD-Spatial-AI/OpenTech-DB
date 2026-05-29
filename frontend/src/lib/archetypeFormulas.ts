/**
 * lib/archetypeFormulas.ts
 * ─────────────────────────
 * Pure math functions that derive technical parameters from primary physical
 * inputs for each technology archetype.
 *
 * All functions are side-effect-free and unit-tested in isolation.
 * Sources are cited inline per formula.
 *
 * Archetypes covered (first release):
 *   1. gas_turbine  — heat rate / electrical efficiency → CO₂ factor
 *   2. heat_pump    — source & sink temperatures → COP (Carnot × correction)
 *   3. solar_pv     — module efficiency, losses, irradiance → CF / specific yield
 *   4. electrolyzer — stack voltage, Faradaic efficiency → H₂ system efficiency
 */

// ── 1. Gas Turbine / ICE ──────────────────────────────────────────────────────
// CO₂ factor: operational emissions per kWh_electrical output.
// Source: IPCC AR5, Annex II — Emission factors for stationary combustion.
//   Natural gas: 56.1 kgCO₂/GJ_th → 56.1 × 3.6 = 202 gCO₂/kWh_th
//   CO₂/kWh_el = fuel_emission_factor_g_per_kwh_th / η_el

const FUEL_CO2_G_PER_KWH_TH: Record<string, number> = {
  natural_gas: 202,    // IPCC 56.1 kgCO₂/GJ × 3.6 MJ/kWh
  hydrogen:    0,      // Green H₂ — no combustion CO₂
  biomethane:  0,      // Biogenic carbon — net-zero lifecycle
};

export interface GasTurbineInputs {
  /** Net electrical efficiency, LHV basis [%]. CCGT: 50–60%, OCGT: 35–42%, ICE: 38–46%. */
  electricalEfficiencyPct: number;
  /** Combustion fuel — determines operational CO₂ factor. */
  fuelType: "natural_gas" | "hydrogen" | "biomethane";
}

export interface GasTurbineOutputs {
  efficiencyPercent: number;
  co2FactorGPerKwh: number;
  /** Heat rate in kJ/kWh_el (= 3600 / η_el). */
  heatRateKjPerKwh: number;
}

export function deriveGasTurbine(inputs: GasTurbineInputs): GasTurbineOutputs {
  const eta = Math.max(0.01, inputs.electricalEfficiencyPct / 100);
  const fuelCo2 = FUEL_CO2_G_PER_KWH_TH[inputs.fuelType] ?? 202;
  return {
    efficiencyPercent: inputs.electricalEfficiencyPct,
    co2FactorGPerKwh:  Math.round(fuelCo2 / eta),
    heatRateKjPerKwh:  Math.round(3600 / eta),
  };
}

// ── 2. Heat Pump ──────────────────────────────────────────────────────────────
// COP from Carnot efficiency × real-machine correction factor.
// Source: EN 14511:2018 (European heat pump testing standard);
//         Staffell et al. (2012) "A review of domestic heat pumps" — Energy Environ. Sci.
//   COP_Carnot = T_sink_K / (T_sink_K − T_source_K)
//   COP_real   = COP_Carnot × η_exergetic
//   η_exergetic ≈ 0.45 (ASHP), 0.50 (GSHP) — empirical average from field data.

const HP_CARNOT_CORRECTION: Record<string, number> = {
  ashp: 0.45,   // Air-source: more external irreversibilities
  gshp: 0.50,   // Ground-source: more stable source temperature
};

export interface HeatPumpInputs {
  /** Source temperature [°C]. ASHP outdoor: −15 to 20; GSHP ground: 5 to 15. */
  tSourceC: number;
  /** Sink (distribution) temperature [°C]. Floor heating: 35–45; radiators: 55–70. */
  tSinkC: number;
  /** ASHP or GSHP — determines Carnot correction factor. */
  subtype: "ashp" | "gshp";
}

export interface HeatPumpOutputs {
  /** Real COP (dimensionless). */
  cop: number;
  /** COP × 100 stored as efficiencyPercent for compatibility with TechNodeData. */
  efficiencyPercent: number;
  co2FactorGPerKwh: number;
  copCarnot: number;
}

export function deriveHeatPump(inputs: HeatPumpInputs): HeatPumpOutputs {
  const tSourceK  = inputs.tSourceC + 273.15;
  const tSinkK    = inputs.tSinkC   + 273.15;
  const deltaTK   = tSinkK - tSourceK;

  // Guard against invalid temperature combinations
  if (deltaTK <= 0) {
    return { cop: 1, efficiencyPercent: 100, co2FactorGPerKwh: 0, copCarnot: 1 };
  }

  const copCarnot    = tSinkK / deltaTK;
  const correction   = HP_CARNOT_CORRECTION[inputs.subtype] ?? 0.45;
  const cop          = Math.max(1, parseFloat((copCarnot * correction).toFixed(2)));

  return {
    cop,
    efficiencyPercent: Math.round(cop * 100),
    co2FactorGPerKwh:  0,
    copCarnot:         parseFloat(copCarnot.toFixed(2)),
  };
}

// ── 3. Solar PV ───────────────────────────────────────────────────────────────
// AC system efficiency and annual energy yield from module specs and irradiance.
// Source: IEC 61724-1:2021 (PV system performance monitoring);
//         PVGIS methodology (JRC, European Commission).
//
//   PR (Performance Ratio) = 1 − system_losses_pct / 100
//   Specific yield (kWh/kWp/yr) = PSH × 365 × PR
//   Capacity factor [%] = specific_yield / 8760 × 100
//   AC system efficiency = module_efficiency × PR

export interface SolarPVInputs {
  /** Module STC efficiency [%]. Mono-Si: 18–23%, HJT: 22–25%, Thin-film: 12–18%. */
  moduleEfficiencyPct: number;
  /** Total system losses [%]. Typical range 10–20%. Includes wiring, inverter, soiling, mismatch. */
  systemLossesPct: number;
  /**
   * Peak Sun Hours per day [h/day] — annual average equivalent full-irradiance hours.
   * N. Europe: 2.5–3.5; C. Europe: 3.5–4.5; S. Europe / MENA: 5–7.
   */
  peakSunHoursPerDay: number;
}

export interface SolarPVOutputs {
  /** Module efficiency × PR [%] — net DC-to-AC system efficiency. */
  acEfficiencyPct: number;
  /** Annual specific yield [kWh/kWp/yr]. */
  specificYieldKwhPerKwpYr: number;
  /** Capacity factor [%]. */
  capacityFactorPct: number;
  efficiencyPercent: number;  // = acEfficiencyPct, for TechNodeData compatibility
  co2FactorGPerKwh: number;
}

export function deriveSolarPV(inputs: SolarPVInputs): SolarPVOutputs {
  const pr                      = 1 - inputs.systemLossesPct / 100;
  const acEfficiencyPct         = parseFloat((inputs.moduleEfficiencyPct * pr).toFixed(1));
  const specificYieldKwhPerKwpYr = parseFloat((inputs.peakSunHoursPerDay * 365 * pr).toFixed(0));
  const capacityFactorPct       = parseFloat(((specificYieldKwhPerKwpYr / 8760) * 100).toFixed(1));

  return {
    acEfficiencyPct,
    specificYieldKwhPerKwpYr,
    capacityFactorPct,
    efficiencyPercent: acEfficiencyPct,
    co2FactorGPerKwh:  0,
  };
}

// ── 4. Electrolyzer ───────────────────────────────────────────────────────────
// H₂ production efficiency from electrochemical first principles.
// Source: IRENA "Green Hydrogen Cost Reduction" (2020);
//         IEA "Hydrogen" (2023, p. 48).
//
//   Thermoneutral voltage V_tn = 1.481 V/cell  (25°C, liquid water)
//   Voltage efficiency η_V = V_tn / V_cell
//   System efficiency η_sys = η_V × η_Faradaic
//   Specific energy (kWh_el / Nm³ H₂) = 3.33 / η_sys  [HHV basis]
//     → 3.33 kWh/Nm³ is the HHV of hydrogen at STP

const V_THERMONEUTRAL = 1.481; // V per cell at 25°C, liquid water

export interface ElectrolyzerInputs {
  /**
   * Operating cell voltage [V/cell].
   * AWE: 1.7–2.0 V; PEM: 1.6–2.0 V; SOEC (high-temp): 1.0–1.5 V.
   */
  stackVoltageV: number;
  /**
   * Faradaic efficiency [%] — fraction of charge that produces H₂.
   * Losses from gas crossover, parasitic side reactions. Typically 95–100%.
   */
  faradicEfficiencyPct: number;
}

export interface ElectrolyzerOutputs {
  /** Voltage efficiency η_V [%] = V_tn / V_cell × 100. */
  voltageEfficiencyPct: number;
  /** Overall system efficiency η_sys [%] = η_V × η_Faradaic. */
  systemEfficiencyPct: number;
  /** Specific electrical energy consumption [kWh_el / Nm³ H₂, HHV basis]. */
  specificEnergyKwhPerNm3: number;
  efficiencyPercent: number;  // = systemEfficiencyPct, for TechNodeData compatibility
  co2FactorGPerKwh: number;
}

export function deriveElectrolyzer(inputs: ElectrolyzerInputs): ElectrolyzerOutputs {
  const voltageEff  = V_THERMONEUTRAL / Math.max(0.1, inputs.stackVoltageV);
  const systemEff   = voltageEff * (inputs.faradicEfficiencyPct / 100);
  const specificEnergy = parseFloat((3.33 / systemEff).toFixed(2));

  return {
    voltageEfficiencyPct:    parseFloat((voltageEff  * 100).toFixed(1)),
    systemEfficiencyPct:     parseFloat((systemEff   * 100).toFixed(1)),
    specificEnergyKwhPerNm3: specificEnergy,
    efficiencyPercent:       parseFloat((systemEff   * 100).toFixed(1)),
    co2FactorGPerKwh:        0,
  };
}

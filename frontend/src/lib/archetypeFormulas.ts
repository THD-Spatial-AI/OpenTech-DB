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

// ── 5. Steam Cycle (Biomass / Coal / Waste-to-Energy) ─────────────────────────
// Rankine cycle combustion plant — net electrical efficiency as primary input.
// CHP back-pressure mode adds a heat output parameterised by heat-to-power ratio α.
//
// CO₂ factors (fuel heat input basis):
//   Biomass: 0 g/kWh_th — biogenic carbon, net-zero lifecycle (IPCC AFOLU 2006)
//   Coal (bituminous): 94.6 kgCO₂/GJ × 3.6 = 341 g/kWh_th (IPCC 2006, Table 2.2)
//   MSW: fossil fraction ~40 % of combusted carbon → ~33 kgCO₂/GJ × 3.6 = 120 g/kWh_th
//        (IPCC 2006 SWDS methodology; total MSW CO₂ ~91 kgCO₂/GJ)
//
// CHP heat-to-power ratio α = Q_heat / P_el.
// Total fuel utilisation = η_el × (1 + α). Source: IEA "Combined Heat and Power" (2020).

// Per-fuel combustion data.
// stackCo2GPerKwhTh: IPCC 2006 vol. 2, Table 2.2 combustion emission factors (kgCO₂/GJ × 3.6).
//   Wood/straw combustion releases MORE CO₂ per kWh_th than coal because of lower energy density.
//   But for biomass the carbon was recently photosynthesised — it is biogenic, not ancient fossil.
// fossilFraction: share counted as fossil in GHG inventories (0 = fully biogenic, 1 = coal).
// supplyChainCo2GPerKwhEl: transport + processing lifecycle CO₂ normalised to electrical output
//   at reference η_el = 35 %. Sources: IPCC AR6 WG3 Table 12.6 (2022); JRC LCI (2020).
const STEAM_CYCLE_FUEL_DATA: Record<string, {
  stackCo2GPerKwhTh:       number;
  fossilFraction:          number;
  supplyChainCo2GPerKwhEl: number;
}> = {
  wood_chips:   { stackCo2GPerKwhTh: 348, fossilFraction: 0.0, supplyChainCo2GPerKwhEl: 15 },
  wood_pellets: { stackCo2GPerKwhTh: 347, fossilFraction: 0.0, supplyChainCo2GPerKwhEl: 28 },
  straw:        { stackCo2GPerKwhTh: 338, fossilFraction: 0.0, supplyChainCo2GPerKwhEl:  8 },
  // MSW: total stack ~328 g/kWh_th, only fossil fraction (~40 %) is net-reportable.
  msw_mixed:    { stackCo2GPerKwhTh: 328, fossilFraction: 0.4, supplyChainCo2GPerKwhEl:  0 },
  coal:         { stackCo2GPerKwhTh: 341, fossilFraction: 1.0, supplyChainCo2GPerKwhEl:  5 },
};

export interface SteamCycleInputs {
  /** Net electrical efficiency, LHV basis [%]. */
  electricalEfficiencyPct: number;
  operatingMode: "condensing" | "backpressure_chp";
  /** Heat-to-power ratio α = Q_heat / P_el. Ignored in condensing mode. */
  heatToPowerRatio: number;
  fuelType: "wood_chips" | "wood_pellets" | "straw" | "msw_mixed" | "coal";
  /**
   * Applies only to fully biogenic fuels (wood_chips, wood_pellets, straw).
   * "sustainable": biogenic CO₂ is net-zero; only supply-chain emissions count.
   * "unsustainable": full stack CO₂ is counted (old-growth clearing, land-use change).
   */
  sustainabilityClaim: "sustainable" | "unsustainable";
  /** Actual as-received LHV from the carrier node [MJ/kg]. Enables Fuel Rate badge. */
  lhvMJPerKg?: number;
  /** CH₄ content from the carrier node [vol-%]. Enables Energy Density badge for biogas. */
  ch4Percent?: number;
  /** Moisture content from the carrier node [%]. Enables corrected specific fuel rate. */
  moisturePercent?: number;
  /** Combustion & boiler thermal efficiency η_boiler [%]. Fuel LHV → steam. Typical: 82–92 %. */
  boilerEfficiencyPct?: number;
  /** Plant auxiliary / internal consumption [%]. Pumps, fans, fuel handling, controls. Typical: 3–8 %. */
  auxiliaryConsumptionPct?: number;
  /** Design annual full-load hours [h/yr]. Set by fuel availability, grid dispatch, maintenance schedule. */
  fullLoadHoursPerYr?: number;
}

export interface SteamCycleOutputs {
  efficiencyPercent:       number;
  /** Net lifecycle CO₂ [g/kWh_el] — stored as co2FactorGPerKwh for model compatibility. */
  co2FactorGPerKwh:        number;
  /** Physical CO₂ at stack [g/kWh_el] — combustion CO₂, includes biogenic fraction. */
  stackCo2GPerKwhEl:       number;
  /** Net reportable CO₂ [g/kWh_el] — after biogenic credit + supply-chain addition. */
  netCo2GPerKwhEl:         number;
  heatRateKjPerKwh:        number;
  /** η_el × (1 + α) [%]. Equals η_el in condensing mode. */
  totalFuelUtilizationPct: number;
  /** α = Q_heat / P_el. Zero in condensing mode. */
  heatOutputPerElKw:       number;
  /** η_el × α × 100 [%]. Zero in condensing mode. */
  heatEfficiencyPct:       number;
  /** Specific solid fuel consumption [kg/MWh_el] — only when lhvMJPerKg is provided. */
  specificFuelConsumptionKgPerMwhEl?: number;
  /** Biogas volumetric energy density [MJ/Nm³] — only when ch4Percent is provided. */
  volumetricEnergyMjPerNm3?: number;
  /** Gross electrical efficiency before auxiliary deduction [%] = η_net / (1 − η_aux). */
  grossElecEfficiencyPct: number;
  /** Rankine steam cycle efficiency [%] = η_net / (η_boiler × (1 − η_aux)). */
  rankineEfficiencyPct: number;
  /** Annual specific electricity yield [kWh_el / kW_th / yr] = η_net × FLH. */
  annualSpecificYieldKwhPerKwTh: number;
}

export function deriveSteamCycle(inputs: SteamCycleInputs): SteamCycleOutputs {
  const eta   = Math.max(0.01, inputs.electricalEfficiencyPct / 100);
  const alpha = inputs.operatingMode === "backpressure_chp" ? inputs.heatToPowerRatio : 0;
  const fuel  = STEAM_CYCLE_FUEL_DATA[inputs.fuelType] ?? STEAM_CYCLE_FUEL_DATA.wood_chips;

  // Stack CO₂ = physical combustion emissions per kWh_el (including biogenic)
  const stackCo2PerKwhEl = Math.round(fuel.stackCo2GPerKwhTh / eta);

  // Net reportable CO₂ (GHG inventory accounting):
  //   Coal (fossil=1.0):        full stack CO₂ + supply chain
  //   MSW  (fossil=0.4):        only fossil fraction of stack CO₂ (biogenic share = zero)
  //   Biogenic, sustainable:    only supply-chain CO₂ (biogenic credit applied, IPCC AFOLU / RED II)
  //   Biogenic, unsustainable:  full stack CO₂ — no credit for non-certified sourcing
  let netCo2PerKwhEl: number;
  if (fuel.fossilFraction >= 1) {
    netCo2PerKwhEl = stackCo2PerKwhEl + fuel.supplyChainCo2GPerKwhEl;
  } else if (fuel.fossilFraction > 0) {
    netCo2PerKwhEl = Math.round(fuel.stackCo2GPerKwhTh * fuel.fossilFraction / eta);
  } else if (inputs.sustainabilityClaim === "sustainable") {
    netCo2PerKwhEl = fuel.supplyChainCo2GPerKwhEl;
  } else {
    netCo2PerKwhEl = stackCo2PerKwhEl;  // unsustainable biogenic = treated as fossil
  }

  // Specific fuel consumption [kg/MWh_el] from carrier LHV: 3600 kJ/kWh / (eta × LHV_kJ/kg) × 1000 kWh/MWh
  // = 3600 / (eta × lhv_MJperKg) kg/MWh
  const specificFuelConsumptionKgPerMwhEl = inputs.lhvMJPerKg && inputs.lhvMJPerKg > 0
    ? parseFloat((3600 / (eta * inputs.lhvMJPerKg)).toFixed(0))
    : undefined;

  // Biogas volumetric energy: CH₄% × 35.9 MJ/Nm³ (LHV of pure methane at STP)
  const volumetricEnergyMjPerNm3 = inputs.ch4Percent && inputs.ch4Percent > 0
    ? parseFloat((inputs.ch4Percent * 0.01 * 35.9).toFixed(1))
    : undefined;

  // Efficiency chain decomposition
  // η_net = η_boiler × η_Rankine × (1 − η_aux)
  // ─ User inputs η_net (electricalEfficiencyPct); boiler and aux are additional parameters.
  // ─ Derive gross and Rankine from the entered net efficiency.
  const etaBoiler  = Math.min(1, (inputs.boilerEfficiencyPct    ?? 88) / 100);
  const etaAuxMul  = 1 - Math.min(1, (inputs.auxiliaryConsumptionPct ?? 5)  / 100);
  const flh        = inputs.fullLoadHoursPerYr ?? 7000;
  const grossElecEfficiencyPct        = parseFloat(Math.min(100, eta / Math.max(0.01, etaAuxMul) * 100).toFixed(1));
  const rankineEfficiencyPct          = parseFloat(Math.min(100, eta / Math.max(0.01, etaBoiler * etaAuxMul) * 100).toFixed(1));
  const annualSpecificYieldKwhPerKwTh = parseFloat((eta * flh).toFixed(0));

  return {
    efficiencyPercent:                 inputs.electricalEfficiencyPct,
    co2FactorGPerKwh:                  netCo2PerKwhEl,
    stackCo2GPerKwhEl:                 stackCo2PerKwhEl,
    netCo2GPerKwhEl:                   netCo2PerKwhEl,
    heatRateKjPerKwh:                  Math.round(3600 / eta),
    totalFuelUtilizationPct:           Math.min(100, parseFloat((eta * (1 + alpha) * 100).toFixed(1))),
    heatOutputPerElKw:                 parseFloat(alpha.toFixed(2)),
    heatEfficiencyPct:                 parseFloat((eta * alpha * 100).toFixed(1)),
    specificFuelConsumptionKgPerMwhEl,
    volumetricEnergyMjPerNm3,
    grossElecEfficiencyPct,
    rankineEfficiencyPct,
    annualSpecificYieldKwhPerKwTh,
  };
}

// ── 6. Nuclear Power Plant ────────────────────────────────────────────────────
// Light-water or advanced reactor — net thermal efficiency + capacity factor.
// Sources:
//   IAEA "Nuclear Power Reactors" (2023); IAEA PRIS database (2022).
//   IEA "Nuclear Power in a Clean Energy System" (2019).
//   Lifecycle CO₂: 12 g/kWh_el — IPCC AR6 WG3 Annex II median (2022).
//   Net efficiency range: PWR 32–36 %, BWR 30–34 %, CANDU 29–33 %, SMR 30–36 % (projected).

export interface NuclearInputs {
  /** Net thermal-to-electrical efficiency [%]. Determined by steam cycle parameters. */
  thermalEfficiencyPct: number;
  /** Annual plant availability (capacity factor) [%]. Global LWR average ≈ 88 % (IAEA PRIS 2022). */
  capacityFactorPct: number;
  /** Reactor technology — informational; sets preset defaults. */
  reactorType: "pwr" | "bwr" | "smr" | "candu";
}

export interface NuclearOutputs {
  efficiencyPercent: number;
  /** Fixed at 12 g/kWh_el — lifecycle LCA median, not a combustion emission. */
  co2FactorGPerKwh: number;
  heatRateKjPerKwh: number;
  fullLoadHoursPerYr: number;
  annualSpecificYieldKwhPerKw: number;
}

export function deriveNuclear(inputs: NuclearInputs): NuclearOutputs {
  const eta = Math.max(0.01, inputs.thermalEfficiencyPct / 100);
  const cf  = Math.max(0, Math.min(1, inputs.capacityFactorPct / 100));
  const flh = cf * 8760;
  return {
    efficiencyPercent:           inputs.thermalEfficiencyPct,
    co2FactorGPerKwh:            12,   // IPCC AR6 WG3 median lifecycle
    heatRateKjPerKwh:            Math.round(3600 / eta),
    fullLoadHoursPerYr:          Math.round(flh),
    annualSpecificYieldKwhPerKw: parseFloat(flh.toFixed(0)),
  };
}

// ── 7. Wind Turbine ───────────────────────────────────────────────────────────
// Net capacity factor = gross CF × availability × (1 − wake & electrical losses).
// Sources:
//   IEA Wind Task 26 "Wind Technology, Cost, and Performance Trends" (2023).
//   WindEurope "Wind Energy in Europe 2023 — Annual Statistics".
//   Availability model: IEC 61400-26 (turbine/BoP availability accounting).
//   Wake loss: 5–10 % for utility-scale wind farms (WindPRO, IEA method).

export interface WindTurbineInputs {
  /** Gross capacity factor (before availability and wake deductions) [%]. */
  grossCapacityFactorPct: number;
  /** Technical availability — turbine + BoP [%]. Onshore: 96–98 %; offshore: 94–97 %. */
  availabilityPct: number;
  /** Combined wake and electrical collection losses [%]. Typical: onshore 5 %, offshore 8–10 %. */
  wakeLossesPct: number;
}

export interface WindTurbineOutputs {
  efficiencyPercent: number;  // = netCapacityFactorPct
  co2FactorGPerKwh: number;
  netCapacityFactorPct: number;
  fullLoadHoursPerYr: number;
  annualSpecificYieldKwhPerKw: number;
}

export function deriveWindTurbine(inputs: WindTurbineInputs): WindTurbineOutputs {
  const grossCF    = inputs.grossCapacityFactorPct / 100;
  const avail      = inputs.availabilityPct        / 100;
  const wakeFactor = 1 - inputs.wakeLossesPct      / 100;
  const netCF      = parseFloat((grossCF * avail * wakeFactor).toFixed(4));
  const flh        = netCF * 8760;
  return {
    efficiencyPercent:           parseFloat((netCF * 100).toFixed(1)),
    co2FactorGPerKwh:            0,
    netCapacityFactorPct:        parseFloat((netCF * 100).toFixed(1)),
    fullLoadHoursPerYr:          Math.round(flh),
    annualSpecificYieldKwhPerKw: parseFloat(flh.toFixed(0)),
  };
}

// ── 8. Battery Energy Storage (BESS) ─────────────────────────────────────────
// Round-trip efficiency model — charge/discharge split assumed symmetric (η_c = η_d = √RTE).
// Sources:
//   NREL "Utility-Scale Battery Storage" (ATB 2023, p. 12).
//   IEA "Grid-Scale Storage" (2022, pp. 34–38).
//   Typical RTE: Li-ion 87–95 %, Vanadium flow 70–80 %, NaS 82–88 %, Lead-acid 75–85 %.

export interface BatteryStorageInputs {
  /** AC-to-AC round-trip efficiency [%]. Includes power electronics and thermal management. */
  roundTripEfficiencyPct: number;
  /** Discharge duration at rated power [h]. Short-duration: 1–4 h; long-duration: 4–12 h. */
  durationH: number;
  /** Depth of discharge [%] — usable fraction of nameplate capacity per cycle. */
  depthOfDischargePct: number;
}

export interface BatteryStorageOutputs {
  efficiencyPercent: number;  // = roundTripEfficiencyPct
  co2FactorGPerKwh: number;
  /** One-way charge efficiency = √RTE [%]. Symmetric assumption. */
  chargeEfficiencyPct: number;
  /** One-way discharge efficiency = √RTE [%]. */
  dischargeEfficiencyPct: number;
  /** Usable energy per rated kW [kWh/kW] = duration × DoD/100. */
  usableEnergyKwhPerKw: number;
}

export function deriveBatteryStorage(inputs: BatteryStorageInputs): BatteryStorageOutputs {
  const rte     = inputs.roundTripEfficiencyPct / 100;
  const halfEff = parseFloat((Math.sqrt(rte) * 100).toFixed(1));
  const usable  = parseFloat((inputs.durationH * inputs.depthOfDischargePct / 100).toFixed(2));
  return {
    efficiencyPercent:      inputs.roundTripEfficiencyPct,
    co2FactorGPerKwh:       0,
    chargeEfficiencyPct:    halfEff,
    dischargeEfficiencyPct: halfEff,
    usableEnergyKwhPerKw:   usable,
  };
}

package OTDBComponents "Parameterized component models for OpenTech-DB Processes (ADR-0004, Phase 5)"

  // Causal connectors named by the graph's Port ids. Using our own light
  // connectors (not the Modelica Standard Library) keeps the generated system
  // model self-contained and fast to compile. One output may fan out to many
  // inputs; every input must be driven (the flowsheet compiler ties any
  // unconnected input to zero).
  //
  // Each port carries its carrier's primary quantity (see modelica_compiler.
  // PRIMARY). Extra stream quantities are plain variables named <port>_<field>
  // (e.g. h2_out_pressure_bar), read back to build the Stream states.
  connector RealIn = input Real;
  connector RealOut = output Real;

  constant Real HHV = 39.4 "Hydrogen higher heating value [kWh/kg]";
  constant Real BIOMASS_LHV = 4.9 "Wood chips, as received [kWh/kg]";
  constant Real CH4_LHV = 13.9 "Methane lower heating value [kWh/kg]";
  constant Real M_H2 = 0.002016 "[kg/mol]";
  constant Real M_CO2 = 0.04401 "[kg/mol]";
  constant Real M_CH4 = 0.016043 "[kg/mol]";

  // ── Sources ────────────────────────────────────────────────────────────────
  block PowerSource
    parameter Real capacity_kw = 10000;
    parameter Real capacity_factor = 1;
    RealOut power_out;
  equation
    power_out = capacity_kw * capacity_factor;
  end PowerSource;

  block WaterSource
    RealOut water_out;
  equation
    water_out = 0 "availability marker; consumer sizes its own demand";
  end WaterSource;

  block FlueGasSource
    parameter Real capacity_kw = 400000;
    parameter Real capacity_factor = 1 "host-plant availability";
    parameter Real co2_emission_kg_kwh = 0.35;
    RealOut flue_out "entrained CO2 [kg/h]";
    Real flue_out_flue_kw "average generation [kW]";
  equation
    flue_out_flue_kw = capacity_kw * capacity_factor;
    flue_out = flue_out_flue_kw * co2_emission_kg_kwh;
  end FlueGasSource;

  block BiomassSource
    parameter Real fuel_input_kw = 20000 "rated LHV thermal input";
    parameter Real capacity_factor = 1;
    RealOut biomass_out "fuel [kW]";
    Real biomass_out_biomass_kg_h;
  equation
    biomass_out = fuel_input_kw * capacity_factor;
    biomass_out_biomass_kg_h = biomass_out / BIOMASS_LHV;
  end BiomassSource;

  block CO2Source
    parameter Real co2_supply_kg_h = 1000;
    parameter Real pressure_bar = 1.5;
    RealOut co2_out "[kg/h]";
    Real co2_out_pressure_bar;
  equation
    co2_out = co2_supply_kg_h;
    co2_out_pressure_bar = pressure_bar;
  end CO2Source;

  // ── Conversion ───────────────────────────────────────────────────────────────
  block ElectrolyzerPEM
    parameter Real efficiency = 0.70 "HHV fraction";
    RealIn power_in;
    RealIn water_in;
    RealOut h2_out "[kg/h]";
    Real h2_out_pressure_bar;
    Real water_kg_h;
    Real efficiency_pct;
  equation
    h2_out = power_in * efficiency / HHV;
    h2_out_pressure_bar = 30;
    water_kg_h = 9.0 * h2_out;
    efficiency_pct = efficiency * 100;
  end ElectrolyzerPEM;

  block Compressor
    parameter Real target_pressure_bar = 350;
    parameter Real isentropic_efficiency = 0.78;
    RealIn h2_in;
    RealIn power_in;
    RealOut h2_out;
    Real h2_out_pressure_bar;
    Real power_kw;
  equation
    h2_out = h2_in;
    h2_out_pressure_bar = target_pressure_bar;
    power_kw = 0.5 * log(max(target_pressure_bar, 2.0)) / max(isentropic_efficiency, 0.1) * h2_in;
  end Compressor;

  block FuelCellPEM
    parameter Real efficiency = 0.58;
    RealIn h2_in;
    RealOut power_out;
    Real efficiency_pct;
  equation
    power_out = h2_in * HHV * efficiency;
    efficiency_pct = efficiency * 100;
  end FuelCellPEM;

  block CO2AbsorberAmine
    parameter Real capture_rate = 0.90;
    parameter Real energy_requirement_gj_tco2 = 3.7;
    RealIn flue_in;
    RealOut co2_rich_out;
    Real capture_rate_pct;
    Real reboiler_duty_kw;
  equation
    co2_rich_out = flue_in * capture_rate;
    capture_rate_pct = capture_rate * 100;
    reboiler_duty_kw = co2_rich_out / 1000 * energy_requirement_gj_tco2 * 1e6 / 3600;
  end CO2AbsorberAmine;

  block SolventStripper
    parameter Real reboiler_temp_c = 120;
    RealIn co2_rich_in;
    RealIn heat_in;
    RealOut co2_pure_out;
    Real co2_pure_out_pressure_bar;
  equation
    co2_pure_out = co2_rich_in;
    co2_pure_out_pressure_bar = 1.5;
  end SolventStripper;

  block CO2Compressor
    parameter Real target_pressure_bar = 110;
    RealIn co2_in;
    RealIn power_in;
    RealOut co2_out;
    Real co2_out_pressure_bar;
    Real power_kw;
  equation
    co2_out = co2_in;
    co2_out_pressure_bar = target_pressure_bar;
    power_kw = 0.02 * log(max(target_pressure_bar, 2.0)) * co2_in;
  end CO2Compressor;

  // ── Bioenergy + power-to-gas ─────────────────────────────────────────────────
  block BiomassCHP
    parameter Real electrical_efficiency = 0.30;
    parameter Real thermal_efficiency = 0.55;
    RealIn biomass_in "fuel [kW]";
    RealOut power_out;
    RealOut heat_out;
    Real electrical_efficiency_pct;
    Real total_efficiency_pct;
  equation
    power_out = biomass_in * electrical_efficiency;
    heat_out = biomass_in * thermal_efficiency;
    electrical_efficiency_pct = electrical_efficiency * 100;
    total_efficiency_pct = (electrical_efficiency + thermal_efficiency) * 100;
  end BiomassCHP;

  block AnaerobicDigester
    parameter Real biogas_yield = 0.60 "fuel energy → biogas energy";
    parameter Real methane_content = 0.60 "raw biogas CH4 share";
    RealIn biomass_in "fuel [kW]";
    RealOut biogas_out "[kW]";
    Real biogas_out_methane_frac;
    Real methane_content_pct;
  equation
    biogas_out = biomass_in * biogas_yield;
    biogas_out_methane_frac = methane_content;
    methane_content_pct = methane_content * 100;
  end AnaerobicDigester;

  block BiogasUpgrader
    parameter Real methane_recovery = 0.98;
    parameter Real delivery_pressure_bar = 8;
    RealIn biogas_in "[kW]";
    RealOut gas_out "biomethane [kW]";
    RealOut co2_out "removed CO2 [kg/h]";
    Real gas_out_ch4_kg_h;
    Real gas_out_pressure_bar;
    Real methane_recovery_pct;
  equation
    gas_out = biogas_in * methane_recovery;
    gas_out_ch4_kg_h = gas_out / CH4_LHV;
    gas_out_pressure_bar = delivery_pressure_bar;
    co2_out = biogas_in * 0.20 / CH4_LHV * (M_CO2 / M_CH4) * 10 "crude non-CH4 balance";
    methane_recovery_pct = methane_recovery * 100;
  end BiogasUpgrader;

  block MethanationReactor "Sabatier: CO2 + 4 H2 → CH4 + 2 H2O"
    parameter Real conversion = 0.80;
    parameter Real delivery_pressure_bar = 8;
    RealIn h2_in "[kg/h]";
    RealIn co2_in "[kg/h]";
    RealOut gas_out "methane [kW]";
    Real gas_out_ch4_kg_h;
    Real gas_out_pressure_bar;
    Real ch4_from_h2 "[mol/h]";
    Real ch4_from_co2 "[mol/h]";
    Real limited_by_h2 "1 if H2 is the limiting reactant";
    Real conversion_pct;
  equation
    ch4_from_h2 = h2_in / M_H2 / 4.0;
    ch4_from_co2 = co2_in / M_CO2;
    gas_out_ch4_kg_h = min(ch4_from_h2, ch4_from_co2) * conversion * M_CH4;
    gas_out = gas_out_ch4_kg_h * CH4_LHV;
    gas_out_pressure_bar = delivery_pressure_bar;
    limited_by_h2 = if ch4_from_h2 < ch4_from_co2 then 1 else 0;
    conversion_pct = conversion * 100;
  end MethanationReactor;

  // ── Storage / sinks (H2Tank carries the dynamic state) ───────────────────────
  block H2Tank
    parameter Real max_pressure_bar = 350;
    parameter Real round_trip_efficiency = 0.99;
    parameter Real initial_level_kg = 0;
    RealIn h2_in;
    RealOut h2_out;
    Real h2_out_pressure_bar;
    Real round_trip_efficiency_pct;
    Real level_kg(start = initial_level_kg, fixed = true) "stored H2 [kg] — dynamic state";
  equation
    h2_out = h2_in * round_trip_efficiency;
    h2_out_pressure_bar = max_pressure_bar;
    round_trip_efficiency_pct = round_trip_efficiency * 100;
    der(level_kg) = (h2_in - h2_out) / 3600.0 "kg/h → kg/s";
  end H2Tank;

  block CO2GeologicalStorage
    RealIn co2_in;
    Real injected_kg_h;
    Real injected_mtco2_yr;
  equation
    injected_kg_h = co2_in;
    injected_mtco2_yr = co2_in * 8760 / 1e9;
  end CO2GeologicalStorage;

  block GridSink
    RealIn power_in;
    Real power_kw;
  equation
    power_kw = power_in;
  end GridSink;

  block HeatSink
    RealIn heat_in;
    Real heat_kw;
  equation
    heat_kw = heat_in;
  end HeatSink;

  block GasGridSink
    RealIn gas_in "methane [kW]";
    Real methane_kw;
    Real ch4_kg_h;
  equation
    methane_kw = gas_in;
    ch4_kg_h = gas_in / CH4_LHV;
  end GasGridSink;

  block Zero "Constant zero source for otherwise-unconnected inputs"
    RealOut y;
  equation
    y = 0;
  end Zero;
end OTDBComponents;

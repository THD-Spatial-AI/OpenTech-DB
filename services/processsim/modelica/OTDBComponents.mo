package OTDBComponents "Parameterized component models for OpenTech-DB Processes (ADR-0004, Phase 5)"

  // Causal connectors named by the graph's Port ids. Using our own light
  // connectors (not the Modelica Standard Library) keeps the generated system
  // model self-contained and fast to compile. One output may fan out to many
  // inputs; every input must be driven (the flowsheet compiler ties any
  // unconnected input to zero).
  connector RealIn = input Real;
  connector RealOut = output Real;

  constant Real HHV = 39.4 "Hydrogen higher heating value [kWh/kg]";

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
    parameter Real co2_emission_kg_kwh = 0.35;
    RealOut flue_out "entrained CO2 [kg/h]";
  equation
    flue_out = capacity_kw * co2_emission_kg_kwh;
  end FlueGasSource;

  // ── Conversion ───────────────────────────────────────────────────────────────
  block ElectrolyzerPEM
    parameter Real efficiency = 0.70 "HHV fraction";
    RealIn power_in;
    RealIn water_in;
    RealOut h2_out "[kg/h]";
    Real water_kg_h;
  equation
    h2_out = power_in * efficiency / HHV;
    water_kg_h = 9.0 * h2_out;
  end ElectrolyzerPEM;

  block Compressor
    parameter Real target_pressure_bar = 350;
    parameter Real isentropic_efficiency = 0.78;
    RealIn h2_in;
    RealIn power_in;
    RealOut h2_out;
    Real power_kw;
  equation
    h2_out = h2_in;
    power_kw = 0.5 * log(max(target_pressure_bar, 2.0)) / max(isentropic_efficiency, 0.1) * h2_in;
  end Compressor;

  block FuelCellPEM
    parameter Real efficiency = 0.58;
    RealIn h2_in;
    RealOut power_out;
  equation
    power_out = h2_in * HHV * efficiency;
  end FuelCellPEM;

  block CO2AbsorberAmine
    parameter Real capture_rate = 0.90;
    RealIn flue_in;
    RealOut co2_rich_out;
  equation
    co2_rich_out = flue_in * capture_rate;
  end CO2AbsorberAmine;

  block SolventStripper
    parameter Real reboiler_temp_c = 120;
    RealIn co2_rich_in;
    RealIn heat_in;
    RealOut co2_pure_out;
  equation
    co2_pure_out = co2_rich_in;
  end SolventStripper;

  block CO2Compressor
    parameter Real target_pressure_bar = 110;
    RealIn co2_in;
    RealIn power_in;
    RealOut co2_out;
    Real power_kw;
  equation
    co2_out = co2_in;
    power_kw = 0.02 * log(max(target_pressure_bar, 2.0)) * co2_in;
  end CO2Compressor;

  // ── Storage / sinks (H2Tank carries the dynamic state) ───────────────────────
  block H2Tank
    parameter Real max_pressure_bar = 350;
    parameter Real round_trip_efficiency = 0.99;
    parameter Real initial_level_kg = 0;
    RealIn h2_in;
    RealOut h2_out;
    Real level_kg(start = initial_level_kg, fixed = true) "stored H2 [kg] — dynamic state";
  equation
    h2_out = h2_in * round_trip_efficiency;
    der(level_kg) = (h2_in - h2_out) / 3600.0 "kg/h → kg/s";
  end H2Tank;

  block CO2GeologicalStorage
    RealIn co2_in;
    Real injected_kg_h;
  equation
    injected_kg_h = co2_in;
  end CO2GeologicalStorage;

  block GridSink
    RealIn power_in;
    Real power_kw;
  equation
    power_kw = power_in;
  end GridSink;

  block Zero "Constant zero source for otherwise-unconnected inputs"
    RealOut y;
  equation
    y = 0;
  end Zero;
end OTDBComponents;

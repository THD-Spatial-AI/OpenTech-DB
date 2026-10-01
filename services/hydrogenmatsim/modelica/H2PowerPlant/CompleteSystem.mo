within H2PowerPlant;

model CompleteSystem "Complete H2 power plant: Source → ELZ → CMP → STG → FC"
  
  // ══════════════════════════════════════════════════════════════════════════
  // Component instances
  // ══════════════════════════════════════════════════════════════════════════
  H2PowerPlant.Electrolyzer electrolyzer(
    tech_type = elz_tech,
    P_rated = elz_P_rated,
    eta_hhv = elz_eta_hhv,
    P_min = elz_P_min,
    P_max = elz_P_max,
    T_op = elz_T_op,
    q_water = elz_q_water,
    HHV = elz_HHV)
    annotation (Placement(transformation(extent={{-60,20},{-20,60}})));
  
  H2PowerPlant.Compressor compressor(
    tech_type = cmp_tech,
    eta_isen = cmp_eta_isen,
    p_in = cmp_p_in,
    p_target = cmp_p_target)
    annotation (Placement(transformation(extent={{0,20},{40,60}})));
  
  H2PowerPlant.Storage storage(
    tech_type = stg_tech,
    p_max = stg_p_max,
    p_min = stg_p_min,
    soc0 = stg_soc0,
    eta_rt = stg_eta_rt,
    V_tank = stg_V_tank)
    annotation (Placement(transformation(extent={{60,20},{100,60}})));
  
  H2PowerPlant.FuelCell fuelCell(
    tech_type = fc_tech,
    P_rated = fc_P_rated,
    eta_lhv = fc_eta_lhv,
    P_min = fc_P_min,
    q_h2_rated = fc_q_h2_rated,
    p_op = fc_p_op,
    Q_cool = fc_Q_cool)
    annotation (Placement(transformation(extent={{60,-60},{100,-20}})));
  
  Modelica.Blocks.Sources.CombiTimeTable powerSource(
    tableOnFile = true,
    tableName = "power_profile",
    fileName = "power_profile.txt",
    columns = {2})
    annotation (Placement(transformation(extent={{-100,30},{-80,50}})));
  
  // ══════════════════════════════════════════════════════════════════════════
  // Parameters (set from Python via OMPython)
  // ══════════════════════════════════════════════════════════════════════════
  
  // Electrolyzer
  parameter String elz_tech = "pem";
  parameter Real elz_P_rated = 1000;
  parameter Real elz_eta_hhv = 0.70;
  parameter Real elz_P_min = 50;
  parameter Real elz_P_max = 1000;
  parameter Real elz_T_op = 80;
  parameter Real elz_q_water = 15;
  parameter Real elz_HHV = 39.4;
  
  // Compressor
  parameter String cmp_tech = "reciprocating";
  parameter Real cmp_eta_isen = 0.80;
  parameter Real cmp_p_in = 1.5;
  parameter Real cmp_p_target = 350;
  
  // Storage
  parameter String stg_tech = "compressed_h2";
  parameter Real stg_p_max = 350;
  parameter Real stg_p_min = 10;
  parameter Real stg_soc0 = 0.5;
  parameter Real stg_eta_rt = 0.99;
  parameter Real stg_V_tank = 10;
  
  // Fuel cell
  parameter String fc_tech = "pem";
  parameter Real fc_P_rated = 1000;
  parameter Real fc_eta_lhv = 0.58;
  parameter Real fc_P_min = 50;
  parameter Real fc_q_h2_rated = 200;
  parameter Real fc_p_op = 2.5;
  parameter Real fc_Q_cool = 400;
  
equation
  // ══════════════════════════════════════════════════════════════════════════
  // Component connections
  // ══════════════════════════════════════════════════════════════════════════
  
  // Power source → Electrolyzer
  connect(powerSource.y[1], electrolyzer.P_source);
  
  // Electrolyzer → Compressor
  connect(electrolyzer.h2_flow, compressor.h2_flow_in);
  connect(storage.pressure, compressor.tank_pressure);
  
  // Compressor → Storage
  connect(compressor.h2_flow_out, storage.h2_in);
  
  // Storage → Fuel Cell (H2 withdrawal calculation)
  connect(storage.h2_available, fuelCell.h2_available);
  connect(storage.pressure, fuelCell.tank_pressure);
  connect(fuelCell.h2_consumed, storage.h2_out_demand);
  
  annotation (
    experiment(StartTime=0, StopTime=86400, Tolerance=1e-06, Interval=60),
    Documentation(info="<html>
<h1>Complete H2 Power Plant System</h1>
<p>Integrated system simulation connecting all components:</p>
<ol>
  <li>Power Source (time-series input from file)</li>
  <li>Electrolyzer (AC → H2)</li>
  <li>Compressor (low pressure → high pressure)</li>
  <li>Storage Tank (pressure vessel with ideal gas model)</li>
  <li>Fuel Cell (H2 → AC)</li>
</ol>
<p>All parameters are configurable from Python via OMPython.</p>
</html>"));
end CompleteSystem;

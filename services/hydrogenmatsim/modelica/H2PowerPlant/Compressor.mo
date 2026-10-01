within H2PowerPlant;

model Compressor "Multi-stage hydrogen compressor with isentropic efficiency"
  
  // ══════════════════════════════════════════════════════════════════════════
  // Parameters
  // ══════════════════════════════════════════════════════════════════════════
  parameter String tech_type = "reciprocating" "Technology type";
  parameter Real eta_isen(unit="1") = 0.80 "Isentropic efficiency";
  parameter Real p_in(unit="bar") = 1.5 "Inlet pressure (from electrolyzer)";
  parameter Real p_target(unit="bar") = 350 "Target discharge pressure";
  
  // Constants
  constant Real R_gas(unit="J/(mol.K)") = 8.314 "Universal gas constant";
  constant Real M_h2(unit="kg/mol") = 0.002016 "H2 molar mass";
  constant Real T_amb(unit="K") = 293 "Ambient temperature";
  constant Real gamma = 1.4 "Heat capacity ratio for H2";
  
  // ══════════════════════════════════════════════════════════════════════════
  // Connectors
  // ══════════════════════════════════════════════════════════════════════════
  Modelica.Blocks.Interfaces.RealInput h2_flow_in(unit="kg/h") "H2 mass flow from electrolyzer"
    annotation (Placement(transformation(extent={{-120,-10},{-100,10}})));
    
  Modelica.Blocks.Interfaces.RealInput tank_pressure(unit="bar") "Current tank pressure"
    annotation (Placement(transformation(extent={{-120,-60},{-100,-40}})));
    
  Modelica.Blocks.Interfaces.RealOutput P_consumed(unit="kW") "Electrical power consumed"
    annotation (Placement(transformation(extent={{100,40},{120,60}})));
    
  Modelica.Blocks.Interfaces.RealOutput p_out(unit="bar") "Outlet pressure"
    annotation (Placement(transformation(extent={{100,-10},{120,10}})));
    
  Modelica.Blocks.Interfaces.RealOutput h2_flow_out(unit="kg/h") "H2 flow to storage"
    annotation (Placement(transformation(extent={{100,-60},{120,-40}})));
  
  // ══════════════════════════════════════════════════════════════════════════
  // Internal variables
  // ══════════════════════════════════════════════════════════════════════════
  Real m_dot(unit="kg/s") "Mass flow rate";
  Real pressure_ratio "p_target / p_in";
  Real W_isen(unit="W") "Isentropic compression work";
  Boolean is_active "Compressor running";
  
equation
  // ──────────────────────────────────────────────────────────────────────────
  // Operating logic: run only if H2 available and tank not full
  // ──────────────────────────────────────────────────────────────────────────
  is_active = h2_flow_in > 0.01 and tank_pressure < p_target;
  
  if is_active then
    m_dot = h2_flow_in / 3600; // Convert kg/h → kg/s
    
    // Polytropic compression work (multi-stage approximation)
    pressure_ratio = p_target / max(p_in, 0.1);
    
    W_isen = m_dot * (R_gas * T_amb / M_h2) 
             * (gamma / (gamma - 1.0)) 
             * (pressure_ratio^((gamma - 1.0) / gamma) - 1.0);
    
    P_consumed = W_isen / (eta_isen * 1000); // W → kW with efficiency loss
    p_out = min(p_target, tank_pressure + (p_target - tank_pressure) * 0.05);
    h2_flow_out = h2_flow_in; // Mass conservation
    
  else
    // Compressor off
    m_dot = 0;
    pressure_ratio = 1;
    W_isen = 0;
    P_consumed = 0;
    p_out = tank_pressure;
    h2_flow_out = 0;
  end if;
  
  annotation (
    Icon(coordinateSystem(preserveAspectRatio=false), graphics={
      Polygon(points={{-80,60},{-80,-60},{60,0},{-80,60}}, lineColor={0,0,0}, fillColor={255,170,85}, fillPattern=FillPattern.Solid),
      Ellipse(extent={{40,20},{80,-20}}, lineColor={0,0,0}, fillColor={255,213,170}, fillPattern=FillPattern.Solid),
      Text(extent={{-100,140},{100,100}}, textString="%name", textColor={0,0,255})}),
    Documentation(info="<html>
<h1>Compressor Model</h1>
<p>Multi-stage reciprocating or ionic liquid compressor.</p>
<p>Calculates power consumption based on isentropic efficiency and pressure ratio.</p>
<p>Typical targets: 350 bar (automotive), 700 bar (heavy-duty), 110-200 bar (pipeline).</p>
</html>"));
end Compressor;

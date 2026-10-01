within H2PowerPlant;

model Storage "Compressed hydrogen storage tank with ideal gas model"
  
  // ══════════════════════════════════════════════════════════════════════════
  // Parameters
  // ══════════════════════════════════════════════════════════════════════════
  parameter String tech_type = "compressed_h2" "Storage technology";
  parameter Real p_max(unit="bar") = 350 "Maximum allowable pressure";
  parameter Real p_min(unit="bar") = 10 "Minimum usable pressure";
  parameter Real soc0(unit="1") = 0.5 "Initial state-of-charge (0-1)";
  parameter Real eta_rt(unit="1") = 0.99 "Round-trip efficiency";
  parameter Real V_tank(unit="m3") = 10 "Tank volume";
  
  // Constants
  constant Real R_gas(unit="J/(mol.K)") = 8.314;
  constant Real M_h2(unit="kg/mol") = 0.002016;
  constant Real T_amb(unit="K") = 293;
  
  // ══════════════════════════════════════════════════════════════════════════
  // Connectors
  // ══════════════════════════════════════════════════════════════════════════
  Modelica.Blocks.Interfaces.RealInput h2_in(unit="kg/h") "H2 flow from compressor"
    annotation (Placement(transformation(extent={{-120,40},{-100,60}})));
    
  Modelica.Blocks.Interfaces.RealInput h2_out_demand(unit="kg/h") "H2 demand from fuel cell"
    annotation (Placement(transformation(extent={{-120,-60},{-100,-40}})));
    
  Modelica.Blocks.Interfaces.RealOutput pressure(unit="bar") "Tank pressure"
    annotation (Placement(transformation(extent={{100,40},{120,60}})));
    
  Modelica.Blocks.Interfaces.RealOutput soc(unit="1") "State of charge (0-1)"
    annotation (Placement(transformation(extent={{100,0},{120,20}})));
    
  Modelica.Blocks.Interfaces.RealOutput h2_mass(unit="kg") "Total H2 mass in tank"
    annotation (Placement(transformation(extent={{100,-40},{120,-20}})));

  Modelica.Blocks.Interfaces.RealOutput h2_available(unit="kg/h") "Estimated deliverable H2 flow"
    annotation (Placement(transformation(extent={{100,-80},{120,-60}})));
  
  // ══════════════════════════════════════════════════════════════════════════
  // State variables
  // ══════════════════════════════════════════════════════════════════════════
  Real m_h2(unit="kg", start=m_h2_init, fixed=true) "H2 mass in tank";
  
protected
  parameter Real m_h2_at_max = p_max * 1e5 * V_tank * M_h2 / (R_gas * T_amb);
  parameter Real m_h2_at_min = p_min * 1e5 * V_tank * M_h2 / (R_gas * T_amb);
  parameter Real m_h2_usable = m_h2_at_max - m_h2_at_min;
  parameter Real m_h2_init = m_h2_at_min + soc0 * m_h2_usable;
  
equation
  // ──────────────────────────────────────────────────────────────────────────
  // Mass balance (with round-trip efficiency)
  // ──────────────────────────────────────────────────────────────────────────
  der(m_h2) = (h2_in * eta_rt - h2_out_demand) / 3600; // kg/h → kg/s
  
  // ──────────────────────────────────────────────────────────────────────────
  // Ideal gas law: p = m * R * T / (V * M)
  // ──────────────────────────────────────────────────────────────────────────
  pressure = max(0, min(p_max, m_h2 * R_gas * T_amb / (V_tank * M_h2) / 1e5));
  
  // State of charge
  soc = max(0, min(1, (m_h2 - m_h2_at_min) / m_h2_usable));
  
  // Output for monitoring
  h2_mass = m_h2;

  // Approximate deliverable flow from usable inventory over 1 hour horizon
  h2_available = max(0, (m_h2 - m_h2_at_min));
  
  annotation (
    Icon(coordinateSystem(preserveAspectRatio=false), graphics={
      Rectangle(extent={{-60,80},{60,-80}}, lineColor={0,0,0}, fillColor={255,213,127}, fillPattern=FillPattern.Solid),
      Rectangle(extent={{-50,60},{50,60*soc-60}}, lineColor={28,108,200}, fillColor={28,108,200}, fillPattern=FillPattern.Solid, 
        pattern=LinePattern.None),
      Text(extent={{-100,140},{100,100}}, textString="%name", textColor={0,0,255}),
      Text(extent={{-40,20},{40,-20}}, textString="H₂", textColor={0,0,0})}),
    Documentation(info="<html>
<h1>Storage Tank Model</h1>
<p>Compressed hydrogen storage using ideal gas approximation.</p>
<p>Tracks mass, pressure, and state-of-charge.</p>
<p>Supports different technologies via parameter selection (compressed, liquid, metal hydride).</p>
</html>"));
end Storage;

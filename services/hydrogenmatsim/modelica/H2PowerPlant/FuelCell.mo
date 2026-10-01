within H2PowerPlant;

model FuelCell "PEM/SOFC Fuel Cell with polarization curve"
  
  // ══════════════════════════════════════════════════════════════════════════
  // Parameters
  // ══════════════════════════════════════════════════════════════════════════
  parameter String tech_type = "pem" "Technology: pem, sofc, mcfc, pafc, alkaline";
  parameter Real P_rated(unit="kW") = 1000 "Rated AC output power";
  parameter Real eta_lhv(unit="1") = 0.58 "Nominal efficiency (LHV basis)";
  parameter Real P_min(unit="kW") = 50 "Minimum load";
  parameter Real q_h2_rated(unit="Nm3/h") = 200 "H2 flow at rated power";
  parameter Real p_op(unit="bar") = 2.5 "Operating pressure";
  parameter Real Q_cool(unit="kW") = 400 "Cooling capacity";
  
  // Fuel cell stack parameters (representative PEM)
  parameter Integer N_cells = 200 "Number of cells in stack";
  parameter Real A_cell(unit="cm2") = 400 "Active cell area";
  
  // Constants
  constant Real H2_LHV(unit="kW.h/Nm3") = 3.00 "H2 lower heating value";
  constant Real H2_density(unit="kg/m3") = 0.0899 "At STP";
  
  // ══════════════════════════════════════════════════════════════════════════
  // Connectors
  // ══════════════════════════════════════════════════════════════════════════
  Modelica.Blocks.Interfaces.RealInput h2_available(unit="kg/h") "H2 available from storage"
    annotation (Placement(transformation(extent={{-120,40},{-100,60}})));
    
  Modelica.Blocks.Interfaces.RealInput tank_pressure(unit="bar") "Storage pressure"
    annotation (Placement(transformation(extent={{-120,-60},{-100,-40}})));
    
  Modelica.Blocks.Interfaces.RealOutput P_output(unit="kW") "AC power output"
    annotation (Placement(transformation(extent={{100,60},{120,80}})));
    
  Modelica.Blocks.Interfaces.RealOutput h2_consumed(unit="kg/h") "H2 consumption rate"
    annotation (Placement(transformation(extent={{100,20},{120,40}})));
    
  Modelica.Blocks.Interfaces.RealOutput V_terminal(unit="V") "Stack terminal voltage"
    annotation (Placement(transformation(extent={{100,-20},{120,0}})));
    
  Modelica.Blocks.Interfaces.RealOutput i_density(unit="A/cm2") "Current density"
    annotation (Placement(transformation(extent={{100,-60},{120,-40}})));
    
  Modelica.Blocks.Interfaces.RealOutput efficiency(unit="1") "Instantaneous efficiency"
    annotation (Placement(transformation(extent={{100,-100},{120,-80}})));
  
  // ══════════════════════════════════════════════════════════════════════════
  // Internal variables
  // ══════════════════════════════════════════════════════════════════════════
  Real h2_nm3h "H2 available in Nm³/h";
  Real q_h2_demand "H2 demand at current load";
  Real P_candidate "Power before constraint checks";
  Real P_min_effective "Physically reachable minimum power";
  Boolean is_on "Fuel cell operating";
  Real V_cell "Single cell voltage";
  
equation
  // ──────────────────────────────────────────────────────────────────────────
  // Operating logic
  // ──────────────────────────────────────────────────────────────────────────
  h2_nm3h = h2_available / H2_density; // Convert kg/h → Nm³/h
  // Avoid infeasible operating logic when configured P_min is above
  // the maximum power possible from q_h2_rated and eta_lhv.
  P_min_effective = min(P_min, q_h2_rated * H2_LHV * eta_lhv * 0.98);
  
  is_on = h2_nm3h > 0.01 and tank_pressure > 1.5; // Need minimum pressure
  
  if is_on then
    // Demand-driven operation: try to match H2 availability
    q_h2_demand = min(q_h2_rated, h2_nm3h);
    P_candidate = q_h2_demand * H2_LHV * eta_lhv;
    
    if P_candidate >= P_min_effective then
      P_output = min(P_rated, P_candidate);
      h2_consumed = q_h2_demand * H2_density; // Convert back to kg/h
      
      // ── Polarization curve (simplified Butler-Volmer) ────────────────────
      i_density = min(2.0, max(0.01, P_output * 1000 / (N_cells * A_cell * 0.7)));
      V_cell = max(0.3, 0.72 - 0.055 * i_density); // Linear approximation
      V_terminal = V_cell * N_cells;
      
      efficiency = P_output / max(0.001, q_h2_demand * H2_LHV);
      
    else
      // Below minimum load → shut down
      P_output = 0;
      h2_consumed = 0;
      i_density = 0;
      V_cell = 0;
      V_terminal = 0;
      efficiency = 0;
    end if;
    
  else
    // Fuel cell off
    q_h2_demand = 0;
    P_candidate = 0;
    P_output = 0;
    h2_consumed = 0;
    i_density = 0;
    V_cell = 0;
    V_terminal = 0;
    efficiency = 0;
  end if;
  
  annotation (
    Icon(coordinateSystem(preserveAspectRatio=false), graphics={
      Rectangle(extent={{-100,100},{100,-100}}, lineColor={0,0,255}, fillColor={213,170,255}, fillPattern=FillPattern.Solid),
      Line(points={{-60,40},{-60,-40},{60,-40},{60,40},{-60,40}}, color={0,0,0}, thickness=1),
      Text(extent={{-60,20},{60,-20}}, textString="FC", textColor={0,0,0}),
      Text(extent={{-100,140},{100,100}}, textString="%name", textColor={0,0,255})}),
    Documentation(info="<html>
<h1>Fuel Cell Model</h1>
<p>Supports PEM, SOFC, MCFC, PAFC, and alkaline technologies.</p>
<p>Includes polarization curve approximation and efficiency calculation.</p>
<p>PEM: low-temperature (60-80°C), fast response, automotive/stationary</p>
<p>SOFC: high-temperature (600-1000°C), highest efficiency, CHP applications</p>
</html>"));
end FuelCell;

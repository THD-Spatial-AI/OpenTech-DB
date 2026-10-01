within H2PowerPlant;

model Electrolyzer "PEM/Alkaline/SOEC Electrolyzer with partial-load efficiency"
  
  // ══════════════════════════════════════════════════════════════════════════
  // Parameters
  // ══════════════════════════════════════════════════════════════════════════
  parameter String tech_type = "pem" "Technology: pem, alkaline, soec, aem";
  parameter Real P_rated(unit="kW") = 1000 "Rated AC input capacity";
  parameter Real eta_hhv(unit="1") = 0.70 "Nominal efficiency (HHV basis)";
  parameter Real P_min(unit="kW") = 50 "Minimum stable load";
  parameter Real P_max(unit="kW") = 1000 "Maximum load";
  parameter Real T_op(unit="degC") = 80 "Operating stack temperature";
  parameter Real q_water(unit="L/min") = 15 "DI water flow rate";
  parameter Real HHV(unit="kW.h/kg") = 39.4 "H2 higher heating value";
  
  // Constants
  constant Real H2_density(unit="kg/m3") = 0.0899 "H2 density at STP (Nm³)";
  
  // ══════════════════════════════════════════════════════════════════════════
  // Input/Output Connectors
  // ══════════════════════════════════════════════════════════════════════════
  Modelica.Blocks.Interfaces.RealInput P_source(unit="kW") "AC power from source" 
    annotation (Placement(transformation(extent={{-120,-10},{-100,10}})));
    
  Modelica.Blocks.Interfaces.RealOutput P_consumed(unit="kW") "Actual power consumed"
    annotation (Placement(transformation(extent={{100,60},{120,80}})));
    
  Modelica.Blocks.Interfaces.RealOutput h2_flow(unit="kg/h") "H2 mass flow rate"
    annotation (Placement(transformation(extent={{100,20},{120,40}})));
    
  Modelica.Blocks.Interfaces.RealOutput h2_flow_nm3h(unit="Nm3/h") "H2 volumetric flow rate"
    annotation (Placement(transformation(extent={{100,-20},{120,0}})));
    
  Modelica.Blocks.Interfaces.RealOutput efficiency(unit="1") "Instantaneous efficiency"
    annotation (Placement(transformation(extent={{100,-60},{120,-40}})));
  
  // ══════════════════════════════════════════════════════════════════════════
  // Internal variables
  // ══════════════════════════════════════════════════════════════════════════
  Real load_fraction "Power / P_rated";
  Real eta_actual "Actual efficiency accounting for partial load";
  Real eta_selected "Technology-selected pre-clamp efficiency";
  Boolean is_on "Electrolyzer operating status";
  
protected
  Real eta_pem;
  Real eta_alkaline;
  
equation
  // ──────────────────────────────────────────────────────────────────────────
  // Operating logic
  // ──────────────────────────────────────────────────────────────────────────
  is_on = P_source >= P_min and P_source <= P_max;
  
  if is_on then
    P_consumed = min(P_source, P_max);
    load_fraction = P_consumed / P_rated;
    
    // ── Partial-load efficiency model ─────────────────────────────────────
    // PEM: high efficiency at low loads, slight drop at overload
    eta_pem = eta_hhv * (0.90 + 0.10 * load_fraction);
    
    // Alkaline: efficiency penalty below 40% load
    if load_fraction < 0.4 then
      eta_alkaline = eta_hhv * min(1.0, 0.65 + 0.875 * load_fraction);
    else
      eta_alkaline = eta_hhv;
    end if;
    
    // Select model based on tech type
    if tech_type == "pem" or tech_type == "aem" then
      eta_selected = eta_pem;
    elseif tech_type == "alkaline" then
      eta_selected = eta_alkaline;
    elseif tech_type == "soec" then
      eta_selected = eta_hhv * 1.05; // SOEC benefits from thermal assist
    else
      eta_selected = eta_hhv;
    end if;
    
    // Clamp efficiency to physical bounds
    eta_actual = min(1.0, max(0.3, eta_selected));
    
    // H2 production rate (HHV basis)
    h2_flow = P_consumed * eta_actual / HHV;
    h2_flow_nm3h = h2_flow / H2_density;
    efficiency = eta_actual;
    
  else
    // Electrolyzer off
    P_consumed = 0;
    load_fraction = 0;
    eta_selected = 0;
    eta_actual = 0;
    eta_pem = 0;
    eta_alkaline = 0;
    h2_flow = 0;
    h2_flow_nm3h = 0;
    efficiency = 0;
  end if;
  
  annotation (
    Icon(coordinateSystem(preserveAspectRatio=false), graphics={
      Rectangle(extent={{-100,100},{100,-100}}, lineColor={0,0,255}, fillColor={170,213,255}, fillPattern=FillPattern.Solid),
      Text(extent={{-80,20},{80,-20}}, textString="ELZ", textColor={0,0,0}),
      Text(extent={{-100,140},{100,100}}, textString="%name", textColor={0,0,255})}),
    Documentation(info="<html>
<h1>Electrolyzer Model</h1>
<p>Supports PEM, Alkaline, SOEC, and AEM technologies.</p>
<p>Partial-load efficiency curves based on empirical data.</p>
<ul>
  <li>PEM: wide operating range (5-100%), fast response</li>
  <li>Alkaline: narrower range (20-100%), mature technology</li>
  <li>SOEC: high-temperature steam electrolysis, highest efficiency</li>
  <li>AEM: next-gen, PEM-like performance with lower cost</li>
</ul>
</html>"));
end Electrolyzer;

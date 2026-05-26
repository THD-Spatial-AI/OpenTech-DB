"""
scrapers/tech_metadata.py
=========================
OEO-aligned technology metadata lookup table.

Keys match ``technology_id`` values used across scraper config and catalogue
JSON files.  Each entry provides:

  name      – OEO-aligned human-readable display name
  carrier   – primary energy carrier (snake_case)
  oeo_class – canonical OEO class URI (closest available match)

This module is intentionally dependency-free so it can be imported from both
``scrapers/normalizer.py`` (for instance_name formatting) and
``scrapers/pipeline.py`` (for stub tech-card creation) without circular imports.
"""

_OEO = "http://openenergy-platform.org/ontology/oeo/"

#: Full metadata table.  Add new entries here when new tech_ids are introduced.
TECH_METADATA: dict[str, dict[str, str]] = {
    # ── SOLAR PV ─────────────────────────────────────────────────────────
    "solar_pv_utility": {
        "name":      "Solar PV Utility-scale",
        "carrier":   "solar",
        "oeo_class": _OEO + "OEO_00000165",
    },
    "solar_pv_distributed": {
        "name":      "Solar PV Distributed",
        "carrier":   "solar",
        "oeo_class": _OEO + "OEO_00000361",
    },
    "solar_pv_balcony": {
        "name":      "Solar PV Balcony (Plug-in / Balkonkraftwerk)",
        "carrier":   "solar",
        "oeo_class": _OEO + "OEO_00000361",
    },
    "solar_pv_bifacial": {
        "name":      "Solar PV Bifacial Module",
        "carrier":   "solar",
        "oeo_class": _OEO + "OEO_00000361",
    },
    "csp": {
        "name":      "Concentrated Solar Power (CSP)",
        "carrier":   "solar",
        "oeo_class": _OEO + "OEO_00000389",
    },
    "csp_parabolic_trough": {
        "name":      "CSP Parabolic Trough Power Plant",
        "carrier":   "solar",
        "oeo_class": _OEO + "OEO_00000389",
    },
    "csp_tower": {
        "name":      "CSP Solar Tower Power Plant",
        "carrier":   "solar",
        "oeo_class": _OEO + "OEO_00000389",
    },
    # ── WIND ─────────────────────────────────────────────────────────────
    "onshore_wind": {
        "name":      "Onshore Wind",
        "carrier":   "wind",
        "oeo_class": _OEO + "OEO_00000311",
    },
    "offshore_wind_fixed": {
        "name":      "Offshore Wind Fixed-bottom",
        "carrier":   "wind",
        "oeo_class": _OEO + "OEO_00000308",
    },
    "offshore_wind_floating": {
        "name":      "Offshore Wind Floating",
        "carrier":   "wind",
        "oeo_class": _OEO + "OEO_00000308",
    },
    "wind_repowering": {
        "name":      "Wind Turbine Repowering",
        "carrier":   "wind",
        "oeo_class": _OEO + "OEO_00000311",
    },
    # ── THERMAL / FOSSIL ─────────────────────────────────────────────────
    "ccgt": {
        "name":      "Combined Cycle Gas Turbine (CCGT)",
        "carrier":   "natural_gas",
        "oeo_class": _OEO + "OEO_00000184",
    },
    "ocgt": {
        "name":      "Open Cycle Gas Turbine (OCGT)",
        "carrier":   "natural_gas",
        "oeo_class": _OEO + "OEO_00000184",
    },
    "internal_combustion_engine": {
        "name":      "Internal Combustion Engine",
        "carrier":   "natural_gas",
        "oeo_class": _OEO + "OEO_00000184",
    },
    "coal_power_plant": {
        "name":      "Coal Power Plant",
        "carrier":   "coal",
        "oeo_class": _OEO + "OEO_00000089",
    },
    "coal_supercritical": {
        "name":      "Supercritical Coal Power Plant",
        "carrier":   "coal",
        "oeo_class": _OEO + "OEO_00000089",
    },
    "coal_with_ccs": {
        "name":      "Coal Power Plant with Carbon Capture (CCS)",
        "carrier":   "coal",
        "oeo_class": _OEO + "OEO_00010141",
    },
    "ccgt_with_ccs": {
        "name":      "CCGT with Carbon Capture (CCS)",
        "carrier":   "natural_gas",
        "oeo_class": _OEO + "OEO_00010141",
    },
    "hydrogen_gas_turbine": {
        "name":      "Hydrogen-Fired Gas Turbine",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00000184",
    },
    "diesel_generator": {
        "name":      "Diesel Generator",
        "carrier":   "diesel",
        "oeo_class": _OEO + "OEO_00000184",
    },
    # ── NUCLEAR ──────────────────────────────────────────────────────────
    "nuclear_conventional": {
        "name":      "Nuclear Power Plant (Conventional)",
        "carrier":   "uranium",
        "oeo_class": _OEO + "OEO_00000303",
    },
    "smr": {
        "name":      "Small Modular Reactor (SMR)",
        "carrier":   "uranium",
        "oeo_class": _OEO + "OEO_00000303",
    },
    "nuclear_fusion": {
        "name":      "Nuclear Fusion Power Plant",
        "carrier":   "uranium",
        "oeo_class": _OEO + "OEO_00000303",
    },
    # ── HYDRO ────────────────────────────────────────────────────────────
    "hydro_run_of_river": {
        "name":      "Hydroelectric Run-of-River",
        "carrier":   "hydro",
        "oeo_class": _OEO + "OEO_00010087",
    },
    "hydro_reservoir": {
        "name":      "Hydroelectric Reservoir",
        "carrier":   "hydro",
        "oeo_class": _OEO + "OEO_00010094",
    },
    "hydro_pumped_storage": {
        "name":      "Pumped Hydro Storage",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00010089",
    },
    "pumped_hydro_storage": {
        "name":      "Pumped Hydro Storage",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00010089",
    },
    # ── GEOTHERMAL ───────────────────────────────────────────────────────
    "geothermal_power": {
        "name":      "Geothermal Power Plant",
        "carrier":   "geothermal",
        "oeo_class": _OEO + "OEO_00000192",
    },
    "geothermal_flash": {
        "name":      "Geothermal Flash Steam Power Plant",
        "carrier":   "geothermal",
        "oeo_class": _OEO + "OEO_00000192",
    },
    "geothermal_enhanced": {
        "name":      "Enhanced Geothermal System (EGS)",
        "carrier":   "geothermal",
        "oeo_class": _OEO + "OEO_00000192",
    },
    # ── BIOMASS / BIOGAS / WASTE ──────────────────────────────────────────
    "biomass_power_plant": {
        "name":      "Biomass Power Plant",
        "carrier":   "biomass",
        "oeo_class": _OEO + "OEO_00000036",
    },
    "biomass_plant": {
        "name":      "Biomass Power Plant",
        "carrier":   "biomass",
        "oeo_class": _OEO + "OEO_00000036",
    },
    "biogas_power_plant": {
        "name":      "Biogas Power Plant",
        "carrier":   "biogas",
        "oeo_class": _OEO + "OEO_00000004",
    },
    "biogas_chp": {
        "name":      "Biogas CHP Plant",
        "carrier":   "biogas",
        "oeo_class": _OEO + "OEO_00240011",
    },
    "waste_to_energy": {
        "name":      "Waste-to-Energy Plant",
        "carrier":   "municipal_solid_waste",
        "oeo_class": _OEO + "OEO_00000440",
    },
    # ── MARINE ───────────────────────────────────────────────────────────
    "marine_energy": {
        "name":      "Marine Energy",
        "carrier":   "marine",
        "oeo_class": _OEO + "OEO_00010086",
    },
    "ocean_tidal": {
        "name":      "Tidal Energy",
        "carrier":   "marine",
        "oeo_class": _OEO + "OEO_00010086",
    },
    "ocean_wave": {
        "name":      "Wave Energy Converter",
        "carrier":   "marine",
        "oeo_class": _OEO + "OEO_00010086",
    },
    # ── ELECTRICITY STORAGE ──────────────────────────────────────────────
    "lithium_ion_bess": {
        "name":      "Lithium-Ion BESS",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000248",
    },
    "sodium_ion_bess": {
        "name":      "Sodium-Ion BESS",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000248",
    },
    "sodium_sulfur_batteries": {
        "name":      "Sodium-Sulfur Battery",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000377",
    },
    "lead_acid_batteries": {
        "name":      "Lead-Acid Battery",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00280014",
    },
    "redox_flow_batteries": {
        "name":      "Redox Flow Battery",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000169",
    },
    "compressed_air_storage": {
        "name":      "Compressed Air Energy Storage (CAES)",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00020250",
    },
    "caes": {
        "name":      "Compressed Air Energy Storage (CAES)",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00020250",
    },
    "laes": {
        "name":      "Liquid Air Energy Storage (LAES)",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000399",
    },
    "gravity_storage": {
        "name":      "Gravity Energy Storage",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000399",
    },
    "flywheel_storage": {
        "name":      "Flywheel Energy Storage",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000399",
    },
    "flywheels": {
        "name":      "Flywheel Energy Storage",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000399",
    },
    "supercapacitor": {
        "name":      "Supercapacitor Energy Storage",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000248",
    },
    # ── THERMAL STORAGE ──────────────────────────────────────────────────
    "sensible_thermal_storage": {
        "name":      "Sensible Thermal Storage",
        "carrier":   "heat",
        "oeo_class": _OEO + "OEO_00310037",
    },
    "latent_thermal_storage": {
        "name":      "Latent Thermal Storage",
        "carrier":   "heat",
        "oeo_class": _OEO + "OEO_00310043",
    },
    "thermal_energy_storage": {
        "name":      "Thermal Energy Storage",
        "carrier":   "heat",
        "oeo_class": _OEO + "OEO_00310037",
    },
    # ── HYDROGEN STORAGE ─────────────────────────────────────────────────
    "hydrogen_storage_tank": {
        "name":      "Compressed Hydrogen Storage Tank",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00020363",
    },
    "hydrogen_storage_tanks": {
        "name":      "Hydrogen Storage Tanks",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00020363",
    },
    "hydrogen_underground_storage": {
        "name":      "Hydrogen Underground Storage",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00000429",
    },
    # ── ELECTROLYZERS ────────────────────────────────────────────────────
    "alkaline_electrolyzer_awe": {
        "name":      "Alkaline Water Electrolyzer (AWE)",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00010021",
    },
    "pem_electrolyzer": {
        "name":      "Proton Exchange Membrane Electrolyzer (PEM)",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00010021",
    },
    "solid_oxide_electrolyzer": {
        "name":      "Solid Oxide Electrolyzer Cell (SOEC)",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00010021",
    },
    "soec_electrolyzer": {
        "name":      "Solid Oxide Electrolyzer Cell (SOEC)",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00010021",
    },
    # ── FUEL CELLS ───────────────────────────────────────────────────────
    "pem_fuel_cell": {
        "name":      "PEM Fuel Cell",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00140134",
    },
    "sofc_fuel_cell": {
        "name":      "Solid Oxide Fuel Cell (SOFC)",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00000016",
    },
    "hydrogen_fuel_cell_stationary": {
        "name":      "Stationary Hydrogen Fuel Cell",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00140134",
    },
    # ── HEAT PUMPS ───────────────────────────────────────────────────────
    "air_source_heat_pump": {
        "name":      "Air-Source Heat Pump",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000009",
    },
    "ground_source_heat_pump": {
        "name":      "Ground-Source Heat Pump",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000009",
    },
    "industrial_heat_pump": {
        "name":      "Industrial High-Temperature Heat Pump",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000009",
    },
    # ── HEATING / THERMAL CONVERSION ─────────────────────────────────────
    "electric_boilers": {
        "name":      "Electric Boiler",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00310015",
    },
    "gas_boiler": {
        "name":      "Gas Boiler",
        "carrier":   "natural_gas",
        "oeo_class": _OEO + "OEO_00310015",
    },
    "solar_thermal_collector": {
        "name":      "Solar Thermal Collector",
        "carrier":   "solar",
        "oeo_class": _OEO + "OEO_00000389",
    },
    "district_heating": {
        "name":      "District Heating Network",
        "carrier":   "heat",
        "oeo_class": _OEO + "OEO_00020005",
    },
    "district_heating_networks": {
        "name":      "District Heating Network",
        "carrier":   "heat",
        "oeo_class": _OEO + "OEO_00020005",
    },
    # ── CHP ──────────────────────────────────────────────────────────────
    "chp_gas": {
        "name":      "Combined Heat and Power (CHP)",
        "carrier":   "natural_gas",
        "oeo_class": _OEO + "OEO_00240011",
    },
    "biomass_chp": {
        "name":      "Biomass CHP",
        "carrier":   "biomass",
        "oeo_class": _OEO + "OEO_00240011",
    },
    # ── POWER-TO-X ───────────────────────────────────────────────────────
    "methanation": {
        "name":      "Methanation Reactor (Power-to-Gas)",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00000269",
    },
    "methanation_reactors": {
        "name":      "Methanation Reactor",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00000269",
    },
    "ammonia_synthesis": {
        "name":      "Ammonia Synthesis (Haber-Bosch)",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00330010",
    },
    "haber_bosch_process": {
        "name":      "Haber-Bosch Process",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00330010",
    },
    "fischer_tropsch_synthesis": {
        "name":      "Fischer-Tropsch Synthesis",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00010020",
    },
    "biomass_gasification": {
        "name":      "Biomass Gasification",
        "carrier":   "biomass",
        "oeo_class": _OEO + "OEO_00010020",
    },
    # ── CARBON CAPTURE ───────────────────────────────────────────────────
    "direct_air_capture": {
        "name":      "Direct Air Capture (DAC)",
        "carrier":   "co2",
        "oeo_class": _OEO + "OEO_00010139",
    },
    "post_combustion_ccs": {
        "name":      "Post-Combustion Carbon Capture",
        "carrier":   "co2",
        "oeo_class": _OEO + "OEO_00010141",
    },
    "carbon_capture_systems": {
        "name":      "Carbon Capture System",
        "carrier":   "co2",
        "oeo_class": _OEO + "OEO_00010141",
    },
    "biomass_ccs_beccs": {
        "name":      "Bioenergy with Carbon Capture and Storage (BECCS)",
        "carrier":   "biomass",
        "oeo_class": _OEO + "OEO_00010141",
    },
    # ── EV / H2 TRANSPORT ────────────────────────────────────────────────
    "ev_charging_station": {
        "name":      "Electric Vehicle (EV) Charging Station",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000009",
    },
    "vehicle_to_grid": {
        "name":      "Vehicle-to-Grid (V2G) System",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000009",
    },
    "hydrogen_refueling_station": {
        "name":      "Hydrogen Refueling Station",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00020363",
    },
    # ── DEMAND-SIDE / EFFICIENCY ──────────────────────────────────────────
    "demand_response": {
        "name":      "Demand Response System",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000009",
    },
    "building_insulation": {
        "name":      "Building Thermal Insulation",
        "carrier":   "heat",
        "oeo_class": _OEO + "OEO_00000009",
    },
    "led_lighting": {
        "name":      "LED Lighting System",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000009",
    },
    # ── TRANSMISSION ─────────────────────────────────────────────────────
    "hvac_overhead_lines": {
        "name":      "HVAC Overhead Transmission Line",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000047",
    },
    "hvdc_overhead_lines": {
        "name":      "HVDC Overhead Transmission Line",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000127",
    },
    "hvac_underground_cables": {
        "name":      "HVAC Underground Cable",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000047",
    },
    "hvdc_subsea_cables": {
        "name":      "HVDC Subsea Cable",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000127",
    },
    "hvdc_transmission": {
        "name":      "HVDC Transmission Line",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000127",
    },
    "hvac_transmission": {
        "name":      "HVAC Transmission Line",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000047",
    },
    "offshore_hvdc_cable": {
        "name":      "Offshore HVDC Subsea Cable",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000127",
    },
    "smart_grid_infrastructure": {
        "name":      "Smart Grid Infrastructure",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000047",
    },
    "transmission_transformers": {
        "name":      "Transmission Transformer",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000420",
    },
    "distribution_transformers": {
        "name":      "Distribution Transformer",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000420",
    },
    "natural_gas_pipelines": {
        "name":      "Natural Gas Pipeline",
        "carrier":   "natural_gas",
        "oeo_class": _OEO + "OEO_00020007",
    },
    "hydrogen_pipelines": {
        "name":      "Hydrogen Pipeline",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00020006",
    },
    "co2_pipelines": {
        "name":      "CO2 Pipeline",
        "carrier":   "co2",
        "oeo_class": _OEO + "OEO_00020006",
    },
    "district_cooling_pipeline": {
        "name":      "District Cooling Pipeline",
        "carrier":   "cooling",
        "oeo_class": _OEO + "OEO_00020005",
    },
    "hydrogen_tube_trailer": {
        "name":      "Hydrogen Tube Trailer Transport",
        "carrier":   "hydrogen",
        "oeo_class": _OEO + "OEO_00020006",
    },
    "biogas_pipeline": {
        "name":      "Biogas Pipeline",
        "carrier":   "biogas",
        "oeo_class": _OEO + "OEO_00020007",
    },
    "biomass_truck_transport": {
        "name":      "Biomass Truck Transport",
        "carrier":   "biomass",
        "oeo_class": _OEO + "OEO_00150002",
    },
    "biomass_rail_transport": {
        "name":      "Biomass Rail Transport",
        "carrier":   "biomass",
        "oeo_class": _OEO + "OEO_00150002",
    },
    "oil_pipeline": {
        "name":      "Oil Pipeline",
        "carrier":   "oil",
        "oeo_class": _OEO + "OEO_00020007",
    },
    "fuel_tanker_truck": {
        "name":      "Fuel Tanker Truck",
        "carrier":   "oil",
        "oeo_class": _OEO + "OEO_00150002",
    },
    "water_pipeline": {
        "name":      "Water Transmission Pipeline",
        "carrier":   "water",
        "oeo_class": _OEO + "OEO_00020005",
    },
    "steam_network": {
        "name":      "Steam District Network",
        "carrier":   "steam",
        "oeo_class": _OEO + "OEO_00020005",
    },
    "industrial_process_heat_networks": {
        "name":      "Industrial Process Heat Network",
        "carrier":   "heat",
        "oeo_class": _OEO + "OEO_00020005",
    },
    "geothermal_heat_networks": {
        "name":      "Geothermal Heat Distribution Network",
        "carrier":   "heat",
        "oeo_class": _OEO + "OEO_00020005",
    },
    "heat_network_substations": {
        "name":      "Heat Network Substation",
        "carrier":   "heat",
        "oeo_class": _OEO + "OEO_00000420",
    },
    "mv_distribution_cables": {
        "name":      "MV Distribution Cable",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000047",
    },
    "lv_distribution_cables": {
        "name":      "LV Distribution Cable",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000047",
    },
    "hv_mv_substations": {
        "name":      "HV/MV Electricity Substation",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000420",
    },
    "mv_lv_secondary_substations": {
        "name":      "MV/LV Secondary Distribution Substation",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000420",
    },
    "statcom": {
        "name":      "STATCOM (Static Synchronous Compensator)",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000047",
    },
    "svc": {
        "name":      "SVC (Static VAR Compensator)",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000047",
    },
    "hvdc_converter_station": {
        "name":      "HVDC Converter Station",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000127",
    },
    "hv_switchgear": {
        "name":      "High Voltage Switchgear",
        "carrier":   "electricity",
        "oeo_class": _OEO + "OEO_00000420",
    },
}


def get_display_name(technology_id: str) -> str:
    """Return the OEO-aligned display name for *technology_id*.

    Falls back to a title-cased version of the slug for unknown IDs.
    """
    meta = TECH_METADATA.get(technology_id)
    if meta:
        return meta["name"]
    return technology_id.replace("_", " ").title()

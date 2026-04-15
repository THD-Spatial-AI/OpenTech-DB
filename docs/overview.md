# Overview

## Design Principles

- **OEO Alignment** — every technology record carries `oeo_class` and `oeo_uri` fields linking to [Open Energy Ontology](https://openenergy-platform.org/ontology/oeo/) concepts.
- **Multi-instance** — a single technology (e.g. Gas Turbine) stores multiple `EquipmentInstance` rows: different manufacturers, vintages, or projection scenarios.
- **Uncertainty-aware** — every parameter is a `ParameterValue` object with `value`, `unit`, `min`, `max`, `source`, and `year`.
- **Framework-agnostic** — built-in adapter modules translate OEO records into PyPSA and Calliope parameter dicts.
- **Time-series profiles** — hourly capacity factors and load profiles linked to VRE records via the time-series catalogue.
- **Contributor workflow** — authenticated researchers can submit new technologies and profiles; admins review and approve.

---

## Technology Coverage

### Generation (21 technologies)

| Technology | Carrier | Type |
|---|---|---|
| Solar PV Utility-scale | solar | VRE |
| Solar PV Distributed (16 instances: 1 kW – 1 MW) | solar | VRE |
| Solar PV Balcony / Balkonkraftwerk (6 instances: 300 Wp – 2 kWp) | solar | VRE |
| Concentrated Solar Power (CSP) | solar | Dispatchable |
| Onshore Wind (12 instances: 3 MW – 600 MW) | wind | VRE |
| Offshore Wind Fixed-bottom (10 instances) | wind | VRE |
| Offshore Wind Floating (8 instances) | wind | VRE |
| Hydroelectric Run-of-River | hydro | VRE |
| Hydroelectric Reservoir | hydro | Dispatchable |
| Combined Cycle Gas Turbine (CCGT) | natural_gas | Dispatchable |
| Open Cycle Gas Turbine (OCGT) | natural_gas | Dispatchable |
| Internal Combustion Engine | natural_gas | Dispatchable |
| Coal Power Plant | coal | Dispatchable |
| Nuclear Power Conventional | nuclear_fuel | Dispatchable |
| Small Modular Reactors (SMR) | nuclear_fuel | Dispatchable |
| Geothermal Power | geothermal | Dispatchable |
| Biomass Power Plant | biomass | Dispatchable |
| Biogas Power Plant | biomass | Dispatchable |
| Waste-to-Energy | biomass | Dispatchable |
| Marine Energy | marine | VRE |

### Storage (12 technologies)

Lithium-ion BESS · Redox Flow Batteries · Sodium-Sulfur Batteries · Lead-Acid Batteries · Pumped Hydro Storage · CAES · LAES · Flywheels · Sensible Thermal Storage · Latent Thermal Storage · Hydrogen Storage Tanks · Hydrogen Underground Storage

### Conversion & Sector Coupling (15 technologies)

Alkaline Electrolyzer (AWE) · PEM Electrolyzer · Solid Oxide Electrolyzer (SOEC) · PEM Fuel Cell · Solid Oxide Fuel Cell (SOFC) · Air-Source Heat Pump · Ground-Source Heat Pump · Electric Boilers · CHP · Biomass CHP · Methanation · Fischer-Tropsch Synthesis · Haber-Bosch Process · Direct Air Capture (DAC) · Carbon Capture Systems

### Transmission & Distribution (30 technologies)

HVAC Overhead Lines · HVDC Overhead Lines · HVAC Underground Cables · HVDC Subsea Cables · Transmission & Sub-Transmission Transformers · Distribution Transformers · Natural Gas Pipelines · Hydrogen Pipelines · CO₂ Pipelines · District Heating Networks · District Cooling Pipeline · Hydrogen Tube Trailer · Biogas Pipeline · Biomass Truck/Rail Transport · Oil Pipeline · Water Pipeline · Steam Network · Industrial Process Heat Networks · Geothermal Heat Distribution Networks · Heat Network Substations · MV/LV Distribution Cables · HV/MV Substations · MV/LV Secondary Substations · STATCOM · SVC · HVDC Converter Stations · High Voltage Switchgear (GIS & AIS)

---

## Data Sources

| Source | Used for |
|---|---|
| NREL Annual Technology Baseline (ATB) 2023 | Generation & storage cost/performance |
| IRENA Renewable Power Generation Costs 2023 | Generation CAPEX & LCOE |
| Lazard LCOE Analysis v16.0 (2023) | Cost benchmarking |
| IEA World Energy Outlook 2023 | Projections, gas & nuclear |
| ENTSO-E TYNDP 2022 | Transmission costs |
| CIGRE Technical Brochure TB 812 | HVDC economics |
| IEA Global Hydrogen Review 2023 | Electrolyzers, H₂ storage |
| BloombergNEF Energy Storage Outlook 2023 | BESS costs |
| PNNL Grid Energy Storage Assessment 2022 | Storage benchmarks |
| EU Hydrogen Backbone Study 2021 | H₂ pipelines |
| IPCC AR6 | CO₂ emission factors |

---

## Project Structure

```
opentech-db/
├── main.py                        # FastAPI entry point
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── data/                          # Technology data (JSON)
│   ├── generation/
│   ├── storage/
│   ├── transmission/
│   ├── conversion/
│   └── timeseries/
├── schemas/models.py              # Pydantic models (OEO-aligned)
├── api/
│   ├── routes.py                  # Technology CRUD, admin, submissions
│   ├── auth.py                    # ORCID OAuth + JWT
│   └── timeseries.py              # Time-series catalogue
├── adapters/
│   ├── pypsa_adapter.py
│   └── calliope_adapter.py
├── frontend/                      # React 19 SPA (TypeScript + Vite 8)
└── documentation/                 # arc42 architecture docs (LaTeX)
```

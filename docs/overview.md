# Overview

## Design Principles

- **OEO Alignment** — every technology record carries `oeo_class` and `oeo_uri` fields linking to [Open Energy Ontology](https://openenergy-platform.org/ontology/oeo/) concepts, enabling semantic interoperability with the Open Energy Platform.
- **Multi-instance** — a single technology (e.g. Gas Turbine) stores multiple `EquipmentInstance` rows: different manufacturers, vintages, or projection scenarios. Each instance carries its own complete parameter set.
- **Uncertainty-aware** — every parameter is a `ParameterValue` object with `value`, `unit`, `min`, `max`, `source`, and `year`, enabling transparent uncertainty quantification in model results.
- **Framework-agnostic** — built-in adapter modules translate OEO records into PyPSA-ready component dicts and Calliope-ready YAML config blocks.
- **Time-series profiles** — hourly capacity factors and load profiles linked to VRE records via the time-series catalogue, covering 8+ European countries.
- **Automated data acquisition** — a background scraper pipeline pulls parameter data from academic databases (OpenAlex, Semantic Scholar, NREL ATB, IRENA) and extracts structured values using regex and optional LLM extraction.
- **Contributor workflow** — authenticated researchers can submit new technologies and profiles; admins review and approve submissions before they enter the catalogue.
- **Geographic context** — technology instances carry country-level metadata enabling world-map visualisation of where data originates from.

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

## Fraunhofer ISE / Academic Sources

The following sources are also used for European and global parameter references:

| Source | Used for |
|---|---|
| Fraunhofer ISE Reports | PV and wind (European focus) |
| IPCC AR6 WG3 | CO₂ lifecycle emission factors |
| EIA Annual Energy Outlook | US gas and coal parameters |
| PNNL Grid Energy Storage Assessment 2022 | Storage benchmarks |
| EU Hydrogen Backbone Study 2021 | H₂ pipeline infrastructure |

---

## Project Structure

```
opentech-db/
├── main.py                        # FastAPI entry point (lifespan, CORS, routers)
├── requirements.txt               # Python dependencies
├── Dockerfile                     # Two-stage container build (python:3.11-slim)
├── docker-compose.yml             # Single-service Compose stack
├── render.yaml                    # Render.com PaaS deployment config
├── scraper_config.yaml            # Scraper schedule, sources, and extraction settings
│
├── schemas/
│   └── models.py                  # Pydantic v2 models: Technology hierarchy,
│                                  #   EquipmentInstance, ParameterValue, enums
│
├── api/
│   ├── routes.py                  # Technology CRUD + debug + ontology + admin routers
│   ├── auth.py                    # ORCID OAuth 2.0 + JWT issuance + /auth/me
│   ├── timeseries.py              # Time-series catalogue: list, data, submit, approve
│   └── scraper_routes.py          # Scraper management: status, run, candidates, review
│
├── adapters/
│   ├── pypsa_adapter.py           # Technology → PyPSA component dict (CRF annualisation)
│   └── calliope_adapter.py        # Technology → Calliope YAML config block
│
├── scrapers/
│   ├── pipeline.py                # Orchestrates full scrape-extract-normalise-store cycle
│   ├── scheduler.py               # APScheduler integration (twice-monthly runs)
│   ├── base.py                    # BaseScraper: HTTP client, rate limiting, disk cache
│   ├── normalizer.py              # Raw extractions → catalogue-format candidate instances
│   ├── storage.py                 # Candidate storage: Supabase primary / file fallback
│   ├── config.py                  # ScraperConfig from scraper_config.yaml + env overrides
│   ├── sources/                   # Per-source scrapers (OpenAlex, Semantic Scholar, etc.)
│   └── extractors/                # Text / PDF / LLM parameter extractors
│
├── data/
│   ├── generation/                # generation_technologies.json (21+ techs)
│   ├── storage/                   # storage_technologies.json (12+ techs)
│   ├── transmission/              # transmission_technologies.json (30+ techs)
│   ├── conversion/                # conversion_technologies.json (15+ techs)
│   └── timeseries/                # Hourly profile JSONs + timeseries_catalogue.json
│
├── db/
│   └── migrations/                # SQL migrations for Supabase schema
│
├── frontend/                      # React 19 SPA (TypeScript + Vite 8 + TailwindCSS)
│   └── src/
│       ├── components/            # TechGrid, TechCard, DetailsModal, WorldMap, Admin…
│       ├── services/              # API client (promise memoisation for React use() hook)
│       ├── context/               # AuthContext: ORCID JWT + Supabase session
│       └── types/                 # TypeScript interfaces for API responses
│
├── docs/                          # MkDocs documentation (this site)
└── documentation/                 # arc42 architecture docs (LaTeX/PDF)
```

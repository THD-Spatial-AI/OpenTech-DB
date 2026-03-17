# OpenTech-db

> An **Open Energy Ontology (OEO)-aligned** repository and REST API that stores, manages, and distributes
> technical and economic parameters for energy **generation, storage, transmission, and conversion**
> technologies. Designed to feed real, traceable data into energy modelling frameworks:
> **Calliope**, **PyPSA**, **OSeMOSYS**, and **ADOPTNet0**.

[![Python](https://img.shields.io/badge/python-3.11%2B-blue)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688)](https://fastapi.tiangolo.com/)
[![License: CC BY 4.0](https://img.shields.io/badge/License-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)
[![OEO](https://img.shields.io/badge/ontology-OEO-green)](https://openenergy-platform.org/ontology/oeo/)

---

## 🌐 Live API — No Setup Required

A hosted instance is publicly available. You can start querying technology data right now without cloning or running anything locally.

| | URL |
|---|---|
| **Base URL** | `https://marleigh-unmuttering-effortlessly.ngrok-free.dev/api/v1` |
| **Interactive docs (Swagger)** | https://marleigh-unmuttering-effortlessly.ngrok-free.dev/docs |
| **ReDoc** | https://marleigh-unmuttering-effortlessly.ngrok-free.dev/redoc |
| **Health check** | https://marleigh-unmuttering-effortlessly.ngrok-free.dev/health |

> **Note:** When calling from code (not a browser), add the header `ngrok-skip-browser-warning: true` to skip the ngrok interstitial page.

### Try it immediately (no install needed)

```bash
# List all generation technologies
curl -H "ngrok-skip-browser-warning: true" \
  "https://marleigh-unmuttering-effortlessly.ngrok-free.dev/api/v1/technologies/category/generation"

# Get full data for onshore wind (all instances)
curl -H "ngrok-skip-browser-warning: true" \
  "https://marleigh-unmuttering-effortlessly.ngrok-free.dev/api/v1/technologies/onshore_wind"

# Get a PyPSA-ready parameter dict for a CCGT plant
curl -H "ngrok-skip-browser-warning: true" \
  "https://marleigh-unmuttering-effortlessly.ngrok-free.dev/api/v1/adapt/pypsa/ccgt?instance_index=0&discount_rate=0.07"
```

```python
import requests

BASE    = "https://marleigh-unmuttering-effortlessly.ngrok-free.dev/api/v1"
HEADERS = {"ngrok-skip-browser-warning": "true"}

# Get all storage technologies
techs = requests.get(f"{BASE}/technologies/category/storage", headers=HEADERS).json()
for t in techs["technologies"]:
    print(t["technology_id"], "–", t["technology_name"])
```

---

## Table of Contents

- [Live API — No Setup Required](#-live-api--no-setup-required)
- [Overview](#overview)
- [Technology Coverage](#technology-coverage)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Integration Guide](#integration-guide)
- [Data Model](#data-model)
- [JSON Data Formats](#json-data-formats)
- [Adding a New Technology](#adding-a-new-technology)
- [Framework Adapters](#framework-adapters)
- [OEO Alignment](#oeo-alignment)
- [Data Sources](#data-sources)
- [Architecture Documentation](#architecture-documentation)
- [License](#license)

---

## Overview

`opentech-db` is a domain-specific data repository and REST API that provides **standardised, source-traced technical and economic parameters** for energy system components. It serves as a single source of truth that multiple energy modelling frameworks can query programmatically — eliminating the scattered spreadsheet-per-model workflow.

Key design principles:

- **OEO Alignment** — every technology record carries `oeo_class` and `oeo_uri` fields linking directly to [Open Energy Ontology](https://openenergy-platform.org/ontology/oeo/) concepts.
- **Multi-instance** — a single technology (e.g. Gas Turbine) stores multiple `EquipmentInstance` rows: different manufacturers, vintages, or projection scenarios.
- **Uncertainty-aware** — every parameter is a `ParameterValue` object with `value`, `unit`, `min`, `max`, `source`, and `year`.
- **Framework-agnostic** — built-in adapter modules translate OEO records into PyPSA and Calliope parameter dicts.

---

## Technology Coverage

### Generation (21 technologies)
| Technology | Carrier | Type |
|---|---|---|
| Solar PV Utility-scale | solar | VRE |
| Solar PV Distributed (16 instances: 1 kW – 1 MW) | solar | VRE |
| Solar PV Balcony / Balkonkraftwerk (6 instances: 300 Wp – 2 kWp) | solar | VRE |
| Concentrated Solar Power (CSP) | solar | Dispatchable |
| Onshore Wind (12 instances: 3 MW community – 600 MW US Plains) | wind | VRE |
| Offshore Wind Fixed-bottom (10 instances: Baltic nearshore – 1.5 GW gigafarm) | wind | VRE |
| Offshore Wind Floating (8 instances: Hywind spar – 1 GW next-gen) | wind | VRE |
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

### Transmission & Distribution (9 technologies)
HVAC Overhead Lines · HVDC Overhead Lines · HVAC Underground Cables · HVDC Subsea Cables · Electrical Transformers · Natural Gas Pipelines · Hydrogen Pipelines · CO₂ Pipelines · District Heating Networks

---

## Project Structure

```
opentech-db/
│
├── main.py                        # FastAPI application entry point
├── requirements.txt
├── Dockerfile                     # Container image definition
├── docker-compose.yml             # Compose stack (API + volume mount)
│
├── data/                          # Technology data (JSON – catalogue format)
│   ├── generation/
│   │   └── generation_technologies.json    # 19 technologies
│   ├── storage/
│   │   └── storage_technologies.json       # 12 technologies
│   ├── transmission/
│   │   └── transmission_technologies.json  # 9 technologies
│   └── conversion/
│       └── conversion_technologies.json    # 15 technologies
│
├── schemas/
│   └── models.py                  # Pydantic models (OEO-aligned)
│
├── api/
│   └── routes.py                  # FastAPI router + dual-format data loader
│
├── adapters/
│   ├── pypsa_adapter.py           # OEO Technology → PyPSA component dict
│   └── calliope_adapter.py        # OEO Technology → Calliope YAML-ready dict
│
└── documentation/                 # arc42 architecture documentation (LaTeX)
    ├── main.tex
    ├── references.bib
    └── content/
        ├── 01-introduction-goals.md
        ├── 02-constraints.md
        ├── 03-context-scope.md
        ├── ...
        └── 12-glossary.md
```

---

## Quick Start

### Option A — Local (Python / conda)

```bash
# 1 – Clone the repository
git clone https://mygit.th-deg.de/thd-spatial-ai/opentech-db.git
cd opentech-db

# 2 – Create and activate a virtual environment
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux / macOS
source .venv/bin/activate

# 3 – Install dependencies
pip install -r requirements.txt

# 4 – Start the API server (hot-reload enabled)
uvicorn main:app --reload --port 8000
```

### Option B — Docker

```bash
# Build and start the container
docker compose up --build

# Or without docker-compose
docker build -t opentech-db .
docker run -p 8000:8000 -v ./data:/app/data opentech-db
```

> Mounting `data/` as a volume allows updating JSON files without rebuilding the image.

Interactive docs available at:
- **Swagger UI** → http://127.0.0.1:8000/docs
- **ReDoc** → http://127.0.0.1:8000/redoc
- **OpenAPI JSON** → http://127.0.0.1:8000/openapi.json

---

## API Reference

### Technology Catalogue

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/technologies` | List all technologies (paginated) |
| `GET` | `/api/v1/technologies/{id}` | Full technology detail |
| `GET` | `/api/v1/technologies/category/{cat}` | Filter by category |
| `GET` | `/api/v1/technologies/{id}/instances` | All equipment instances for a technology |
| `GET` | `/api/v1/technologies/{id}/instances/{iid}` | One specific equipment instance |

**Query parameters:**

| Parameter | Endpoint | Description |
|---|---|---|
| `skip` | list endpoints | Pagination offset (default: `0`) |
| `limit` | list endpoints | Max results (default: `50`, max: `200`) |
| `tag` | `/technologies` | Filter by tag string |
| `lifecycle` | `/instances` | Filter by stage: `commercial`, `projection`, `demonstration` |

**Valid category values:** `generation` · `storage` · `transmission` · `conversion`

### Calliope Adapter Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/technologies/calliope` | All technologies as a Calliope `techs:` block |
| `GET` | `/api/v1/technologies/calliope?category=generation` | Filtered by category |
| `GET` | `/api/v1/technologies/{id}/calliope` | Single technology in Calliope format |
| `POST` | `/api/v1/technologies/{id}/calliope` | Single technology + constraint/cost overrides |

Calliope query parameters: `instance_index` (int, default `0`), `cost_class` (str, default `"monetary"`).

### Framework Adapters

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/adapt/pypsa/{id}` | PyPSA-ready parameter dict |
| `GET` | `/api/v1/adapt/calliope/{id}` | Calliope-ready config dict |

Adapter query parameters: `instance_index` (int, default `0`), `discount_rate` (float, PyPSA only), `cost_class` (str, Calliope only).

### Diagnostics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/debug/data` | Inspect loading status of all JSON files |
| `POST` | `/api/v1/debug/reload` | Clear cache and reload all files from disk |
| `GET` | `/health` | Service health check + version |

---

## Integration Guide

This section shows how external tools — scripts, notebooks, modelling frameworks — can retrieve technology data from `opentech-db` at runtime. The API is plain HTTP + JSON; **no special client library is needed**.

**Base URLs:**

| Instance | Base URL |
|---|---|
| **Hosted (public)** | `https://marleigh-unmuttering-effortlessly.ngrok-free.dev/api/v1` |
| Local Python / conda | `http://localhost:8000/api/v1` |
| Docker | `http://localhost:8000/api/v1` |

> When calling the hosted URL from code (not a browser), always include the header:
> `ngrok-skip-browser-warning: true`

---

### HTTP / curl

```bash
BASE="https://marleigh-unmuttering-effortlessly.ngrok-free.dev/api/v1"
HDR='-H "ngrok-skip-browser-warning: true"'

# --- List all technologies ---
curl $HDR "$BASE/technologies"

# --- Get one technology by ID ---
curl $HDR "$BASE/technologies/onshore_wind"

# --- Filter by category (generation | storage | transmission | conversion) ---
curl $HDR "$BASE/technologies/category/generation"

# --- Get all instances of a technology ---
curl $HDR "$BASE/technologies/onshore_wind/instances"

# --- Get a specific instance by ID ---
curl $HDR "$BASE/technologies/solar_pv_distributed/instances/solar_pv_3kw_residential_topcon"

# --- Get all generation technologies as a Calliope techs: block ---
curl $HDR "$BASE/technologies/calliope?category=generation"

# --- PyPSA-ready dict for CCGT instance 0, 7% discount rate ---
curl $HDR "$BASE/adapt/pypsa/ccgt?instance_index=0&discount_rate=0.07"
```

---

### Python — `requests`

```python
import requests

BASE    = "https://marleigh-unmuttering-effortlessly.ngrok-free.dev/api/v1"
HEADERS = {"ngrok-skip-browser-warning": "true"}   # required for hosted URL

# 1 – Browse all generation technologies
resp = requests.get(f"{BASE}/technologies/category/generation", headers=HEADERS)
resp.raise_for_status()
catalogue = resp.json()            # {"total": N, "technologies": [...]}

for tech in catalogue["technologies"]:
    print(tech["technology_id"], "–", tech["technology_name"])

# 2 – Fetch one technology and inspect its instances
resp = requests.get(f"{BASE}/technologies/onshore_wind", headers=HEADERS)
resp.raise_for_status()
tech = resp.json()

for inst in tech["instances"]:
    print(
        inst["instance_id"],
        f"| {inst['typical_capacity_mw']} MW",
        f"| CAPEX {inst['capex_usd_per_kw']} USD/kW",
        f"| CF {inst['efficiency_percent']} %",
    )

# 3 – Fetch a PyPSA-ready parameter dict
resp = requests.get(
    f"{BASE}/adapt/pypsa/ccgt",
    params={"instance_index": 0, "discount_rate": 0.07},
    headers=HEADERS,
)
params = resp.json()["parameters"]
# → {'carrier': 'natural_gas', 'efficiency': 0.58, 'capital_cost': ..., ...}
```

---

### Python — `pandas` (bulk exploration)

```python
import pandas as pd
import requests

BASE    = "https://marleigh-unmuttering-effortlessly.ngrok-free.dev/api/v1"
HEADERS = {"ngrok-skip-browser-warning": "true"}

def fetch_all_instances(category: str) -> pd.DataFrame:
    """Return a flat DataFrame of every technology instance in a category."""
    resp = requests.get(f"{BASE}/technologies/category/{category}", headers=HEADERS)
    resp.raise_for_status()
    rows = []
    for tech in resp.json()["technologies"]:
        detail = requests.get(
            f"{BASE}/technologies/{tech['technology_id']}", headers=HEADERS
        ).json()
        for inst in detail.get("instances", []):
            rows.append({
                "technology_id": tech["technology_id"],
                "technology_name": tech["technology_name"],
                **inst,
            })
    return pd.DataFrame(rows)

gen = fetch_all_instances("generation")
print(gen[["technology_id", "instance_id", "typical_capacity_mw",
           "capex_usd_per_kw", "efficiency_percent"]].to_string())
```

---

### PyPSA — building a network from the API

```python
import pypsa
import requests

BASE    = "https://marleigh-unmuttering-effortlessly.ngrok-free.dev/api/v1"
HEADERS = {"ngrok-skip-browser-warning": "true"}

n = pypsa.Network()
n.set_snapshots(pd.date_range("2030-01-01", periods=8760, freq="1h"))

TECHS = [
    ("ccgt",          0, "CCGT plant"),
    ("onshore_wind",  4, "Onshore 150 MW medium-wind"),   # instance_index 4
    ("solar_pv_distributed", 5, "Rooftop 10 kW HJT"),     # instance_index 5
]

for tech_id, idx, label in TECHS:
    resp = requests.get(
        f"{BASE}/adapt/pypsa/{tech_id}",
        params={"instance_index": idx, "discount_rate": 0.07},
        headers=HEADERS,
    )
    resp.raise_for_status()
    p = resp.json()["parameters"]
    n.add("Generator", label, bus="bus0", **p)

n.optimize()
```

The `instance_index` maps directly to the `instances` array in the JSON file.  
Use `GET /api/v1/technologies/{id}/instances` to list all available indices.

---

### Calliope — auto-populating `techs.yaml`

```python
import requests
import yaml
from pathlib import Path

BASE    = "https://marleigh-unmuttering-effortlessly.ngrok-free.dev/api/v1"
HEADERS = {"ngrok-skip-browser-warning": "true"}

# Fetch the complete Calliope techs block for all generation technologies
resp = requests.get(
    f"{BASE}/technologies/calliope",
    params={"category": "generation"},
    headers=HEADERS,
)
resp.raise_for_status()

techs_block = {"techs": resp.json()["techs"]}
Path("model/techs_generation.yaml").write_text(
    yaml.dump(techs_block, sort_keys=False, allow_unicode=True)
)
print(f"Wrote {len(techs_block['techs'])} techs to model/techs_generation.yaml")
```

Then reference this file in your Calliope model config:

```yaml
# model.yaml
model:
  name: My Energy Model
  calliope_version: 0.7
  timeseries_data_path: "./timeseries"

import:
  - "techs_generation.yaml"     # ← auto-generated from opentech-db
  - "techs_storage.yaml"
  - "locations.yaml"
  - "links.yaml"
```

---

### OSeMOSYS / ADOPTNet0 — raw JSON fetch

These frameworks currently consume raw JSON records. Retrieve them and parse the fields directly:

```python
import requests, json

BASE    = "https://marleigh-unmuttering-effortlessly.ngrok-free.dev/api/v1"
HEADERS = {"ngrok-skip-browser-warning": "true"}

# Fetch all storage technologies as raw catalogue records
resp = requests.get(f"{BASE}/technologies/category/storage", headers=HEADERS)
resp.raise_for_status()

for tech in resp.json()["technologies"]:
    detail = requests.get(
        f"{BASE}/technologies/{tech['technology_id']}", headers=HEADERS
    ).json()
    inst = detail["instances"][0]   # pick first (current) instance
    print(f"{tech['technology_id']}: CAPEX={inst['capex_usd_per_kw']} USD/kW, "
          f"lifetime={inst['lifetime_years']} yr")
```

---

### Health check & reload

```bash
# Check that the service is alive and see catalogue size
curl -H "ngrok-skip-browser-warning: true" \
  https://marleigh-unmuttering-effortlessly.ngrok-free.dev/health

# Force reload of all JSON files (e.g. after adding a new technology)
curl -X POST -H "ngrok-skip-browser-warning: true" \
  https://marleigh-unmuttering-effortlessly.ngrok-free.dev/api/v1/debug/reload
```

---

## Data Model

```
Technology  ← oeo:EnergyConversionDevice
│  id (UUID)  name  category  description  tags
│  oeo_class  oeo_uri             ← OEO linkage
│  input_carriers  output_carriers
│  instances: list[EquipmentInstance]
│
├── PowerPlant    ← oeo:PowerGeneratingUnit
│     technology_type  primary_fuel  is_dispatchable  is_renewable
│     fleet_capex_per_kw  fleet_opex_fixed_per_kw_yr
│     fleet_electrical_efficiency  fleet_co2_emission_factor
│
├── VREPlant      ← oeo:RenewableEnergyPlant  (extends PowerPlant)
│     profile_key  ← reference to hourly capacity-factor series
│
├── EnergyStorage ← oeo:ElectricEnergyStorageUnit
│     storage_type  stored_carrier
│     fleet_roundtrip_efficiency  fleet_energy_to_power_ratio
│     fleet_self_discharge_rate  fleet_dod_max  fleet_cycle_lifetime
│
├── TransmissionLine ← oeo:TransmissionLine
│     transmission_type  voltage_kv  length_km
│     loss_per_km  max_capacity_mw
│
└── ConversionTechnology ← oeo:EnergyConversionDevice
      conversion_type  fleet_conversion_efficiency

EquipmentInstance          ← one manufacturer / vintage / scenario
  id  label  manufacturer  reference_year  life_cycle_stage
  capex_per_kw               ← oeo:CapitalExpenditure
  opex_fixed_per_kw_yr       ← oeo:OperationAndMaintenanceCost
  opex_variable_per_mwh
  electrical_efficiency      ← oeo:ElectricalEfficiency
  capacity_kw  capacity_factor
  co2_emission_factor        ← oeo:CO2EmissionFactor
  ramp_up_rate  ramp_down_rate   ← oeo:RampingRate
  min_stable_generation  economic_lifetime_yr
  extra: dict                ← model-specific extensions

ParameterValue             ← oeo:MeasuredValue
  value  unit  min  max  source  year
```

Every `ParameterValue` carries uncertainty bounds (`min`/`max`) and a bibliographic `source` with reference `year`, enabling **full parameter provenance**.

---

## JSON Data Formats

The loader supports two formats automatically detected at runtime:

### 1. Catalogue format (recommended for new data)

One file covers all technologies in a domain. Contains a `metadata` block and a `technologies` array with flat numeric fields per instance. Used by the main catalogue files.

```json
{
  "metadata": {
    "domain": "generation",
    "version": "1.0.0",
    "description": "...",
    "primary_sources": ["NREL ATB 2023", "IRENA ..."]
  },
  "technologies": [
    {
      "technology_id": "ccgt",
      "technology_name": "Combined Cycle Gas Turbine (CCGT)",
      "domain": "generation",
      "carrier": "natural_gas",
      "oeo_class": "http://openenergy-platform.org/ontology/oeo/OEO_00000044",
      "description": "...",
      "instances": [
        {
          "instance_id": "ccgt_800mw_current",
          "instance_name": "CCGT – 800 MW (Current, 2024)",
          "typical_capacity_mw": 800,
          "capex_usd_per_kw": 900,
          "opex_fixed_usd_per_kw_yr": 20.0,
          "opex_var_usd_per_mwh": 3.5,
          "efficiency_percent": 58.0,
          "lifetime_years": 30,
          "co2_emission_factor_operational_g_per_kwh": 202,
          "ramping_rate_percent_per_min": 8.0,
          "reference_source": "NREL ATB 2023"
        }
      ]
    }
  ]
}
```

**Field mapping** (catalogue → internal model):

| Catalogue field | Internal field | Conversion |
|---|---|---|
| `capex_usd_per_kw` | `capex_per_kw.value` | direct |
| `efficiency_percent` | `electrical_efficiency.value` | ÷ 100 |
| `typical_capacity_mw` | `capacity_kw.value` | × 1000 |
| `co2_emission_factor_operational_g_per_kwh` | `co2_emission_factor.value` | ÷ 1000 → tCO₂/MWh |
| `ramping_rate_percent_per_min` | `ramp_up_rate.value` + `ramp_down_rate.value` | direct |
| `oeo_class` (full URI) | `oeo_uri` + `oeo_class` (last segment) | split |

### 2. Individual format (legacy, fully supported)

One JSON file per technology using nested `ParameterValue` objects. Detected automatically by the absence of a `metadata`/`technologies` root structure. This format is available for backward compatibility and can coexist with catalogue files in the same `data/` directory.

---

## Adding a New Technology

### Using the catalogue format (preferred)
Add an entry to the appropriate `data/<category>/<category>_technologies.json` under the `technologies` array, then call:
```
POST http://127.0.0.1:8000/api/v1/debug/reload
```

### Using the individual format
1. Create `data/<category>/<tech_id>.json` following the nested `ParameterValue` schema.
2. The `id` field must be a valid UUID (any version).
3. Add at least one entry in `instances`.
4. Reload via the debug endpoint above.

---

## Framework Adapters

### PyPSA adapter

```python
from adapters.pypsa_adapter import to_pypsa
from api.routes import _get_all

# Get a technology by ID and translate it
techs = _get_all()
tech  = next(t for t in techs.values() if "CCGT" in t.name)

params = to_pypsa(tech, instance_index=0, discount_rate=0.07)
# → returns dict ready for: network.add("Generator", name, **params)
```

**PyPSA component mapping:**

| Technology category | PyPSA component |
|---|---|
| `generation` | `Generator` |
| `storage` | `StorageUnit` |
| `transmission` | `Link` |
| `conversion` | `Link` |

CAPEX is annualised using the Capital Recovery Factor (CRF):
$$\text{CRF} = \frac{r(1+r)^n}{(1+r)^n - 1}$$

### Calliope adapter

```python
from adapters.calliope_adapter import to_calliope
import yaml, requests

# Via Python directly
calliope_cfg = to_calliope(tech, instance_index=0, cost_class="monetary")
print(yaml.dump(calliope_cfg, sort_keys=False))
# → {essentials: {...}, constraints: {...}, costs: {monetary: {...}}}

# Or generate a full techs: block for all generation technologies via the API
resp = requests.get(
    "https://marleigh-unmuttering-effortlessly.ngrok-free.dev/api/v1/technologies/calliope",
    params={"category": "generation"},
    headers={"ngrok-skip-browser-warning": "true"},
)
with open("techs.yaml", "w") as f:
    yaml.dump({"techs": resp.json()["techs"]}, f, sort_keys=False)
```

**Calliope tech type mapping:**

| Technology category | Calliope type |
|---|---|
| `generation` (dispatchable) | `supply` |
| `generation` (VRE) | `supply_plus` |
| `storage` | `storage` |
| `transmission` | `transmission` |
| `conversion` | `conversion` |

---

## OEO Alignment

All records carry direct links to [Open Energy Ontology](https://openenergy-platform.org/ontology/oeo/) concepts:

| OEO concept | Field in record |
|---|---|
| `oeo:PowerGeneratingUnit` | `oeo_class` + `oeo_uri` on `PowerPlant` |
| `oeo:ElectricEnergyStorageUnit` | `oeo_class` + `oeo_uri` on `EnergyStorage` |
| `oeo:TransmissionLine` | `oeo_class` + `oeo_uri` on `TransmissionLine` |
| `oeo:EnergyConversionDevice` | `oeo_class` + `oeo_uri` on `ConversionTechnology` |
| `oeo:CapitalExpenditure` | `capex_per_kw` |
| `oeo:OperationAndMaintenanceCost` | `opex_fixed_per_kw_yr` |
| `oeo:ElectricalEfficiency` | `electrical_efficiency` |
| `oeo:CO2EmissionFactor` | `co2_emission_factor` |
| `oeo:RampingRate` | `ramp_up_rate`, `ramp_down_rate` |
| `oeo:InstalledCapacity` | `capacity_kw` |
| `oeo:MeasuredValue` | `ParameterValue` (value + unit + uncertainty) |

OEO browser: <https://openenergy-platform.org/ontology/oeo/>

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

## Architecture Documentation

A full **arc42** architecture document is maintained in `documentation/`. It covers system context, building-block decomposition, runtime behaviour, deployment, crosscutting concepts, architectural decisions, quality requirements, and a glossary.

To compile (requires a LaTeX distribution with `markdown` package):

```bash
cd documentation
make pdf     # or: pdflatex main.tex
```

---

## License


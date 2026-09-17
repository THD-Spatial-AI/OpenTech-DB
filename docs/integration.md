# OpenTech-DB API Integration Guide

How to integrate OpenTech-DB into another application. All examples use `http://localhost:8000` — swap for your deployment URL.

**Interactive docs:** `http://localhost:8000/docs` (Swagger UI) or `/redoc`

---

## Base URL

```
http://localhost:8000/api/v1
```

---

## How the Data Is Organized

Every technology has two levels:

- **Technology** — the "type" (e.g. "Onshore Wind", "Lithium-Ion Battery"). Has a stable UUID and metadata.
- **Equipment Instances** — concrete data rows inside that technology (different manufacturers, years, or projection scenarios). Each instance carries the actual numeric parameters.

All numeric fields are `ParameterValue` objects:

```json
{
  "value": 1200,
  "unit": "USD/kW",
  "min": 950,
  "max": 1500,
  "source": "IRENA 2023",
  "year": 2023
}
```

---

## Step 1 — Browse the catalogue

```http
GET /api/v1/technologies
```

Key query parameters:

| Param | Example values | Effect |
|---|---|---|
| `category` | `generation`, `storage`, `transmission`, `conversion` | Filter by technology type |
| `input_carrier` | `natural_gas`, `solar_irradiance`, `wind`, `hydrogen` | Technologies that consume this carrier |
| `output_carrier` | `electricity`, `heat`, `hydrogen` | Technologies that produce this carrier |
| `renewable` | `true` / `false` | Renewable classification |
| `tag` | any string | Tag-based filter |
| `skip` / `limit` | integers (max limit: 100) | Pagination |

**Example — renewable generation technologies:**

```bash
curl "http://localhost:8000/api/v1/technologies?category=generation&renewable=true"
```

**Response shape:**

```json
{
  "total": 12,
  "has_more": false,
  "technologies": [
    {
      "id": "3f4a...",
      "slug": "onshore_wind",
      "name": "Onshore Wind",
      "category": "generation",
      "oeo_class": "oeo:WindPowerPlant",
      "n_instances": 8,
      "input_carriers": ["wind"],
      "output_carriers": ["electricity"],
      "is_renewable": true
    }
  ]
}
```

The `id` (UUID) and `slug` are both usable for all follow-up calls. The slug is also accepted directly as the path segment.

---

## Step 2 — Get full technology detail

```http
GET /api/v1/technologies/{id}
```

`{id}` accepts a **UUID**, a **slug** (catalogue `technology_id`), or a **display name** (case-insensitive). All three are equivalent:

```bash
# By slug (most readable)
curl "http://localhost:8000/api/v1/technologies/ccgt"

# By display name
curl "http://localhost:8000/api/v1/technologies/Combined%20Cycle%20Gas%20Turbine"

# By UUID (stable across renames)
curl "http://localhost:8000/api/v1/technologies/3f4a...?include_profile_values=false"
```

Add `?include_profile_values=false` to skip large hourly arrays (up to 8760 floats) when you only need metadata.

---

## Step 3 — Get the instances (the actual numbers)

```http
GET /api/v1/technologies/{id}/instances
```

`{id}` here accepts the same slug / display name / UUID as in Step 2.

Optional filter: `?lifecycle=commercial` (also: `demonstration`, `projection`, `retired`).

**Key instance fields:**

| Field | Unit | Description |
|---|---|---|
| `capex_per_kw` | EUR/kW or USD/kW | Capital expenditure |
| `capex_per_kwh` | EUR/kWh or USD/kWh | Storage energy CAPEX (storage techs only) |
| `opex_fixed_per_kw_yr` | EUR/kW/yr | Annual fixed O&M |
| `opex_variable_per_mwh` | EUR/MWh | Variable O&M |
| `electrical_efficiency` | fraction 0–1 | Net electrical efficiency |
| `capacity_factor` | fraction 0–1 | Annual average capacity factor |
| `co2_emission_factor` | tCO₂/MWh_fuel | Direct CO₂ emissions |
| `economic_lifetime_yr` | years | Technical/economic lifetime |
| `ramp_up_rate` | % capacity/min | Ramp rate (dispatchable plants) |
| `initial_soc` | fraction 0–1 | Initial state of charge (storage only) |

A specific instance by ID:

```http
GET /api/v1/technologies/{tech_id}/instances/{instance_id}
```

---

## Framework Exports

Use these when you want plug-and-play output for a modeling framework. They handle unit conversions, CAPEX annualization, and naming for you.

All bulk export endpoints accept:
- `?category=generation|storage|transmission|conversion` — filter by type
- `?instance_index=N` — which equipment instance to use (0-based, default 0)

### PyPSA

```http
GET /api/v1/technologies/pypsa?category=generation&discount_rate=0.07
```

CAPEX is already annualized using Capital Recovery Factor: `CRF = r(1+r)^n / ((1+r)^n - 1)`. Each record includes a `component_type` field (`Generator`, `StorageUnit`, or `Link`).

```python
import requests, pypsa

BASE = "http://localhost:8000/api/v1"

resp = requests.get(f"{BASE}/technologies/pypsa", params={"category": "generation", "discount_rate": 0.07})
resp.raise_for_status()

network = pypsa.Network()
for name, params in resp.json()["technologies"].items():
    ct = params.pop("component_type", "Generator")
    network.add(ct, name, **{k: v for k, v in params.items() if not k.startswith("_")})
```

Single technology (slug, name, or UUID all work):

```http
GET /api/v1/technologies/ccgt/pypsa?discount_rate=0.05
GET /api/v1/technologies/onshore_wind/pypsa
GET /api/v1/technologies/Lithium-Ion%20Battery/pypsa
```

### Calliope

```http
GET /api/v1/technologies/calliope?category=generation&version=0.7
```

Use `version=0.6` (default) for the nested `essentials/constraints/costs` structure, or `version=0.7` for the flat `base_tech`/`flow_*` format.

```python
import requests, yaml
from pathlib import Path

BASE = "http://localhost:8000/api/v1"

resp = requests.get(f"{BASE}/technologies/calliope", params={"category": "generation", "version": "0.7"})
resp.raise_for_status()

Path("model/techs_generation.yaml").write_text(
    yaml.dump({"techs": resp.json()["techs"]}, sort_keys=False, allow_unicode=True)
)
```

Reference in your Calliope model:

```yaml
# model.yaml
import:
  - "techs_generation.yaml"
  - "techs_storage.yaml"
  - "locations.yaml"
```

You can also POST constraint overrides without modifying the database (slug/name/UUID accepted):

```http
POST /api/v1/technologies/ccgt/calliope
```

```json
{
  "instance_index": 0,
  "cost_class": "monetary",
  "constraints": {
    "energy_cap_max": 5000,
    "force_resource": true
  },
  "costs": {
    "monetary": { "energy_cap": 800 },
    "co2": { "om_prod": 0.00015 }
  }
}
```

### OSeMOSYS

```http
GET /api/v1/technologies/osemosys?category=generation
```

Costs are in **MEUR/GW** (= EUR/kW numerically) and **MEUR/PJ**. `CapacityToActivityUnit` = 31.536 PJ/GW/yr. Storage technologies get a `storage_model` sub-key with separate charge/discharge records.

```python
import requests, yaml

resp = requests.get("http://localhost:8000/api/v1/technologies/osemosys", params={"category": "generation"})
with open("otoole_params.yaml", "w") as f:
    yaml.dump(resp.json()["technologies"], f, sort_keys=False)
```

### AdOpT-NET0

```http
GET /api/v1/technologies/adoptnet0?category=storage
```

Each entry matches an AdOpT-NET0 technology JSON file (`tec_type` RES / CONV2 / STOR). Transmission technologies are exported as AdOpT-NET0 *network* JSON. A provenance block (`OpenTechDB`) is included but ignored by AdOpT-NET0.

```python
import requests, json

resp = requests.get("http://localhost:8000/api/v1/technologies/adoptnet0", params={"category": "storage"})
for name, tec in resp.json()["technologies"].items():
    with open(f"technology_data/{name}.json", "w") as f:
        json.dump(tec, f, indent=2)
```

---

## Energy Carriers

Check what carriers are actually in the dataset (with usage counts):

```http
GET /api/v1/technologies/carriers
```

Full allowed set for `input_carrier` / `output_carrier` filters:

```
electricity    natural_gas    hydrogen       heat           cooling
steam          oil            coal           biomass        biogas
syngas         methane        liquid_fuel    nitrogen       flue_gas
water          co2            ammonia        wind           solar_irradiance
nuclear_fuel   geothermal_energy  marine     ambient_heat   waste
```

---

## HTTP Caching

All list, detail, and export endpoints return an `ETag` header. On repeat requests, send:

```
If-None-Match: "<etag-value>"
```

You get `304 Not Modified` (no body) when nothing changed — free bandwidth savings. The ETag refreshes automatically whenever the catalogue is reloaded.

---

## Python Quick-Reference

### Fetch all instances for a category and build a DataFrame

```python
import requests
import pandas as pd

BASE = "http://localhost:8000/api/v1"

def fetch_instances(category: str) -> pd.DataFrame:
    techs = requests.get(f"{BASE}/technologies", params={"category": category, "limit": 100}).json()["technologies"]
    rows = []
    for t in techs:
        for inst in requests.get(f"{BASE}/technologies/{t['id']}/instances").json():
            row = {
                "tech_name": t["name"],
                "slug": t["slug"],
                "label": inst["label"],
                "reference_year": inst.get("reference_year"),
                "capex_per_kw": (inst.get("capex_per_kw") or {}).get("value"),
                "opex_fixed": (inst.get("opex_fixed_per_kw_yr") or {}).get("value"),
                "efficiency": (inst.get("electrical_efficiency") or {}).get("value"),
                "capacity_factor": (inst.get("capacity_factor") or {}).get("value"),
                "lifetime_yr": (inst.get("economic_lifetime_yr") or {}).get("value"),
            }
            rows.append(row)
    return pd.DataFrame(rows)

storage = fetch_instances("storage")
print(storage[["tech_name", "label", "capex_per_kw", "lifetime_yr"]])
```

### ETag-aware client

```python
import requests

class OpenTechClient:
    def __init__(self, base_url="http://localhost:8000/api/v1"):
        self.base = base_url
        self._etag = None

    def get_technologies(self, **params):
        headers = {}
        if self._etag:
            headers["If-None-Match"] = self._etag
        resp = requests.get(f"{self.base}/technologies", params=params, headers=headers)
        if resp.status_code == 304:
            return None  # nothing changed
        resp.raise_for_status()
        self._etag = resp.headers.get("ETag")
        return resp.json()
```

---

## Common Patterns

**"Give me all solar technologies with cost data"**

```
GET /technologies?input_carrier=solar_irradiance&renewable=true
→ read slug from each result
GET /technologies/pv_utility/instances?lifecycle=commercial
→ read capex_per_kw.value, capacity_factor.value
```

**"Fetch a specific technology by name or slug"**

```
GET /technologies/ccgt
GET /technologies/onshore_wind
GET /technologies/Lithium-Ion%20Battery
→ all resolve without needing to look up the UUID first
```

**"Populate a PyPSA model with all storage techs"**

```
GET /technologies/pypsa?category=storage&discount_rate=0.05
→ one call, ready to add to network
```

**"Get Calliope config for a single technology you know by name"**

```
GET /technologies/li_ion_bess/calliope?version=0.7
GET /technologies/offshore_wind/calliope
```

**"Check which technologies have the most data coverage"**

```
GET /technologies?limit=100
→ sort by n_instances descending
```

**"Export everything for OSeMOSYS"**

```
GET /technologies/osemosys          ← all categories, instance 0
GET /technologies/osemosys?category=generation&instance_index=1
```

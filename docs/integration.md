# Integration Guide

All examples assume a locally running instance. Base URL: `http://localhost:8000/api/v1`

---

## curl

```bash
BASE="http://localhost:8000/api/v1"

# List all technologies
curl "$BASE/technologies"

# Get one technology by ID
curl "$BASE/technologies/onshore_wind"

# Filter by category (generation | storage | transmission | conversion)
curl "$BASE/technologies/category/generation"

# Get all instances of a technology
curl "$BASE/technologies/onshore_wind/instances"

# Get all generation technologies as a Calliope techs: block
curl "$BASE/technologies/calliope?category=generation"

# PyPSA-ready dict for CCGT instance 0, 7% discount rate
curl "$BASE/adapt/pypsa/ccgt?instance_index=0&discount_rate=0.07"
```

---

## Python — `requests`

```python
import requests

BASE = "http://localhost:8000/api/v1"

# Browse all generation technologies
resp = requests.get(f"{BASE}/technologies/category/generation")
resp.raise_for_status()
catalogue = resp.json()  # {"total": N, "technologies": [...]}

for tech in catalogue["technologies"]:
    print(tech["technology_id"], "–", tech["technology_name"])

# Fetch one technology and inspect its instances
resp = requests.get(f"{BASE}/technologies/onshore_wind")
resp.raise_for_status()
tech = resp.json()

for inst in tech["instances"]:
    print(
        inst["instance_id"],
        f"| {inst['typical_capacity_mw']} MW",
        f"| CAPEX {inst['capex_usd_per_kw']} USD/kW",
    )

# PyPSA-ready parameter dict
resp = requests.get(
    f"{BASE}/adapt/pypsa/ccgt",
    params={"instance_index": 0, "discount_rate": 0.07},
)
params = resp.json()["parameters"]
```

---

## Python — `pandas` (bulk exploration)

```python
import pandas as pd
import requests

BASE = "http://localhost:8000/api/v1"

def fetch_all_instances(category: str) -> pd.DataFrame:
    resp = requests.get(f"{BASE}/technologies/category/{category}")
    resp.raise_for_status()
    rows = []
    for tech in resp.json()["technologies"]:
        detail = requests.get(f"{BASE}/technologies/{tech['technology_id']}").json()
        for inst in detail.get("instances", []):
            rows.append({"technology_id": tech["technology_id"], **inst})
    return pd.DataFrame(rows)

gen = fetch_all_instances("generation")
print(gen[["technology_id", "instance_id", "typical_capacity_mw", "capex_usd_per_kw"]].to_string())
```

---

## PyPSA

```python
import pypsa
import pandas as pd
import requests

BASE = "http://localhost:8000/api/v1"

n = pypsa.Network()
n.set_snapshots(pd.date_range("2030-01-01", periods=8760, freq="1h"))

TECHS = [
    ("ccgt",          0, "CCGT plant"),
    ("onshore_wind",  4, "Onshore 150 MW medium-wind"),
    ("solar_pv_distributed", 5, "Rooftop 10 kW HJT"),
]

for tech_id, idx, label in TECHS:
    resp = requests.get(
        f"{BASE}/adapt/pypsa/{tech_id}",
        params={"instance_index": idx, "discount_rate": 0.07},
    )
    resp.raise_for_status()
    n.add("Generator", label, bus="bus0", **resp.json()["parameters"])

n.optimize()
```

Use `GET /technologies/{id}/instances` to list all available instance indices.

---

## Calliope

```python
import requests
import yaml
from pathlib import Path

BASE = "http://localhost:8000/api/v1"

# Fetch the Calliope techs block for all generation technologies
resp = requests.get(f"{BASE}/technologies/calliope", params={"category": "generation"})
resp.raise_for_status()

Path("model/techs_generation.yaml").write_text(
    yaml.dump({"techs": resp.json()["techs"]}, sort_keys=False, allow_unicode=True)
)
```

Reference in your Calliope model config:

```yaml
# model.yaml
import:
  - "techs_generation.yaml"   # ← auto-generated from opentech-db
  - "techs_storage.yaml"
  - "locations.yaml"
```

---

## OSeMOSYS / ADOPTNet0 — raw JSON

```python
import requests

BASE = "http://localhost:8000/api/v1"

resp = requests.get(f"{BASE}/technologies/category/storage")
resp.raise_for_status()

for tech in resp.json()["technologies"]:
    detail = requests.get(f"{BASE}/technologies/{tech['technology_id']}").json()
    inst = detail["instances"][0]
    print(f"{tech['technology_id']}: CAPEX={inst['capex_usd_per_kw']} USD/kW, "
          f"lifetime={inst['lifetime_years']} yr")
```

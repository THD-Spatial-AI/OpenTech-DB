# Framework Adapters

Adapter modules in `adapters/` translate OEO technology records into framework-ready parameter dicts.

---

## PyPSA Adapter

**File:** `adapters/pypsa_adapter.py`

### Via API

```bash
GET /api/v1/adapt/pypsa/{id}?instance_index=0&discount_rate=0.07
```

### Direct Python usage

```python
from adapters.pypsa_adapter import to_pypsa
from api.routes import _get_all

techs = _get_all()
tech = next(t for t in techs.values() if "CCGT" in t.name)

params = to_pypsa(tech, instance_index=0, discount_rate=0.07)
# → dict ready for: network.add("Generator", name, **params)
```

### Component mapping

| Technology category | PyPSA component |
|---|---|
| `generation` | `Generator` |
| `storage` | `StorageUnit` |
| `transmission` | `Link` |
| `conversion` | `Link` |

### CAPEX annualisation

CAPEX is annualised using the Capital Recovery Factor (CRF):

$$\text{CRF} = \frac{r(1+r)^n}{(1+r)^n - 1}$$

where $r$ is the discount rate and $n$ is the economic lifetime in years.

---

## Calliope Adapter

**File:** `adapters/calliope_adapter.py`

### Via API

```bash
# Single technology
GET /api/v1/adapt/calliope/{id}?instance_index=0&cost_class=monetary

# Full techs block for a category
GET /api/v1/technologies/calliope?category=generation
```

### Direct Python usage

```python
from adapters.calliope_adapter import to_calliope
import yaml

calliope_cfg = to_calliope(tech, instance_index=0, cost_class="monetary")
print(yaml.dump(calliope_cfg, sort_keys=False))
# → {essentials: {...}, constraints: {...}, costs: {monetary: {...}}}
```

### Tech type mapping

| Technology category | Calliope type |
|---|---|
| `generation` (dispatchable) | `supply` |
| `generation` (VRE) | `supply_plus` |
| `storage` | `storage` |
| `transmission` | `transmission` |
| `conversion` | `conversion` |

### Generate a full `techs.yaml`

```python
import requests, yaml
from pathlib import Path

BASE = "http://localhost:8000/api/v1"
resp = requests.get(f"{BASE}/technologies/calliope", params={"category": "generation"})
resp.raise_for_status()

Path("model/techs_generation.yaml").write_text(
    yaml.dump({"techs": resp.json()["techs"]}, sort_keys=False, allow_unicode=True)
)
```

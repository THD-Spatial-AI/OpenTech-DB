# API Reference

Base URL: `http://localhost:8000/api/v1`

---

## Technology Catalogue

| Method | Path | Description |
|---|---|---|
| `GET` | `/technologies` | List all technologies (paginated) |
| `GET` | `/technologies/{id}` | Full technology detail |
| `GET` | `/technologies/category/{cat}` | Filter by category |
| `GET` | `/technologies/{id}/instances` | All equipment instances for a technology |
| `GET` | `/technologies/{id}/instances/{iid}` | One specific equipment instance |

**Valid category values:** `generation` · `storage` · `transmission` · `conversion`

**Query parameters (list endpoints):**

| Parameter | Description | Default |
|---|---|---|
| `skip` | Pagination offset | `0` |
| `limit` | Max results (max `200`) | `50` |
| `tag` | Filter by tag string | — |
| `lifecycle` | Filter instances by stage: `commercial`, `projection`, `demonstration` | — |

---

## Calliope Adapter

| Method | Path | Description |
|---|---|---|
| `GET` | `/technologies/calliope` | All technologies as a Calliope `techs:` block |
| `GET` | `/technologies/calliope?category=generation` | Filtered by category |
| `GET` | `/technologies/{id}/calliope` | Single technology in Calliope format |
| `POST` | `/technologies/{id}/calliope` | Single technology + constraint/cost overrides |

Query parameters: `instance_index` (int, default `0`), `cost_class` (str, default `"monetary"`).

---

## Framework Adapters

| Method | Path | Description |
|---|---|---|
| `GET` | `/adapt/pypsa/{id}` | PyPSA-ready parameter dict |
| `GET` | `/adapt/calliope/{id}` | Calliope-ready config dict |

Query parameters: `instance_index` (int, default `0`), `discount_rate` (float, PyPSA only), `cost_class` (str, Calliope only).

---

## Time-Series Catalogue

| Method | Path | Description |
|---|---|---|
| `GET` | `/timeseries` | Paginated list of hourly profiles |
| `GET` | `/timeseries/{id}/data` | Full hourly data array for one profile |
| `POST` | `/timeseries/submit` | Contributor upload (authenticated) |
| `GET` | `/admin/timeseries/submissions` | List pending submissions (admin only) |
| `PATCH` | `/admin/timeseries/{id}/approve` | Approve a submission (admin only) |

---

## Authentication

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/orcid` | Redirect to ORCID OAuth login |
| `GET` | `/auth/orcid/callback` | OAuth callback; issues JWT |
| `GET` | `/auth/me` | Validate JWT and return user profile |

---

## Diagnostics

| Method | Path | Description |
|---|---|---|
| `GET` | `/debug/data` | Inspect loading status of all JSON files |
| `POST` | `/debug/reload` | Clear cache and reload all files from disk |
| `GET` | `http://localhost:8000/health` | Service health check + version |

---

## Response examples

### `GET /technologies/ccgt`

```json
{
  "technology_id": "ccgt",
  "technology_name": "Combined Cycle Gas Turbine (CCGT)",
  "domain": "generation",
  "carrier": "natural_gas",
  "oeo_class": "OEO_00000044",
  "oeo_uri": "http://openenergy-platform.org/ontology/oeo/OEO_00000044",
  "instances": [
    {
      "instance_id": "ccgt_800mw_current",
      "instance_name": "CCGT – 800 MW (Current, 2024)",
      "typical_capacity_mw": 800,
      "capex_usd_per_kw": 900,
      "efficiency_percent": 58.0,
      "lifetime_years": 30
    }
  ]
}
```

### `GET /adapt/pypsa/ccgt?discount_rate=0.07`

```json
{
  "technology_id": "ccgt",
  "instance_index": 0,
  "parameters": {
    "carrier": "natural_gas",
    "efficiency": 0.58,
    "capital_cost": 12500.4,
    "marginal_cost": 3.5,
    "lifetime": 30
  }
}
```

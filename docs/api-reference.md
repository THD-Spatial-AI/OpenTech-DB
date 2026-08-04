# API Reference

Base URL: `http://localhost:8000/api/v1`

Interactive documentation is available at `http://localhost:8000/docs` (Swagger UI) and `http://localhost:8000/redoc` (ReDoc).

---

## Technology Catalogue

| Method | Path | Description |
|---|---|---|
| `GET` | `/technologies` | List all technologies (paginated, filterable) |
| `GET` | `/technologies/{id}` | Full technology detail with all instances |
| `GET` | `/technologies/category/{cat}` | Filter by category |
| `GET` | `/technologies/{id}/instances` | All equipment instances for a technology |
| `GET` | `/technologies/{id}/instances/{iid}` | One specific equipment instance |

**Valid category values:** `generation` · `storage` · `transmission` · `conversion`

**Query parameters (list / category endpoints):**

| Parameter | Type | Description | Default |
|---|---|---|---|
| `skip` | int | Pagination offset | `0` |
| `limit` | int | Max results (max `200`) | `50` |
| `tag` | string | Filter by tag string | — |
| `lifecycle` | string | Filter by stage: `commercial`, `projection`, `demonstration`, `retired` | — |

---

## Framework Adapters

| Method | Path | Description |
|---|---|---|
| `GET` | `/adapt/pypsa/{id}` | PyPSA-ready parameter dict (capital_cost annualised via CRF) |
| `GET` | `/adapt/calliope/{id}` | Calliope-ready config dict (essentials + constraints + costs) |
| `GET` | `/technologies/calliope` | All technologies as a Calliope `techs:` block |
| `GET` | `/technologies/calliope?category=generation` | Filtered Calliope block |
| `GET` | `/technologies/{id}/calliope` | Single technology in Calliope format |
| `POST` | `/technologies/{id}/calliope` | Single technology + constraint/cost overrides |

**PyPSA query parameters:** `instance_index` (int, default `0`), `discount_rate` (float, default `0.07`)

**Calliope query parameters:** `instance_index` (int, default `0`), `cost_class` (str, default `"monetary"`)

---

## Time-Series Catalogue

| Method | Path | Description |
|---|---|---|
| `GET` | `/timeseries` | Paginated list of profile metadata |
| `GET` | `/timeseries/{id}/data` | Full hourly data array for one profile |
| `POST` | `/timeseries/submit` | Contributor upload (requires the Go-managed session cookie) |
| `GET` | `/admin/timeseries/submissions` | List pending submissions (admin only) |
| `PATCH` | `/admin/timeseries/{id}/approve` | Approve a submission (admin only) |

**Timeseries query parameters:** `skip` (int), `limit` (int), `type` (string), `location` (string)

---

## Authentication service

These routes are exposed through the same-origin `/auth-api` proxy and are not
part of the FastAPI `/api/v1` base URL.

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth-api/csrf-token` | Issue the CSRF double-submit token |
| `POST` | `/auth-api/login` | Sign in with username/email and password |
| `POST` | `/auth-api/register` | Register username and email in Keycloak |
| `GET` | `/auth-api/auth/provider/{github\|orcid}` | Begin a Keycloak-brokered provider flow |
| `GET` | `/auth-api/auth/me` | Return public identity for the opaque session |
| `POST` | `/auth-api/logout` | Revoke Keycloak and local sessions |

---

## Personal API tokens

These FastAPI routes require the opaque Keycloak browser session and are used
by the profile page. A personal API token cannot call these management routes.

| Method | Path | Description |
|---|---|---|
| `GET` | `/profile/api-tokens` | List my token metadata (never full secrets) |
| `POST` | `/profile/api-tokens` | Generate a token; the full secret is returned once |
| `DELETE` | `/profile/api-tokens/{id}` | Revoke one of my tokens |

Generate request fields are `name`, `scope` (`read` or `full`), and
`expires_in_days` (`0` through `365`; `0` means no automatic expiry). Send the
generated token to any FastAPI endpoint with:

```http
Authorization: Bearer otdb_<complete-secret>
```

Read tokens accept only `GET`/`HEAD`. Full tokens can call contributor writes
when contributor access was present at generation time. Personal tokens never
receive administrator access. Invalid, expired, and revoked tokens all return
`401`; token secrets are not accepted in query parameters.

---

## Scraper Pipeline (admin only)

| Method | Path | Description |
|---|---|---|
| `GET` | `/scraper/status` | Scheduler state, enabled sources, candidate counts, last run |
| `POST` | `/scraper/run` | Manually trigger a pipeline run (background or sync) |
| `GET` | `/scraper/candidates` | List scraper candidates (filter by status, tech) |
| `GET` | `/scraper/candidates/{id}` | Full candidate detail with extracted parameters |
| `POST` | `/scraper/candidates/{id}/approve` | Approve candidate and merge into catalogue |
| `POST` | `/scraper/candidates/{id}/reject` | Reject candidate and archive |

**Candidate query parameters:** `status` (`pending`, `approved`, `rejected`), `technology_id` (string)

---

## Diagnostics

| Method | Path | Description |
|---|---|---|
| `GET` | `/debug/data` | Inspect loading status of all JSON files |
| `POST` | `/debug/reload` | Clear LRU cache and reload all files from disk |
| `GET` | `http://localhost:8000/health` | Service health check + version info |

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
  "description": "High-efficiency gas-fired power plant combining gas and steam turbines.",
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
```

### `GET /adapt/pypsa/ccgt?discount_rate=0.07`

```json
{
  "technology_id": "ccgt",
  "instance_index": 0,
  "component_type": "Generator",
  "parameters": {
    "carrier": "natural_gas",
    "efficiency": 0.58,
    "capital_cost": 12500.4,
    "marginal_cost": 3.5,
    "co2_emissions": 0.202,
    "lifetime": 30
  }
}
```

### `GET /adapt/calliope/ccgt`

```json
{
  "ccgt": {
    "essentials": {
      "name": "Combined Cycle Gas Turbine (CCGT)",
      "color": "#999",
      "carrier_in": "natural_gas",
      "carrier_out": "electricity",
      "parent": "supply"
    },
    "constraints": {
      "energy_eff": 0.58,
      "energy_cap_max": 800000,
      "energy_ramping": 0.08
    },
    "costs": {
      "monetary": {
        "interest_rate": 0.07,
        "energy_cap": 900,
        "om_annual": 20.0,
        "om_prod": 0.0035
      }
    }
  }
}
```

### `GET /timeseries`

```json
{
  "total": 24,
  "profiles": [
    {
      "profile_id": "de_solar_pv_utility_cf_2019",
      "name": "Germany Solar PV Utility CF 2019",
      "type": "capacity_factor",
      "resolution": "1h",
      "location": "DE",
      "carrier": "solar",
      "year": 2019,
      "n_timesteps": 8760,
      "source": "Renewables.ninja / ERA5"
    }
  ]
}
```

### `GET /scraper/status`

```json
{
  "scheduler_running": true,
  "next_run": "2026-06-01T02:00:00Z",
  "enabled_sources": ["open_alex", "semantic_scholar", "nrel_atb", "crossref"],
  "pending_candidates": 12,
  "last_run": {
    "run_id": "a1b2c3d4",
    "started_at": "2026-05-15T02:00:00Z",
    "status": "completed",
    "total_papers": 347,
    "candidates_created": 18
  }
}
```

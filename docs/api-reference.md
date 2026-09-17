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
| `GET` | `/technologies/{id}/profiles` | Generation profiles linked to a technology |

**Valid category values:** `generation` · `storage` · `transmission` · `conversion`

### Technology identifier (`{id}`)

All single-technology endpoints accept any of the following in place of `{id}`, resolved in this order:

| Form | Example | Notes |
|---|---|---|
| UUID | `3f4a9c12-1234-5678-abcd-ef0123456789` | Stable across renames; use in persistent integrations |
| Slug | `ccgt`, `onshore_wind`, `li_ion_bess`, `hvdc_line` | The catalogue `technology_id` — most human-readable |
| Display name | `Combined Cycle Gas Turbine`, `onshore wind` | Case-insensitive; useful for ad-hoc querying |

UUIDs are the long-term stable key. Slugs are the recommended form for scripts and config files.

**Query parameters (list / category endpoints):**

| Parameter | Type | Description | Default |
|---|---|---|---|
| `skip` | int | Pagination offset | `0` |
| `limit` | int | Max results (max `100`) | `50` |
| `tag` | string | Filter by tag string | — |
| `category` | string | Filter by category | — |
| `input_carrier` | string | Filter by input energy carrier | — |
| `output_carrier` | string | Filter by output energy carrier | — |
| `renewable` | bool | `true` = renewables only, `false` = non-renewables only | — |

---

## Framework Adapters

All single-technology adapter endpoints accept UUID, slug, or display name (see [Technology identifier](#technology-identifier-id) above).

| Method | Path | Description |
|---|---|---|
| `GET` | `/technologies/pypsa` | All technologies as PyPSA component dicts |
| `GET` | `/technologies/{id}/pypsa` | Single technology, PyPSA format |
| `GET` | `/technologies/calliope` | All technologies as a Calliope `techs:` block |
| `GET` | `/technologies/{id}/calliope` | Single technology in Calliope format |
| `POST` | `/technologies/{id}/calliope` | Single technology + constraint/cost overrides |
| `GET` | `/technologies/osemosys` | All technologies as OSeMOSYS parameter dicts |
| `GET` | `/technologies/{id}/osemosys` | Single technology, OSeMOSYS format |
| `GET` | `/technologies/adoptnet0` | All technologies as AdOpT-NET0 input JSON |
| `GET` | `/technologies/{id}/adoptnet0` | Single technology, AdOpT-NET0 format |

**Common query parameters (all adapter endpoints):**

| Parameter | Type | Description | Default |
|---|---|---|---|
| `instance_index` | int | Which equipment instance to use (0-based) | `0` |
| `category` | string | Filter bulk exports by category | — |

**PyPSA extras:** `discount_rate` (float 0–1, default `0.07`) — used for CAPEX annualization via CRF.

**Calliope extras:** `cost_class` (str, default `"monetary"`), `version` (`0.6` or `0.7`, default `0.6`).

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

All three of these are equivalent — they resolve to the same technology:

```
GET /technologies/ccgt
GET /technologies/Combined%20Cycle%20Gas%20Turbine
GET /technologies/3f4a9c12-1234-5678-abcd-ef0123456789
```

### `GET /technologies/ccgt`

```json
{
  "id": "3f4a9c12-1234-5678-abcd-ef0123456789",
  "name": "Combined Cycle Gas Turbine",
  "category": "generation",
  "technology_type": "ccgt",
  "primary_fuel": "natural_gas",
  "is_dispatchable": true,
  "input_carriers": ["natural_gas"],
  "output_carriers": ["electricity"],
  "fleet_capex_per_kw": null,
  "fleet_opex_fixed_per_kw_yr": null,
  "fleet_electrical_efficiency": null,
  "fleet_co2_emission_factor": null,
  "instances": [
    {
      "label": "CCGT – 800 MW (Current, 2024)",
      "capex_per_kw": { "value": 900, "unit": "USD/kW", "source": "NREL ATB 2023" },
      "opex_fixed_per_kw_yr": { "value": 20.0, "unit": "USD/kW/yr", "source": "NREL ATB 2023" },
      "electrical_efficiency": { "value": 0.58, "unit": "fraction", "source": "NREL ATB 2023" },
      "co2_emission_factor": { "value": 0.202, "unit": "tCO2/MWh_fuel", "source": "NREL ATB 2023" },
      "economic_lifetime_yr": { "value": 30, "unit": "years", "source": "NREL ATB 2023" }
    }
  ]
}
```

> **`fleet_*` fields** are optional technology-level aggregate defaults (e.g. a single representative value for the whole fleet). Most entries leave them `null` — actual data is in `instances`. Set them in the catalogue JSON when a single fallback value is needed without picking a specific instance.

### `GET /technologies/ccgt/pypsa?discount_rate=0.07`

```json
{
  "component_type": "Generator",
  "carrier": "natural_gas",
  "efficiency": 0.58,
  "capital_cost": 12500.4,
  "marginal_cost": 3.5,
  "co2_emissions": 0.202,
  "lifetime": 30
}
```

### `GET /technologies/ccgt/calliope`

```json
{
  "essentials": {
    "name": "Combined Cycle Gas Turbine",
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

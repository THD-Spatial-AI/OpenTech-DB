# Context & Scope
## Business Context

The `opentech-db` system sits at the centre of an energy modelling workflow. It receives data inputs from **curators** (researchers who maintain JSON files) and exposes a REST API consumed by **modelling framework clients**.

```
┌─────────────────────────────────────────────────────────────────┐
│                        External Actors                          │
│                                                                 │
│  [Data Curator]──JSON files──►[opentech-db API]                 │
│                                        │                        │
│                           ┌────────────┼────────────┐           │
│                           ▼            ▼            ▼           │
│                       [PyPSA]     [Calliope]  [OSeMOSYS /       │
│                       models       models     ADOPTNet0]        │
│                                                                 │
│  [OEP / Open Energy Platform]◄──oeo_uri links (human/bot)      │
└─────────────────────────────────────────────────────────────────┘
```

| Partner System | Direction | Interface | Description |
|---|---|---|---|
| Data Curator (human) | → opentech-db | JSON files on disk | Creates/updates technology JSON files in `data/<category>/`. |
| PyPSA model scripts | ← opentech-db | HTTP REST + `/adapt/pypsa/{id}` | Retrieves PyPSA-ready parameter dicts. |
| Calliope model scripts | ← opentech-db | HTTP REST + `/adapt/calliope/{id}` and `/technologies/{id}/calliope` | Retrieves Calliope YAML-ready dicts. |
| OSeMOSYS / ADOPTNet0 | ← opentech-db | HTTP REST `/technologies/{id}` | Retrieves raw OEO-aligned records; adapters to be implemented. |
| Open Energy Platform (OEP) | ↔ link | `oeo_uri` hyperlinks | Records reference OEO concept URIs for semantic interoperability. |

## Integration Protocols

All client systems communicate with `opentech-db` exclusively via **plain HTTP + JSON**. No special client library is required; any HTTP client (Python `requests`, R `httr`, curl, wget, Julia `HTTP.jl`, etc.) can query the API.

### Request patterns used by modelling frameworks

| Use Case | Method | Path | Notes |
|---|---|---|---|
| List all technologies in a domain | `GET` | `/api/v1/technologies/category/{cat}` | Returns `{total, technologies[]}`. Supported categories: `generation`, `storage`, `transmission`, `conversion`. |
| Retrieve full technology detail | `GET` | `/api/v1/technologies/{id}` | Returns all instances with flat numeric fields. |
| Get a specific instance | `GET` | `/api/v1/technologies/{id}/instances/{iid}` | Returns one equipment instance record. |
| PyPSA-ready parameters | `GET` | `/api/v1/adapt/pypsa/{id}` | Returns `{carrier, p_nom, efficiency, capital_cost, marginal_cost, ...}`. Accepts `instance_index` and `discount_rate` query params. |
| Calliope single-tech config | `GET` | `/api/v1/technologies/{id}/calliope` | Returns `{essentials, constraints, costs}` YAML-ready dict. |
| Calliope bulk export | `GET` | `/api/v1/technologies/calliope?category={cat}` | Returns a full `techs:` block for all technologies in a category. |
| Force data reload | `POST` | `/api/v1/debug/reload` | Clears the in-memory cache and re-reads all JSON files from disk. Useful after adding or editing a technology while the server is running. |

### Typical integration flows

**Energy modelling script (Python / PyPSA)**
1. Model script calls `GET /api/v1/adapt/pypsa/{tech_id}?instance_index=N&discount_rate=0.07`.
2. API returns a pre-annualised parameter dict with all PyPSA-required fields.
3. Script calls `network.add("Generator", name, **params)` without any manual unit conversion.

**Calliope model preparation**
1. Preprocessing script calls `GET /api/v1/technologies/calliope?category=generation`.
2. Response is written directly to `model/techs_generation.yaml`.
3. `model.yaml` imports this file; no technology parameters are hard-coded in the model.

**Notebook / data exploration**
1. Analyst calls `GET /api/v1/technologies/category/generation`.
2. For each technology, fetches `GET /api/v1/technologies/{id}` to obtain all instances.
3. Builds a `pandas.DataFrame` covering all instances across all categories for comparison.

## Technical Context

The system is a single Python process exposing an HTTP API. All data lives in the filesystem (`data/` directory). There is no runtime external dependency (no database, no message queue). A `Dockerfile` and `docker-compose.yml` are provided for containerised operation.

```
┌───────────────────────────────────────┐
│          opentech-db process        │
│                                       │
│  ┌─────────┐   ┌───────────────────┐  │
│  │ main.py │──►│ FastAPI router    │  │
│  └─────────┘   │ (api/routes.py)   │  │
│                └────────┬──────────┘  │
│          ┌──────────────┼──────────┐  │
│          ▼              ▼          ▼  │
│  ┌──────────────┐ ┌──────────┐        │
│  │ JSON loader  │ │ Pydantic │        │
│  │ (dual-format)│ │ schemas  │        │
│  └──────┬───────┘ └──────────┘        │
│         │  ┌──────────────────────┐   │
│         └─►│  data/ (filesystem) │   │
│            └──────────────────────┘   │
│  ┌────────────────┐ ┌──────────────┐  │
│  │ pypsa_adapter  │ │calliope_     │  │
│  │                │ │adapter       │  │
│  └────────────────┘ └──────────────┘  │
└───────────────────────────────────────┘
       ▲ HTTP :8000
  [Client scripts / notebooks]
```
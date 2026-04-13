# Context & Scope
## Business Context

The `opentech-db` system sits at the centre of an energy modelling workflow. It receives data inputs from **curators** (researchers who maintain JSON files or submit via the web UI) and exposes a REST API consumed by **modelling framework clients**, plus a **web frontend** used directly by researchers and non-technical users.

```
┌──────────────────────────────────────────────────────────────────────┐
│                          External Actors                             │
│                                                                      │
│  [Data Curator]──JSON files──►[opentech-db API]◄──────[Web Frontend] │
│                                        │             (React 19 SPA)  │
│                           ┌────────────┼────────────┐                │
│                           ▼            ▼            ▼                │
│                       [PyPSA]     [Calliope]  [OSeMOSYS /            │
│                       models       models     ADOPTNet0]             │
│                                                                      │
│  [ORCID / Supabase]◄──────auth──────[Web Frontend]                  │
│  [OEP / Open Energy Platform]◄──oeo_uri links (human/bot)           │
└──────────────────────────────────────────────────────────────────────┘
```

| Partner System | Direction | Interface | Description |
|---|---|---|---|
| Data Curator (human) | → opentech-db | JSON files on disk OR web UI submission form | Creates/updates technology JSON files in `data/<category>/`, or submits via `ContributorWorkspace`. |
| Web Frontend (React SPA) | ↔ opentech-db | HTTP REST via `services/api.ts` | Displays technology catalogue, charts, time-series profiles; allows contributor submissions. |
| PyPSA model scripts | ← opentech-db | HTTP REST + `/adapt/pypsa/{id}` | Retrieves PyPSA-ready parameter dicts. |
| Calliope model scripts | ← opentech-db | HTTP REST + `/adapt/calliope/{id}` and `/technologies/{id}/calliope` | Retrieves Calliope YAML-ready dicts. |
| OSeMOSYS / ADOPTNet0 | ← opentech-db | HTTP REST `/technologies/{id}` | Retrieves raw OEO-aligned records; adapters to be implemented. |
| ORCID OAuth provider | ↔ frontend/backend | OAuth 2.0 redirect flow (`/auth/orcid`, `/auth/orcid/callback`) | Researcher identity verification for contributor login. |
| Supabase | ↔ frontend | Supabase JS SDK v2 | Email/password and GitHub OAuth session management; admin role sync. |
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
| Time-series catalogue | `GET` | `/api/v1/timeseries` | Paginated list of hourly profiles (capacity factors, load series). |
| Time-series data | `GET` | `/api/v1/timeseries/{id}/data` | Full hourly data array for one profile. |
| Submit new profile | `POST` | `/api/v1/timeseries/submit` | Contributor uploads a profile file + metadata; stored as pending. |
| Admin: review submissions | `GET` | `/api/v1/admin/timeseries/submissions` | Admin-only; lists pending profiles for approval. |
| Force data reload | `POST` | `/api/v1/debug/reload` | Clears the in-memory cache and re-reads all JSON files from disk. |

### Typical integration flows

**Energy modelling script (Python / PyPSA)**
1. Model script calls `GET /api/v1/adapt/pypsa/{tech_id}?instance_index=N&discount_rate=0.07`.
2. API returns a pre-annualised parameter dict with all PyPSA-required fields.
3. Script calls `network.add("Generator", name, **params)` without any manual unit conversion.

**Calliope model preparation**
1. Preprocessing script calls `GET /api/v1/technologies/calliope?category=generation`.
2. Response is written directly to `model/techs_generation.yaml`.
3. `model.yaml` imports this file; no technology parameters are hard-coded in the model.

**Web frontend browsing**
1. User opens the React SPA; `SideNavBar` shows category tabs.
2. `App.tsx` wraps `TechGrid` in `<Suspense>`; `services/api.ts` fetches catalogue via `use()` hook.
3. User clicks a technology card → `DetailsModal` opens; `TechCharts` renders ECharts cost/efficiency bars.
4. User navigates to time-series tab → `TimeSeriesCatalogue` lists profiles; `ProfileViewer` renders hourly chart.

**Contributor submission flow**
1. Contributor logs in via ORCID or Supabase (`AuthPage`).
2. Opens `ContributorWorkspace`; fills technology form or uploads a time-series profile via `UploadProfile`.
3. Submission stored as pending; admin reviews via `AdminPanel` and approves/rejects.

**Notebook / data exploration**
1. Analyst calls `GET /api/v1/technologies/category/generation`.
2. For each technology, fetches `GET /api/v1/technologies/{id}` to obtain all instances.
3. Builds a `pandas.DataFrame` covering all instances across all categories for comparison.

## Technical Context

The system consists of two processes: the **FastAPI backend** (Python) and the **Vite/React frontend** (TypeScript). In production they can be served on the same host; in development the Vite dev server runs independently on a separate port.

```
┌──────────────────────────────────────────────────────────┐
│                   opentech-db backend                    │
│                                                          │
│  ┌─────────┐   ┌───────────────────────────────────────┐ │
│  │ main.py │──►│ FastAPI routers                       │ │
│  └─────────┘   │  tech_router  (routes.py)             │ │
│                │  auth_router  (auth.py)                │ │
│                │  timeseries_router (timeseries.py)     │ │
│                │  admin_router, submissions_router      │ │
│                │  ontology_router                       │ │
│                │  adapter endpoints (main.py)           │ │
│                └────────────┬──────────────────────────┘ │
│          ┌──────────────────┼─────────────┐              │
│          ▼                  ▼             ▼              │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────┐        │
│  │ JSON loader  │  │  Adapters   │  │  Pydantic │        │
│  │ (dual-format)│  │ pypsa/      │  │  schemas  │        │
│  └──────┬───────┘  │ calliope    │  └───────────┘        │
│         │          └─────────────┘                       │
│         ▼                                                │
│  data/ (filesystem)                                      │
└──────────────────────────────────────────────────────────┘
         ▲ HTTP /api/v1/
         │
┌────────────────────────────────────┐
│       React 19 Frontend (SPA)      │
│  Vite 8 · TailwindCSS · Zustand 5  │
│  Leaflet · ECharts · React Flow    │
│  Supabase JS v2                    │
└────────────────────────────────────┘
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
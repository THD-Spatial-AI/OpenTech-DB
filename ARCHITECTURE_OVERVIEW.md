# OpenTech-DB — Architecture Overview

> **Prepared for:** Project Presentation  
> **Institution:** Deggendorf Institute of Technology (DIT) — THD-Spatial-AI Group  
> **Version:** 2.0 (May 2026)  
> **Author:** Ricardo Miranda

---

## 1. What is OpenTech-DB?

**OpenTech-DB** is an open-source, **Open Energy Ontology (OEO)-aligned** platform that
stores, validates, and exposes standardised **technical and economic parameters** for
55+ energy technologies. It acts as a single source of truth for energy system modelling
workflows.

### The problem it solves

Energy system models (PyPSA, Calliope, OSeMOSYS) require consistent, traceable input
parameters: CAPEX, efficiency, lifetime, emission factors. Today these are scattered across
PDFs, spreadsheets, and per-project scripts — with no shared provenance, no uncertainty
bounds, and no ontology alignment.

### OpenTech-DB provides

| Need | Solution |
|---|---|
| Standardised parameter schema | OEO-aligned Pydantic v2 models |
| Source traceability | Every value carries `source`, `year`, `min`, `max` |
| Multi-framework support | PyPSA and Calliope adapters (more planned) |
| Automated data discovery | Academic scraper pipeline (OpenAlex, NREL ATB, IRENA…) |
| Non-developer access | React 19 web frontend with charts and world map |
| Contributor workflow | ORCID + Supabase auth with admin review queue |
| Hourly profiles | Time-series catalogue of capacity factors and load profiles |

---

## 2. System Map

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │                        React 19 SPA  (frontend/)                        │  │
│   │                                                                          │  │
│   │  ┌───────────────┐  ┌────────────────┐  ┌──────────────┐  ┌──────────┐  │  │
│   │  │  TechGrid /   │  │  DetailsModal  │  │ TimeSeries   │  │ WorldMap │  │  │
│   │  │  TechCard     │  │  TechCharts    │  │ Catalogue    │  │ View     │  │  │
│   │  │  (browse)     │  │  (detail view) │  │ ProfileViewer│  │ Country  │  │  │
│   │  └───────────────┘  └────────────────┘  └──────────────┘  │ Panel    │  │  │
│   │                                                            └──────────┘  │  │
│   │  ┌─────────────────────┐  ┌──────────────────┐  ┌───────────────────┐   │  │
│   │  │  ContributorWork-   │  │   AdminPanel     │  │   AuthPage        │   │  │
│   │  │  space (submit      │  │   ScraperPanel   │  │   ORCID / Supabase│   │  │
│   │  │  tech / profile)    │  │   (review queue) │  │   OAuthCallback   │   │  │
│   │  └─────────────────────┘  └──────────────────┘  └───────────────────┘   │  │
│   └──────────────────────┬───────────────────────────────────────────────────┘  │
│                          │ HTTP + Bearer JWT                                     │
│   ┌──────────────────────▼───────────────────────────────────────────────────┐  │
│   │                    FastAPI Backend  (main.py)                            │  │
│   │                                                                          │  │
│   │  /technologies  /adapt  /timeseries  /auth  /scraper  /admin  /debug    │  │
│   │                                                                          │  │
│   │  ┌─────────────┐  ┌───────────┐  ┌─────────────┐  ┌──────────────────┐  │  │
│   │  │ routes.py   │  │ auth.py   │  │timeseries.py│  │scraper_routes.py │  │  │
│   │  │ (CRUD +     │  │ (ORCID    │  │ (catalogue, │  │ (status, run,    │  │  │
│   │  │  adapters)  │  │  JWT)     │  │  submit,    │  │  candidates,     │  │  │
│   │  │             │  │           │  │  approve)   │  │  approve/reject) │  │  │
│   │  └─────────────┘  └───────────┘  └─────────────┘  └──────────────────┘  │  │
│   └──────┬─────────────────────────────────────────────────────┬─────────┘  │
│          │                                                      │            │
│   ┌──────▼──────┐   ┌───────────────────────┐   ┌─────────────▼──────────┐  │
│   │ Data Layer  │   │  Framework Adapters   │   │   Scraper Pipeline     │  │
│   │             │   │                       │   │                        │  │
│   │ Supabase    │   │  pypsa_adapter.py     │   │  pipeline.py           │  │
│   │ (primary)   │   │  calliope_adapter.py  │   │  scheduler.py          │  │
│   │ JSON (dev)  │   │                       │   │  sources/ extractors/  │  │
│   │ LRU cache   │   │                       │   │  normalizer.py         │  │
│   └─────────────┘   └───────────────────────┘   │  storage.py            │  │
│                                                  └────────────────────────┘  │
│                                                                               │
│   ┌──────────────────────────────────────────────────────────────────────┐   │
│   │                         Supabase PostgreSQL                          │   │
│   │  technologies · Auth sessions · scraper_candidates · scraper_runs   │   │
│   │  technology_submissions · admin roles                                │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Deep-Dive

### 3.1 Data Layer — The Technology Catalogue

The catalogue is the heart of the system. All data lives in JSON files under `data/`:

```
data/
├── generation/generation_technologies.json     ← 21+ technologies
├── storage/storage_technologies.json           ← 12+ technologies
├── transmission/transmission_technologies.json ← 30+ technologies
├── conversion/conversion_technologies.json     ← 15+ technologies
└── timeseries/                                 ← 20+ hourly profiles
    ├── timeseries_catalogue.json               ← profile metadata index
    └── de_solar_pv_utility_cf_2019.json        ← 8 760 hourly capacity factors
```

**What makes a good technology record:**

```
Technology
 ├── technology_id: "ccgt"
 ├── technology_name: "Combined Cycle Gas Turbine (CCGT)"
 ├── carrier: "natural_gas"
 ├── oeo_class: "OEO_00000044"                  ← links to Open Energy Ontology
 ├── oeo_uri: "http://openenergy-platform.org/…/OEO_00000044"
 └── instances:
      └── EquipmentInstance
           ├── instance_id: "ccgt_800mw_current"
           ├── typical_capacity_mw: 800
           ├── capex_usd_per_kw: 900
           ├── efficiency_percent: 58.0
           ├── lifetime_years: 30
           ├── co2_emission_factor_operational_g_per_kwh: 202
           └── reference_source: "NREL ATB 2023"
```

Every numeric parameter is internally wrapped in a `ParameterValue` containing:
`value`, `unit`, `min`, `max`, `source`, `year` — enabling full uncertainty quantification
and bibliographic traceability, which is a hard requirement for scientific reproducibility.

**OEO Alignment** maps every technology subclass to a formal ontology concept:

| Technology class | OEO concept |
|---|---|
| `PowerPlant` | `oeo:PowerGeneratingUnit` |
| `VREPlant` | `oeo:RenewableEnergyPlant` |
| `EnergyStorage` | `oeo:ElectricEnergyStorageUnit` |
| `TransmissionLine` | `oeo:TransmissionLine` |
| `ConversionTechnology` | `oeo:EnergyConversionDevice` |

---

### 3.2 Backend — FastAPI Application

**Entry point:** `main.py`

The backend is a **FastAPI** application with:

- **ORJSONResponse** as default serialiser (fast, deterministic field ordering)
- **CORS** configured for frontend origins (ports 5173, 5174, 4173)
- **Seven router groups** mounted under `/api/v1/`
- **APScheduler** started on application lifespan for automated scraper runs
- **Swagger UI** at `/docs` and **ReDoc** at `/redoc`

**Router groups and their purposes:**

| Router | Base path | Description |
|---|---|---|
| `tech_router` | `/technologies` | List, filter, retrieve technologies and instances |
| `auth_router` | `/auth` | ORCID OAuth redirect/callback, JWT validation |
| `timeseries_router` | `/timeseries` | Profile catalogue, data retrieval, contributor submit |
| `scraper_router` | `/scraper` | Pipeline status, manual run trigger, candidate management |
| `debug_router` | `/debug` | Cache reload, JSON loading diagnostics |
| `ontology_router` | `/ontology` | Schema definitions and enum values |
| `admin_router` | `/admin` | Submissions review, approval, user management |

**Data loading flow:**

```
 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set?
       │
       YES ─────────────────────────────────────────────────────────────────►
       │                                                                     │
       │         SELECT id, payload FROM technologies WHERE is_active        │
       │                           │                                         │
       NO (local dev)              ▼                                         │
       │                   model_validate(payload)                           │
       │                   (dispatch via _pick_legacy_model)                 │
       ▼                           │                                         │
JSON files on disk                 └──────────────────────────────────────►  │
      │                                                                      │
      ▼                                                                      │
_load_json_file()                                                            │
      │                              dict[str, Technology]  (LRU cached)  ◄─┘
      ├── catalogue format ──► _load_catalogue_file()                        │
      └── legacy format ─────► _pick_legacy_model() + model_validate()       │
                                              │                              │
                                              ▼                              │
                                      HTTP route handlers ◄──────────────────┘
```

The LRU cache ensures technologies are loaded once per process lifetime.
`POST /api/v1/debug/reload` clears both the technology cache and the ontology schema
cache, triggering a fresh fetch from Supabase (or JSON files) on the next request.

---

### 3.3 Data Model — Pydantic v2 Schemas

Defined in `schemas/models.py`. The data model is the **single source of truth** for:
- Runtime JSON validation (both files and API payloads)
- Auto-generated OpenAPI documentation
- Type-safe Python objects across the codebase

```
Technology  (abstract base)
│
├── PowerPlant            # CCGT, OCGT, Coal, Nuclear, Biomass, Geothermal
│     └── VREPlant        # Solar PV, Wind, Hydro RoR, Marine
│
├── EnergyStorage         # Li-ion BESS, Pumped Hydro, CAES, H2 tanks
├── TransmissionLine      # HVAC/HVDC lines, pipelines, district heating
└── ConversionTechnology  # Electrolyzers, heat pumps, DAC, CCS, fuel cells
```

**Key supporting models:**

| Model | Purpose |
|---|---|
| `ParameterValue` | Wraps every number with unit, bounds, source, year |
| `EquipmentInstance` | One manufacturer/vintage/scenario row per technology |
| `GenerationProfile` | Hourly time-series metadata block on VREPlant records |
| `TechnologySummary` | Lightweight response for list endpoints |
| `TechnologyCatalogue` | Paginated catalogue response wrapper |

**Enums:** `TechnologyCategory` · `EnergyCarrier` · `LifeCycleStage`

---

### 3.4 Framework Adapters

Located in `adapters/`. Each adapter receives a `Technology` object + `instance_index`
and returns a **framework-native parameter dict** with all required unit conversions and
derived calculations already applied.

#### PyPSA Adapter (`adapters/pypsa_adapter.py`)

Translates OEO records into PyPSA component parameters. Key transformation:

**CAPEX annualisation via Capital Recovery Factor (CRF):**

$$\text{CRF} = \frac{r(1+r)^n}{(1+r)^n - 1}$$

Where $r$ = discount rate (e.g. 0.07) and $n$ = economic lifetime in years.

| OEO source field | PyPSA parameter | Conversion |
|---|---|---|
| `capacity_kw` | `p_nom` | direct [kW] |
| `electrical_efficiency` | `efficiency` | direct [fraction] |
| `capex_per_kw` × CRF | `capital_cost` | annualised [EUR/MW/yr] |
| `opex_variable_per_mwh` | `marginal_cost` | [EUR/MWh] |
| `co2_emission_factor` | `co2_emissions` | [tCO₂/MWh] |
| `economic_lifetime_yr` | `lifetime` | direct [years] |

Component type mapping: `generation → Generator`, `storage → StorageUnit`,
`transmission → Link`, `conversion → Link`

**Usage:**
```python
# Via API
GET /api/v1/adapt/pypsa/ccgt?instance_index=0&discount_rate=0.07

# Direct in Python
from adapters.pypsa_adapter import to_pypsa
params = to_pypsa(tech, instance_index=0, discount_rate=0.07)
network.add("Generator", "CCGT", **params)
```

#### Calliope Adapter (`adapters/calliope_adapter.py`)

Translates OEO records into Calliope `techs:` YAML config structure.

Technology type mapping: `generation (dispatchable) → supply`, `generation (VRE) → supply_plus`,
`storage → storage`, `transmission → transmission`, `conversion → conversion`

Key mapping examples:

| OEO field | Calliope key | Notes |
|---|---|---|
| `electrical_efficiency` | `constraints.energy_eff` | direct |
| `capex_per_kw` | `costs.monetary.energy_cap` | [EUR/kW] |
| `opex_variable_per_mwh` | `costs.monetary.om_prod` | ÷1000 to [EUR/kWh] |
| `ramp_up_rate` | `constraints.energy_ramping` | ÷100 × 60 [fraction/hour] |

**Usage:**
```python
# Full techs: block for all generation technologies
GET /api/v1/technologies/calliope?category=generation

# Single technology config
GET /api/v1/adapt/calliope/ccgt?cost_class=monetary
```

---

### 3.5 Scraper Pipeline — Automated Data Acquisition

Located in `scrapers/`. This subsystem automatically discovers and extracts energy
technology parameters from academic literature, removing manual curation effort.

**Architecture:**

```
APScheduler (twice/month, 02:00 UTC)
       │
       ▼
ScrapingPipeline.run()
       │
       ├── for each enabled source × technology:
       │   Source.search() → list[PaperRecord]
       │        OpenAlex   · Semantic Scholar  · NREL ATB
       │        Crossref   · arXiv             · Europe PMC
       │        Scopus*    · Google Scholar*   (*optional, premium)
       │
       ├── for each paper:
       │   TextExtractor  → list[ExtractedValue]  (regex, always runs)
       │   PDFExtractor   → full text             (optional, pdfplumber)
       │   LLMExtractor   → structured params     (optional, GPT/Claude)
       │
       ├── Normalizer
       │   → merges LLM + regex (LLM wins if confidence ≥ threshold)
       │   → builds flat catalogue-format candidate instance
       │   → infers country from paper text
       │
       └── Storage
           → Supabase scraper_candidates (primary)
           → data/scraped/candidates/ (file fallback)
```

**Candidate lifecycle:**
```
scraped → pending → [admin reviews] → approved (merged into catalogue)
                                   → rejected (archived)
```

**Key configuration** (`scraper_config.yaml`):

```yaml
schedule:
  jobs:
    - cron: "0 2 1 * *"    # 1st of month, 02:00 UTC
    - cron: "0 2 15 * *"   # 15th of month, 02:00 UTC

http:
  rate_limit_delay: 1.5      # seconds between API calls
  cache_enabled: true        # disk cache prevents duplicate API hits

extraction:
  llm_enabled: false         # enable for higher extraction quality (requires API key)
  confidence_threshold: 0.6  # minimum confidence to accept a value
```

**BaseScraper** provides all source scrapers with:
- Rate limiting (configurable delay between requests)
- Disk-based HTTP response cache (24 h TTL by default)
- Exponential back-off on HTTP 429/503 errors
- Polite User-Agent with institutional contact email (OpenAlex polite pool)

---

### 3.6 Database — Supabase Migrations

Located in `db/migrations/`. The database is **optional** — the system runs fully without
Supabase using local JSON files. When Supabase is configured, it stores:

| Table | Contents |
|---|---|
| `scraper_candidates` | All scraped candidates with status, source, extracted params, proposed instance |
| `scraper_runs` | Pipeline execution history (run_id, timing, paper counts, errors) |

Migrations are simple SQL files applied once:
```bash
psql "$SUPABASE_DB_URL" -f db/migrations/001_scraper_tables.sql
```

**Security:** Scraper tables are accessed via the service-role key (bypasses RLS).
Supabase auth tables use Row-Level Security — admins are promoted via `raw_app_meta_data`.

---

### 3.7 Frontend — React 19 SPA

Located in `frontend/`. A **Single-Page Application** built with React 19, TypeScript,
Vite 8, TailwindCSS, ECharts, and Leaflet. Served independently from the backend.

**React 19 patterns used:**

| Pattern | Where used | Benefit |
|---|---|---|
| `use()` hook + Suspense | `TechGrid`, `TimeSeriesCatalogue` | No `useEffect`/`useState` boilerplate for data fetching |
| `useDeferredValue` | Search input | Keeps grid visible while user types |
| `startTransition` | Category tab switches | No layout shift during navigation |
| `useOptimistic` | Share button | Instant feedback before async completes |

**Key views:**

| View | Components | Description |
|---|---|---|
| Technology catalogue | `TechGrid` + `TechCard` | Responsive grid of 55+ techs; filters by category and search |
| Technology detail | `DetailsModal` + `TechCharts` | Instance table + ECharts bar charts (CAPEX, efficiency, lifetime) + adapter output tabs |
| Time-series | `TimeSeriesCatalogue` + `ProfileViewer` | Browse 8 760-step hourly profiles; ECharts line chart; submit new profiles |
| World map | `WorldMapView` + `TechGeoMap` + `CountryPanel` | Leaflet map of technology instances by country |
| Contributor | `ContributorWorkspace` | Multi-step technology submission form + time-series upload |
| Admin | `AdminPanel` + `ScraperPanel` | Review submissions + scraper candidates; approve/reject |
| Auth | `AuthPage` + `OAuthCallback` | ORCID OAuth + Supabase email/GitHub login |

**State management:**

| Mechanism | Used for |
|---|---|
| `AuthContext` (React Context) | JWT, user identity, `isAdmin` flag |
| Zustand 5 | Active category, search query, modal state |
| Promise cache in `services/api.ts` | Deduplicates in-flight API requests |

**Build and deployment:**

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173 (hot reload)
npm run build    # TypeScript check + Vite bundle → frontend/dist/
```

Output in `frontend/dist/` is a standard static site deployable to Vercel, GitHub Pages,
nginx, Caddy, or Render static site hosting.

**Frontend tech stack:**

| Library | Version | Role |
|---|---|---|
| React | 19 | UI framework |
| Vite | 8 | Build tool — sub-second HMR |
| TypeScript | 5.9 | Type safety |
| TailwindCSS | 3.4 | Utility-first styling |
| ECharts | 6.x | Bar charts + time-series line charts |
| Leaflet | 1.9 | World map + location picker |
| Zustand | 5 | Minimal state management |
| Supabase JS | 2 | Auth sessions |

---

### 3.8 Authentication Flow

Three concurrent auth mechanisms serve different use cases:

```
┌────────────────────────────────────────────────────────┐
│                  Authentication Paths                  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Path 1 — ORCID OAuth (researcher identity)     │  │
│  │  User → GET /auth/orcid → ORCID OAuth page      │  │
│  │  ORCID → callback → backend issues HS256 JWT    │  │
│  │  JWT stored in sessionStorage; sent as Bearer   │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Path 2 — Supabase (email / GitHub OAuth)       │  │
│  │  Supabase JS SDK handles session management     │  │
│  │  Admin role stored in raw_app_meta_data         │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Path 3 — Built-in admin (email + bcrypt hash)  │  │
│  │  ADMIN_EMAIL + ADMIN_PASSWORD_HASH env vars     │  │
│  │  No external service dependency                 │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

Protected endpoints require `Authorization: Bearer <jwt>` header. Admin endpoints
additionally require `is_admin: true` in the JWT claims.

---

### 3.9 Time-Series Catalogue

Hourly capacity factors and load profiles are a first-class resource:

**Available profile types:** `capacity_factor`, `load`, `price`, `generation`, `weather`

**Coverage:** 8 760 hourly values for Germany (DE), France (FR), Spain (ES), United Kingdom (GB), Denmark (DK), Austria (AT), Norway (NO), Italy (IT), Greece (GR) — for solar PV, onshore/offshore wind, hydroelectric, day-ahead prices, and electricity load — year 2019.

**API:**
```bash
# Browse the catalogue
GET /api/v1/timeseries

# Fetch 8 760 hourly capacity factors for Germany solar PV 2019
GET /api/v1/timeseries/de_solar_pv_utility_cf_2019/data
```

**Contributor flow:** Authenticated researchers upload via `ContributorWorkspace` → stored
as `pending` → admin approves → profile appears in the public catalogue.

---

## 4. Deployment Options

### Local development

```bash
# Backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

### Docker

```bash
docker compose up --build    # backend on :8000
```

The `docker-compose.yml` mounts `./data` as a volume so JSON files can be edited without
rebuilding the image. The Dockerfile uses a two-stage build with `python:3.11-slim` and
a non-root `appuser` for security.

### Cloud (Render.com)

`render.yaml` configures a web service deployment on Render.com. The free tier handles
read-only API traffic; Supabase handles persistent data (candidates, runs).

---

## 5. Technology Coverage at a Glance

| Domain | Count | Examples |
|---|---|---|
| Generation | 21 technologies | Solar PV (utility/distributed/balcony), Wind (onshore/offshore fixed/floating), CSP, CCGT, OCGT, Nuclear (conventional + SMR), Hydro (RoR + reservoir), Biomass, Geothermal, Marine |
| Storage | 12 technologies | Li-ion BESS, Redox Flow, Pumped Hydro, CAES, LAES, Flywheels, Thermal (sensible + latent), H₂ tanks + underground |
| Conversion | 15 technologies | Electrolyzers (AWE, PEM, SOEC), Fuel Cells (PEM, SOFC), Heat Pumps, Electric Boilers, CHP, Methanation, Fischer-Tropsch, Haber-Bosch, DAC, CCS |
| Transmission | 30 technologies | HVAC/HVDC overhead + cable, Transformers, Gas/H₂/CO₂ pipelines, District heating/cooling, STATCOM, SVC, HVDC converters |

**Primary data sources:** NREL ATB 2023 · IRENA 2023 · Lazard LCOE v16.0 · IEA WEO 2023 · ENTSO-E TYNDP 2022 · CIGRE TB 812 · BloombergNEF ESO 2023 · IPCC AR6

---

## 6. Key Design Decisions

| Decision | Rationale |
|---|---|
| JSON files as DB (no SQL) | Version-controlled, diff-able, editable by any researcher, fully portable |
| Pydantic v2 for all models | Single source of truth: validates files, serialises API responses, generates docs |
| OEO alignment | Enables semantic interoperability with Open Energy Platform and partner databases |
| Adapter pattern | Each framework gets one isolated file — adding OSeMOSYS/ADOPTNet0 needs no core changes |
| React 19 `use()` + Suspense | Eliminates async boilerplate; fetching is treated as a first-class primitive |
| Scraper + human review | Automation reduces curation effort; mandatory review prevents dirty data entering catalogue |
| Dual-format JSON loader | Supports verbose legacy files and compact new catalogues without migrating all data |
| LRU cache + explicit reload | Fast startup, instant reads, curator-controlled hot-reload without server restart |

---

## 7. Extension Points

| What to add | How |
|---|---|
| New modelling framework adapter | Create `adapters/<framework>_adapter.py`, register endpoint in `main.py` |
| New technology | Add to `data/<category>/<category>_technologies.json`, call `POST /debug/reload` |
| New scraper source | Inherit from `BaseScraper`, implement `search()`, register in `pipeline.py` |
| New hourly profile | Upload via contributor workspace or place in `data/timeseries/` |
| New frontend view | Add React component under `frontend/src/components/`, wire into `App.tsx` |

---

## 8. Glossary (Quick Reference)

| Term | Definition |
|---|---|
| **OEO** | Open Energy Ontology — formal ontology for the energy domain (openenergy-platform.org/ontology/oeo) |
| **ParameterValue** | Pydantic model that wraps a number with `value`, `unit`, `min`, `max`, `source`, `year` |
| **EquipmentInstance** | One manufacturer/vintage/scenario row within a Technology record |
| **CRF** | Capital Recovery Factor — annualises CAPEX: `r(1+r)^n / ((1+r)^n − 1)` |
| **VREPlant** | Variable Renewable Energy plant (wind, solar, marine) — extends PowerPlant with `profile_key` |
| **Scraper candidate** | Automatically extracted parameter set awaiting admin approval |
| **LRU cache** | `@lru_cache` on `_load_all_technologies()` — cleared by `POST /debug/reload` |
| **ADOPTNet0** | Agent-based Decarbonisation Optimisation and Planning Tool for Net Zero (THD) |
| **ORCID** | Open Researcher and Contributor ID — persistent digital identifier for researchers |
| **SPA** | Single-Page Application — the React frontend is served as static files |
| **Supabase** | Open-source Firebase alternative — managed auth, Postgres DB, and user metadata |

---

*For detailed endpoint documentation see [API Reference](docs/api-reference.md).*  
*For a deeper architectural analysis see the arc42 LaTeX document in `documentation/`.*  
*MkDocs site: run `python -m mkdocs serve` from the project root.*

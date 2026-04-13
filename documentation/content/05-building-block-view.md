# Building Block View

## Level 1 — System Decomposition

```
opentech-db
|
+-- main.py              Application entry point; creates FastAPI app,
|                        registers all routers, configures CORS,
|                        mounts static /project-docs, defines adapter endpoints.
+-- Dockerfile           Container image definition (python:3.11-slim).
+-- docker-compose.yml   Compose stack; mounts data/ as a volume.
|
+-- schemas/
|   +-- models.py        All Pydantic data models (Technology hierarchy,
|                        EquipmentInstance, ParameterValue, enumerations).
|
+-- api/
|   +-- routes.py        HTTP route handlers + dual-format JSON data loader.
|   |                    Routers: tech_router, debug_router, ontology_router,
|   |                    admin_router, submissions_router.
|   +-- auth.py          ORCID OAuth flow (redirect + callback + /auth/me).
|   +-- timeseries.py    Time-series catalogue endpoints: timeseries_router
|                        (list, data) and admin_ts_router (submissions).
|
+-- adapters/
|   +-- pypsa_adapter.py     Translates Technology -> PyPSA component dict.
|   +-- calliope_adapter.py  Translates Technology -> Calliope config dict.
|
+-- data/
|   +-- generation/      Catalogue JSON + optional individual files
|   +-- storage/
|   +-- transmission/
|   +-- conversion/
|   +-- timeseries/      Hourly profile JSON files + timeseries_catalogue.json
|
+-- frontend/            React 19 SPA (TypeScript + Vite 8)
    +-- src/
        +-- App.tsx              Root shell; routing between 4 main views.
        +-- main.tsx             React DOM entry; AuthProvider wrapper.
        +-- services/
        |   +-- api.ts           HTTP client; promise memoisation for use() hook.
        |   +-- timeseries.ts    Time-series API client.
        +-- lib/
        |   +-- supabase.ts      Supabase JS v2 client instance.
        +-- context/
        |   +-- AuthContext.tsx  Auth state (ORCID + Supabase); JWT management.
        +-- components/
            +-- TechGrid.tsx           Category grid view (all technology cards).
            +-- TechCard.tsx           Individual technology summary card.
            +-- TechCharts.tsx         ECharts cost/efficiency bar charts.
            +-- MetadataTable.tsx      Instance parameters table view.
            +-- DetailsModal.tsx       Full technology detail modal.
            +-- SideNavBar.tsx         Category navigation sidebar.
            +-- TopNavBar.tsx          Header with search and auth buttons.
            +-- ErrorBoundary.tsx      Graceful API failure fallback.
            +-- timeseries/
            |   +-- TimeSeriesCatalogue.tsx  Paginated profile browser.
            |   +-- ProfileViewer.tsx        Hourly ECharts line chart.
            |   +-- UploadProfile.tsx        Contributor upload form.
            |   +-- MapPickerModal.tsx       Leaflet map for location selection.
            +-- auth/
            |   +-- AuthPage.tsx        ORCID + Supabase login page.
            |   +-- OAuthCallback.tsx   Handles ?token= from ORCID redirect.
            +-- contributor/
            |   +-- ContributorWorkspace.tsx  New technology submission form.
            +-- admin/
            |   +-- AdminPanel.tsx      Approve/reject submissions; manage users.
            +-- profile/
                +-- ProfilePage.tsx     User profile and settings.
```

## schemas/models.py — Data Model

| Class | OEO concept | Description |
|---|---|---|
| `ParameterValue` | `oeo:MeasuredValue` | Scalar with unit, uncertainty bounds, source, year. |
| `EquipmentInstance` | OEO individual | One manufacturer/vintage/scenario row within a Technology. |
| `Technology` | `oeo:EnergyConversionDevice` | Abstract base; all technologies inherit from this. |
| `PowerPlant` | `oeo:PowerGeneratingUnit` | Thermal and dispatchable generation. |
| `VREPlant` | `oeo:RenewableEnergyPlant` | Variable renewable (extends PowerPlant); carries `profile_key`. |
| `EnergyStorage` | `oeo:ElectricEnergyStorageUnit` | Battery, hydro, thermal, H2 storage. |
| `TransmissionLine` | `oeo:TransmissionLine` | Electrical lines, cables, pipelines. |
| `ConversionTechnology` | `oeo:EnergyConversionDevice` | Electrolyzers, heat pumps, CHP, DAC. |
| `TechnologySummary` | — | Lightweight list-endpoint response model. |
| `TechnologyCatalogue` | — | Paginated catalogue response wrapper. |

## api/routes.py — Loader Pipeline

```
File on disk
   |
   v
_load_json_file()          raw dict
   |
   +-- _is_catalogue()?
       |-- YES --> _load_catalogue_file()  -> list[Technology]
       |           (maps flat fields via _map_catalogue_instance)
       |-- NO  --> _pick_legacy_model()    -> Technology subclass
                   model_cls.model_validate(raw)
                        |
                        v
                 dict[str, Technology]   (LRU cached)
                        |
                        v
               HTTP route handlers
```

## api/auth.py — Authentication Flow

```
Browser / Frontend
   |
   +-- GET /api/v1/auth/orcid
   |       -> 302 redirect to ORCID OAuth endpoint
   |
   +-- GET /api/v1/auth/orcid/callback?code=...
   |       -> exchanges code for ORCID token
   |       -> issues signed JWT
   |       -> redirect to frontend with ?token=<jwt>
   |
   +-- GET /api/v1/auth/me  (Authorization: Bearer <jwt>)
           -> validates JWT, returns user profile
```

## api/timeseries.py — Time-Series API

```
GET /api/v1/timeseries
    -> reads timeseries_catalogue.json
    -> returns paginated list of ProfileSummary objects

GET /api/v1/timeseries/{id}/data
    -> loads data/<id>.json
    -> returns {profile_id, timestamps[], values[]}

POST /api/v1/timeseries/submit  (authenticated)
    -> stores file in data/timeseries/pending/
    -> adds entry to catalogue with status=pending

GET /api/v1/admin/timeseries/submissions  (admin only)
    -> lists all pending/approved profiles
```

## adapters/ — Framework Translation

Both adapters follow the same pattern:

1. Receive a `Technology` + `instance_index`.
2. Resolve the instance; extract scalar values with `_val()`.
3. Compute derived values (e.g. annualised CAPEX via CRF).
4. Return a plain `dict` matching the target framework parameter names.

## frontend/ — React 19 SPA

### Data fetching pattern

```
App.tsx (Suspense boundary)
   |
   +-- services/api.ts: fetchCategoryTechnologies(cat)
   |     promise memoised -> safe for React 19 use() hook
   |
   +-- use(promise) inside TechGrid
   |     suspends until data arrives
   |     startTransition wraps category tab switches
   |
   +-- useDeferredValue(searchQuery)
         defers filter re-computation; keeps typing responsive
```

### Auth state flow

```
main.tsx
   └── <AuthProvider>  (AuthContext.tsx)
         |
         +-- Supabase onAuthStateChange listener
         +-- JWT stored in sessionStorage
         +-- isAdmin flag synced from Supabase metadata
         |
         +-- <App>
               ├── TopNavBar (sign-in / sign-out button)
               ├── AuthPage  (ORCID redirect + Supabase forms)
               ├── OAuthCallback (receives ?token= from ORCID)
               ├── AdminPanel (guarded by isAdmin)
               └── ContributorWorkspace (guarded by isAuthenticated)
```

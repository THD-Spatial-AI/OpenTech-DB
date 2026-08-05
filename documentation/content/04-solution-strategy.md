# Solution Strategy

## Key Decisions and Their Rationale

### 1. FastAPI + Pydantic as validation and API layer

FastAPI integrates with Pydantic so the schema in `schemas/models.py` simultaneously:
- validates all JSON at runtime;
- auto-generates OpenAPI / Swagger docs;
- provides type-safe Python objects across the codebase.

### 2. Supabase data service with JSON seeds and fallback

Supabase PostgreSQL/PostgREST is the primary runtime data service for catalogue,
time-series, scraper, and submission records. Only FastAPI and maintenance tools receive
the service-role key. JSON files remain version-controlled seeds and allow local fallback.

### 3. Dual-format JSON loader

Two formats coexist — verbose individual ParameterValue files (legacy) and flat numeric
catalogue files (new). The loader auto-detects via `_is_catalogue()` and normalises both
into the same internal Pydantic models, keeping the API contract stable.

### 4. OEO alignment via `oeo_class` + `oeo_uri`

Every technology carries both a short class label (`oeo:GasTurbine`) and a full resolvable
URI, supporting human-readable references and machine-resolvable semantic web links.

### 5. ParameterValue — value + unit + uncertainty + source

Every numeric parameter is a ParameterValue object, ensuring no value reaches a model
without a stated unit and bibliographic source (core reproducibility requirement).

### 6. Adapter pattern for framework translation

PyPSA and Calliope have different parameter names, units, and component types. Adapter
modules encapsulate all translation logic, keeping schemas framework-agnostic. New
framework support means adding one new adapter file.

### 7. In-process LRU cache

All JSON files are loaded once at startup and cached in memory. A `POST /api/v1/debug/reload`
endpoint forces cache invalidation without a server restart.

### 8. React 19 SPA as the web frontend

A single-page application built with React 19, Vite 8, and TailwindCSS provides an
interactive technology browser without requiring users to write code. It uses React 19's
`use()` hook inside `<Suspense>` for async data fetching, `startTransition` for
category tab switches, and `useDeferredValue` to keep the search input responsive.

### 9. Go sessions and an isolated Keycloak realm

The existing login UI talks to a standalone Go service. Keycloak owns username/email,
passwords, optional GitHub/ORCID brokers, and realm roles. Go keeps Keycloak tokens in
Redis and gives the browser only opaque HttpOnly cookies. Supabase Auth is disabled.

### 10. Time-series profile catalogue as a first-class resource

Hourly capacity factors and load profiles are exposed as a separate catalogue
(`/api/v1/timeseries`), decoupled from the technology parameter records. VRE technologies
reference profiles by `profile_key`; the profiles themselves are submitted, reviewed, and
approved through a dedicated contributor workflow.

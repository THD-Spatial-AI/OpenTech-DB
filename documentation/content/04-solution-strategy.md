# Solution Strategy

## Key Decisions and Their Rationale

### 1. FastAPI + Pydantic as validation and API layer

FastAPI integrates with Pydantic so the schema in `schemas/models.py` simultaneously:
- validates all JSON at runtime;
- auto-generates OpenAPI / Swagger docs;
- provides type-safe Python objects across the codebase.

### 2. JSON files as persistence (no database)

JSON on disk is version-controlled with the code, editable by any researcher, and fully
portable. The trade-off (no concurrent writes) is acceptable because data changes slowly
(curated, not real-time).

### 3. Dual-format JSON loader

Two formats coexist  verbose individual ParameterValue files (legacy) and flat numeric
catalogue files (new). The loader auto-detects via `_is_catalogue()` and normalises both
into the same internal Pydantic models, keeping the API contract stable.

### 4. OEO alignment via `oeo_class` + `oeo_uri`

Every technology carries both a short class label (`oeo:GasTurbine`) and a full resolvable
URI, supporting human-readable references and machine-resolvable semantic web links.

### 5. ParameterValue  value + unit + uncertainty + source

Every numeric parameter is a ParameterValue object, ensuring no value reaches a model
without a stated unit and bibliographic source (core reproducibility requirement).

### 6. Adapter pattern for framework translation

PyPSA and Calliope have different parameter names, units, and component types. Adapter
modules encapsulate all translation logic, keeping schemas framework-agnostic. New
framework support means adding one new adapter file.

### 7. In-process LRU cache

All JSON files are loaded once at startup and cached in memory. A `POST /api/v1/debug/reload`
endpoint forces cache invalidation without a server restart.

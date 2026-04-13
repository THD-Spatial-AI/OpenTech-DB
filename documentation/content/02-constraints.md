# Constraints
## Technical Constraints

| ID | Constraint | Rationale |
|----|------------|----------|
| TC-01 | Backend language: **Python 3.11+** | Team expertise; ecosystem for data and energy modelling. |
| TC-02 | Backend web framework: **FastAPI** | Async-capable, automatic OpenAPI docs, Pydantic integration. |
| TC-03 | Data validation: **Pydantic v2** | Runtime type checking, JSON serialisation, nested model support. |
| TC-04 | Data storage: **JSON files on disk** (no database) | Zero infrastructure overhead; version-controllable data. |
| TC-05 | API responses: **JSON over HTTP** | Universal; supported by all modelling frameworks. |
| TC-06 | Technology data must reference **OEO URIs** | Semantic interoperability requirement with Open Energy Platform. |
| TC-07 | Parameters must carry **source and year** metadata | Reproducibility and auditability in scientific publications. |
| TC-08 | Adapter outputs must be directly usable by **PyPSA ≥ 0.26** and **Calliope ≥ 0.7** | Target framework versions used in research group. |
| TC-09 | Frontend language: **TypeScript / React 19** with **Vite 8** | Type safety; modern component model; fast dev build cycle. |
| TC-10 | Frontend auth: **Supabase JS v2** + **ORCID OAuth** | Researcher identity via ORCID; Supabase for session management. |
| TC-11 | Frontend state: **Zustand 5** | Minimal global state without Redux overhead. |
| TC-12 | Frontend mapping: **Leaflet** | Open-source; no map-tile API key required for basic usage. |
| TC-13 | Frontend charts: **ECharts** via `echarts-for-react` | Performant time-series and bar charts aligned with energy data use cases. |

## Organisational Constraints

| ID | Constraint | Rationale |
|----|------------|----------|
| OC-01 | All data released under **CC BY 4.0** | Open science policy of THD and DFG. |
| OC-02 | Code hosted on **Git** (version-controlled) | Reproducibility; data provenance via commit history. |
| OC-03 | Documentation follows **arc42** template | Standardised architecture communication in research group. |
| OC-04 | Development environment: **Windows + conda/venv** | Institutional IT setup; `.venv` used locally. |
| OC-05 | No cloud infrastructure budget at initial stage | Local uvicorn deployment; Docker container for production-like runs. |
| OC-06 | Frontend served separately from backend during development | Vite dev server on port 5173; cross-origin CORS configured explicitly. |
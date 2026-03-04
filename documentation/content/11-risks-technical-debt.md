# Risks and Technical Debt

## Known Risks

| ID | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| R-01 | Parameter data quality gaps | Medium | High | Each parameter requires `source` and `year`; Pydantic validates types; community review of sources. |
| R-02 | OEO concept changes or URI changes | Low | Medium | OEO URIs are stable; `oeo_class` (short name) provides fallback; monitor OEO releases. |
| R-03 | Framework API changes (PyPSA, Calliope) | Medium | Medium | Adapter modules are isolated; maintain version pins in `requirements.txt`. |
| R-04 | Data drift (parameters become outdated) | High | Medium | `reference_year` field on every `ParameterValue`; periodic review cycle recommended. |
| R-05 | Single-process, no authentication | Low | Low | Acceptable for local/research use; add API key middleware before any public deployment. |
| R-06 | Large data file set slows startup | Low | Low | LRU cache mitigates; lazy-loading per category can be added if needed. |

## Technical Debt

| ID | Item | Severity | Proposed Resolution |
|----|------|----------|---------------------|
| TD-01 | Legacy individual-format files coexist with catalogue format | Low | Migrate legacy files to catalogue format incrementally. |
| TD-02 | No automated test suite | High | Add pytest with coverage for schema validation, loader (both formats), adapter outputs, API routes. |
| TD-03 | Adapters for OSeMOSYS and ADOPTNet0 not yet implemented | Medium | Create `adapters/osemosys_adapter.py` and `adapters/adoptnet0_adapter.py` following the existing pattern. |
| TD-04 | No authentication or rate-limiting | Low | Add `fastapi-users` or a simple API key middleware before any public deployment. |
| TD-05 | `on_event("startup")` is deprecated in FastAPI >= 0.93 | Low | Migrate to `lifespan` context manager pattern. |
| TD-06 | Capacity factors stored as scalars, not linked to time-series profiles | Medium | Add a profile registry and link VREPlant instances to hourly capacity factor arrays. |
| TD-07 | No data versioning scheme for parameter updates | Medium | Introduce a `version` field on `EquipmentInstance` and a changelog mechanism. |

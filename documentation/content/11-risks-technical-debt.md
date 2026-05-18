# Risks and Technical Debt

## Known Risks

| ID | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| R-01 | Parameter data quality gaps | Medium | High | Each parameter requires `source` and `year`; Pydantic validates types; community review of sources. |
| R-02 | OEO concept changes or URI changes | Low | Medium | OEO URIs are stable; `oeo_class` (short name) provides fallback; monitor OEO releases. |
| R-03 | Framework API changes (PyPSA, Calliope) | Medium | Medium | Adapter modules are isolated; maintain version pins in `requirements.txt`. |
| R-04 | Data drift (parameters become outdated) | High | Medium | `reference_year` field on every `ParameterValue`; automated scraper surfacing new publications; periodic review cycle recommended. |
| R-05 | ORCID or Supabase service outage | Low | Medium | ORCID and Supabase auth are independent; backend API is fully usable without authentication. |
| R-06 | Large data file set slows startup | Low | Low | LRU cache mitigates; lazy-loading per category can be added if needed. |
| R-07 | Frontend Supabase keys exposed in built JS bundle | Medium | Low | Supabase anon key is by design public; Row-Level Security (RLS) must be configured on Supabase. |
| R-08 | Scraper extracts incorrect parameter values | Medium | Medium | Confidence scores, context sentences, and mandatory admin review before catalogue merge prevent bad data entering production. |
| R-09 | Academic source rate limits block scraper | Low | Low | Per-source rate limiting, disk caching, and configurable `rate_limit_delay` reduce API pressure. |
| R-10 | LLM API cost growth as catalogue scales | Low | Medium | LLM extraction is optional (disabled by default); regex extractor handles most common patterns without cost. |

## Technical Debt

| ID | Item | Severity | Proposed Resolution |
|----|------|----------|---------------------|
| TD-01 | Legacy individual-format files coexist with catalogue format | Low | Migrate legacy files to catalogue format incrementally. |
| TD-02 | No automated test suite | High | Add pytest for schema validation, loader (both formats), adapter outputs, API routes; add Vitest / Playwright for frontend components and E2E. |
| TD-03 | Adapters for OSeMOSYS and ADOPTNet0 not yet implemented | Medium | Create `adapters/osemosys_adapter.py` and `adapters/adoptnet0_adapter.py` following the existing pattern. |
| TD-04 | Admin endpoints have no rate-limiting | Low | Add `slowapi` or a reverse-proxy rate limit before any public deployment. |
| TD-05 | `on_event("startup")` is deprecated in FastAPI ≥ 0.93 | Low | Migrate to `lifespan` context manager pattern (partially done in `main.py`). |
| TD-06 | MapPickerModal (Leaflet) has no tile-server fallback | Low | Add an offline tile option or clear UX message when no network is available. |
| TD-07 | No data versioning scheme for parameter updates | Medium | Introduce a `version` field on `EquipmentInstance` and a changelog mechanism. |
| TD-08 | Frontend build not yet integrated into Dockerfile | Medium | Add a multi-stage Docker build: Node stage builds the SPA, Python stage serves it as static files. |
| TD-09 | Supabase Row-Level Security (RLS) not yet configured | High | Before public deployment, configure RLS policies so only admins can read/write submission records. |
| TD-10 | Scraper runs in-process with the API | Low | For high-traffic deployments, move the scraper to a separate Celery/ARQ worker process to avoid blocking event loop. |
| TD-11 | No bulk-approve flow for scraper candidates | Low | Add a batch approval endpoint for efficient processing of high-confidence candidate batches. |

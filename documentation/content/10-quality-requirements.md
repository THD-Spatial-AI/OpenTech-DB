# Quality Requirements

## Quality Tree

```
Quality
|
+-- Correctness & Traceability  (highest priority)
|   +-- Every parameter has source + year
|   +-- Pydantic validation on load prevents bad data entering the system
|   +-- Uncertainty bounds (min/max) on all ParameterValues
|
+-- OEO Compliance
|   +-- All records carry oeo_class and oeo_uri
|   +-- EnergyCarrier and TechnologyCategory enums match OEO vocabulary
|
+-- Extensibility
|   +-- New technology: drop JSON file, reload
|   +-- New framework: add one adapter module
|   +-- New parameter: add field to ParameterValue or EquipmentInstance
|
+-- Usability / Developer Experience
|   +-- Swagger UI auto-generated at /docs
|   +-- /debug/data endpoint for diagnostics
|   +-- /debug/reload for hot-reload without restart
|
+-- Availability / Resilience
    +-- Malformed JSON files logged and skipped; server continues
    +-- LRU cache ensures O(1) reads after first load
```

## Quality Scenarios

| ID | Quality | Stimulus | Response | Metric |
|----|---------|----------|----------|--------|
| QS-01 | Correctness | A JSON file with a missing `unit` field is added. | Pydantic raises `ValidationError`; file is skipped; error logged; all other technologies remain accessible. | 0 bad records served. |
| QS-02 | Traceability | A modeller asks where the CAPEX value for CCGT came from. | Every `ParameterValue` carries `source` (bibliographic ref) and `year`. | Answer available via API. |
| QS-03 | Extensibility | Add a new Biomass IGCC technology. | Drop one JSON file in `data/generation/`; POST to `/debug/reload`. | < 2 minutes, 0 code changes. |
| QS-04 | Extensibility | Add an OSeMOSYS adapter. | Create `adapters/osemosys_adapter.py` following the existing pattern. | 0 changes to routes.py or schemas. |
| QS-05 | Performance | Client requests the full generation technology list (19 entries). | Response served from in-memory cache. | < 50 ms response time. |
| QS-06 | Availability | One of 9 JSON files has a syntax error. | Server starts and serves the 8 valid files; error visible at `/debug/data`. | No crash; graceful degradation. |
| QS-07 | Usability | New modeller wants to use the API for the first time. | Swagger UI at `/docs` provides interactive docs with example requests. | First query within 5 minutes. |

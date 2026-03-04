# Runtime View

## Scenario 1 — Client queries all generation technologies

```
Client                   FastAPI                  routes.py cache
  |                          |                          |
  |-- GET /api/v1/           |                          |
  |   technologies/          |                          |
  |   category/generation -->|                          |
  |                          |-- _get_all() ----------->|
  |                          |<-- dict[id, Technology]--|
  |                          |   (served from LRU cache)|
  |                          |                          |
  |                          | filter by .category      |
  |                          |   == GENERATION          |
  |                          | build TechnologySummary list
  |                          |                          |
  |<-- 200 TechnologyCatalogue|                         |
  |   {total, technologies[]}|                          |
```

## Scenario 2 — Client requests a PyPSA parameter dict

```
Client                   main.py              pypsa_adapter
  |                          |                     |
  |-- GET /api/v1/adapt/     |                     |
  |   pypsa/{tech_id}?       |                     |
  |   instance_index=1 ----->|                     |
  |                          | _load_tech_from_id  |
  |                          | -> Technology object|
  |                          |                     |
  |                          |-- to_pypsa(tech,  ->|
  |                          |   instance_index=1) |
  |                          |                     | resolve instance[1]
  |                          |                     | compute annualised CAPEX
  |                          |                     | map ramp rates
  |                          |<-- dict{carrier,    |
  |                          |   p_nom, eff, ...}  |
  |<-- 200 {technology,      |                     |
  |   framework, parameters} |                     |
```

## Scenario 3 — Curator adds a new technology and reloads

```
Curator                  File System              API
  |                           |                    |
  | writes new JSON file ----->|                    |
  |                           |                    |
  |-- POST /api/v1/debug/     |                    |
  |   reload ---------------->|                    |
  |                           | cache_clear()      |
  |                           | _load_all_technologies() re-run
  |                           | reads all *.json   |
  |                           | validates each     |
  |<-- 200 {status: reloaded, |                    |
  |   total: N+1}             |                    |
```

## Startup Sequence

1. `uvicorn` starts; imports `main.py`.
2. FastAPI app is constructed; routers are registered.
3. `@app.on_event("startup")` fires: calls `_get_all()`.
4. Loader walks `data/**/*.json`, detects format, validates with Pydantic.
5. Loaded technologies are stored in the LRU cache.
6. Server logs catalogue size and begins accepting requests.

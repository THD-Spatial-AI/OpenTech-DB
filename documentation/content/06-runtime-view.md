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

---

## Scenario 4 — External Python script fetches all generation data into a DataFrame

```
Python script            FastAPI                LRU cache
  |                          |                      |
  |-- GET /api/v1/           |                      |
  |   technologies/          |                      |
  |   category/generation -->|                      |
  |                          |-- _get_all() ------->|
  |                          |<-- cached dict -------|
  |                          | filter category      |
  |<-- 200 {total, techs[]}  |                      |
  |                          |                      |
  | (for each tech_id):      |                      |
  |-- GET /api/v1/           |                      |
  |   technologies/{id} ---->|                      |
  |<-- 200 {instances:[...]} |                      |
  |                          |                      |
  | pd.DataFrame(rows)       |                      |
  | → CAPEX comparison table |                      |
```

Typical use: cost-curve analysis, sensitivity studies, report generation.

---

## Scenario 5 — Calliope model auto-populates techs.yaml before each run

```
Calliope prep script     FastAPI                 File system
  |                          |                       |
  |-- GET /api/v1/           |                       |
  |   technologies/calliope  |                       |
  |   ?category=generation ->|                       |
  |                          | build Calliope         |
  |                          | techs: block for      |
  |                          | all generation techs  |
  |<-- 200 {"techs": {...}}  |                       |
  |                          |                       |
  | yaml.dump(techs_block)   |                       |
  |-- write ----------------->                       |
  |      model/techs_generation.yaml                 |
  |                          |                       |
  | calliope.Model("model.yaml")                     |
  | → imports techs_generation.yaml automatically    |
```

No technology parameters are hard-coded in the Calliope model files; they are always fetched fresh from the API.

---

## Scenario 6 — PyPSA network script fetches pre-annualised parameters

```
PyPSA script             FastAPI              pypsa_adapter
  |                          |                     |
  | network = pypsa.Network()|                     |
  |                          |                     |
  | (for each tech):         |                     |
  |-- GET /api/v1/adapt/     |                     |
  |   pypsa/{tech_id}?       |                     |
  |   instance_index=N&      |                     |
  |   discount_rate=0.07 --->|                     |
  |                          |-- to_pypsa() ------->|
  |                          |                     | annualise CAPEX with CRF
  |                          |                     | map efficiency, ramp rates
  |                          |<-- param dict -------|
  |<-- 200 {parameters: {    |                     |
  |   carrier, p_nom,        |                     |
  |   efficiency,            |                     |
  |   capital_cost,          |                     |
  |   marginal_cost, ...}}   |                     |
  |                          |                     |
  | network.add("Generator", |                     |
  |   name, **parameters)    |                     |
  |                          |                     |
  | network.optimize()       |                     |
```

The adapter computes the annualised capital cost using the Capital Recovery Factor so the PyPSA script receives a ready-to-use `capital_cost [EUR/MW/yr]` and never handles unit conversions manually.

---

## Scenario 7 — OSeMOSYS / generic script fetches raw records

```
Model script             FastAPI                LRU cache
  |                          |                      |
  |-- GET /api/v1/           |                      |
  |   technologies/{id} ---->|                      |
  |                          |-- _get_all() ------->|
  |                          |<-- cached dict -------|
  |<-- 200 technology JSON   |                      |
  |   {instances: [{         |                      |
  |     capex_usd_per_kw,    |                      |
  |     lifetime_years,      |                      |
  |     efficiency_percent,  |                      |
  |     reference_source,    |                      |
  |     ...}]}               |                      |
  |                          |                      |
  | map fields manually      |                      |
  | to OSeMOSYS CSV columns  |                      |
```

Raw records use flat numeric fields (no unit wrappers). The `oeo_class` URI on each record enables semantic cross-referencing with other OEO-aligned databases.

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
2. FastAPI app is constructed; all routers are registered.
3. CORS middleware configured (ports 5173–5175, 4173).
4. Static files mounted at `/project-docs/` from `documentation/`.
5. `@app.on_event("startup")` fires: calls `_get_all()`.
6. Loader walks `data/**/*.json`, detects format, validates with Pydantic.
7. Loaded technologies stored in the LRU cache.
8. Server logs catalogue size and begins accepting requests.

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

---

## Scenario 5 — Calliope model auto-populates techs.yaml before each run

```
Calliope script          FastAPI
  |                          |
  |-- GET /api/v1/           |
  |   technologies/calliope  |
  |   ?category=generation ->|
  |                          | build full techs: block
  |<-- 200 {techs: {...}}    |
  |                          |
  | yaml.dump(techs_block)   |
  | → model/techs_generation.yaml
  |
  | calliope.Model("model.yaml")
  |   imports techs_generation.yaml
```

---

## Scenario 6 — User browses the React frontend

```
Browser                  React SPA               FastAPI
  |                          |                      |
  | open /                   |                      |
  |------------------------->|                      |
  |                          | App.tsx renders      |
  |                          | SideNavBar + TopNavBar|
  |                          |                      |
  |                          | use(fetchCategoryTechnologies("generation"))
  |                          |------- GET /api/v1/technologies/category/generation -->
  |                          |<------ 200 TechnologyCatalogue ----------------------|
  |                          |                      |
  |                          | TechGrid renders     |
  |                          | TechCard × N         |
  |<-- rendered HTML --------|                      |
  |                          |                      |
  | click on TechCard        |                      |
  |------------------------->|                      |
  |                          | DetailsModal open    |
  |                          | TechCharts render    |
  |                          | (ECharts bar charts) |
```

---

## Scenario 7 — ORCID login and contributor submission

```
Browser/User             Frontend (React)         Backend              ORCID
  |                          |                      |                    |
  | click "Sign in"          |                      |                    |
  |------------------------->|                      |                    |
  |                          |-- GET /api/v1/auth/orcid -->              |
  |                          |<-- 302 redirect to ORCID OAuth ---------->|
  |<-- redirect browser -----|                      |                    |
  |-----------------------------------------------------------> ORCID login
  |<-- redirect ?code=... ----------------------------------------------------------|
  |                          |                      |                    |
  |-- GET /auth/orcid/callback?code=... ----------->|                    |
  |                          |                      | exchange code      |
  |                          |                      | issue JWT          |
  |<-- redirect ?token=<jwt> |                      |                    |
  |                          |                      |                    |
  | OAuthCallback.tsx        |                      |                    |
  | stores JWT in            |                      |                    |
  | sessionStorage           |                      |                    |
  |                          |                      |                    |
  | ContributorWorkspace     |                      |                    |
  | fill & submit form       |                      |                    |
  |------------------------->|                      |                    |
  |                          |-- POST /api/v1/timeseries/submit (+ JWT)->|
  |                          |<-- 201 {status: pending} ----------------|
  |                          |                      |                    |
```

---

## Scenario 8 — Admin approves a time-series profile submission

```
Admin browser            Frontend (AdminPanel)    Backend
  |                          |                      |
  | open AdminPanel          |                      |
  |------------------------->|                      |
  |                          |-- GET /api/v1/admin/timeseries/submissions (+ JWT)
  |                          |<-- 200 [{status:pending, ...}] ----------|
  |                          |                      |                    |
  | click "Approve"          |                      |                    |
  |------------------------->|                      |                    |
  |                          |-- PATCH /api/v1/admin/timeseries/{id}/approve
  |                          |<-- 200 {status: approved} ---------------|
  |                          |                      |                    |
  |                          | profile moved from   |                    |
  |                          | pending/ to          |                    |
  |                          | timeseries/          |                    |
  |                          | catalogue updated    |                    |
```

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

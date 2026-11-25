# Simulations via the API

Process simulations run on the OpenTech DB server and are available only to
signed-in users. In the web app, the Process Studio uses your normal login.
Scripts and external tools use a personal API token.

## 1. Get a token

1. Sign in and open your **Profile** page.
2. Under **Personal API tokens**, choose the permission
   **Read and run simulations** (`simulate` scope) and generate a token.
3. Copy the token (`otdb_…`). It is shown only once. Revoke it from the same
   page if it leaks.

A `simulate` token can read the catalogue and submit simulations. It cannot
submit contributions or make any other change. Send it only over HTTPS, in
the `Authorization` header:

```http
Authorization: Bearer otdb_<complete-secret>
```

Requests without a session or token get `401`.

## 2. Submit a Process

`POST /api/v1/processes/simulate` takes a Process graph: `units` and the
`streams` connecting their ports. The easiest way to get a valid graph is to
start from a published Process or one built in the Studio:

```bash
API=https://otdb.th-deg.de/api/v1
TOKEN=otdb_...

curl -s -H "Authorization: Bearer $TOKEN" "$API/processes/biomass_chp" > process.json
curl -s -X POST "$API/processes/simulate" \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     --data @process.json
# → {"job_id": "…", "status": "queued", "position": 1, …}
```

Each unit has an `equipment_type` (see `GET /api/v1/processes/ontology`),
optional `operating_conditions` (`{"key": {"value": …, "unit": …}}`) that
override the defaults, an optional `technology_ref` to a catalogue
technology, and typed `ports`. Each stream connects one unit's `out` port to
another unit's `in` port. `POST /api/v1/processes/validate` checks a graph
without running it.

## 3. Poll for the result

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$API/processes/simulate/<job_id>"
```

`status` goes `queued` → `running` → `done` (or `error` / `timeout`). Poll
every second or two. When it is `done`, `result` holds:

| Field | Content |
|---|---|
| `units` | per-unit results (power, flows, efficiencies) and an energy `balance` |
| `streams`, `flows` | state and energy of every stream (the Studio's Sankey) |
| `kpi` | system KPIs, e.g. `overall_efficiency_pct`, `h2_production_kg_h` |
| `economics` | CAPEX/OPEX and levelised cost per unit |
| `time_series` | dynamic traces (OpenModelica engine only) |
| `engine` | `openmodelica` or `steady_state` |

A minimal Python client:

```python
import time, requests

API, TOKEN = "https://otdb.th-deg.de/api/v1", "otdb_..."
h = {"Authorization": f"Bearer {TOKEN}"}

graph = requests.get(f"{API}/processes/biomass_chp", headers=h).json()
job = requests.post(f"{API}/processes/simulate", json=graph, headers=h).json()
while job["status"] in ("queued", "running"):
    time.sleep(2)
    job = requests.get(f"{API}/processes/simulate/{job['job_id']}", headers=h).json()
print(job["status"], job["result"]["kpi"] if job["result"] else job["error"])
```

## Limits

- One active simulation per user. A second submission while one is queued
  or running returns `409`.
- Jobs are queued by role: administrators first, then contributors, then
  other users.
- Each run has a time budget (default 180 s) and ends with `timeout` if it
  goes over.
- Only you (and administrators) can read your jobs. Other users get `404`.

# Process Simulation Service

Simulates a user-built **Process** graph (ADR-0004). Two engines, one API:

- **`steady_state`** (default) — pure Python, no dependencies. Walks the graph
  in topological order, evaluates each Unit's component model, and returns
  per-Unit results, per-Stream states, and KPIs. Runs anywhere.
- **`openmodelica`** — the dynamic engine. The **flowsheet compiler**
  (`modelica_compiler.py`) turns the graph into a system model against the
  `modelica/OTDBComponents.mo` **Component library**, then compiles + simulates
  it with OpenModelica (via OMPython) for real transients (e.g. tank fill).

Both a Unit's operating conditions and its composed Catalogue Technology
(`technology_ref`, resolved via `catalogue.py`) parameterise the models.

## Run

```bash
pip install -r requirements.txt
python main.py                          # steady-state (default)
PROCESS_ENGINE=openmodelica python main.py   # dynamic engine
```

`PROCESS_ENGINE=openmodelica` additionally needs OMPython and an OpenModelica
install (`omc`) with a **working C toolchain**. If a run can't compile (e.g. the
compiler is blocked by endpoint security), the request transparently falls back
to the steady-state engine, so the API never hard-fails.

## API

- `GET  /api/health` → `{ engine_ready, engine, openmodelica_available, … }`
- `POST /api/process/simulate` — body is a Process graph `{ units, streams }`
  (the shape of `GET /api/v1/processes/{id}`); returns
  `{ units: {id: result}, streams: {id: state}, kpi, engine }`.
- `POST /api/process/verify` — front-end check of the generated Modelica
  (`checkModel`: parse + flatten, **no C compilation**); confirms the flowsheet
  is a balanced, valid model even where the compiler is unavailable.

## Adding an equipment type

1. **Steady-state:** add `fn(unit, inlets, oc, tech) -> (outlets, result)` to
   `components.py` and register it in `COMPONENTS`.
2. **OpenModelica:** add a `block` to `modelica/OTDBComponents.mo` (connectors
   named by Port id) and a `MODELICA_MAP` / `RESULT_VARS` entry in
   `modelica_compiler.py`.

Unknown `equipment_type`s fall back to `passthrough` (steady-state) / are skipped
(Modelica).

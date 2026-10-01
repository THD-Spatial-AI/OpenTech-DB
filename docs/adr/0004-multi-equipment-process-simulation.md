# Multi-equipment Process simulation and contribution

**Status:** Proposed — 2026-09-15

## Context

The Tech Simulator today ships two hardcoded systems — an H₂ power plant and an
amine CCS chain — each a fixed node graph wired to a bespoke backend
(`services/hydrogenmatsim`, `services/ccssim`). This does not extend: a user
cannot express a third system without new code, cannot build their own, and the
simulator is disconnected from the contribution pipeline that governs the rest
of the catalogue.

The value of a simulator here is **not** re-computing a single device — the
Catalogue already holds a Combined Cycle Gas Turbine's efficiency and cost. The
value is in **systems of several equipment** where the physics lives in the
*coupling*: the temperature, pressure, and mass/energy flow of the streams
between an electrolyzer, a compressor, a tank, and a fuel cell. That is a
dynamic, coupled problem, which is what Modelica solves.

We already have the two pieces this can build on:

- A Catalogue of **Technologies** with **Instances** carrying OEO-provenanced
  **Parameters** (`schemas/models.py`).
- A contribution pipeline: **Submission → Approval → GitHub PR** into the
  Catalogue (see `CONTEXT.md`, ADR-0001, ADR-0003).

## Decision

Introduce **Process** as a new first-class Catalogue concept: a connected graph
of **Units** (each referencing a Catalogue Technology/Instance) and **Streams**
(typed, stateful connections between Unit ports). A Process is simulated by
auto-wiring a **Modelica component-model library** from its graph via a
**Flowsheet compiler**, and is built and contributed in one **Process Studio**
section — a built Process is a draft that flows through the existing
Submission → Approval → PR pipeline.

Three choices are locked (2026-09-15):

1. **Compose Catalogue Technologies.** A Unit references an existing Technology
   (optionally a specific Instance); it does not redefine equipment inline. This
   reuses the Catalogue's Parameters and OEO provenance.
2. **Modelica component library, auto-wired.** Maintainers author one
   parameterized `.mo` model per equipment type; the Flowsheet compiler
   instantiates and connects them from the graph. No per-Process hand modeling.
3. **This ADR is the design.** Build proceeds in the phases below.

## Domain additions (to be merged into `CONTEXT.md` when accepted)

- **Process** — a named, connected graph of Units and Streams representing a
  multi-equipment energy transformation system (OEO: energy transformation
  chain). Contributed and versioned like a Technology. *Avoid:* "flowsheet",
  "plant", "scenario" as the artifact name — say Process.
- **Unit** — a node in a Process. References a Technology (and optionally one
  Instance) for its base Parameters and provenance, and adds **operating
  conditions** (setpoints) and a set of typed **Ports**. *Avoid:* "block",
  "box", "node" (say Unit).
- **Stream** — a directed connection between two Unit Ports. Carries an
  `EnergyCarrier` and a thermodynamic **state** (temperature, pressure,
  mass/mole flow, composition). *Avoid:* "edge", "link", "pipe" (say Stream).
- **Port** — a typed connection point on a Unit, tagged with an `EnergyCarrier`
  and a direction (in/out). Streams may only connect compatible Ports.
- **Component model** — a parameterized Modelica model for an equipment type,
  with a declared parameter and Port interface. The library maps a Technology
  (by OEO class / `technology_type` / slug) to a Component model.
- **Flowsheet compiler** — the server step that walks a Process graph, binds
  each Unit's Parameters + operating conditions into its Component model,
  connects Streams to Ports, and emits a system `.mo` for OpenModelica.

## Data model

New Pydantic models (`schemas/process.py`), payload-serialised like Technology.

```
Process
  id: UUID
  slug: str
  name: str
  description: str | None
  oeo_class / oeo_uri: str | None        # transformation-chain class, review-time (ADR-0001)
  status: draft | submitted | approved   # lifecycle; draft = user-private
  author: KeycloakSubject                 # attribution (ADR-0003)
  units: list[Unit]
  streams: list[Stream]
  source / year: provenance for the Process itself

Unit
  id: str                                  # stable within the Process
  technology_ref: str                      # Catalogue Technology slug/UUID  ← composition
  instance_ref: str | None                 # optional specific Instance
  operating_conditions: dict[str, ParameterValue]   # setpoints w/ provenance (T, P, load, ...)
  ports: list[Port]                        # derived from the Component model interface
  position: {x, y}                         # canvas layout

Stream
  id: str
  from: {unit_id, port_id}
  to:   {unit_id, port_id}
  carrier: EnergyCarrier
  state: { temperature_c?, pressure_bar?, mass_flow_kg_s?, composition? }  # optional design/initial values
```

A Unit's **base Parameters** (efficiency, CAPEX, ramp rate, …) come from the
referenced Technology/Instance — nothing is duplicated. The Process adds only
**connectivity** and **operating conditions**. This is precisely the "compose
Catalogue Technologies" choice, and it keeps every number OEO-provenanced.

## Storage and contribution

Processes are stored exactly like Technologies, per the ADR-0003 boundary:

- **Runtime:** Supabase `processes` table (JSONB payload); **seed:**
  `data/processes/<slug>.json`, version-controlled, extended by `scripts/`.
- **Drafts** are `status=draft` rows attributed to the author's Keycloak
  subject — user-private, editable, simulatable, not in the public Catalogue.
- **Contribution unifies with creation:** "Publish" on a draft creates a
  **Submission** (same table/lifecycle as today). **Approval** opens a GitHub PR
  adding `data/processes/<slug>.json` and upserts the `processes` row. This
  reuses the existing Submission → Approval → Approval-PR machinery, extended
  with a `process` payload type. The builder *is* the submission form — a draft
  and a Submission are the same artifact at different lifecycle states. That is
  the "mix both in a very good way": one canvas, two lifecycle destinations
  (my library / the shared Catalogue).

## Simulation architecture

- **Component-model library** — `services/processsim/modelica/OTDBComponents/`,
  one parameterized `.mo` per equipment type (electrolyzer, compressor, tank,
  fuel cell, turbine, absorber, stripper, …). Each declares a typed parameter
  interface and Ports keyed by `EnergyCarrier`. A **mapping registry** binds a
  Technology (by OEO class → `technology_type` → slug, most specific first) to a
  Component model and specifies how Catalogue Parameters + operating conditions
  fill its Modelica parameters.
- **Flowsheet compiler** — walks the Process graph, instantiates each Unit's
  Component model with bound parameters, connects Streams to Ports by carrier
  compatibility, emits a system `.mo`, and drives OpenModelica via OMPython
  (compile → simulate → normalized time-series + KPIs).
- **One service** — `services/processsim` (FastAPI + OpenModelica) generalizes
  and replaces `hydrogenmatsim` and `ccssim`, keeping their job/status/result
  and WebSocket contract so the existing frontend clients need only a base-URL
  change. A **steady-state mass/energy-balance fallback** runs when `omc` is
  absent (consistent with the current analytical fallback), so the feature is
  usable without a local OpenModelica install.

## App placement

Replace "Tools → Tech Simulator" with a top-level **Process Studio** section
with two modes:

- **Browse** — a Catalogue of contributed Processes (mirrors the Technology
  grid); opening one loads it read-only into the canvas, with **Fork** to edit.
- **Build** — the canvas (the already-reskinned React Flow surface and
  node-analysis panels). Each Unit's picker pulls Catalogue Technologies for its
  slot (the enriched picker path is already in place).

## Migration

Re-express today's two demos as seed Processes
(`data/processes/h2_power_plant.json`, `data/processes/ccs_amine.json`) authored
against the Component library. Reproducing the current H₂ and CCS results
through the general path is the acceptance test for Phases 1–3.

## Phased plan

1. **Data model + storage.** `schemas/process.py`; `data/processes/` + Supabase
   `processes` table + seed script; read APIs; H₂ and CCS re-expressed as seed
   Processes (still run by the legacy sim path). Update `CONTEXT.md` vocabulary.
2. **Builder MVP.** Process Studio section; create/edit/save **draft**; Unit
   picker → Catalogue; Stream typing + carrier-compatibility validation.
3. **Simulation engine.** `services/processsim` + Component library (the ~8
   equipment types H₂/CCS need first) + Flowsheet compiler; steady-state
   fallback; wire the builder to the new service; retire the two old services.
4. **Contribution.** Publish draft → Submission → Approval → PR for Processes;
   Browse + Fork contributed Processes.
5. **Coverage.** Expand the Component library and OEO mapping; per-component
   validation and regression tests against the seed Processes.

## Consequences

- This is the largest feature to date: it adds a first-class entity touching
  models, storage, APIs, the contribution pipeline, a new simulation service,
  and a navigation restructure. It should land phase-by-phase, each phase
  shippable on its own.
- The Component library becomes a maintained asset. Adding an equipment type is
  additive and bounded — one `.mo` model plus one mapping entry — in the spirit
  of the existing `adapters/` pattern.
- Every number stays OEO-provenanced because Units compose Catalogue
  Technologies rather than redefining equipment.
- The steady-state fallback keeps the feature usable where OpenModelica is not
  installed; full-fidelity dynamics require `omc`.
- `CONTEXT.md`, `docs/contributing-data.md`, and `docs/data-model.md` must gain
  the Process/Unit/Stream vocabulary before Phase 1 merges.
- **Risk:** graph→Modelica robustness (initialization, unit consistency, solver
  failure). Mitigated by starting from the two known-good H₂/CCS graphs, the
  steady-state fallback, and carrier-typed Ports that reject invalid wiring at
  build time.

**Consequence:** Process becomes a contributable Catalogue artifact alongside
Technology, sharing its storage boundary (ADR-0003) and its review gate
(ADR-0001) — no Process is auto-published; a maintainer approves each one before
it enters the shared Catalogue.

# Process validity: an OEO-aligned equipment ontology + validator

**Status:** Accepted — 2026-09-16

## Context

The builder's only connection rule is **carrier matching** (an OUT port's
`EnergyCarrier` must equal the IN port's). That blocks obvious nonsense
(electricity → a hydrogen inlet) but not the real domain logic: an electrolyzer
*needs* both power and water to function; a 700-bar tank *needs* a compressor
that reaches 700 bar; H₂ produced with no consumer is not a working process. A
carrier-compatible graph is not necessarily a **valid process**.

## Decision

Add an **OEO-aligned equipment ontology on the server as the single source of
truth**, and a **process validator** that runs a layered set of rules and
returns structured errors/warnings. The UX is **validate-and-guide**: the client
keeps the hard carrier/direction block at connect-time; everything else is
surfaced in a validation panel, and **Run/Publish are gated on hard errors
only**.

### Layers
- **L1 — Port typing** *(hard, at connect + revalidated)*: carrier + direction.
- **L2 — Equipment interface contract**: each `equipment_type` declares its
  ports with `required` in-ports (must be connected for the unit to function).
- **L3 — Stream state compatibility** *(warnings)*: delivered vs required state
  along a stream (e.g. compressor outlet pressure ≥ tank/fuel-cell requirement).
- **L4 — Process validity**: connected, acyclic (steady-state), has a source,
  every `required` input satisfied, no product left with no consumer.

### Where it lives
- **`schemas/process_ontology.py`** — `EQUIPMENT_ONTOLOGY` (per `equipment_type`:
  OEO class, category, and typed ports with `required`) + `validate_process()`.
- **`GET /api/v1/processes/ontology`** — the interface defs (the source of truth;
  the client uses them for required-port hints and to stay in sync).
- **`POST /api/v1/processes/validate`** — a graph → `{ valid, errors, warnings }`,
  each item `{ code, message, unit_id?, stream_id? }`.
- **Client** — the Studio shows a live validation panel, badges units with
  errors, and disables Run/Publish while hard errors exist.

Errors block; warnings inform (unconsumed product, orphan unit, pressure
mismatch). The Process **schema** keeps enforcing L1 on load; the validator is
the richer, advisory-plus-gating check for graphs coming from the builder.

## Consequences

- Connection/process rules become **data** (the ontology), not scattered code —
  adding an equipment type means one ontology entry, and the rules apply
  automatically. This is the counterpart of the `adapters/` and component-model
  registries.
- The client no longer *silently* accepts a graph that can't work; it explains
  why, and only stops you from running/publishing genuinely broken processes.
- New process **templates** (biomass CHP, biogas, power-to-gas) build on this:
  each needs its equipment added to the ontology (interfaces) as well as the
  palette, steady-state components, and — optionally — the Modelica library.
- The ontology is the natural place to later attach full OEO URIs and derive
  allowed connections from ontology relationships rather than hand-authored
  `required` flags.

**Consequence:** a Process is "valid" only when the ontology's interface
contracts and the graph-level checks pass — carrier matching alone no longer
implies a runnable process.

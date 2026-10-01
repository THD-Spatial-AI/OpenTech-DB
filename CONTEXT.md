# CONTEXT.md — OpenTech-DB Domain Glossary

> Single source of truth for domain language. All agents, contributors, and docs use these terms exactly as defined here.

---

## Core concepts

**Catalogue**
The curated collection of Technologies. **Primary store: Supabase `technologies` table** (one row per Technology, full Pydantic-serialised payload in JSONB). When Supabase is not configured, the system falls back to JSON files under `data/` (used for local development and as the initial seed). The catalogue is version-controlled via the seed data in `data/` — run `scripts/seed_technologies_to_supabase.py` to push JSON changes to Supabase. Distinct from the Supabase `scraper_candidates` and `technology_submissions` tables, which store unreviewed Candidates and Submissions.

**Technology**
A category of energy device (e.g., "Combined Cycle Gas Turbine"). Defines what kind of device it is: its OEO class, OEO URI, input/output energy carriers, and domain. One Technology contains one or more Instances. Technologies are never a single data point — they are the grouping concept.

*Avoid:* "tech", "entry", "record" (ambiguous — say Technology or Instance).

**Instance** *(code: `EquipmentInstance`)*
One specific data point within a Technology — a manufacturer variant, projection scenario, or vintage (e.g., "CCGT 800 MW, NREL ATB 2023"). Each Instance carries its own full set of Parameters with provenance. A Technology has many Instances; an Instance belongs to exactly one Technology.

*Avoid:* "variant", "configuration", "row".

**Parameter** *(code: `ParameterValue`)*
A measured quantity within an Instance. Every Parameter carries: a numeric value, a unit, an optional uncertainty range (min/max), a bibliographic source, and a reference year. Required for OEO alignment — bare numbers without provenance are not valid Parameters.

*Avoid:* "field", "value", "data point" (say Parameter).

**Domain**
One of the four top-level categories of Technologies in the catalogue: `generation`, `storage`, `transmission`, `conversion`. Each domain has its own JSON file under `data/<domain>/`.

**Profile** *(code: `profile_key`)*
An hourly time series (capacity factor or load) linked to a VRE Technology via `profile_key`. Profiles are stored in `data/timeseries/` and indexed in `timeseries_catalogue.json`.

---

## Contributor pipeline

**Candidate**
An unreviewed Instance record produced by the automated scraper pipeline. Candidates are stored in Supabase with lifecycle state `scraped → pending → approved | rejected`. A Candidate that is approved is merged into the Catalogue via a GitHub PR.

*Avoid:* "suggestion", "proposal" (say Candidate for scraper output).

**Submission**
An unreviewed Technology or Instance record contributed by a human researcher through the contributor workflow. Submissions share the same lifecycle as Candidates (`pending → approved | rejected`) and the same approval gate, but their origin is human rather than automated.

*Avoid:* "contribution" as a noun for the record itself (say Submission); "contribution" is fine as the act of submitting.

**Approval**
The admin action that moves a Candidate or Submission from `pending` to `approved`. Approval triggers a GitHub PR that merges the new data into the Catalogue JSON. Requires `GITHUB_TOKEN` with repo scope.

---

## Adapters

**Adapter**
A module that translates a Technology and its Instances from the catalogue format into a framework-specific parameter dict or config block. Current adapters: PyPSA, Calliope, OSeMOSYS. Adding a new adapter requires one file under `adapters/` — no changes to core models.

---

## Processes (multi-equipment simulation)

**Process** *(code: `Process`)*
A named, connected graph of Units and Streams representing a multi-equipment energy transformation system (OEO: energy transformation chain) — e.g., a hydrogen power plant or an amine CCS chain. A Process **composes** Catalogue Technologies rather than redefining equipment, and is contributed and versioned like a Technology. Seed Processes live in `data/processes/<slug>.json`. See ADR-0004.

*Avoid:* "flowsheet", "plant", "scenario" as the artifact name — say Process.

**Unit** *(code: `Unit`)*
One piece of equipment in a Process (a node in its graph). References a Catalogue Technology via `technology_ref` (and optionally one Instance) for its base Parameters and provenance, and adds `operating_conditions` (setpoints) plus typed Ports. `equipment_type` names the equipment kind and selects its Modelica Component model.

*Avoid:* "block", "box", "node" — say Unit.

**Stream** *(code: `Stream`)*
A directed connection carrying one EnergyCarrier from an OUT Port of one Unit to an IN Port of another, with an optional thermodynamic state (temperature, pressure, mass flow, composition).

*Avoid:* "edge", "link", "pipe" — say Stream.

**Port** *(code: `Port`)*
A typed connection point on a Unit, tagged with an EnergyCarrier and a direction (in/out). A Stream may only connect Ports that share its carrier.

**Component model**
A parameterized Modelica model for an equipment type, mapped to a Unit by `equipment_type`. The library of Component models is the simulation engine's counterpart to the Adapters. *(Arrives in a later ADR-0004 phase.)*

**Flowsheet compiler**
The server step that walks a Process graph, binds each Unit's Parameters and operating conditions into its Component model, connects Streams to Ports, and emits a system Modelica model for OpenModelica. *(Later phase.)*

---

## Terms to avoid

| Avoid | Use instead |
|---|---|
| "database" (without qualification) | "catalogue" (JSON store) or "Supabase database" |
| "tech" | "Technology" |
| "entry" / "record" | "Technology" or "Instance" (be specific) |
| "variant" / "configuration" | "Instance" |
| "field" / "value" / "data point" | "Parameter" |
| "contribution" (as a noun for the artifact) | "Submission" |
| "flowsheet" / "plant" / "scenario" (as the artifact) | "Process" |
| "block" / "box" / "node" | "Unit" |
| "edge" / "link" / "pipe" | "Stream" |

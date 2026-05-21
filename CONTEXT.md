# CONTEXT.md — OpenTech-DB Domain Glossary

> Single source of truth for domain language. All agents, contributors, and docs use these terms exactly as defined here.

---

## Core concepts

**Catalogue**
The curated collection of Technologies stored as JSON files under `data/`. The catalogue is the primary database — version-controlled, diff-able, and portable. Distinct from the Supabase PostgreSQL database, which stores Candidates, Submissions, and auth data only.

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

## Terms to avoid

| Avoid | Use instead |
|---|---|
| "database" (without qualification) | "catalogue" (JSON store) or "Supabase database" |
| "tech" | "Technology" |
| "entry" / "record" | "Technology" or "Instance" (be specific) |
| "variant" / "configuration" | "Instance" |
| "field" / "value" / "data point" | "Parameter" |
| "contribution" (as a noun for the artifact) | "Submission" |

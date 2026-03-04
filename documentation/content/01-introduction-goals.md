# Introduction & Goals

## Purpose

`OpenTech-db` is a domain-specific data repository and REST API that stores, manages, and distributes **standardised technical and economic parameters** for energy system technologies. It acts as a single source of truth for energy modelling workflows at the Deggendorf Institute of Technology (DIT) and partner institutions.

The system provides:

- A curated catalogue of **55+ energy technologies** across generation, storage, transmission, and conversion domains.
- Alignment with the **Open Energy Ontology (OEO)** to ensure semantic interoperability.
- Multiple **equipment instances** per technology (manufacturer variants, vintages, projection scenarios), each with explicit data provenance.
- A **REST API** that any modelling framework or notebook can query over HTTP.
- Built-in **adapter modules** that translate OEO records into PyPSA and Calliope model parameters.

## Functional Requirements (Top 5)

| ID | Requirement |
|----|-------------|
| FR-01 | Store technical and economic parameters with uncertainty bounds and bibliographic source for each parameter. |
| FR-02 | Expose a REST API allowing retrieval of technologies by category, ID, and tag. |
| FR-03 | Support multiple equipment instances per technology (manufacturer, vintage, scenario). |
| FR-04 | Translate stored technology records into PyPSA and Calliope input formats. |
| FR-05 | Allow new technologies to be added by dropping a JSON file, without code changes. |

## Quality Goals

| Priority | Quality Attribute | Motivation |
|----------|-------------------|------------|
| 1 | **Correctness & Traceability** | Every parameter must carry a source reference and year so that model results are fully auditable. |
| 2 | **OEO Compliance** | All records link to OEO URIs, enabling semantic querying and integration with the Open Energy Platform. |
| 3 | **Extensibility** | Adding a new technology or a new modelling framework adapter must require no changes to existing components. |
| 4 | **Usability** | A modeller with basic Python skills must be able to query and use the data within minutes. |
| 5 | **Availability** | The API must start reliably and handle missing or malformed JSON files gracefully without crashing. |

## Stakeholders

| Stakeholder | Role | Expectations |
|-------------|------|--------------|
| Energy System Modellers (THD) | Primary users | Accurate, source-traced parameters ready for Calliope / PyPSA. |
| Data Engineers / Curators | Maintain JSON files | Clear schema, validation feedback, easy add/update workflow. |
| Framework Developers (OSeMOSYS, ADOPTNet0) | Adapter authors | Stable API contract; easy to write new adapter modules. |
| Research Partners / OEP | Consumers | OEO-aligned data exports compatible with the Open Energy Platform. |
| Ricardo Miranda (Architect/Developer) | Owner | Clean architecture, low technical debt. |

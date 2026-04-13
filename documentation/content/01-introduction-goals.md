# Introduction & Goals

## Purpose

`opentech-db` is a domain-specific data repository and REST API that stores, manages, and distributes **standardised technical and economic parameters** for energy system technologies. It acts as a single source of truth for energy modelling workflows at the Deggendorf Institute of Technology (DIT) and partner institutions.

The system provides:

- A curated catalogue of **55+ energy technologies** across generation, storage, transmission, and conversion domains.
- Alignment with the **Open Energy Ontology (OEO)** to ensure semantic interoperability.
- Multiple **equipment instances** per technology (manufacturer variants, vintages, projection scenarios), each with explicit data provenance.
- A **REST API** that any modelling framework or notebook can query over HTTP.
- Built-in **adapter modules** that translate OEO records into PyPSA and Calliope model parameters.
- A **React 19 web frontend** for browsing, visualising, and contributing technology data.
- A **time-series profile catalogue** with hourly capacity factors and load profiles linked to technology records.
- **Authentication** via ORCID OAuth and Supabase, enabling contributor workflows and admin review.

## Functional Requirements (Top 8)

| ID | Requirement |
|----|-------------|
| FR-01 | Store technical and economic parameters with uncertainty bounds and bibliographic source for each parameter. |
| FR-02 | Expose a REST API allowing retrieval of technologies by category, ID, and tag. |
| FR-03 | Support multiple equipment instances per technology (manufacturer, vintage, scenario). |
| FR-04 | Translate stored technology records into PyPSA and Calliope input formats. |
| FR-05 | Allow new technologies to be added by dropping a JSON file, without code changes. |
| FR-06 | Expose a time-series profile catalogue (hourly capacity factors, load profiles) linked to VRE technologies. |
| FR-07 | Provide a web frontend for browsing, filtering, and visualising the technology catalogue. |
| FR-08 | Support authenticated contributor submissions and admin review/approval workflow. |

## Quality Goals

| Priority | Quality Attribute | Motivation |
|----------|-------------------|------------|
| 1 | **Correctness & Traceability** | Every parameter must carry a source reference and year so that model results are fully auditable. |
| 2 | **OEO Compliance** | All records link to OEO URIs, enabling semantic querying and integration with the Open Energy Platform. |
| 3 | **Extensibility** | Adding a new technology or a new modelling framework adapter must require no changes to existing components. |
| 4 | **Usability** | A modeller with basic Python skills must be able to query and use the data within minutes. A non-developer can browse via the web UI. |
| 5 | **Availability** | The API must start reliably and handle missing or malformed JSON files gracefully without crashing. |

## Stakeholders

| Stakeholder | Role | Expectations |
|-------------|------|--------------|
| Energy System Modellers (THD) | Primary API consumers | Accurate, source-traced parameters ready for Calliope / PyPSA. |
| Data Curators / Contributors | Maintain and extend JSON files; submit via web UI | Clear schema, validation feedback, easy add/update workflow. |
| Framework Developers (OSeMOSYS, ADOPTNet0) | Adapter authors | Stable API contract; easy to write new adapter modules. |
| Research Partners / OEP | External consumers | OEO-aligned data exports compatible with the Open Energy Platform. |
| Non-technical Researchers | Web frontend users | Intuitive browsing, chart visualisation, map-based location picker. |
| Ricardo Miranda (Architect/Developer) | Owner | Clean architecture, low technical debt. |

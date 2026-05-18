# OpenTech-DB

> An **Open Energy Ontology (OEO)-aligned** database, REST API, and React 19 web frontend for energy generation, storage, transmission, and conversion technologies. Designed to feed real, traceable data into energy modelling frameworks.

[![Python](https://img.shields.io/badge/python-3.11%2B-blue)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Data: CC BY 4.0](https://img.shields.io/badge/Data-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)
[![OEO](https://img.shields.io/badge/ontology-OEO-green)](https://openenergy-platform.org/ontology/oeo/)

---

## What is OpenTech-DB?

`opentech-db` is a domain-specific data repository that provides **standardised, source-traced technical and economic parameters** for energy system components. Developed at the [Deggendorf Institute of Technology (DIT)](https://www.th-deg.de) THD-Spatial-AI group, it serves as a single source of truth that multiple energy modelling frameworks can query programmatically.

Key capabilities:

- **55+ energy technologies** across generation, storage, transmission, and conversion — all OEO-aligned
- **REST API** (FastAPI) with Swagger UI, ReDoc, and OpenAPI JSON
- **Framework adapters** for PyPSA, Calliope, OSeMOSYS, and ADOPTNet0
- **Uncertainty-aware parameters** — every value carries `min`, `max`, `source`, and `year`
- **Time-series profile catalogue** — hourly capacity factors and load profiles for multiple countries
- **Automated scraper pipeline** — pulls data from OpenAlex, Semantic Scholar, NREL ATB, IRENA, and more
- **React 19 SPA** for browsing, visualising, and contributing data
- **World map view** — geographic visualisation of technology instances by country
- **Contributor workflow** with ORCID + Supabase authentication and admin review

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    React 19 SPA (Frontend)                  │
│   TechGrid · DetailsModal · WorldMap · TimeSeriesViewer     │
│   ContributorWorkspace · AdminPanel · ScraperPanel          │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP / REST
┌──────────────────────▼──────────────────────────────────────┐
│                FastAPI Backend (main.py)                     │
│  /technologies  /adapt  /timeseries  /auth  /scraper        │
│  /admin  /debug  /ontology  /health                         │
└──────┬─────────────────────────────────┬────────────────────┘
       │                                 │
┌──────▼──────────┐         ┌────────────▼──────────────────┐
│  Data Layer     │         │  Scraper Pipeline             │
│  data/*.json    │         │  OpenAlex · Semantic Scholar   │
│  Pydantic v2    │         │  NREL ATB · IRENA · Crossref   │
│  LRU cache      │         │  APScheduler · LLM extract.   │
└─────────────────┘         └───────────────────────────────┘
```

---

## Live API

The API is publicly accessible — no setup required for read-only access:

| Interface | URL |
|---|---|
| Swagger UI | `http://localhost:8000/docs` |
| ReDoc | `http://localhost:8000/redoc` |
| OpenAPI JSON | `http://localhost:8000/openapi.json` |
| Health check | `http://localhost:8000/health` |

---

## Documentation

| Section | Description |
|---|---|
| [Overview](overview.md) | Design principles, technology coverage, data sources |
| [Getting Started](getting-started.md) | Installation, Docker, environment variables, quick start |
| [API Reference](api-reference.md) | All REST endpoints with request/response examples |
| [Integration Guide](integration.md) | curl, Python, PyPSA, Calliope code examples |
| [Data Model](data-model.md) | Pydantic schema, OEO alignment, ParameterValue |
| [Data Formats](data-formats.md) | JSON formats, adding new technologies |
| [Framework Adapters](adapters.md) | PyPSA and Calliope adapters, CRF formula |
| [Scraper Pipeline](scrapers.md) | Automated data acquisition from academic sources |
| [Time-Series Catalogue](timeseries.md) | Hourly profiles, contributor upload |
| [Authentication](authentication.md) | ORCID OAuth, Supabase auth, admin setup |
| [Web Frontend](frontend.md) | React SPA views, state management, build instructions |

---

## License

Code is released under the **MIT License**. Data files and documentation content are released under **CC BY 4.0**. See `LICENSE` and `ATTRIBUTIONS.md` in the repository root.

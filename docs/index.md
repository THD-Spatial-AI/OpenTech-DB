# OpenTech-DB

> An **Open Energy Ontology (OEO)-aligned** database, REST API, and React 19 web frontend for energy generation, storage, transmission, and conversion technologies. Designed to feed real, traceable data into energy modelling frameworks.

[![Python](https://img.shields.io/badge/python-3.11%2B-blue)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![License: CC BY 4.0](https://img.shields.io/badge/License-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)
[![OEO](https://img.shields.io/badge/ontology-OEO-green)](https://openenergy-platform.org/ontology/oeo/)

---

## What is OpenTech-DB?

`opentech-db` is a domain-specific data repository that provides **standardised, source-traced technical and economic parameters** for energy system components. It serves as a single source of truth that multiple energy modelling frameworks can query programmatically.

Key capabilities:

- **55+ energy technologies** across generation, storage, transmission, and conversion — all OEO-aligned
- **REST API** (FastAPI) with Swagger UI, ReDoc, and OpenAPI JSON
- **Framework adapters** for PyPSA, Calliope, OSeMOSYS, and ADOPTNet0
- **Time-series profile catalogue** — hourly capacity factors and load profiles
- **React 19 SPA** for browsing, visualising, and contributing data
- **Contributor workflow** with ORCID + Supabase authentication

---

## Live API

The API is publicly accessible — no setup required for read-only access:

| Endpoint | URL |
|---|---|
| Swagger UI | `http://localhost:8000/docs` |
| ReDoc | `http://localhost:8000/redoc` |
| OpenAPI JSON | `http://localhost:8000/openapi.json` |
| Health check | `http://localhost:8000/health` |

---

## Documentation

| Section | Description |
|---|---|
| [Overview](overview.md) | Technology coverage, design principles |
| [Getting Started](getting-started.md) | Installation and quick start |
| [API Reference](api-reference.md) | All REST endpoints |
| [Integration Guide](integration.md) | curl, Python, PyPSA, Calliope examples |
| [Data Model](data-model.md) | Pydantic schema and OEO structure |
| [Data Formats](data-formats.md) | JSON formats, adding new technologies |
| [Framework Adapters](adapters.md) | PyPSA and Calliope adapters |
| [Time-Series Catalogue](timeseries.md) | Hourly profiles and contributor upload |
| [Authentication](authentication.md) | ORCID OAuth and Supabase auth |
| [Web Frontend](frontend.md) | React SPA views and environment setup |

---

## License

Data and documentation are released under `LICENSE` in the repository root.

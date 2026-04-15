# OpenTech-DB

> An **Open Energy Ontology (OEO)-aligned** database, REST API, and React 19 web frontend for energy generation, storage, transmission, and conversion technologies — designed to feed real, traceable data into energy modelling frameworks (Calliope, PyPSA, OSeMOSYS, ADOPTNet0).

[![Python](https://img.shields.io/badge/python-3.11%2B-blue)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.0-646CFF)](https://vite.dev/)
[![License: CC BY 4.0](https://img.shields.io/badge/License-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)
[![OEO](https://img.shields.io/badge/ontology-OEO-green)](https://openenergy-platform.org/ontology/oeo/)

**55+ technologies** · generation · storage · transmission · conversion · time-series profiles · contributor workflow

📖 **[Full documentation](docs/index.md)**

---

## Quick Start

### Backend

```bash
git clone https://mygit.th-deg.de/thd-spatial-ai/opentech-db.git
cd opentech-db
python -m venv .venv && .venv\Scripts\activate   # Windows
# source .venv/bin/activate                       # Linux/macOS
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

| Interface | URL |
|---|---|
| Swagger UI | http://127.0.0.1:8000/docs |
| ReDoc | http://127.0.0.1:8000/redoc |
| Web UI | http://localhost:5173 |

### Frontend (separate terminal)

```bash
cd frontend
npm install
npm run dev
```

### Docker

```bash
docker compose up --build
```

---

## Documentation

| Topic | Link |
|---|---|
| Overview & technology coverage | [docs/overview.md](docs/overview.md) |
| Installation & configuration | [docs/getting-started.md](docs/getting-started.md) |
| API reference | [docs/api-reference.md](docs/api-reference.md) |
| Integration guide (Python, PyPSA, Calliope) | [docs/integration.md](docs/integration.md) |
| Data model | [docs/data-model.md](docs/data-model.md) |
| JSON data formats & adding technologies | [docs/data-formats.md](docs/data-formats.md) |
| Framework adapters | [docs/adapters.md](docs/adapters.md) |
| Time-series catalogue | [docs/timeseries.md](docs/timeseries.md) |
| Authentication | [docs/authentication.md](docs/authentication.md) |
| Web frontend | [docs/frontend.md](docs/frontend.md) |

---

## License

Data and documentation are released under `LICENSE` in the repository root.

# OpenTech-DB

> An **Open Energy Ontology (OEO)-aligned** database, REST API, and React 19 web frontend for energy generation, storage, transmission, and conversion technologies — designed to feed real, traceable data into energy modelling frameworks (Calliope, PyPSA, OSeMOSYS, ADOPTNet0).

[![Python](https://img.shields.io/badge/python-3.11%2B-blue)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.0-646CFF)](https://vite.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Data: CC BY 4.0](https://img.shields.io/badge/Data-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)
[![OEO](https://img.shields.io/badge/ontology-OEO-green)](https://openenergy-platform.org/ontology/oeo/)


**[Full documentation](https://thd-spatial-ai.github.io/OpenTech-DB/)**

---

## Quick Start

### Backend

```bash
git clone --recurse-submodules https://github.com/THD-Spatial-AI/OpenTech-DB.git
cd OpenTech-DB
make install     # dependencies + Supabase data services + Keycloak/auth stack
make backend
```

| Interface | URL |
|---|---|
| Swagger UI | http://127.0.0.1:8000/docs |
| ReDoc | http://127.0.0.1:8000/redoc |
| Web UI | http://localhost:5173 |
| Keycloak Admin Console | http://localhost:8080/admin/ |

### Frontend (separate terminal)

```bash
make frontend
```

### Restarting the authentication stack

```bash
make auth
```

`make auth` checks that `keycloak/.env.local` still matches the persisted
Keycloak database before starting the stack. For disposable local data, an
intentional reset is available with:

```bash
make auth-reset CONFIRM=delete-local-keycloak-data
```

The reset removes only the local Keycloak database and Redis sessions; it does
not remove Supabase data.

Authentication uses the standalone Go service and the isolated `opentechdb`
Keycloak realm. React never receives Keycloak tokens and does not use
`keycloak-js`. Signed-in users can create revocable, hashed personal API tokens
from their profile for scripts and integrations; see
[Authentication](docs/authentication.md).

The authentication stack is pinned as the `keycloak/` Git submodule from
[THD-Spatial-AI/keycloak-auth](https://github.com/THD-Spatial-AI/keycloak-auth).
`make install` and `make auth` initialize it automatically, so a clone made
without `--recurse-submodules` also works. Use `make auth-init` to fetch only
the revision recorded by this application.

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
| Contributing data (researchers) | [docs/contributing-data.md](docs/contributing-data.md) |

---

## License

Code is released under the [MIT License](LICENSE).  
Catalogue data (`data/`) and documentation are released under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — you are free to use, share, and adapt with attribution.

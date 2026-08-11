# OpenTech DB

OEO-aligned (Open Energy Ontology) technology parameter database for energy system modelling. Stores standardized technical and economic parameters for 55+ energy technologies (generation, storage, transmission, conversion) and exports them to frameworks such as PyPSA, Calliope, and OSeMOSYS.

- **Backend:** FastAPI (Python)
- **Frontend:** React 19 SPA (Vite)
- **Primary data store:** versioned JSON files in `data/` — diff-able and portable
- **Auth:** Keycloak `opentechdb` realm + Go session service (tokens stay server-side in Redis)
- **Workflow data:** self-hosted Supabase (PostgreSQL/PostgREST), backend-only

## Architecture

```
Browser
  │  HTTPS
  ├── /           Nginx → React 19 SPA
  ├── /api/       Nginx → FastAPI (Python)
  └── /auth-api/  Nginx → Go auth-service → Keycloak opentechdb realm
                                           ↳ Redis (server-side sessions)
FastAPI ──────────────────────────────────> Supabase (scraper data, API tokens)
```

The browser never receives a Keycloak token, a Supabase key, or a JWT. It holds only an opaque `session_id` HttpOnly cookie.

## Quick start

**Prerequisites:** Python 3.11+, Node.js 18+, Docker Desktop.

```bash
# First time only — installs all dependencies and starts background services
make install

# Every subsequent time — starts all services and both dev servers
make start
```

`make start` is the day-to-day command. It ensures Supabase and the Keycloak/auth stack are running, then launches FastAPI (`:8000`) and Vite (`:5173`) together in one terminal. Press `Ctrl+C` to stop.

If you prefer separate terminals:

```bash
make backend    # FastAPI on :8000
make frontend   # Vite on :5173
```

After `make install`:

| Service              | URL |
|----------------------|-----|
| OpenTech frontend    | `http://localhost:5173` |
| FastAPI              | `http://localhost:8000` |
| Go auth API          | `http://localhost:8001/api` |
| Keycloak             | `http://localhost:8180` |
| Keycloak Admin UI    | `http://localhost:8180/admin/` |

Register via the OpenTech sign-in form (username, email, password). Grant the `admin` realm role in the Keycloak Admin Console when needed — there is no hardcoded admin account.

## Make targets

| Target          | Description |
|-----------------|-------------|
| `make install`  | **First time only** — installs all deps, generates secrets, starts all services |
| `make start`    | **Day-to-day** — ensures services are up, then starts FastAPI + Vite |
| `make configure`| Regenerate local secrets and synchronize `AUTH_INTERNAL_SECRET` |
| `make auth`     | Start or rebuild the local Keycloak / Go auth stack |
| `make auth-down`| Stop the local auth stack |
| `make auth-logs`| Follow Keycloak and Go auth logs |
| `make backend`  | Start FastAPI on `:8000` |
| `make frontend` | Start Vite dev server on `:5173` |
| `make dev`      | Start both servers in one terminal |
| `make supabase` | Start local Supabase data services |
| `make stop`     | Stop Supabase containers |
| `make reset`    | Wipe local DB and re-run migrations |
| `make lint`     | ESLint on the frontend |
| `make build`    | Production frontend bundle |

## Project structure

```
opentech-db/
  data/                 Technology parameter JSON files (primary database)
  api/                  FastAPI route handlers
  adapters/             Framework export adapters (pypsa, calliope, osemosys, …)
  schemas/              Pydantic v2 models — canonical type definitions
  scraper/              Pluggable pipeline: sources → extractors → normalizer → storage
  frontend/             React 19 SPA (Vite, TypeScript)
    src/
      services/api.ts   Fetch client
      components/       Feature UI (TechGrid, DetailsModal, WorldMapView, …)
      store/            Zustand + React Context state
  keycloak/             Authentication stack (see keycloak/README.md)
    auth-service/       Go authentication service (Gin + Redis)
    realm/              Keycloak realm and user-profile config
    compose.yml         Production Compose file
    compose.local.yml   Local Compose file
  deploy/               Production deploy scripts and Supabase Compose
  db/migrations/        Plain SQL migration files
  docs/                 Project documentation
  tools/                Developer scripts (configure_env.py, patch_supabase_env.py)
```

## Environment variables

Copy `.env.example` to `.env` and run `make configure` to generate matching secrets. Key variables:

| Variable               | Where used | Description |
|------------------------|------------|-------------|
| `SUPABASE_URL`         | FastAPI    | Backend-only Supabase/PostgREST URL |
| `SUPABASE_SERVICE_ROLE_KEY` | FastAPI | Backend-only data credential — never in frontend |
| `AUTH_SERVICE_URL`     | FastAPI    | Server-to-server URL of the Go auth service |
| `AUTH_INTERNAL_SECRET` | FastAPI + Go auth | Shared secret for session validation (≥32 chars) |
| `AUTH_REALM`           | FastAPI    | Always `opentechdb` |
| `GITHUB_TOKEN`         | FastAPI    | PAT with `repo` scope — enables approval-to-PR |
| `VITE_API_BASE_URL`    | Frontend   | Defaults to `http://localhost:8000/api/v1` |

See `keycloak/README.md` for all authentication-stack variables and `docs/deployment.md` for production values.

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/overview.md`](docs/overview.md) | Project goals and OEO alignment |
| [`docs/getting-started.md`](docs/getting-started.md) | Developer setup guide |
| [`docs/authentication.md`](docs/authentication.md) | Authentication architecture and flows |
| [`docs/data-model.md`](docs/data-model.md) | Technology and parameter data model |
| [`docs/data-formats.md`](docs/data-formats.md) | JSON catalogue and legacy format specs |
| [`docs/adapters.md`](docs/adapters.md) | Framework export adapter guide |
| [`docs/api-reference.md`](docs/api-reference.md) | FastAPI endpoint reference |
| [`docs/scrapers.md`](docs/scrapers.md) | Scraper pipeline and source configuration |
| [`docs/deployment.md`](docs/deployment.md) | Production deployment guide |
| [`keycloak/README.md`](keycloak/README.md) | Auth stack operational reference |

## Contributing data

Technology parameters contributed through the web interface go into a scraper candidate queue. An admin approves them, which opens a pull request merging the data into the `data/` JSON files. See [`docs/contributing-data.md`](docs/contributing-data.md).

Every `ParameterValue` must carry provenance fields (`source`, `year`) for OEO alignment.

# Getting Started

## Prerequisites

- Python 3.11+
- Node.js 20+ (frontend only)
- Docker with Compose v2
- Git

---

## Option A — Local (Python + Node.js)

### Backend

```bash
# 1 – Clone the repository
git clone https://mygit.th-deg.de/thd-spatial-ai/opentech-db.git
cd opentech-db

# 2 – Create and activate a virtual environment
python -m venv .venv

# Windows
.venv\Scripts\activate
# Linux / macOS
source .venv/bin/activate

# 3 – Install Python dependencies
pip install -r requirements.txt

# 4 – Start the API server (hot-reload enabled)
uvicorn main:app --reload --port 8000
```

The API is now available at:

| Interface | URL |
|---|---|
| Swagger UI | http://127.0.0.1:8000/docs |
| ReDoc | http://127.0.0.1:8000/redoc |
| OpenAPI JSON | http://127.0.0.1:8000/openapi.json |
| Health check | http://127.0.0.1:8000/health |

### Frontend

In a separate terminal:

```bash
cd frontend
npm install
npm run dev    # Vite dev server → http://localhost:5173
```

### Frontend environment variables

Create `frontend/.env.local`:

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_AUTH_API_BASE_URL=/auth-api
```

---

## Option B — Docker (backend only)

```bash
# Build and start with Compose
docker compose up --build

# Or without Compose
docker build -t opentech-db .
docker run -p 8000:8000 -v ./data:/app/data opentech-db
```

!!! tip
    Mounting `data/` as a volume allows updating JSON files without rebuilding the image.

---

## Authentication and backend environment

Use the repository setup commands to generate independent Keycloak, Go-session,
Redis, PostgreSQL, and backend validation secrets and start both the data and
authentication containers:

```bash
make install
```

`make install` creates the Python environment, installs frontend packages,
starts the Supabase data services, applies pending migrations, generates local
secrets, and starts Keycloak, its PostgreSQL database, Redis, and the Go auth
service. Use `make auth` later when only the authentication stack needs to be
started or rebuilt.

The backend consumes only the opaque Go-managed session:

```env
AUTH_SERVICE_URL=http://localhost:8001
AUTH_REALM=opentechdb
AUTH_INTERNAL_SECRET=<generated-by-make-configure>
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
```

Configure GitHub and ORCID credentials in the Keycloak Admin Console under the
`opentechdb` realm. They are not backend or frontend environment variables.

### Supabase data services

Supabase remains a server-side catalogue/workflow and personal-token database.
Its Auth/GoTrue component is disabled and the browser receives no Supabase key.

```env
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Apply every migration in order after configuring Supabase. For the local CLI
stack, apply migrations that were added after the database was first started:

```bash
supabase migration up --local
```

Production self-hosting uses `bash deploy/supabase/apply-migrations.sh`.
Migration 013 is required for profile-generated API tokens and stores only
token hashes linked to immutable Keycloak subjects; it creates no local user.

### Scraper API keys (optional — enables premium sources)

```env
SCOPUS_API_KEY=<elsevier-api-key>
SCOPUS_INST_TOKEN=<institutional-token>
OPENAI_API_KEY=<openai-key>         # enables LLM parameter extraction
ANTHROPIC_API_KEY=<anthropic-key>   # alternative LLM
```

---

## Verify the installation

```bash
# Check health and version
curl http://localhost:8000/health

# List all generation technologies
curl http://localhost:8000/api/v1/technologies/category/generation

# Get a specific technology
curl http://localhost:8000/api/v1/technologies/ccgt

# Get PyPSA-ready parameters for CCGT (7% discount rate)
curl "http://localhost:8000/api/v1/adapt/pypsa/ccgt?discount_rate=0.07"

# Admin-only reloads are performed from the authenticated admin UI.
```

---

## Contributing data

Energy researchers can contribute new parameter data (technology instances, CAPEX/efficiency figures, etc.) through the contributor UI — no code changes required. See [Contributing Data](contributing-data.md) for the full workflow.

---

## MkDocs documentation (this site)

```bash
# Install docs dependencies
pip install -r docs/requirements.txt

# Serve locally with hot reload
python -m mkdocs serve   # → http://localhost:8000 (uses port 8001 if backend is running)

# Build static site
python -m mkdocs build   # → site/
```

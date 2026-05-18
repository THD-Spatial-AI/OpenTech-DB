# Getting Started

## Prerequisites

- Python 3.11+
- Node.js 20+ (frontend only)
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
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
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

## Backend environment variables

### Authentication (required for protected endpoints)

```env
ORCID_CLIENT_ID=<your-orcid-client-id>
ORCID_CLIENT_SECRET=<your-orcid-client-secret>
ORCID_REDIRECT_URI=http://localhost:8000/api/v1/auth/orcid/callback
JWT_SECRET_KEY=<random-long-secret>
FRONTEND_URL=http://localhost:5173
```

Register your application at <https://orcid.org/developer-tools> to obtain ORCID credentials.

### Admin account (built-in)

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD_HASH=<bcrypt hash>
```

Generate a bcrypt hash with:

```python
import bcrypt
print(bcrypt.hashpw(b"your-password", bcrypt.gensalt()).decode())
```

### Supabase (optional — enables scraper candidate storage and Supabase auth)

```env
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Run the migration once after configuring Supabase:

```bash
# Apply scraper tables migration
psql "$SUPABASE_DB_URL" -f db/migrations/001_scraper_tables.sql
```

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

# Reload data from disk (after editing JSON files)
curl -X POST http://localhost:8000/api/v1/debug/reload
```

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

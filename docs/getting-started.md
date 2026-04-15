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

## Backend environment variables (authentication)

Required only for ORCID login and protected endpoints:

```env
ORCID_CLIENT_ID=<your-orcid-client-id>
ORCID_CLIENT_SECRET=<your-orcid-client-secret>
ORCID_REDIRECT_URI=http://localhost:8000/api/v1/auth/orcid/callback
JWT_SECRET=<random-long-secret>
```

---

## Verify the installation

```bash
# Check health
curl http://localhost:8000/health

# List all technologies
curl http://localhost:8000/api/v1/technologies

# Reload data from disk (useful after editing JSON files)
curl -X POST http://localhost:8000/api/v1/debug/reload
```

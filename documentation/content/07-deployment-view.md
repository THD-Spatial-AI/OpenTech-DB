# Deployment View

## Option A — Local Development (Python / venv)

```
Developer workstation (Windows / Linux / macOS)
+----------------------------------------------+
|  Python 3.11 (.venv)                         |
|                                              |
|  uvicorn main:app --reload --port 8000       |
|     |                                        |
|     | HTTP :8000                             |
|     v                                        |
|  FastAPI / opentech-db process               |
|     |                                        |
|     | reads                                  |
|     v                                        |
|  data/   (local filesystem)                  |
|                                              |
|  Vite dev server --port 5173                 |
|     |  (frontend/)                            |
|     | HTTP :5173                             |
|     v                                        |
|  React 19 SPA (hot-reload)                   |
|     | calls API at localhost:8000             |
+----------------------------------------------+
        |
        | Browser → localhost:5173
        | Browser → localhost:8000/docs (Swagger)
        v
  Developer browser / Postman / notebooks
```

### Steps to start locally

```bash
# Backend
cd opentech-db
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux / macOS
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev        # starts Vite on http://localhost:5173
```

## Option B — Containerised Deployment (Docker)

A `Dockerfile` and `docker-compose.yml` are included in the repository root. The current container serves only the **backend API**. The frontend is built separately and can be served via a static host or a second container.

```
Host machine
+--------------------------------------------------+
|  Docker Engine                                   |
|                                                  |
|  +--------------------------------------------+  |
|  | opentech-db container  (python:3.11-slim)  |  |
|  |   uvicorn main:app --host 0.0.0.0 --port 8000  |
|  |                                            |  |
|  |   /app/data  ← volume mount (./data)       |  |
|  |   /app/documentation ← static /project-docs|  |
|  +--------------------------------------------+  |
|         | port 8000 exposed                    |  |
+--------------------------------------------------+
        |
        | HTTP :8000
        v
  Clients (browser, model scripts, CI pipelines)
```

### Quick start with Docker Compose (recommended)

```bash
# Build image and start the service
docker compose up --build

# Rebuild after dependency changes
docker compose up --build --force-recreate

# Run in detached mode
docker compose up -d
```

### Without Docker Compose

```bash
docker build -t opentech-db .
docker run -p 8000:8000 -v ./data:/app/data opentech-db
```

> Mounting `data/` as a volume allows updating JSON files without rebuilding the image.

### Dockerfile summary

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Infrastructure Requirements

| Component | Minimum | Recommended |
|---|---|---|
| Python | 3.11 | 3.12 |
| Node.js (frontend build) | 18 | 20 LTS |
| RAM | 256 MB (backend) | 1 GB |
| CPU | 1 core | 2 cores |
| Disk | 100 MB | 1 GB (for data expansion) |
| OS | Windows 10 / Ubuntu 20.04 | Any |
| Network | localhost only | HTTP/HTTPS behind a reverse proxy |

## Environment Variables

| Variable | Used by | Description |
|---|---|---|
| `ADMIN_USERNAME` | docker-compose / backend | Admin credentials for protected endpoints |
| `ADMIN_PASSWORD` | docker-compose / backend | Admin credentials |
| `ORCID_CLIENT_ID` | backend (`auth.py`) | ORCID OAuth app client ID |
| `ORCID_CLIENT_SECRET` | backend (`auth.py`) | ORCID OAuth app client secret |
| `ORCID_REDIRECT_URI` | backend (`auth.py`) | OAuth callback URL |
| `JWT_SECRET` | backend (`auth.py`) | Secret for signing JWTs |
| `VITE_SUPABASE_URL` | frontend build | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | frontend build | Supabase anonymous key |
| `VITE_API_BASE_URL` | frontend build | Base URL of the FastAPI backend |

## Notes

- No database, message broker, or external cache is required.
- For public deployment, place uvicorn behind **nginx** or **Caddy** with TLS.
- The `--reload` flag is for development only; remove it in production.
- The Docker image mounts `data/` as a volume so JSON catalogue files can be edited without rebuilding.

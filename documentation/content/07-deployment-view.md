# Deployment View

## Option A — Local Development (Python / conda)

```
Developer workstation (Windows / Linux / macOS)
+----------------------------------------------+
|  Anaconda / venv  Python 3.11                |
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
+----------------------------------------------+
        |
        | HTTP localhost:8000
        v
  Postman / Browser / Python notebooks
  (PyPSA, Calliope model scripts)
```

### Steps to start locally

```bash
conda activate base        # or activate your project venv
cd opentech-db
uvicorn main:app --reload --port 8000
```

## Option B — Containerised Deployment (Docker)

A `Dockerfile` and `docker-compose.yml` are included in the repository root.

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
| RAM | 256 MB | 1 GB |
| CPU | 1 core | 2 cores |
| Disk | 100 MB | 1 GB (for data expansion) |
| OS | Windows 10 / Ubuntu 20.04 | Any |
| Network | localhost only | HTTP/HTTPS behind a reverse proxy |

## Notes

- No database, message broker, or external cache is required.
- For public deployment, place uvicorn behind **nginx** or **Caddy** with TLS.
- The `--reload` flag is for development only; remove it in production.
- The Docker image mounts `data/` as a volume so JSON catalogue files can be edited without rebuilding.

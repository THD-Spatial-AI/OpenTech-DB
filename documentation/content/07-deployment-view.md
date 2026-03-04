# Deployment View

## Current: Local Development

```
Developer workstation (Windows)
+----------------------------------------------+
|  Anaconda / venv  Python 3.11                |
|                                              |
|  uvicorn main:app --reload --port 8000       |
|     |                                        |
|     | HTTP :8000                             |
|     v                                        |
|  FastAPI / techs_database process            |
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
cd techs_database
uvicorn main:app --reload --port 8000
```

## Future: Containerised Deployment

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```bash
docker build -t techs-database .
docker run -p 8000:8000 -v ./data:/app/data techs-database
```

Mounting `data/` as a volume allows updating JSON files without rebuilding the image.

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

# Deployment Guide

Production deployment of OpenTech-DB on a THD VM behind `*.th-deg.de`.

## Architecture

```
Internet ──HTTPS──> Caddy (port 443)
                        │
                        ├── /api/* ──> backend:8000  (FastAPI)
                        ├── /health ──> backend:8000
                        ├── /docs    ──> backend:8000
                        └── /*       ──> frontend:80 (nginx, SPA)

Database: JSON files in Docker named volume `opentech-db-data`
Candidates: Supabase Postgres (external)
```

## Prerequisites

- Docker + Docker Compose (v2) on the VM
- Domain DNS: `otdb.th-deg.de` → VM IP address
- Supabase project (free tier) with:
  - `technology_submissions` table
  - RLS policy enabling service-role only access
- ORCID app credentials (production, not sandbox)
- GitHub PAT with `repo` scope (for admin approval → PR workflow)

## Quick Start

```bash
# 1. Clone on the VM
git clone https://github.com/THD-Spatial-AI/OpenTech-DB.git
cd opentech-db

# 2. Create .env with production secrets
#    See .env.example for all required vars. NEVER commit this file.
cp .env.example .env
# → Edit .env: fill ADMIN_EMAIL, ADMIN_PASSWORD_HASH, JWT_SECRET_KEY, etc.

# 3. Pull images and start
docker compose pull
docker compose up -d

# 4. Verify
curl https://otdb.th-deg.de/health
curl https://otdb.th-deg.de/api/v1/technologies?limit=1
```

## Environment Variables

Set in `.env` (gitignored) or passed to the container:

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET_KEY` | **Yes** | 32-byte random base64; `python -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `ADMIN_EMAIL` | **Yes** | Built-in admin login email |
| `ADMIN_PASSWORD_HASH` | **Yes** | bcrypt hash; `python -c "import bcrypt; print(bcrypt.hashpw(b'<pw>', bcrypt.gensalt(12)).decode())"` |
| `SUPABASE_URL` | No | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Service role key (server-side only) |
| `SUPABASE_JWT_SECRET` | **Yes** if Supabase | JWT secret from Supabase dashboard |
| `CORS_ORIGINS` | **Yes** for production | Comma-separated: `https://otdb.th-deg.de` |
| `ORCID_ENV` | No | `production` (default) or `sandbox` |
| `ORCID_CLIENT_ID` | No | ORCID OAuth client ID |
| `ORCID_CLIENT_SECRET` | No | ORCID OAuth client secret |
| `ORCID_REDIRECT_URI` | No | Must match ORCID app config, e.g. `https://otdb.th-deg.de/api/v1/auth/orcid/callback` |
| `FRONTEND_URL` | No | SPA origin, e.g. `https://otdb.th-deg.de` |
| `VITE_API_BASE_URL` | No (default: `/api/v1`) | Passed as build arg; relative path works behind Caddy |

## Update & Redeploy

```bash
git pull
docker compose build --no-cache frontend
docker compose up -d --build
```

## Backups

The only persistent data is in the Docker named volume:

```bash
# Backup
docker run --rm -v opentech-db_opentech-db-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/opentech-db-data-$(date +%Y%m%d).tar.gz -C /data .

# Restore
docker run --rm -v opentech-db_opentech-db-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/opentech-db-data-*.tar.gz -C /data
```

Add a cron job for daily backups:

```cron
0 3 * * * cd /opt/opentech-db && ./scripts/backup.sh
```

## Monitoring

- **Health check**: Caddy probes the backend at `/health` (configured in docker-compose.yml)
- **Logs**: `docker compose logs -f --tail=100`
- **Uptime**: Add https://uptimerobot.com or https://healthchecks.io for external monitoring

---

## Data Protection (DPM / DSFA)

Information required for the THD Data Protection Management process.

### 1. Controller (Verantwortliche Stelle)
Deggendorf Institute of Technology (THD)
Dieter-Görlitz-Platz 1, 94469 Deggendorf

### 2. Purpose of Processing
- Research data platform for energy technology parameters
- Contributor authentication (researcher identity via ORCID)
- Admin management of submitted data
- Integration with energy modelling frameworks (PyPSA, Calliope, OSeMOSYS)

### 3. Legal Basis
- Art. 6(1)(e) DSGVO — public task (research and education)
- Art. 6(1)(a) DSGVO — consent (ORCID authentication)

### 4. Data Categories Processed

| Data | Source | Storage | Retention |
|------|--------|---------|-----------|
| ORCID iD | ORCID OAuth | JWT in sessionStorage | Session (cleared on tab close) |
| Email address | ORCID / Supabase | Supabase `auth.users` | Until account deletion |
| Name | ORCID | JWT in sessionStorage | Session |
| Submitted tech parameters | User form | Docker volume (`data/`) | Until admin approval or rejection |
| Scraped paper metadata | OpenAlex, Crossref, etc. | Supabase `scraper_candidates` | 90 days after review |

### 5. Recipients
- **Hosting**: VM at TH Deggendorf (internal)
- **Auth**: Supabase (Postgres, Frankfurt region) — DPA in place /// maybe Keycloack?
- **OAuth**: ORCID (external, researcher identity only)
- **No data is sold or transferred to third countries**

### 6. Technical and Organisational Measures (TOM)

| Measure | Implementation |
|---------|---------------|
| Access control | JWT-based auth, bcrypt password hashing |
| Transport encryption | TLS via Caddy / Let's Encrypt |
| Server-side processing | Supabase service role key never leaves the backend |
| No client-side Supabase | Frontend has zero access to Supabase |
| Input validation | Pydantic v2 schemas on all API endpoints |
| Rate limiting | slowapi (5/min admin login, 10/min submissions) |
| Vulnerability scanning | Trivy in CI pipeline, CRITICAL = fail |
| Non-root container | Docker runs as `appuser` |
| Secrets management | All secrets via env vars, never in repo |
| Logging | Request IDs on all responses, structured JSON logs |

### 7. Data Protection Officer
 ---

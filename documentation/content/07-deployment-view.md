# Deployment View

## Local Development

Local development keeps the same security boundaries as production:

```text
Browser :5173
   ├── /api/v1 ──> FastAPI :8000 ──> local Supabase :54321
   └── /auth-api ─> Go auth :8001 ──> Keycloak :8080
                                      ├── PostgreSQL (Keycloak only)
                                      └── Redis (server-side sessions)
```

```bash
make install

# Separate terminals
make backend
make frontend
```

`make install` installs the Python and frontend dependencies, starts the
Supabase data services with Auth disabled, applies pending migrations, and
starts the local Keycloak, PostgreSQL, Redis, and Go service using
`keycloak/compose.local.yml`. The `keycloak/` directory is a pinned submodule of
the standalone `keycloak-auth` repository and is initialized automatically.
`make supabase` and `make auth` remain available for starting either stack
independently.

## Production

The application host runs the static frontend/Nginx and FastAPI. The Supabase
data API is connected to FastAPI on a backend-only Docker network. A shared
remote Keycloak server may host multiple applications, but OpenTech uses its own
`opentechdb` realm, confidential client, and Go/Redis session service.

```text
Internet
   |
   v
OpenTech Nginx (TLS)
   ├── /api/* ─────────> FastAPI ──> Supabase PostgREST/Kong ──> PostgreSQL
   ├── /auth-api/* ─────> remote Go auth ──> Redis
   └── static SPA                         └─> Keycloak/opentechdb
```

Production Supabase is defined in `deploy/supabase/compose.yml`. It contains
PostgreSQL, PostgREST, and Kong only; GoTrue is intentionally absent. Kong
accepts only the backend service-role credential, and Nginx exposes no
Supabase route.

The remote authentication stack is defined in the pinned submodule's
`keycloak/compose.yml`. Its PostgreSQL database contains Keycloak's own identity
model. It is independent of the Supabase data PostgreSQL database.

## Environment Variables

### FastAPI/application host

| Variable | Description |
|---|---|
| `AUTH_SERVICE_URL` | Server-to-server Go auth endpoint |
| `AUTH_INTERNAL_SECRET` | 32+ character secret shared only with the Go service |
| `AUTH_REALM` | Exact realm name, `opentechdb` |
| `FRONTEND_URL` / `CORS_ORIGINS` | Exact trusted application origins |
| `SUPABASE_URL` | Backend-only data API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend-only PostgREST credential |
| `OPENTECHDB_AUTH_UPSTREAM` | Nginx upstream for `/auth-api` |
| `VITE_API_BASE_URL` | Public FastAPI base path or URL |
| `VITE_AUTH_API_BASE_URL` | Same-origin auth path, normally `/auth-api` |

### Keycloak/auth host

| Variable | Description |
|---|---|
| `KEYCLOAK_DB_*` | Keycloak's technical PostgreSQL credentials |
| `KEYCLOAK_ADMIN_*` | Bootstrap administrator credentials |
| `REDIS_PASSWORD` | Go session-store credential |
| `OPENTECHDB_CLIENT_SECRET` | Confidential client secret for this realm/client |
| `AUTH_INTERNAL_SECRET` | Must match FastAPI's value |
| `KEYCLOAK_DOMAIN` | Public Keycloak/auth host |
| `OPENTECHDB_FRONTEND_URL` | Canonical application origin |
| `OPENTECHDB_AUTH_PUBLIC_URL` | Application's same-origin `/auth-api` URL |
| `OPENTECHDB_AUTH_CALLBACK_URL` | Go OIDC callback under `/auth-api` |

There are no frontend Supabase keys, built-in application-admin credentials,
or FastAPI JWT-signing secrets. Admins are realm users carrying the `admin`
role.

## Operational Requirements

- Use TLS on both public hosts.
- Restrict Supabase and `/internal/*` auth traffic to trusted hosts/networks.
- Back up the Keycloak and Supabase PostgreSQL stores separately.
- Treat Redis as the active session store; losing it logs users out but does not
  delete their Keycloak accounts.
- Apply SQL migrations before deploying backend code that depends on new
  columns.

# Deployment Guide

OpenTech DB is deployed as three boundaries:

1. the React/Nginx application and FastAPI backend;
2. a backend-only Supabase data stack (PostgreSQL, PostgREST, and Kong);
3. the shared Keycloak server plus the OpenTech Go auth service and Redis.

Supabase Auth/GoTrue is not deployed. Application accounts, passwords, identity
providers, and roles exist only in the `opentechdb` Keycloak realm. The browser
can reach Supabase only indirectly through FastAPI.

```text
Browser ── HTTPS ──> OpenTech Nginx ──> FastAPI ──> Supabase data API
   │                       │                │          (service role only)
   └── /auth-api ──────────┴────────────> Go auth ──> Keycloak opentechdb realm
                                            │
                                           Redis
```

## Prerequisites

- Docker with Compose v2 on both servers.
- DNS and TLS for the OpenTech application and Keycloak/auth server.
- A private or firewall-restricted route from FastAPI to the Supabase data API.
- A matching 32+ character `AUTH_INTERNAL_SECRET` on the application and auth
  servers.
- A GitHub token only when approval should create pull requests.

## Keycloak/auth server

Each application has its own realm. OpenTech DB uses only `opentechdb`; users in
other realms on the same Keycloak installation are not OpenTech users.

```bash
git submodule update --init --recursive
cp keycloak/.env.example keycloak/.env
# Set unique production secrets, DNS names, frontend URL, and callback URL.
make -C keycloak prod
```

The stack runs Keycloak 26.7, its PostgreSQL database, Redis, the Go auth
service, and Caddy. Configure optional GitHub and ORCID identity providers in
the `opentechdb` realm. Their client secrets do not belong in React or FastAPI.
The `keycloak/` directory is a pinned submodule of the standalone
[`keycloak-auth`](https://github.com/THD-Spatial-AI/keycloak-auth) repository.

## Supabase data server

The production Supabase Compose file intentionally contains no GoTrue service
and exposes Kong only on loopback. It creates technical PostgreSQL/PostgREST
roles, but never an application-user record.

```bash
sudo mkdir -p /opt/opentech-db
sudo cp .env.example /opt/opentech-db/.env
sudo bash deploy/supabase/setup-secrets.sh
docker network create opentech
docker compose \
  --env-file /opt/opentech-db/supabase.env \
  -f deploy/supabase/compose.yml up -d
bash deploy/supabase/apply-migrations.sh
```

`SUPABASE_SERVICE_ROLE_KEY` is a backend-only PostgREST credential. It is not a
login token and must never be placed in a `VITE_*` variable or returned to a
browser. Migration 012 revokes all public-schema access from the Supabase
`anon` and `authenticated` roles. Migration 013 creates the RLS-protected
`api_tokens` table used for hashed personal API tokens; it creates no user row.

## Application server

Set these values in `/opt/opentech-db/.env`:

| Variable | Purpose |
|---|---|
| `AUTH_SERVICE_URL` | Server-to-server URL for the remote Go auth service |
| `AUTH_INTERNAL_SECRET` | Shared secret for FastAPI session validation |
| `AUTH_REALM` | Must be `opentechdb` |
| `OPENTECHDB_AUTH_UPSTREAM` | Nginx upstream for the same-origin `/auth-api` proxy |
| `FRONTEND_URL` | Canonical OpenTech application origin |
| `CORS_ORIGINS` | Exact trusted frontend origins |
| `SUPABASE_URL` | Backend-only Supabase/PostgREST URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend-only data credential |
| `GITHUB_TOKEN` | Optional approval-to-PR integration |

There are no `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, Supabase anon-key, Supabase
JWT-secret, or frontend Supabase variables. Admin access is granted with the
`admin` realm role in Keycloak.

```bash
docker compose -f docker-compose.prod.yml up -d --build
curl https://otdb.th-deg.de/health
curl 'https://otdb.th-deg.de/api/v1/technologies?limit=1'
```

## Security checks

- Do not expose PostgREST/Kong publicly or proxy a `/supabase` route.
- Apply migration 013 before exposing the profile token controls. Token
  generation fails closed with `503` when backend data storage is unavailable.
- Restrict `/internal/*` on the auth server to the application server where
  possible; the shared-secret check remains mandatory.
- Keep Keycloak, Supabase, Redis, and database credentials in uncommitted env
  files with restricted filesystem permissions.
- Terminate TLS at Nginx/Caddy and retain exact-origin checks for cookie-based
  write requests.
- Back up the Supabase PostgreSQL data directory and the Keycloak PostgreSQL
  volume independently. Redis sessions may be treated as ephemeral unless
  session continuity is a recovery requirement.

## Updating

```bash
git pull
git submodule update --init --recursive
docker compose -f docker-compose.prod.yml up -d --build
make -C keycloak prod
bash deploy/supabase/apply-migrations.sh
```

Review and test migrations before production use. Do not delete either
PostgreSQL volume during an update.

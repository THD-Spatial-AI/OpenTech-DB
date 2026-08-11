# OpenTech DB — Authentication Stack

This directory contains the authentication infrastructure for OpenTech DB. It runs as a separate Docker stack, independent from the main application.

## Architecture

```
Browser
  │
  │  same-origin /auth-api (reverse-proxied by the app's Nginx)
  ▼
Go auth-service (port 8001)       — opaque HttpOnly session cookie
  │  Keycloak Admin API           — user create / role assign
  │  Keycloak token endpoint      — ROPC login / OAuth code exchange
  ▼
Keycloak 26.7 (port 8080)         — opentechdb realm
  │
  └── PostgreSQL                  — Keycloak persistent storage
  └── Redis                       — server-side session store (tokens never reach the browser)
  └── Caddy (port 443)            — TLS termination (production only)
```

The Go auth-service is the only component that handles browser requests. It stores Keycloak access/refresh tokens in Redis and issues the browser only an opaque `session_id` HttpOnly cookie. No token ever appears in a URL, `localStorage`, or `sessionStorage`.

FastAPI validates browser sessions by calling the internal `GET /internal/validate-session` endpoint with a shared `AUTH_INTERNAL_SECRET`; it never parses JWTs.

## Directory structure

```
keycloak/
  auth-service/          Go authentication service (Gin + Redis)
    cmd/main.go          Entry point — routing, middleware wiring
    internal/
      config/            Environment-based configuration
      handler/auth/      Login, register, logout, OAuth provider, change-password
      middleware/        CSRF, rate-limiter, account lockout, session validation
      store/             Auth state store interface and Redis implementation
    infrastructure/
      common/            Shared HTTP utilities, cookie helpers, pagination
      platform/          Logger, server, session manager, Keycloak admin-token provider
  realm/
    opentechdb-realm.json       Keycloak realm export (imported on first start)
    opentechdb-user-profile.json  Restricted user profile (username + email only)
  scripts/
    init-keycloak.sh     One-shot container: assigns service-account roles, configures callbacks
  compose.yml            Production stack (Keycloak + Go auth + Postgres + Redis + Caddy)
  compose.local.yml      Local development stack (same minus Caddy, Keycloak on HTTP)
  Caddyfile              TLS reverse proxy config (production)
  .env.example           Template for production secrets
```

## Local development

The root Makefile is the recommended entry point. From the **repo root**:

```bash
make install     # first time: creates .env files, generates secrets, starts all stacks
make auth        # subsequent starts: start or rebuild only the auth stack
make auth-down   # stop the auth stack
make auth-logs   # follow Keycloak and Go auth logs
```

To work on the Go service directly without Docker, from `keycloak/auth-service/`:

```bash
make deps        # go mod tidy && go mod download
make dev         # go run ./cmd/main.go (requires Keycloak + Redis already running)
make build       # compile binary → ./main
make run         # build then run the binary
```

**Prerequisites for local Go dev:** Go 1.24+, a running Keycloak instance, a running Redis instance, and a populated `.env` or `.env.local` in the `auth-service/` directory.

Local service endpoints:

| Service              | URL                          |
|----------------------|------------------------------|
| Go auth API          | `http://localhost:8001/api`  |
| Keycloak             | `http://localhost:8180`      |
| Keycloak Admin UI    | `http://localhost:8180/admin/` |

## Environment variables

Copy `.env.example` to `.env` (production) or use `make configure` at the repo root to generate `.env.local` (local dev). All secrets must be generated independently with `openssl rand -base64 48`.

| Variable                    | Required | Description |
|-----------------------------|----------|-------------|
| `KEYCLOAK_ADMIN_USERNAME`   | yes      | Keycloak bootstrap admin username |
| `KEYCLOAK_ADMIN_PASSWORD`   | yes      | Keycloak bootstrap admin password |
| `KEYCLOAK_DB_USER`          | yes      | PostgreSQL username for Keycloak |
| `KEYCLOAK_DB_PASSWORD`      | yes      | PostgreSQL password for Keycloak |
| `REDIS_PASSWORD`            | yes      | Redis authentication password |
| `OPENTECHDB_CLIENT_SECRET`  | yes      | Confidential client secret for the `opentechdb-auth` Keycloak client |
| `AUTH_INTERNAL_SECRET`      | yes      | Shared secret between FastAPI and Go auth (≥32 chars). Must match the value in the app's `.env`. |
| `KEYCLOAK_DOMAIN`           | prod     | DNS name pointing at this server (e.g. `auth.example.org`) |
| `OPENTECHDB_FRONTEND_URL`   | yes      | Canonical app origin (e.g. `https://opentechdb.example.org`) |
| `OPENTECHDB_AUTH_PUBLIC_URL`| yes      | Public URL of the Go auth service, as seen by the browser (e.g. `https://opentechdb.example.org/auth-api`) |
| `OPENTECHDB_AUTH_CALLBACK_URL` | yes   | OAuth callback handled by the Go service (e.g. `https://opentechdb.example.org/auth-api/auth/callback`) |

The Go auth-service also reads (all resolved inside `compose.yml` / `compose.local.yml`):

| Variable              | Description |
|-----------------------|-------------|
| `KEYCLOAK_URL`        | Internal Keycloak URL (service-to-service, e.g. `http://keycloak:8080`) |
| `KEYCLOAK_PUBLIC_URL` | Browser-facing Keycloak URL (used for OAuth redirects) |
| `KEYCLOAK_REALM`      | Always `opentechdb` |
| `KEYCLOAK_CLIENT_ID`  | Always `opentechdb-auth` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DATABASE` | Redis connection |
| `SESSION_TTL_MINUTES` | Session idle timeout (default 60) |
| `COOKIE_DOMAIN`       | Cookie scope (empty = request host) |
| `APP_URL`             | Public URL of the Go service itself |
| `FRONTEND_URL`        | Redirect destination after OAuth callback |
| `APP_ENV`             | `production` enables Secure+SameSite=Strict cookies |

## API endpoints

All browser-facing routes are under `/api`; the internal route is under `/internal`.

| Method | Path                        | Auth          | Description |
|--------|-----------------------------|---------------|-------------|
| GET    | `/api/health`               | none          | Liveness check |
| GET    | `/api/csrf-token`           | none          | Issue CSRF cookie + token |
| POST   | `/api/login`                | none          | Username/password login |
| POST   | `/api/register`             | none          | New user registration |
| POST   | `/api/logout`               | session cookie | Revoke Keycloak session, clear cookies |
| GET    | `/api/auth/provider/:provider` | none       | Begin GitHub or ORCID OAuth flow |
| GET    | `/api/auth/callback`        | none          | OAuth authorization-code callback |
| GET    | `/api/auth/me`              | session cookie | Return current user claims |
| POST   | `/api/auth/refresh-token`   | session cookie | Force Keycloak token refresh |
| POST   | `/api/auth/change-password` | session cookie | Change password via Keycloak Admin API |
| GET    | `/api/auth/keep-alive`      | session cookie | Extend session / refresh near-expiry tokens |
| GET    | `/api/auth/account`         | session cookie | Redirect to Keycloak account console |
| GET    | `/internal/validate-session`| `X-Internal-Auth` header | FastAPI session validation |

All state-mutating routes require a valid `X-CSRF-Token` header matching the `csrf_token` cookie.

## Realm and roles

The `opentechdb` realm is imported from `realm/opentechdb-realm.json` on first start. Key settings:

- **Password policy:** 8+ chars, upper, lower, digit, special character.
- **Brute-force protection:** enabled; 5 failures → 15-minute lockout (also enforced in the Go layer).
- **Access token lifespan:** 300 seconds; the Go service refreshes automatically.
- **Roles:**
  - `contributor` — submit and update OpenTech DB data (assigned to all new users by default).
  - `admin` — review submissions, administer catalogue; composite of `contributor`.
- There is no hardcoded admin user. Grant the `admin` role via the Keycloak Admin Console.

## Production deployment

```bash
cp .env.example .env
# Fill in real values for all variables
docker compose --env-file .env -f compose.yml up -d --build
```

The stack starts Keycloak, its PostgreSQL, Redis, the Go auth-service, and Caddy. Caddy handles TLS automatically via ACME. The `keycloak-init` one-shot container assigns service-account permissions and configures redirect URIs on every startup.

On the **application server** (where FastAPI runs), set in `/opt/opentech-db/.env`:

```
AUTH_SERVICE_URL=https://<keycloak-host>
AUTH_INTERNAL_SECRET=<same 32+ char secret as AUTH_INTERNAL_SECRET in keycloak/.env>
AUTH_REALM=opentechdb
OPENTECHDB_AUTH_UPSTREAM=https://<keycloak-host>
```

The application Nginx must reverse-proxy `/auth-api` to `AUTH_SERVICE_URL` so browser auth cookies stay same-origin with the OpenTech DB application.

For stronger isolation, restrict `/internal/*` on the Keycloak server to the application server's IP in addition to the shared-secret check.

## Identity providers (GitHub, ORCID)

Configure GitHub and ORCID as Identity Providers inside the `opentechdb` realm with aliases exactly `github` and `orcid`. Their provider-side callback must point to the Keycloak broker endpoint:

```
https://<keycloak-host>/realms/opentechdb/broker/<alias>/endpoint
```

The OpenTech client's redirect URI is:

```
https://<opentech-app>/auth-api/auth/callback
```

Provider client secrets are stored only in the Keycloak realm; they never appear in React or FastAPI.

## Container names

Both compose files use the project name `spatialai-keycloak` and stable container names:

| Container                           | Role |
|-------------------------------------|------|
| `spatialai-keycloak-postgres`       | Keycloak database |
| `spatialai-keycloak-redis`          | Session store |
| `spatialai-keycloak`                | Keycloak identity server |
| `spatialai-keycloak-init`           | One-shot realm configurator |
| `spatialai-keycloak-auth-service`   | Go authentication service |
| `spatialai-keycloak-caddy`          | TLS reverse proxy (production only) |

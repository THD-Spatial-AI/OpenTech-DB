# Authentication

OpenTech DB uses its own `opentechdb` realm in a shared Keycloak installation.
Supabase stores catalogue/workflow data and hashed personal-token metadata
only. GoTrue is disabled, there is no Supabase user table used by the
application, and no Supabase credential or route is shipped to the browser.
Rows store the immutable Keycloak subject as plain attribution data without a
foreign key to a database user.

The React application does not use `keycloak-js`. It keeps the existing
OpenTech sign-in page and calls a standalone Go authentication service copied
and adapted from Storcito-Wildfire. The service talks to the Keycloak container,
stores Keycloak tokens server-side in Redis, and gives the browser only an
opaque `session_id` HttpOnly cookie.

```text
Browser -- same-origin /auth-api --> Go auth service --> opentechdb realm
   |                                  |                    |
   | opaque HttpOnly session cookie   | tokens in Redis    | users + roles
   +------------ FastAPI ------------+                    |
                  internal validation --------------------+
```

## Realm isolation for multiple applications

One remote Keycloak server can host several isolated realms, for example:

- `opentechdb`
- `enerplanet`
- `storcito`

Users, passwords, sessions, clients, roles, and identity-provider configuration
are separate per realm. A user in `enerplanet` is not automatically a user in
`opentechdb`. Each application must also use its own confidential client secret
and its own Go session service/configuration. FastAPI rejects any identity whose
realm is not exactly `opentechdb`.

The authentication stack is pinned from the standalone
[`keycloak-auth`](https://github.com/THD-Spatial-AI/keycloak-auth) repository as
the `keycloak/` Git submodule. Local development uses
`keycloak/compose.local.yml`, with a local Keycloak and local Postgres/Redis.
Production can point the application at a shared remote Keycloak deployment
using `keycloak/compose.yml`.

## Browser flows

### Username/email and password

The existing form submits to the Go service:

1. `GET /auth-api/csrf-token` creates a CSRF cookie/token pair.
2. `POST /auth-api/login` accepts `username` (either username or email) and
   `password`.
3. Go authenticates against the `opentechdb` realm.
4. Keycloak access/refresh tokens are stored in Redis.
5. The browser receives only `session_id` (HttpOnly) and `csrf_token` cookies.

Registration uses `username`, `email`, `password`, and password confirmation.
The realm user profile contains only username and email; full name and copied
Storcito organization/profile fields are not part of this realm.

### GitHub and ORCID

The unchanged provider buttons start a Keycloak-brokered authorization-code
flow through the Go service. State and a PKCE verifier are single-use values
stored in Redis for five minutes; an HttpOnly state cookie binds the callback
to the browser that initiated the flow. Provider client secrets belong in the
`opentechdb` realm's Identity Providers configuration, never in React.

Create identity providers with aliases exactly `github` and `orcid`. Configure
their provider-side callback to Keycloak's broker endpoint:

```text
https://<keycloak-host>/realms/opentechdb/broker/<alias>/endpoint
```

The OpenTech confidential client's callback is instead:

```text
https://<opentech-app>/auth-api/auth/callback
```

## Roles

The realm defines only application roles needed by OpenTech DB:

- `contributor` — submit technology and time-series data.
- `admin` — review submissions and administer catalogue/scraper data; includes
  `contributor` as a composite role.

New realm users receive `contributor`. Grant `admin` in the Keycloak Admin
Console; there is no hardcoded admin password and no Supabase role promotion.

## Protected API boundary

FastAPI does not parse browser JWTs. For a request containing `session_id`, it
calls the Go-only endpoint `GET /internal/validate-session` with the shared
`AUTH_INTERNAL_SECRET`. The Go service refreshes near-expiry Keycloak tokens and
returns a filtered identity containing only subject, username, email, realm, and
the `contributor`/`admin` roles.

Security controls include:

- opaque HttpOnly, Secure-in-production, SameSite cookies;
- CSRF double-submit tokens for Go auth POSTs;
- exact Origin checks for cookie-authenticated FastAPI writes;
- login rate limiting and account lockout;
- browser-bound, one-time Redis OAuth state and PKCE;
- bounded per-IP authentication rate-limiter state and Keycloak session
  revocation on logout;
- exact realm checking and filtered roles;
- no access/refresh token in React, browser storage, or URLs;
- a separate internal secret for FastAPI-to-Go validation.

## Personal API tokens

Every signed-in realm user can manage personal API tokens on the OpenTech
profile page. These are OpenTech API credentials, not Keycloak access tokens:
FastAPI generates and consumes them, while Keycloak continues to own the user
identity. The data table stores the immutable Keycloak subject as attribution;
it does not create an application or PostgreSQL user.

The implementation follows the Storcito-Wildfire design:

- tokens contain 32 cryptographically random bytes and use the `otdb_` prefix;
- only the SHA-256 digest and a short display prefix are stored;
- the complete secret is returned once, immediately after generation;
- tokens default to 90 days, may be configured for 30/365 days or no expiry,
  and can be revoked from the profile;
- each user may have at most 10 active tokens;
- `read` scope permits only `GET` and `HEAD`; `full` permits writes allowed by
  the token's non-admin role;
- a personal token can never carry `admin`, including when created by an
  administrator, and cannot generate or revoke other tokens;
- cookie and bearer credentials cannot be combined on one request.

Token metadata and hashes live in the backend-only Supabase `api_tokens` table
created by migration 013. RLS has no browser policy and `anon`/`authenticated`
have no privileges. The service-role key remains in FastAPI only. Apply the
migration before enabling the profile feature.

Use a token only over HTTPS and pass it in the header, never in a URL:

```bash
curl \
  -H 'Authorization: Bearer otdb_<complete-secret>' \
  'https://otdb.th-deg.de/api/v1/submissions/mine'
```

The contributor role stored with a token is a creation-time snapshot, matching
Wildfire's personal-token model. Revoke a user's active tokens when removing
their contributor access; the default expiry limits the lifetime of stale
snapshots. Admin access is always excluded regardless of that snapshot.

## Local setup

```bash
make install
make backend
make frontend
```

`make install` starts both the Supabase data services and the complete local
Keycloak/Go-auth/PostgreSQL/Redis stack. Use `make auth` later to start or
rebuild only the authentication stack. Both commands fetch the auth submodule
at the exact revision pinned by OpenTech DB. For a manual checkout, use:

```bash
git submodule update --init --recursive
```

Local endpoints:

| Service | URL |
|---|---|
| OpenTech frontend | `http://localhost:5173` |
| FastAPI | `http://localhost:8000` |
| Go auth API | `http://localhost:8001/api` |
| Keycloak | `http://localhost:8080` |
| Keycloak Admin Console | `http://localhost:8080/admin/` |

`make configure` creates `keycloak/.env.local`, generates independent secrets,
and synchronizes only `AUTH_INTERNAL_SECRET` with the backend `.env`.
Both Compose variants use the application-neutral project name
`spatialai-keycloak` and stable container names:

- `spatialai-keycloak-postgres`
- `spatialai-keycloak-redis`
- `spatialai-keycloak`
- `spatialai-keycloak-init`
- `spatialai-keycloak-auth-service`
- `spatialai-keycloak-caddy` (remote stack only)

The infrastructure names are shared; `opentechdb` remains only the isolated
realm/client name used by this application.

There are two different kinds of credentials:

- **Keycloak Admin Console:** local username is `admin`; the random password is
  stored as `KEYCLOAK_ADMIN_PASSWORD` in the gitignored
  `keycloak/.env.local`. Production reads both values from `keycloak/.env`.
- **OpenTech application login:** no default user/password is seeded. Register
  with the existing OpenTech form (username, email, and your chosen password),
  or create a user inside the `opentechdb` realm. The login field accepts that
  username or email. Grant the `admin` realm role only when needed.

Do not use `admin/admin` or commit either environment file.

## Remote deployment

On the Keycloak/auth server, use the standalone repository (or this
application's initialized `keycloak/` submodule), copy `.env.example` to `.env`,
and set the production host/callback values before running. From the OpenTech DB
root:

```bash
cp keycloak/.env.example keycloak/.env
$EDITOR keycloak/.env
make -C keycloak prod
```

On the application server:

- set `OPENTECHDB_AUTH_UPSTREAM=https://<keycloak-host>` for Nginx;
- set `AUTH_SERVICE_URL=https://<keycloak-host>` for FastAPI;
- use the same 32+ character `AUTH_INTERNAL_SECRET` on both servers;
- keep `AUTH_REALM=opentechdb`;
- expose browser auth through the app's `/auth-api` reverse proxy so the opaque
  cookie stays same-origin with OpenTech DB.

For stronger production isolation, allow `/internal/*` only from the application
server or a private network in addition to the shared-secret check.

The standalone repository's README documents how another application connects
through its own realm/client and why it must not reuse the OpenTech-specific Go
session service unchanged. See also the official Keycloak documentation for
[container deployment](https://www.keycloak.org/server/containers), [realm import](https://www.keycloak.org/server/importExport), and [production configuration](https://www.keycloak.org/server/configuration-production).

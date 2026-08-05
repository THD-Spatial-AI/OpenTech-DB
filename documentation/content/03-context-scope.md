# Context & Scope

## Business Context

OpenTech DB sits between researchers who curate energy-technology data and
modelling clients that consume it. The public catalogue is readable without an
account. Contributor and administrative operations require a session from the
isolated Keycloak `opentechdb` realm.

```text
Data curators ──> React/FastAPI ──> Supabase data service
                        │               (catalogue + workflow)
                        ├──> PyPSA / Calliope / OSeMOSYS / ADOPTNet0 clients
                        └──> Go auth service ──> Keycloak opentechdb realm
                                                   ├── username/email
                                                   ├── GitHub broker
                                                   └── ORCID broker
```

| Partner system | Direction | Interface | Description |
|---|---|---|---|
| Data curator | → OpenTech DB | Web submission or reviewed JSON seed change | Creates Technologies, Instances, and Profiles. |
| React SPA | ↔ FastAPI | JSON HTTP under `/api/v1` | Browses data and performs protected workflow operations. |
| Go auth service | ↔ browser/FastAPI | Same-origin `/auth-api`; protected `/internal/validate-session` | Owns opaque browser sessions and server-side Keycloak tokens. |
| Keycloak | ↔ Go auth service | OpenID Connect | Owns accounts, credentials, identity-provider links, and the `contributor`/`admin` roles. |
| Supabase | ↔ FastAPI | Backend-only PostgREST service-role access | Stores catalogue, time-series, scraper, workflow data, and hashed personal API-token metadata. It is not an identity provider. |
| PyPSA/Calliope clients | ← FastAPI | Framework adapter endpoints | Receive model-ready parameter dictionaries. |
| OSeMOSYS/ADOPTNet0 clients | ← FastAPI | REST adapter endpoints | Receive framework-specific exports. |
| Open Energy Platform | ↔ links | `oeo_uri` | Resolves ontology concepts referenced by catalogue records. |

## Integration Protocols

Public modelling clients need only HTTP and JSON. Browser authentication is
cookie-based; React never receives a Keycloak or Supabase token. Users may
create an `otdb_` personal bearer token from their profile for non-browser API
clients; FastAPI stores only its hash.

| Use case | Method | Path | Access |
|---|---|---|---|
| List technologies | `GET` | `/api/v1/technologies` | Public |
| Retrieve a Technology | `GET` | `/api/v1/technologies/{id}` | Public |
| Retrieve an Instance | `GET` | `/api/v1/technologies/{id}/instances/{iid}` | Public |
| PyPSA export | `GET` | `/api/v1/adapt/pypsa/{id}` | Public |
| Calliope export | `GET` | `/api/v1/technologies/{id}/calliope` | Public |
| Browse Profiles | `GET` | `/api/v1/timeseries` | Public |
| Submit a Technology | `POST` | `/api/v1/technologies` | Contributor/admin |
| Upload a Profile | `POST` | `/api/v1/timeseries/upload` | Contributor/admin |
| Review submissions | `GET/PATCH` | `/api/v1/admin/...` | Admin |
| Reload catalogue cache | `POST` | `/api/v1/debug/reload` | Admin |

## Typical Flows

### Modelling client

1. The client requests a Technology or framework-specific adapter endpoint.
2. FastAPI loads the active catalogue from Supabase, or JSON when Supabase is
   not configured, and validates it with Pydantic.
3. The client receives a plain JSON response with no authentication dependency.

### Contributor

1. The user signs in on `AuthPage` with username/email and password, or starts
   a Keycloak-brokered GitHub/ORCID login.
2. The Go service stores Keycloak tokens in Redis and sets an opaque HttpOnly
   session cookie.
3. React submits through FastAPI with credentials enabled.
4. FastAPI validates the session with the Go service, then stores the immutable
   Keycloak subject and optional email as workflow attribution.
5. Supabase contains the submission record but no application-user row.

### Administrator

1. Keycloak grants the user the `admin` realm role.
2. FastAPI obtains only filtered OpenTech roles from the Go validation endpoint.
3. The administrator reviews and approves/rejects submissions; Supabase is
   accessed solely through FastAPI's service-role client.

## Technical Context

```text
┌──────────────────── application host ────────────────────┐
│ React SPA ── /api/v1 ──> FastAPI ── service role ─────┐ │
│     │                        │                         │ │
│     └── /auth-api ──────────┼──────────────────────┐  │ │
└──────────────────────────────┼──────────────────────┼──┘ │
                               │                      │    │
                      Supabase PostgreSQL/       Go auth service
                      PostgREST (data only)           │
                                                  Redis + Keycloak
                                                  realm: opentechdb
```

The Keycloak/auth stack may run on another server or share a Keycloak instance
with other applications. Realm and client isolation keep OpenTech identities
separate. Local development uses its own Keycloak/PostgreSQL/Redis Compose
stack with the same realm name and contract.

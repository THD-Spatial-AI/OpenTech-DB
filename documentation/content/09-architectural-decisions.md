# Architectural Decisions

## ADR-001: FastAPI over Flask/Django

**Status:** Accepted

**Context:** The system needs a Python web framework with automatic API documentation and
runtime data validation.

**Decision:** Use FastAPI.

**Rationale:** FastAPI provides native Pydantic integration (eliminating a separate
serialisation layer), async capability, and auto-generated Swagger / ReDoc docs at zero
extra cost. Flask would require manual OpenAPI wiring; Django is over-engineered for a
data-serving API.

**Consequences:** Requires Python 3.10+. Learning curve for async patterns (not yet used
but available).

---

## ADR-002: No relational database

**Status:** Accepted

**Context:** Data is curated (low write frequency), needs to be version-controlled, and
should be portable without infrastructure.

**Decision:** Store all data as JSON files in the `data/` directory tree.

**Rationale:** JSON files in Git provide full history, diff-ability, and portability. A
researcher can contribute new technologies by opening a text editor. A database would add
operational complexity with no benefit at the current project scale.

**Consequences:** No concurrent write support. Filtering and search is O(n) in memory over
the loaded dataset. Acceptable for a catalogue of hundreds of technologies.

---

## ADR-003: Dual-format JSON loading

**Status:** Accepted

**Context:** The initial files used nested ParameterValue objects. Larger catalogue files
use flat numeric fields for ergonomics and compactness.

**Decision:** Implement a single loader that auto-detects format and normalises both into
the same Pydantic models.

**Rationale:** Migrating all legacy files would break existing workflows and git history
traceability. The detection logic is simple and well-contained in `routes.py`.

**Consequences:** Two code paths to maintain. Both are visible via `/api/v1/debug/data`.

---

## ADR-004: UUID (not UUID4) for technology IDs

**Status:** Accepted (relaxed from initial UUID4 constraint)

**Context:** Technology IDs must be globally unique and stable.

**Decision:** Accept any valid UUID. IDs in catalogue files are derived deterministically
via `uuid.uuid5(namespace, technology_id_string)`.

**Rationale:** Requiring UUID v4 (random) broke hand-crafted readable IDs in legacy files.
UUID v5 (name-based) allows deterministic, reproducible IDs from the technology string key.

**Consequences:** IDs are stable across reloads for catalogue-format entries. Legacy
individual files have fixed UUIDs stored in the JSON.

---

## ADR-005: Adapter pattern for framework output

**Status:** Accepted

**Context:** Every target modelling framework (PyPSA, Calliope, OSeMOSYS, ADOPTNet0)
expects different parameter names, unit conventions, and component types.

**Decision:** Implement one adapter module per framework in `adapters/`.

**Rationale:** Separating translation logic from the data schema keeps both independently
maintainable. Adding a new framework means adding a new file with no changes to core
modules.

**Consequences:** Translation logic must be kept in sync when framework APIs change.

---

## ADR-006: Docker containerisation

**Status:** Accepted

**Context:** The system must be runnable on different developer machines and potentially
deployed on shared research infrastructure without requiring a local Python environment
to be set up manually.

**Decision:** Provide a `Dockerfile` (single-stage, `python:3.11-slim` base) and a
`docker-compose.yml` that mounts the `data/` directory as a volume.

**Rationale:** Container packaging eliminates environment discrepancies between developer
machines and CI/deployment targets. Mounting `data/` as a volume decouples the catalogue
JSON files from the image, so curators can update data without rebuilding the image.
Docker Compose gives a one-command start (`docker compose up --build`) that mirrors the
local development workflow.

**Consequences:** Docker must be installed on the target machine. The image does not
bundle the data directory, so the volume mount must be configured correctly in production.
`--reload` mode is disabled in the container `CMD` (production-safe default).

---

## ADR-007: React 19 + Vite as the frontend stack

**Status:** Accepted

**Context:** A web interface is needed so non-developer researchers can browse and
visualise the technology catalogue without writing Python or using curl.

**Decision:** Build a React 19 SPA with TypeScript, bundled by Vite 8, styled with
TailwindCSS, and served independently from the API.

**Rationale:** React 19's `use()` hook and `<Suspense>` eliminate the `useEffect +
useState` boilerplate traditionally needed for async data fetching — which is the primary
activity of this UI. Vite provides sub-second hot-module replacement for fast iteration.
TailwindCSS avoids a custom CSS codebase. The SPA runs entirely in the browser with no
server-side rendering required.

**Consequences:** Requires Node.js for development and builds. The frontend and backend
run on separate ports in development (CORS must be configured). In production it can be
served as static files from any web server.

---

## ADR-008: Supabase + ORCID for authentication

**Status:** Accepted

**Context:** Contributor and admin workflows require user identity. Researchers prefer
ORCID iD as their professional identity. Simple email + password must also be supported.

**Decision:** Use ORCID OAuth (handled in `api/auth.py`) for researcher sign-in and
Supabase JS SDK for session management, email/password auth, and admin role storage.

**Rationale:** ORCID is the standard researcher identifier in academia, reducing
friction for contributor sign-up. Supabase provides a managed auth backend with email,
GitHub OAuth, and role metadata without operating a custom identity service.

**Consequences:** ORCID client credentials and Supabase project keys must be configured
as environment variables. JWTs are stored in `sessionStorage` (cleared on browser close).
If Supabase is unavailable, ORCID-based login still works independently.

---

## ADR-009: Zustand for frontend state management

**Status:** Accepted

**Context:** The frontend needs shared state for selected category, search query, modal
visibility, and auth session.

**Decision:** Use Zustand 5 instead of Redux, MobX, or React Context alone.

**Rationale:** Zustand's API is minimal (one `create()` call per store) and requires
no reducers, actions, or boilerplate. It integrates naturally with React 19 hooks. For
the scale of state involved (a handful of UI flags), Redux would be over-engineered.

**Consequences:** State is not persisted across hard reloads (except auth JWT in
`sessionStorage`). No dev tools integration out of the box (though Zustand supports
Redux DevTools).

---

## ADR-010: Separate time-series catalogue as a first-class resource

**Status:** Accepted

**Context:** VRE technologies (wind, solar) require hourly capacity factor profiles.
Initially, profile references were stored as scalar fields inside technology records.

**Decision:** Extract time-series profiles into a dedicated endpoint family
(`/api/v1/timeseries`) backed by `data/timeseries/timeseries_catalogue.json` and
individual data files. VRE technology records reference profiles by `profile_key`.

**Rationale:** Time-series data (up to 8760 values per profile) is too large to embed in
technology catalogue responses. Decoupling allows the profile catalogue to be queried,
filtered, and paginated independently. It also enables the contributor submission workflow
where new profiles are reviewed before publication.

**Consequences:** A two-request pattern is needed to get a VRE technology's full data
(technology record + profile). The profile catalogue must be kept in sync with technology
`profile_key` references.

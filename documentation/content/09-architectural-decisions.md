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

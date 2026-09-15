# Managed job queue for the Process simulation engine

**Status:** Accepted — 2026-09-15

## Context

The Process simulation service (`services/processsim`, ADR-0004 Phase 3/5) runs
on the **same server** as opentech-db and shares its memory. Steady-state runs
are milliseconds of pure Python, but an **OpenModelica** run compiles C and
solves ODEs — ~60–90 s and memory-heavy. The current `/api/process/simulate` is
**synchronous and unbounded**: N concurrent requests would launch N compilers
and exhaust the machine's commit limit (already observed). There is no ordering,
no per-user fairness, no timeout, and no way to see or cancel work.

## Decision

Add a **managed, prioritized job queue** in front of the OpenModelica engine.

- **Two tiers by cost.** Steady-state stays **synchronous/inline** (`/simulate`).
  OpenModelica goes through an **async job API**: enqueue → `job_id` → poll
  status/result (`/api/process/jobs`, `/api/process/jobs/{id}`).
- **One serialized worker** with a **warm OMC session** (compile-per-model, but
  no per-request session startup / MSL reload). In-memory queue.
- **Priority = role tier**, FIFO within a tier: `admin(0) → contributor(1) →
  anonymous(2)`, ordered by `(tier, enqueue_seq)`.
- **Per-user quota:** at most one active (queued or running) job per user;
  further submissions are rejected with `409` until it finishes.
- **Per-job timeout** (`PROCESS_JOB_TIMEOUT_S`, default 180): a watchdog kills
  the omc/compiler process tree and marks the job `timeout`; the worker rebuilds
  its session for the next job.
- **Memory guard:** before dispatching, require a minimum free-commit headroom
  (`PROCESS_MIN_FREE_MB`); otherwise the job waits in `queued`. Motivated by the
  observed commit-limit failure.
- **Identity via the opentech-db gateway.** processsim is **internal-only**: it
  accepts jobs only with a shared `PROCESS_SIM_SECRET` and trusts the
  `X-User-Id` / `X-User-Tier` headers the backend sets. The browser calls the
  **authenticated** backend (`POST /api/v1/processes/simulate`), which validates
  the session, derives the tier from the realm role, and forwards. One auth
  boundary; the sim service is never exposed to the browser.
- **Management:** `GET /api/process/jobs` (list) and `DELETE /api/process/jobs/{id}`
  (cancel), surfaced to admins through the backend.

## Consequences

- The queue is **engine-agnostic** — its ordering/quota/timeout logic is tested
  with the fast steady-state executor; OpenModelica simply plugs in as the
  executor. So concurrency behaviour is verifiable without heavy runs.
- In-memory queue means **jobs are lost on restart** — acceptable for a single
  shared instance; a durable queue (Redis) is a later step if the service is
  scaled out.
- The single warm worker **serialises** OpenModelica runs — throughput is one at
  a time by design (memory safety on a shared box). `PROCESS_WORKERS` can raise
  it where the host allows.
- A new internal contract (`PROCESS_SIM_URL`, `PROCESS_SIM_SECRET`) couples the
  backend to the sim service; both are env-configured and default to localhost.

**Consequence:** OpenModelica simulation becomes an authenticated, ordered,
bounded, cancellable background job — never an unbounded synchronous request that
can exhaust the shared server.

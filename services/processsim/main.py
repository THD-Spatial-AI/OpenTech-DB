"""
Process Simulation Service (ADR-0004, Phase 3)
==============================================
Simulates a user-built Process graph. Phase 3 ships the steady-state flowsheet
solver (pure Python, runs anywhere); the OpenModelica Component library and
dynamic Flowsheet compiler slot in behind the same API in a later phase.

Endpoints
---------
GET  /api/health              → engine status
POST /api/process/simulate    → body: { units, streams } → { units, streams, kpi, engine }
"""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from solver import GraphError, simulate
from catalogue import resolve_tech_params
from economics import compute_economics
from jobqueue import JobQueue, QuotaError
import modelica_compiler

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("processsim")

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8770"))

# Engine selection (ADR-0004, Phase 5):
#   PROCESS_ENGINE = steady_state (default, pure-Python, runs anywhere)
#                  | openmodelica (compile+simulate the OTDBComponents flowsheet)
# The OpenModelica path needs OMPython + a working C toolchain; if a run fails
# (e.g. the compiler is blocked), the request transparently falls back to
# steady-state so the API never hard-fails.
_ENGINE_PREF = os.getenv("PROCESS_ENGINE", "steady_state").strip().lower()

try:
    from OMPython import OMCSessionZMQ  # noqa: F401
    _OPENMODELICA_AVAILABLE = True
except Exception:  # noqa: BLE001
    _OPENMODELICA_AVAILABLE = False

_MODELICA_ENABLED = _ENGINE_PREF == "openmodelica" and _OPENMODELICA_AVAILABLE

app = FastAPI(title="Process Simulation Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


class Endpoint(BaseModel):
    unit_id: str
    port_id: str


class StreamIn(BaseModel):
    id: str
    source: Endpoint
    target: Endpoint
    carrier: str
    model_config = {"extra": "allow"}


class UnitIn(BaseModel):
    id: str
    equipment_type: str
    operating_conditions: dict[str, Any] = Field(default_factory=dict)
    ports: list[dict[str, Any]] = Field(default_factory=list)
    model_config = {"extra": "allow"}


class ProcessGraph(BaseModel):
    units: list[UnitIn] = Field(default_factory=list)
    streams: list[StreamIn] = Field(default_factory=list)
    model_config = {"extra": "allow"}


# ── Managed job queue (ADR-0005) ─────────────────────────────────────────────
# One serialized worker runs the configured engine. Steady-state also stays
# available inline via /simulate for instant previews.
_SIM_SECRET = os.getenv("PROCESS_SIM_SECRET", "")
_JOB_TIMEOUT_S = float(os.getenv("PROCESS_JOB_TIMEOUT_S", "180"))
_MIN_FREE_MB = float(os.getenv("PROCESS_MIN_FREE_MB", "1000"))
_TIER_NAME = {0: "admin", 1: "contributor", 2: "anonymous"}


def _free_mb() -> float:
    try:
        import psutil
        return psutil.virtual_memory().available / (1024 * 1024)
    except Exception:  # noqa: BLE001
        return float("inf")


def _with_economics(result: dict, graph: dict) -> dict:
    result["economics"] = compute_economics(graph, result.get("units", {}), resolve_tech_params)
    return result


if _MODELICA_ENABLED:
    _engine = modelica_compiler.ModelicaEngine()
    _run_fn = lambda g: _with_economics(_engine.simulate(g, resolve_tech_params), g)  # noqa: E731
    _kill_fn = _engine.kill
else:
    _run_fn = lambda g: _with_economics(simulate(g), g)            # noqa: E731 — steady-state
    _kill_fn = None

JOBS = JobQueue(_run_fn, _kill_fn, timeout_s=_JOB_TIMEOUT_S,
                min_free_mb=_MIN_FREE_MB, free_mb_fn=_free_mb)


def _internal_identity(request: Request) -> dict:
    """Trust the opentech-db gateway: require the shared secret (when configured)
    and read the identity/tier it forwards. Anonymous fallback for local dev."""
    if _SIM_SECRET and request.headers.get("X-Internal-Secret") != _SIM_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden (internal service).")
    tier = request.headers.get("X-User-Tier")
    try:
        tier_i = int(tier) if tier is not None else 2
    except ValueError:
        tier_i = 2
    user_id = request.headers.get("X-User-Id") or (request.client.host if request.client else "anon")
    return {"user_id": user_id, "tier": max(0, min(2, tier_i))}


@app.get("/api/health")
async def health():
    return {
        "engine_ready": True,
        "engine": "openmodelica" if _MODELICA_ENABLED else "steady_state",
        "openmodelica_available": _OPENMODELICA_AVAILABLE,
        "engine_error": None,
        "queue": JOBS.stats(),
    }


# ── Async job API (queued, prioritized) ──────────────────────────────────────

@app.post("/api/process/jobs")
async def enqueue_job(graph: ProcessGraph, request: Request):
    ident = _internal_identity(request)
    try:
        job, pos = JOBS.enqueue(ident["user_id"], ident["tier"], graph.model_dump())
    except QuotaError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    log.info("Enqueued job %s (user=%s tier=%s pos=%s)",
             job.id[:8], ident["user_id"], _TIER_NAME.get(ident["tier"]), pos)
    return job.public(pos)


@app.get("/api/process/jobs/{job_id}")
async def job_status(job_id: str, request: Request):
    _internal_identity(request)
    job, pos = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job.public(pos)


@app.get("/api/process/jobs")
async def list_jobs(request: Request):
    _internal_identity(request)
    return {"jobs": [j.public() for j in JOBS.list_jobs()], "stats": JOBS.stats()}


@app.delete("/api/process/jobs/{job_id}")
async def cancel_job(job_id: str, request: Request):
    _internal_identity(request)
    return {"cancelled": JOBS.cancel(job_id)}


@app.post("/api/process/simulate")
async def simulate_process(graph: ProcessGraph):
    payload = graph.model_dump()

    # Preferred engine: OpenModelica (dynamic). Any failure — including a blocked
    # C toolchain — falls back to the steady-state engine so the API still answers.
    if _MODELICA_ENABLED:
        try:
            result = modelica_compiler.simulate(payload, resolve_tech_params)
            log.info("OpenModelica simulate: %d units", len(payload["units"]))
            result["economics"] = compute_economics(payload, result.get("units", {}), resolve_tech_params)
            return result
        except Exception as exc:  # noqa: BLE001
            log.warning("OpenModelica engine failed (%s) — falling back to steady-state", exc)

    try:
        result = simulate(payload)
    except GraphError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        log.exception("simulation failed")
        raise HTTPException(status_code=500, detail=f"Simulation failed: {exc}")
    result["economics"] = compute_economics(payload, result.get("units", {}), resolve_tech_params)
    log.info("Steady-state simulate: %d units, %d streams", len(payload["units"]), len(payload["streams"]))
    return result


@app.post("/api/process/verify")
async def verify_modelica(graph: ProcessGraph):
    """Front-end verification of the generated Modelica (parse + flatten via
    checkModel) — works even where the C toolchain is unavailable. Confirms the
    flowsheet compiles to a balanced, valid model before a full simulation."""
    if not _OPENMODELICA_AVAILABLE:
        raise HTTPException(status_code=503, detail="OpenModelica/OMPython not installed.")
    try:
        return modelica_compiler.check_models(graph.model_dump(), resolve_tech_params)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Verification failed: {exc}")


if __name__ == "__main__":
    import uvicorn
    log.info("Starting Process simulation service on %s:%s (engine=%s, omc_available=%s)",
             HOST, PORT, "openmodelica" if _MODELICA_ENABLED else "steady_state", _OPENMODELICA_AVAILABLE)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")

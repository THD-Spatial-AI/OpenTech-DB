"""
api/scraper_routes.py
======================
FastAPI router exposing the scraping pipeline management endpoints.

Endpoints
---------
GET  /scraper/status
    Current scheduler state, enabled sources, candidate counts, last run.

POST /scraper/run
    Trigger a manual pipeline run (background task or synchronous).

GET  /scraper/candidates
    List candidates with optional filtering by status / technology.

GET  /scraper/candidates/{candidate_id}
    Full detail for one candidate.

POST /scraper/candidates/{candidate_id}/approve
    Approve and merge the proposed instance into the catalogue.

POST /scraper/candidates/{candidate_id}/reject
    Reject the candidate and archive it.

All write endpoints are protected by the existing admin token mechanism.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Body, Header, HTTPException, Query
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scraper", tags=["Scraper"])

# ---------------------------------------------------------------------------
# Security helper — mirrors the JWT-based check used in api/routes.py
# ---------------------------------------------------------------------------

def _require_admin(authorization: str | None) -> None:
    """
    Raise 403 unless the caller presents a valid admin JWT.

    Accepts the same ``Authorization: Bearer <token>`` header used by all
    other admin endpoints so the frontend can reuse the same auth context.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=403, detail="Admin authentication required.")

    import base64 as _b64, json as _json, time as _t
    token = authorization.removeprefix("Bearer ")

    def _b64d(s: str) -> bytes:
        return _b64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

    try:
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("Bad JWT structure")
        payload = _json.loads(_b64d(parts[1]))
    except Exception as exc:
        raise HTTPException(status_code=403, detail=f"Malformed token: {exc}") from exc

    # Check expiry
    exp = payload.get("exp", 0)
    if exp and _t.time() > exp:
        raise HTTPException(status_code=403, detail="Token expired.")

    # Accept Supabase JWT with app_metadata.is_admin OR our HS256 admin JWT
    is_admin = (
        payload.get("is_admin")
        or payload.get("app_metadata", {}).get("is_admin")
    )
    if not is_admin:
        raise HTTPException(status_code=403, detail="Admin privileges required.")


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class RunRequest(BaseModel):
    tech_ids: list[str] | None = None
    sources:  list[str] | None = None


class ApproveRequest(BaseModel):
    reviewed_by: str | None = None
    notes: str = ""


class RejectRequest(BaseModel):
    reason: str = ""
    reviewed_by: str | None = None


# ---------------------------------------------------------------------------
# Lazy helpers
# ---------------------------------------------------------------------------

def _get_pipeline():
    from scrapers.pipeline import ScrapingPipeline
    return ScrapingPipeline.from_config()


def _get_store():
    from scrapers.config import ScraperConfig
    from scrapers.storage import CandidateStore
    cfg = ScraperConfig.load()
    base_dir = cfg.resolved_path(getattr(cfg.output, "base_dir", "data/scraped"))
    return CandidateStore(base_dir)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/status",
    summary="Scraper status",
    description=(
        "Returns the scheduler state, enabled sources, candidate queue counts, "
        "and the last pipeline run summary."
    ),
)
def get_status() -> ORJSONResponse:
    try:
        from scrapers.config import ScraperConfig
        from scrapers.pipeline import get_current_run_status, get_current_run_log_tail
        from scrapers.scheduler import get_scheduler_status
        cfg = ScraperConfig.load()
        store = _get_store()
        return ORJSONResponse({
            "scheduler":       get_scheduler_status(),
            "enabled_sources": cfg.enabled_sources,
            "candidates":      store.count_by_status(),
            "last_run":        store.last_run(),
            "current_run":     get_current_run_status(),
            "current_log_tail": get_current_run_log_tail(120),
        })
    except Exception as exc:
        logger.exception("Status endpoint error")
        raise HTTPException(500, f"Internal error: {exc}") from exc


@router.post(
    "/run",
    summary="Trigger a pipeline run",
    description=(
        "Starts a scraping pipeline run. Optionally restrict to specific "
        "technology IDs and/or sources.\n\n"
        "**Requires admin token** header `X-Admin-Token`."
    ),
)
def trigger_run(
    body: RunRequest = Body(default_factory=RunRequest),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    authorization: Annotated[str | None, Header()] = None,
) -> ORJSONResponse:
    _require_admin(authorization)

    try:
        from scrapers.pipeline import get_current_run_status
        current = get_current_run_status()
        if current and current.get("running"):
            return ORJSONResponse(
                {
                    "status": "already_running",
                    "message": "A pipeline run is already in progress.",
                    "run_id": current.get("run_id"),
                    "current_phase": current.get("current_phase"),
                },
                status_code=409,
            )
    except Exception:
        # Best-effort guard; do not block run start on status-check errors.
        pass

    def _run() -> None:
        try:
            pipeline = _get_pipeline()
            result   = pipeline.run(
                tech_ids=body.tech_ids or None,
                sources=body.sources   or None,
            )
            logger.info(
                "Manual pipeline run finished: %d candidates created.",
                result.candidates_created,
            )
        except Exception as exc:
            logger.error("Manual pipeline run error: %s", exc, exc_info=True)

    background_tasks.add_task(_run)
    return ORJSONResponse(
        {"status": "accepted", "message": "Pipeline run started in background."},
        status_code=202,
    )


@router.post(
    "/stop",
    summary="Stop active pipeline run",
    description="Requests a safe stop of the currently running scraping pipeline.",
)
def stop_run(
    authorization: Annotated[str | None, Header()] = None,
) -> ORJSONResponse:
    _require_admin(authorization)
    try:
        from scrapers.pipeline import request_stop_current_run
        result = request_stop_current_run(reason="admin_api")
        if not result.get("requested"):
            return ORJSONResponse(
                {"status": "idle", "message": result.get("message", "No active run.")},
                status_code=409,
            )
        return ORJSONResponse(
            {
                "status": "accepted",
                "message": result.get("message", "Stop requested."),
                "run_id": result.get("run_id"),
            },
            status_code=202,
        )
    except Exception as exc:
        logger.exception("Stop endpoint error")
        raise HTTPException(500, f"Internal error: {exc}") from exc


@router.get(
    "/runs",
    summary="Pipeline run history",
    description="Returns the last N pipeline run summaries, newest first.",
)
def get_run_history(
    limit: int = Query(20, ge=1, le=100),
) -> ORJSONResponse:
    try:
        store = _get_store()
        history = store.get_run_history(limit=limit)
        return ORJSONResponse({"count": len(history), "runs": history})
    except Exception as exc:
        logger.exception("Run history endpoint error")
        raise HTTPException(500, f"Internal error: {exc}") from exc


@router.get(
    "/candidates",
    summary="List scraper candidates",
    description="Returns a list of candidates filtered by status and/or technology.",
)
def list_candidates(
    status: str | None = Query(None, description="pending | approved | rejected"),
    technology_id: str | None = Query(None, description="Filter by technology_id"),
    limit: int = Query(50, ge=1, le=500),
) -> ORJSONResponse:
    from scrapers.storage import CandidateStatus

    _status: CandidateStatus | None = None
    if status:
        try:
            _status = CandidateStatus(status)
        except ValueError:
            raise HTTPException(400, f"Invalid status '{status}'. Use pending|approved|rejected.")

    store = _get_store()
    items = store.list_candidates(status=_status, technology_id=technology_id, limit=limit)
    return ORJSONResponse({"count": len(items), "candidates": items})


@router.get(
    "/candidates/{candidate_id}",
    summary="Get a single candidate",
)
def get_candidate(candidate_id: str) -> ORJSONResponse:
    store = _get_store()
    item  = store.get_candidate(candidate_id)
    if item is None:
        raise HTTPException(404, f"Candidate '{candidate_id}' not found.")
    return ORJSONResponse(item)


@router.post(
    "/candidates/{candidate_id}/approve",
    summary="Approve a candidate",
    description=(
        "Approves the candidate and merges its proposed instance into the "
        "catalogue JSON file.\n\n"
        "**Requires admin token** header `X-Admin-Token`."
    ),
)
def approve_candidate(
    candidate_id: str,
    body: ApproveRequest = Body(default_factory=ApproveRequest),
    authorization: Annotated[str | None, Header()] = None,
) -> ORJSONResponse:
    _require_admin(authorization)
    pipeline = _get_pipeline()
    updated  = pipeline.approve_candidate(
        candidate_id,
        reviewed_by=body.reviewed_by,
        notes=body.notes,
    )
    if updated is None:
        raise HTTPException(
            404,
            f"Candidate '{candidate_id}' not found or merge failed. "
            "Check server logs for details.",
        )
    # Clear the in-process technology cache so the API immediately reflects
    # the newly merged instance (no server restart required).
    try:
        from .routes import _load_all_technologies, _build_ontology_schema
        _load_all_technologies.cache_clear()
        _build_ontology_schema.cache_clear()
        logger.info("Technology cache cleared after approving candidate %s", candidate_id)
    except Exception as exc:
        logger.warning("Could not clear technology cache: %s", exc)
    return ORJSONResponse({"status": "approved", "candidate": updated})


@router.post(
    "/candidates/{candidate_id}/reject",
    summary="Reject a candidate",
    description="Archives the candidate as rejected.\n\n**Requires admin token**.",
)
def reject_candidate(
    candidate_id: str,
    body: RejectRequest = Body(default_factory=RejectRequest),
    authorization: Annotated[str | None, Header()] = None,
) -> ORJSONResponse:
    _require_admin(authorization)
    from scrapers.storage import CandidateStore, CandidateStatus

    store   = _get_store()
    updated = store.update_status(
        candidate_id,
        CandidateStatus.REJECTED,
        review_notes=body.reason,
        reviewed_by=body.reviewed_by,
    )
    if updated is None:
        raise HTTPException(404, f"Candidate '{candidate_id}' not found.")
    return ORJSONResponse({"status": "rejected", "candidate": updated})

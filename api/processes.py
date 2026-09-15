"""
api/processes.py
================
FastAPI router for **Processes** — multi-equipment energy transformation
systems (see ADR-0004).

Endpoints
---------
GET  /processes                        → list Process summaries (status/domain filters)
GET  /processes/{id_or_slug}           → full Process detail (Units + Streams)
POST /processes/submit                 → contribute a Process (→ pending review)
GET  /processes/submissions            → list Process submissions (review queue)
POST /processes/submissions/{id}/review→ approve (→ catalogue / GitHub PR) or reject

Processes load from local seed files under ``data/processes/*.json``; submissions
are file-backed under ``data/pending_submissions/`` (mirroring the Technology
pipeline). Approval merges the Process into the catalogue — opening a GitHub PR
when ``GITHUB_TOKEN`` is set (ADR-0003), else writing the seed file directly for
local development.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from api._loader import DATA_DIR, _UUID_NS, _load_json_file, _PENDING_DIR
from api._auth_helpers import _require_admin, _require_contributor, _request_identity
from schemas.process import Process, ProcessCatalogue, ProcessStatus, ProcessSummary

logger = logging.getLogger(__name__)

PROCESS_DIR = DATA_DIR / "processes"
_SUB_PREFIX = "process__"   # distinguishes Process submissions from Technology ones

router = APIRouter(prefix="/processes", tags=["processes"])


# ---------------------------------------------------------------------------
# Loader — seed JSON files (one Process per file), cached per process
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _load_all_processes() -> dict[str, Process]:
    """Load every seed Process from ``data/processes/*.json``, keyed by UUID str.

    The ``id`` is derived deterministically from ``slug`` (uuid5), matching the
    Technology loader convention, so a Process keeps a stable id across reloads.
    Malformed files are logged and skipped rather than crashing the catalogue.
    """
    processes: dict[str, Process] = {}
    if not PROCESS_DIR.exists():
        logger.info("No data/processes/ directory yet — Process catalogue is empty.")
        return processes

    for path in sorted(PROCESS_DIR.glob("*.json")):
        try:
            raw = _load_json_file(path)
            slug = raw.get("slug")
            if not slug:
                raise ValueError("missing 'slug'")
            raw["id"] = str(uuid.uuid5(_UUID_NS, slug))
            proc = Process.model_validate(raw)
            processes[str(proc.id)] = proc
            logger.info("  OK  [process] %s (%s)", proc.name, path.name)
        except Exception as exc:  # noqa: BLE001 — one bad file must not sink the rest
            logger.error("  FAIL process %s → %s: %s", path.name, type(exc).__name__, exc)

    logger.info("Total processes loaded: %d", len(processes))
    return processes


def _get_all_processes() -> dict[str, Process]:
    return _load_all_processes()


def reload_processes() -> None:
    """Clear the Process cache (used by the debug reload endpoint / tests)."""
    _load_all_processes.cache_clear()


def _resolve(id_or_slug: str) -> Process | None:
    """Look a Process up by UUID string or by slug."""
    all_procs = _get_all_processes()
    if id_or_slug in all_procs:
        return all_procs[id_or_slug]
    return next((p for p in all_procs.values() if p.slug == id_or_slug), None)


def _to_summary(p: Process) -> ProcessSummary:
    """Build the lightweight list-view summary for a Process."""
    seen: list = []
    for s in p.streams:
        if s.carrier not in seen:
            seen.append(s.carrier)
    return ProcessSummary(
        id=p.id,
        slug=p.slug,
        name=p.name,
        description=p.description,
        domain=p.domain,
        status=p.status,
        n_units=len(p.units),
        n_streams=len(p.streams),
        carriers=seen,
        tags=p.tags,
    )


# ---------------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=ProcessCatalogue,
    summary="List processes",
    response_description="Paginated Process summaries.",
)
def list_processes(
    skip:   Annotated[int, Query(ge=0)] = 0,
    limit:  Annotated[int, Query(ge=1, le=100)] = 50,
    status: Annotated[ProcessStatus | None, Query(description="Filter by lifecycle status.")] = None,
    domain: Annotated[str | None, Query(description="Filter by grouping tag, e.g. 'hydrogen'.")] = None,
) -> ProcessCatalogue:
    items = list(_get_all_processes().values())
    if status is not None:
        items = [p for p in items if p.status == status]
    if domain is not None:
        items = [p for p in items if p.domain == domain]
    items.sort(key=lambda p: p.name.lower())

    total = len(items)
    page  = items[skip : skip + limit]
    return ProcessCatalogue(
        total=total,
        processes=[_to_summary(p) for p in page],
        has_more=skip + limit < total,
    )


# ---------------------------------------------------------------------------
# Contribution: submit → review → approve (catalogue / GitHub PR) | reject
# ---------------------------------------------------------------------------
# NOTE: the dynamic `GET /{id_or_slug}` route is defined at the very bottom of
# this module so it does not shadow the literal `/submit` and `/submissions`
# paths (FastAPI matches routes in registration order).

def _slugify(name: str) -> str:
    import re
    s = re.sub(r"[^a-z0-9]+", "_", (name or "untitled").lower()).strip("_")
    return s or "untitled"


class ProcessSubmissionResponse(BaseModel):
    id: str
    slug: str
    status: str


class ProcessSubmissionRecord(BaseModel):
    id: str
    slug: str
    name: str
    domain: str | None = None
    status: str
    submitted_at: str
    submitter: str | None = None
    n_units: int = 0
    n_streams: int = 0
    rejection_reason: str | None = None


class ReviewAction(BaseModel):
    action: str = Field(..., description="'approve' or 'reject'.")
    reason: str | None = Field(None, description="Reason, when rejecting.")


def _sub_path(sid: str) -> Path:
    return _PENDING_DIR / f"{_SUB_PREFIX}{sid}.json"


def _read_sub(path: Path) -> dict | None:
    try:
        with path.open(encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Cannot read process submission %s: %s", path.name, exc)
        return None


def _record_summary(raw: dict) -> ProcessSubmissionRecord:
    p = raw.get("payload", {})
    return ProcessSubmissionRecord(
        id=raw.get("submission_id", ""),
        slug=p.get("slug", ""),
        name=p.get("name", "—"),
        domain=p.get("domain"),
        status=raw.get("status", "pending_review"),
        submitted_at=raw.get("submitted_at", ""),
        submitter=raw.get("submitter"),
        n_units=len(p.get("units", [])),
        n_streams=len(p.get("streams", [])),
        rejection_reason=raw.get("rejection_reason"),
    )


@router.post("/submit", response_model=ProcessSubmissionResponse, summary="Contribute a Process for review")
def submit_process(request: Request, payload: dict[str, Any]) -> ProcessSubmissionResponse:
    """Validate and queue a user-built Process for review.

    Requires a contributor (or admin) realm session — mirrors the Technology
    submission endpoint. Authorship is taken from the validated session, not the
    client payload. The review step below is the admin gate.
    """
    identity = _require_contributor(request)
    sub = str(identity.get("sub") or "")

    body = dict(payload)
    body.setdefault("slug", _slugify(body.get("name", "")))
    body["status"] = ProcessStatus.SUBMITTED.value
    body["author"] = sub or None          # trust the token, not the client
    body.pop("id", None)
    try:
        proc = Process.model_validate(body)   # enforces graph consistency
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Invalid Process: {exc}")

    sid = str(uuid.uuid4())
    record = {
        "submission_id": sid,
        "kind": "process",
        "status": "pending_review",
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "submitter": identity.get("email") or sub or None,
        "user_id": sub,
        "payload": proc.model_dump(mode="json", exclude={"id"}),
    }
    _PENDING_DIR.mkdir(parents=True, exist_ok=True)
    with _sub_path(sid).open("w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2)
    logger.info("Queued process submission %s (%s)", sid, proc.slug)
    return ProcessSubmissionResponse(id=sid, slug=proc.slug, status="pending_review")


@router.get("/submissions", response_model=list[ProcessSubmissionRecord], summary="List Process submissions (admin)")
def list_process_submissions(
    request: Request,
    status: Annotated[str | None, Query(description="Filter: pending_review | approved | rejected.")] = None,
) -> list[ProcessSubmissionRecord]:
    _require_admin(request)   # review queue is admin-only
    _PENDING_DIR.mkdir(parents=True, exist_ok=True)
    out: list[ProcessSubmissionRecord] = []
    for path in sorted(_PENDING_DIR.glob(f"{_SUB_PREFIX}*.json"), reverse=True):
        raw = _read_sub(path)
        if raw is None:
            continue
        if status and raw.get("status") != status:
            continue
        out.append(_record_summary(raw))
    return out


@router.post("/submissions/{sid}/review", response_model=ProcessSubmissionRecord,
             summary="Approve or reject a Process submission (admin)")
def review_process_submission(request: Request, sid: str, action: ReviewAction) -> ProcessSubmissionRecord:
    """Approve (→ catalogue / GitHub PR) or reject a submission. Admin only —
    the approval gate, mirroring the Technology pipeline (ADR-0001)."""
    identity = _require_admin(request)

    path = _sub_path(sid)
    raw = _read_sub(path)
    if raw is None:
        raise HTTPException(status_code=404, detail=f"Submission '{sid}' not found.")
    if raw.get("status") != "pending_review":
        raise HTTPException(status_code=409, detail=f"Submission already {raw.get('status')}.")

    raw["reviewed_by"] = str(identity.get("sub") or "")
    raw["reviewed_at"] = datetime.now(timezone.utc).isoformat()

    if action.action == "reject":
        raw["status"] = "rejected"
        raw["rejection_reason"] = action.reason
    elif action.action == "approve":
        payload = raw.get("payload", {})
        slug = payload.get("slug") or _slugify(payload.get("name", ""))
        seed = {k: v for k, v in payload.items() if k != "id"}
        seed["status"] = ProcessStatus.APPROVED.value
        content = json.dumps(seed, indent=2, ensure_ascii=False)

        if os.getenv("GITHUB_TOKEN"):
            raw["pr_url"] = _open_process_pr(slug, content, sid)
        else:
            PROCESS_DIR.mkdir(parents=True, exist_ok=True)
            (PROCESS_DIR / f"{slug}.json").write_text(content + "\n", encoding="utf-8")
            reload_processes()  # surface the new Process immediately in dev
            logger.info("Approved process '%s' → wrote data/processes/%s.json", slug, slug)
        raw["status"] = "approved"
    else:
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'.")

    with path.open("w", encoding="utf-8") as fh:
        json.dump(raw, fh, indent=2)
    return _record_summary(raw)


def _open_process_pr(slug: str, content: str, submission_id: str) -> str:
    """Open a GitHub PR adding data/processes/<slug>.json.

    Mirrors the mechanics of the Technology approval PR helper. Requires
    GITHUB_TOKEN; GITHUB_REPO (default THD-Spatial-AI/OpenTech-DB) and
    GITHUB_BASE_BRANCH (default main) are optional. Not exercised in local dev
    (no token) — the direct-write path above is used there instead.
    """
    import base64
    import httpx

    token = os.getenv("GITHUB_TOKEN")
    repo = os.getenv("GITHUB_REPO", "THD-Spatial-AI/OpenTech-DB")
    base = os.getenv("GITHUB_BASE_BRANCH", "main")
    api = f"https://api.github.com/repos/{repo}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    file_path = f"data/processes/{slug}.json"
    branch = f"process-submission/{submission_id[:8]}/{slug}"

    ref = httpx.get(f"{api}/git/ref/heads/{base}", headers=headers, timeout=15)
    if ref.status_code != 200:
        raise HTTPException(status_code=502, detail=f"GitHub: cannot read base branch ({ref.status_code}).")
    base_sha = ref.json()["object"]["sha"]

    br = httpx.post(f"{api}/git/refs", headers=headers, timeout=15,
                    json={"ref": f"refs/heads/{branch}", "sha": base_sha})
    if br.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"GitHub: cannot create branch ({br.status_code}).")

    # New file on this branch (Process seeds are one-file-per-slug).
    existing = httpx.get(f"{api}/contents/{file_path}?ref={branch}", headers=headers, timeout=15)
    commit: dict[str, Any] = {
        "message": f"Add process '{slug}' from submission {submission_id[:8]}",
        "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
        "branch": branch,
    }
    if existing.status_code == 200:
        commit["sha"] = existing.json()["sha"]
    put = httpx.put(f"{api}/contents/{file_path}", headers=headers, timeout=15, json=commit)
    if put.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"GitHub: cannot commit file ({put.status_code}).")

    pr = httpx.post(f"{api}/pulls", headers=headers, timeout=15, json={
        "title": f"Add process: {slug}",
        "head": branch, "base": base,
        "body": f"Adds `data/processes/{slug}.json` from Process submission `{submission_id}` (ADR-0004).",
    })
    if pr.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"GitHub: cannot open PR ({pr.status_code}).")
    return pr.json()["html_url"]


# ---------------------------------------------------------------------------
# Simulation gateway (ADR-0005): authenticated entry point that derives the
# requester's priority tier and forwards to the internal processsim job queue.
# ---------------------------------------------------------------------------

_SIM_URL = os.getenv("PROCESS_SIM_URL", "http://localhost:8770").rstrip("/")
_SIM_SECRET = os.getenv("PROCESS_SIM_SECRET", "")


def _requester(request) -> tuple[str, int]:
    """Return (user_id, tier). Tier: admin=0, contributor=1, else anonymous=2.
    Simulation is open to all (lowest priority) so it works before/without login."""
    anon = "anon:" + (request.client.host if request.client else "unknown")
    try:
        ident = _request_identity(request)
    except HTTPException:
        return anon, 2
    roles = set(ident.get("roles", []))
    tier = 0 if "admin" in roles else (1 if "contributor" in roles else 2)
    return (str(ident.get("sub") or "") or anon), tier


def _sim_headers(user_id: str, tier: int) -> dict:
    h = {"X-User-Id": user_id, "X-User-Tier": str(tier)}
    if _SIM_SECRET:
        h["X-Internal-Secret"] = _SIM_SECRET
    return h


@router.post("/simulate", summary="Submit a Process simulation (queued)")
def submit_simulation(request: Request, graph: dict[str, Any]):
    """Enqueue a simulation of a Process graph on the processsim service; returns
    a job handle (poll ``/processes/simulate/{job_id}``). Priority follows the
    caller's realm role."""
    import httpx
    user_id, tier = _requester(request)
    try:
        r = httpx.post(f"{_SIM_URL}/api/process/jobs", json=graph,
                       headers=_sim_headers(user_id, tier), timeout=15)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Simulation service unreachable: {exc}")
    if r.status_code == 409:
        raise HTTPException(status_code=409, detail=r.json().get("detail", "A simulation is already in progress."))
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Simulation service error ({r.status_code}).")
    return r.json()


@router.get("/simulate/{job_id}", summary="Poll a Process simulation job")
def simulation_status(request: Request, job_id: str):
    import httpx
    user_id, tier = _requester(request)
    try:
        r = httpx.get(f"{_SIM_URL}/api/process/jobs/{job_id}",
                      headers=_sim_headers(user_id, tier), timeout=15)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Simulation service unreachable: {exc}")
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="Simulation job not found.")
    return r.json()


@router.get("/sim-queue", summary="Inspect the simulation queue (admin)")
def simulation_queue(request: Request):
    _require_admin(request)
    import httpx
    try:
        r = httpx.get(f"{_SIM_URL}/api/process/jobs", headers=_sim_headers("admin", 0), timeout=15)
        return r.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Simulation service unreachable: {exc}")


@router.delete("/sim-queue/{job_id}", summary="Cancel a simulation job (admin)")
def cancel_simulation(request: Request, job_id: str):
    _require_admin(request)
    import httpx
    try:
        r = httpx.delete(f"{_SIM_URL}/api/process/jobs/{job_id}", headers=_sim_headers("admin", 0), timeout=15)
        return r.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Simulation service unreachable: {exc}")


# ---------------------------------------------------------------------------
# Dynamic detail route — LAST, so it does not shadow /submit and /submissions.
# ---------------------------------------------------------------------------

@router.get(
    "/{id_or_slug}",
    response_model=Process,
    summary="Get one process",
    response_description="Full Process detail: Units and Streams.",
)
def get_process(id_or_slug: str) -> Process:
    proc = _resolve(id_or_slug)
    if proc is None:
        raise HTTPException(status_code=404, detail=f"Process '{id_or_slug}' not found.")
    return proc

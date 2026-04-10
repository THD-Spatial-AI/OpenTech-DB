"""
api/timeseries.py
=================
FastAPI router for the Time Series & Profiles catalogue.

Endpoints
---------
GET  /timeseries                         → list catalogue metadata (paginated)
GET  /timeseries/{profile_id}/data       → full data points for one profile
POST /timeseries/upload                  → contributor upload (multipart CSV/JSON) → pending review
DELETE /timeseries/{profile_id}          → delete an approved profile

Admin endpoints (require admin JWT)
------------------------------------
GET  /admin/timeseries/submissions         → list pending/approved/rejected profile submissions
POST /admin/timeseries/submissions/{id}    → approve or reject a submission

Data layout in  data/timeseries/:
  timeseries_catalogue.json              – approved profile metadata (no raw values)
  {profile_id}.json                      – approved per-profile data file
  pending/                               – pending submissions (not yet in catalogue)
    {submission_id}.json                 – full submission record incl. data points

Profile types : capacity_factor | load | generation | weather | price
Resolutions   : 15min | 30min | hourly | daily
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
import uuid as _uuid_mod
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DATA_DIR       = Path(__file__).resolve().parent.parent / "data" / "timeseries"
_CATALOGUE_FILE = _DATA_DIR / "timeseries_catalogue.json"
_PENDING_DIR    = _DATA_DIR / "pending"

_ALLOWED_TYPES       = {"capacity_factor", "load", "generation", "weather", "price"}
_ALLOWED_RESOLUTIONS = {"15min", "30min", "hourly", "daily"}

# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------


class TimeSeriesProfileMeta(BaseModel):
    profile_id:   str
    name:         str
    type:         str
    resolution:   str
    location:     str
    source:       str
    carrier:      str
    year:         int
    n_timesteps:  int
    description:  str
    uploaded_at:  str
    unit:         str


class TimeSeriesCatalogueResponse(BaseModel):
    total:    int
    profiles: list[TimeSeriesProfileMeta]


class TimeSeriesDataPoint(BaseModel):
    timestamp: str
    value:     float


class TimeSeriesDataResponse(BaseModel):
    profile_id: str
    name:       str
    unit:       str
    points:     list[TimeSeriesDataPoint]


class TimeSeriesUploadResponse(BaseModel):
    submission_id: str
    name:          str
    n_timesteps:   int
    status:        str = "pending_review"


class ProfileStats(BaseModel):
    v_min:         float
    v_max:         float
    v_mean:        float
    v_std:         float
    v_p10:         float
    v_p90:         float
    first_ts:      str
    last_ts:       str


class ProfileSubmissionRecord(BaseModel):
    submission_id:    str
    name:             str
    type:             str
    resolution:       str
    location:         str
    source:           str
    carrier:          str
    year:             int
    unit:             str
    description:      str
    n_timesteps:      int
    submitted_at:     str
    submitter_email:  str | None = None
    status:           str        = "pending_review"
    rejection_reason: str | None = None
    stats:            ProfileStats | None = None


# ---------------------------------------------------------------------------
# Catalogue loader (cached)
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _load_catalogue() -> list[dict]:
    """Load catalogue metadata from disk (cached for process lifetime)."""
    if not _CATALOGUE_FILE.exists():
        logger.warning("timeseries_catalogue.json not found at %s", _CATALOGUE_FILE)
        return []
    with _CATALOGUE_FILE.open(encoding="utf-8") as fh:
        raw = json.load(fh)
    return raw.get("profiles", [])


def _reload_catalogue() -> None:
    """Clear the catalogue cache so the next request re-reads the file."""
    _load_catalogue.cache_clear()


def _load_profile_data(profile_id: str) -> dict | None:
    """Load the per-profile data file.  Returns None if the file is missing."""
    # Guard against path traversal
    safe_id = re.sub(r"[^a-z0-9_\-]", "", profile_id)
    if safe_id != profile_id:
        return None
    path = _DATA_DIR / f"{safe_id}.json"
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/timeseries", tags=["Time Series"])


@router.get(
    "",
    response_model=TimeSeriesCatalogueResponse,
    summary="List all time-series profiles",
    response_description="Paginated catalogue of available time-series profiles (metadata only).",
)
def list_profiles(
    skip:       Annotated[int, Query(ge=0, description="Offset for pagination")]   = 0,
    limit:      Annotated[int, Query(ge=1, le=500, description="Max items to return")] = 50,
    type:       Annotated[str | None, Query(description="Filter by profile type (e.g. capacity_factor, load)")] = None,
    resolution: Annotated[str | None, Query(description="Filter by temporal resolution (e.g. hourly)")] = None,
    location:   Annotated[str | None, Query(description="Filter by location code (e.g. DE, FR)")] = None,
    carrier:    Annotated[str | None, Query(description="Filter by energy carrier")] = None,
) -> TimeSeriesCatalogueResponse:
    profiles = _load_catalogue()

    # --- Apply filters ---
    if type:
        profiles = [p for p in profiles if p.get("type") == type]
    if resolution:
        profiles = [p for p in profiles if p.get("resolution") == resolution]
    if location:
        profiles = [p for p in profiles if p.get("location", "").upper() == location.upper()]
    if carrier:
        profiles = [p for p in profiles if p.get("carrier", "").lower() == carrier.lower()]

    total = len(profiles)
    page  = profiles[skip : skip + limit]
    return TimeSeriesCatalogueResponse(total=total, profiles=page)


@router.get(
    "/{profile_id}/data",
    response_model=TimeSeriesDataResponse,
    summary="Fetch data points for a single profile",
    response_description="Full time series with one {timestamp, value} pair per row.",
)
def get_profile_data(profile_id: str) -> TimeSeriesDataResponse:
    # Guard: validate profile_id format before loading
    if not re.fullmatch(r"[a-z0-9_\-]+", profile_id):
        raise HTTPException(status_code=400, detail="Invalid profile_id format.")

    data = _load_profile_data(profile_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Profile '{profile_id}' not found.")

    return TimeSeriesDataResponse(
        profile_id = data["profile_id"],
        name       = data["name"],
        unit       = data["unit"],
        points     = data["points"],
    )


@router.post(
    "/upload",
    response_model=TimeSeriesUploadResponse,
    status_code=202,
    summary="Submit a new time-series profile for admin review",
    response_description="Confirmation with assigned submission_id — profile is pending review.",
)
async def upload_profile(
    name:        Annotated[str, Form(description="Human-readable profile name")],
    type:        Annotated[str, Form(description="Profile type")],  # noqa: A002
    resolution:  Annotated[str, Form(description="Temporal resolution")],
    location:    Annotated[str, Form(description="ISO country code or region")],
    source:      Annotated[str, Form(description="Data source reference")],
    carrier:     Annotated[str, Form(description="Energy carrier")],
    year:        Annotated[int, Form(description="Reference year")] = 0,
    description: Annotated[str, Form(description="Free-text description")]   = "",
    unit:        Annotated[str, Form(description="Physical unit of the values")] = "p.u.",
    file:        UploadFile = File(description="CSV or JSON file with time-series data"),
    authorization: Annotated[str | None, Header()] = None,
) -> TimeSeriesUploadResponse:
    """
    Accept a contributor-submitted time-series profile for admin review.
    The data is stored in data/timeseries/pending/ and NOT added to the
    public catalogue until an admin approves it.
    """
    # --- Validate enum fields ---
    if type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid profile type '{type}'. Allowed: {sorted(_ALLOWED_TYPES)}",
        )
    if resolution not in _ALLOWED_RESOLUTIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid resolution '{resolution}'. Allowed: {sorted(_ALLOWED_RESOLUTIONS)}",
        )

    # --- Detect format and parse ---
    raw_bytes = await file.read()
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"File is not valid UTF-8: {exc}") from exc

    filename_lower = (file.filename or "").lower()
    points: list[dict[str, Any]] = []

    if filename_lower.endswith(".json"):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail=f"JSON parse error: {exc}") from exc

        if isinstance(parsed, dict) and "points" in parsed:
            rows = parsed["points"]
        elif isinstance(parsed, list):
            rows = parsed
        elif isinstance(parsed, dict):
            rows = [{"timestamp": k, "value": v} for k, v in parsed.items()]
        else:
            raise HTTPException(status_code=422, detail="Unrecognised JSON structure.")

        for idx, row in enumerate(rows):
            if isinstance(row, dict):
                ts  = row.get("timestamp") or row.get("time") or row.get("datetime")
                val = row.get("value") or row.get("v")
            elif isinstance(row, (list, tuple)) and len(row) >= 2:
                ts, val = row[0], row[1]
            else:
                raise HTTPException(status_code=422, detail=f"Row {idx}: cannot extract timestamp/value.")
            try:
                points.append({"timestamp": str(ts).strip(), "value": round(float(val), 6)})
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail=f"Row {idx}: value '{val}' is not a number.")
    else:
        reader = csv.reader(io.StringIO(text))
        for row_num, row in enumerate(reader, start=1):
            if not row or row[0].strip().lower() in {"timestamp", "time", "datetime", "date"}:
                continue
            if len(row) < 2:
                raise HTTPException(status_code=422, detail=f"Row {row_num}: expected 2 columns, got {len(row)}.")
            try:
                value = float(row[1].strip())
            except ValueError:
                raise HTTPException(status_code=422, detail=f"Row {row_num}: value '{row[1].strip()}' is not a number.")
            points.append({"timestamp": row[0].strip(), "value": round(value, 6)})

    if len(points) < 2:
        raise HTTPException(status_code=422, detail="File must contain at least 2 data rows.")

    # --- Extract submitter email from token (best-effort) ---
    submitter_email: str | None = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ")
        try:
            from api.auth import _decode_jwt
            submitter_email = _decode_jwt(token).get("email")
        except Exception:
            pass
        if not submitter_email:
            try:
                import base64 as _b64, json as _j
                part = token.split(".")[1]
                pl = _j.loads(_b64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
                submitter_email = pl.get("email")
            except Exception:
                pass

    # --- Build submission_id ---
    submission_id = str(_uuid_mod.uuid4())
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    # --- Write pending submission file (includes full data points) ---
    _PENDING_DIR.mkdir(parents=True, exist_ok=True)
    pending_path = _PENDING_DIR / f"{submission_id}.json"
    with pending_path.open("w", encoding="utf-8") as fh:
        json.dump({
            "submission_id":   submission_id,
            "submitted_at":    now_str,
            "status":          "pending_review",
            "submitter_email": submitter_email,
            "name":            name,
            "type":            type,
            "resolution":      resolution,
            "location":        location.upper(),
            "source":          source,
            "carrier":         carrier,
            "year":            year,
            "unit":            unit,
            "description":     description,
            "n_timesteps":     len(points),
            "points":          points,
        }, fh, indent=2)

    logger.info("Timeseries submission queued for review: %s (%d points)", submission_id, len(points))

    return TimeSeriesUploadResponse(
        submission_id = submission_id,
        name          = name,
        n_timesteps   = len(points),
        status        = "pending_review",
    )


@router.delete(
    "/{profile_id}",
    status_code=204,
    summary="Delete a time-series profile",
    response_description="Profile metadata and data file removed.",
)
def delete_profile(
    profile_id:    str,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """
    Remove a profile from the catalogue index and delete its data file.
    """
    # Guard against path traversal
    safe_id = re.sub(r"[^a-z0-9_\-]", "", profile_id)
    if safe_id != profile_id:
        raise HTTPException(status_code=422, detail="Invalid profile_id format.")

    if not _CATALOGUE_FILE.exists():
        raise HTTPException(status_code=404, detail=f"Profile '{safe_id}' not found.")

    with _CATALOGUE_FILE.open(encoding="utf-8") as fh:
        catalogue_doc = json.load(fh)

    profiles = catalogue_doc.get("profiles", [])
    if not any(p.get("profile_id") == safe_id for p in profiles):
        raise HTTPException(status_code=404, detail=f"Profile '{safe_id}' not found.")

    catalogue_doc["profiles"] = [p for p in profiles if p.get("profile_id") != safe_id]
    with _CATALOGUE_FILE.open("w", encoding="utf-8") as fh:
        json.dump(catalogue_doc, fh, indent=2)

    data_path = _DATA_DIR / f"{safe_id}.json"
    if data_path.exists():
        data_path.unlink()

    _reload_catalogue()
    logger.info("Timeseries profile deleted: %s", safe_id)


# ---------------------------------------------------------------------------
# Admin router — review pending profile submissions
# ---------------------------------------------------------------------------

import math as _math
from api.routes import _require_admin  # noqa: E402  (reuse existing admin auth helper)


def _compute_stats(points: list[dict]) -> "ProfileStats | None":
    """Compute summary statistics from a list of {timestamp, value} dicts."""
    vals = [p["value"] for p in points if isinstance(p.get("value"), (int, float))]
    if not vals:
        return None
    n    = len(vals)
    s    = sorted(vals)
    mean = sum(s) / n
    var  = sum((v - mean) ** 2 for v in s) / n
    def pct(p: float) -> float:
        idx = (p / 100) * (n - 1)
        lo, hi = int(idx), min(int(idx) + 1, n - 1)
        return s[lo] + (s[hi] - s[lo]) * (idx - lo)
    return ProfileStats(
        v_min  = round(s[0],           6),
        v_max  = round(s[-1],          6),
        v_mean = round(mean,           6),
        v_std  = round(_math.sqrt(var), 6),
        v_p10  = round(pct(10),        6),
        v_p90  = round(pct(90),        6),
        first_ts = points[0]["timestamp"]  if points else "",
        last_ts  = points[-1]["timestamp"] if points else "",
    )

admin_ts_router = APIRouter(prefix="/admin/timeseries", tags=["Admin – Time Series"])


def _load_pending_submission(submission_id: str) -> dict:
    safe_id = re.sub(r"[^a-z0-9\-]", "", submission_id)
    path = _PENDING_DIR / f"{safe_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Submission '{safe_id}' not found.")
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _approve_profile_submission(record: dict) -> str:
    """Write the approved profile to the catalogue and data file. Returns profile_id."""
    safe_name  = re.sub(r"[^a-z0-9]+", "_", record["name"].lower()).strip("_")[:40]
    short_id   = record["submission_id"][:8]
    profile_id = f"{safe_name}_{short_id}"
    now_str    = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    # Write data file
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    data_path = _DATA_DIR / f"{profile_id}.json"
    with data_path.open("w", encoding="utf-8") as fh:
        json.dump({
            "profile_id": profile_id,
            "name":       record["name"],
            "unit":       record["unit"],
            "points":     record["points"],
        }, fh)

    # Update catalogue
    catalogue_entry: dict = {
        "profile_id":  profile_id,
        "name":        record["name"],
        "type":        record["type"],
        "resolution":  record["resolution"],
        "location":    record["location"],
        "source":      record["source"],
        "carrier":     record["carrier"],
        "year":        record.get("year", 0),
        "n_timesteps": record["n_timesteps"],
        "description": record.get("description", ""),
        "uploaded_at": now_str,
        "unit":        record["unit"],
    }
    if _CATALOGUE_FILE.exists():
        with _CATALOGUE_FILE.open(encoding="utf-8") as fh:
            catalogue_doc = json.load(fh)
    else:
        catalogue_doc = {"version": "1.0.0", "profiles": []}

    catalogue_doc.setdefault("profiles", []).append(catalogue_entry)
    with _CATALOGUE_FILE.open("w", encoding="utf-8") as fh:
        json.dump(catalogue_doc, fh, indent=2)

    _reload_catalogue()
    return profile_id


@admin_ts_router.get(
    "/submissions",
    response_model=list[ProfileSubmissionRecord],
    summary="List all profile submissions (admin only)",
)
def list_profile_submissions(
    status: Annotated[str | None, Query(description="Filter by status")] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> list[ProfileSubmissionRecord]:
    _require_admin(authorization)
    _PENDING_DIR.mkdir(parents=True, exist_ok=True)
    records: list[ProfileSubmissionRecord] = []
    for path in sorted(_PENDING_DIR.glob("*.json"), reverse=True):
        try:
            with path.open(encoding="utf-8") as fh:
                raw = json.load(fh)
        except Exception:
            continue
        if status and raw.get("status") != status:
            continue
        stats = _compute_stats(raw.get("points", []))
        records.append(ProfileSubmissionRecord(
            submission_id    = raw.get("submission_id", path.stem),
            name             = raw.get("name", "—"),
            type             = raw.get("type", ""),
            resolution       = raw.get("resolution", ""),
            location         = raw.get("location", ""),
            source           = raw.get("source", ""),
            carrier          = raw.get("carrier", ""),
            year             = raw.get("year", 0),
            unit             = raw.get("unit", ""),
            description      = raw.get("description", ""),
            n_timesteps      = raw.get("n_timesteps", 0),
            submitted_at     = raw.get("submitted_at", ""),
            submitter_email  = raw.get("submitter_email"),
            status           = raw.get("status", "pending_review"),
            rejection_reason = raw.get("rejection_reason"),
            stats            = stats,
        ))
    return records


@admin_ts_router.get(
    "/submissions/{submission_id}/data",
    summary="Get full data points for a pending submission (admin only)",
)
def get_profile_submission_data(
    submission_id: str,
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    _require_admin(authorization)
    safe_id = re.sub(r"[^a-z0-9\-]", "", submission_id)
    path    = _PENDING_DIR / f"{safe_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Submission not found.")
    with path.open(encoding="utf-8") as fh:
        raw = json.load(fh)
    return {
        "submission_id": safe_id,
        "name":          raw.get("name", ""),
        "unit":          raw.get("unit", ""),
        "points":        raw.get("points", []),
    }


class ProfileAdminAction(BaseModel):
    action: str           # "approve" | "reject"
    reason: str | None = None


@admin_ts_router.post(
    "/submissions/{submission_id}",
    summary="Approve or reject a pending profile submission",
)
def act_on_profile_submission(
    submission_id: str,
    body: ProfileAdminAction,
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    admin_payload = _require_admin(authorization)
    admin_email   = admin_payload.get("email", "admin")

    if body.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'.")

    safe_id = re.sub(r"[^a-z0-9\-]", "", submission_id)
    path    = _PENDING_DIR / f"{safe_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Submission not found.")

    with path.open(encoding="utf-8") as fh:
        record = json.load(fh)

    if record.get("status") != "pending_review":
        raise HTTPException(status_code=409, detail=f"Submission already {record['status']}.")

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    if body.action == "approve":
        profile_id = _approve_profile_submission(record)
        record["status"]      = "approved"
        record["profile_id"]  = profile_id
        logger.info("Admin approved profile submission %s → %s", safe_id, profile_id)
    else:
        record["status"]           = "rejected"
        record["rejection_reason"] = body.reason or ""
        logger.info("Admin rejected profile submission %s", safe_id)

    record["reviewed_at"] = now_str
    record["reviewed_by"] = admin_email

    with path.open("w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2)

    return {"status": record["status"], "submission_id": safe_id}

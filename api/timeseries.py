"""
api/timeseries.py
=================
FastAPI router for the Time Series & Profiles catalogue.

Endpoints
---------
GET  /timeseries                         → list catalogue metadata (paginated; ETag)
GET  /timeseries/{profile_id}/data       → data points for one profile (ETag;
                                           optional start/end window + max_points downsampling)
POST /timeseries/upload                  → contributor upload (multipart CSV/JSON) → pending review
DELETE /timeseries/{profile_id}          → delete an approved profile (admin only)

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

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response, UploadFile, File, Form
from fastapi.responses import ORJSONResponse
from slowapi import Limiter
from slowapi.util import get_remote_address

_limiter = Limiter(key_func=get_remote_address)
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
# Storage layer — Supabase-first, filesystem fallback for local dev
# ---------------------------------------------------------------------------
# When SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set the backend reads/writes
# timeseries_profiles and timeseries_submissions tables (migration 010).
# Without those env vars the old filesystem layout under data/timeseries/ is
# used — this keeps local dev working without a Supabase project.
# ---------------------------------------------------------------------------


def _ts_sb():
    """Return a Supabase service-role client, or None when not configured."""
    from api._auth_helpers import _get_sb  # noqa: PLC0415
    return _get_sb()


# -- Approved profiles (catalogue) ------------------------------------------

_CATALOGUE_META_COLS = (
    "profile_id,name,type,resolution,location,source,carrier,"
    "year,n_timesteps,description,uploaded_at,unit"
)


def _sb_list_profiles(
    type_: str | None = None,
    resolution: str | None = None,
    location: str | None = None,
    carrier: str | None = None,
) -> list[dict]:
    """Fetch all matching profiles, paging in 1000-row chunks to bypass PostgREST db-max-rows."""
    sb = _ts_sb()
    all_rows: list[dict] = []
    page_size = 1000
    offset = 0
    while True:
        q = sb.table("timeseries_profiles").select(_CATALOGUE_META_COLS)
        if type_:       q = q.eq("type", type_)
        if resolution:  q = q.eq("resolution", resolution)
        if location:    q = q.ilike("location", location)
        if carrier:     q = q.ilike("carrier", carrier)
        rows = q.order("uploaded_at", desc=True).range(offset, offset + page_size - 1).execute().data or []
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return all_rows


def _sb_get_profile(profile_id: str) -> dict | None:
    sb  = _ts_sb()
    res = sb.table("timeseries_profiles").select("*").eq("profile_id", profile_id).execute()
    return res.data[0] if res.data else None


def _sb_delete_profile(profile_id: str) -> None:
    _ts_sb().table("timeseries_profiles").delete().eq("profile_id", profile_id).execute()


def _sb_update_profile_meta(profile_id: str, updates: dict) -> dict | None:
    res = _ts_sb().table("timeseries_profiles").update(updates).eq("profile_id", profile_id).execute()
    return res.data[0] if res.data else None


def _sb_replace_profile_points(profile_id: str, points: list[dict]) -> dict | None:
    res = _ts_sb().table("timeseries_profiles").update({
        "points": points, "n_timesteps": len(points),
    }).eq("profile_id", profile_id).execute()
    return res.data[0] if res.data else None


# -- Pending submissions ------------------------------------------------------

_SUBMISSION_META_COLS = (
    "submission_id,name,type,resolution,location,source,carrier,year,unit,description,"
    "n_timesteps,submitted_at,submitter_email,status,rejection_reason,stats"
)


def _sb_insert_submission(record: dict) -> None:
    _ts_sb().table("timeseries_submissions").insert(record).execute()


def _sb_list_submissions(status: str | None = None) -> list[dict]:
    sb = _ts_sb()
    q  = sb.table("timeseries_submissions").select(_SUBMISSION_META_COLS).order("submitted_at", desc=True)
    if status:
        q = q.eq("status", status)
    return q.execute().data or []


def _sb_get_submission(submission_id: str) -> dict | None:
    res = _ts_sb().table("timeseries_submissions").select("*").eq("submission_id", submission_id).execute()
    return res.data[0] if res.data else None


def _sb_approve_submission(submission_id: str, admin_email: str) -> str:
    """Promote pending submission → timeseries_profiles. Returns profile_id."""
    record = _sb_get_submission(submission_id)
    if not record:
        raise HTTPException(status_code=404, detail="Submission not found.")
    if record["status"] != "pending_review":
        raise HTTPException(status_code=409, detail=f"Submission already {record['status']}.")

    safe_name  = re.sub(r"[^a-z0-9]+", "_", record["name"].lower()).strip("_")[:40]
    profile_id = f"{safe_name}_{submission_id[:8]}"
    now_str    = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    _ts_sb().table("timeseries_profiles").upsert({
        "profile_id":  profile_id,
        "name":        record["name"],
        "type":        record["type"],
        "resolution":  record["resolution"],
        "location":    record["location"],
        "source":      record.get("source", ""),
        "source_name": record.get("source_name"),
        "carrier":     record["carrier"],
        "year":        record.get("year", 0),
        "n_timesteps": record["n_timesteps"],
        "description": record.get("description", ""),
        "uploaded_at": now_str,
        "unit":        record["unit"],
        "points":      record.get("points", []),
    }).execute()

    _ts_sb().table("timeseries_submissions").update({
        "status":      "approved",
        "profile_id":  profile_id,
        "reviewed_at": now_str,
        "reviewed_by": admin_email,
    }).eq("submission_id", submission_id).execute()

    return profile_id


def _sb_reject_submission(submission_id: str, admin_email: str, reason: str | None) -> None:
    _ts_sb().table("timeseries_submissions").update({
        "status":           "rejected",
        "rejection_reason": reason or "",
        "reviewed_at":      datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
        "reviewed_by":      admin_email,
    }).eq("submission_id", submission_id).execute()

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
    has_more: bool = False


class TimeSeriesDataPoint(BaseModel):
    timestamp: str
    value:     float


class TimeSeriesDataResponse(BaseModel):
    profile_id: str
    name:       str
    unit:       str
    points:     list[TimeSeriesDataPoint]
    n_points_total: int | None = None
    downsampled:    bool       = False


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
# Timestamp normaliser
# ---------------------------------------------------------------------------

_TS_PATTERNS = [
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
    "%d/%m/%Y",
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y %H:%M",
    "%m/%d/%Y",
    "%d.%m.%Y %H:%M:%S",
    "%d.%m.%Y %H:%M",
    "%d.%m.%Y",
    "%Y/%m/%d %H:%M:%S",
    "%Y/%m/%d %H:%M",
    "%Y/%m/%d",
]


def _parse_timestamp(raw: str) -> str:
    """
    Accept any common timestamp format and return ``YYYY-MM-DD HH:MM:SS``.
    Raises ValueError with a descriptive message on failure.
    """
    s = raw.strip()

    # 1. Unix epoch (integer or float string)
    try:
        epoch = float(s)
        dt = datetime.fromtimestamp(epoch, tz=timezone.utc).replace(tzinfo=None)
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        pass

    # 2. ISO-8601 family (T separator, Z suffix, ±HH:MM offset, microseconds)
    iso = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        pass

    # 3. strptime patterns
    for pattern in _TS_PATTERNS:
        try:
            return datetime.strptime(s, pattern).strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue

    raise ValueError(f"Unrecognised timestamp format: '{s}'")


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
    _catalogue_etag.cache_clear()


@lru_cache(maxsize=1)
def _catalogue_etag() -> str:
    """Fingerprint of the timeseries catalogue; every write path calls
    _reload_catalogue(), which also clears this cache."""
    import hashlib
    payload = json.dumps(_load_catalogue(), sort_keys=True).encode()
    return f'"{hashlib.md5(payload).hexdigest()}"'


def _etag_precheck(request: Request, response: Response, etag: str) -> Response | None:
    """304 when If-None-Match matches; otherwise stamp ETag and return None."""
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    response.headers["ETag"] = etag
    return None


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
    request:  Request,
    response: Response,
    skip:       Annotated[int, Query(ge=0, description="Offset for pagination")]   = 0,
    limit:      Annotated[int, Query(ge=1, le=5000, description="Max items to return")] = 50,
    type:       Annotated[str | None, Query(description="Filter by profile type (e.g. capacity_factor, load)")] = None,
    resolution: Annotated[str | None, Query(description="Filter by temporal resolution (e.g. hourly)")] = None,
    location:   Annotated[str | None, Query(description="Filter by location code (e.g. DE, FR)")] = None,
    carrier:    Annotated[str | None, Query(description="Filter by energy carrier")] = None,
) -> TimeSeriesCatalogueResponse | Response:
    sb = _ts_sb()
    if sb:
        try:
            profiles = _sb_list_profiles(type_=type, resolution=resolution, location=location, carrier=carrier)
            total = len(profiles)
            page  = profiles[skip : skip + limit]
            return TimeSeriesCatalogueResponse(total=total, profiles=page, has_more=skip + limit < total)
        except Exception as exc:
            logger.warning("Supabase list_profiles failed, falling back to filesystem: %s", exc)

    # Filesystem fallback
    if (not_modified := _etag_precheck(request, response, _catalogue_etag())) is not None:
        return not_modified
    profiles = _load_catalogue()
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
    return TimeSeriesCatalogueResponse(total=total, profiles=page, has_more=skip + limit < total)


@router.get(
    "/{profile_id}/data",
    response_model=TimeSeriesDataResponse,
    summary="Fetch data points for a single profile",
    response_description="Time series with one {timestamp, value} pair per row; "
                         "optionally windowed (start/end) and downsampled (max_points).",
)
def get_profile_data(
    request:  Request,
    response: Response,
    profile_id: str,
    start: Annotated[str | None, Query(description="Return only points at/after this timestamp (any common format).")] = None,
    end:   Annotated[str | None, Query(description="Return only points at/before this timestamp (any common format).")] = None,
    max_points: Annotated[
        int | None,
        Query(ge=2, description="Downsample by uniform striding to at most this many points (for previews/plots)."),
    ] = None,
) -> TimeSeriesDataResponse | Response:
    if not re.fullmatch(r"[a-z0-9_\-]+", profile_id):
        raise HTTPException(status_code=400, detail="Invalid profile_id format.")

    sb = _ts_sb()
    if sb:
        data = _sb_get_profile(profile_id)
        if data is None:
            raise HTTPException(status_code=404, detail=f"Profile '{profile_id}' not found.")
    else:
        data_path = _DATA_DIR / f"{profile_id}.json"
        if not data_path.exists():
            raise HTTPException(status_code=404, detail=f"Profile '{profile_id}' not found.")
        import hashlib
        etag = f'"{hashlib.md5(f"{profile_id}:{data_path.stat().st_mtime_ns}".encode()).hexdigest()}"'
        if (not_modified := _etag_precheck(request, response, etag)) is not None:
            return not_modified
        data = _load_profile_data(profile_id)
        if data is None:
            raise HTTPException(status_code=404, detail=f"Profile '{profile_id}' not found.")

    points = data["points"]
    n_total = len(points)

    # Window by timestamp. Stored formats vary between profiles (ISO-8601
    # with T/Z vs "YYYY-MM-DD HH:MM:SS"), so compare as datetimes, not strings.
    def _point_dt(ts: str) -> datetime | None:
        try:
            dt = datetime.fromisoformat(ts.strip().replace(" ", "T").replace("Z", "+00:00"))
        except ValueError:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt

    try:
        if start is not None:
            start_dt = datetime.strptime(_parse_timestamp(start), "%Y-%m-%d %H:%M:%S")
            points = [p for p in points if (dt := _point_dt(p["timestamp"])) is None or dt >= start_dt]
        if end is not None:
            end_dt = datetime.strptime(_parse_timestamp(end), "%Y-%m-%d %H:%M:%S")
            points = [p for p in points if (dt := _point_dt(p["timestamp"])) is None or dt <= end_dt]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    downsampled = False
    if max_points is not None and len(points) > max_points:
        stride = (len(points) + max_points - 1) // max_points
        points = points[::stride]
        downsampled = True

    return TimeSeriesDataResponse(
        profile_id     = data["profile_id"],
        name           = data["name"],
        unit           = data["unit"],
        points         = points,
        n_points_total = n_total,
        downsampled    = downsampled,
    )


# ---------------------------------------------------------------------------
# Admin: edit profile metadata
# ---------------------------------------------------------------------------

class ProfileMetadataUpdate(BaseModel):
    name:        str | None = None
    type:        str | None = None
    resolution:  str | None = None
    location:    str | None = None
    source:      str | None = None
    carrier:     str | None = None
    year:        int | None = None
    unit:        str | None = None
    description: str | None = None


@router.patch(
    "/{profile_id}",
    summary="Update profile metadata (admin only)",
)
def update_profile_metadata(
    profile_id:    str,
    body:          ProfileMetadataUpdate,
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    from api.routes import _require_admin  # noqa: PLC0415
    _require_admin(authorization)

    if not re.fullmatch(r"[a-z0-9_\-]+", profile_id):
        raise HTTPException(status_code=400, detail="Invalid profile_id format.")
    if body.type is not None and body.type not in _ALLOWED_TYPES:
        raise HTTPException(status_code=422, detail=f"Invalid type. Allowed: {sorted(_ALLOWED_TYPES)}")
    if body.resolution is not None and body.resolution not in _ALLOWED_RESOLUTIONS:
        raise HTTPException(status_code=422, detail=f"Invalid resolution. Allowed: {sorted(_ALLOWED_RESOLUTIONS)}")

    update_data = body.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(status_code=422, detail="No fields to update.")

    sb = _ts_sb()
    if sb:
        updated = _sb_update_profile_meta(profile_id, update_data)
        if updated is None:
            raise HTTPException(status_code=404, detail=f"Profile '{profile_id}' not found.")
        # Return without points (metadata only)
        updated.pop("points", None)
        return updated

    # Filesystem fallback
    if not _CATALOGUE_FILE.exists():
        raise HTTPException(status_code=404, detail=f"Profile '{profile_id}' not found.")
    with _CATALOGUE_FILE.open(encoding="utf-8") as fh:
        catalogue_doc = json.load(fh)
    profiles = catalogue_doc.get("profiles", [])
    idx = next((i for i, p in enumerate(profiles) if p.get("profile_id") == profile_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Profile '{profile_id}' not found.")
    profiles[idx].update(update_data)
    if "unit" in update_data:
        data_path = _DATA_DIR / f"{profile_id}.json"
        if data_path.exists():
            with data_path.open(encoding="utf-8") as fh:
                data_file = json.load(fh)
            data_file["unit"] = update_data["unit"]
            with data_path.open("w", encoding="utf-8") as fh:
                json.dump(data_file, fh)
    with _CATALOGUE_FILE.open("w", encoding="utf-8") as fh:
        json.dump(catalogue_doc, fh, indent=2)
    _reload_catalogue()
    return profiles[idx]


# ---------------------------------------------------------------------------
# Admin: replace data points
# ---------------------------------------------------------------------------

class _DataPointIn(BaseModel):
    timestamp: str
    value:     float


class ProfileDataReplaceBody(BaseModel):
    points: list[_DataPointIn]


@router.put(
    "/{profile_id}/data",
    summary="Replace all data points for a profile (admin only)",
)
def replace_profile_data(
    profile_id:    str,
    body:          ProfileDataReplaceBody,
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    from api.routes import _require_admin  # noqa: PLC0415
    _require_admin(authorization)

    if not re.fullmatch(r"[a-z0-9_\-]+", profile_id):
        raise HTTPException(status_code=400, detail="Invalid profile_id format.")
    if len(body.points) < 2:
        raise HTTPException(status_code=422, detail="Must supply at least 2 data points.")

    new_points = [{"timestamp": p.timestamp, "value": round(p.value, 6)} for p in body.points]

    sb = _ts_sb()
    if sb:
        if _sb_get_profile(profile_id) is None:
            raise HTTPException(status_code=404, detail=f"Data file for '{profile_id}' not found.")
        _sb_replace_profile_points(profile_id, new_points)
    else:
        data_path = _DATA_DIR / f"{profile_id}.json"
        if not data_path.exists():
            raise HTTPException(status_code=404, detail=f"Data file for '{profile_id}' not found.")
        with data_path.open(encoding="utf-8") as fh:
            existing = json.load(fh)
        existing["points"] = new_points
        with data_path.open("w", encoding="utf-8") as fh:
            json.dump(existing, fh)
        if _CATALOGUE_FILE.exists():
            with _CATALOGUE_FILE.open(encoding="utf-8") as fh:
                catalogue_doc = json.load(fh)
            profiles = catalogue_doc.get("profiles", [])
            ci = next((i for i, p in enumerate(profiles) if p.get("profile_id") == profile_id), None)
            if ci is not None:
                profiles[ci]["n_timesteps"] = len(new_points)
                with _CATALOGUE_FILE.open("w", encoding="utf-8") as fh:
                    json.dump(catalogue_doc, fh, indent=2)
            _reload_catalogue()

    return {"profile_id": profile_id, "n_timesteps": len(new_points)}


@router.post(
    "/upload",
    response_model=TimeSeriesUploadResponse,
    status_code=202,
    summary="Submit a new time-series profile for admin review",
    response_description="Confirmation with assigned submission_id — profile is pending review.",
)
@_limiter.limit("10/minute")
async def upload_profile(
    request: Request,
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
                norm_ts = _parse_timestamp(str(ts))
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=f"Row {idx}: {exc}") from exc
            try:
                points.append({"timestamp": norm_ts, "value": round(float(val), 6)})
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail=f"Row {idx}: value '{val}' is not a number.")
    else:
        # Auto-detect delimiter (comma, semicolon, tab, pipe)
        sniffer = csv.Sniffer()
        try:
            dialect = sniffer.sniff(text[:4096], delimiters=",;\t|")
            delimiter = dialect.delimiter
        except csv.Error:
            delimiter = ","
        reader = csv.reader(io.StringIO(text), delimiter=delimiter)
        for row_num, row in enumerate(reader, start=1):
            if not row or row[0].strip().lower() in {"timestamp", "time", "datetime", "date"}:
                continue
            if len(row) < 2:
                raise HTTPException(status_code=422, detail=f"Row {row_num}: expected 2 columns, got {len(row)}.")
            try:
                norm_ts = _parse_timestamp(row[0].strip())
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=f"Row {row_num}: {exc}") from exc
            try:
                value = float(row[1].strip())
            except ValueError:
                raise HTTPException(status_code=422, detail=f"Row {row_num}: value '{row[1].strip()}' is not a number.")
            points.append({"timestamp": norm_ts, "value": round(value, 6)})

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
    now_str       = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    stats         = _compute_stats(points)

    record: dict = {
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
        "stats":           stats.model_dump() if stats else None,
    }

    # --- Persist ---
    sb = _ts_sb()
    if sb:
        _sb_insert_submission(record)
    else:
        _PENDING_DIR.mkdir(parents=True, exist_ok=True)
        pending_path = _PENDING_DIR / f"{submission_id}.json"
        with pending_path.open("w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=2)

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
    summary="Delete a time-series profile (admin only)",
    response_description="Profile metadata and data file removed.",
)
def delete_profile(
    profile_id:    str,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """
    Remove a profile from the catalogue index and delete its data file.
    """
    from api.routes import _require_admin  # noqa: PLC0415
    _require_admin(authorization)

    safe_id = re.sub(r"[^a-z0-9_\-]", "", profile_id)
    if safe_id != profile_id:
        raise HTTPException(status_code=422, detail="Invalid profile_id format.")

    sb = _ts_sb()
    if sb:
        if _sb_get_profile(safe_id) is None:
            raise HTTPException(status_code=404, detail=f"Profile '{safe_id}' not found.")
        _sb_delete_profile(safe_id)
    else:
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

    sb = _ts_sb()
    if sb:
        try:
            rows = _sb_list_submissions(status)
            return [
                ProfileSubmissionRecord(
                    submission_id    = r["submission_id"],
                    name             = r.get("name", "—"),
                    type             = r.get("type", ""),
                    resolution       = r.get("resolution", ""),
                    location         = r.get("location", ""),
                    source           = r.get("source", ""),
                    carrier          = r.get("carrier", ""),
                    year             = r.get("year", 0),
                    unit             = r.get("unit", ""),
                    description      = r.get("description", ""),
                    n_timesteps      = r.get("n_timesteps", 0),
                    submitted_at     = r.get("submitted_at", ""),
                    submitter_email  = r.get("submitter_email"),
                    status           = r.get("status", "pending_review"),
                    rejection_reason = r.get("rejection_reason"),
                    stats            = r.get("stats"),
                )
                for r in rows
            ]
        except Exception as exc:
            logger.warning("Supabase submissions query failed, falling back to filesystem: %s", exc)

    # Filesystem fallback
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

    sb = _ts_sb()
    if sb:
        try:
            row = _sb_get_submission(safe_id)
            if row is not None:
                return {"submission_id": safe_id, "name": row.get("name",""), "unit": row.get("unit",""), "points": row.get("points", [])}
        except Exception as exc:
            logger.warning("Supabase submission data query failed, falling back to filesystem: %s", exc)

    path = _PENDING_DIR / f"{safe_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Submission not found.")
    with path.open(encoding="utf-8") as fh:
        raw = json.load(fh)
    return {"submission_id": safe_id, "name": raw.get("name",""), "unit": raw.get("unit",""), "points": raw.get("points", [])}


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

    sb = _ts_sb()
    if sb:
        try:
            if body.action == "approve":
                profile_id = _sb_approve_submission(safe_id, admin_email)
                logger.info("Admin approved profile submission %s → %s", safe_id, profile_id)
                return {"status": "approved", "submission_id": safe_id, "profile_id": profile_id}
            else:
                _sb_reject_submission(safe_id, admin_email, body.reason)
                logger.info("Admin rejected profile submission %s", safe_id)
                return {"status": "rejected", "submission_id": safe_id}
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("Supabase act_on_submission failed, falling back to filesystem: %s", exc)

    # Filesystem fallback
    path = _PENDING_DIR / f"{safe_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Submission not found.")
    with path.open(encoding="utf-8") as fh:
        record = json.load(fh)
    if record.get("status") != "pending_review":
        raise HTTPException(status_code=409, detail=f"Submission already {record['status']}.")

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    if body.action == "approve":
        profile_id            = _approve_profile_submission(record)
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


@admin_ts_router.post(
    "/pipeline/run",
    status_code=202,
    summary="Trigger the timeseries acquisition pipeline (admin only)",
)
def trigger_timeseries_pipeline(
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    """Start the timeseries acquisition pipeline in a background thread."""
    from threading import Thread
    _require_admin(authorization)

    def _run() -> None:
        try:
            from timeseries_scraper import pipeline  # noqa: PLC0415
            pipeline.run()
        except Exception as exc:
            logger.error("Timeseries pipeline error: %s", exc, exc_info=True)

    Thread(target=_run, daemon=True, name="ts-pipeline").start()
    return {"status": "started", "message": "Timeseries pipeline triggered in background."}

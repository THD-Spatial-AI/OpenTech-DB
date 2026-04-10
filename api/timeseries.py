"""
api/timeseries.py
=================
FastAPI router for the Time Series & Profiles catalogue.

Endpoints
---------
GET  /timeseries                         → list catalogue metadata (paginated)
GET  /timeseries/{profile_id}/data       → full data points for one profile
POST /timeseries/upload                  → contributor upload (multipart CSV)

Data is stored as JSON in  data/timeseries/:
  timeseries_catalogue.json              – profile metadata (no raw values)
  {profile_id}.json                      – per-profile data file

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

_DATA_DIR      = Path(__file__).resolve().parent.parent / "data" / "timeseries"
_CATALOGUE_FILE = _DATA_DIR / "timeseries_catalogue.json"

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
    profile_id:  str
    name:        str
    n_timesteps: int
    status:      str = "stored"


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
    status_code=201,
    summary="Upload a new time-series profile (CSV)",
    response_description="Confirmation with assigned profile_id.",
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
    Accept a CSV file where every row is ``timestamp,value``.
    A header row is optional — if the first cell is not a valid ISO-8601
    timestamp it is treated as a header and skipped.

    The profile is stored immediately as a JSON data file and its metadata
    is appended to the catalogue.  No admin review is required for
    time-series uploads.
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
        # ── JSON format ──────────────────────────────────────────────
        # Accepted shapes:
        #   1. Array of {timestamp, value} objects
        #   2. {points: [{timestamp, value}, ...]}
        #   3. Array of [timestamp, value] two-element arrays
        #   4. Object mapping ISO timestamp → numeric value
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail=f"JSON parse error: {exc}") from exc

        if isinstance(parsed, dict) and "points" in parsed:
            rows = parsed["points"]
        elif isinstance(parsed, list):
            rows = parsed
        elif isinstance(parsed, dict):
            # mapping {timestamp: value}
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
        # ── CSV format (default) ──────────────────────────────────────
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

    # --- Build profile_id ---
    safe_name  = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:40]
    short_id   = str(_uuid_mod.uuid4())[:8]
    profile_id = f"{safe_name}_{short_id}"

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # --- Write data file ---
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    data_path = _DATA_DIR / f"{profile_id}.json"
    with data_path.open("w", encoding="utf-8") as fh:
        json.dump(
            {"profile_id": profile_id, "name": name, "unit": unit, "points": points},
            fh,
        )

    # --- Update catalogue ---
    catalogue_entry: dict = {
        "profile_id":  profile_id,
        "name":        name,
        "type":        type,
        "resolution":  resolution,
        "location":    location.upper(),
        "source":      source,
        "carrier":     carrier,
        "year":        year,
        "n_timesteps": len(points),
        "description": description,
        "uploaded_at": now_str,
        "unit":        unit,
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
    logger.info("Timeseries upload: %s (%d points)", profile_id, len(points))

    return TimeSeriesUploadResponse(
        profile_id  = profile_id,
        name        = name,
        n_timesteps = len(points),
        status      = "stored",
    )

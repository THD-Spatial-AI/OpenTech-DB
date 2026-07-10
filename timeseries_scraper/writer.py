from __future__ import annotations
import json
import logging
import re as _re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .base import ProfileDraft
from .normaliser import compute_stats

logger = logging.getLogger(__name__)

_DATA_DIR       = Path(__file__).resolve().parent.parent / "data" / "timeseries"
_CATALOGUE_FILE = _DATA_DIR / "timeseries_catalogue.json"
_PENDING_DIR    = _DATA_DIR / "pending"


# ---------------------------------------------------------------------------
# Supabase helper
# ---------------------------------------------------------------------------

def _get_sb():
    """Return a Supabase service-role client, or None when not configured."""
    try:
        from api._auth_helpers import _get_sb as _auth_sb  # noqa: PLC0415
        return _auth_sb()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Supabase deduplication checks
# ---------------------------------------------------------------------------

def _sb_is_approved(location: str, carrier: str, year: int, typ: str, source_name: str | None) -> bool:
    sb = _get_sb()
    if not sb:
        return False
    try:
        q = (sb.table("timeseries_profiles")
               .select("profile_id")
               .eq("location", location)
               .eq("carrier", carrier)
               .eq("year", year)
               .eq("type", typ))
        if source_name:
            q = q.eq("source_name", source_name)
        return bool(q.execute().data)
    except Exception as exc:
        logger.warning("Supabase approved-check failed: %s", exc)
        return False


def _sb_is_pending(location: str, carrier: str, year: int, typ: str, source_name: str | None) -> bool:
    sb = _get_sb()
    if not sb:
        return False
    try:
        q = (sb.table("timeseries_submissions")
               .select("submission_id")
               .eq("location", location)
               .eq("carrier", carrier)
               .eq("year", year)
               .eq("type", typ)
               .neq("status", "rejected"))
        if source_name:
            q = q.eq("source_name", source_name)
        return bool(q.execute().data)
    except Exception as exc:
        logger.warning("Supabase pending-check failed: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Filesystem deduplication checks (local dev fallback)
# ---------------------------------------------------------------------------

def _fs_approved_fingerprints() -> set[tuple]:
    if not _CATALOGUE_FILE.exists():
        return set()
    with _CATALOGUE_FILE.open(encoding="utf-8") as fh:
        doc = json.load(fh)
    return {
        (p.get("location", "").upper(), p.get("carrier", ""), p.get("year", 0),
         p.get("type", ""), p.get("source_name"))
        for p in doc.get("profiles", [])
    }


def _fs_pending_fingerprints() -> set[tuple]:
    if not _PENDING_DIR.exists():
        return set()
    fps: set[tuple] = set()
    for path in _PENDING_DIR.glob("*.json"):
        try:
            with path.open(encoding="utf-8") as fh:
                rec = json.load(fh)
            if rec.get("status", "pending_review") == "rejected":
                continue
            sub_by = rec.get("submitted_by") or ""
            src = sub_by.split("/")[-1] if sub_by else rec.get("source_name")
            fps.add((rec.get("location", "").upper(), rec.get("carrier", ""),
                     rec.get("year", 0), rec.get("type", ""), src))
        except Exception:
            pass
    return fps


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def write_pending(draft: ProfileDraft, dry_run: bool = False) -> str | None:
    """Write a ProfileDraft as a pending submission.

    Returns the submission_id, "dry-run", or None when skipped (duplicate).
    Uses Supabase when configured, falls back to filesystem.
    """
    loc = draft.location.upper()
    sb  = _get_sb()

    # Deduplication
    if sb:
        if _sb_is_approved(loc, draft.carrier, draft.year, draft.type, draft.source_name):
            logger.debug("skip (approved): %s %s %s", loc, draft.carrier, draft.year)
            return None
        if _sb_is_pending(loc, draft.carrier, draft.year, draft.type, draft.source_name):
            logger.debug("skip (pending):  %s %s %s", loc, draft.carrier, draft.year)
            return None
    else:
        fp = (loc, draft.carrier, draft.year, draft.type, draft.source_name)
        if fp in _fs_approved_fingerprints():
            logger.debug("skip (approved): %s %s %s", loc, draft.carrier, draft.year)
            return None
        if fp in _fs_pending_fingerprints():
            logger.debug("skip (pending):  %s %s %s", loc, draft.carrier, draft.year)
            return None

    if dry_run:
        logger.info("[dry-run] would write: %s", draft.name)
        return "dry-run"

    submission_id = str(uuid.uuid4())
    now_str       = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    stats         = compute_stats(draft.points)

    # Supabase path
    if sb:
        try:
            sb.table("timeseries_submissions").insert({
                "submission_id":   submission_id,
                "submitted_at":    now_str,
                "status":          "pending_review",
                "source_name":     draft.source_name,
                "submitter_email": None,
                "name":            draft.name,
                "type":            draft.type,
                "resolution":      draft.resolution,
                "location":        loc,
                "source":          draft.source,
                "carrier":         draft.carrier,
                "year":            draft.year,
                "unit":            draft.unit,
                "description":     draft.description,
                "n_timesteps":     len(draft.points),
                "points":          draft.points,
                "stats":           stats,
            }).execute()
            logger.info("pending (Supabase): %s (%d pts)", draft.name, len(draft.points))
            return submission_id
        except Exception as exc:
            logger.error("Supabase write failed, falling back to filesystem: %s", exc)

    # Filesystem fallback
    record = {
        "submission_id":   submission_id,
        "submitted_at":    now_str,
        "status":          "pending_review",
        "submitted_by":    f"timeseries_pipeline/{draft.source_name}",
        "source_name":     draft.source_name,
        "submitter_email": None,
        "name":            draft.name,
        "type":            draft.type,
        "resolution":      draft.resolution,
        "location":        loc,
        "source":          draft.source,
        "carrier":         draft.carrier,
        "year":            draft.year,
        "unit":            draft.unit,
        "description":     draft.description,
        "n_timesteps":     len(draft.points),
        "points":          draft.points,
        "stats":           stats,
    }
    _PENDING_DIR.mkdir(parents=True, exist_ok=True)
    out = _PENDING_DIR / f"{submission_id}.json"
    with out.open("w", encoding="utf-8") as fh:
        json.dump(record, fh)
    logger.info("pending (file): %s (%d pts) → %s", draft.name, len(draft.points), out.name)
    return submission_id


def approve_pending(submission_id: str) -> str | None:
    """Approve a pending submission, promoting it to the catalogue. Returns profile_id or None."""
    safe = _re.sub(r"[^a-z0-9\-]", "", submission_id)
    sb   = _get_sb()

    if sb:
        try:
            res = sb.table("timeseries_submissions").select("*").eq("submission_id", safe).execute()
            if not res.data:
                logger.warning("approve: submission %s not found in Supabase", safe)
                return None
            record     = res.data[0]
            safe_name  = _re.sub(r"[^a-z0-9]+", "_", record["name"].lower()).strip("_")[:40]
            profile_id = f"{safe_name}_{safe[:8]}"
            now_str    = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

            sb.table("timeseries_profiles").upsert({
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

            sb.table("timeseries_submissions").update({
                "status":      "approved",
                "profile_id":  profile_id,
                "reviewed_at": now_str,
            }).eq("submission_id", safe).execute()

            logger.info("approved (Supabase): %s → %s", record["name"], profile_id)
            return profile_id
        except Exception as exc:
            logger.error("Supabase approve failed: %s", exc)
            return None

    # Filesystem fallback
    path = _PENDING_DIR / f"{safe}.json"
    if not path.exists():
        logger.warning("approve: submission %s not found", safe)
        return None

    with path.open(encoding="utf-8") as fh:
        record = json.load(fh)

    safe_name  = _re.sub(r"[^a-z0-9]+", "_", record["name"].lower()).strip("_")[:40]
    profile_id = f"{safe_name}_{safe[:8]}"
    now_str    = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    data_path = _DATA_DIR / f"{profile_id}.json"
    with data_path.open("w", encoding="utf-8") as fh:
        json.dump({"profile_id": profile_id, "name": record["name"],
                   "unit": record["unit"], "points": record["points"]}, fh)

    if _CATALOGUE_FILE.exists():
        with _CATALOGUE_FILE.open(encoding="utf-8") as fh:
            cat = json.load(fh)
    else:
        cat = {"version": "2.0.0", "profiles": []}

    cat.setdefault("profiles", []).append({
        "profile_id":  profile_id,
        "name":        record["name"],
        "type":        record["type"],
        "resolution":  record["resolution"],
        "location":    record["location"],
        "source":      record["source"],
        "source_name": record.get("source_name") or (record.get("submitted_by","").split("/")[-1] or None),
        "carrier":     record["carrier"],
        "year":        record.get("year", 0),
        "n_timesteps": record["n_timesteps"],
        "description": record.get("description", ""),
        "uploaded_at": now_str,
        "unit":        record["unit"],
    })
    with _CATALOGUE_FILE.open("w", encoding="utf-8") as fh:
        json.dump(cat, fh, indent=2)

    record.update({"status": "approved", "profile_id": profile_id, "reviewed_at": now_str})
    with path.open("w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2)

    logger.info("approved (file): %s → %s", record["name"], profile_id)
    return profile_id

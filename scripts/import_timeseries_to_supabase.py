"""
Import pending timeseries profile files from the filesystem into Supabase.

Run this once after applying migration 010_timeseries_tables.sql to move the
locally-stored pending submissions into the timeseries_submissions table.

Usage:
    python scripts/import_timeseries_to_supabase.py [--dry-run]

Prerequisites:
    SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment
    (or in a .env file loaded by dotenv).
"""
from __future__ import annotations
import argparse
import json
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger(__name__)

_PENDING_DIR    = Path(__file__).resolve().parent.parent / "data" / "timeseries" / "pending"
_CATALOGUE_FILE = Path(__file__).resolve().parent.parent / "data" / "timeseries" / "timeseries_catalogue.json"


def _get_sb():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
        sys.exit(1)
    try:
        from supabase import create_client
        return create_client(url, key)
    except ImportError:
        logger.error("supabase package not installed. Run: pip install supabase")
        sys.exit(1)


def import_pending(dry_run: bool = False) -> None:
    """Import all pending JSON files from data/timeseries/pending/ into timeseries_submissions."""
    if not _PENDING_DIR.exists():
        logger.info("No pending directory found at %s — nothing to import.", _PENDING_DIR)
        return

    files = sorted(_PENDING_DIR.glob("*.json"))
    if not files:
        logger.info("No pending files found in %s.", _PENDING_DIR)
        return

    logger.info("Found %d pending files in %s", len(files), _PENDING_DIR)
    sb = None if dry_run else _get_sb()

    # Fetch existing submission_ids to skip duplicates
    existing_ids: set[str] = set()
    if sb:
        try:
            res = sb.table("timeseries_submissions").select("submission_id").execute()
            existing_ids = {r["submission_id"] for r in (res.data or [])}
            logger.info("Supabase already has %d submissions — duplicates will be skipped.", len(existing_ids))
        except Exception as exc:
            logger.error("Could not query timeseries_submissions: %s", exc)
            logger.error("Have you run migration 010_timeseries_tables.sql?")
            sys.exit(1)

    inserted = skipped = errors = 0
    for path in files:
        try:
            with path.open(encoding="utf-8") as fh:
                raw = json.load(fh)
        except Exception as exc:
            logger.warning("Could not read %s: %s", path.name, exc)
            errors += 1
            continue

        sid = raw.get("submission_id", path.stem)
        if sid in existing_ids:
            logger.debug("skip (already in Supabase): %s", sid)
            skipped += 1
            continue

        # Build the Supabase record — map old filesystem field names to new schema
        source_name = raw.get("source_name") or (raw.get("submitted_by", "").split("/")[-1] or None)
        record = {
            "submission_id":   sid,
            "name":            raw.get("name", ""),
            "type":            raw.get("type", ""),
            "resolution":      raw.get("resolution", ""),
            "location":        raw.get("location", ""),
            "source":          raw.get("source", ""),
            "source_name":     source_name,
            "carrier":         raw.get("carrier", ""),
            "year":            raw.get("year", 0),
            "unit":            raw.get("unit", "p.u."),
            "description":     raw.get("description", ""),
            "n_timesteps":     raw.get("n_timesteps", 0),
            "submitted_at":    raw.get("submitted_at", ""),
            "submitter_email": raw.get("submitter_email"),
            "status":          raw.get("status", "pending_review"),
            "rejection_reason":raw.get("rejection_reason"),
            "reviewed_at":     raw.get("reviewed_at"),
            "reviewed_by":     raw.get("reviewed_by"),
            "profile_id":      raw.get("profile_id"),
            "points":          raw.get("points", []),
            "stats":           raw.get("stats"),
        }
        # Remove None values for reviewed_at/reviewed_by (Supabase prefers omission)
        record = {k: v for k, v in record.items() if v is not None or k in ("submission_id", "name", "points")}

        if dry_run:
            logger.info("[dry-run] would insert: %s  %s (%d pts)", sid[:8], raw.get("name",""), raw.get("n_timesteps", 0))
            inserted += 1
            continue

        try:
            sb.table("timeseries_submissions").insert(record).execute()
            logger.info("inserted: %s  %s", sid[:8], raw.get("name",""))
            inserted += 1
        except Exception as exc:
            logger.error("Failed to insert %s: %s", sid[:8], exc)
            errors += 1

    logger.info(
        "\n%s complete — inserted: %d  skipped: %d  errors: %d",
        "Dry run" if dry_run else "Import",
        inserted, skipped, errors,
    )


def import_catalogue(dry_run: bool = False) -> None:
    """Import approved profiles from timeseries_catalogue.json into timeseries_profiles."""
    if not _CATALOGUE_FILE.exists():
        logger.info("No catalogue file found at %s — nothing to import.", _CATALOGUE_FILE)
        return

    with _CATALOGUE_FILE.open(encoding="utf-8") as fh:
        doc = json.load(fh)

    profiles_meta = doc.get("profiles", [])
    if not profiles_meta:
        logger.info("Catalogue is empty.")
        return

    logger.info("Found %d approved profiles in catalogue", len(profiles_meta))
    sb = None if dry_run else _get_sb()

    existing_ids: set[str] = set()
    if sb:
        try:
            res = sb.table("timeseries_profiles").select("profile_id").execute()
            existing_ids = {r["profile_id"] for r in (res.data or [])}
        except Exception as exc:
            logger.error("Could not query timeseries_profiles: %s", exc)
            sys.exit(1)

    inserted = skipped = errors = 0
    data_dir = _CATALOGUE_FILE.parent

    for meta in profiles_meta:
        pid = meta.get("profile_id", "")
        if not pid:
            continue
        if pid in existing_ids:
            skipped += 1
            continue

        # Load the data file
        data_path = data_dir / f"{pid}.json"
        if not data_path.exists():
            logger.warning("Data file missing for %s — skipping", pid)
            errors += 1
            continue

        try:
            with data_path.open(encoding="utf-8") as fh:
                data_file = json.load(fh)
        except Exception as exc:
            logger.warning("Could not read data file for %s: %s", pid, exc)
            errors += 1
            continue

        record = {
            "profile_id":  pid,
            "name":        meta.get("name", ""),
            "type":        meta.get("type", ""),
            "resolution":  meta.get("resolution", ""),
            "location":    meta.get("location", ""),
            "source":      meta.get("source", ""),
            "source_name": meta.get("source_name"),
            "carrier":     meta.get("carrier", ""),
            "year":        meta.get("year", 0),
            "n_timesteps": meta.get("n_timesteps", 0),
            "description": meta.get("description", ""),
            "uploaded_at": meta.get("uploaded_at", ""),
            "unit":        meta.get("unit", "p.u."),
            "points":      data_file.get("points", []),
        }

        if dry_run:
            logger.info("[dry-run] would insert profile: %s  (%d pts)", pid, len(record["points"]))
            inserted += 1
            continue

        try:
            sb.table("timeseries_profiles").insert(record).execute()
            logger.info("inserted profile: %s", pid)
            inserted += 1
        except Exception as exc:
            logger.error("Failed to insert profile %s: %s", pid, exc)
            errors += 1

    logger.info(
        "\n%s complete — profiles inserted: %d  skipped: %d  errors: %d",
        "Dry run" if dry_run else "Import",
        inserted, skipped, errors,
    )


if __name__ == "__main__":
    # Load .env if python-dotenv is available
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv()
    except ImportError:
        pass

    parser = argparse.ArgumentParser(description="Import timeseries data from filesystem into Supabase")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be imported without writing")
    parser.add_argument("--skip-pending",  action="store_true", help="Skip importing pending submissions")
    parser.add_argument("--skip-approved", action="store_true", help="Skip importing approved catalogue profiles")
    args = parser.parse_args()

    if not args.skip_pending:
        logger.info("=== Importing pending submissions ===")
        import_pending(dry_run=args.dry_run)

    if not args.skip_approved:
        logger.info("\n=== Importing approved catalogue profiles ===")
        import_catalogue(dry_run=args.dry_run)

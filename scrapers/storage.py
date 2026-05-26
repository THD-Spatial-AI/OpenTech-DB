"""
scrapers/storage.py
====================
Candidate and run-log storage.

Backend selection
-----------------
* **Supabase** (primary) — used when ``SUPABASE_URL`` and
  ``SUPABASE_SERVICE_ROLE_KEY`` environment variables are set.
  Candidates go into the ``scraper_candidates`` table; run metadata
  goes into ``scraper_runs``.  Run the migration in
  ``db/migrations/001_scraper_tables.sql`` once inside Supabase.

* **File fallback** — when Supabase is not configured (local dev / CI),
  candidates are written to ``data/scraped/candidates/{status}/``.
  This directory is in ``.gitignore`` so it never enters the repo.

The public API of :class:`CandidateStore` is identical in both modes.

(Legacy directory layout, kept for reference)
data/scraped/
├── raw/              Raw API responses (one JSON per run+source+technology)
├── candidates/
│   ├── pending/      NEW candidates awaiting review
│   ├── approved/     Approved candidates (after merge into main DB)
│   └── rejected/     Rejected candidates (kept for audit)
└── runs/
    └── run_log.json  History of pipeline runs

Candidate JSON schema
---------------------
{
  "candidate_id":   "uuid4 string",
  "scraped_at":     "ISO-8601 UTC datetime",
  "status":         "pending|approved|rejected",
  "technology_id":  "ccgt",
  "source":         "open_alex",
  "paper_doi":      "10.1016/j.energy.2024.01.001",
  "paper_title":    "...",
  "paper_year":     2024,
  "paper_url":      "https://...",
  "paper_venue":    "Applied Energy",
  "paper_authors":  ["Author One", "Author Two"],
  "extracted_params": {
    "capex_usd_per_kw": {
      "value": 850.0, "unit": "USD/kW",
      "context": "...surrounding text...",
      "confidence": 0.88
    },
    ...
  },
  "proposed_instance": {
    "instance_id":   "ccgt_850kw_2024_scraped",
    "instance_name": "CCGT – 850 $/kW (scraped 2024 from doi:...)",
    ...
  },
  "review_notes":   "",
  "reviewed_at":    null,
  "reviewed_by":    null
}
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class CandidateStatus(str, Enum):
    PENDING  = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def _get_supabase_client():
    """Return a Supabase service-role client, or None if not configured."""
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return None
    try:
        from supabase import create_client
        return create_client(url, key)
    except Exception as exc:
        logger.warning("Could not create Supabase client: %s", exc)
        return None


class CandidateStore:
    """
    Read/write interface for scraper candidates.

    Uses Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set,
    otherwise falls back to flat JSON files in data/scraped/ (local dev).
    """

    def __init__(self, base_dir: Path) -> None:
        # File-backend paths (always kept; used as fallback)
        self._pending  = base_dir / "candidates" / "pending"
        self._approved = base_dir / "candidates" / "approved"
        self._rejected = base_dir / "candidates" / "rejected"
        self._runs     = base_dir / "runs"
        for d in (self._pending, self._approved, self._rejected, self._runs):
            d.mkdir(parents=True, exist_ok=True)

        # Supabase client (None → file backend)
        self._sb = _get_supabase_client()
        if self._sb:
            logger.info("CandidateStore: using Supabase backend")
        else:
            logger.info(
                "CandidateStore: Supabase not configured — "
                "using file backend (data/scraped/).  "
                "Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to persist in the database."
            )

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def save_candidate(self, candidate: dict[str, Any]) -> str:
        """Persist a new candidate (status=pending). Returns candidate_id."""
        cid = candidate.setdefault("candidate_id", str(uuid.uuid4()))
        candidate.setdefault("status", CandidateStatus.PENDING.value)
        candidate.setdefault("scraped_at", datetime.now(timezone.utc).isoformat())
        if self._sb:
            self._sb_save(candidate)
        else:
            _atomic_write(self._pending / f"{cid}.json", candidate)
        logger.debug("Saved candidate %s for tech=%s", cid, candidate.get("technology_id"))
        return cid

    def update_status(
        self,
        candidate_id: str,
        status: CandidateStatus,
        review_notes: str = "",
        reviewed_by: str | None = None,
    ) -> dict[str, Any] | None:
        """Change the review status of a candidate. Returns the updated dict."""
        now = datetime.now(timezone.utc).isoformat()
        if self._sb:
            return self._sb_update_status(candidate_id, status, review_notes, reviewed_by, now)
        else:
            return self._file_update_status(candidate_id, status, review_notes, reviewed_by, now)

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def list_candidates(
        self,
        status: CandidateStatus | None = None,
        technology_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        if self._sb:
            return self._sb_list(status, technology_id, limit)
        return self._file_list(status, technology_id, limit)

    def get_candidate(self, candidate_id: str) -> dict[str, Any] | None:
        if self._sb:
            return self._sb_get(candidate_id)
        return self._file_find(candidate_id)

    def has_similar_candidate(
        self,
        technology_id: str,
        source: str,
        paper_doi: str | None = None,
        paper_title: str | None = None,
    ) -> bool:
        """
        True if a candidate already exists for the same tech+source+paper identity.
        Uses DOI when available, otherwise falls back to normalized title.
        """
        if self._sb:
            return self._sb_has_similar(technology_id, source, paper_doi, paper_title)
        return self._file_has_similar(technology_id, source, paper_doi, paper_title)

    def count_by_status(self) -> dict[str, int]:
        if self._sb:
            return self._sb_count()
        return {
            "pending":  len(list(self._pending.glob("*.json"))),
            "approved": len(list(self._approved.glob("*.json"))),
            "rejected": len(list(self._rejected.glob("*.json"))),
        }

    # ------------------------------------------------------------------
    # Run log
    # ------------------------------------------------------------------

    def log_run(self, run_meta: dict[str, Any]) -> None:
        """Persist a pipeline run summary."""
        if self._sb:
            self._sb_log_run(run_meta)
        else:
            self._file_log_run(run_meta)

    def last_run(self) -> dict[str, Any] | None:
        if self._sb:
            return self._sb_last_run()
        return self._file_last_run()

    def get_run_history(self, limit: int = 20) -> list[dict[str, Any]]:
        if self._sb:
            return self._sb_run_history(limit)
        return self._file_run_history(limit)

    # ------------------------------------------------------------------
    # Supabase backend
    # ------------------------------------------------------------------

    def _sb_save(self, candidate: dict[str, Any]) -> None:
        try:
            self._sb.table("scraper_candidates").insert(self._to_row(candidate)).execute()
        except Exception as exc:
            logger.error("Supabase insert failed: %s — falling back to file", exc)
            _atomic_write(self._pending / f"{candidate['candidate_id']}.json", candidate)

    def _sb_update_status(
        self, candidate_id: str, status: CandidateStatus,
        review_notes: str, reviewed_by: str | None, now: str,
    ) -> dict[str, Any] | None:
        try:
            resp = (
                self._sb.table("scraper_candidates")
                .update({
                    "status":       status.value,
                    "review_notes": review_notes,
                    "reviewed_at":  now,
                    "reviewed_by":  reviewed_by,
                })
                .eq("candidate_id", candidate_id)
                .select()  # required — PostgREST returns [] without this
                .execute()
            )
            if resp.data:
                return resp.data[0]
            # Update succeeded but no row returned (e.g. RLS hides it).
            # Fetch the row explicitly so the caller always gets a dict back.
            return self._sb_get(candidate_id)
        except Exception as exc:
            logger.error("Supabase update_status failed: %s", exc)
            return None

    def _sb_list(
        self,
        status: CandidateStatus | None,
        technology_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        try:
            q = (
                self._sb.table("scraper_candidates")
                .select("*")
                .order("scraped_at", desc=True)
                .limit(limit)
            )
            if status:
                q = q.eq("status", status.value)
            if technology_id:
                q = q.eq("technology_id", technology_id)
            return q.execute().data or []
        except Exception as exc:
            logger.error("Supabase list failed: %s", exc)
            return []

    def _sb_get(self, candidate_id: str) -> dict[str, Any] | None:
        try:
            resp = (
                self._sb.table("scraper_candidates")
                .select("*")
                .eq("candidate_id", candidate_id)
                .maybe_single()
                .execute()
            )
            return resp.data
        except Exception as exc:
            logger.error("Supabase get failed: %s", exc)
            return None

    def _sb_count(self) -> dict[str, int]:
        counts: dict[str, int] = {"pending": 0, "approved": 0, "rejected": 0}
        try:
            for s in counts:
                resp = (
                    self._sb.table("scraper_candidates")
                    .select("*", count="exact")
                    .eq("status", s)
                    .limit(1)
                    .execute()
                )
                counts[s] = resp.count or 0
        except Exception as exc:
            logger.error("Supabase count failed: %s", exc)
        return counts

    def _sb_has_similar(
        self,
        technology_id: str,
        source: str,
        paper_doi: str | None,
        paper_title: str | None,
    ) -> bool:
        try:
            q = (
                self._sb.table("scraper_candidates")
                .select("candidate_id")
                .eq("technology_id", technology_id)
                .eq("source", source)
            )
            if paper_doi:
                resp = q.eq("paper_doi", paper_doi).limit(1).execute()
                return bool(resp.data)

            if paper_title:
                # Fallback: exact title match when DOI is absent.
                resp = q.eq("paper_title", paper_title).limit(1).execute()
                return bool(resp.data)
            return False
        except Exception as exc:
            logger.debug("Supabase has_similar check failed: %s", exc)
            return False

    def _sb_log_run(self, run_meta: dict[str, Any]) -> None:
        row = {
            "run_id":                 run_meta.get("run_id", str(uuid.uuid4())),
            "started_at":             run_meta.get("started_at"),
            "finished_at":            run_meta.get("finished_at"),
            "technologies_processed": run_meta.get("technologies_processed", 0),
            "papers_fetched":         run_meta.get("papers_fetched", 0),
            "candidates_created":     run_meta.get("candidates_created", 0),
            "errors":                 run_meta.get("errors", []),
        }
        try:
            self._sb.table("scraper_runs").insert(row).execute()
        except Exception as exc:
            logger.error("Supabase log_run failed: %s — falling back to file", exc)
            self._file_log_run(run_meta)

    def _sb_last_run(self) -> dict[str, Any] | None:
        try:
            resp = (
                self._sb.table("scraper_runs")
                .select("*")
                .order("started_at", desc=True)
                .limit(1)
                .execute()
            )
            return resp.data[0] if resp.data else None
        except Exception as exc:
            logger.error("Supabase last_run failed: %s", exc)
            return None

    def _sb_run_history(self, limit: int) -> list[dict[str, Any]]:
        try:
            resp = (
                self._sb.table("scraper_runs")
                .select("*")
                .order("started_at", desc=True)
                .limit(limit)
                .execute()
            )
            return resp.data or []
        except Exception as exc:
            logger.error("Supabase run_history failed: %s", exc)
            return []

    # ------------------------------------------------------------------
    # File backend (fallback / local dev)
    # ------------------------------------------------------------------

    def _file_update_status(
        self, candidate_id: str, status: CandidateStatus,
        review_notes: str, reviewed_by: str | None, now: str,
    ) -> dict[str, Any] | None:
        candidate = self._file_find(candidate_id)
        if candidate is None:
            logger.warning("Candidate not found: %s", candidate_id)
            return None
        old_path = self._dir_for_status(candidate.get("status", "pending")) / f"{candidate_id}.json"
        new_path = self._dir_for_status(status.value) / f"{candidate_id}.json"
        candidate.update({
            "status":       status.value,
            "review_notes": review_notes,
            "reviewed_at":  now,
            "reviewed_by":  reviewed_by,
        })
        _atomic_write(new_path, candidate)
        old_path.unlink(missing_ok=True)
        return candidate

    def _file_list(
        self,
        status: CandidateStatus | None,
        technology_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        dirs = (
            [self._dir_for_status(status.value)]
            if status
            else [self._pending, self._approved, self._rejected]
        )
        results: list[dict[str, Any]] = []
        for d in dirs:
            for path in sorted(d.glob("*.json")):
                try:
                    candidate = json.loads(path.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if technology_id and candidate.get("technology_id") != technology_id:
                    continue
                results.append(candidate)
                if len(results) >= limit:
                    return results
        return results

    def _file_find(self, candidate_id: str) -> dict[str, Any] | None:
        for d in (self._pending, self._approved, self._rejected):
            path = d / f"{candidate_id}.json"
            if path.exists():
                try:
                    return json.loads(path.read_text(encoding="utf-8"))
                except Exception:
                    return None
        return None

    def _file_has_similar(
        self,
        technology_id: str,
        source: str,
        paper_doi: str | None,
        paper_title: str | None,
    ) -> bool:
        title_norm = (paper_title or "").strip().lower()
        for d in (self._pending, self._approved, self._rejected):
            for path in d.glob("*.json"):
                try:
                    candidate = json.loads(path.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if candidate.get("technology_id") != technology_id:
                    continue
                if candidate.get("source") != source:
                    continue
                existing_doi = (candidate.get("paper_doi") or "").strip()
                if paper_doi and existing_doi and existing_doi == paper_doi.strip():
                    return True
                existing_title = (candidate.get("paper_title") or "").strip().lower()
                if not paper_doi and title_norm and existing_title == title_norm:
                    return True
        return False

    def _file_log_run(self, run_meta: dict[str, Any]) -> None:
        log_path = self._runs / "run_log.json"
        history: list[dict] = []
        if log_path.exists():
            try:
                history = json.loads(log_path.read_text(encoding="utf-8"))
            except Exception:
                history = []
        history.append(run_meta)
        history = history[-200:]
        _atomic_write(log_path, history)

    def _file_last_run(self) -> dict[str, Any] | None:
        log_path = self._runs / "run_log.json"
        if not log_path.exists():
            return None
        try:
            history: list[dict] = json.loads(log_path.read_text(encoding="utf-8"))
            return history[-1] if history else None
        except Exception:
            return None

    def _file_run_history(self, limit: int) -> list[dict[str, Any]]:
        log_path = self._runs / "run_log.json"
        if not log_path.exists():
            return []
        try:
            history: list[dict] = json.loads(log_path.read_text(encoding="utf-8"))
            return list(reversed(history[-limit:]))
        except Exception:
            return []

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _dir_for_status(self, status: str) -> Path:
        return {
            "pending":  self._pending,
            "approved": self._approved,
            "rejected": self._rejected,
        }.get(status, self._pending)

    @staticmethod
    def _to_row(c: dict[str, Any]) -> dict[str, Any]:
        """Convert a candidate dict to a flat Supabase-compatible row."""
        return {
            "candidate_id":      c["candidate_id"],
            "scraped_at":        c.get("scraped_at"),
            "status":            c.get("status", "pending"),
            "technology_id":     c.get("technology_id", ""),
            "source":            c.get("source", ""),
            "paper_doi":         c.get("paper_doi"),
            "paper_title":       c.get("paper_title"),
            "paper_year":        c.get("paper_year"),
            "paper_url":         c.get("paper_url"),
            "paper_venue":       c.get("paper_venue"),
            "paper_authors":     c.get("paper_authors") or [],
            "extracted_params":  c.get("extracted_params") or {},
            "proposed_instance": c.get("proposed_instance"),
            "review_notes":      c.get("review_notes", ""),
            "reviewed_at":       c.get("reviewed_at"),
            "reviewed_by":       c.get("reviewed_by"),
        }


class RawStore:
    """Saves raw API responses to disk for debugging and re-processing.
    These files are covered by .gitignore and are never sent to the database.
    """

    def __init__(self, raw_dir: Path) -> None:
        self._dir = raw_dir
        self._dir.mkdir(parents=True, exist_ok=True)

    def save(self, source: str, technology_id: str, run_id: str, data: Any) -> None:
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        subdir = self._dir / date_str
        subdir.mkdir(exist_ok=True)
        filename = f"{source}_{technology_id}_{run_id[:8]}.json"
        path = subdir / filename
        try:
            _atomic_write(path, data)
        except Exception as exc:
            logger.debug("RawStore write failed: %s", exc)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _atomic_write(path: Path, data: Any, indent: int = 2) -> None:
    """Write JSON to *path* atomically (temp file → rename)."""
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(
            json.dumps(data, ensure_ascii=False, indent=indent, default=str),
            encoding="utf-8",
        )
        tmp.replace(path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise

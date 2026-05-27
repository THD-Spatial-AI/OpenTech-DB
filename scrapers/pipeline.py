"""
scrapers/pipeline.py
=====================
Orchestrates the full scraping → extraction → normalisation → storage cycle.

Entry points
------------
  pipeline = ScrapingPipeline.from_config()
  result   = pipeline.run()            # full run over all enabled technologies
  result   = pipeline.run(tech_ids=["ccgt", "solar_pv_utility"])  # selective
  result   = pipeline.run(sources=["open_alex"])                   # selective
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from scrapers.config import ScraperConfig
from scrapers.base import PaperRecord
from scrapers.storage import CandidateStore, RawStore
from scrapers.normalizer import Normalizer
from scrapers.extractors.text_extractor import TextExtractor
from scrapers.extractors.pdf_extractor import PDFExtractor
from scrapers.extractors.llm_extractor import LLMExtractor

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Source factory (import lazily to avoid hard dependencies)
# ---------------------------------------------------------------------------

_SOURCE_CLASSES = {
    "open_alex":        "scrapers.sources.open_alex.OpenAlexScraper",
    "semantic_scholar": "scrapers.sources.semantic_scholar.SemanticScholarScraper",
    "scopus":           "scrapers.sources.scopus_api.ScopusScraper",
    "google_scholar":   "scrapers.sources.scholarly_gs.GoogleScholarScraper",
    "nrel_atb":         "scrapers.sources.nrel_atb.NRELATBScraper",
    "pypsa_techdata":   "scrapers.sources.pypsa_techdata.PyPSATechDataScraper",
    "irena_costs":      "scrapers.sources.irena_costs.IRENACostsScraper",
    "crossref":         "scrapers.sources.crossref.CrossrefScraper",
    "arxiv":            "scrapers.sources.arxiv_source.ArXivScraper",
    "europe_pmc":       "scrapers.sources.europe_pmc.EuropePMCScraper",
}

_RUN_STATE_LOCK = threading.Lock()
_LIVE_LOG_LOCK = threading.Lock()
_CURRENT_RUN_STATE: dict[str, Any] | None = None
_MAX_LIVE_EVENTS = 200
_RUNS_DIR = Path(__file__).resolve().parent.parent / "data" / "scraped" / "runs"
_LIVE_STATE_FILE = _RUNS_DIR / "current_run.json"
_STOP_REQUEST_FILE = _RUNS_DIR / "stop_request.json"
_LIVE_LOG_FILE = _RUNS_DIR / "current_run.log"
_SCRAPE_HISTORY_FILE = _RUNS_DIR / "scrape_history.json"

# Domain → catalogue file mapping (relative to project root / data/)
_DOMAIN_CATALOGUE_FILES: dict[str, str] = {
    "generation":  "data/generation/generation_technologies.json",
    "storage":     "data/storage/storage_technologies.json",
    "transmission": "data/transmission/transmission_technologies.json",
    "conversion":  "data/conversion/conversion_technologies.json",
}


def _infer_domain(tech_id: str) -> str:
    """Best-effort domain inference from *tech_id* when no explicit config domain exists.

    Returns one of: generation | storage | transmission | conversion.
    Falls back to 'generation' when no pattern matches.
    """
    t = tech_id.lower()
    _storage = (
        "bess", "batteries", "redox_flow", "compressed_air", "caes", "laes",
        "gravity_storage", "flywheel", "supercapacitor", "pumped_hydro",
        "hydro_pumped", "thermal_energy_storage", "hydrogen_storage",
        "sensible_thermal", "latent_thermal", "hydrogen_underground",
    )
    _transmission = (
        "hvdc", "hvac_transmission", "offshore_hvdc_cable", "smart_grid",
        "pipeline", "distribution_cable", "substation",
        "switchgear", "_network",
    )
    _conversion = (
        "electrolyzer", "electrolysis", "fuel_cell", "heat_pump",
        "methanation", "ammonia_synthesis", "ammonia_", "_ccs", "beccs",
        "solar_thermal_collector", "district_heating", "building_insulation",
        "demand_response", "ev_charging", "vehicle_to_grid",
        "hydrogen_refueling", "led_lighting", "gasification",
        "fischer_tropsch", "haber_bosch",
        # Power-to-X and direct air capture
        "power_to_", "p2x", "direct_air", "dac",
    )
    if any(m in t for m in _storage):
        return "storage"
    if any(m in t for m in _transmission):
        return "transmission"
    if any(m in t for m in _conversion):
        return "conversion"
    return "generation"


def _build_tech_stub(
    tech_id: str,
    domain: str,
    instance: dict[str, Any],
) -> dict[str, Any]:
    """Return an OEO-aligned stub technology card for *tech_id*.

    *instance* is the ``proposed_instance`` dict from the candidate that
    triggered stub creation.  Its ``_paper_*`` provenance fields are used to
    build an adaptive description.

    Fields populated when found in TECH_METADATA:
        technology_name, carrier, oeo_class

    Falls back to slug-based inference for unknown tech_ids so new technologies
    scraped outside the known vocabulary still get a usable stub.
    """
    from scrapers.tech_metadata import TECH_METADATA  # lazy — avoids any circulars

    meta = TECH_METADATA.get(tech_id, {})
    name     = meta.get("name")    or tech_id.replace("_", " ").title()
    carrier  = meta.get("carrier", "")
    oeo_uri  = meta.get("oeo_class", "")

    # ── adaptive description ──────────────────────────────────────────────
    paper_title  = (instance.get("_paper_title")  or "").strip()
    paper_year   = instance.get("_paper_year")
    paper_doi    = (instance.get("_paper_doi")    or "").strip()
    source_raw   = (instance.get("_source")       or "").strip()
    source_label = source_raw.replace("_", " ").title() if source_raw else ""

    # Count actual extracted parameter fields (exclude provenance/meta keys)
    _meta_keys = {
        "instance_id", "instance_name", "reference_source",
        "_scraped", "_source", "_paper_doi", "_paper_title",
        "_paper_year", "_scraped_at", "_extracted_params",
    }
    n_params = sum(1 for k in instance if k not in _meta_keys)

    desc_parts: list[str] = [
        f"{name} — auto-created from scraped literature evidence."
    ]

    if paper_title:
        snippet = paper_title[:80] + ("…" if len(paper_title) > 80 else "")
        desc_parts.append(f'First evidence: "{snippet}"')

    prov_bits: list[str] = []
    if source_label:
        prov_bits.append(source_label)
    if paper_year:
        prov_bits.append(str(paper_year))
    if paper_doi:
        prov_bits.append(f"doi:{paper_doi}")
    if prov_bits:
        desc_parts.append(f"({', '.join(prov_bits)})")

    if n_params:
        desc_parts.append(
            f"{n_params} parameter{'s' if n_params != 1 else ''} extracted from first instance."
        )

    oeo_local = oeo_uri.rpartition("/")[2] if oeo_uri else ""
    if oeo_local:
        desc_parts.append(
            f"OEO class: {oeo_local} (auto-assigned — human review recommended)."
        )
    else:
        desc_parts.append(
            "Carrier, OEO class, and full description require human review."
        )

    stub: dict[str, Any] = {
        "technology_id":    tech_id,
        "technology_name":  name,
        "domain":           domain,
        "description":      " ".join(desc_parts),
        "_auto_created":    True,
        "_auto_created_at": datetime.now(timezone.utc).isoformat(),
        "instances":        [],
    }
    if carrier:
        stub["carrier"] = carrier
    if oeo_uri:
        stub["oeo_class"] = oeo_uri

    return stub


def _ensure_runs_dir() -> None:
    _RUNS_DIR.mkdir(parents=True, exist_ok=True)


def _persist_live_state(state: dict[str, Any] | None) -> None:
    _ensure_runs_dir()
    if state is None:
        try:
            _LIVE_STATE_FILE.unlink(missing_ok=True)
        except Exception:
            pass
        return

    serializable = {k: v for k, v in state.items() if k != "_t0"}
    try:
        _LIVE_STATE_FILE.write_text(
            json.dumps(serializable, ensure_ascii=True, default=str, indent=2),
            encoding="utf-8",
        )
    except Exception as exc:
        logger.debug("Could not persist live run state: %s", exc)


def _load_persisted_live_state() -> dict[str, Any] | None:
    if not _LIVE_STATE_FILE.exists():
        return None
    try:
        raw = json.loads(_LIVE_STATE_FILE.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return None
        return raw
    except Exception:
        return None


def _reset_live_log(run_id: str) -> None:
    _ensure_runs_dir()
    try:
        _LIVE_LOG_FILE.write_text(f"[{_now_utc_iso()}] run={run_id} log initialized\n", encoding="utf-8")
    except Exception:
        pass


def _append_live_log(line: str) -> None:
    _ensure_runs_dir()
    safe = line.replace("\r", " ").replace("\n", " ")
    try:
        with _LIVE_LOG_LOCK:
            with _LIVE_LOG_FILE.open("a", encoding="utf-8") as fh:
                fh.write(f"[{_now_utc_iso()}] {safe}\n")
    except Exception:
        pass


def get_current_run_log_tail(max_lines: int = 120) -> list[str]:
    if max_lines < 1:
        return []
    if not _LIVE_LOG_FILE.exists():
        return []
    try:
        lines = _LIVE_LOG_FILE.read_text(encoding="utf-8", errors="ignore").splitlines()
        return lines[-max_lines:]
    except Exception:
        return []


def request_stop_current_run(reason: str = "admin_request") -> dict[str, Any]:
    """Request cancellation of the current run (cooperative stop)."""
    with _RUN_STATE_LOCK:
        run_id = _CURRENT_RUN_STATE.get("run_id") if _CURRENT_RUN_STATE else None
        running = bool(_CURRENT_RUN_STATE and _CURRENT_RUN_STATE.get("running"))

    if not run_id or not running:
        persisted = _load_persisted_live_state()
        if persisted and persisted.get("running") and persisted.get("run_id"):
            run_id = str(persisted.get("run_id"))
            running = True

    if not run_id or not running:
        return {"requested": False, "message": "No active pipeline run to stop.", "run_id": None}

    payload = {
        "run_id": run_id,
        "requested_at": _now_utc_iso(),
        "reason": reason,
    }
    try:
        _ensure_runs_dir()
        _STOP_REQUEST_FILE.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
    except Exception as exc:
        return {
            "requested": False,
            "message": f"Failed to write stop request: {exc}",
            "run_id": run_id,
        }

    with _RUN_STATE_LOCK:
        if _CURRENT_RUN_STATE and _CURRENT_RUN_STATE.get("run_id") == run_id:
            _CURRENT_RUN_STATE["stop_requested"] = True
            events = _CURRENT_RUN_STATE.setdefault("events", [])
            events.append(
                {
                    "at": _now_utc_iso(),
                    "level": "warning",
                    "message": "Stop requested by admin. Waiting for a safe checkpoint…",
                    "phase": "stopping",
                }
            )
            if len(events) > _MAX_LIVE_EVENTS:
                del events[: len(events) - _MAX_LIVE_EVENTS]
            _persist_live_state(_CURRENT_RUN_STATE)

    return {
        "requested": True,
        "message": "Stop request accepted. The pipeline will stop shortly.",
        "run_id": run_id,
    }


def _is_stop_requested(run_id: str) -> bool:
    try:
        if _STOP_REQUEST_FILE.exists():
            payload = json.loads(_STOP_REQUEST_FILE.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                return True
            target_run_id = payload.get("run_id")
            return not target_run_id or str(target_run_id) == run_id
    except Exception:
        return True
    return False


def _clear_stop_request(run_id: str | None = None) -> None:
    try:
        if not _STOP_REQUEST_FILE.exists():
            return
        if run_id is None:
            _STOP_REQUEST_FILE.unlink(missing_ok=True)
            return
        payload = json.loads(_STOP_REQUEST_FILE.read_text(encoding="utf-8"))
        target_run_id = payload.get("run_id") if isinstance(payload, dict) else None
        if not target_run_id or str(target_run_id) == run_id:
            _STOP_REQUEST_FILE.unlink(missing_ok=True)
    except Exception:
        pass


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_current_run_status() -> dict[str, Any] | None:
    """Return a snapshot of the current/most-recent run progress for admin APIs."""
    with _RUN_STATE_LOCK:
        state = _CURRENT_RUN_STATE
        snapshot: dict[str, Any] | None = None
        if state is not None:
            snapshot = {
                "run_id": state.get("run_id"),
                "running": bool(state.get("running", False)),
                "started_at": state.get("started_at"),
                "finished_at": state.get("finished_at"),
                "elapsed_seconds": int(state.get("elapsed_seconds", 0)),
                "current_phase": state.get("current_phase"),
                "current_technology": state.get("current_technology"),
                "current_source": state.get("current_source"),
                "technologies_total": int(state.get("technologies_total", 0)),
                "technologies_processed": int(state.get("technologies_processed", 0)),
                "sources_total": int(state.get("sources_total", 0)),
                "papers_fetched": int(state.get("papers_fetched", 0)),
                "candidates_created": int(state.get("candidates_created", 0)),
                "errors_count": int(state.get("errors_count", 0)),
                "events": list(state.get("events", [])),
                "stop_requested": bool(state.get("stop_requested", False)),
                "_t0": state.get("_t0"),
            }

    if snapshot is None:
        snapshot = _load_persisted_live_state()
        if snapshot is None:
            return None
        snapshot.setdefault("events", [])
        snapshot.setdefault("elapsed_seconds", 0)
        snapshot.setdefault("stop_requested", False)

    t0 = snapshot.get("_t0")
    if snapshot["running"] and isinstance(t0, (int, float)):
        snapshot["elapsed_seconds"] = max(0, int(time.perf_counter() - t0))
    elif snapshot.get("running") and snapshot.get("started_at"):
        try:
            started = datetime.fromisoformat(str(snapshot["started_at"]).replace("Z", "+00:00"))
            now_utc = datetime.now(timezone.utc)
            snapshot["elapsed_seconds"] = max(0, int((now_utc - started).total_seconds()))
        except Exception:
            pass
    snapshot.pop("_t0", None)
    snapshot["log_tail"] = get_current_run_log_tail(120)
    return snapshot


def _load_scraper_class(dotted_path: str) -> type:
    module_path, cls_name = dotted_path.rsplit(".", 1)
    import importlib
    module = importlib.import_module(module_path)
    return getattr(module, cls_name)


# ---------------------------------------------------------------------------
# Scrape history – tracks (tech_id × source) → last scraped timestamp
# Used by incremental mode to skip recently-scraped pairs.
# ---------------------------------------------------------------------------

def _load_scrape_history() -> dict[str, Any]:
    if not _SCRAPE_HISTORY_FILE.exists():
        return {}
    try:
        return json.loads(_SCRAPE_HISTORY_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_scrape_history(history: dict[str, Any]) -> None:
    _ensure_runs_dir()
    try:
        tmp = _SCRAPE_HISTORY_FILE.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(history, indent=2, default=str), encoding="utf-8"
        )
        tmp.replace(_SCRAPE_HISTORY_FILE)
    except Exception as exc:
        logger.debug("Could not save scrape history: %s", exc)


def _is_recently_scraped(tech_id: str, source: str, cooldown_days: int) -> bool:
    """Return True if this tech×source was last scraped within *cooldown_days*."""
    if cooldown_days <= 0:
        return False
    history = _load_scrape_history()
    entry = history.get(f"{tech_id}:{source}")
    if not entry:
        return False
    last_scraped = entry.get("last_scraped_at")
    if not last_scraped:
        return False
    try:
        last_dt = datetime.fromisoformat(str(last_scraped))
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
        cutoff = datetime.now(timezone.utc) - timedelta(days=cooldown_days)
        return last_dt > cutoff
    except Exception:
        return False


def _mark_scraped(tech_id: str, source: str, papers_found: int) -> None:
    """Record that tech×source was successfully fetched right now."""
    history = _load_scrape_history()
    history[f"{tech_id}:{source}"] = {
        "last_scraped_at": datetime.now(timezone.utc).isoformat(),
        "papers_found": papers_found,
    }
    _save_scrape_history(history)


# ---------------------------------------------------------------------------
# Run result
# ---------------------------------------------------------------------------

class PipelineResult:
    def __init__(self) -> None:
        self.run_id:          str = str(uuid.uuid4())
        self.started_at:      str = datetime.now(timezone.utc).isoformat()
        self.finished_at:     str | None = None
        self.technologies_processed: int = 0
        self.papers_fetched:  int = 0
        self.candidates_created: int = 0
        self.errors:          list[str] = []

    def finish(self) -> None:
        self.finished_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id":                   self.run_id,
            "started_at":               self.started_at,
            "finished_at":              self.finished_at,
            "technologies_processed":   self.technologies_processed,
            "papers_fetched":           self.papers_fetched,
            "candidates_created":       self.candidates_created,
            "errors":                   self.errors,
        }


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

class ScrapingPipeline:
    """
    Drives the end-to-end scraping pipeline:

    1. For each enabled source × enabled technology:
       a. Query the source for recent papers.
       b. Extract parameters from abstract (always) + PDF (if available).
       c. Optionally use LLM to extract parameters.
    2. Normalise → create candidate dicts.
    3. Persist candidates to data/scraped/candidates/pending/.
    4. Deduplicate by DOI within a run.
    5. Log run metadata to data/scraped/runs/run_log.json.
    """

    def __init__(self, cfg: ScraperConfig) -> None:
        self.cfg = cfg

        base_dir    = cfg.resolved_path(getattr(cfg.output, "base_dir", "data/scraped"))
        raw_dir     = cfg.resolved_path(getattr(cfg.output, "raw_dir", "data/scraped/raw"))

        self._candidates  = CandidateStore(base_dir)
        self._raw_store   = RawStore(raw_dir)
        self._normalizer  = Normalizer()
        self._text_ext    = TextExtractor(
            min_confidence=getattr(cfg.extraction, "min_confidence", 0.55)
        )
        self._pdf_ext     = PDFExtractor(
            max_mb=float(getattr(cfg.extraction, "max_pdf_mb", 10))
        )
        self._llm_ext     = LLMExtractor(cfg)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @classmethod
    def from_config(cls, config_path: Path | None = None) -> "ScrapingPipeline":
        return cls(ScraperConfig.load(config_path))

    def run(
        self,
        tech_ids:    list[str] | None = None,
        sources:     list[str] | None = None,
        incremental: bool = True,
    ) -> PipelineResult:
        """
        Execute a full pipeline run.

        Parameters
        ----------
        tech_ids    : optional list of technology_ids to limit processing.
        sources     : optional list of source names to use.
        incremental : if True (default), skip tech×source pairs that were
                      successfully fetched within ``output.incremental_cooldown_days``
                      (default 7 days).  Pass ``incremental=False`` for a full refresh.
        """
        result = PipelineResult()
        run_t0 = time.perf_counter()
        logger.info("Pipeline run %s started.", result.run_id)

        enabled_sources = self.cfg.enabled_sources
        if sources:
            enabled_sources = [s for s in enabled_sources if s in sources]

        technology_ids = list(self.cfg.technologies.keys())
        if tech_ids:
            technology_ids = [t for t in technology_ids if t in tech_ids]

        selected_tech_ids: list[str] = []
        for tech_id in technology_ids:
            tech_cfg = self.cfg.technologies.get(tech_id)
            if not tech_cfg:
                continue
            queries = getattr(tech_cfg, "search_queries", [])
            if queries:
                selected_tech_ids.append(tech_id)

        self._live_run_init(
            result=result,
            technologies=selected_tech_ids,
            sources=enabled_sources,
            t0=run_t0,
        )
        _reset_live_log(result.run_id)
        _clear_stop_request(result.run_id)
        self._live_event(
            level="info",
            message=(
                f"Run started for {len(selected_tech_ids)} techs across "
                f"{len(enabled_sources)} source(s)."
            ),
            phase="started",
        )

        # Track DOIs seen this run for deduplication
        seen_doi_this_run: set[str] = set()
        stop_requested = False
        cooldown_days = int(getattr(self.cfg.output, "incremental_cooldown_days", 7))

        try:
            for tech_index, tech_id in enumerate(selected_tech_ids, start=1):
                if _is_stop_requested(result.run_id):
                    stop_requested = True
                    break
                tech_cfg = self.cfg.technologies.get(tech_id)
                if not tech_cfg:
                    continue

                queries = getattr(tech_cfg, "search_queries", [])
                if not queries:
                    continue

                result.technologies_processed += 1
                self._live_run_update(
                    current_phase="technology",
                    current_technology=tech_id,
                    current_source=None,
                    technologies_processed=result.technologies_processed,
                )
                self._live_event(
                    level="info",
                    message=f"[{tech_index}/{len(selected_tech_ids)}] Processing technology '{tech_id}'.",
                    technology_id=tech_id,
                    phase="technology",
                )
                logger.info(
                    "[run=%s +%ss] Processing technology %s (%d/%d)",
                    result.run_id,
                    int(time.perf_counter() - run_t0),
                    tech_id,
                    tech_index,
                    len(selected_tech_ids),
                )

                # ----------------------------------------------------------
                # 1. Filter sources by incremental cooldown
                # ----------------------------------------------------------
                sources_to_fetch: list[str] = []
                for source_name in enabled_sources:
                    if _is_stop_requested(result.run_id):
                        stop_requested = True
                        break
                    if incremental and _is_recently_scraped(tech_id, source_name, cooldown_days):
                        self._live_event(
                            level="info",
                            message=(
                                f"Incremental skip: '{tech_id}' × '{source_name}' "
                                f"was scraped within the last {cooldown_days} day(s)."
                            ),
                            technology_id=tech_id,
                            source=source_name,
                            phase="incremental_skip",
                        )
                        logger.debug("Incremental skip: %s × %s", tech_id, source_name)
                        continue
                    sources_to_fetch.append(source_name)

                if stop_requested:
                    break

                if not sources_to_fetch:
                    continue

                # ----------------------------------------------------------
                # 2. Parallel fetch from all remaining sources
                # ----------------------------------------------------------
                fetch_t0 = time.perf_counter()
                self._live_event(
                    level="info",
                    message=(
                        f"Fetching from {len(sources_to_fetch)} source(s) for '{tech_id}' "
                        f"(parallel, max 4 threads)."
                    ),
                    technology_id=tech_id,
                    phase="fetch",
                )
                self._live_run_update(current_phase="fetch", current_source=None)

                papers_by_source: dict[str, list] = {}
                max_workers = min(len(sources_to_fetch), 4)
                with ThreadPoolExecutor(max_workers=max_workers) as executor:
                    future_to_src = {
                        executor.submit(
                            self._fetch_papers_from_source,
                            src, tech_id, queries, result.run_id,
                        ): src
                        for src in sources_to_fetch
                    }
                    for future in as_completed(future_to_src):
                        src = future_to_src[future]
                        fetched_src, src_papers, fetch_exc = future.result()
                        if fetch_exc is not None:
                            msg = f"Source {src} failed for {tech_id}: {fetch_exc}"
                            logger.warning(msg)
                            result.errors.append(msg)
                            self._live_run_update(errors_count=len(result.errors))
                            self._live_event(
                                level="error", message=msg,
                                technology_id=tech_id, source=src, phase="fetch",
                            )
                        else:
                            papers_by_source[fetched_src] = src_papers
                            _mark_scraped(tech_id, src, len(src_papers))
                            self._live_event(
                                level="info",
                                message=(
                                    f"Fetched {len(src_papers)} paper(s) from '{src}'."
                                ),
                                technology_id=tech_id, source=src, phase="fetch",
                            )

                fetch_elapsed = int(time.perf_counter() - fetch_t0)
                total_papers = sum(len(p) for p in papers_by_source.values())
                self._live_event(
                    level="info",
                    message=(
                        f"Fetch complete for '{tech_id}': {total_papers} papers from "
                        f"{len(papers_by_source)} source(s) in {fetch_elapsed}s."
                    ),
                    technology_id=tech_id,
                    phase="fetch",
                )

                # ----------------------------------------------------------
                # 3. Sequential paper processing (thread-safe by design)
                # ----------------------------------------------------------
                for src_name, papers in papers_by_source.items():
                    if stop_requested:
                        break
                    self._live_run_update(current_source=src_name)

                    for paper in papers:
                        if _is_stop_requested(result.run_id):
                            stop_requested = True
                            break
                        result.papers_fetched += 1
                        self._live_run_update(
                            current_phase="extract",
                            papers_fetched=result.papers_fetched,
                            current_technology=tech_id,
                            current_source=src_name,
                        )

                        # DOI-level dedup within this run
                        if self.cfg.output.get("dedup_by_doi", True):
                            key = paper.dedup_key
                            if key.startswith("doi:") and key in seen_doi_this_run:
                                logger.debug("Dedup skip (DOI seen): %s", paper.doi)
                                continue
                            seen_doi_this_run.add(key)

                        try:
                            created = self._process_paper(paper, tech_id)
                            if created:
                                result.candidates_created += 1
                                self._live_run_update(
                                    current_phase="store",
                                    candidates_created=result.candidates_created,
                                )
                                self._live_event(
                                    level="info",
                                    message=(
                                        f"Candidate created for '{tech_id}' from '{src_name}' "
                                        f"(paper: {paper.source_id})."
                                    ),
                                    technology_id=tech_id,
                                    source=src_name,
                                    paper_id=paper.source_id,
                                    phase="store",
                                )
                        except Exception as exc:
                            msg = f"Processing failed for {paper.source_id}: {exc}"
                            logger.warning(msg)
                            result.errors.append(msg)
                            self._live_run_update(errors_count=len(result.errors))
                            self._live_event(
                                level="error",
                                message=msg,
                                technology_id=tech_id,
                                source=src_name,
                                paper_id=paper.source_id,
                                phase="extract",
                            )

                if stop_requested:
                    break

            if stop_requested:
                stop_msg = "Run stopped by admin request."
                logger.warning("Pipeline run %s stopped by request.", result.run_id)
                result.errors.append(stop_msg)
                self._live_run_update(current_phase="stopped")
                self._live_event(level="warning", message=stop_msg, phase="stopped")
        except Exception as exc:
            msg = f"Fatal pipeline error: {exc}"
            result.errors.append(msg)
            logger.exception(msg)
            self._live_run_update(errors_count=len(result.errors))
            self._live_event(level="error", message=msg, phase="fatal")
        finally:
            result.finish()
            self._candidates.log_run(result.to_dict())
            elapsed = int(time.perf_counter() - run_t0)
            self._live_run_complete(result, elapsed, stopped=stop_requested)
            _clear_stop_request(result.run_id)

        logger.info(
            "Pipeline run %s finished in %ss: %d technologies, %d papers, %d candidates, %d errors.",
            result.run_id,
            int(time.perf_counter() - run_t0),
            result.technologies_processed,
            result.papers_fetched,
            result.candidates_created,
            len(result.errors),
        )
        return result

    def _live_run_init(
        self,
        result: PipelineResult,
        technologies: list[str],
        sources: list[str],
        t0: float,
    ) -> None:
        global _CURRENT_RUN_STATE
        state = {
            "run_id": result.run_id,
            "running": True,
            "started_at": result.started_at,
            "finished_at": None,
            "elapsed_seconds": 0,
            "current_phase": "initialising",
            "current_technology": None,
            "current_source": None,
            "technologies_total": len(technologies),
            "technologies_processed": 0,
            "sources_total": len(sources),
            "papers_fetched": 0,
            "candidates_created": 0,
            "errors_count": 0,
            "events": [],
            "_t0": t0,
        }
        with _RUN_STATE_LOCK:
            _CURRENT_RUN_STATE = state
            _persist_live_state(_CURRENT_RUN_STATE)

    def _live_run_update(self, **updates: Any) -> None:
        with _RUN_STATE_LOCK:
            if _CURRENT_RUN_STATE is None:
                return
            _CURRENT_RUN_STATE.update(updates)
            t0 = _CURRENT_RUN_STATE.get("_t0")
            if _CURRENT_RUN_STATE.get("running") and isinstance(t0, (int, float)):
                _CURRENT_RUN_STATE["elapsed_seconds"] = max(0, int(time.perf_counter() - t0))
            _persist_live_state(_CURRENT_RUN_STATE)

    def _live_event(self, level: str, message: str, **meta: Any) -> None:
        event = {
            "at": _now_utc_iso(),
            "level": level,
            "message": message,
            **meta,
        }
        _append_live_log(
            f"level={level} phase={meta.get('phase', '-') or '-'} "
            f"tech={meta.get('technology_id', '-') or '-'} "
            f"source={meta.get('source', '-') or '-'} :: {message}"
        )
        with _RUN_STATE_LOCK:
            if _CURRENT_RUN_STATE is None:
                return
            events = _CURRENT_RUN_STATE.setdefault("events", [])
            events.append(event)
            if len(events) > _MAX_LIVE_EVENTS:
                del events[: len(events) - _MAX_LIVE_EVENTS]
            _persist_live_state(_CURRENT_RUN_STATE)

    def _live_run_complete(self, result: PipelineResult, elapsed_seconds: int, stopped: bool = False) -> None:
        self._live_event(
            level="info",
            message=(
                f"Run {'stopped' if stopped else 'finished'} in {elapsed_seconds}s: "
                f"{result.technologies_processed} tech(s), "
                f"{result.papers_fetched} paper(s), {result.candidates_created} candidate(s), "
                f"{len(result.errors)} error(s)."
            ),
            phase="stopped" if stopped else "finished",
        )
        with _RUN_STATE_LOCK:
            if _CURRENT_RUN_STATE is None:
                return
            _CURRENT_RUN_STATE.update(
                {
                    "running": False,
                    "finished_at": result.finished_at,
                    "elapsed_seconds": elapsed_seconds,
                    "current_phase": "stopped" if stopped else "finished",
                    "current_source": None,
                }
            )
            _persist_live_state(_CURRENT_RUN_STATE)
        _append_live_log(
            f"run_complete stopped={stopped} elapsed_s={elapsed_seconds} "
            f"techs={result.technologies_processed} papers={result.papers_fetched} "
            f"candidates={result.candidates_created} errors={len(result.errors)}"
        )

    # ------------------------------------------------------------------
    # Internal steps
    # ------------------------------------------------------------------

    def _fetch_papers_from_source(
        self,
        source_name: str,
        tech_id: str,
        queries: list[str],
        run_id: str,
    ) -> tuple[str, list["PaperRecord"], Exception | None]:
        """Fetch papers from *source_name* for use with ThreadPoolExecutor.

        Returns *(source_name, papers, error)*.  Never raises.
        """
        cls_path = _SOURCE_CLASSES.get(source_name)
        if not cls_path:
            return source_name, [], None
        try:
            cls = _load_scraper_class(cls_path)
        except (ImportError, AttributeError) as exc:
            return source_name, [], exc
        try:
            with cls(self.cfg) as scraper:
                papers = scraper.search(tech_id, queries)
                raw_payload = [p.to_dict() for p in papers]
                self._raw_store.save(source_name, tech_id, run_id, raw_payload)
                return source_name, papers, None
        except Exception as exc:
            return source_name, [], exc

    def _fetch_papers(
        self,
        source_name: str,
        tech_id: str,
        queries: list[str],
        result: PipelineResult,
    ) -> list[PaperRecord]:
        """Sequential single-source fetch (kept for CLI / test compatibility)."""
        _, papers, exc = self._fetch_papers_from_source(
            source_name, tech_id, queries, result.run_id
        )
        if exc is not None:
            raise exc
        return papers

    def _process_paper(self, paper: PaperRecord, tech_id: str) -> bool:
        """
        Extract parameters from one paper and save a candidate if useful.
        Returns True if a candidate was created.
        """
        # 1. Text to analyse (prefer full_text if already set, else abstract)
        text = paper.full_text or paper.abstract or ""

        # 2. PDF extraction (if open-access URL available and parse_pdfs enabled)
        if (
            getattr(self.cfg.extraction, "parse_pdfs", True)
            and paper.open_access_pdf_url
            and self._pdf_ext.available
            and not paper.full_text  # don't re-parse if already have text
        ):
            import httpx
            # Use a minimal client for PDF download (rate-limit baked in base)
            try:
                pdf_bytes = httpx.get(
                    paper.open_access_pdf_url,
                    headers={"User-Agent": self.cfg.user_agent},
                    timeout=30,
                    follow_redirects=True,
                ).content
                pdf_text = self._pdf_ext.extract_from_bytes(pdf_bytes)
                if pdf_text:
                    text = pdf_text
            except Exception as exc:
                logger.debug("PDF fetch failed for %s: %s", paper.open_access_pdf_url, exc)

        # 3. Regex extraction
        regex_values = self._text_ext.extract(text, tech_id)

        # 4. LLM extraction (optional)
        llm_params = None
        if self._llm_ext.available and text.strip():
            llm_params = self._llm_ext.extract(text, tech_id)

        # 5. Need at least one extracted value to create a candidate
        if not regex_values and llm_params is None:
            return False

        # 5b. parameter_hints enforcement:
        #   - Merges per-tech hints with global_hints from extraction config.
        #   - Requires at least min_hinted_params (default 3) of those hints to be
        #     present in the extracted params. This ensures candidates carry the core
        #     economic/performance parameters expected for that technology type.
        tech_cfg = self.cfg.technologies.get(tech_id)
        tech_hints: list[str] = list(getattr(tech_cfg, "parameter_hints", None) or [])
        global_hints: list[str] = list(getattr(self.cfg.extraction, "global_hints", None) or [])
        all_hints: set[str] = set(tech_hints) | set(global_hints)

        if all_hints:
            extracted_keys = {ev.parameter for ev in regex_values}
            if llm_params is not None:
                for fn in llm_params.__dataclass_fields__:
                    if fn not in ("notes", "confidence", "raw_response") and getattr(llm_params, fn) is not None:
                        extracted_keys.add(fn)
            matched_hints = extracted_keys.intersection(all_hints)
            min_hinted = int(getattr(self.cfg.extraction, "min_hinted_params", 1))
            if len(matched_hints) < min_hinted:
                logger.debug(
                    "Candidate for %s rejected: only %d/%d hinted params found "
                    "(need %d). Found hints: %s. All hints: %s",
                    tech_id, len(matched_hints), len(all_hints),
                    min_hinted, sorted(matched_hints), sorted(all_hints),
                )
                return False

        # 5c. Global minimum-params threshold
        min_params = int(getattr(self.cfg.extraction, "min_params_to_save", 1))
        total_extracted = len({ev.parameter for ev in regex_values})
        if llm_params is not None:
            for fn in llm_params.__dataclass_fields__:
                if fn not in ("notes", "confidence", "raw_response") and getattr(llm_params, fn) is not None:
                    total_extracted += 1
        if total_extracted < min_params:
            logger.debug(
                "Candidate for %s rejected: only %d param(s) extracted (min_params_to_save=%d)",
                tech_id, total_extracted, min_params,
            )
            return False

        # 6. Normalise → candidate
        candidate = self._normalizer.build_candidate(
            technology_id=tech_id,
            paper=paper,
            regex_values=regex_values,
            llm_params=llm_params,
        )
        if candidate is None:
            return False

        # 6b. Stamp the domain so approval can route it to the correct catalogue file.
        candidate["technology_domain"] = (
            getattr(tech_cfg, "domain", None) or _infer_domain(tech_id)
        )

        # 7. Validate extracted parameter bounds; attach warnings for admin review.
        from scrapers.validators import validate_params
        if candidate.get("extracted_params"):
            val_warnings = validate_params(candidate["extracted_params"])
            if val_warnings:
                candidate["validation_warnings"] = [w.to_dict() for w in val_warnings]
                logger.debug(
                    "Candidate for %s has %d validation warning(s).",
                    tech_id, len(val_warnings),
                )

        if self._candidates.has_similar_candidate(
            technology_id=tech_id,
            source=paper.source_name,
            paper_doi=paper.doi,
            paper_title=paper.title,
        ):
            logger.info(
                "Dedup skip (existing candidate) tech=%s source=%s doi=%s title=%s",
                tech_id,
                paper.source_name,
                paper.doi,
                (paper.title or "")[:80],
            )
            self._live_event(
                level="warning",
                message=(
                    f"Duplicate candidate skipped for '{tech_id}' from '{paper.source_name}' "
                    f"(paper: {paper.source_id})."
                ),
                technology_id=tech_id,
                source=paper.source_name,
                paper_id=paper.source_id,
                phase="dedup",
            )
            return False

        self._candidates.save_candidate(candidate)
        return True

    # ------------------------------------------------------------------
    # Candidate approval (called from API / CLI)
    # ------------------------------------------------------------------

    def approve_candidate(
        self,
        candidate_id: str,
        reviewed_by: str | None = None,
        notes: str = "",
        dry_run: bool = False,
    ) -> dict[str, Any] | None:
        """
        Approve a pending candidate and merge its proposed_instance into
        the main technology JSON catalogue file.

        Parameters
        ----------
        dry_run : if True, compute and return a merge preview without writing
                  anything.  Useful for admin review before finalising approval.

        Returns the updated candidate on success, None if not found.
        When dry_run=True returns a preview dict instead.
        """
        from scrapers.storage import CandidateStatus
        candidate = self._candidates.get_candidate(candidate_id)
        if candidate is None:
            return None

        tech_id  = candidate.get("technology_id", "")
        instance = candidate.get("proposed_instance")
        domain   = candidate.get("technology_domain") or _infer_domain(tech_id)

        if instance and tech_id:
            try:
                merge_preview = self._merge_instance_into_catalogue(
                    tech_id, instance, domain=domain, dry_run=dry_run
                )
            except Exception as exc:
                logger.error(
                    "Failed to merge instance for candidate %s: %s", candidate_id, exc
                )
                return None

            if dry_run:
                return {
                    "dry_run": True,
                    "candidate_id": candidate_id,
                    "technology_id": tech_id,
                    "merge_preview": merge_preview,
                    "validation_warnings": candidate.get("validation_warnings"),
                }

            # Also push the approved instance to Supabase technology_instances
            self._sb_upsert_approved_instance(tech_id, instance)
        elif dry_run:
            return {
                "dry_run": True,
                "candidate_id": candidate_id,
                "technology_id": tech_id,
                "merge_preview": None,
                "validation_warnings": candidate.get("validation_warnings"),
            }

        return self._candidates.update_status(
            candidate_id,
            CandidateStatus.APPROVED,
            review_notes=notes,
            reviewed_by=reviewed_by,
        )

    def _merge_instance_into_catalogue(
        self, tech_id: str, new_instance: dict[str, Any], *, domain: str | None = None, dry_run: bool = False
    ) -> dict[str, Any]:
        """
        Insert *new_instance* into the instances array of the catalogue JSON
        file that owns *tech_id*.  Raises if no catalogue file and no domain
        hint is available.  The write is atomic (temp file → rename).

        When *dry_run=True* returns a preview dict describing what would change
        without modifying the file.

        When *tech_id* does not exist in any catalogue file, a minimal stub
        technology card is created in the domain catalogue file so the instance
        has a home.  Admins can enrich the stub later.
        """
        import json
        from scrapers.storage import _atomic_write

        project_root = self.cfg.resolved_path("")
        data_dir     = project_root / "data"

        # Search for the catalogue file containing this technology
        catalogue_path: Path | None = None
        catalogue_data: dict | None = None

        for json_path in sorted(data_dir.rglob("*_technologies.json")):
            try:
                raw = json.loads(json_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            techs = raw.get("technologies", [])
            if any(t.get("technology_id") == tech_id for t in techs):
                catalogue_path = json_path
                catalogue_data = raw
                break

        if catalogue_path is None or catalogue_data is None:
            # ----------------------------------------------------------------
            # Tech not in any catalogue yet → create a stub tech card.
            # ----------------------------------------------------------------
            resolved_domain = domain or _infer_domain(tech_id)
            rel_path = _DOMAIN_CATALOGUE_FILES.get(resolved_domain)
            if rel_path is None:
                raise FileNotFoundError(
                    f"Cannot find catalogue JSON for technology_id='{tech_id}' "
                    f"and domain '{resolved_domain}' has no registered catalogue file."
                )
            project_root = self.cfg.resolved_path("")
            catalogue_path = project_root / rel_path
            try:
                raw = json.loads(catalogue_path.read_text(encoding="utf-8"))
            except Exception:
                raw = {"metadata": {}, "technologies": []}
            catalogue_data = raw

            stub = _build_tech_stub(tech_id, resolved_domain, new_instance)
            catalogue_data.setdefault("technologies", []).append(stub)
            logger.info(
                "Created stub tech card for '%s' in %s",
                tech_id, catalogue_path.name,
            )
            # Locate the newly added stub for the instance loop below

        # --- dry-run: return preview without writing ---
        if dry_run:
            new_instance_id = new_instance.get("instance_id")
            action = "append_new"
            is_stub = False
            for tech_entry in catalogue_data.get("technologies", []):
                if tech_entry.get("technology_id") == tech_id:
                    is_stub = bool(tech_entry.get("_auto_created"))
                    existing_ids = [i.get("instance_id") for i in tech_entry.get("instances", [])]
                    if new_instance_id in existing_ids:
                        action = "update_existing"
                    break
            return {
                "instance_id": new_instance_id,
                "action": "create_new_tech_then_append" if is_stub else action,
                "catalogue_file": str(catalogue_path),
                "fields_preview": list(new_instance.keys()),
            }

        def _is_blank(v: Any) -> bool:
            return v is None or (isinstance(v, str) and not v.strip())

        # Locate the technology entry
        for tech_entry in catalogue_data["technologies"]:
            if tech_entry.get("technology_id") == tech_id:
                instances = tech_entry.setdefault("instances", [])
                new_instance_id = new_instance.get("instance_id")
                existing = next((i for i in instances if i.get("instance_id") == new_instance_id), None)

                # If instance already exists, enrich it instead of skipping so repeated scrapes
                # can add newly discovered parameters/provenance.
                if existing is not None:
                    for key, value in new_instance.items():
                        if key not in existing or _is_blank(existing.get(key)):
                            existing[key] = value
                            continue

                        if isinstance(existing.get(key), dict) and isinstance(value, dict):
                            merged = dict(existing[key])
                            merged.update(value)
                            existing[key] = merged
                    logger.info(
                        "Merged updates into existing instance '%s' for %s",
                        new_instance_id,
                        tech_id,
                    )
                    break

                instances.append(new_instance)
                break

        # Update file metadata
        metadata = catalogue_data.setdefault("metadata", {})
        metadata["last_updated"] = datetime.now(timezone.utc).isoformat()

        _atomic_write(catalogue_path, catalogue_data)
        logger.info(
            "Merged instance '%s' into %s",
            new_instance.get("instance_id"), catalogue_path.name,
        )
        return {
            "instance_id": new_instance.get("instance_id"),
            "action": "append_new",
            "catalogue_file": str(catalogue_path),
            "fields_preview": list(new_instance.keys()),
        }

    def _sb_upsert_approved_instance(
        self, tech_id: str, instance: dict[str, Any]
    ) -> None:
        """Push an approved proposed_instance to Supabase technology_instances (best-effort)."""
        sb = getattr(self._candidates, "_sb", None)
        if sb is None:
            return  # Supabase not configured – file-only mode

        def _to_float(v: object) -> float | None:
            if v is None:
                return None
            try:
                return float(str(v).replace(",", "").split()[0])
            except (ValueError, AttributeError):
                return None

        instance_id = instance.get("instance_id") or instance.get("id")
        if not instance_id:
            logger.warning("_sb_upsert_approved_instance: missing instance_id, skipping")
            return

        row = {
            "instance_id":      instance_id,
            "technology_id":    tech_id,
            "instance_name":    instance.get("instance_name") or instance.get("name", instance_id),
            "country":          instance.get("country"),
            "country_iso2":     instance.get("country_iso2"),
            "country_inference_source": instance.get("country_inference_source"),
            "scale":            instance.get("scale"),
            "typical_capacity_mw":  _to_float(instance.get("typical_capacity_mw")),
            "capex_usd_per_kw":     _to_float(instance.get("capex_usd_per_kw")),
            "opex_fixed_usd_per_kw_yr": _to_float(instance.get("opex_fixed_usd_per_kw_yr")),
            "opex_var_usd_per_mwh": _to_float(instance.get("opex_var_usd_per_mwh")),
            "efficiency_percent":   _to_float(instance.get("efficiency_percent")),
            "lifetime_years":       _to_float(instance.get("lifetime_years")),
            "co2_emission_factor_operational_g_per_kwh": _to_float(
                instance.get("co2_emission_factor_operational_g_per_kwh")
            ),
            "reference_source": instance.get("reference_source") or instance.get("source"),
            "extra_fields": {
                k: v for k, v in instance.items()
                if k not in {
                    "instance_id", "id", "instance_name", "name", "scale",
                    "country", "country_iso2", "country_inference_source",
                    "typical_capacity_mw", "capex_usd_per_kw", "opex_fixed_usd_per_kw_yr",
                    "opex_var_usd_per_mwh", "efficiency_percent", "lifetime_years",
                    "co2_emission_factor_operational_g_per_kwh", "reference_source", "source",
                }
            },
        }
        try:
            sb.table("technology_instances").upsert(
                row, on_conflict="instance_id"
            ).execute()
            logger.info("Supabase: upserted approved instance '%s' for %s", instance_id, tech_id)
        except Exception as exc:
            logger.warning(
                "Supabase upsert for approved instance '%s' failed (non-fatal): %s",
                instance_id, exc,
            )

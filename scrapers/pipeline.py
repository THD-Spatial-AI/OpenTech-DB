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

import logging
import uuid
from datetime import datetime, timezone
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
    "crossref":         "scrapers.sources.crossref.CrossrefScraper",
    "arxiv":            "scrapers.sources.arxiv_source.ArXivScraper",
    "europe_pmc":       "scrapers.sources.europe_pmc.EuropePMCScraper",
}


def _load_scraper_class(dotted_path: str) -> type:
    module_path, cls_name = dotted_path.rsplit(".", 1)
    import importlib
    module = importlib.import_module(module_path)
    return getattr(module, cls_name)


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
        tech_ids: list[str] | None = None,
        sources:  list[str] | None = None,
    ) -> PipelineResult:
        """
        Execute a full pipeline run.

        Parameters
        ----------
        tech_ids : optional list of technology_ids to limit processing.
        sources  : optional list of source names to use (subset of enabled sources).
        """
        result = PipelineResult()
        logger.info("Pipeline run %s started.", result.run_id)

        enabled_sources = self.cfg.enabled_sources
        if sources:
            enabled_sources = [s for s in enabled_sources if s in sources]

        technology_ids = list(self.cfg.technologies.keys())
        if tech_ids:
            technology_ids = [t for t in technology_ids if t in tech_ids]

        # Track DOIs seen this run for deduplication
        seen_doi_this_run: set[str] = set()

        for tech_id in technology_ids:
            tech_cfg = self.cfg.technologies.get(tech_id)
            if not tech_cfg:
                continue

            queries = getattr(tech_cfg, "search_queries", [])
            if not queries:
                continue

            result.technologies_processed += 1
            logger.info("Processing technology: %s", tech_id)

            for source_name in enabled_sources:
                try:
                    papers = self._fetch_papers(
                        source_name, tech_id, queries, result
                    )
                except Exception as exc:
                    msg = f"Source {source_name} failed for {tech_id}: {exc}"
                    logger.warning(msg)
                    result.errors.append(msg)
                    continue

                for paper in papers:
                    result.papers_fetched += 1

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
                    except Exception as exc:
                        msg = f"Processing failed for {paper.source_id}: {exc}"
                        logger.warning(msg)
                        result.errors.append(msg)

        result.finish()
        self._candidates.log_run(result.to_dict())

        logger.info(
            "Pipeline run %s finished: %d technologies, %d papers, %d candidates, %d errors.",
            result.run_id,
            result.technologies_processed,
            result.papers_fetched,
            result.candidates_created,
            len(result.errors),
        )
        return result

    # ------------------------------------------------------------------
    # Internal steps
    # ------------------------------------------------------------------

    def _fetch_papers(
        self,
        source_name: str,
        tech_id: str,
        queries: list[str],
        result: PipelineResult,
    ) -> list[PaperRecord]:
        cls_path = _SOURCE_CLASSES.get(source_name)
        if not cls_path:
            return []

        try:
            cls = _load_scraper_class(cls_path)
        except (ImportError, AttributeError) as exc:
            logger.warning("Could not load scraper %s: %s", source_name, exc)
            return []

        with cls(self.cfg) as scraper:
            papers = scraper.search(tech_id, queries)
            # Save raw API response
            raw_payload = [p.to_dict() for p in papers]
            self._raw_store.save(source_name, tech_id, result.run_id, raw_payload)
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

        # 6. Normalise → candidate
        candidate = self._normalizer.build_candidate(
            technology_id=tech_id,
            paper=paper,
            regex_values=regex_values,
            llm_params=llm_params,
        )
        if candidate is None:
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
    ) -> dict[str, Any] | None:
        """
        Approve a pending candidate and merge its proposed_instance into
        the main technology JSON catalogue file.

        Returns the updated candidate on success, None if not found.
        """
        from scrapers.storage import CandidateStatus
        candidate = self._candidates.get_candidate(candidate_id)
        if candidate is None:
            return None

        tech_id   = candidate.get("technology_id", "")
        instance  = candidate.get("proposed_instance")

        if instance and tech_id:
            try:
                self._merge_instance_into_catalogue(tech_id, instance)
            except Exception as exc:
                logger.error(
                    "Failed to merge instance for candidate %s: %s", candidate_id, exc
                )
                return None

        return self._candidates.update_status(
            candidate_id,
            CandidateStatus.APPROVED,
            review_notes=notes,
            reviewed_by=reviewed_by,
        )

    def _merge_instance_into_catalogue(
        self, tech_id: str, new_instance: dict[str, Any]
    ) -> None:
        """
        Insert *new_instance* into the instances array of the catalogue JSON
        file that owns *tech_id*.  Raises if the catalogue file is not found.
        The write is atomic (temp file → rename).
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
            raise FileNotFoundError(
                f"Cannot find catalogue JSON for technology_id='{tech_id}'"
            )

        # Locate the technology entry
        for tech_entry in catalogue_data["technologies"]:
            if tech_entry.get("technology_id") == tech_id:
                instances = tech_entry.setdefault("instances", [])
                # Avoid duplicate instance_ids
                existing_ids = {i.get("instance_id") for i in instances}
                if new_instance.get("instance_id") in existing_ids:
                    logger.warning(
                        "Instance %s already exists in %s – skipping merge.",
                        new_instance.get("instance_id"), tech_id,
                    )
                    return
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

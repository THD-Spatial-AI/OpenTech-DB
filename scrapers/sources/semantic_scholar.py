"""
scrapers/sources/semantic_scholar.py
=====================================
Semantic Scholar (S2) scraper.

Free academic search API by Allen Institute for AI.
https://api.semanticscholar.org/graph/v1/paper/search

Rate limits (unauthenticated): 100 req per 5 minutes.
Rate limits (with API key):    1 000 req per 5 minutes.
API key (free): https://www.semanticscholar.org/product/api
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from scrapers.base import BaseScraper, PaperRecord
from scrapers.config import ScraperConfig

logger = logging.getLogger(__name__)

_BASE = "https://api.semanticscholar.org/graph/v1"
_FIELDS = (
    "paperId,externalIds,title,year,authors,abstract,"
    "openAccessPdf,url,venue,publicationTypes"
)


class SemanticScholarScraper(BaseScraper):
    source_name = "semantic_scholar"

    def __init__(self, cfg: ScraperConfig) -> None:
        super().__init__(cfg)
        src_cfg = getattr(cfg.sources, "semantic_scholar", None)
        self._max_results = getattr(src_cfg, "max_results_per_tech", 20)
        self._lookback    = getattr(src_cfg, "lookback_months", 18)
        api_key           = getattr(src_cfg, "api_key", None)
        self._extra_headers: dict[str, str] = {}
        if api_key:
            self._extra_headers["x-api-key"] = api_key

    # ------------------------------------------------------------------

    def search(
        self,
        technology_id: str,
        queries: list[str],
        **kwargs: Any,
    ) -> list[PaperRecord]:
        seen: set[str] = set()
        results: list[PaperRecord] = []
        min_year = date.today().year - (self._lookback // 12 + 2)

        for query in queries:
            logger.info("[S2] tech=%s | query=%r", technology_id, query)
            params: dict[str, Any] = {
                "query": query,
                "limit": self._max_results,
                "fields": _FIELDS,
                "year": f"{min_year}-",
            }
            data = self._get_json(
                f"{_BASE}/paper/search",
                params=params,
                extra_headers=self._extra_headers,
            )
            if not data:
                continue

            for paper in data.get("data", []):
                record = self._parse_paper(paper)
                if record and record.dedup_key not in seen:
                    seen.add(record.dedup_key)
                    results.append(record)

        logger.info("[S2] tech=%s → %d unique records", technology_id, len(results))
        return results

    # ------------------------------------------------------------------

    def _parse_paper(self, paper: dict) -> PaperRecord | None:
        try:
            title = paper.get("title") or ""
            if not title:
                return None

            ext_ids = paper.get("externalIds") or {}
            doi = ext_ids.get("DOI")

            year = paper.get("year")

            authors = [
                a.get("name", "")
                for a in (paper.get("authors") or [])
                if a.get("name")
            ]

            abstract = paper.get("abstract") or ""

            pdf_info = paper.get("openAccessPdf") or {}
            pdf_url = pdf_info.get("url")

            return PaperRecord(
                source_name=self.source_name,
                source_id=paper.get("paperId", ""),
                title=title,
                doi=doi,
                year=year,
                authors=authors,
                abstract=abstract,
                open_access_pdf_url=pdf_url,
                url=paper.get("url"),
                venue=paper.get("venue"),
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("[S2] Parse error: %s", exc)
            return None

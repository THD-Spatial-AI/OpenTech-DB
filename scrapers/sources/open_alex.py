"""
scrapers/sources/open_alex.py
==============================
OpenAlex source scraper.

OpenAlex (https://openalex.org) is a fully open, free bibliographic database
with 250 M+ works. No API key required; use the "polite pool" by including
your email in the User-Agent header (already done in BaseScraper).

API docs: https://docs.openalex.org/api-entities/works/search-works
Rate limits: 10 req/s (polite pool), 100 k req/day without key.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from scrapers.base import BaseScraper, PaperRecord
from scrapers.config import ScraperConfig

logger = logging.getLogger(__name__)

_BASE = "https://api.openalex.org"


class OpenAlexScraper(BaseScraper):
    source_name = "open_alex"

    def __init__(self, cfg: ScraperConfig) -> None:
        super().__init__(cfg)
        src_cfg = getattr(cfg.sources, "open_alex", None)
        self._max_results  = getattr(src_cfg, "max_results_per_tech", 20)
        self._lookback     = getattr(src_cfg, "lookback_months", 18)
        api_key            = getattr(src_cfg, "api_key", None)
        self._extra_headers: dict[str, str] = {}
        if api_key:
            self._extra_headers["Authorization"] = f"Bearer {api_key}"

    # ------------------------------------------------------------------

    def search(
        self,
        technology_id: str,
        queries: list[str],
        **kwargs: Any,
    ) -> list[PaperRecord]:
        """Search OpenAlex for papers matching each query string."""
        seen: set[str] = set()
        results: list[PaperRecord] = []

        from_date = (date.today() - timedelta(days=self._lookback * 30)).isoformat()

        for query in queries:
            logger.info("[OpenAlex] tech=%s | query=%r", technology_id, query)
            params = {
                "search": query,
                "filter": f"from_publication_date:{from_date},type:article",
                "select": (
                    "id,doi,title,publication_year,authorships,"
                    "abstract_inverted_index,best_oa_location,primary_location,"
                    "concepts"
                ),
                "per-page": self._max_results,
                "sort": "relevance_score:desc",
            }
            if self._extra_headers.get("Authorization"):
                params["api_key"] = self._extra_headers["Authorization"].split()[-1]

            data = self._get_json(
                f"{_BASE}/works",
                params=params,
                extra_headers=self._extra_headers,
            )
            if not data:
                continue

            for work in data.get("results", []):
                record = self._parse_work(work, technology_id)
                if record and record.dedup_key not in seen:
                    seen.add(record.dedup_key)
                    results.append(record)

        logger.info("[OpenAlex] tech=%s → %d unique records", technology_id, len(results))
        return results

    # ------------------------------------------------------------------
    # Parsers
    # ------------------------------------------------------------------

    def _parse_work(self, work: dict, tech_id: str) -> PaperRecord | None:
        try:
            title = work.get("title") or ""
            if not title:
                return None

            doi = work.get("doi")
            if doi and doi.startswith("https://doi.org/"):
                doi = doi[len("https://doi.org/"):]

            year = work.get("publication_year")
            authors = [
                a.get("author", {}).get("display_name", "")
                for a in (work.get("authorships") or [])
                if a.get("author", {}).get("display_name")
            ]

            abstract = self._decode_abstract(work.get("abstract_inverted_index") or {})

            # Open access PDF
            pdf_url: str | None = None
            oa = work.get("best_oa_location") or {}
            pdf_url = oa.get("pdf_url")

            # Landing page URL
            url: str | None = None
            loc = work.get("primary_location") or {}
            url = loc.get("landing_page_url") or work.get("id")

            venue: str | None = None
            src = loc.get("source") or {}
            venue = src.get("display_name")

            countries_set: set[str] = set()
            for auth in (work.get("authorships") or []):
                for c in (auth.get("countries") or []):
                    if isinstance(c, str) and len(c) == 2:
                        countries_set.add(c.upper())

            return PaperRecord(
                source_name=self.source_name,
                source_id=work.get("id", ""),
                title=title,
                doi=doi,
                year=year,
                authors=authors,
                abstract=abstract,
                open_access_pdf_url=pdf_url,
                url=url,
                venue=venue,
                countries=sorted(countries_set),
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("[OpenAlex] Parse error for work: %s", exc)
            return None

    @staticmethod
    def _decode_abstract(inv_index: dict[str, list[int]]) -> str:
        """Reconstruct abstract text from OpenAlex inverted index format."""
        if not inv_index:
            return ""
        max_pos = max(pos for positions in inv_index.values() for pos in positions)
        words = [""] * (max_pos + 1)
        for word, positions in inv_index.items():
            for pos in positions:
                words[pos] = word
        return " ".join(words)

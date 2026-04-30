"""
scrapers/sources/europe_pmc.py
================================
Europe PMC (PubMed Central Europe) source scraper.

Europe PMC indexes life-science and engineering literature via a free REST API.
Useful for energy systems papers from applied energy, sustainability, etc.

API docs: https://europepmc.org/RestfulWebService
Rate limits: ~10 req/s, no key required.
"""

from __future__ import annotations

import logging
from typing import Any

from scrapers.base import BaseScraper, PaperRecord
from scrapers.config import ScraperConfig

logger = logging.getLogger(__name__)

_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest"


class EuropePMCScraper(BaseScraper):
    source_name = "europe_pmc"

    def __init__(self, cfg: ScraperConfig) -> None:
        super().__init__(cfg)
        src_cfg = getattr(cfg.sources, "europe_pmc", None)
        self._max_results = getattr(src_cfg, "max_results_per_tech", 30)
        self._lookback    = getattr(src_cfg, "lookback_months", 36)

    def search(self, technology_id: str, queries: list[str], **kwargs: Any) -> list[PaperRecord]:
        seen: set[str] = set()
        results: list[PaperRecord] = []
        from datetime import date
        min_year = date.today().year - (self._lookback // 12 + 1)

        for query in queries:
            if len(results) >= self._max_results:
                break
            logger.info("[EuropePMC] tech=%s | query=%r", technology_id, query)

            # Add year filter to query
            full_query = f"({query}) AND (PUB_YEAR:[{min_year} TO 9999])"
            params: dict[str, Any] = {
                "query":         full_query,
                "format":        "json",
                "resultType":    "core",
                "pageSize":      min(self._max_results, 100),
                "sort":          "RELEVANCE",
            }
            data = self._get_json(f"{_BASE}/search", params=params)
            if not data:
                continue

            for article in (data.get("resultList") or {}).get("result") or []:
                record = self._parse_article(article)
                if record and record.dedup_key not in seen:
                    seen.add(record.dedup_key)
                    results.append(record)
                    if len(results) >= self._max_results:
                        break

        logger.info("[EuropePMC] tech=%s → %d records", technology_id, len(results))
        return results

    def _parse_article(self, art: dict) -> PaperRecord | None:
        try:
            title = (art.get("title") or "").strip()
            if not title:
                return None

            doi    = art.get("doi")
            year   = int(art.get("pubYear", 0)) or None
            url    = art.get("fullTextUrlList", {}).get("fullTextUrl", [{}])[0].get("url") if art.get("fullTextUrlList") else None
            if not url and doi:
                url = f"https://doi.org/{doi}"

            authors: list[str] = []
            for a in (art.get("authorList") or {}).get("author") or []:
                fullname = a.get("fullName") or f"{a.get('firstName','')} {a.get('lastName','')}".strip()
                if fullname:
                    authors.append(fullname)

            abstract = (art.get("abstractText") or "").strip()
            venue    = art.get("journalTitle") or art.get("bookOrReportDetails", {}).get("publisher")

            return PaperRecord(
                source_name=self.source_name,
                source_id=f"epmc:{art.get('id', title[:40])}",
                title=title,
                doi=doi,
                year=year,
                authors=authors,
                abstract=abstract,
                url=url,
                venue=venue,
            )
        except Exception as exc:
            logger.debug("EuropePMC parse error: %s", exc)
            return None

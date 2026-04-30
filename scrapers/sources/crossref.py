"""
scrapers/sources/crossref.py
=============================
Crossref REST API source scraper.

Crossref is the DOI registration agency. Their free REST API gives access
to metadata for 140 M+ scholarly works – no API key required (polite pool
via email in User-Agent).

API docs: https://api.crossref.org/swagger-ui/index.html
Rate limits: 50 req/s polite pool; unlimited rows with cursor pagination.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from scrapers.base import BaseScraper, PaperRecord
from scrapers.config import ScraperConfig

logger = logging.getLogger(__name__)

_BASE = "https://api.crossref.org"


class CrossrefScraper(BaseScraper):
    source_name = "crossref"

    def __init__(self, cfg: ScraperConfig) -> None:
        super().__init__(cfg)
        src_cfg = getattr(cfg.sources, "crossref", None)
        self._max_results = getattr(src_cfg, "max_results_per_tech", 40)
        self._lookback    = getattr(src_cfg, "lookback_months", 36)
        email = getattr(cfg.http, "contact_email", "opentech-db@example.com")
        self._polite_header = {"User-Agent": f"OpenTechDB/1.0 (mailto:{email})"}

    def search(self, technology_id: str, queries: list[str], **kwargs: Any) -> list[PaperRecord]:
        seen: set[str] = set()
        results: list[PaperRecord] = []
        from_year = date.today().year - (self._lookback // 12 + 1)

        for query in queries:
            if len(results) >= self._max_results:
                break
            logger.info("[Crossref] tech=%s | query=%r", technology_id, query)
            params: dict[str, Any] = {
                "query": query,
                "filter": f"from-pub-date:{from_year},type:journal-article",
                "select": "DOI,title,author,published,abstract,URL,container-title,is-referenced-by-count",
                "rows": min(self._max_results, 100),
                "sort": "relevance",
                "order": "desc",
            }
            data = self._get_json(
                f"{_BASE}/works",
                params=params,
                extra_headers=self._polite_header,
            )
            if not data:
                continue

            for item in (data.get("message") or {}).get("items", []):
                record = self._parse_item(item, technology_id)
                if record and record.dedup_key not in seen:
                    seen.add(record.dedup_key)
                    results.append(record)
                    if len(results) >= self._max_results:
                        break

        logger.info("[Crossref] tech=%s → %d records", technology_id, len(results))
        return results

    def _parse_item(self, item: dict, technology_id: str) -> PaperRecord | None:
        try:
            title_list = item.get("title") or []
            title = title_list[0] if title_list else ""
            if not title:
                return None

            doi = item.get("DOI")
            url = item.get("URL") or (f"https://doi.org/{doi}" if doi else None)

            year: int | None = None
            pub = item.get("published") or item.get("published-print") or {}
            dp = pub.get("date-parts") or []
            if dp and dp[0]:
                year = int(dp[0][0])

            authors = []
            for a in (item.get("author") or []):
                given  = a.get("given", "")
                family = a.get("family", "")
                name   = f"{given} {family}".strip() if given or family else a.get("name", "")
                if name:
                    authors.append(name)

            venue_list = item.get("container-title") or []
            venue = venue_list[0] if venue_list else None

            abstract = item.get("abstract")
            if abstract:
                # Strip JATS XML tags (Crossref often wraps abstracts)
                import re
                abstract = re.sub(r"<[^>]+>", " ", abstract).strip()

            return PaperRecord(
                source_name=self.source_name,
                source_id=f"crossref:{doi or title[:40]}",
                title=title,
                doi=doi,
                year=year,
                authors=authors,
                abstract=abstract or "",
                url=url,
                venue=venue,
            )
        except Exception as exc:
            logger.debug("Crossref parse error: %s", exc)
            return None

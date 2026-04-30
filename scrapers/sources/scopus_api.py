"""
scrapers/sources/scopus_api.py
==============================
Elsevier Scopus scraper (optional – requires an institutional API key).

Scopus is a comprehensive bibliographic database covering 90 M+ records.
Access requires an API key from https://dev.elsevier.com.

The scraper uses the Scopus Search API directly via httpx.
If the optional `pybliometrics` package is installed and configured, that
can be used instead – but the direct API route avoids that dependency.

Environment variables required (set before enabling this source):
    SCOPUS_API_KEY   – Elsevier API key
    SCOPUS_INST_TOKEN – (optional) Institutional token for full-text access

API docs: https://dev.elsevier.com/documentation/ScopusSearchAPI.wadl
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from scrapers.base import BaseScraper, PaperRecord
from scrapers.config import ScraperConfig

logger = logging.getLogger(__name__)

_SEARCH_URL = "https://api.elsevier.com/content/search/scopus"


class ScopusScraper(BaseScraper):
    source_name = "scopus"

    def __init__(self, cfg: ScraperConfig) -> None:
        super().__init__(cfg)
        src_cfg = getattr(cfg.sources, "scopus", None)
        self._max_results = getattr(src_cfg, "max_results_per_tech", 15)
        self._lookback    = getattr(src_cfg, "lookback_months", 18)
        self._api_key     = getattr(src_cfg, "api_key", None) or ""
        self._inst_token  = getattr(src_cfg, "inst_token", None) or ""

        if not self._api_key:
            logger.warning("[Scopus] No API key configured – Scopus scraper will not return results.")

    # ------------------------------------------------------------------

    def search(
        self,
        technology_id: str,
        queries: list[str],
        **kwargs: Any,
    ) -> list[PaperRecord]:
        if not self._api_key:
            return []

        seen: set[str] = set()
        results: list[PaperRecord] = []
        min_year = date.today().year - (self._lookback // 12 + 2)

        headers = {
            "X-ELS-ApiKey": self._api_key,
            "Accept": "application/json",
        }
        if self._inst_token:
            headers["X-ELS-Insttoken"] = self._inst_token

        for query in queries:
            # Scopus query language: wrap in TITLE-ABS-KEY
            scopus_query = f'TITLE-ABS-KEY("{query}") AND PUBYEAR > {min_year - 1}'
            logger.info("[Scopus] tech=%s | query=%r", technology_id, query[:60])

            params: dict[str, Any] = {
                "query":  scopus_query,
                "count":  self._max_results,
                "field":  "dc:identifier,dc:title,prism:doi,prism:coverDate,"
                          "dc:creator,prism:publicationName,dc:description,"
                          "prism:url,openaccess",
                "sort":   "relevancy",
            }
            data = self._get_json(_SEARCH_URL, params=params, extra_headers=headers)
            if not data:
                continue

            search_results = (
                data.get("search-results", {})
                    .get("entry", [])
            )
            for entry in search_results:
                record = self._parse_entry(entry)
                if record and record.dedup_key not in seen:
                    seen.add(record.dedup_key)
                    results.append(record)

        logger.info("[Scopus] tech=%s → %d unique records", technology_id, len(results))
        return results

    # ------------------------------------------------------------------

    def _parse_entry(self, entry: dict) -> PaperRecord | None:
        try:
            title = entry.get("dc:title") or ""
            if not title:
                return None

            doi = entry.get("prism:doi")
            authors_raw = entry.get("dc:creator") or ""
            authors = [a.strip() for a in authors_raw.split(";") if a.strip()]

            # Parse year from cover date (YYYY-MM-DD or YYYY)
            cover_date = entry.get("prism:coverDate") or ""
            year: int | None = None
            if cover_date:
                try:
                    year = int(cover_date[:4])
                except ValueError:
                    pass

            abstract = entry.get("dc:description") or ""
            url = entry.get("prism:url") or entry.get("link", [{}])[0].get("@href")
            venue = entry.get("prism:publicationName")

            # Scopus doesn't provide direct PDF URLs; mark OA if flagged
            open_access = entry.get("openaccess") == "1"
            pdf_url: str | None = None
            if open_access and doi:
                pdf_url = f"https://doi.org/{doi}"  # placeholder – actual PDF via Unpaywall

            return PaperRecord(
                source_name=self.source_name,
                source_id=entry.get("dc:identifier", ""),
                title=title,
                doi=doi,
                year=year,
                authors=authors,
                abstract=abstract,
                open_access_pdf_url=pdf_url,
                url=str(url) if url else None,
                venue=venue,
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("[Scopus] Parse error: %s", exc)
            return None

"""
scrapers/sources/scholarly_gs.py
=================================
Google Scholar scraper via the `scholarly` library.

WARNING: Google Scholar aggressively blocks automated access.
This source is DISABLED by default (scholarly.enabled = false in scraper_config.yaml).
Enable only if:
  (a) you have a ScraperAPI proxy key set via SCRAPERAPI_KEY env var, OR
  (b) you accept the risk of getting your IP temporarily blocked.

Install the optional dependency:
    pip install scholarly

Usage:
    Set SCRAPERAPI_KEY env var and enable in scraper_config.yaml.
"""

from __future__ import annotations

import logging
from typing import Any

from scrapers.base import BaseScraper, PaperRecord
from scrapers.config import ScraperConfig

logger = logging.getLogger(__name__)


class GoogleScholarScraper(BaseScraper):
    source_name = "google_scholar"

    def __init__(self, cfg: ScraperConfig) -> None:
        super().__init__(cfg)
        src_cfg = getattr(cfg.sources, "google_scholar", None)
        self._max_results = getattr(src_cfg, "max_results_per_tech", 10)
        self._lookback    = getattr(src_cfg, "lookback_months", 18)
        self._proxy_key   = getattr(src_cfg, "proxy_key", None)
        self._scholarly   = None

        try:
            import scholarly as _scholarly_lib
            self._scholarly = _scholarly_lib
            if self._proxy_key:
                from scholarly import ProxyGenerator
                pg = ProxyGenerator()
                try:
                    pg.ScraperAPI(self._proxy_key)
                    _scholarly_lib.use_proxy(pg)
                    logger.info("[GoogleScholar] ScraperAPI proxy configured.")
                except Exception as exc:
                    logger.warning("[GoogleScholar] Proxy setup failed: %s", exc)
            else:
                logger.warning(
                    "[GoogleScholar] No proxy key – Google Scholar may block requests."
                )
        except ImportError:
            logger.warning(
                "[GoogleScholar] `scholarly` package not installed. "
                "Run `pip install scholarly` to enable this source."
            )

    # ------------------------------------------------------------------

    def search(
        self,
        technology_id: str,
        queries: list[str],
        **kwargs: Any,
    ) -> list[PaperRecord]:
        if not self._scholarly:
            return []

        seen: set[str] = set()
        results: list[PaperRecord] = []
        from datetime import date
        min_year = date.today().year - (self._lookback // 12 + 2)

        for query in queries:
            logger.info("[GoogleScholar] tech=%s | query=%r", technology_id, query)
            try:
                search_gen = self._scholarly.search_pubs(query)
                count = 0
                for pub in search_gen:
                    if count >= self._max_results:
                        break
                    record = self._parse_pub(pub, min_year)
                    if record and record.dedup_key not in seen:
                        seen.add(record.dedup_key)
                        results.append(record)
                        count += 1
            except Exception as exc:
                logger.warning("[GoogleScholar] Search failed for query %r: %s", query, exc)
                # Do not retry – Google Scholar may have blocked us
                break

        logger.info("[GoogleScholar] tech=%s → %d records", technology_id, len(results))
        return results

    # ------------------------------------------------------------------

    def _parse_pub(self, pub: dict, min_year: int) -> PaperRecord | None:
        try:
            bib = pub.get("bib") or {}
            title = bib.get("title") or ""
            if not title:
                return None

            year_raw = bib.get("pub_year")
            year: int | None = None
            if year_raw:
                try:
                    year = int(year_raw)
                except ValueError:
                    pass
            if year and year < min_year:
                return None

            abstract = bib.get("abstract") or ""
            authors_raw = bib.get("author") or ""
            authors = [a.strip() for a in authors_raw.split(" and ") if a.strip()]
            url = pub.get("pub_url") or None

            return PaperRecord(
                source_name=self.source_name,
                source_id=pub.get("url_scholarbib", title[:64]),
                title=title,
                doi=None,            # scholarly rarely provides DOIs directly
                year=year,
                authors=authors,
                abstract=abstract,
                url=url,
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("[GoogleScholar] Parse error: %s", exc)
            return None

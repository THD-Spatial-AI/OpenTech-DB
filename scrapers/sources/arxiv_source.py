"""
scrapers/sources/arxiv_source.py
==================================
arXiv preprint scraper.

arXiv is a free preprint server hosting 2 M+ papers in physics, engineering,
economics, CS, etc. Many energy systems / techno-economic papers appear here
before formal journal publication.

API docs: https://arxiv.org/help/api/user-manual
Rate limits: ~3 req/s, no key required.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from typing import Any
from urllib.parse import urlencode

from scrapers.base import BaseScraper, PaperRecord
from scrapers.config import ScraperConfig

logger = logging.getLogger(__name__)

_BASE = "https://export.arxiv.org/api/query"
_NS   = "http://www.w3.org/2005/Atom"
_ARXIV_NS = "http://arxiv.org/schemas/atom"


class ArXivScraper(BaseScraper):
    source_name = "arxiv"

    def __init__(self, cfg: ScraperConfig) -> None:
        super().__init__(cfg)
        src_cfg = getattr(cfg.sources, "arxiv", None)
        self._max_results = getattr(src_cfg, "max_results_per_tech", 30)
        self._lookback    = getattr(src_cfg, "lookback_months", 24)

    def search(self, technology_id: str, queries: list[str], **kwargs: Any) -> list[PaperRecord]:
        seen: set[str] = set()
        results: list[PaperRecord] = []

        for query in queries:
            if len(results) >= self._max_results:
                break
            logger.info("[arXiv] tech=%s | query=%r", technology_id, query)

            # arXiv search: search in title + abstract
            search_query = f"all:{query}"
            params = {
                "search_query": search_query,
                "max_results": min(self._max_results, 100),
                "sortBy": "relevance",
                "sortOrder": "descending",
            }
            url = f"{_BASE}?{urlencode(params)}"
            xml_text = self._get_raw(url)
            if not xml_text:
                continue

            try:
                root = ET.fromstring(xml_text)
            except ET.ParseError as exc:
                logger.debug("arXiv XML parse error: %s", exc)
                continue

            for entry in root.findall(f"{{{_NS}}}entry"):
                record = self._parse_entry(entry)
                if record and record.dedup_key not in seen:
                    seen.add(record.dedup_key)
                    results.append(record)
                    if len(results) >= self._max_results:
                        break

        logger.info("[arXiv] tech=%s → %d records", technology_id, len(results))
        return results

    def _parse_entry(self, entry: ET.Element) -> PaperRecord | None:
        try:
            title_el = entry.find(f"{{{_NS}}}title")
            title    = (title_el.text or "").strip().replace("\n", " ") if title_el is not None else ""
            if not title:
                return None

            id_el  = entry.find(f"{{{_NS}}}id")
            arxiv_id = (id_el.text or "").strip() if id_el is not None else ""
            # arXiv IDs look like http://arxiv.org/abs/2311.12345v2 – extract just the id part
            arxiv_short = re.search(r"abs/([^v]+)", arxiv_id)
            paper_id = arxiv_short.group(1) if arxiv_short else arxiv_id

            # DOI (sometimes included)
            doi_el = entry.find(f"{{{_ARXIV_NS}}}doi")
            doi    = doi_el.text.strip() if doi_el is not None and doi_el.text else None

            # Year from published date
            pub_el = entry.find(f"{{{_NS}}}published")
            year: int | None = None
            if pub_el is not None and pub_el.text:
                m = re.match(r"(\d{4})", pub_el.text.strip())
                if m:
                    year = int(m.group(1))

            # Authors
            authors = []
            for author_el in entry.findall(f"{{{_NS}}}author"):
                name_el = author_el.find(f"{{{_NS}}}name")
                if name_el is not None and name_el.text:
                    authors.append(name_el.text.strip())

            # Abstract
            abs_el   = entry.find(f"{{{_NS}}}summary")
            abstract = (abs_el.text or "").strip().replace("\n", " ") if abs_el is not None else ""

            # PDF link
            pdf_url: str | None = None
            for link in entry.findall(f"{{{_NS}}}link"):
                if link.get("title") == "pdf":
                    pdf_url = link.get("href")
                    break

            html_url = arxiv_id if arxiv_id.startswith("http") else f"https://arxiv.org/abs/{paper_id}"

            return PaperRecord(
                source_name=self.source_name,
                source_id=f"arxiv:{paper_id}",
                title=title,
                doi=doi,
                year=year,
                authors=authors,
                abstract=abstract,
                url=html_url,
                open_access_pdf_url=pdf_url,
                venue="arXiv preprint",
            )
        except Exception as exc:
            logger.debug("arXiv entry parse error: %s", exc)
            return None

    def _get_raw(self, url: str) -> str | None:
        """Fetch raw text (XML) using the base HTTP client."""
        import httpx
        try:
            resp = httpx.get(url, headers={"User-Agent": self.cfg.user_agent},
                             timeout=self.cfg.http.timeout_seconds, follow_redirects=True)
            if resp.status_code == 200:
                return resp.text
        except Exception as exc:
            logger.debug("arXiv fetch error: %s", exc)
        return None

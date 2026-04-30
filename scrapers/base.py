"""
scrapers/base.py
================
BaseScraper – shared HTTP client, rate limiting, retry logic, and disk cache
for all external source scrapers.

Design principles
-----------------
* Polite  – honours rate limits and robots.txt conventions.
* Robust  – exponential back-off on 429/503; never crashes the main app.
* Cacheable – raw HTTP responses are optionally cached to disk (TTL-based)
  so re-runs within 24 h don't re-fetch already-seen papers.
* Traceable – every response records source URL and timestamp.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from scrapers.config import ScraperConfig

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

class PaperRecord:
    """
    A normalised representation of a single academic paper or data record
    returned by any source scraper.

    All fields are optional except *source_id* + *source_name*.
    """

    __slots__ = (
        "source_name", "source_id", "doi", "title", "year",
        "authors", "abstract", "full_text",
        "open_access_pdf_url", "url", "venue",
        "fetched_at",
    )

    def __init__(
        self,
        source_name: str,
        source_id: str,
        title: str = "",
        doi: str | None = None,
        year: int | None = None,
        authors: list[str] | None = None,
        abstract: str = "",
        full_text: str = "",
        open_access_pdf_url: str | None = None,
        url: str | None = None,
        venue: str | None = None,
    ) -> None:
        self.source_name = source_name
        self.source_id   = source_id
        self.doi         = doi
        self.title       = title
        self.year        = year
        self.authors     = authors or []
        self.abstract    = abstract
        self.full_text   = full_text
        self.open_access_pdf_url = open_access_pdf_url
        self.url         = url
        self.venue       = venue
        self.fetched_at  = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict[str, Any]:
        return {s: getattr(self, s) for s in self.__slots__}

    # Stable dedup key (prefer DOI, fall back to title hash)
    @property
    def dedup_key(self) -> str:
        if self.doi:
            return f"doi:{self.doi.lower().strip()}"
        return f"title:{hashlib.md5(self.title.lower().encode()).hexdigest()}"


# ---------------------------------------------------------------------------
# HTTP Cache (simple disk-based, TTL-aware)
# ---------------------------------------------------------------------------

class _DiskCache:
    def __init__(self, cache_dir: Path, ttl_hours: float = 24.0) -> None:
        self._dir = cache_dir
        self._ttl = ttl_hours * 3600
        self._dir.mkdir(parents=True, exist_ok=True)

    def _key_path(self, url: str, params: dict | None) -> Path:
        raw = url + json.dumps(params or {}, sort_keys=True)
        key = hashlib.sha256(raw.encode()).hexdigest()
        return self._dir / f"{key}.json"

    def get(self, url: str, params: dict | None = None) -> dict | None:
        path = self._key_path(url, params)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            age = time.time() - data["__cached_at"]
            if age > self._ttl:
                path.unlink(missing_ok=True)
                return None
            return data["response"]
        except Exception:
            return None

    def set(self, url: str, params: dict | None, response: Any) -> None:
        path = self._key_path(url, params)
        try:
            payload = {"__cached_at": time.time(), "response": response}
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        except Exception as exc:
            logger.warning("Cache write failed: %s", exc)


# ---------------------------------------------------------------------------
# Base scraper
# ---------------------------------------------------------------------------

class BaseScraper(ABC):
    """
    Abstract base class for all source scrapers.

    Sub-classes must implement :meth:`search` which queries the external
    source and returns a list of :class:`PaperRecord` objects.
    """

    #: Human-readable name used in logging and candidate metadata.
    source_name: str = "base"

    def __init__(self, cfg: ScraperConfig) -> None:
        self.cfg = cfg
        self._cache: _DiskCache | None = None

        http_cfg = cfg.http
        if getattr(http_cfg, "cache_enabled", True):
            cache_dir = cfg.resolved_path(
                getattr(http_cfg, "cache_dir", "data/scraped/http_cache")
            )
            ttl = getattr(http_cfg, "cache_ttl_hours", 24)
            self._cache = _DiskCache(cache_dir, ttl_hours=ttl)

        self._timeout  = getattr(http_cfg, "timeout_seconds", 30)
        self._retries  = getattr(http_cfg, "max_retries", 3)
        self._backoff  = getattr(http_cfg, "retry_backoff_seconds", 2.0)
        self._delay    = getattr(http_cfg, "rate_limit_delay", 1.5)
        self._last_req = 0.0

        self._client = httpx.Client(
            headers={"User-Agent": cfg.user_agent},
            timeout=self._timeout,
            follow_redirects=True,
        )

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------

    def _get_json(
        self,
        url: str,
        params: dict | None = None,
        extra_headers: dict | None = None,
    ) -> dict | None:
        """
        Perform a GET request → return parsed JSON.
        Implements rate limiting + exponential retry on 429/503/network errors.
        Caches responses to disk when cache is enabled.
        """
        # Rate limiting
        elapsed = time.time() - self._last_req
        if elapsed < self._delay:
            time.sleep(self._delay - elapsed)

        # Cache lookup
        if self._cache:
            cached = self._cache.get(url, params)
            if cached is not None:
                logger.debug("[%s] Cache hit: %s", self.source_name, url)
                return cached

        headers = extra_headers or {}
        attempt = 0
        while attempt < self._retries:
            attempt += 1
            try:
                resp = self._client.get(url, params=params, headers=headers)
                self._last_req = time.time()

                if resp.status_code == 200:
                    data = resp.json()
                    if self._cache:
                        self._cache.set(url, params, data)
                    return data

                if resp.status_code in (429, 503):
                    wait = self._backoff ** attempt
                    logger.warning(
                        "[%s] Rate limited (%d) – waiting %.1fs (attempt %d/%d)",
                        self.source_name, resp.status_code, wait, attempt, self._retries,
                    )
                    time.sleep(wait)
                    continue

                logger.warning(
                    "[%s] HTTP %d for %s", self.source_name, resp.status_code, url
                )
                return None

            except httpx.RequestError as exc:
                wait = self._backoff ** attempt
                logger.warning(
                    "[%s] Request error: %s – retrying in %.1fs", self.source_name, exc, wait
                )
                time.sleep(wait)

        logger.error("[%s] All %d attempts failed for %s", self.source_name, self._retries, url)
        return None

    def _get_bytes(self, url: str) -> bytes | None:
        """Download raw bytes (e.g. for PDF files). No caching."""
        elapsed = time.time() - self._last_req
        if elapsed < self._delay:
            time.sleep(self._delay - elapsed)
        try:
            resp = self._client.get(url)
            self._last_req = time.time()
            if resp.status_code == 200:
                return resp.content
            logger.warning("[%s] Binary GET %d: %s", self.source_name, resp.status_code, url)
        except httpx.RequestError as exc:
            logger.warning("[%s] Binary GET failed: %s", self.source_name, exc)
        return None

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "BaseScraper":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Abstract API
    # ------------------------------------------------------------------

    @abstractmethod
    def search(self, technology_id: str, queries: list[str], **kwargs: Any) -> list[PaperRecord]:
        """
        Search the external source for papers related to *technology_id*
        using the provided *queries*.

        Returns a (possibly empty) list of :class:`PaperRecord` objects.
        Any exception raised inside should be caught and logged rather than
        propagated – the pipeline continues with the next source.
        """

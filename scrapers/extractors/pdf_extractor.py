"""
scrapers/extractors/pdf_extractor.py
=====================================
Downloads open-access PDFs and extracts text for parameter mining.

Requires the optional `pdfplumber` package:
    pip install pdfplumber

Falls back gracefully if pdfplumber is not installed.

Strategy
--------
1. Download PDF bytes from the open-access URL (via BaseScraper._get_bytes).
2. Extract text page-by-page using pdfplumber.
3. Focus on sections likely to contain numeric data:
   - Abstract / Introduction
   - Results / Findings / Economic Analysis
   - Conclusions
4. Return the extracted text for downstream use by TextExtractor.
"""

from __future__ import annotations

import io
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

_MAX_DEFAULT_MB = 10

# Section headings that indicate cost/performance data is nearby
_PRIORITY_SECTIONS = re.compile(
    r"\b(abstract|introduction|result|finding|economic|cost\s+analysis|"
    r"conclusion|discussion|capital|investment|CAPEX|levelised|LCOE)\b",
    re.IGNORECASE,
)


class PDFExtractor:
    """
    Extracts text from a PDF URL.

    Usage
    -----
        extractor = PDFExtractor(max_mb=10)
        text = extractor.extract_from_url(pdf_url, http_client)
    """

    def __init__(self, max_mb: float = _MAX_DEFAULT_MB) -> None:
        self._max_bytes = int(max_mb * 1024 * 1024)
        self._pdfplumber: Any = None

        try:
            import pdfplumber
            self._pdfplumber = pdfplumber
        except ImportError:
            logger.info(
                "pdfplumber not installed – PDF extraction disabled. "
                "Run `pip install pdfplumber` to enable."
            )

    @property
    def available(self) -> bool:
        return self._pdfplumber is not None

    # ------------------------------------------------------------------

    def extract_from_bytes(self, pdf_bytes: bytes) -> str:
        """
        Extract and return text from raw PDF *pdf_bytes*.
        Returns empty string if pdfplumber is unavailable or extraction fails.
        """
        if not self._pdfplumber:
            return ""
        if len(pdf_bytes) > self._max_bytes:
            logger.debug("PDF exceeds max size (%.1f MB); skipping.", len(pdf_bytes) / 1e6)
            return ""

        try:
            pages_text: list[str] = []
            with self._pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                for page in pdf.pages:
                    text = page.extract_text() or ""
                    if text.strip():
                        pages_text.append(text)

            full_text = "\n\n".join(pages_text)
            return self._prioritise_sections(full_text)

        except Exception as exc:  # noqa: BLE001
            logger.warning("PDF extraction error: %s", exc)
            return ""

    def extract_from_url(self, url: str, http_client: Any) -> str:
        """
        Download *url* via *http_client* (must have a `_get_bytes` method)
        and extract text.
        """
        if not self._pdfplumber:
            return ""
        if not url or not url.lower().endswith(".pdf"):
            # Many OA URLs don't end in .pdf but still serve a PDF; proceed anyway
            if not url:
                return ""

        try:
            pdf_bytes = http_client._get_bytes(url)
        except Exception as exc:
            logger.debug("PDF download failed for %s: %s", url, exc)
            return ""

        if not pdf_bytes:
            return ""
        return self.extract_from_bytes(pdf_bytes)

    # ------------------------------------------------------------------

    @staticmethod
    def _prioritise_sections(full_text: str) -> str:
        """
        Re-order text so that high-priority sections (abstract, results,
        conclusions) appear first.  This improves extraction quality when
        the text is later truncated for LLM calls.
        """
        # Split into paragraphs
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", full_text) if p.strip()]

        priority: list[str] = []
        rest:     list[str] = []

        for para in paragraphs:
            if _PRIORITY_SECTIONS.search(para[:200]):
                priority.append(para)
            else:
                rest.append(para)

        return "\n\n".join(priority + rest)

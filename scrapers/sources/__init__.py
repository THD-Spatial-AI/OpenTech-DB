"""scrapers/sources/__init__.py"""
from .open_alex import OpenAlexScraper
from .semantic_scholar import SemanticScholarScraper
from .scopus_api import ScopusScraper
from .nrel_atb import NRELATBScraper
from .scholarly_gs import GoogleScholarScraper

__all__ = [
    "OpenAlexScraper",
    "SemanticScholarScraper",
    "ScopusScraper",
    "NRELATBScraper",
    "GoogleScholarScraper",
]

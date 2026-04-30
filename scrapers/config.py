"""
scrapers/config.py
==================
Loads scraper_config.yaml and merges with environment-variable overrides.

Usage
-----
    from scrapers.config import ScraperConfig
    cfg = ScraperConfig.load()
    print(cfg.sources.open_alex.enabled)

Environment Variables
---------------------
OPENALEX_API_KEY      – Optional API key for OpenAlex (higher rate limits).
S2_API_KEY            – Semantic Scholar API key (1000 req/5 min).
SCOPUS_API_KEY        – Elsevier Scopus API key (activates Scopus source).
SCOPUS_INST_TOKEN     – Elsevier institutional token.
SCRAPERAPI_KEY        – Proxy key for Google Scholar (scholarly).
OPENAI_API_KEY        – Enables LLM-based parameter extraction.
ANTHROPIC_API_KEY     – Alternative LLM provider.
SCRAPER_CONTACT_EMAIL – Email for OpenAlex polite-pool User-Agent.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_CONFIG_PATH  = _PROJECT_ROOT / "scraper_config.yaml"


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge *override* into *base*, returning a new dict."""
    result = base.copy()
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = val
    return result


class _Namespace:
    """Thin wrapper that converts nested dict → attribute access."""

    def __init__(self, data: dict[str, Any]) -> None:
        for k, v in data.items():
            if isinstance(v, dict):
                setattr(self, k, _Namespace(v))
            else:
                setattr(self, k, v)

    def get(self, key: str, default: Any = None) -> Any:  # noqa: D102
        return getattr(self, key, default)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for k, v in self.__dict__.items():
            out[k] = v.to_dict() if isinstance(v, _Namespace) else v
        return out


# ---------------------------------------------------------------------------
# ScraperConfig
# ---------------------------------------------------------------------------

class ScraperConfig:
    """
    Parsed and validated scraper configuration.

    Attributes are accessible via dot notation:
        cfg.sources.open_alex.enabled
        cfg.extraction.min_confidence
    """

    def __init__(self, raw: dict[str, Any]) -> None:
        self._raw = raw
        self.schedule    = _Namespace(raw.get("schedule", {}))
        self.http        = _Namespace(raw.get("http", {}))
        self.sources     = _Namespace(raw.get("sources", {}))
        self.extraction  = _Namespace(raw.get("extraction", {}))
        self.technologies: dict[str, _Namespace] = {
            tid: _Namespace(cfg)
            for tid, cfg in raw.get("technologies", {}).items()
        }
        self.output = _Namespace(raw.get("output", {}))

        # Apply environment-variable overrides
        self._apply_env()

    # ------------------------------------------------------------------
    # Environment overrides
    # ------------------------------------------------------------------

    def _apply_env(self) -> None:
        """
        Override specific config values from environment variables.
        This is the safe path for secrets – never put API keys in the YAML.
        """
        src = self.sources

        if key := os.environ.get("OPENALEX_API_KEY"):
            src.open_alex.api_key = key

        if key := os.environ.get("S2_API_KEY"):
            src.semantic_scholar.api_key = key

        if key := os.environ.get("SCOPUS_API_KEY"):
            src.scopus.api_key = key
            src.scopus.enabled = True          # auto-enable when key is present

        if token := os.environ.get("SCOPUS_INST_TOKEN"):
            src.scopus.inst_token = token

        if key := os.environ.get("SCRAPERAPI_KEY"):
            src.google_scholar.proxy_key = key

        if os.environ.get("OPENAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY"):
            self.extraction.llm.enabled = True

        if email := os.environ.get("SCRAPER_CONTACT_EMAIL"):
            self.http.contact_email = email

    # ------------------------------------------------------------------
    # Convenience
    # ------------------------------------------------------------------

    @property
    def enabled_sources(self) -> list[str]:
        """Names of all currently-enabled source scrapers."""
        # All known source keys – new ones just need to be added here
        all_sources = (
            "open_alex", "semantic_scholar", "scopus",
            "google_scholar", "nrel_atb", "irena",
            "eia_api", "crossref", "arxiv", "europe_pmc",
            "iea_reports", "fraunhofer_ise", "ember_data",
        )
        return [
            name
            for name in all_sources
            if getattr(getattr(self.sources, name, _Namespace({})), "enabled", False)
        ]

    @property
    def contact_email(self) -> str:
        return getattr(self.http, "contact_email", "opentech-db@th-deg.de")

    @property
    def user_agent(self) -> str:
        return (
            f"OpenTechDB/1.0 (energy technology database; "
            f"mailto:{self.contact_email})"
        )

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    def load(cls, path: Path | None = None) -> "ScraperConfig":
        """Load and return a ScraperConfig from *path* (default: scraper_config.yaml)."""
        config_path = path or _CONFIG_PATH
        if not config_path.exists():
            raise FileNotFoundError(
                f"Scraper config not found: {config_path}. "
                "Copy scraper_config.yaml to the project root."
            )
        with config_path.open("r", encoding="utf-8") as fh:
            raw: dict[str, Any] = yaml.safe_load(fh) or {}
        return cls(raw)

    def resolved_path(self, relative: str) -> Path:
        """Return an absolute path relative to the project root."""
        return _PROJECT_ROOT / relative

"""Tests for scrapers/normalizer.py — Normalizer.build_candidate and helpers."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from scrapers.normalizer import Normalizer
from scrapers.extractors.text_extractor import ExtractedValue


# ---------------------------------------------------------------------------
# Minimal PaperRecord stub
# ---------------------------------------------------------------------------

def _paper(**kwargs) -> MagicMock:
    defaults = dict(
        source_name="test_source",
        doi="10.1234/test",
        title="Test Paper",
        year=2023,
        url="https://example.com/paper",
        venue="Test Journal",
        authors=["Author A", "Author B"],
        countries=["Germany"],
        abstract="Test abstract with no useful numbers.",
        full_text="",
    )
    defaults.update(kwargs)
    paper = MagicMock()
    for k, v in defaults.items():
        setattr(paper, k, v)
    return paper


def _ev(parameter: str, value: float, unit: str = "", confidence: float = 0.8,
        context: str = "") -> ExtractedValue:
    return ExtractedValue(
        parameter=parameter,
        value=value,
        unit=unit,
        confidence=confidence,
        context=context,
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def normalizer():
    """Normalizer has no constructor arguments."""
    return Normalizer()


# ---------------------------------------------------------------------------
# build_candidate – return None with no params
# ---------------------------------------------------------------------------

class TestBuildCandidateNoParams:
    def test_returns_none_when_no_regex_no_llm(self, normalizer):
        paper = _paper()
        result = normalizer.build_candidate(
            technology_id="solar_pv",
            paper=paper,
            regex_values=[],
            llm_params=None,
        )
        assert result is None


# ---------------------------------------------------------------------------
# build_candidate – happy path
# ---------------------------------------------------------------------------

class TestBuildCandidateHappyPath:
    def _call(self, normalizer, params=None, llm=None):
        if params is None:
            params = [_ev("capex_usd_per_kw", 1200, "USD/kW")]
        return normalizer.build_candidate(
            technology_id="wind_onshore",
            paper=_paper(),
            regex_values=params,
            llm_params=llm,
        )

    def test_returns_dict(self, normalizer):
        result = self._call(normalizer)
        assert isinstance(result, dict)

    def test_required_top_level_keys(self, normalizer):
        result = self._call(normalizer)
        required = {
            "candidate_id", "scraped_at", "status", "technology_id",
            "paper_doi", "paper_title", "extracted_params", "proposed_instance",
        }
        assert required.issubset(result.keys())

    def test_status_is_pending(self, normalizer):
        result = self._call(normalizer)
        assert result["status"] == "pending"

    def test_technology_id_preserved(self, normalizer):
        result = self._call(normalizer)
        assert result["technology_id"] == "wind_onshore"

    def test_paper_doi_preserved(self, normalizer):
        paper = _paper(doi="10.9999/mytest")
        result = normalizer.build_candidate(
            technology_id="wind_onshore",
            paper=paper,
            regex_values=[_ev("capex_usd_per_kw", 900, "USD/kW")],
        )
        assert result["paper_doi"] == "10.9999/mytest"

    def test_extracted_params_has_capital_cost(self, normalizer):
        result = self._call(normalizer)
        assert "capex_usd_per_kw" in result["extracted_params"]

    def test_proposed_instance_is_dict(self, normalizer):
        result = self._call(normalizer)
        assert isinstance(result["proposed_instance"], dict)

    def test_authors_capped_at_five(self, normalizer):
        many_authors = [f"Author {i}" for i in range(20)]
        paper = _paper(authors=many_authors)
        result = normalizer.build_candidate(
            technology_id="wind_onshore",
            paper=paper,
            regex_values=[_ev("capex_usd_per_kw", 900)],
        )
        assert len(result["paper_authors"]) <= 5

    def test_scraped_at_is_iso_timestamp(self, normalizer):
        result = self._call(normalizer)
        ts = result["scraped_at"]
        # Should parse without error
        datetime.fromisoformat(ts)


# ---------------------------------------------------------------------------
# Country inference / passthrough
# ---------------------------------------------------------------------------

class TestPaperCountries:
    def test_paper_countries_included(self, normalizer):
        paper = _paper(countries=["France", "Germany"])
        result = normalizer.build_candidate(
            technology_id="solar_pv",
            paper=paper,
            regex_values=[_ev("efficiency_percent", 22, "%")],
        )
        assert "paper_countries" in result
        countries = result["paper_countries"]
        assert "France" in countries or "Germany" in countries

    def test_empty_countries_field(self, normalizer):
        paper = _paper(countries=[])
        result = normalizer.build_candidate(
            technology_id="solar_pv",
            paper=paper,
            regex_values=[_ev("efficiency_percent", 22, "%")],
        )
        # Should still produce a valid candidate, even without country info
        assert isinstance(result, dict)


# ---------------------------------------------------------------------------
# Multiple regex params
# ---------------------------------------------------------------------------

class TestMultipleRegexParams:
    def test_all_params_in_extracted(self, normalizer):
        params = [
            _ev("capex_usd_per_kw", 1500, "USD/kW"),
            _ev("lifetime_years", 25, "years"),
            _ev("efficiency_percent", 40, "%"),
        ]
        result = normalizer.build_candidate(
            technology_id="ccgt",
            paper=_paper(),
            regex_values=params,
        )
        assert result is not None
        ep = result["extracted_params"]
        assert "capex_usd_per_kw" in ep
        assert "lifetime_years" in ep
        assert "efficiency_percent" in ep

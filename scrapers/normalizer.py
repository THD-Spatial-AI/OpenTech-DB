"""
scrapers/normalizer.py
=======================
Maps raw extracted parameter values (from TextExtractor / LLMExtractor)
into OpenTechDB candidate instance dictionaries.

The output follows the flat catalogue format used by the JSON data files:
    data/<domain>/<domain>_technologies.json  →  instances[{...}]

Key responsibilities
--------------------
1. Merge regex + LLM extracted values (LLM wins on conflicts when present).
2. Build a proposed `instance_id` (deterministic slug).
3. Fill in only the fields we have data for (no guessing defaults).
4. Attach a per-field confidence score and source context.
"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timezone
from typing import Any

from scrapers.base import PaperRecord
from scrapers.extractors.text_extractor import ExtractedValue
from scrapers.extractors.llm_extractor import LLMExtractedParams


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _slug(text: str) -> str:
    """Convert arbitrary text to a lowercase underscore slug."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")[:60]


def _year_tag() -> str:
    return str(date.today().year)


# ---------------------------------------------------------------------------
# Normalizer
# ---------------------------------------------------------------------------

class Normalizer:
    """
    Combines extraction results into a candidate dict ready for review.

    Usage
    -----
        norm = Normalizer()
        candidate = norm.build_candidate(
            technology_id="ccgt",
            paper=record,
            regex_values=extracted_values,
            llm_params=llm_result,   # or None
        )
        # candidate is a dict ready to pass to CandidateStore.save_candidate()
    """

    def build_candidate(
        self,
        technology_id: str,
        paper: PaperRecord,
        regex_values: list[ExtractedValue],
        llm_params: LLMExtractedParams | None = None,
    ) -> dict[str, Any] | None:
        """
        Build and return a candidate dict.
        Returns None if no useful parameters were extracted.
        """
        # Merge: start with regex, override with LLM where both have a value
        params = self._merge_params(regex_values, llm_params)
        if not params:
            return None

        proposed_instance = self._build_instance(technology_id, paper, params)

        return {
            "candidate_id":    str(uuid.uuid4()),
            "scraped_at":      datetime.now(timezone.utc).isoformat(),
            "status":          "pending",
            "technology_id":   technology_id,
            "source":          paper.source_name,
            "paper_doi":       paper.doi,
            "paper_title":     paper.title,
            "paper_year":      paper.year,
            "paper_url":       paper.url,
            "paper_venue":     paper.venue,
            "paper_authors":   paper.authors[:5],   # cap to avoid oversized JSON
            "extracted_params": params,
            "proposed_instance": proposed_instance,
            "review_notes":    "",
            "reviewed_at":     None,
            "reviewed_by":     None,
        }

    # ------------------------------------------------------------------

    def _merge_params(
        self,
        regex_values: list[ExtractedValue],
        llm: LLMExtractedParams | None,
    ) -> dict[str, Any]:
        """
        Merge regex-extracted values with LLM output.
        Returns dict: param_name → {value, unit, confidence, context}.
        """
        merged: dict[str, dict[str, Any]] = {}

        # 1. Populate from regex
        for ev in regex_values:
            merged[ev.parameter] = {
                "value":      ev.value,
                "unit":       ev.unit,
                "confidence": ev.confidence,
                "context":    ev.context[:300],  # truncate context for storage
                "source":     "regex",
            }

        # 2. Override / supplement with LLM if available
        if llm:
            _llm_field_map = {
                "capex_usd_per_kw":              ("capex_usd_per_kw",        "USD/kW"),
                "opex_fixed_usd_per_kw_yr":      ("opex_fixed_usd_per_kw_yr","USD/kW/yr"),
                "opex_var_usd_per_mwh":          ("opex_var_usd_per_mwh",    "USD/MWh"),
                "efficiency_percent":             ("efficiency_percent",       "%"),
                "lifetime_years":                ("lifetime_years",           "years"),
                "co2_emission_factor_g_per_kwh": ("co2_emission_factor_g_per_kwh","g/kWh"),
                "typical_capacity_mw":           ("typical_capacity_mw",     "MW"),
                "degradation_rate_percent_per_yr":("degradation_rate_percent_per_yr","%/yr"),
            }
            for attr, (param, unit) in _llm_field_map.items():
                val = getattr(llm, attr, None)
                if val is None:
                    continue
                existing = merged.get(param)
                # LLM wins unless regex was very confident (≥0.92)
                if existing is None or existing["confidence"] < 0.92:
                    merged[param] = {
                        "value":      val,
                        "unit":       unit,
                        "confidence": llm.confidence,
                        "context":    llm.notes[:300] if llm.notes else "",
                        "source":     "llm",
                    }

        return merged

    # ------------------------------------------------------------------

    def _build_instance(
        self,
        technology_id: str,
        paper: PaperRecord,
        params: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        """Construct the proposed catalogue instance dict."""

        year = paper.year or date.today().year
        source_label = paper.source_name.replace("_", " ").title()

        # Build instance_id slug
        capex_str = ""
        if "capex_usd_per_kw" in params:
            capex_str = f"_{int(params['capex_usd_per_kw']['value'])}kw"
        doi_slug = _slug(paper.doi or paper.source_id or "")[:20]
        instance_id = f"{technology_id}{capex_str}_{year}_scraped_{doi_slug}"

        # Human-readable name
        capex_label = ""
        if "capex_usd_per_kw" in params:
            capex_label = f" – {params['capex_usd_per_kw']['value']:.0f} $/kW"
        instance_name = (
            f"{technology_id.replace('_', ' ').title()}{capex_label} "
            f"(scraped {year}, {source_label})"
        )

        instance: dict[str, Any] = {
            "instance_id":   instance_id,
            "instance_name": instance_name,
            "_scraped":      True,
            "_source":       paper.source_name,
            "_paper_doi":    paper.doi,
            "_paper_title":  paper.title,
            "_paper_year":   year,
            "_scraped_at":   datetime.now(timezone.utc).isoformat(),
        }

        # Map extracted params → catalogue field names
        _param_to_field = {
            "capex_usd_per_kw":               "capex_usd_per_kw",
            "opex_fixed_usd_per_kw_yr":       "opex_fixed_usd_per_kw_yr",
            "opex_var_usd_per_mwh":           "opex_var_usd_per_mwh",
            "efficiency_percent":              "efficiency_percent",
            "lifetime_years":                  "lifetime_years",
            "co2_emission_factor_g_per_kwh":   "co2_emission_factor_operational_g_per_kwh",
            "typical_capacity_mw":             "typical_capacity_mw",
            "degradation_rate_percent_per_yr": "degradation_rate_percent_per_yr",
        }

        for param, field_name in _param_to_field.items():
            if param in params:
                instance[field_name] = params[param]["value"]

        # Reference source string
        parts = [source_label, str(year)]
        if paper.doi:
            parts.append(f"doi:{paper.doi}")
        instance["reference_source"] = ", ".join(parts)

        return instance

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


ISO2_TO_COUNTRY = {
    "DE": "Germany", "FR": "France", "ES": "Spain", "IT": "Italy", "GR": "Greece", "DK": "Denmark",
    "GB": "United Kingdom", "UK": "United Kingdom", "NO": "Norway", "NL": "Netherlands", "PT": "Portugal",
    "PL": "Poland", "BE": "Belgium", "IE": "Ireland", "SE": "Sweden", "FI": "Finland", "CH": "Switzerland",
    "AT": "Austria", "US": "United States", "CA": "Canada", "MX": "Mexico", "BR": "Brazil", "CL": "Chile",
    "AR": "Argentina", "AU": "Australia", "NZ": "New Zealand", "CN": "China", "IN": "India", "JP": "Japan",
    "KR": "South Korea", "ZA": "South Africa", "EG": "Egypt", "MA": "Morocco", "SA": "Saudi Arabia", "AE": "United Arab Emirates",
}

COUNTRY_NAME_TO_ISO2 = {
    "germany": "DE", "france": "FR", "spain": "ES", "italy": "IT", "greece": "GR", "denmark": "DK",
    "united kingdom": "GB", "uk": "GB", "great britain": "GB", "norway": "NO", "netherlands": "NL",
    "portugal": "PT", "poland": "PL", "belgium": "BE", "ireland": "IE", "sweden": "SE", "finland": "FI",
    "switzerland": "CH", "austria": "AT", "united states": "US", "usa": "US", "canada": "CA",
    "mexico": "MX", "brazil": "BR", "chile": "CL", "argentina": "AR", "australia": "AU",
    "new zealand": "NZ", "china": "CN", "india": "IN", "japan": "JP", "south korea": "KR",
    "korea": "KR", "south africa": "ZA", "egypt": "EG", "morocco": "MA", "saudi arabia": "SA",
    "united arab emirates": "AE", "uae": "AE",
}


def _infer_paper_countries_from_text(paper: PaperRecord) -> list[str]:
    text = " ".join([
        paper.title or "",
        paper.abstract or "",
        paper.full_text or "",
        paper.venue or "",
    ]).lower()

    found: set[str] = set()
    for name, iso2 in COUNTRY_NAME_TO_ISO2.items():
        if re.search(rf"\b{re.escape(name)}\b", text):
            found.add(iso2)

    return sorted(found)


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


def _tech_title(technology_id: str) -> str:
    return technology_id.replace("_", " ").title()


def _paper_title_snippet(title: str | None, max_len: int = 44) -> str:
    if not title:
        return ""
    cleaned = re.sub(r"\s+", " ", title).strip()
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"


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
            "paper_countries": sorted(set((paper.countries or []) + _infer_paper_countries_from_text(paper))),
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
                # Tech-specific extras
                "rotor_diameter_m":              ("rotor_diameter_m",         "m"),
                "hub_height_m":                  ("hub_height_m",             "m"),
                "wind_rated_speed_ms":           ("wind_rated_speed_ms",      "m/s"),
                "module_efficiency_fraction":    ("module_efficiency_fraction","fraction"),
                "performance_ratio":             ("performance_ratio",         "fraction"),
                "solar_multiple":                ("solar_multiple",            ""),
                "thermal_storage_h":             ("thermal_storage_h",         "h"),
                "optical_efficiency_fraction":   ("optical_efficiency_fraction","fraction"),
                "heat_rate_mj_per_mwh":          ("heat_rate_mj_per_mwh",     "MJ/MWh"),
                "min_load_fraction":             ("min_load_fraction",         "fraction"),
                "start_up_time_h":               ("start_up_time_h",           "h"),
                "cold_start_time_h":             ("cold_start_time_h",         "h"),
                "water_withdrawal_m3_per_mwh":   ("water_withdrawal_m3_per_mwh","m³/MWh"),
                "land_use_m2_per_kw":            ("land_use_m2_per_kw",        "m²/kW"),
                "roundtrip_efficiency_fraction": ("roundtrip_efficiency_fraction","fraction"),
                "charge_efficiency_fraction":    ("charge_efficiency_fraction", "fraction"),
                "discharge_efficiency_fraction": ("discharge_efficiency_fraction","fraction"),
                "dod_max_fraction":              ("dod_max_fraction",           "fraction"),
                "cycle_lifetime_cycles":         ("cycle_lifetime_cycles",      "cycles"),
                "loss_rate_pct_per_km":          ("loss_rate_pct_per_km",       "%/km"),
                "voltage_kv":                    ("voltage_kv",                 "kV"),
                "stack_lifetime_h":              ("stack_lifetime_h",           "h"),
                "cop_heating_at_a7_w35":         ("cop_heating_at_a7_w35",      ""),
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

        # Human-readable name: include tech title + source + year + a compact paper hint.
        key_bits: list[str] = []
        if "capex_usd_per_kw" in params:
            key_bits.append(f"CAPEX {params['capex_usd_per_kw']['value']:.0f} $/kW")
        if "efficiency_percent" in params:
            key_bits.append(f"Eff {params['efficiency_percent']['value']:.1f}%")
        if "lifetime_years" in params:
            key_bits.append(f"Life {params['lifetime_years']['value']:.0f}y")
        brief = " | ".join(key_bits[:2])

        name_parts = [f"{_tech_title(technology_id)} ({source_label}, {year})"]
        title_hint = _paper_title_snippet(paper.title)
        if title_hint:
            name_parts.append(title_hint)
        if brief:
            name_parts.append(brief)
        instance_name = " - ".join(name_parts)

        instance: dict[str, Any] = {
            "instance_id":   instance_id,
            "instance_name": instance_name,
            "_scraped":      True,
            "_source":       paper.source_name,
            "_paper_doi":    paper.doi,
            "_paper_title":  paper.title,
            "_paper_year":   year,
            "_scraped_at":   datetime.now(timezone.utc).isoformat(),
            "_extracted_params": {
                p: {
                    "value": d.get("value"),
                    "unit": d.get("unit"),
                    "confidence": d.get("confidence"),
                    "source": d.get("source"),
                }
                for p, d in params.items()
            },
        }

        # Map extracted params → catalogue field names
        # Includes both core fields and tech-specific extra params
        _param_to_field = {
            # Core fields
            "capex_usd_per_kw":               "capex_usd_per_kw",
            "opex_fixed_usd_per_kw_yr":       "opex_fixed_usd_per_kw_yr",
            "opex_var_usd_per_mwh":           "opex_var_usd_per_mwh",
            "efficiency_percent":              "efficiency_percent",
            "lifetime_years":                  "lifetime_years",
            "co2_emission_factor_g_per_kwh":   "co2_emission_factor_operational_g_per_kwh",
            "typical_capacity_mw":             "typical_capacity_mw",
            "degradation_rate_percent_per_yr": "degradation_rate_percent_per_yr",
            # Wind extras
            "rotor_diameter_m":               "rotor_diameter_m",
            "hub_height_m":                   "hub_height_m",
            "wind_rated_speed_ms":            "wind_rated_speed_ms",
            "specific_power_w_per_m2":        "specific_power_w_per_m2",
            # Solar PV extras
            "module_efficiency_fraction":     "module_efficiency_fraction",
            "performance_ratio":              "performance_ratio",
            "tilt_angle_deg":                 "tilt_angle_deg",
            "temperature_coefficient_pct_per_c": "temperature_coefficient_pct_per_c",
            "ground_coverage_ratio":          "ground_coverage_ratio",
            "land_use_m2_per_kwp":            "land_use_m2_per_kwp",
            # CSP extras
            "solar_multiple":                 "solar_multiple",
            "thermal_storage_h":              "thermal_storage_h",
            "optical_efficiency_fraction":    "optical_efficiency_fraction",
            # Hydro extras
            "turbine_type":                   "turbine_type",
            "typical_head_m":                 "typical_head_m",
            "hydraulic_efficiency_fraction":  "hydraulic_efficiency_fraction",
            # Marine extras
            "tidal_current_speed_ms":         "tidal_current_speed_ms",
            "turbine_diameter_m":             "turbine_diameter_m",
            # Thermal extras (shared across CCGT, OCGT, Coal, Nuclear, Biomass, etc.)
            "heat_rate_mj_per_mwh":           "heat_rate_mj_per_mwh",
            "min_load_fraction":              "min_load_fraction",
            "start_up_time_h":                "start_up_time_h",
            "cold_start_time_h":              "cold_start_time_h",
            "water_withdrawal_m3_per_mwh":    "water_withdrawal_m3_per_mwh",
            "land_use_m2_per_kw":             "land_use_m2_per_kw",
            # Nuclear extras
            "enrichment_percent":             "enrichment_percent",
            "burnup_gwd_per_t":               "burnup_gwd_per_t",
            # Storage extras
            "charge_efficiency_fraction":     "charge_efficiency_fraction",
            "discharge_efficiency_fraction":  "discharge_efficiency_fraction",
            "roundtrip_efficiency_fraction":  "roundtrip_efficiency_fraction",
            "dod_max_fraction":               "dod_max_fraction",
            "cycle_lifetime_cycles":          "cycle_lifetime_cycles",
            "c_rate_max_charge":              "c_rate_max_charge",
            "c_rate_max_discharge":           "c_rate_max_discharge",
            "land_use_m2_per_kwh":            "land_use_m2_per_kwh",
            # Conversion / electrolyzer extras
            "warm_start_time_min":            "warm_start_time_min",
            "stack_lifetime_h":               "stack_lifetime_h",
            "water_consumption_l_per_kg_h2":  "water_consumption_l_per_kg_h2",
            "cell_voltage_v":                 "cell_voltage_v",
            "current_density_ma_per_cm2":     "current_density_ma_per_cm2",
            # Conversion / heat pump extras
            "cop_heating_at_a7_w35":          "cop_heating_at_a7_w35",
            "electrical_efficiency_fraction": "electrical_efficiency_fraction",
            "thermal_efficiency_fraction":    "thermal_efficiency_fraction",
            "cold_start_time_min":            "cold_start_time_min",
            # Transmission extras
            "loss_rate_pct_per_km":           "loss_rate_pct_per_km",
            "voltage_kv":                     "voltage_kv",
            "max_utilization_fraction":       "max_utilization_fraction",
            "availability_fraction":          "availability_fraction",
            "corridor_length_km":             "corridor_length_km",
        }

        for param, field_name in _param_to_field.items():
            if param in params:
                instance[field_name] = params[param]["value"]

        # Reference source string
        parts = [source_label, str(year)]
        if paper.doi:
            parts.append(f"doi:{paper.doi}")
        elif paper.url:
            parts.append(str(paper.url))
        instance["reference_source"] = ", ".join(parts)

        base_countries = [c for c in (paper.countries or []) if len(c) == 2]
        inferred_from_text = _infer_paper_countries_from_text(paper)
        unique_countries = sorted(set(base_countries + inferred_from_text))
        if unique_countries:
            instance["_paper_countries"] = unique_countries
            # Only assign a concrete country when the paper clearly maps to a single country.
            if len(unique_countries) == 1:
                iso2 = "GB" if unique_countries[0] == "UK" else unique_countries[0]
                instance["country_iso2"] = iso2
                instance["country"] = ISO2_TO_COUNTRY.get(iso2, iso2)
                instance["country_inference_source"] = (
                    "paper_metadata" if base_countries and len(base_countries) == 1 else "paper_text"
                )

        return instance

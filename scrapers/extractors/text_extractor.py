"""
scrapers/extractors/text_extractor.py
=======================================
Regex-based parameter extractor.

Scans paper abstracts and full text for cost/performance indicators using
pattern matching. No external services required.

Extracted parameters
--------------------
  capex_usd_per_kw              Capital expenditure ($/kW or equivalent)
  opex_fixed_usd_per_kw_yr      Fixed O&M ($/kW/year)
  opex_var_usd_per_mwh          Variable O&M ($/MWh)
  efficiency_percent            Net electrical efficiency (%)
  lifetime_years                Technical/economic lifetime (years)
  co2_emission_factor_g_per_kwh Direct CO₂ emissions (g/kWh)
  typical_capacity_mw           Typical rated capacity (MW)
  degradation_rate_percent_per_yr  Annual degradation rate (%)

Each extracted value carries:
  - value     : float
  - unit      : str
  - context   : str   (surrounding ±120 chars of matched text)
  - confidence: float (0.0–1.0, based on pattern specificity + context)
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data class for a single extracted value
# ---------------------------------------------------------------------------

@dataclass
class ExtractedValue:
    parameter: str
    value: float
    unit: str
    context: str = ""
    confidence: float = 0.5
    raw_match: str = ""


# ---------------------------------------------------------------------------
# Unit conversion helpers
# ---------------------------------------------------------------------------

# USD/EUR exchange rate (approximated; update annually)
_EUR_TO_USD = 1.10

# Multipliers for magnitude words
_MAGNITUDE: dict[str, float] = {
    "billion": 1e9,
    "million": 1e6,
    "m":       1e6,
    "thousand": 1e3,
    "k":       1e3,
}


def _magnitude_multiplier(text: str) -> float:
    for word, mult in _MAGNITUDE.items():
        if re.search(rf"\b{word}\b", text, re.I):
            return mult
    return 1.0


def _currency_to_usd(value: float, currency_text: str) -> float:
    """Convert EUR/€ values to USD. Pass through USD/$ unchanged."""
    if re.search(r"EUR|€", currency_text, re.I):
        return value * _EUR_TO_USD
    return value


# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------

# Numeric value: optional sign, digits, optional decimal
_NUM = r"(?P<value>[-+]?\d[\d,]*\.?\d*)"

# Optional whitespace
_OWS = r"\s*"

# Currency indicators
_CURRENCY = r"(?:USD|US\$|\$|EUR|€|GBP|£)\s*"

# Per-unit denominator patterns
_PER_KW   = r"(?:per\s+)?(?:kW(?:[he])?|kilowatt(?:-hour)?)"
_PER_MW   = r"(?:per\s+)?(?:MW(?:[he])?|megawatt(?:-hour)?)"
_PER_GW   = r"(?:per\s+)?(?:GW(?:[he])?|gigawatt(?:-hour)?)"
_PER_MWH  = r"(?:per\s+)?(?:MWh|MW\s*h|megawatt[\s\-]?hour)"
_PER_KWH  = r"(?:per\s+)?(?:kWh|kW\s*h|kilowatt[\s\-]?hour)"

# Year indicator
_YR = r"(?:per\s+)?(?:year|yr|annum|p\.a\.)"

_PATTERNS: dict[str, list[tuple[str, float, str]]] = {
    # ------------------------------------------------------------------ CAPEX
    "capex_usd_per_kw": [
        # "$1,050/kW" or "USD 850 per kW"
        (
            rf"(?:capital\s+(?:cost|expenditure)|CAPEX|overnight\s+cost|investment\s+cost)"
            rf"[^$€\d]{{0,40}}{_CURRENCY}?{_NUM}[^a-zA-Z]{{0,10}}/{_PER_KW}",
            0.90, "USD/kW",
        ),
        # "1,200 $/kW" bare
        (
            rf"{_CURRENCY}{_NUM}{_OWS}/{_OWS}{_PER_KW}",
            0.80, "USD/kW",
        ),
        # "1.2 M€/MW" → convert MW→kW (/1000) and EUR→USD
        (
            rf"{_CURRENCY}?{_NUM}{_OWS}(?:M|million){_OWS}/{_OWS}{_PER_MW}",
            0.75, "M_USD/MW",
        ),
        # "2,500 USD·kW⁻¹" or "2500 USD kW-1"
        (
            rf"{_CURRENCY}?{_NUM}{_OWS}(?:USD|EUR|€)?\s*(?:·|\*|×)?\s*kW[\s\-]?(?:−1|-1|⁻¹)",
            0.78, "USD/kW",
        ),
        # ATB structured: "capex_usd_per_kw = 950"
        (
            rf"capex_usd_per_kw\s*=\s*{_NUM}",
            0.95, "USD/kW",
        ),
    ],

    # ---------------------------------------------------------- Fixed O&M
    "opex_fixed_usd_per_kw_yr": [
        # "fixed O&M costs of 18 USD per kW per year"
        (
            rf"(?:fixed\s+O&?M|fixed\s+operation|O&?M\s+cost)[^$€\d]{{0,40}}"
            rf"(?:{_CURRENCY})?{_NUM}\s*{_CURRENCY}?(?:/|per\s+){_PER_KW}\s*(?:/|per\s+){_YR}",
            0.88, "USD/kW/yr",
        ),
        # "18 USD/kW/year" or "18 $/kW/yr"
        (
            rf"{_NUM}\s*{_CURRENCY}/{_PER_KW}\s*/\s*{_YR}",
            0.82, "USD/kW/yr",
        ),
        # "18 USD per kW per year"
        (
            rf"{_NUM}\s*{_CURRENCY}per\s+kW\s+per\s+{_YR}",
            0.83, "USD/kW/yr",
        ),
        (
            rf"opex_fixed_usd_per_kw_yr\s*=\s*{_NUM}",
            0.95, "USD/kW/yr",
        ),
    ],

    # -------------------------------------------------------- Variable O&M
    "opex_var_usd_per_mwh": [
        # "variable O&M of 3.5 USD/MWh"
        (
            rf"(?:variable\s+O&?M|variable\s+cost)[^$€\d]{{0,40}}"
            rf"(?:{_CURRENCY})?{_NUM}\s*{_CURRENCY}?(?:/|per\s+){_PER_MWH}",
            0.88, "USD/MWh",
        ),
        # "3.5 USD/MWh" or "3.5 $/MWh"
        (
            rf"{_NUM}\s*{_CURRENCY}/{_PER_MWH}",
            0.80, "USD/MWh",
        ),
        (
            rf"opex_var_usd_per_mwh\s*=\s*{_NUM}",
            0.95, "USD/MWh",
        ),
    ],

    # -------------------------------------------------------- Efficiency %
    "efficiency_percent": [
        # "net electrical efficiency of 58.2%"
        (
            rf"(?:net\s+)?(?:electrical|thermal|conversion|LHV|HHV)?\s*efficiency"
            rf"[^%\d]{{0,30}}{_NUM}\s*%",
            0.90, "%",
        ),
        # "58% efficiency" or "efficiency: 62%"
        (
            rf"{_NUM}\s*%\s*(?:(?:net\s+)?(?:electrical|thermal|LHV|HHV)\s*)?efficiency",
            0.85, "%",
        ),
        # COP: "COP of 3.8" → multiply by 100
        (
            rf"COP\s+(?:of\s+)?{_NUM}",
            0.80, "COP",
        ),
        # ATB structured
        (
            rf"efficiency_percent\s*=\s*{_NUM}",
            0.95, "%",
        ),
    ],

    # --------------------------------------------------------- Lifetime
    "lifetime_years": [
        (
            rf"(?:technical|economic|design|expected|plant|asset)\s+(?:lifetime|life)"
            rf"[^0-9]{{0,20}}{_NUM}\s*(?:years?|yr)",
            0.90, "years",
        ),
        (
            rf"lifetime\s+(?:of\s+)?{_NUM}\s*(?:years?|yr)",
            0.87, "years",
        ),
        (
            rf"lifetime_years\s*=\s*{_NUM}",
            0.95, "years",
        ),
    ],

    # ---------------------------------------------------- CO₂ emissions
    "co2_emission_factor_g_per_kwh": [
        # "450 g CO₂/kWh" or "450 g/kWh CO2"
        (
            rf"{_NUM}\s*g(?:CO2|CO₂|_CO2)?\s*/\s*kWh",
            0.88, "g/kWh",
        ),
        # "0.45 kg CO₂/kWh" → convert to g/kWh (*1000)
        (
            rf"{_NUM}\s*kg(?:CO2|CO₂)?\s*/\s*kWh",
            0.85, "kg/kWh",
        ),
        # "0.45 tCO₂/MWh" → convert to g/kWh (*1000)
        (
            rf"{_NUM}\s*(?:t|tonne)(?:CO2|CO₂)?\s*/\s*MWh",
            0.85, "tCO2/MWh",
        ),
        (
            rf"co2_emission_factor.*?=\s*{_NUM}",
            0.95, "g/kWh",
        ),
    ],

    # --------------------------------------------------- Capacity (MW)
    "typical_capacity_mw": [
        # "typical plant capacity is 450 MW" / "rated capacity of 450 MW"
        (
            rf"(?:rated|installed|typical|nameplate|plant)[\s\w]{{0,20}}capacity\s+(?:of\s+|is\s+)?{_NUM}\s*MW",
            0.88, "MW",
        ),
        # "450 MW power plant / wind farm / project"
        (
            rf"{_NUM}\s*MW\s+(?:power\s+plant|wind\s+farm|solar\s+park|project|plant|turbine)",
            0.82, "MW",
        ),
        (
            rf"typical_capacity_mw\s*=\s*{_NUM}",
            0.95, "MW",
        ),
    ],

    # ----------------------------------------------- Degradation (%/yr)
    "degradation_rate_percent_per_yr": [
        (
            rf"(?:annual|yearly|per[- ]year)\s+degradation\s+(?:rate\s+)?(?:of\s+)?{_NUM}\s*%",
            0.88, "%/yr",
        ),
        (
            rf"degradation\s+(?:rate|factor)\s+(?:of\s+)?{_NUM}\s*%\s*/{_YR}",
            0.87, "%/yr",
        ),
        (
            rf"degradation_rate_percent_per_yr\s*=\s*{_NUM}",
            0.95, "%/yr",
        ),
    ],
}


# ---------------------------------------------------------------------------
# Main extractor class
# ---------------------------------------------------------------------------

class TextExtractor:
    """
    Extracts numeric cost/performance parameters from raw text using
    regex patterns.

    Usage
    -----
        extractor = TextExtractor(min_confidence=0.6)
        values = extractor.extract(abstract_text, technology_id="ccgt")
    """

    def __init__(self, min_confidence: float = 0.55) -> None:
        self._min_confidence = min_confidence
        self._compiled = self._compile_patterns()

    # ------------------------------------------------------------------

    def _compile_patterns(
        self,
    ) -> dict[str, list[tuple[re.Pattern, float, str]]]:
        compiled: dict[str, list[tuple[re.Pattern, float, str]]] = {}
        for param, entries in _PATTERNS.items():
            compiled[param] = []
            for pattern_str, confidence, unit in entries:
                try:
                    compiled[param].append(
                        (re.compile(pattern_str, re.IGNORECASE | re.DOTALL), confidence, unit)
                    )
                except re.error as exc:
                    logger.warning("Pattern compile error for %s: %s", param, exc)
        return compiled

    # ------------------------------------------------------------------

    def extract(
        self,
        text: str,
        technology_id: str = "",
    ) -> list[ExtractedValue]:
        """
        Run all patterns against *text*.

        Returns a list of :class:`ExtractedValue` objects (one entry per
        successfully extracted parameter–value pair) sorted by confidence
        descending.
        """
        if not text or not text.strip():
            return []

        results: list[ExtractedValue] = []

        for param, patterns in self._compiled.items():
            best: ExtractedValue | None = None

            for regex, base_confidence, unit_hint in patterns:
                for match in regex.finditer(text):
                    raw_val_str = match.group("value").replace(",", "")
                    try:
                        raw_val = float(raw_val_str)
                    except ValueError:
                        continue

                    start = max(0, match.start() - 120)
                    end   = min(len(text), match.end() + 120)
                    context = text[start:end].strip()

                    value, unit, confidence = self._normalise(
                        raw_val, unit_hint, context, base_confidence, param
                    )

                    if value is None or confidence < self._min_confidence:
                        continue

                    ev = ExtractedValue(
                        parameter=param,
                        value=value,
                        unit=unit,
                        context=context,
                        confidence=confidence,
                        raw_match=match.group(0),
                    )

                    if best is None or ev.confidence > best.confidence:
                        best = ev

            if best:
                results.append(best)

        results.sort(key=lambda x: x.confidence, reverse=True)
        return results

    # ------------------------------------------------------------------

    def _normalise(
        self,
        raw_value: float,
        unit_hint: str,
        context: str,
        base_confidence: float,
        param: str,
    ) -> tuple[float | None, str, float]:
        """
        Convert *raw_value* to the canonical unit for *param* and
        adjust confidence based on context plausibility.

        Returns (value, canonical_unit, confidence).
        """
        value   = raw_value
        unit    = unit_hint
        conf    = base_confidence

        try:
            if unit_hint == "M_USD/MW":
                # 1.2 M€/MW → $/kW = 1.2e6 / 1000 = 1200 $/kW
                mag = 1e6
                value = _currency_to_usd(raw_value * mag / 1000, context)
                unit  = "USD/kW"

            elif unit_hint == "USD/kW":
                value = _currency_to_usd(raw_value, context)

            elif unit_hint == "USD/kW/yr":
                value = _currency_to_usd(raw_value, context)

            elif unit_hint == "USD/MWh":
                value = _currency_to_usd(raw_value, context)

            elif unit_hint == "COP":
                value = raw_value * 100   # COP 3.5 → 350 %
                unit  = "%"
                conf  = base_confidence * 0.9   # slight penalty for inference

            elif unit_hint == "kg/kWh":
                value = raw_value * 1000   # kg/kWh → g/kWh
                unit  = "g/kWh"

            elif unit_hint == "tCO2/MWh":
                value = raw_value * 1000   # tCO2/MWh → g/kWh (×1000/1 = ×1000)
                unit  = "g/kWh"

            # Plausibility checks – reject obviously wrong values
            if not self._plausible(param, value):
                return None, unit, 0.0

        except Exception:
            return None, unit_hint, 0.0

        return value, unit, conf

    # ------------------------------------------------------------------

    @staticmethod
    def _plausible(param: str, value: float) -> bool:
        """
        Basic sanity bounds to reject clearly wrong extractions
        (e.g. a year value accidentally matched as a CAPEX).
        """
        bounds: dict[str, tuple[float, float]] = {
            "capex_usd_per_kw":              (50,     25_000),
            "opex_fixed_usd_per_kw_yr":      (0.1,    1_000),
            "opex_var_usd_per_mwh":          (0.0,    500),
            "efficiency_percent":             (1.0,    700),   # COP×100 up to 700
            "lifetime_years":                (5.0,    100),
            "co2_emission_factor_g_per_kwh": (0.0,    3_000),
            "typical_capacity_mw":           (0.0003, 20_000),
            "degradation_rate_percent_per_yr": (0.0,  10),
        }
        lo, hi = bounds.get(param, (-1e12, 1e12))
        return lo <= value <= hi

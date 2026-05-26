"""
scrapers/extractors/text_extractor.py
=======================================
Regex-based parameter extractor.

Scans paper abstracts and full text for cost/performance indicators using
pattern matching. No external services required.

Extracted parameters
--------------------
Core economic
  capex_usd_per_kw              Capital expenditure ($/kW)
  capex_usd_per_kwh             Capital expenditure — energy basis ($/kWh, storage)
  opex_fixed_usd_per_kw_yr      Fixed O&M ($/kW/year)
  opex_var_usd_per_mwh          Variable O&M ($/MWh)
  lcoe_usd_per_mwh              Levelized cost of electricity ($/MWh)
  lcoh_usd_per_kg               Levelized cost of hydrogen ($/kg H₂)

Core performance
  efficiency_percent            Net electrical efficiency (%)
  capacity_factor_percent       Annual capacity factor (%)
  lifetime_years                Technical/economic lifetime (years)
  typical_capacity_mw           Typical rated capacity (MW)
  degradation_rate_percent_per_yr  Annual degradation rate (%/yr)
  ramp_rate_pct_per_min         Ramp rate (%/min full load)

Environmental
  co2_emission_factor_g_per_kwh Direct CO₂ emissions (g/kWh)
  co2_capture_rate_percent      CO₂ capture efficiency for CCS (%)

Storage-specific
  energy_density_wh_per_kg      Gravimetric energy density (Wh/kg)
  power_density_w_per_l         Volumetric power density (W/L)
  self_discharge_pct_per_day    Self-discharge rate (%/day)
  roundtrip_efficiency_fraction Round-trip efficiency (fraction 0–1)
  cycle_lifetime_cycles         Cycle lifetime (full cycles)

Wind-specific
  rotor_diameter_m / hub_height_m / wind_rated_speed_ms

Solar-specific
  module_efficiency_fraction / performance_ratio / solar_multiple
  thermal_storage_h

Thermal-specific
  heat_rate_mj_per_mwh / min_load_fraction / start_up_time_h

Electrolyzer-specific
  stack_lifetime_h / cop_heating_at_a7_w35

Transmission-specific
  loss_rate_pct_per_km

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
        # "$1,050/kW" or "USD 850 per kW" — with keyword prefix
        (
            rf"(?:capital\s+(?:cost|expenditure)|CAPEX|overnight\s+cost|investment\s+cost|"
            rf"specific\s+investment|installed\s+cost|all[\-\s]in\s+cost|EPC\s+cost|"
            rf"total\s+capital\s+(?:cost|requirement)|construction\s+cost)"
            rf"[^$€\d]{{0,40}}{_CURRENCY}?{_NUM}[^a-zA-Z]{{0,10}}(?:/|\s+per\s+){_PER_KW}",
            0.90, "USD/kW",
        ),
        # "1,200 $/kW" bare — dollar/euro sign with slash
        (
            rf"{_CURRENCY}{_NUM}{_OWS}/{_OWS}{_PER_KW}",
            0.80, "USD/kW",
        ),
        # "1,200 USD per kW" bare — currency word with per
        (
            rf"{_NUM}{_OWS}(?:USD|EUR|€|US\$)\s+per\s+{_PER_KW}",
            0.78, "USD/kW",
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
        # "overnight cost of $7,000 per kilowatt"
        (
            rf"overnight\s+(?:capital\s+)?cost[^$€\d]{{0,40}}{_CURRENCY}?{_NUM}[^a-zA-Z]{{0,10}}per\s+kilowatt",
            0.90, "USD/kW",
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

    # ------------------------------------------------- Construction time
    "construction_time_years": [
        # "construction period of 5 years" / "construction lead time of 6 years"
        (
            rf"(?:construction|build|project\s+development)\s+"
            rf"(?:period|time|duration|lead[\s-]time)"
            rf"[^0-9]{{0,20}}{_NUM}\s*(?:years?|yr)",
            0.90, "years",
        ),
        # "5-year construction time" / "6-year build period"
        (
            rf"{_NUM}[\s-]year[^a-z]{{0,15}}(?:construction|build|development)",
            0.88, "years",
        ),
        # "takes X years to construct / build"
        (
            rf"takes?\s+{_NUM}\s*(?:years?|yr)\s+to\s+(?:construct|build|complete)",
            0.85, "years",
        ),
        # "construction duration: X years"
        (
            rf"construction\s+duration[^0-9]{{0,20}}{_NUM}\s*(?:years?|yr)",
            0.87, "years",
        ),
        (
            rf"construction_time_years\s*=\s*{_NUM}",
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

    # ------------------------------------------------- Wind: rotor diameter
    "rotor_diameter_m": [
        (rf"rotor\s+diameter\s+(?:of\s+)?{_NUM}\s*m", 0.88, "m"),
        (rf"{_NUM}\s*m\s+rotor", 0.82, "m"),
        (rf"rotor_diameter_m\s*=\s*{_NUM}", 0.95, "m"),
    ],

    # ------------------------------------------------- Wind: hub height
    "hub_height_m": [
        (rf"hub\s+height\s+(?:of\s+)?{_NUM}\s*m", 0.88, "m"),
        (rf"{_NUM}\s*m\s+hub", 0.80, "m"),
        (rf"hub_height_m\s*=\s*{_NUM}", 0.95, "m"),
    ],

    # ------------------------------------------------- Wind: rated speed
    "wind_rated_speed_ms": [
        (rf"(?:rated|cut-out|nominal)\s+wind\s+speed\s+(?:of\s+)?{_NUM}\s*m/s", 0.88, "m/s"),
        (rf"{_NUM}\s*m/s\s+rated", 0.80, "m/s"),
        (rf"wind_rated_speed_ms\s*=\s*{_NUM}", 0.95, "m/s"),
    ],

    # ------------------------------------------------- Solar: module efficiency
    "module_efficiency_fraction": [
        (rf"module\s+efficiency\s+(?:of\s+)?{_NUM}\s*%", 0.88, "%"),
        (rf"cell\s+efficiency\s+(?:of\s+)?{_NUM}\s*%", 0.82, "%"),
        (rf"module_efficiency_fraction\s*=\s*{_NUM}", 0.95, "fraction"),
    ],

    # ------------------------------------------------- Solar: performance ratio
    "performance_ratio": [
        (rf"performance\s+ratio\s+(?:PR\s+)?(?:of\s+)?{_NUM}", 0.88, "fraction"),
        (rf"PR\s*=\s*{_NUM}", 0.80, "fraction"),
        (rf"performance_ratio\s*=\s*{_NUM}", 0.95, "fraction"),
    ],

    # ------------------------------------------------- CSP: solar multiple
    "solar_multiple": [
        (rf"solar\s+multiple\s+(?:SM\s+)?(?:of\s+)?{_NUM}", 0.88, ""),
        (rf"SM\s*[=:]\s*{_NUM}", 0.82, ""),
        (rf"solar_multiple\s*=\s*{_NUM}", 0.95, ""),
    ],

    # ------------------------------------------------- CSP: TES hours
    "thermal_storage_h": [
        (rf"thermal\s+energy\s+storage\s+(?:of\s+)?{_NUM}\s*h(?:ours?)?", 0.88, "h"),
        (rf"TES\s+(?:of\s+)?{_NUM}\s*h(?:ours?)?", 0.85, "h"),
        (rf"thermal_storage_h\s*=\s*{_NUM}", 0.95, "h"),
    ],

    # ------------------------------------------------- Thermal: heat rate
    "heat_rate_mj_per_mwh": [
        (rf"heat\s+rate\s+(?:of\s+)?{_NUM}\s*MJ/MWh", 0.90, "MJ/MWh"),
        (rf"heat\s+rate\s+(?:of\s+)?{_NUM}\s*BTU/kWh", 0.85, "BTU/kWh"),
        (rf"heat_rate_mj_per_mwh\s*=\s*{_NUM}", 0.95, "MJ/MWh"),
    ],

    # ------------------------------------------------- Thermal: min load
    "min_load_fraction": [
        (rf"minimum\s+(?:stable\s+)?load\s+(?:of\s+)?{_NUM}\s*%", 0.88, "%"),
        (rf"min(?:imum)?\s+load\s+fraction\s+(?:of\s+)?{_NUM}", 0.85, "fraction"),
        (rf"min_load_fraction\s*=\s*{_NUM}", 0.95, "fraction"),
    ],

    # ------------------------------------------------- Thermal: start-up time
    "start_up_time_h": [
        (rf"(?:warm\s+)?start[\-\s]?up\s+time\s+(?:of\s+)?{_NUM}\s*h(?:ours?)?", 0.88, "h"),
        (rf"start_up_time_h\s*=\s*{_NUM}", 0.95, "h"),
    ],

    # ------------------------------------------------- Electrolyzer: stack lifetime
    "stack_lifetime_h": [
        (rf"stack\s+lifetime\s+(?:of\s+)?{_NUM}\s*(?:h|hours?)", 0.88, "h"),
        (rf"stack_lifetime_h\s*=\s*{_NUM}", 0.95, "h"),
    ],

    # ------------------------------------------------- Storage: roundtrip efficiency
    "roundtrip_efficiency_fraction": [
        (rf"round[\-\s]?trip\s+efficiency\s+(?:of\s+)?{_NUM}\s*%", 0.88, "%"),
        (rf"RTE\s+(?:of\s+)?{_NUM}\s*%", 0.82, "%"),
        (rf"roundtrip_efficiency_fraction\s*=\s*{_NUM}", 0.95, "fraction"),
    ],

    # ------------------------------------------------- Transmission: loss rate
    "loss_rate_pct_per_km": [
        (rf"(?:line\s+)?loss(?:es)?\s+(?:of\s+)?{_NUM}\s*%\s*(?:per\s+)?km", 0.88, "%/km"),
        (rf"loss_rate_pct_per_km\s*=\s*{_NUM}", 0.95, "%/km"),
    ],

    # ------------------------------------------------- Storage: cycle lifetime
    "cycle_lifetime_cycles": [
        (rf"cycle\s+(?:life\s+)?(?:of\s+)?{_NUM}\s*cycles?", 0.88, "cycles"),
        (rf"{_NUM}\s*cycles?\s+(?:lifetime|life)", 0.82, "cycles"),
        (rf"cycle_lifetime_cycles\s*=\s*{_NUM}", 0.95, "cycles"),
    ],

    # ------------------------------------------------- Heat pump: COP
    "cop_heating_at_a7_w35": [
        (rf"COP\s+(?:of\s+)?{_NUM}\s*(?:at\s+A7/W35|heating)?", 0.85, ""),
        (rf"cop_heating_at_a7_w35\s*=\s*{_NUM}", 0.95, ""),
    ],

    # ----------------------------------------------------------------- LCOE
    "lcoe_usd_per_mwh": [
        # "LCOE of 65 USD/MWh" or "levelized cost of energy of 65 $/MWh"
        (
            rf"(?:LCOE|levelized\s+cost\s+of\s+(?:energy|electricity))"
            rf"[^$€\d]{{0,50}}{_CURRENCY}?{_NUM}\s*{_CURRENCY}?(?:/|per\s+){_PER_MWH}",
            0.90, "USD/MWh",
        ),
        # "65 €/MWh" (bare — lower confidence, context boost later)
        (
            rf"(?:€|\$|USD|EUR)\s*{_NUM}\s*/\s*MWh\b",
            0.75, "USD/MWh",
        ),
        # ATB structured
        (rf"lcoe_usd_per_mwh\s*=\s*{_NUM}", 0.95, "USD/MWh"),
    ],

    # ----------------------------------------------------------------- LCOH
    "lcoh_usd_per_kg": [
        (
            rf"(?:LCOH|levelized\s+cost\s+of\s+hydrogen)"
            rf"[^$€\d]{{0,50}}{_CURRENCY}?{_NUM}\s*{_CURRENCY}?(?:/|per\s+)kg",
            0.90, "USD/kg",
        ),
        (rf"(?:€|\$|USD|EUR)\s*{_NUM}\s*/\s*kg\s*H[₂2]", 0.85, "USD/kg"),
        (rf"lcoh_usd_per_kg\s*=\s*{_NUM}", 0.95, "USD/kg"),
    ],

    # ------------------------------------------------------------- CAPEX $/kWh
    "capex_usd_per_kwh": [
        (
            rf"(?:capital\s+(?:cost|expenditure)|CAPEX|storage\s+cost)"
            rf"[^$€\d]{{0,40}}{_CURRENCY}?{_NUM}\s*{_CURRENCY}?(?:/|per\s+){_PER_KWH}",
            0.88, "USD/kWh",
        ),
        (
            rf"{_CURRENCY}{_NUM}\s*/\s*kWh\b",
            0.78, "USD/kWh",
        ),
        (rf"capex_usd_per_kwh\s*=\s*{_NUM}", 0.95, "USD/kWh"),
    ],

    # ----------------------------------------------------- Capacity factor %
    "capacity_factor_percent": [
        (
            rf"capacity\s+factor\s+(?:of\s+)?{_NUM}\s*%",
            0.90, "%",
        ),
        (
            rf"{_NUM}\s*%\s+capacity\s+factor",
            0.88, "%",
        ),
        (
            rf"capacity\s+factor\s+(?:of\s+)?{_NUM}\s+(?:percent|pct)",
            0.85, "%",
        ),
        (
            rf"load\s+factor\s+(?:of\s+)?{_NUM}\s*%",
            0.82, "%",
        ),
        (
            rf"load\s+factor\s+(?:of\s+)?{_NUM}\s+(?:percent|pct)",
            0.78, "%",
        ),
        (
            rf"annual\s+(?:energy\s+)?yield[^%\d]{{0,40}}{_NUM}\s*%\s+(?:of\s+)?installed",
            0.80, "%",
        ),
        (rf"capacity_factor_percent\s*=\s*{_NUM}", 0.95, "%"),
    ],

    # ------------------------------------------------------- Energy density
    "energy_density_wh_per_kg": [
        (
            rf"(?:specific\s+energy|energy\s+density|gravimetric\s+energy)"
            rf"[^0-9]{{0,30}}{_NUM}\s*Wh\s*/\s*kg",
            0.90, "Wh/kg",
        ),
        (
            rf"{_NUM}\s*Wh\s*/\s*kg\b",
            0.82, "Wh/kg",
        ),
        (
            rf"{_NUM}\s*kWh\s*/\s*kg\b",
            0.80, "kWh/kg",   # will be ×1000 in normalise
        ),
        (rf"energy_density_wh_per_kg\s*=\s*{_NUM}", 0.95, "Wh/kg"),
    ],

    # -------------------------------------------- Power density (W/L) — batteries
    "power_density_w_per_l": [
        (
            rf"(?:power\s+density|specific\s+power)[^0-9]{{0,30}}{_NUM}\s*W\s*/\s*L\b",
            0.88, "W/L",
        ),
        (
            rf"{_NUM}\s*W\s*/\s*(?:litre|liter|L)\b",
            0.78, "W/L",
        ),
        (rf"power_density_w_per_l\s*=\s*{_NUM}", 0.95, "W/L"),
    ],

    # ------------------------------------------------------ Self-discharge
    "self_discharge_pct_per_day": [
        (
            rf"self[\-\s]?discharge\s+(?:rate\s+)?(?:of\s+)?{_NUM}\s*%\s*(?:per\s+day|/day)",
            0.90, "%/day",
        ),
        (
            rf"{_NUM}\s*%\s*(?:per\s+day|/day)\s+self[\-\s]?discharge",
            0.85, "%/day",
        ),
        (rf"self_discharge_pct_per_day\s*=\s*{_NUM}", 0.95, "%/day"),
    ],

    # ------------------------------------------------------- Ramp rate %/min
    "ramp_rate_pct_per_min": [
        (
            rf"ramp(?:ing)?\s+rate\s+(?:of\s+)?{_NUM}\s*%\s*(?:per\s+min(?:ute)?|/min)",
            0.90, "%/min",
        ),
        (
            rf"{_NUM}\s*%\s*/\s*min(?:ute)?\s+ramp",
            0.85, "%/min",
        ),
        (rf"ramp_rate_pct_per_min\s*=\s*{_NUM}", 0.95, "%/min"),
    ],

    # --------------------------------------------------- CO₂ capture rate %
    "co2_capture_rate_percent": [
        (
            rf"(?:CO[₂2]|carbon)\s+capture\s+(?:rate|efficiency)\s+(?:of\s+)?{_NUM}\s*%",
            0.90, "%",
        ),
        (
            rf"{_NUM}\s*%\s+(?:CO[₂2]|carbon)\s+capture",
            0.85, "%",
        ),
        (rf"co2_capture_rate_percent\s*=\s*{_NUM}", 0.95, "%"),
    ],

    # -------------------------------------------- Cold start time (hours)
    "cold_start_time_h": [
        (
            rf"cold[\s\-]?start[\s\-]?(?:up\s+)?time\s+(?:of\s+)?{_NUM}\s*h(?:ours?)?",
            0.88, "h",
        ),
        (rf"cold_start_time_h\s*=\s*{_NUM}", 0.95, "h"),
    ],

    # ----------------------------------------- DOD max fraction (storage)
    "dod_max_fraction": [
        (
            rf"(?:maximum|max\.?)\s+(?:depth\s+of\s+discharge|DOD)\s+(?:of\s+)?{_NUM}\s*%",
            0.88, "%",
        ),
        (
            rf"DOD\s+(?:of\s+)?{_NUM}\s*%",
            0.82, "%",
        ),
        (rf"dod_max_fraction\s*=\s*{_NUM}", 0.95, "fraction"),
    ],

    # --------------------------------------------- Charge efficiency (fraction)
    "charge_efficiency_fraction": [
        (
            rf"charge(?:ing)?\s+efficiency\s+(?:of\s+)?{_NUM}\s*%",
            0.88, "%",
        ),
        (rf"charge_efficiency_fraction\s*=\s*{_NUM}", 0.95, "fraction"),
    ],

    # ------------------------------------------ Discharge efficiency (fraction)
    "discharge_efficiency_fraction": [
        (
            rf"discharge\s+efficiency\s+(?:of\s+)?{_NUM}\s*%",
            0.88, "%",
        ),
        (rf"discharge_efficiency_fraction\s*=\s*{_NUM}", 0.95, "fraction"),
    ],

    # ------------------------------------------------- Transmission: voltage kV
    "voltage_kv": [
        (
            rf"(?:operating|rated|nominal|line)\s+voltage\s+(?:of\s+)?{_NUM}\s*kV",
            0.88, "kV",
        ),
        (
            rf"{_NUM}\s*kV\s+(?:HVDC|HVAC|AC|DC|line|transmission)",
            0.85, "kV",
        ),
        (rf"voltage_kv\s*=\s*{_NUM}", 0.95, "kV"),
    ],

    # ---------------------------------------- Water withdrawal (m³/MWh)
    "water_withdrawal_m3_per_mwh": [
        (
            rf"water\s+(?:withdrawal|consumption|use)\s+(?:of\s+)?{_NUM}\s*m[³3]/MWh",
            0.88, "m³/MWh",
        ),
        (rf"water_withdrawal_m3_per_mwh\s*=\s*{_NUM}", 0.95, "m³/MWh"),
    ],

    # -------------------------------------------- Land use (m²/kW)
    "land_use_m2_per_kw": [
        (
            rf"land\s+(?:use|area|footprint)\s+(?:of\s+)?{_NUM}\s*m[²2]/kW",
            0.88, "m²/kW",
        ),
        (
            rf"{_NUM}\s*m[²2]\s*/\s*kW\s+land",
            0.82, "m²/kW",
        ),
        (rf"land_use_m2_per_kw\s*=\s*{_NUM}", 0.95, "m²/kW"),
    ],

    # ---------------------------------------- Optical efficiency (CSP)
    "optical_efficiency_fraction": [
        (
            rf"optical\s+efficiency\s+(?:of\s+)?{_NUM}\s*%",
            0.88, "%",
        ),
        (rf"optical_efficiency_fraction\s*=\s*{_NUM}", 0.95, "fraction"),
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

            elif unit_hint == "kWh/kg":
                value = raw_value * 1000   # kWh/kg → Wh/kg
                unit  = "Wh/kg"

            elif unit_hint in ("%",) and param in (
                "module_efficiency_fraction",
                "performance_ratio",
                "roundtrip_efficiency_fraction",
                "charge_efficiency_fraction",
                "discharge_efficiency_fraction",
                "dod_max_fraction",
                "optical_efficiency_fraction",
                "min_load_fraction",
            ):
                # These params are fractions but patterns match % text;
                # keep value as %, unit as % — caller converts to fraction if needed
                pass

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
            "capex_usd_per_kw":                (50,      25_000),
            "capex_usd_per_kwh":               (5,       10_000),
            "opex_fixed_usd_per_kw_yr":        (0.1,     1_000),
            "opex_var_usd_per_mwh":            (0.0,     500),
            "lcoe_usd_per_mwh":                (1.0,     2_000),
            "lcoh_usd_per_kg":                 (0.5,     50),
            "efficiency_percent":              (1.0,     500),   # COP×100 ≤ 5 → 500%
            "capacity_factor_percent":         (1.0,     100),
            "lifetime_years":                  (5.0,     100),            "construction_time_years":          (0.3,    25),            "co2_emission_factor_g_per_kwh":   (0.0,     3_000),
            "co2_capture_rate_percent":        (0.0,     100),
            "typical_capacity_mw":             (0.0003,  20_000),
            "degradation_rate_percent_per_yr": (0.0,     10),
            "energy_density_wh_per_kg":        (10,      5_000),
            "power_density_w_per_l":           (1,       10_000),
            "self_discharge_pct_per_day":      (0.0,     10),
            "ramp_rate_pct_per_min":           (0.01,    100),
            "cycle_lifetime_cycles":           (10,      1_000_000),
            "roundtrip_efficiency_fraction":   (0.1,     100),  # % or fraction
            "charge_efficiency_fraction":      (0.1,     100),
            "discharge_efficiency_fraction":   (0.1,     100),
            "dod_max_fraction":                (0.1,     100),
            "voltage_kv":                      (1,       2_000),
            "loss_rate_pct_per_km":            (0.0001,  5),
            "land_use_m2_per_kw":              (0.0,     100_000),
            "water_withdrawal_m3_per_mwh":     (0.0,     500),
            "stack_lifetime_h":                (100,     200_000),
            "hub_height_m":                    (10,      300),
            "rotor_diameter_m":                (1,       400),
            "thermal_storage_h":               (0.5,     20),
        }
        lo, hi = bounds.get(param, (-1e12, 1e12))
        return lo <= value <= hi

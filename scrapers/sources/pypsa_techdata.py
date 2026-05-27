"""
scrapers/sources/pypsa_techdata.py
====================================
PyPSA/technology-data scraper.

Downloads the canonical energy-technology cost CSV from the open-source
PyPSA/technology-data GitHub repository.  This dataset aggregates cost and
performance data from multiple authoritative sources:

  • IRENA Renewable Power Generation Costs (2020–2023)
  • Danish Energy Agency (DEA) Technology Catalogue (2022–2023)
  • NREL Annual Technology Baseline (supplementary US figures)
  • IEA/NEA Technology costs
  • Various peer-reviewed studies

CSV available at (no authentication required):
  https://raw.githubusercontent.com/PyPSA/technology-data/master/outputs/costs_{year}.csv

Available projection years: 2020, 2025, 2030, 2035, 2040, 2045, 2050

For each technology the scraper emits a PaperRecord whose `abstract`
carries `key = value` lines that the TextExtractor parses with confidence ≥ 0.95.
"""

from __future__ import annotations

import io
import logging
from typing import Any

from scrapers.base import BaseScraper, PaperRecord
from scrapers.config import ScraperConfig

logger = logging.getLogger(__name__)

# Module-level cache: year → parsed CSV rows (avoids re-downloading per tech).
_PYPSA_CSV_CACHE: dict[int, list[dict]] = {}

_EUR_TO_USD = 1.10  # approximate EUR→USD conversion

# CSV template for PyPSA/technology-data (public GitHub raw URL)
_PYPSA_CSV_URL = (
    "https://raw.githubusercontent.com/PyPSA/technology-data/master/outputs/costs_{year}.csv"
)

# ---------------------------------------------------------------------------
# Technology name mapping: PyPSA name → OpenTechDB technology_id
# ---------------------------------------------------------------------------
_PYPSA_TECH_MAP: dict[str, str] = {
    # Solar PV
    "solar-utility":                        "solar_pv_utility",
    "solar-utility single-axis tracking":   "solar_pv_utility",
    "solar":                                "solar_pv_utility",
    "solar-rooftop":                        "solar_pv_distributed",
    # Wind
    "onwind":                               "onshore_wind",
    "offwind":                              "offshore_wind_fixed",
    "offwind-ac":                           "offshore_wind_fixed",
    "offwind-dc":                           "offshore_wind_fixed",
    "offwind-float":                        "offshore_wind_floating",
    # Dispatchable generation
    "nuclear":                              "nuclear_conventional",
    "CCGT":                                 "ccgt",
    "OCGT":                                 "ocgt",
    "coal":                                 "coal_supercritical",
    "lignite":                              "coal_supercritical",
    "geothermal":                           "geothermal_power",
    "biomass":                              "biomass_power_plant",
    "biogas":                               "biomass_power_plant",
    "CSP":                                  "csp_tower",
    "csp-tower":                            "csp_tower",
    # Hydro
    "hydro":                                "hydro_reservoir",
    "ror":                                  "hydro_run_of_river",
    "PHS":                                  "pumped_hydro_storage",
    # Storage
    "battery inverter":                     "lithium_ion_bess",
    "battery storage":                      "lithium_ion_bess",
    "home battery inverter":                "lithium_ion_bess",
    "home battery storage":                 "lithium_ion_bess",
    # H2 / conversion
    "Alkaline electrolyzer large size":     "alkaline_electrolyzer",
    "electrolysis":                         "alkaline_electrolyzer",
    "H2 (g) storage tank":                  "hydrogen_storage_compressed",
    "H2 (l) storage":                       "hydrogen_storage_liquid",
    "fuel cell":                            "proton_exchange_membrane_fuel_cell",
    "methanation":                          "power_to_methane",
    "Fischer-Tropsch":                      "power_to_liquid",
    # Heat
    "water tanks charger":                  "sensible_heat_thermal_storage",
    "water tanks discharger":               "sensible_heat_thermal_storage",
    "air sourced heat pump":                "heat_pump_air_source",
    "ground sourced heat pump":             "heat_pump_ground_source",
    "central air-sourced heat pump":        "heat_pump_air_source",
    "residential rural air-sourced heat pump": "heat_pump_air_source",
    "urban central air-sourced heat pump":  "heat_pump_air_source",
    # Transmission
    "HVDC overhead":                        "hvdc_overhead",
    "HVDC submarine":                       "hvdc_submarine",
    "HVDC inverter pair":                   "hvdc_submarine",
    "HVAC overhead":                        "hvac_overhead_line",
}

# ---------------------------------------------------------------------------
# Parameter mapping: PyPSA parameter name → canonical OpenTechDB field name.
# Values starting with "_" need post-processing (see _convert_param).
# ---------------------------------------------------------------------------
_PYPSA_PARAM_MAP: dict[str, str] = {
    "investment":        "_investment",       # EUR/kW or EUR/kWh → choose field by unit
    "FOM":               "_fom",              # EUR/kW/year OR %/year of investment
    "VOM":               "opex_var_usd_per_mwh",
    "efficiency":        "_efficiency",       # per unit (0–1) → multiply by 100
    "lifetime":          "lifetime_years",
    "CO2 intensity":     "_co2_intensity",    # tCO2/MWh → g/kWh ×1000
    "capital_cost":      "_investment",       # alias
    "marginal_cost":     "opex_var_usd_per_mwh",
    "FLH":               "_flh",             # full load hours / 8760 × 100 → capacity factor
    "capacity factor":   "_cap_factor",      # fraction → %
    "CF":                "_cap_factor",
    "efficiency-heat":   "_efficiency",
    "efficiency-electricity": "_efficiency",
}


class PyPSATechDataScraper(BaseScraper):
    """
    Downloads the PyPSA/technology-data cost CSV and converts the data
    into PaperRecord stubs whose `full_text` carries structured key=value
    lines that the TextExtractor parses with confidence ≥ 0.95.
    """

    source_name = "pypsa_techdata"

    def __init__(self, cfg: ScraperConfig) -> None:
        super().__init__(cfg)
        src_cfg = getattr(cfg.sources, "pypsa_techdata", None)
        self._years: list[int] = list(getattr(src_cfg, "projection_years", [2025, 2030]))

    # ------------------------------------------------------------------

    def search(
        self,
        technology_id: str,
        queries: list[str],   # unused – structured source, not text-search
        **kwargs: Any,
    ) -> list[PaperRecord]:
        """Return PyPSA cost records for *technology_id* as PaperRecord stubs."""
        results: list[PaperRecord] = []

        # Reverse-map technology_id → PyPSA tech names
        pypsa_names = [
            name
            for name, mapped_id in _PYPSA_TECH_MAP.items()
            if mapped_id == technology_id
        ]
        if not pypsa_names:
            logger.debug("[PyPSA] No PyPSA mapping for tech=%s", technology_id)
            return []

        for year in self._years:
            csv_rows = self._load_csv(year)
            if not csv_rows:
                continue
            for pypsa_name in pypsa_names:
                records = self._extract_tech_records(csv_rows, pypsa_name, technology_id, year)
                results.extend(records)

        # Deduplicate by source_id
        seen: set[str] = set()
        unique: list[PaperRecord] = []
        for r in results:
            if r.source_id not in seen:
                seen.add(r.source_id)
                unique.append(r)

        logger.info("[PyPSA] tech=%s → %d records", technology_id, len(unique))
        return unique

    # ------------------------------------------------------------------

    def _load_csv(self, year: int) -> list[dict] | None:
        """Download and parse the CSV for *year*; uses module-level cache."""
        if year in _PYPSA_CSV_CACHE:
            return _PYPSA_CSV_CACHE[year]

        try:
            import csv as csvlib
        except ImportError:
            return None

        url = _PYPSA_CSV_URL.format(year=year)
        logger.info("[PyPSA] Downloading technology-data %d CSV from %s", year, url)
        raw_bytes = self._get_bytes(url)
        if not raw_bytes:
            logger.warning("[PyPSA] Could not download costs_%d.csv", year)
            return None

        try:
            text = raw_bytes.decode("utf-8-sig")
            reader = csvlib.DictReader(io.StringIO(text))
            rows = list(reader)
            _PYPSA_CSV_CACHE[year] = rows
            logger.info("[PyPSA] Costs %d CSV cached (%d rows).", year, len(rows))
            return rows
        except Exception as exc:
            logger.warning("[PyPSA] CSV parse error (year=%d): %s", year, exc)
            return None

    def _extract_tech_records(
        self,
        rows: list[dict],
        pypsa_name: str,
        tech_id: str,
        year: int,
    ) -> list[PaperRecord]:
        """
        Find all rows matching *pypsa_name* and convert to one PaperRecord.
        """
        # Collect raw parameter values for this technology
        raw: dict[str, tuple[float, str]] = {}  # param → (value, unit)

        for row in rows:
            tech_col  = (row.get("technology") or row.get("technology_name") or "").strip()
            param_col = (row.get("parameter") or "").strip()
            unit_col  = (row.get("unit") or "").strip()
            value_col = (row.get("value") or "").strip()

            if tech_col != pypsa_name:
                continue
            if param_col not in _PYPSA_PARAM_MAP:
                continue
            if not value_col:
                continue

            try:
                fval = float(value_col.replace(",", ""))
            except ValueError:
                continue

            if param_col not in raw:
                raw[param_col] = (fval, unit_col)

        if not raw:
            return []

        # Convert to canonical parameter names and USD units
        output_params: dict[str, float] = {}
        investment_usd_per_kw: float | None = None   # needed to compute FOM

        for pypsa_param, (fval, unit) in raw.items():
            internal = _PYPSA_PARAM_MAP.get(pypsa_param, "")
            if not internal:
                continue

            canonical, converted = self._convert_param(
                internal, fval, unit, investment_usd_per_kw
            )
            if canonical and converted is not None:
                output_params[canonical] = converted
                if canonical == "capex_usd_per_kw":
                    investment_usd_per_kw = converted

        # Second pass: recompute FOM if unit was %/year and we now have CAPEX
        for pypsa_param, (fval, unit) in raw.items():
            if pypsa_param != "FOM":
                continue
            unit_low = unit.lower()
            if "%/year" in unit_low or "% of invest" in unit_low or unit_low == "%":
                if investment_usd_per_kw and "opex_fixed_usd_per_kw_yr" not in output_params:
                    output_params["opex_fixed_usd_per_kw_yr"] = round(
                        investment_usd_per_kw * fval / 100, 4
                    )

        if not output_params:
            return []

        lines: list[str] = [
            f"PyPSA/technology-data {year} – {pypsa_name}",
            f"Source: IRENA / DEA / NREL (aggregated). Projection year: {year}",
        ]
        for field, value in output_params.items():
            lines.append(f"{field} = {value}")

        full_text = "\n".join(lines)
        record_id = (
            f"pypsa_{year}_{pypsa_name.lower().replace(' ', '_').replace('(', '').replace(')', '')}"
        )

        return [PaperRecord(
            source_name=self.source_name,
            source_id=record_id,
            title=f"PyPSA Technology Data {year}: {pypsa_name}",
            doi=None,
            year=year,
            authors=["PyPSA/technology-data", "IRENA", "DEA", "NREL"],
            abstract=full_text,
            full_text=full_text,
            url=f"https://github.com/PyPSA/technology-data/blob/master/outputs/costs_{year}.csv",
            venue="PyPSA/technology-data (IRENA·DEA·NREL aggregation)",
            countries=[],
        )]

    # ------------------------------------------------------------------

    @staticmethod
    def _convert_param(
        internal: str,
        fval: float,
        unit: str,
        investment_usd_per_kw: float | None,
    ) -> tuple[str | None, float | None]:
        """
        Convert a PyPSA internal param reference to (canonical_name, value_in_SI/USD).

        Returns (None, None) when the value cannot be converted meaningfully.
        """
        unit_low = unit.lower()

        if internal == "_investment":
            # EUR/kW → USD/kW
            if "kwh" in unit_low or "/kwh" in unit_low:
                return "capex_usd_per_kwh", round(fval * _EUR_TO_USD, 2)
            else:
                return "capex_usd_per_kw", round(fval * _EUR_TO_USD, 2)

        elif internal == "_fom":
            # EUR/kW/year → USD/kW/year
            if "%/year" in unit_low or "% of invest" in unit_low or unit_low == "%":
                # Will be computed after CAPEX is known; skip here
                if investment_usd_per_kw:
                    return "opex_fixed_usd_per_kw_yr", round(
                        investment_usd_per_kw * fval / 100, 4
                    )
                return None, None
            else:
                return "opex_fixed_usd_per_kw_yr", round(fval * _EUR_TO_USD, 2)

        elif internal == "opex_var_usd_per_mwh":
            return "opex_var_usd_per_mwh", round(fval * _EUR_TO_USD, 4)

        elif internal == "_efficiency":
            # per unit (0–1) → percent, or already %
            if fval <= 1.1:
                return "efficiency_percent", round(fval * 100, 2)
            else:
                return "efficiency_percent", round(fval, 2)

        elif internal == "lifetime_years":
            return "lifetime_years", fval

        elif internal == "_co2_intensity":
            # tCO2/MWh → g/kWh × 1000
            if "tco2" in unit_low or "t co2" in unit_low or "tonne" in unit_low:
                return "co2_emission_factor_g_per_kwh", round(fval * 1000, 2)
            # g/kWh → direct
            return "co2_emission_factor_g_per_kwh", round(fval, 2)

        elif internal == "_flh":
            # Full load hours → capacity factor %
            if fval > 100:
                return "capacity_factor_percent", round(fval / 8760 * 100, 2)

        elif internal == "_cap_factor":
            # fraction or %
            if fval <= 1.05:
                return "capacity_factor_percent", round(fval * 100, 2)
            else:
                return "capacity_factor_percent", round(fval, 2)

        return None, None

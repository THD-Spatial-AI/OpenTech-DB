"""
scrapers/sources/nrel_atb.py
=============================
NREL Annual Technology Baseline (ATB) scraper.

The ATB is the most authoritative US cost dataset for energy technologies.
New editions are released annually (typically mid-year).

This scraper downloads the ATB summary CSV/Excel from:
  https://atb.nrel.gov/electricity/<year>/data

Since the ATB uses an interactive data explorer rather than a clean REST API,
we target the downloadable CSV endpoints that NREL provides directly.

Data format reference:
  https://atb-archive.nrel.gov/electricity/2024/definitions

No API key required.
"""

from __future__ import annotations

import io
import logging
from typing import Any

from scrapers.base import BaseScraper, PaperRecord
from scrapers.config import ScraperConfig

logger = logging.getLogger(__name__)

# Module-level CSV cache: (year) → parsed rows.
# Avoids re-downloading the 3.5 MB CSV for every technology in a pipeline run.
_ATB_CSV_CACHE: dict[int, list[dict]] = {}

_BASE = "https://api.openalex.org"  # unused; kept for structural consistency

# ATB summary data available as fixed-URL CSVs
_ATB_SUMMARY_CSV = (
    "https://oedi-data-lake.s3.amazonaws.com/ATB/electricity/csv/"
    "{year}/ATBe.csv"
)

# Fallback – ATB archive page (HTML-parseable links)
_ATB_ARCHIVE_URL = "https://atb.nrel.gov/electricity/{year}/data"

# Mapping from ATB technology column names → OpenTechDB technology_ids
# ATB 2023 column: 'technology' (e.g., 'UtilityPV', 'Nuclear', 'Utility-Scale Battery Storage')
_ATB_TECH_MAP: dict[str, str] = {
    "UtilityPV":                       "solar_pv_utility",
    "CommPV":                          "solar_pv_distributed",
    "ResPV":                           "solar_pv_distributed",
    "LandbasedWind":                   "onshore_wind",
    "OffShoreWind":                    "offshore_wind_fixed",
    "OffshoreWind":                    "offshore_wind_fixed",
    "Nuclear":                         "nuclear_conventional",
    "NaturalGas_CCCCSAdv":             "ccgt",
    "NaturalGas_CCCCS":                "ccgt",
    "NaturalGas_CC":                   "ccgt",
    "NaturalGas_CT":                   "ocgt",
    "CSP":                             "csp_tower",
    "Geothermal":                      "geothermal_power",
    "Biopower":                        "biomass_power_plant",
    "Hydropower":                      "hydro_reservoir",
    # ATB 2023 battery names
    "Utility-Scale Battery Storage":   "lithium_ion_bess",
    "Commercial Battery Storage":      "lithium_ion_bess",
    "Residential Battery Storage":     "lithium_ion_bess",
    # ATB 2023 pumped hydro name
    "Pumped Storage Hydropower":       "pumped_hydro_storage",
    # Coal
    "Coal_FE":                         "coal_supercritical",
    "Coal_Retrofits":                  "coal_supercritical",
}

# Assumed technical lifetimes (years) per OpenTechDB technology_id.
# ATB does not publish lifetime directly; these are the standard assumptions
# documented in the ATB methodology (https://atb.nrel.gov/electricity/2023/methods).
_ATB_LIFETIME_DEFAULTS: dict[str, int] = {
    "solar_pv_utility":        30,
    "solar_pv_distributed":    30,
    "onshore_wind":            30,
    "offshore_wind_fixed":     30,
    "nuclear_conventional":    60,
    "ccgt":                    30,
    "ocgt":                    30,
    "csp_tower":               30,
    "geothermal_power":        30,
    "biomass_power_plant":     30,
    "hydro_reservoir":         50,
    "lithium_ion_bess":        15,
    "pumped_hydro_storage":    50,
    "coal_supercritical":      30,
}

# ATB rows we care about.
# Keys WITHOUT leading underscore → output directly as  field_name = value  in pseudo-text.
# Keys WITH leading underscore   → require conversion before output (handled in _extract_tech_records).
_ATB_PARAMS_OF_INTEREST = {
    "CAPEX":          "capex_usd_per_kw",
    "OCC":            "capex_usd_per_kw",   # Overnight Capital Cost (used for BESS in ATB 2023)
    "Fixed O&M":      "opex_fixed_usd_per_kw_yr",
    "Variable O&M":   "opex_var_usd_per_mwh",
    "LCOE":           "lcoe_usd_per_mwh",
    "Heat Rate":      "_heat_rate_mmbtu_per_mwh",   # converted → efficiency_percent
    "CF":             "_capacity_factor_fraction",  # converted → capacity_factor_percent (×100)
}

# Conversion from MMBtu/MWh heat rate → thermal efficiency fraction:
#   efficiency = 3.412 MMBtu_equiv / heat_rate_mmbtu_per_MWh
#   (because 1 kWh electrical = 3412 BTU ≡ 0.003412 MMBtu)
_MMBTU_PER_MWH_ELECTRICAL = 3.412


class NRELATBScraper(BaseScraper):
    """
    Downloads the NREL ATB summary CSV and converts relevant rows into
    PaperRecord objects whose `full_text` carries structured key=value data
    that the TextExtractor can parse.
    """

    source_name = "nrel_atb"

    def __init__(self, cfg: ScraperConfig) -> None:
        super().__init__(cfg)
        src_cfg = getattr(cfg.sources, "nrel_atb", None)
        self._atb_year = getattr(src_cfg, "atb_year", 2023)
        # Note: per-instance cache is kept for backward compat; real caching
        # is done at module level in _ATB_CSV_CACHE.
        self._atb_year = getattr(src_cfg, "atb_year", 2024)

    # ------------------------------------------------------------------

    def search(
        self,
        technology_id: str,
        queries: list[str],   # unused – ATB is structured, not text-search
        **kwargs: Any,
    ) -> list[PaperRecord]:
        """Return ATB cost records for *technology_id* as PaperRecord stubs."""
        atb_data = self._load_atb_csv()  # returns cached result after first call
        if not atb_data:
            return []

        # Reverse-map technology_id → ATB tech names
        atb_names = [
            atb_name
            for atb_name, opentech_id in _ATB_TECH_MAP.items()
            if opentech_id == technology_id
        ]
        if not atb_names:
            logger.debug("[NREL ATB] No ATB mapping for tech=%s", technology_id)
            return []

        results: list[PaperRecord] = []
        for atb_name in atb_names:
            records = self._extract_tech_records(atb_data, atb_name, technology_id)
            results.extend(records)

        logger.info("[NREL ATB] tech=%s → %d records", technology_id, len(results))
        return results

    # ------------------------------------------------------------------

    def _load_atb_csv(self) -> list[dict] | None:
        """Download and parse the ATB CSV into a list of row dicts.

        Uses a module-level cache keyed by *atb_year* so the ~3.5 MB CSV is
        only downloaded once per Python process, regardless of how many
        technology-scraper instances are created.

        ATB 2023 column layout:
          technology, core_metric_parameter, scenario, core_metric_variable (year),
          value, units, default, ...
        """
        if self._atb_year in _ATB_CSV_CACHE:
            return _ATB_CSV_CACHE[self._atb_year]

        try:
            import csv
        except ImportError:
            return None

        url = _ATB_SUMMARY_CSV.format(year=self._atb_year)
        logger.info("[NREL ATB] Downloading ATB %d CSV from %s", self._atb_year, url)
        raw_bytes = self._get_bytes(url)
        if not raw_bytes:
            logger.warning("[NREL ATB] Could not download ATB CSV for year %d", self._atb_year)
            return None

        try:
            text = raw_bytes.decode("utf-8-sig")
            reader = csv.DictReader(io.StringIO(text))
            rows = list(reader)
            _ATB_CSV_CACHE[self._atb_year] = rows
            logger.info("[NREL ATB] ATB %d CSV cached (%d rows).", self._atb_year, len(rows))
            return rows
        except Exception as exc:
            logger.warning("[NREL ATB] CSV parse error: %s", exc)
            return None

    def _extract_tech_records(
        self,
        rows: list[dict],
        atb_name: str,
        tech_id: str,
    ) -> list[PaperRecord]:
        """
        Find rows for *atb_name* in the ATB CSV and create PaperRecord stubs.
        One PaperRecord per ATB scenario (Conservative / Moderate / Advanced),
        using the ATB year value as the reference year.

        Internal fields starting with '_' are converted to canonical names:
          _capacity_factor_fraction  → capacity_factor_percent  (×100)
          _heat_rate_mmbtu_per_mwh   → efficiency_percent       (3.412/HR ×100)
        """
        records: list[PaperRecord] = []

        # Use the ATB year itself as the reference year for annual snapshot.
        # `core_metric_variable` contains per-projection-year rows; we pick the
        # row whose year equals the ATB edition year to get current estimates.
        target_year_str = str(self._atb_year)

        # Group rows by scenario
        scenarios: dict[str, dict[str, str]] = {}
        for row in rows:
            tech_col  = row.get("technology", "")
            param_col = row.get("core_metric_parameter", "")
            scenario  = row.get("scenario", "Moderate") or "Moderate"
            row_year  = row.get("core_metric_variable", "") or row.get("year", "")
            default   = row.get("default", "1")

            # Only process rows for this ATB technology name
            if tech_col != atb_name:
                continue
            # Only 'default=1' rows to avoid duplicate techdetail variants
            if default != "1":
                continue
            # Only the row matching the ATB edition year
            if row_year != target_year_str:
                continue
            if param_col not in _ATB_PARAMS_OF_INTEREST:
                continue

            internal_key = _ATB_PARAMS_OF_INTEREST[param_col]
            if scenario not in scenarios:
                scenarios[scenario] = {}
            # Keep first seen value per scenario×param (ATB may have duplicates)
            if internal_key not in scenarios[scenario]:
                scenarios[scenario][internal_key] = row.get("value", "")

        for scenario, raw_params in scenarios.items():
            # Convert internal fields to canonical TextExtractor field names
            output_params: dict[str, float] = {}

            for internal_key, raw_value in raw_params.items():
                try:
                    fval = float(raw_value)
                except (ValueError, TypeError):
                    continue

                if internal_key == "_capacity_factor_fraction":
                    output_params["capacity_factor_percent"] = round(fval * 100, 2)
                elif internal_key == "_heat_rate_mmbtu_per_mwh":
                    if fval > 0:
                        eff = (_MMBTU_PER_MWH_ELECTRICAL / fval) * 100
                        output_params["efficiency_percent"] = round(eff, 2)
                else:
                    output_params[internal_key] = fval

            # Inject lifetime from the defaults table
            lifetime = _ATB_LIFETIME_DEFAULTS.get(tech_id)
            if lifetime:
                output_params["lifetime_years"] = float(lifetime)

            if not output_params:
                continue

            # Build pseudo-text that the TextExtractor's field = value patterns can parse
            lines: list[str] = [
                f"NREL ATB {self._atb_year} – {atb_name} ({scenario} scenario)",
                f"Reference year: {self._atb_year}",
            ]
            for field, value in output_params.items():
                lines.append(f"{field} = {value}")

            full_text = "\n".join(lines)
            record_id = (
                f"atb_{self._atb_year}_{atb_name}_{scenario}"
                .lower().replace(" ", "_").replace("-", "_")
            )

            records.append(PaperRecord(
                source_name=self.source_name,
                source_id=record_id,
                title=f"NREL ATB {self._atb_year}: {atb_name} ({scenario})",
                doi=None,
                year=self._atb_year,
                authors=["NREL", "National Renewable Energy Laboratory"],
                abstract=full_text,
                full_text=full_text,
                url=_ATB_ARCHIVE_URL.format(year=self._atb_year),
                venue="NREL Annual Technology Baseline",
                countries=["US"],
            ))

        return records

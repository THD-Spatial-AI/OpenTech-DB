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

# ATB summary data available as fixed-URL CSVs
_ATB_SUMMARY_CSV = (
    "https://oedi-data-lake.s3.amazonaws.com/ATB/electricity/csv/"
    "{year}/ATBe.csv"
)

# Fallback – ATB archive page (HTML-parseable links)
_ATB_ARCHIVE_URL = "https://atb.nrel.gov/electricity/{year}/data"

# Mapping from ATB technology column names → OpenTechDB technology_ids
_ATB_TECH_MAP: dict[str, str] = {
    "UtilityPV":              "solar_pv_utility",
    "CommPV":                 "solar_pv_distributed",
    "ResPV":                  "solar_pv_distributed",
    "LandbasedWind":          "onshore_wind",
    "OffshoreWind":           "offshore_wind_fixed",
    "Nuclear":                "nuclear_conventional",
    "NaturalGas_CCCCSAdv":    "ccgt",
    "NaturalGas_CCCCS":       "ccgt",
    "NaturalGas_CC":          "ccgt",
    "NaturalGas_CT":          "ocgt",
    "CSP":                    "csp",
    "Geothermal":             "geothermal_power",
    "Biopower":               "biomass_power_plant",
    "Hydropower":             "hydro_reservoir",
    "Battery":                "lithium_ion_bess",
    "PumpedStorageHydro":     "pumped_hydro_storage",
}

# ATB rows we care about
_ATB_PARAMS_OF_INTEREST = {
    "CAPEX":             "capex_usd_per_kw",
    "Fixed O&M":         "opex_fixed_usd_per_kw_yr",
    "Variable O&M":      "opex_var_usd_per_mwh",
    "Heat Rate":         "_heat_rate_mmbtu_per_mwh",   # internal; converted to efficiency
    "CF":                "_capacity_factor",
    "Fuel Cost":         "_fuel_cost_per_mmbtu",
}


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
        self._atb_year = getattr(src_cfg, "atb_year", 2024)

    # ------------------------------------------------------------------

    def search(
        self,
        technology_id: str,
        queries: list[str],   # unused – ATB is structured, not text-search
        **kwargs: Any,
    ) -> list[PaperRecord]:
        """Return ATB cost records for *technology_id* as PaperRecord stubs."""
        atb_data = self._load_atb_csv()
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
        """Download and parse the ATB CSV into a list of row dicts."""
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
            return list(reader)
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
        One PaperRecord per ATB scenario (Conservative / Moderate / Advanced).
        """
        records: list[PaperRecord] = []

        # Group rows by scenario
        scenarios: dict[str, dict[str, str]] = {}
        for row in rows:
            # ATB CSV columns vary by year; common patterns:
            tech_col  = row.get("technology", row.get("Technology", ""))
            param_col = row.get("core_metric_parameter", row.get("Metric", ""))
            case_col  = row.get("scenario", row.get("Case", "Moderate"))
            year_col  = row.get("year", row.get("Year", str(self._atb_year)))

            if not tech_col.startswith(atb_name):
                continue
            if param_col not in _ATB_PARAMS_OF_INTEREST:
                continue

            case = case_col or "Moderate"
            key  = _ATB_PARAMS_OF_INTEREST[param_col]

            if case not in scenarios:
                scenarios[case] = {"_year": year_col, "_atb_name": atb_name}
            scenarios[case][key] = row.get("value", row.get("Value", ""))

        for scenario, params in scenarios.items():
            year_val = params.pop("_year", str(self._atb_year))
            atb_nm   = params.pop("_atb_name", atb_name)

            # Build a pseudo-text that the TextExtractor can parse
            lines: list[str] = [
                f"NREL ATB {self._atb_year} – {atb_nm} ({scenario} scenario)",
                f"Reference year: {year_val}",
            ]
            for field, value in params.items():
                if value:
                    lines.append(f"{field} = {value}")

            full_text = "\n".join(lines)
            record_id = f"atb_{self._atb_year}_{atb_name}_{scenario}".lower().replace(" ", "_")

            records.append(PaperRecord(
                source_name=self.source_name,
                source_id=record_id,
                title=f"NREL ATB {self._atb_year}: {atb_nm} ({scenario})",
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

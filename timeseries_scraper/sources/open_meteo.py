"""Open-Meteo Historical Weather API — wind speed, wind CF, and solar irradiance profiles.

No API key required. Free tier, reasonable rate limits.
API: https://archive-api.open-meteo.com/v1/archive
"""
from __future__ import annotations
import json
import logging
import time
import urllib.request
import urllib.error
from typing import Optional

from ..base import BaseTimeseriesSource, ProfileDraft

logger = logging.getLogger(__name__)

_BASE = "https://archive-api.open-meteo.com/v1/archive"
_RATE_LIMIT = 0.6

# EU-27 + key European neighbours (from pvgis.py)
EU_LOCATIONS: dict[str, tuple[float, float]] = {
    "AT": (47.5, 14.5), "BE": (50.5, 4.5),  "BG": (42.7, 25.5),
    "HR": (45.1, 16.4), "CY": (35.0, 33.0),  "CZ": (49.8, 15.5),
    "DK": (55.7, 10.5), "EE": (58.6, 25.0),  "FI": (64.0, 26.0),
    "FR": (46.0, 2.0),  "DE": (51.2, 10.4),  "GR": (39.0, 22.0),
    "HU": (47.2, 19.5), "IE": (53.0, -8.0),  "IT": (42.5, 12.5),
    "LV": (56.9, 24.6), "LT": (55.2, 24.0),  "LU": (49.8, 6.1),
    "MT": (35.9, 14.5), "NL": (52.3, 5.3),   "NO": (60.5, 8.5),
    "PL": (52.0, 20.0), "PT": (39.5, -8.0),  "RO": (45.9, 25.0),
    "SK": (48.7, 19.7), "SI": (46.1, 15.0),  "ES": (40.4, -3.7),
    "SE": (60.0, 15.0), "CH": (46.8, 8.2),   "UK": (51.5, -1.0),
}

# Additional global locations (MENA, Americas, APAC)
GLOBAL_LOCATIONS: dict[str, tuple[float, float]] = {
    "MA": (32.0, -5.0),    # Morocco
    "TN": (34.0, 9.6),     # Tunisia
    "EG": (27.0, 30.0),    # Egypt
    "SA": (24.0, 45.0),    # Saudi Arabia
    "AE": (24.5, 54.4),    # UAE
    "TR": (39.0, 35.0),    # Turkey
    "ZA": (-29.0, 25.0),   # South Africa
    "NG": (9.0, 8.0),      # Nigeria
    "KE": (-1.0, 37.0),    # Kenya
    "IN": (22.0, 78.0),    # India
    "CN": (35.0, 105.0),   # China
    "JP": (36.0, 138.0),   # Japan
    "KR": (37.0, 127.5),   # South Korea
    "AU": (-27.0, 134.0),  # Australia
    "US": (39.0, -98.0),   # USA (centroid)
    "BR": (-15.0, -47.9),  # Brazil
    "MX": (23.0, -102.0),  # Mexico
    "CL": (-33.5, -70.7),  # Chile
    "AR": (-34.0, -64.0),  # Argentina
    "CA": (55.0, -97.0),   # Canada
}

# All locations combined
LOCATIONS: dict[str, tuple[float, float]] = {**EU_LOCATIONS, **GLOBAL_LOCATIONS}

COUNTRY_NAMES: dict[str, str] = {
    "AT": "Austria", "BE": "Belgium", "BG": "Bulgaria", "HR": "Croatia",
    "CY": "Cyprus", "CZ": "Czech Republic", "DK": "Denmark", "EE": "Estonia",
    "FI": "Finland", "FR": "France", "DE": "Germany", "GR": "Greece",
    "HU": "Hungary", "IE": "Ireland", "IT": "Italy", "LV": "Latvia",
    "LT": "Lithuania", "LU": "Luxembourg", "MT": "Malta", "NL": "Netherlands",
    "NO": "Norway", "PL": "Poland", "PT": "Portugal", "RO": "Romania",
    "SK": "Slovakia", "SI": "Slovenia", "ES": "Spain", "SE": "Sweden",
    "CH": "Switzerland", "UK": "United Kingdom",
    "MA": "Morocco", "TN": "Tunisia", "EG": "Egypt", "SA": "Saudi Arabia",
    "AE": "UAE", "TR": "Turkey", "ZA": "South Africa", "NG": "Nigeria",
    "KE": "Kenya", "IN": "India", "CN": "China", "JP": "Japan",
    "KR": "South Korea", "AU": "Australia", "US": "United States",
    "BR": "Brazil", "MX": "Mexico", "CL": "Chile", "AR": "Argentina",
    "CA": "Canada",
}


def _fetch(lat: float, lon: float, year: int, variable: str) -> list[dict] | None:
    start, end = f"{year}-01-01", f"{year}-12-31"
    url = (
        f"{_BASE}?latitude={lat}&longitude={lon}"
        f"&start_date={start}&end_date={end}"
        f"&hourly={variable}&timezone=UTC"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "OpenTech-DB/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.load(resp)
        time.sleep(_RATE_LIMIT)
    except urllib.error.HTTPError as e:
        logger.error("Open-Meteo HTTP %s | %s %s: %s", e.code, variable, year, e.reason)
        time.sleep(_RATE_LIMIT)
        return None
    except Exception as e:
        logger.error("Open-Meteo fetch failed | %s %s: %s", variable, year, e)
        return None

    times = data.get("hourly", {}).get("time", [])
    values = data.get("hourly", {}).get(variable, [])
    if not times or not values:
        return None

    return [
        {"timestamp": t.replace("T", " ") + ":00", "value": round(float(v), 4)}
        for t, v in zip(times, values)
        if v is not None
    ]


def _wind_cf(v_ms: float) -> float:
    """Generic IEC Class II onshore turbine power curve (cubic between cut-in and rated)."""
    v_ci, v_r, v_co = 3.0, 12.0, 25.0
    if v_ms < v_ci or v_ms >= v_co:
        return 0.0
    if v_ms >= v_r:
        return 1.0
    return ((v_ms - v_ci) / (v_r - v_ci)) ** 3


class OpenMeteoWindSource(BaseTimeseriesSource):
    """Raw wind speed at 100m — weather profile (unit: m/s)."""
    source_name = "open_meteo_wind"

    def fetch(self, location: str, year: int, **kwargs) -> Optional[ProfileDraft]:
        if location not in LOCATIONS:
            return None
        lat, lon = LOCATIONS[location]
        points = _fetch(lat, lon, year, "windspeed_100m")
        if not points:
            return None
        country = COUNTRY_NAMES.get(location, location)
        return ProfileDraft(
            name=f"{location} Wind Speed at 100m Hub Height {year}",
            type="weather",
            resolution="hourly",
            location=location,
            source=f"Open-Meteo Historical Weather API (ERA5) | lat={lat}, lon={lon}",
            carrier="wind",
            year=year,
            unit="m/s",
            description=(
                f"Hourly wind speed at 100m hub height for {country} ({year}). "
                f"Open-Meteo Historical Weather API (ERA5 reanalysis), centroid lat={lat}, lon={lon}."
            ),
            points=points,
            source_name=self.source_name,
        )


class OpenMeteoWindCFSource(BaseTimeseriesSource):
    """Wind capacity factor derived from 100m wind speed using a generic IEC Class II power curve."""
    source_name = "open_meteo_wind_cf"

    def fetch(self, location: str, year: int, **kwargs) -> Optional[ProfileDraft]:
        if location not in LOCATIONS:
            return None
        lat, lon = LOCATIONS[location]
        raw = _fetch(lat, lon, year, "windspeed_100m")
        if not raw:
            return None

        points = [
            {"timestamp": p["timestamp"], "value": round(_wind_cf(p["value"]), 6)}
            for p in raw
        ]
        country = COUNTRY_NAMES.get(location, location)
        return ProfileDraft(
            name=f"{location} Onshore Wind Capacity Factor {year}",
            type="capacity_factor",
            resolution="hourly",
            location=location,
            source=(
                f"Open-Meteo Historical Weather API (ERA5) | lat={lat}, lon={lon} | "
                f"Generic IEC Class II power curve (cut-in 3 m/s, rated 12 m/s, cut-out 25 m/s)"
            ),
            carrier="wind",
            year=year,
            unit="p.u.",
            description=(
                f"Hourly onshore wind capacity-factor profile for {country} ({year}). "
                f"Derived from ERA5 100m wind speed (Open-Meteo) using a generic IEC Class II "
                f"onshore turbine power curve (cut-in 3 m/s, rated 12 m/s, cut-out 25 m/s). "
                f"Centroid location: lat={lat}, lon={lon}."
            ),
            points=points,
            source_name=self.source_name,
        )


class OpenMeteoSolarSource(BaseTimeseriesSource):
    """Global horizontal irradiance — weather profile (unit: W/m²)."""
    source_name = "open_meteo_solar"

    def fetch(self, location: str, year: int, **kwargs) -> Optional[ProfileDraft]:
        if location not in LOCATIONS:
            return None
        lat, lon = LOCATIONS[location]
        points = _fetch(lat, lon, year, "shortwave_radiation")
        if not points:
            return None
        country = COUNTRY_NAMES.get(location, location)
        return ProfileDraft(
            name=f"{location} Global Horizontal Irradiance {year}",
            type="weather",
            resolution="hourly",
            location=location,
            source=f"Open-Meteo Historical Weather API (ERA5) | lat={lat}, lon={lon}",
            carrier="solar_irradiance",
            year=year,
            unit="W/m²",
            description=(
                f"Hourly global horizontal irradiance (GHI) for {country} ({year}). "
                f"Open-Meteo Historical Weather API (ERA5 reanalysis), centroid lat={lat}, lon={lon}."
            ),
            points=points,
            source_name=self.source_name,
        )


class OpenMeteoTemperatureSource(BaseTimeseriesSource):
    """Air temperature at 2m — weather profile (unit: °C)."""
    source_name = "open_meteo_temperature"

    def fetch(self, location: str, year: int, **kwargs) -> Optional[ProfileDraft]:
        if location not in LOCATIONS:
            return None
        lat, lon = LOCATIONS[location]
        points = _fetch(lat, lon, year, "temperature_2m")
        if not points:
            return None
        country = COUNTRY_NAMES.get(location, location)
        return ProfileDraft(
            name=f"{location} Air Temperature at 2m {year}",
            type="weather",
            resolution="hourly",
            location=location,
            source=f"Open-Meteo Historical Weather API (ERA5) | lat={lat}, lon={lon}",
            carrier="temperature",
            year=year,
            unit="°C",
            description=(
                f"Hourly air temperature at 2m above ground for {country} ({year}). "
                f"Open-Meteo Historical Weather API (ERA5 reanalysis), centroid lat={lat}, lon={lon}."
            ),
            points=points,
            source_name=self.source_name,
        )


def _temp_to_load_raw(t: float) -> float:
    """
    Simplified electrification load factor from 2m temperature.

    Base load + heating demand below 15 °C (space heating, water heating)
    + cooling demand above 24 °C (air conditioning).
    Exponents > 1 capture the nonlinear response near saturation.
    """
    heat = max(0.0, 15.0 - t) ** 1.2
    cool = max(0.0, t - 24.0) ** 1.1
    return 0.3 + 0.015 * heat + 0.012 * cool


class OpenMeteoLoadSource(BaseTimeseriesSource):
    """
    Synthetic hourly electricity load profile derived from ERA5 air temperature.

    Uses a simplified degree-day electrification model (HDD base 15 °C,
    CDD base 24 °C) and normalises the result to [0, 1] so it can be used
    directly as a capacity-factor-style demand shape in energy models.
    """
    source_name = "open_meteo_load"

    def fetch(self, location: str, year: int, **kwargs) -> Optional[ProfileDraft]:
        if location not in LOCATIONS:
            return None
        lat, lon = LOCATIONS[location]
        raw = _fetch(lat, lon, year, "temperature_2m")
        if not raw:
            return None

        vals = [_temp_to_load_raw(p["value"]) for p in raw]
        v_min, v_max = min(vals), max(vals)
        norm = (
            [(v - v_min) / (v_max - v_min) for v in vals]
            if v_max > v_min
            else vals
        )
        points = [
            {"timestamp": p["timestamp"], "value": round(n, 6)}
            for p, n in zip(raw, norm)
        ]
        country = COUNTRY_NAMES.get(location, location)
        return ProfileDraft(
            name=f"{location} Electricity Load Profile {year}",
            type="load",
            resolution="hourly",
            location=location,
            source=(
                f"Open-Meteo Historical Weather API (ERA5) | lat={lat}, lon={lon} | "
                f"Simplified degree-day electrification model (HDD base 15 °C, CDD base 24 °C)"
            ),
            carrier="electricity",
            year=year,
            unit="p.u.",
            description=(
                f"Hourly normalised electricity load profile for {country} ({year}). "
                f"Derived from ERA5 2m temperature (Open-Meteo) using a simplified degree-day "
                f"electrification model: base load + heating demand below 15 °C + cooling demand "
                f"above 24 °C. Normalised to [0, 1] (0 = minimum demand hour, 1 = peak demand "
                f"hour). Centroid location: lat={lat}, lon={lon}."
            ),
            points=points,
            source_name=self.source_name,
        )

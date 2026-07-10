from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ProfileDraft:
    name: str
    type: str           # capacity_factor | load | generation | weather | price
    resolution: str     # 15min | 30min | hourly | daily
    location: str       # ISO 3166-1 alpha-2
    source: str         # citation / URL (OEO provenance)
    carrier: str        # solar_irradiance | wind | electricity
    year: int
    unit: str           # p.u. | m/s | W/m² | MW | EUR/MWh
    description: str
    points: list        # [{timestamp: str, value: float}, ...]
    source_name: str    # "pvgis" | "open_meteo_wind" | etc.


class BaseTimeseriesSource:
    source_name: str = ""

    def fetch(self, location: str, year: int, **kwargs) -> Optional[ProfileDraft]:
        raise NotImplementedError

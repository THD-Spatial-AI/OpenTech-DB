from __future__ import annotations
import logging
from dataclasses import dataclass, field

from .normaliser import normalise
from .writer import write_pending, approve_pending
from .sources.pvgis import PVGISSource, LOCATIONS as PVGIS_LOCATIONS
from .sources.open_meteo import (
    OpenMeteoWindSource,
    OpenMeteoWindCFSource,
    OpenMeteoSolarSource,
    LOCATIONS as OM_LOCATIONS,
)

logger = logging.getLogger(__name__)

_ALL_SOURCES = {
    "pvgis":              (PVGISSource,          list(PVGIS_LOCATIONS.keys()), [2019, 2020]),
    "open_meteo_wind":    (OpenMeteoWindSource,   list(OM_LOCATIONS.keys()),   [2019, 2020, 2021, 2022, 2023]),
    "open_meteo_wind_cf": (OpenMeteoWindCFSource, list(OM_LOCATIONS.keys()),   [2019, 2020, 2021, 2022, 2023]),
    "open_meteo_solar":   (OpenMeteoSolarSource,  list(OM_LOCATIONS.keys()),   [2019, 2020, 2021, 2022, 2023]),
}


@dataclass
class RunResult:
    written: int = 0
    approved: int = 0
    skipped: int = 0
    errors: int = 0
    warnings: list[str] = field(default_factory=list)


def run(
    sources: list[str] | None = None,
    locations: list[str] | None = None,
    years: list[int] | None = None,
    dry_run: bool = False,
    auto_approve: bool = False,
) -> RunResult:
    active = {
        k: (cls_(), locs, yrs)
        for k, (cls_, locs, yrs) in _ALL_SOURCES.items()
        if not sources or k in sources
    }

    total = sum(
        len(locations or locs) * len(years or yrs)
        for _, locs, yrs in active.values()
    )
    logger.info(
        "Pipeline: %d sources, ~%d fetches total",
        len(active), total,
    )

    result = RunResult()
    done = 0

    for src_name, (source, default_locs, default_yrs) in active.items():
        active_locs = locations or default_locs
        active_yrs = years or default_yrs
        for loc in active_locs:
            for year in active_yrs:
                done += 1
                logger.info("[%d/%d] %s %s %s", done, total, src_name, loc, year)
                try:
                    draft = source.fetch(loc, year)
                    if draft is None:
                        result.errors += 1
                        continue

                    draft, warns = normalise(draft)
                    for w in warns:
                        result.warnings.append(f"{src_name}/{loc}/{year}: {w}")

                    sid = write_pending(draft, dry_run=dry_run)
                    if sid is None:
                        result.skipped += 1
                    elif sid == "dry-run":
                        result.written += 1
                    else:
                        result.written += 1
                        if auto_approve and not dry_run:
                            pid = approve_pending(sid)
                            if pid:
                                result.approved += 1

                except Exception as e:
                    logger.error("Error %s %s %s: %s", src_name, loc, year, e, exc_info=True)
                    result.errors += 1

    logger.info(
        "Done: %d written, %d approved, %d skipped, %d errors",
        result.written, result.approved, result.skipped, result.errors,
    )
    return result

"""
scripts/build_reference_profiles.py
===================================
Deterministically (re)build the hourly reference profiles shipped under
data/generation/profiles/ and data/conversion/profiles/.

Dispatchable availability (profile_role="availability"), expected value per hour:

    a(h) = (1 - FOR) * (1 - planned(d)) * (1 - ambient_derate(h))

  FOR          equivalent forced outage rate (cited per tech; PJM class averages)
  planned(d)   fleet share on planned outage on day d: the annual planned-outage
               days spread over Gaussian seasonal windows
  ambient      gas-turbine output loss above ISO 15 °C on a stylised
               central-European temperature climatology

Tidal stream (profile_role="capacity_factor"): M2 + S2 harmonic current speed
through a cubic tidal-turbine power curve, times a technical availability.

Run-of-river (profile_role="capacity_factor"): embeds the existing
data/timeseries/de_hydro_ror_cf_2019.json series.

Usage:
    python scripts/build_reference_profiles.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEN_DIR = ROOT / "data" / "generation" / "profiles"
CONV_DIR = ROOT / "data" / "conversion" / "profiles"
YEAR = 2025
HOURS = 8760

PJM_EFORD = {
    "title": "PJM, 2020–2024 Weighted Average EFORd by Fuel Type (Class Average Values effective 1 June 2025)",
    "url": "https://www.pjm.com/-/media/DotCom/planning/res-adeq/res-reports/2020-2024-pjm-generating-unit-class-average-values.pdf",
}
EIA_REFUEL = {
    "title": "U.S. EIA, Today in Energy: U.S. summer nuclear outages rose in 2023, returning to 2021 levels (17 Oct 2023)",
    "url": "https://www.eia.gov/todayinenergy/detail.php?id=60682",
}
GE_GER3567 = {
    "title": "Brooks, F.J., GE Gas Turbine Performance Characteristics, GE Power Systems GER-3567H (2000)",
    "url": None,
}
DOE_GEO = {
    "title": "U.S. DOE geothermal plant availability factor 90–95% (2015), as reported by Geothermal Insider",
    "url": "https://geothermalinsider.com/learn/geothermal-energy-facts/",
}
NOAA_CONSTITUENTS = {
    "title": "NOAA CO-OPS, Harmonic constituents (M2 = 28.984104 °/h, S2 = 30.0 °/h)",
    "url": "https://tidesandcurrents.noaa.gov/",
}

SPRING_FALL = [(105, 25), (288, 25)]   # mid-April, mid-October (day-of-year, sigma days)
SUMMER = [(196, 30)]                  # mid-July

# slug: (FOR, FOR citation note, planned days/yr, windows, ambient %/°C, directory, extra citations, notes)
DISPATCHABLE = {
    "nuclear_conventional": (
        0.011, "FOR = PJM Nuclear WEFORd 1.118 %", 20, SPRING_FALL, 0.0, GEN_DIR,
        [{**EIA_REFUEL, "parameter": "planned outage: 35-day mean refuelling outage (2023) every 18–24 months "
                                     "→ ~20 days/yr; outages concentrated in spring and fall"}],
        "Fleet-level expected availability, not a single unit's outage calendar.",
    ),
    "smr": (
        0.011, "FOR = PJM Nuclear WEFORd 1.118 % (proxy: large LWR fleet)", 18, SPRING_FALL, 0.0, GEN_DIR,
        [{**EIA_REFUEL, "parameter": "planned outage: 35-day refuelling outage on an assumed 24-month cycle → ~18 days/yr"}],
        "No SMR operating fleet yet; LWR fleet statistics used as proxy.",
    ),
    "coal_power_plant": (
        0.151, "FOR = PJM Fossil-Steam WEFORd 15.100 %", 28, SPRING_FALL, 0.0, GEN_DIR, [],
        "Planned outage days/yr is a modelling assumption.",
    ),
    "ccgt": (
        0.039, "FOR = PJM Combined Cycle WEFORd 3.936 %", 21, SPRING_FALL, 0.35, GEN_DIR,
        [{**GE_GER3567, "parameter": "ambient derating: gas-turbine output falls with inlet temperature above ISO 15 °C; "
                                     "0.35 %/°C assumed for combined cycle"}],
        "Planned outage days/yr and the ambient climatology are modelling assumptions (central-European climate).",
    ),
    "ocgt": (
        0.064, "FOR = PJM Combustion Turbine WEFORd 6.399 %", 14, SPRING_FALL, 0.6, GEN_DIR,
        [{**GE_GER3567, "parameter": "ambient derating: ~0.6 %/°C above ISO 15 °C for simple-cycle heavy-duty GT"}],
        "Planned outage days/yr and the ambient climatology are modelling assumptions (central-European climate).",
    ),
    "internal_combustion_engine": (
        0.102, "FOR = PJM Diesel–Utility WEFORd 10.185 %", 7, SPRING_FALL, 0.0, GEN_DIR, [],
        "Planned outage days/yr is a modelling assumption.",
    ),
    "biogas_power_plant": (
        0.102, "FOR = PJM Diesel–Utility WEFORd 10.185 % (proxy: reciprocating engines)", 7, SUMMER, 0.0, GEN_DIR, [],
        "Proxy statistics from US utility reciprocating engines; planned outage days/yr is a modelling assumption. "
        "Feedstock/digester seasonality not modelled.",
    ),
    "biomass_power_plant": (
        0.151, "FOR = PJM Fossil-Steam WEFORd 15.100 % (proxy: steam-cycle plants; likely conservative)", 21, SUMMER,
        0.0, GEN_DIR, [],
        "Proxy statistics from the fossil steam fleet; planned outage days/yr (summer overhaul) is a modelling "
        "assumption. Fuel seasonality not modelled.",
    ),
    "waste_to_energy": (
        0.151, "FOR = PJM Fossil-Steam WEFORd 15.100 % (proxy: steam-cycle plants; likely conservative)", 21, SUMMER,
        0.0, GEN_DIR, [],
        "Proxy statistics from the fossil steam fleet; planned outage days/yr (annual boiler inspection) is a "
        "modelling assumption.",
    ),
    "geothermal_power": (
        0.03, "FOR = 3 % assumption, consistent with the 90–95 % availability range", 14, SUMMER, 0.0, GEN_DIR,
        [{**DOE_GEO, "parameter": "overall availability 90–95 % (check for resulting mean ≈ 0.93)"}],
        "FOR and planned outage days/yr are modelling assumptions bounded by the cited availability range.",
    ),
    "chp_gas": (
        0.039, "FOR = PJM Combined Cycle WEFORd 3.936 % (proxy: gas-fired CHP)", 21, SUMMER, 0.0, CONV_DIR, [],
        "Availability only — heat-led dispatch is left to the model. Planned outage in summer (low heat demand) "
        "is a modelling assumption.",
    ),
    "biomass_chp": (
        0.151, "FOR = PJM Fossil-Steam WEFORd 15.100 % (proxy: steam-cycle plants; likely conservative)", 21, SUMMER,
        0.0, CONV_DIR, [],
        "Availability only — heat-led dispatch is left to the model. Planned outage in summer (low heat demand) "
        "is a modelling assumption.",
    ),
}


def _planned_share(days_per_year: float, windows: list[tuple[int, int]]) -> list[float]:
    """Daily fleet share on planned outage; integrates to days_per_year over the year."""
    weights = []
    for d in range(365):
        w = 0.0
        for centre, sigma in windows:
            dist = min(abs(d - centre), 365 - abs(d - centre))  # wrap around new year
            w += math.exp(-0.5 * (dist / sigma) ** 2)
        weights.append(w)
    scale = days_per_year / sum(weights)
    return [min(1.0, w * scale) for w in weights]


def _ambient_temp_c(h: int) -> float:
    """Stylised central-European temperature: ~0 °C mid-January, ~19 °C mid-July, ±4 °C daily, peak 14 UTC."""
    doy = h // 24
    seasonal = 9.5 + 9.5 * math.cos(2 * math.pi * (doy - 196) / 365)
    diurnal = 4.0 * math.cos(2 * math.pi * ((h % 24) - 14) / 24)
    return seasonal + diurnal


def _availability(for_: float, planned_days: float, windows, derate_pct_per_c: float) -> list[float]:
    planned = _planned_share(planned_days, windows)
    out = []
    for h in range(HOURS):
        derate = max(0.0, _ambient_temp_c(h) - 15.0) * derate_pct_per_c / 100
        out.append(round((1 - for_) * (1 - planned[h // 24]) * (1 - derate), 4))
    return out


def _tidal_cf() -> list[float]:
    """M2+S2 current speed → cubic power curve (cut-in 0.8 m/s, rated 2.5 m/s) × 95 % availability."""
    w_m2 = math.radians(28.984104)   # rad/h
    w_s2 = math.radians(30.0)
    u_m2, u_s2 = 2.2, 0.75           # m/s amplitudes (assumed energetic tidal-stream site)
    cut_in, rated, avail = 0.8, 2.5, 0.95
    out = []
    for h in range(HOURS):
        u = abs(u_m2 * math.cos(w_m2 * h) + u_s2 * math.cos(w_s2 * h))
        if u < cut_in:
            p = 0.0
        elif u >= rated:
            p = 1.0
        else:
            p = (u ** 3 - cut_in ** 3) / (rated ** 3 - cut_in ** 3)
        out.append(round(p * avail, 4))
    return out


def _write(path: Path, profile: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(profile, indent=2) + "\n", encoding="utf-8")
    mean = sum(profile["values"]) / len(profile["values"])
    print(f"{path.relative_to(ROOT)}  n={len(profile['values'])}  mean={mean:.3f}")


def main() -> None:
    for slug, (for_, for_note, days, windows, derate, out_dir, extra_cites, notes) in DISPATCHABLE.items():
        pid = f"{slug}_availability_{YEAR}"
        _write(out_dir / f"{pid}.json", {
            "profile_id": pid,
            "kind": "annual_series",
            "time_resolution": "1h",
            "unit": "capacity_factor",
            "profile_role": "availability",
            "method": "parameterised_from_statistics",
            "year": YEAR,
            "timezone": "UTC",
            "country": "DE" if derate else None,
            "source": "opentech-db reference availability profile (scripts/build_reference_profiles.py)",
            "citations": [{**PJM_EFORD, "parameter": for_note}, *extra_cites],
            "notes": f"Expected hourly availability = (1-FOR)*(1-planned share)*(1-ambient derate); "
                     f"FOR={for_}, planned outage {days} d/yr. {notes}",
            "values": _availability(for_, days, windows, derate),
        })

    pid = f"tidal_stream_cf_{YEAR}"
    _write(GEN_DIR / f"{pid}.json", {
        "profile_id": pid,
        "kind": "annual_series",
        "time_resolution": "1h",
        "unit": "capacity_factor",
        "profile_role": "capacity_factor",
        "method": "synthetic",
        "year": YEAR,
        "timezone": "UTC",
        "country": None,
        "source": "opentech-db harmonic tidal-stream profile (scripts/build_reference_profiles.py)",
        "citations": [{**NOAA_CONSTITUENTS, "parameter": "M2 (12.42 h) and S2 (12.00 h) periods → 14.77-day spring-neap cycle"}],
        "notes": "Generic site: M2 2.2 m/s + S2 0.75 m/s peak current, cubic power curve cut-in 0.8 m/s, rated "
                 "2.5 m/s, 95 % technical availability (assumptions). Tidal phase is arbitrary — not site-specific.",
        "values": _tidal_cf(),
    })

    src = json.loads((ROOT / "data" / "timeseries" / "de_hydro_ror_cf_2019.json").read_text(encoding="utf-8-sig"))
    pid = "hydro_run_of_river_cf_de_2019"
    _write(GEN_DIR / f"{pid}.json", {
        "profile_id": pid,
        "kind": "annual_series",
        "time_resolution": "1h",
        "unit": "capacity_factor",
        "profile_role": "capacity_factor",
        "method": "synthetic",
        "year": 2019,
        "timezone": "UTC",
        "country": "DE",
        "source": "Embedded copy of /timeseries/de_hydro_ror_cf_2019 (Fraunhofer IEE / Bundesnetzagentur Synthetic)",
        "citations": [],
        "notes": "Seasonal hydrology: spring snowmelt peak (Apr–May), late-summer trough; fleet CF ~45 %.",
        "values": [round(float(p["value"]), 4) for p in src["points"]],
    })


if __name__ == "__main__":
    main()

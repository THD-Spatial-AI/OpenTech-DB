"""
scrapers/validators.py
=======================
Sanity-checks for extracted parameter values.

Called after normalisation to flag values that are outside physically
plausible ranges, or that hint at unit-confusion (e.g. an efficiency
expressed as a fraction when the field expects a percentage).

Usage
-----
    from scrapers.validators import validate_params

    warnings = validate_params(candidate["extracted_params"])
    if warnings:
        candidate["validation_warnings"] = [w.to_dict() for w in warnings]
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

# ---------------------------------------------------------------------------
# Plausible parameter bounds
#
# Based on published cost/performance data across technology types (IRENA,
# NREL ATB, IEA WEO 2023-2025).  Deliberately broad – intended to catch
# obvious outliers (efficiency = 9000%) not to reject unusual-but-valid data.
# ---------------------------------------------------------------------------

_BOUNDS: dict[str, tuple[float, float]] = {
    # Core economics
    "capex_usd_per_kw":                (10,        80_000),
    "opex_fixed_usd_per_kw_yr":        (0.1,       5_000),
    "opex_var_usd_per_mwh":            (0,         500),
    # Core performance
    "efficiency_percent":               (1,         100),
    "lifetime_years":                   (1,         100),
    "co2_emission_factor_g_per_kwh":   (0,         2_000),
    "typical_capacity_mw":             (0.001,     30_000),
    "degradation_rate_percent_per_yr": (0,         10),
    # Wind
    "rotor_diameter_m":                (5,         300),
    "hub_height_m":                    (10,        300),
    "wind_rated_speed_ms":             (5,         25),
    "specific_power_w_per_m2":         (50,        800),
    # Solar PV / CSP
    "module_efficiency_fraction":      (0.01,      1.0),
    "performance_ratio":               (0.5,       1.0),
    "solar_multiple":                  (1.0,       4.0),
    "thermal_storage_h":               (0,         24),
    "optical_efficiency_fraction":     (0.5,       1.0),
    "temperature_coefficient_pct_per_c": (-1.0,    0),
    "ground_coverage_ratio":           (0.01,      1.0),
    "tilt_angle_deg":                  (0,         90),
    # Hydro
    "typical_head_m":                  (1,         2_000),
    "hydraulic_efficiency_fraction":   (0.5,       1.0),
    # Marine
    "tidal_current_speed_ms":          (0.5,       10),
    "turbine_diameter_m":              (1,         50),
    # Thermal (CCGT, Coal, Nuclear, Biomass, …)
    "heat_rate_mj_per_mwh":            (500,       20_000),
    "min_load_fraction":               (0,         1),
    "start_up_time_h":                 (0,         168),
    "cold_start_time_h":               (0,         168),
    "water_withdrawal_m3_per_mwh":     (0,         500),
    "land_use_m2_per_kw":              (0,         100_000),
    "land_use_m2_per_kwp":             (0,         100_000),
    "land_use_m2_per_kwh":             (0,         100_000),
    "enrichment_percent":              (3,         20),
    "burnup_gwd_per_t":                (1,         100),
    # Storage
    "roundtrip_efficiency_fraction":   (0.01,      1.0),
    "charge_efficiency_fraction":      (0.01,      1.0),
    "discharge_efficiency_fraction":   (0.01,      1.0),
    "dod_max_fraction":                (0.01,      1.0),
    "cycle_lifetime_cycles":           (10,        1_000_000),
    "c_rate_max_charge":               (0.05,      10),
    "c_rate_max_discharge":            (0.05,      10),
    # Conversion (electrolysers, heat pumps, …)
    "stack_lifetime_h":                (100,       200_000),
    "cop_heating_at_a7_w35":           (1.5,       10),
    # Transmission
    "loss_rate_pct_per_km":            (0,         5),
    "voltage_kv":                      (1,         2_000),
}

# Fields that must be a fraction (0–1).  If the extracted value is > 1 it
# was probably captured as a percentage rather than a fraction.
_FRACTION_FIELDS: frozenset[str] = frozenset({
    "module_efficiency_fraction",
    "performance_ratio",
    "optical_efficiency_fraction",
    "hydraulic_efficiency_fraction",
    "ground_coverage_ratio",
    "min_load_fraction",
    "roundtrip_efficiency_fraction",
    "charge_efficiency_fraction",
    "discharge_efficiency_fraction",
    "dod_max_fraction",
})


@dataclass
class ValidationWarning:
    parameter: str
    value: float
    message: str
    severity: str  # "warning" | "error"

    def to_dict(self) -> dict:
        return asdict(self)


def validate_params(
    extracted_params: dict[str, dict],
) -> list[ValidationWarning]:
    """
    Run sanity-checks on *extracted_params* (the normalised dict produced by
    the Normalizer).  Returns a (possibly empty) list of ValidationWarning
    objects.

    Parameters are *not* modified here — warnings are purely informational so
    the admin can decide whether to approve, fix, or reject the candidate.
    """
    warnings: list[ValidationWarning] = []

    for param, entry in extracted_params.items():
        raw_value = entry.get("value")
        if raw_value is None:
            continue
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            continue

        # ----------------------------------------------------------------
        # Fraction-field heuristic: value > 1 almost certainly means it was
        # extracted as a percentage instead of a fraction (0–1).
        # ----------------------------------------------------------------
        if param in _FRACTION_FIELDS and value > 1.0:
            warnings.append(ValidationWarning(
                parameter=param,
                value=value,
                message=(
                    f"Value {value:.4g} > 1 for fraction field '{param}' — "
                    "was it extracted as a percentage rather than a fraction?"
                ),
                severity="warning",
            ))

        # ----------------------------------------------------------------
        # Out-of-bounds check
        # ----------------------------------------------------------------
        bounds = _BOUNDS.get(param)
        if bounds is None:
            continue

        lo, hi = bounds
        if not (lo <= value <= hi):
            # Escalate to "error" if the value is absurdly far out of range
            severity = (
                "error"
                if (value < lo / 10 or value > hi * 10)
                else "warning"
            )
            warnings.append(ValidationWarning(
                parameter=param,
                value=value,
                message=(
                    f"Value {value:.4g} is outside the plausible range "
                    f"[{lo}, {hi}] for '{param}'."
                ),
                severity=severity,
            ))

    return warnings

"""Tests for scrapers/validators.py — parameter bounds validation."""
from __future__ import annotations

import pytest

from scrapers.validators import ValidationWarning, validate_params


# ---------------------------------------------------------------------------
# Helpers: build the nested dict format that extracted_params uses
# ---------------------------------------------------------------------------

def _entry(value, unit: str = "") -> dict:
    return {"value": value, "unit": unit, "confidence": 0.8, "context": "", "source": "regex"}


def _first_warning(warnings: list[ValidationWarning], param: str) -> ValidationWarning | None:
    return next((w for w in warnings if w.parameter == param), None)


# ---------------------------------------------------------------------------
# Happy path – values inside plausible bounds
# ---------------------------------------------------------------------------

class TestNoBoundsViolations:
    def test_empty_params(self):
        assert validate_params({}) == []

    def test_none_value_ignored(self):
        warnings = validate_params({
            "capex_usd_per_kw": _entry(None),
            "efficiency_percent": _entry(None),
        })
        assert warnings == []

    def test_capex_in_range(self):
        warnings = validate_params({"capex_usd_per_kw": _entry(1500, "USD/kW")})
        assert warnings == []

    def test_efficiency_as_percentage_boundary(self):
        warnings = validate_params({"efficiency_percent": _entry(95, "%")})
        assert warnings == []

    def test_lifetime_reasonable(self):
        warnings = validate_params({"lifetime_years": _entry(25, "years")})
        assert warnings == []


# ---------------------------------------------------------------------------
# Out-of-bounds values → warnings generated
# ---------------------------------------------------------------------------

class TestBoundsViolations:
    def test_capex_too_low(self):
        warnings = validate_params({"capex_usd_per_kw": _entry(5)})
        w = _first_warning(warnings, "capex_usd_per_kw")
        assert w is not None
        assert "below" in w.message.lower() or w.severity in ("warning", "error")

    def test_capex_too_high(self):
        warnings = validate_params({"capex_usd_per_kw": _entry(200_000)})
        w = _first_warning(warnings, "capex_usd_per_kw")
        assert w is not None

    def test_efficiency_over_100(self):
        warnings = validate_params({"efficiency_percent": _entry(110)})
        w = _first_warning(warnings, "efficiency_percent")
        assert w is not None

    def test_lifetime_zero(self):
        warnings = validate_params({"lifetime_years": _entry(0)})
        w = _first_warning(warnings, "lifetime_years")
        assert w is not None


# ---------------------------------------------------------------------------
# Fraction-field heuristic: value >1 means it was probably given as a %
# ---------------------------------------------------------------------------

class TestFractionFieldHeuristic:
    def test_module_efficiency_fraction_valid(self):
        # 0.92 is valid for module_efficiency_fraction (range 0.01–1.0)
        assert validate_params({"module_efficiency_fraction": _entry(0.92)}) == []

    def test_performance_ratio_over_max(self):
        # performance_ratio max is 1.0; value of 5.0 triggers bounds warning
        result = validate_params({"performance_ratio": _entry(5.0)})
        assert len(result) > 0


# ---------------------------------------------------------------------------
# to_dict() serialisation
# ---------------------------------------------------------------------------

class TestValidationWarningToDict:
    def test_to_dict_keys(self):
        w = ValidationWarning(
            parameter="efficiency",
            value=110.0,
            message="Above upper bound",
            severity="warning",
        )
        d = w.to_dict()
        assert set(d.keys()) >= {"parameter", "value", "message", "severity"}

    def test_to_dict_values(self):
        w = ValidationWarning(
            parameter="capex",
            value=99999,
            message="Exceeds max",
            severity="error",
        )
        d = w.to_dict()
        assert d["parameter"] == "capex"
        assert d["severity"] == "error"


# ---------------------------------------------------------------------------
# Multiple parameters in one call
# ---------------------------------------------------------------------------

class TestMultipleParams:
    def test_mixed_valid_invalid(self):
        params = {
            "capex_usd_per_kw": _entry(1_500),  # valid
            "efficiency_percent": _entry(200),  # invalid
            "lifetime_years": _entry(25),       # valid
        }
        warnings = validate_params(params)
        params_with_warnings = {w.parameter for w in warnings}
        assert "efficiency_percent" in params_with_warnings
        assert "capex_usd_per_kw" not in params_with_warnings
        assert "lifetime_years" not in params_with_warnings

    def test_all_invalid(self):
        params = {
            "capex_usd_per_kw": _entry(-10),
            "efficiency_percent": _entry(999),
            "lifetime_years": _entry(-5),
        }
        warnings = validate_params(params)
        assert len(warnings) >= 3

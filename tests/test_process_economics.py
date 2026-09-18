"""
Tests for Process economics (ADR-0004 results section).

Hermetic: a stub resolver stands in for the catalogue so annualized costs are
deterministic and network-free.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "services" / "processsim"))

from economics import _crf, compute_economics  # noqa: E402
from solver import simulate  # noqa: E402

DATA = REPO / "data" / "processes"


def _seed(slug: str) -> dict:
    return json.loads((DATA / f"{slug}.json").read_text(encoding="utf-8"))


# A stub catalogue: only pem_electrolyzer carries cost data.
def _resolve(ref):
    if ref == "pem_electrolyzer":
        return {"capex_usd_per_kw": 1200, "lifetime_yr": 20,
                "opex_fixed_per_kw_yr": 36, "opex_variable_per_mwh": 2, "capacity_kw": 1000}
    return {}


def test_crf_matches_closed_form():
    # 7% over 20 yr → ~0.0944
    assert _crf(0.07, 20) == pytest.approx(0.09439, abs=1e-4)


def test_crf_zero_rate_is_straight_line():
    assert _crf(0.0, 20) == pytest.approx(1 / 20)


def test_unresolved_units_are_flagged_na():
    g = _seed("power_to_gas")
    r = simulate(g)
    e = compute_economics(g, r["units"], _resolve)
    by_id = {p["unit_id"]: p for p in e["per_unit"]}
    # electrolyzer priced, everything else n/a under the stub
    assert by_id["electrolyzer"]["resolved"] is True
    assert by_id["electrolyzer"]["annualized_eur"] > 0
    assert by_id["co2_supply"]["resolved"] is False
    assert by_id["co2_supply"]["annualized_eur"] is None


def test_total_is_sum_of_components():
    g = _seed("power_to_gas")
    r = simulate(g)
    e = compute_economics(g, r["units"], _resolve)
    t = e["total"]
    assert t["annualized_eur"] == pytest.approx(t["capex_eur"] + t["fixed_om_eur"] + t["var_om_eur"], rel=1e-3)


def test_assumptions_surfaced():
    g = _seed("power_to_gas")
    e = compute_economics(g, simulate(g)["units"], _resolve)
    assert e["assumptions"]["discount_rate"] == 0.07
    # full-load hours derive from the wind source's 40% capacity factor
    assert e["assumptions"]["hours"] == pytest.approx(3504)


def test_total_none_when_nothing_resolves():
    g = _seed("power_to_gas")
    e = compute_economics(g, simulate(g)["units"], lambda ref: {})
    assert e["total"] is None
    assert e["resolved_units"] == 0

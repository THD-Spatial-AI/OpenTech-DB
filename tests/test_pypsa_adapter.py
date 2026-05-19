"""
Tests for adapters/pypsa_adapter.py

Focuses on the CRF (Capital Recovery Factor) formula and instance resolution,
since wrong annualisation silently corrupts energy model cost outputs.
"""
import pytest
from adapters.pypsa_adapter import _annualized_capex, _resolve_instance


# ---------------------------------------------------------------------------
# _annualized_capex — CRF formula
# ---------------------------------------------------------------------------

def test_crf_known_value():
    # r=0.07, n=25 → CRF ≈ 0.08581
    # 1000 USD/kW * 0.08581 ≈ 85.81 USD/kW/yr
    result = _annualized_capex(1000.0, lifetime_yr=25.0, discount_rate=0.07)
    assert abs(result - 85.81) < 0.01, f"Expected ~85.81, got {result}"


def test_crf_zero_discount_rate_raises():
    # CRF denominator becomes 0 when r=0; should raise rather than return inf
    with pytest.raises((ZeroDivisionError, ValueError, OverflowError)):
        _annualized_capex(1000.0, lifetime_yr=25.0, discount_rate=0.0)


def test_crf_scales_linearly_with_capex():
    r1 = _annualized_capex(1000.0, 20.0)
    r2 = _annualized_capex(2000.0, 20.0)
    assert abs(r2 - 2 * r1) < 1e-9


def test_crf_longer_lifetime_lowers_annualized_cost():
    short = _annualized_capex(1000.0, lifetime_yr=10.0)
    long_ = _annualized_capex(1000.0, lifetime_yr=40.0)
    assert long_ < short


def test_crf_higher_rate_raises_annualized_cost():
    low  = _annualized_capex(1000.0, lifetime_yr=25.0, discount_rate=0.03)
    high = _annualized_capex(1000.0, lifetime_yr=25.0, discount_rate=0.10)
    assert high > low


# ---------------------------------------------------------------------------
# _resolve_instance
# ---------------------------------------------------------------------------

class _FakeTech:
    def __init__(self, instances):
        self.instances = instances

class _FakeInst:
    pass


def test_resolve_returns_first_by_default():
    a, b = _FakeInst(), _FakeInst()
    tech = _FakeTech([a, b])
    assert _resolve_instance(tech, instance_index=0) is a


def test_resolve_returns_none_for_empty_instances():
    tech = _FakeTech([])
    assert _resolve_instance(tech, None) is None


def test_resolve_correct_index():
    a, b, c = _FakeInst(), _FakeInst(), _FakeInst()
    tech = _FakeTech([a, b, c])
    assert _resolve_instance(tech, 2) is c


def test_resolve_out_of_range_raises():
    tech = _FakeTech([_FakeInst()])
    with pytest.raises(IndexError):
        _resolve_instance(tech, 5)


def test_resolve_negative_index_raises():
    tech = _FakeTech([_FakeInst()])
    with pytest.raises(IndexError):
        _resolve_instance(tech, -1)

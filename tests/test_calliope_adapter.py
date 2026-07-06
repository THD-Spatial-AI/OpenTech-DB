"""
Tests for adapters/calliope_adapter.py — dual-version export.

v0.6 output must stay backward-compatible (nested essentials/constraints/
costs); v0.7 output must follow the official migration guide
(https://calliope.readthedocs.io/en/latest/migrating/): flat structure,
base_tech, flow_* parameter names, cost_* keys with {data, index, dims}.
"""
import json

import pytest

from adapters.calliope_adapter import to_calliope
from schemas.models import (
    PowerPlant,
    VREPlant,
    EnergyStorage,
    TransmissionLine,
    ConversionTechnology,
)


def _pv(value, unit="x", source="TestSource"):
    return {"value": value, "unit": unit, "source": source}


@pytest.fixture
def dispatchable_tech():
    return PowerPlant.model_validate({
        "name": "CCGT",
        "category": "generation",
        "is_dispatchable": True,
        "input_carriers": ["natural_gas"],
        "output_carriers": ["electricity"],
        "instances": [{
            "label": "CCGT 500 MW",
            "capex_per_kw": _pv(1000, "USD/kW"),
            "opex_fixed_per_kw_yr": _pv(25.0, "USD/kW/yr"),
            "opex_variable_per_mwh": _pv(3.5, "USD/MWh"),
            "economic_lifetime_yr": _pv(30, "years"),
            "electrical_efficiency": _pv(0.60, "fraction"),
            "co2_emission_factor": _pv(0.2, "tCO2/MWh_fuel"),
            "capacity_kw": _pv(500_000, "kW"),
            "min_stable_generation": _pv(0.4, "fraction"),
        }],
    })


@pytest.fixture
def vre_tech():
    return VREPlant.model_validate({
        "name": "Solar PV",
        "category": "generation",
        "output_carriers": ["electricity"],
        "profile_key": "solar_pv",
        "instances": [{
            "label": "Utility PV",
            "capex_per_kw": _pv(1050, "USD/kW"),
            "economic_lifetime_yr": _pv(30, "years"),
        }],
    })


@pytest.fixture
def storage_tech():
    return EnergyStorage.model_validate({
        "name": "Li-ion BESS",
        "category": "storage",
        "output_carriers": ["electricity"],
        "fleet_roundtrip_efficiency": _pv(0.88, "fraction"),
        "fleet_self_discharge_rate": _pv(0.001, "fraction/h"),
        "instances": [{
            "label": "Li-ion 100 MW",
            "capex_per_kw": _pv(480, "USD/kW"),
            "capex_per_kwh": _pv(120, "USD/kWh"),
            "economic_lifetime_yr": _pv(15, "years"),
            "extra": {
                "charge_efficiency_fraction": 0.96,
                "discharge_efficiency_fraction": 0.92,
            },
        }],
    })


@pytest.fixture
def chp_tech():
    return ConversionTechnology.model_validate({
        "name": "CHP Unit",
        "category": "conversion",
        "input_carriers": ["natural_gas"],
        "output_carriers": ["electricity", "heat"],
        "instances": [{
            "label": "CHP 10 MW",
            "capex_per_kw": _pv(1200, "USD/kW"),
            "electrical_efficiency": _pv(0.40, "fraction"),
            "thermal_efficiency": _pv(0.45, "fraction"),
        }],
    })


@pytest.fixture
def transmission_tech():
    return TransmissionLine.model_validate({
        "name": "HVAC Line",
        "category": "transmission",
        "output_carriers": ["electricity"],
        "loss_per_km": _pv(0.0001, "fraction/km"),
        "instances": [{
            "label": "HVAC 400 kV",
            "capex_per_kw": _pv(280, "USD/kW"),
            "economic_lifetime_yr": _pv(50, "years"),
        }],
    })


# ---------------------------------------------------------------------------
# v0.6 regression — structure unchanged
# ---------------------------------------------------------------------------

def test_v06_is_default_and_nested(dispatchable_tech):
    out = to_calliope(dispatchable_tech)
    assert set(out) == {"essentials", "constraints", "costs"}
    assert out["essentials"]["parent"] == "supply"
    assert out["constraints"]["energy_eff"] == 0.60
    assert out["costs"]["monetary"]["energy_cap"] == 1000


def test_unknown_version_raises(dispatchable_tech):
    with pytest.raises(ValueError):
        to_calliope(dispatchable_tech, version="0.5")


# ---------------------------------------------------------------------------
# v0.7 — flat structure and renames
# ---------------------------------------------------------------------------

def test_v07_flat_supply(dispatchable_tech):
    out = to_calliope(dispatchable_tech, version="0.7")
    assert "essentials" not in out and "constraints" not in out and "costs" not in out
    assert out["base_tech"] == "supply"
    assert out["carrier_out"] == "electricity"
    assert out["flow_out_eff"] == 0.60
    assert out["flow_cap_max"] == 500_000
    assert out["lifetime"] == 30
    assert out["flow_out_min_relative"] == 0.4      # was energy_cap_min_use


def test_v07_cost_blocks(dispatchable_tech):
    out = to_calliope(dispatchable_tech, version="0.7")
    assert out["cost_flow_cap"] == {"data": 1000, "index": "monetary", "dims": "costs"}
    assert out["cost_om_annual"] == {"data": 25.0, "index": "monetary", "dims": "costs"}


def test_v07_co2_merged_into_cost_flow_out(dispatchable_tech):
    # monetary om_prod + co2 om_prod → one cost_flow_out indexed over both classes
    out = to_calliope(dispatchable_tech, version="0.7")
    cfo = out["cost_flow_out"]
    assert cfo["dims"] == "costs"
    assert cfo["index"] == ["monetary", "co2"]
    assert cfo["data"] == [3.5 / 1000, 0.2 / 1000]


def test_v07_supply_plus_becomes_supply(vre_tech):
    out = to_calliope(vre_tech, version="0.7")
    assert out["base_tech"] == "supply"              # supply_plus removed in 0.7
    # 0.7 supply techs carry only carrier_out; the resource enters via source_use
    assert "carrier_in" not in out
    # file= resource cannot be expressed in a 0.7 tech; migration hint instead
    assert "resource" not in out
    assert "source_use_max" not in out
    assert "data_tables" in out.get("opentech_note", "")


def test_v07_storage_split_efficiencies(storage_tech):
    out = to_calliope(storage_tech, version="0.7")
    assert out["base_tech"] == "storage"
    # carrier alias removed in 0.7: both directions must be explicit
    assert out["carrier_in"] == "electricity"
    assert out["carrier_out"] == "electricity"
    # measured charge/discharge efficiencies win over sqrt(round-trip)
    assert out["flow_in_eff"] == 0.96
    assert out["flow_out_eff"] == 0.92
    assert out["storage_loss"] == 0.001              # unchanged name in 0.7
    assert out["cost_storage_cap"] == {"data": 120, "index": "monetary", "dims": "costs"}


def test_v07_chp_carrier_ratios_become_indexed_eff(chp_tech):
    out = to_calliope(chp_tech, version="0.7")
    assert out["base_tech"] == "conversion"          # conversion_plus removed
    assert out["carrier_out"] == ["electricity", "heat"]
    eff = out["flow_out_eff"]
    assert eff["dims"] == "carriers"
    assert eff["index"] == ["electricity", "heat"]
    assert eff["data"][0] == 0.40
    assert eff["data"][1] == pytest.approx(0.45, abs=1e-6)  # 0.40 × (0.45/0.40)


def test_v07_transmission_per_distance(transmission_tech):
    out = to_calliope(transmission_tech, version="0.7")
    assert out["base_tech"] == "transmission"
    assert out["flow_out_eff_per_distance"] == pytest.approx(1 - 0.0001)


# ---------------------------------------------------------------------------
# Full catalogue renders in both versions
# ---------------------------------------------------------------------------

def test_full_catalogue_exports_both_versions():
    from api._loader import _load_from_json

    techs = _load_from_json()
    assert techs, "catalogue should not be empty"
    for tech in techs.values():
        for version in ("0.6", "0.7"):
            out = to_calliope(tech, instance_index=0 if tech.instances else None,
                              version=version)
            json.dumps(out)
            if version == "0.7":
                assert "essentials" not in out
                assert out.get("base_tech") in (
                    "supply", "storage", "transmission", "conversion", None,
                )

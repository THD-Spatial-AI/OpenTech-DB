"""
Tests for adapters/adoptnet0_adapter.py

Verifies that exports match the JSON structure AdOpT-NET0
(https://github.com/UU-ER/AdOpT-NET0) actually reads:
tec_type RES / CONV2 / STOR technology files and network files,
with the unit conversions (kW→MW, fixed OPEX as fraction of CAPEX,
storage CAPEX per MWh) applied correctly.
"""
import json

import pytest

from adapters.adoptnet0_adapter import to_adoptnet0, _resolve_instance
from schemas.models import (
    PowerPlant,
    VREPlant,
    EnergyStorage,
    TransmissionLine,
    ConversionTechnology,
)


def _pv(value, unit="x", source="TestSource"):
    return {"value": value, "unit": unit, "source": source}


# ---------------------------------------------------------------------------
# Fixtures — one minimal technology per category
# ---------------------------------------------------------------------------

@pytest.fixture
def vre_tech():
    return VREPlant.model_validate({
        "name": "Solar PV Utility-scale",
        "category": "generation",
        "output_carriers": ["electricity"],
        "instances": [{
            "label": "Utility PV (2024)",
            "capex_per_kw": _pv(1050, "USD/kW"),
            "opex_fixed_per_kw_yr": _pv(17.0, "USD/kW/yr"),
            "opex_variable_per_mwh": _pv(0.0, "USD/MWh"),
            "economic_lifetime_yr": _pv(30, "years"),
        }],
    })


@pytest.fixture
def dispatchable_tech():
    return PowerPlant.model_validate({
        "name": "CCGT",
        "category": "generation",
        "is_dispatchable": True,
        "input_carriers": ["natural_gas"],
        "output_carriers": ["electricity"],
        "instances": [{
            "label": "CCGT 500 MW (2024)",
            "capex_per_kw": _pv(1000, "USD/kW"),
            "opex_fixed_per_kw_yr": _pv(25.0, "USD/kW/yr"),
            "opex_variable_per_mwh": _pv(3.5, "USD/MWh"),
            "economic_lifetime_yr": _pv(30, "years"),
            "electrical_efficiency": _pv(0.60, "fraction"),
            "co2_emission_factor": _pv(0.2, "tCO2/MWh_fuel"),
            "ramp_up_rate": _pv(0.5, "%capacity/min"),  # 200 min full range
        }],
    })


@pytest.fixture
def storage_tech():
    return EnergyStorage.model_validate({
        "name": "Lithium-ion BESS",
        "category": "storage",
        "stored_carrier": "electricity",
        "input_carriers": ["electricity"],
        "output_carriers": ["electricity"],
        "instances": [{
            "label": "Li-ion 100 MW / 400 MWh",
            "capex_per_kw": _pv(480, "USD/kW"),
            "opex_fixed_per_kw_yr": _pv(8.5, "USD/kW/yr"),
            "opex_variable_per_mwh": _pv(0.25, "USD/MWh"),
            "economic_lifetime_yr": _pv(15, "years"),
            "extra": {
                "charge_efficiency_fraction": 0.96,
                "discharge_efficiency_fraction": 0.92,
                "roundtrip_efficiency_fraction": 0.88,
                "c_rate_max_charge": 0.55,
                "c_rate_max_discharge": 0.6,
                "duration_hours": 4,
            },
        }],
    })


@pytest.fixture
def transmission_tech():
    return TransmissionLine.model_validate({
        "name": "HVAC Overhead Lines",
        "category": "transmission",
        "output_carriers": ["electricity"],
        "instances": [{
            "label": "HVAC 400 kV, 200 km",
            "capex_per_kw": _pv(280, "USD/kW"),
            "opex_fixed_per_kw_yr": _pv(3.0, "USD/kW/yr"),
            "economic_lifetime_yr": _pv(50, "years"),
            "extra": {
                "corridor_length_km": 200,
                "loss_rate_pct_per_km": 0.01,
            },
        }],
    })


@pytest.fixture
def conversion_tech():
    return ConversionTechnology.model_validate({
        "name": "Alkaline Water Electrolyzer",
        "category": "conversion",
        "input_carriers": ["electricity"],
        "output_carriers": ["hydrogen"],
        "instances": [{
            "label": "AWE 100 MW (2024)",
            "capex_per_kw": _pv(750, "USD/kW"),
            "opex_fixed_per_kw_yr": _pv(15.0, "USD/kW/yr"),
            "economic_lifetime_yr": _pv(20, "years"),
            "electrical_efficiency": _pv(0.68, "fraction"),
        }],
    })


# ---------------------------------------------------------------------------
# RES (VRE generation)
# ---------------------------------------------------------------------------

def test_vre_maps_to_res(vre_tech):
    out = to_adoptnet0(vre_tech)
    assert out["tec_type"] == "RES"
    assert out["Performance"]["output_carrier"] == ["electricity"]
    assert out["Performance"]["curtailment"] == 1
    assert "input_carrier" not in out["Performance"]


def test_res_economics_units(vre_tech):
    eco = to_adoptnet0(vre_tech)["Economics"]
    assert eco["unit_CAPEX"] == 1050 * 1000            # USD/kW → USD/MW
    assert eco["OPEX_fixed"] == pytest.approx(17.0 / 1050, abs=1e-6)  # fraction of CAPEX
    assert eco["lifetime"] == 30
    assert eco["discount_rate"] == -1                  # defer to global config


def test_res_suggested_name(vre_tech):
    meta = to_adoptnet0(vre_tech)["OpenTechDB"]
    assert meta["suggested_adoptnet0_name"] == "Photovoltaic"


# ---------------------------------------------------------------------------
# CONV2 (dispatchable generation + conversion)
# ---------------------------------------------------------------------------

def test_dispatchable_maps_to_conv2(dispatchable_tech):
    out = to_adoptnet0(dispatchable_tech)
    perf = out["Performance"]
    assert out["tec_type"] == "CONV2"
    assert perf["performance_function_type"] == 1
    assert perf["input_carrier"] == ["gas"]            # natural_gas → gas
    assert perf["main_input_carrier"] == "gas"
    assert perf["performance"]["in"] == [0, 1]
    assert perf["performance"]["out"]["electricity"] == [0, 0.60]
    assert perf["emission_factor"] == 0.2


def test_conv_ramping_time(dispatchable_tech):
    # 0.5 %/min → 200 min = 3.33 h full range → binding at hourly resolution
    perf = to_adoptnet0(dispatchable_tech)["Performance"]
    assert perf["ramping_time"] == pytest.approx(200 / 60, abs=1e-3)


def test_conversion_maps_to_conv2(conversion_tech):
    out = to_adoptnet0(conversion_tech)
    assert out["tec_type"] == "CONV2"
    assert out["Performance"]["output_carrier"] == ["hydrogen"]
    assert out["Performance"]["performance"]["out"]["hydrogen"] == [0, 0.68]
    assert out["Economics"]["unit_CAPEX"] == 750 * 1000


def test_conv_min_part_load_exported_zero(dispatchable_tech):
    out = to_adoptnet0(dispatchable_tech)
    assert out["Performance"]["min_part_load"] == 0


# ---------------------------------------------------------------------------
# STOR (storage)
# ---------------------------------------------------------------------------

def test_storage_maps_to_stor(storage_tech):
    out = to_adoptnet0(storage_tech)
    perf = out["Performance"]
    assert out["tec_type"] == "STOR"
    assert perf["main_input_carrier"] == "electricity"
    assert perf["performance"]["eta_in"] == 0.96
    assert perf["performance"]["eta_out"] == 0.92
    assert perf["performance"]["lambda"] == 0
    assert perf["performance"]["theta"] == 0


def test_storage_capex_per_mwh(storage_tech):
    # 480 USD/kW at 4 h duration → 120 USD/kWh → 120 000 USD/MWh
    eco = to_adoptnet0(storage_tech)["Economics"]
    assert eco["unit_CAPEX"] == pytest.approx(480 * 1000 / 4)


def test_storage_flexibility_from_c_rates(storage_tech):
    flex = to_adoptnet0(storage_tech)["Flexibility"]
    assert flex["power_energy_ratio"] == "fixedratio"
    assert flex["charge_rate"] == 0.55
    assert flex["discharge_rate"] == 0.6


def test_storage_eta_falls_back_to_sqrt_roundtrip(storage_tech):
    inst = storage_tech.instances[0]
    inst.extra.pop("charge_efficiency_fraction")
    inst.extra.pop("discharge_efficiency_fraction")
    perf = to_adoptnet0(storage_tech)["Performance"]["performance"]
    assert perf["eta_in"] == pytest.approx(0.88 ** 0.5, abs=1e-4)
    assert perf["eta_in"] == perf["eta_out"]


def test_storage_size_unit_is_mwh(storage_tech):
    assert to_adoptnet0(storage_tech)["Units"]["size"] == "MWh"


# ---------------------------------------------------------------------------
# Network (transmission)
# ---------------------------------------------------------------------------

def test_transmission_maps_to_network(transmission_tech):
    out = to_adoptnet0(transmission_tech)
    assert "tec_type" not in out
    assert out["network_type"] == "electricity"
    assert out["Performance"]["carrier"] == "electricity"


def test_network_gamma4_per_mw_km(transmission_tech):
    # 280 USD/kW over 200 km → 280 000 USD/MW / 200 km = 1400 USD/MW/km
    eco = to_adoptnet0(transmission_tech)["Economics"]
    assert eco["gamma4"] == pytest.approx(280 * 1000 / 200)
    assert eco["gamma2"] == 0


def test_network_loss_per_km(transmission_tech):
    perf = to_adoptnet0(transmission_tech)["Performance"]
    assert perf["loss"] == pytest.approx(0.01 / 100)   # %/km → fraction/km


# ---------------------------------------------------------------------------
# Instance resolution + serialisability
# ---------------------------------------------------------------------------

def test_resolve_out_of_range_raises(storage_tech):
    with pytest.raises(IndexError):
        _resolve_instance(storage_tech, 5)


def test_resolve_none_uses_first(storage_tech):
    assert _resolve_instance(storage_tech, None) is storage_tech.instances[0]


def test_output_is_json_serialisable(vre_tech, dispatchable_tech, storage_tech,
                                     transmission_tech, conversion_tech):
    for tech in (vre_tech, dispatchable_tech, storage_tech,
                 transmission_tech, conversion_tech):
        json.dumps(to_adoptnet0(tech))


def test_full_catalogue_exports_without_errors():
    """Every technology in the shipped JSON catalogue must export cleanly."""
    from api._loader import _load_from_json

    techs = _load_from_json()
    assert techs, "catalogue should not be empty"
    for tech in techs.values():
        out = to_adoptnet0(tech, instance_index=0 if tech.instances else None)
        json.dumps(out)
        assert ("tec_type" in out) or ("network_type" in out)

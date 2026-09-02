"""
Tests for catalogue-format loading helpers in api/routes.py

The highest-risk conversions are:
  - CO₂: g CO₂/kWh  →  t CO₂/MWh  (÷ 1000, factor-of-1000 error corrupts model outputs)
  - Efficiency: % → fraction (÷ 100)
  - Capacity: MW → kW (× 1000)
"""
from pathlib import Path
import pytest
from api._loader import (
    _is_catalogue,
    _map_catalogue_instance,
    _detect_lifecycle,
    _load_catalogue_file,
    _scan_raw_carriers,
)


BASE_DIR = Path(__file__).parent  # no real profile files needed in these tests


def _minimal_inst(**overrides) -> dict:
    """Return a minimal catalogue instance dict with sensible defaults."""
    base = {
        "instance_id":   "test_inst_001",
        "instance_name": "Test Instance",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# _is_catalogue
# ---------------------------------------------------------------------------

def test_is_catalogue_true():
    assert _is_catalogue({"metadata": {}, "technologies": []}) is True


def test_is_catalogue_false_missing_metadata():
    assert _is_catalogue({"technologies": []}) is False


def test_is_catalogue_false_missing_technologies():
    assert _is_catalogue({"metadata": {}}) is False


def test_is_catalogue_false_technologies_not_list():
    assert _is_catalogue({"metadata": {}, "technologies": {}}) is False


# ---------------------------------------------------------------------------
# CO₂ unit conversion: g CO₂/kWh → t CO₂/MWh  (÷ 1000)
# ---------------------------------------------------------------------------

def test_co2_conversion_factor_of_1000():
    inst = _minimal_inst(co2_emission_factor_operational_g_per_kwh=500.0)
    result = _map_catalogue_instance(inst, source=None, base_dir=BASE_DIR)
    co2 = result["co2_emission_factor"]
    assert co2 is not None
    assert abs(co2["value"] - 0.5) < 1e-9, f"Expected 0.5 t/MWh, got {co2['value']}"
    assert co2["unit"] == "tCO2/MWh_fuel"


def test_co2_zero_stays_zero():
    inst = _minimal_inst(co2_emission_factor_operational_g_per_kwh=0.0)
    result = _map_catalogue_instance(inst, source=None, base_dir=BASE_DIR)
    assert result["co2_emission_factor"]["value"] == 0.0


def test_co2_absent_produces_none():
    inst = _minimal_inst()
    result = _map_catalogue_instance(inst, source=None, base_dir=BASE_DIR)
    assert result["co2_emission_factor"] is None


# ---------------------------------------------------------------------------
# Efficiency: % → fraction  (÷ 100)
# ---------------------------------------------------------------------------

def test_efficiency_percent_to_fraction():
    inst = _minimal_inst(efficiency_percent=45.0)
    result = _map_catalogue_instance(inst, source=None, base_dir=BASE_DIR)
    eff = result["electrical_efficiency"]
    assert eff is not None
    assert abs(eff["value"] - 0.45) < 1e-9, f"Expected 0.45, got {eff['value']}"
    assert eff["unit"] == "fraction"


def test_efficiency_above_100_preserved_as_fraction():
    # Heat pumps can have COP > 1 (efficiency_percent > 100)
    inst = _minimal_inst(efficiency_percent=350.0)
    result = _map_catalogue_instance(inst, source=None, base_dir=BASE_DIR)
    eff = result["electrical_efficiency"]
    assert abs(eff["value"] - 3.5) < 1e-9


def test_efficiency_absent_produces_none():
    inst = _minimal_inst()
    result = _map_catalogue_instance(inst, source=None, base_dir=BASE_DIR)
    assert result["electrical_efficiency"] is None


# ---------------------------------------------------------------------------
# Capacity: MW → kW  (× 1000)
# ---------------------------------------------------------------------------

def test_capacity_mw_to_kw():
    inst = _minimal_inst(typical_capacity_mw=100.0)
    result = _map_catalogue_instance(inst, source=None, base_dir=BASE_DIR)
    cap = result["capacity_kw"]
    assert cap is not None
    assert abs(cap["value"] - 100_000.0) < 1e-6, f"Expected 100000 kW, got {cap['value']}"
    assert cap["unit"] == "kW"


def test_capacity_absent_produces_none():
    inst = _minimal_inst()
    result = _map_catalogue_instance(inst, source=None, base_dir=BASE_DIR)
    assert result["capacity_kw"] is None


# ---------------------------------------------------------------------------
# Provenance: source propagated into ParameterValue dicts
# ---------------------------------------------------------------------------

def test_source_propagated_to_parameter_values():
    inst = _minimal_inst(capex_usd_per_kw=1200.0)
    result = _map_catalogue_instance(inst, source="NREL ATB 2023", base_dir=BASE_DIR)
    assert result["capex_per_kw"]["source"] == "NREL ATB 2023"


def test_instance_reference_source_overrides_file_source():
    inst = _minimal_inst(capex_usd_per_kw=1200.0, reference_source="IRENA 2024")
    result = _map_catalogue_instance(inst, source="NREL ATB 2023", base_dir=BASE_DIR)
    # reference_source on the instance takes precedence
    assert result["capex_per_kw"]["source"] == "IRENA 2024"


# ---------------------------------------------------------------------------
# _detect_lifecycle
# ---------------------------------------------------------------------------

def test_lifecycle_commercial_default():
    assert _detect_lifecycle("Utility PV – 100 MW") == "commercial"


def test_lifecycle_future_keyword():
    assert _detect_lifecycle("Offshore Wind (Future, 2040)") == "projection"


def test_lifecycle_year_in_2030s():
    assert _detect_lifecycle("Solar PV 2035 scenario") == "projection"


def test_lifecycle_year_in_2050s():
    assert _detect_lifecycle("Green hydrogen 2050") == "projection"


def test_lifecycle_demo_keyword():
    assert _detect_lifecycle("Pilot plant – tidal stream") == "demonstration"


def test_lifecycle_demonstrator_keyword():
    assert _detect_lifecycle("Demonstration CCGT") == "demonstration"


# ---------------------------------------------------------------------------
# is_renewable classification (via _load_catalogue_file)
# ---------------------------------------------------------------------------

def _catalogue(domain: str, tech: dict) -> dict:
    return {"metadata": {"domain": domain}, "technologies": [tech]}


def _load_one(domain: str, tech: dict):
    techs = _load_catalogue_file(BASE_DIR / "fake.json", _catalogue(domain, tech))
    assert len(techs) == 1, "expected exactly one technology to load"
    return techs[0]


def test_is_renewable_generation_solar_true():
    tech = _load_one("generation", {"technology_id": "solar_pv_utility", "carrier": "solar"})
    assert tech.is_renewable is True


def test_is_renewable_generation_fossil_false():
    tech = _load_one("generation", {"technology_id": "ccgt", "carrier": "natural_gas"})
    assert tech.is_renewable is False


def test_is_renewable_storage_defaults_false():
    tech = _load_one("storage", {"technology_id": "lithium_ion_bess", "carrier": "electricity"})
    assert tech.is_renewable is False


def test_is_renewable_explicit_flag_honored_for_non_generation():
    # A conversion tech (green hydrogen) can be flagged renewable via explicit JSON.
    tech = _load_one("conversion", {
        "technology_id":  "pem_electrolyzer_green",
        "input_carrier":  "electricity",
        "output_carrier": "hydrogen",
        "is_renewable":   True,
    })
    assert tech.is_renewable is True


def test_is_renewable_explicit_flag_overrides_carrier():
    # Explicit False wins even when the carrier would imply renewable.
    tech = _load_one("generation", {
        "technology_id": "solar_pv_utility",
        "carrier":       "solar",
        "is_renewable":  False,
    })
    assert tech.is_renewable is False


# ---------------------------------------------------------------------------
# _scan_raw_carriers — data-quality scan of the real catalogue files
# ---------------------------------------------------------------------------

def test_scan_raw_carriers_returns_set():
    unmapped = _scan_raw_carriers()
    assert isinstance(unmapped, set)


def test_scan_raw_carriers_current_catalogue_is_clean():
    # The shipped catalogue should use only mappable carrier vocabulary.
    assert _scan_raw_carriers() == set()

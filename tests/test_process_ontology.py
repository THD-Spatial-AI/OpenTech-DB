"""Tests for the Process validator + equipment ontology (ADR-0006)."""
from __future__ import annotations

import json
from pathlib import Path

from schemas.process_ontology import EQUIPMENT_ONTOLOGY, validate_process

DATA = Path(__file__).resolve().parent.parent / "data" / "processes"


def _seed(slug: str) -> dict:
    return json.loads((DATA / f"{slug}.json").read_text(encoding="utf-8"))


def _codes(items):
    return {i["code"] for i in items}


def test_seed_processes_are_valid():
    for slug in ("h2_power_plant", "ccs_amine", "biomass_chp", "biogas_biomethane", "power_to_gas"):
        r = validate_process(_seed(slug))
        assert r["valid"], f"{slug} should be valid, got errors: {r['errors']}"


def test_missing_required_input_is_an_error():
    # Electrolyzer with power but NO water → error
    g = {
        "units": [
            {"id": "src", "equipment_type": "power_source", "ports": [], "operating_conditions": {}},
            {"id": "elz", "equipment_type": "electrolyzer_pem", "ports": [], "operating_conditions": {}},
        ],
        "streams": [
            {"id": "s1", "source": {"unit_id": "src", "port_id": "power_out"},
             "target": {"unit_id": "elz", "port_id": "power_in"}, "carrier": "electricity"},
        ],
    }
    r = validate_process(g)
    assert not r["valid"]
    assert "missing_required_input" in _codes(r["errors"])


def test_carrier_mismatch_is_an_error():
    g = {
        "units": [
            {"id": "src", "equipment_type": "power_source", "ports": [], "operating_conditions": {}},
            {"id": "fc", "equipment_type": "fuel_cell_pem", "ports": [], "operating_conditions": {}},
        ],
        # electricity OUT wired into a hydrogen IN
        "streams": [
            {"id": "s1", "source": {"unit_id": "src", "port_id": "power_out"},
             "target": {"unit_id": "fc", "port_id": "h2_in"}, "carrier": "electricity"},
        ],
    }
    r = validate_process(g)
    assert not r["valid"]
    assert "carrier_mismatch" in _codes(r["errors"])


def test_cycle_is_an_error():
    g = {
        "units": [
            {"id": "a", "equipment_type": "compressor", "ports": [], "operating_conditions": {}},
            {"id": "b", "equipment_type": "compressor", "ports": [], "operating_conditions": {}},
        ],
        "streams": [
            {"id": "s1", "source": {"unit_id": "a", "port_id": "h2_out"}, "target": {"unit_id": "b", "port_id": "h2_in"}, "carrier": "hydrogen"},
            {"id": "s2", "source": {"unit_id": "b", "port_id": "h2_out"}, "target": {"unit_id": "a", "port_id": "h2_in"}, "carrier": "hydrogen"},
        ],
    }
    assert "cycle" in _codes(validate_process(g)["errors"])


def test_unconsumed_output_is_a_warning_not_error():
    # electrolyzer fully fed, but its H2 goes nowhere → warning, still valid
    g = {
        "units": [
            {"id": "src", "equipment_type": "power_source", "ports": [], "operating_conditions": {}},
            {"id": "w", "equipment_type": "water_source", "ports": [], "operating_conditions": {}},
            {"id": "elz", "equipment_type": "electrolyzer_pem", "ports": [], "operating_conditions": {}},
        ],
        "streams": [
            {"id": "s1", "source": {"unit_id": "src", "port_id": "power_out"}, "target": {"unit_id": "elz", "port_id": "power_in"}, "carrier": "electricity"},
            {"id": "s2", "source": {"unit_id": "w", "port_id": "water_out"}, "target": {"unit_id": "elz", "port_id": "water_in"}, "carrier": "water"},
        ],
    }
    r = validate_process(g)
    assert r["valid"]
    assert "unconsumed_output" in _codes(r["warnings"])


def test_pressure_mismatch_warning():
    g = {
        "units": [
            {"id": "c", "equipment_type": "compressor",
             "operating_conditions": {"target_pressure_bar": {"value": 700}}, "ports": []},
            {"id": "t", "equipment_type": "h2_tank",
             "operating_conditions": {"max_pressure_bar": {"value": 350}}, "ports": []},
        ],
        "streams": [
            {"id": "s1", "source": {"unit_id": "c", "port_id": "h2_out"},
             "target": {"unit_id": "t", "port_id": "h2_in"}, "carrier": "hydrogen"},
        ],
    }
    assert "pressure_mismatch" in _codes(validate_process(g)["warnings"])


def test_ontology_covers_all_seed_equipment():
    for slug in ("h2_power_plant", "ccs_amine", "biomass_chp", "biogas_biomethane", "power_to_gas"):
        for u in _seed(slug)["units"]:
            assert u["equipment_type"] in EQUIPMENT_ONTOLOGY, f"{u['equipment_type']} missing from ontology"

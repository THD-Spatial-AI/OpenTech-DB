"""
Regression tests for the Process simulation engine (ADR-0004, Phase 5).

Covers the steady-state solver against the seed Processes, graph validation,
per-component behaviour, catalogue-parameter resolution precedence, and the
Process schema's graph-consistency validator.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "services" / "processsim"))

import components  # noqa: E402
import solver  # noqa: E402
from solver import GraphError, simulate  # noqa: E402
from schemas.process import Process  # noqa: E402

DATA = REPO / "data" / "processes"


def _seed(slug: str) -> dict:
    return json.loads((DATA / f"{slug}.json").read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def _isolate_catalogue(monkeypatch):
    """Isolate the solver from the live catalogue so seed KPIs are deterministic
    and network-free; the seeds carry their own efficiency operating conditions."""
    monkeypatch.setattr(solver, "resolve_tech_params", lambda ref: {})


# ── Seed processes reproduce through the general engine ──────────────────────

def test_h2_seed_kpis():
    # Onshore wind runs at ~40% capacity factor → 10 MW nameplate delivers ~4 MW average.
    r = simulate(_seed("h2_power_plant"))
    k = r["kpi"]
    assert r["engine"] == "steady_state"
    assert k["source_power_kw"] == pytest.approx(4000, rel=0.01)
    assert k["h2_production_kg_h"] == pytest.approx(71.1, rel=0.02)
    assert 35 < k["round_trip_efficiency_pct"] < 45   # ratio preserved under the CF scaling
    assert k["parasitic_load_kw"] > 0


def test_ccs_seed_kpis():
    r = simulate(_seed("ccs_amine"))
    k = r["kpi"]
    assert k["co2_captured_kg_h"] == pytest.approx(126000, rel=0.01)
    assert k["co2_captured_mtco2_yr"] > 1.0


def test_every_unit_has_a_result():
    for slug in ("h2_power_plant", "ccs_amine"):
        seed = _seed(slug)
        r = simulate(seed)
        assert set(r["units"]) == {u["id"] for u in seed["units"]}


# ── Energy layer (canonical energy_kw / balance / flows / efficiency) ─────────

def test_energy_layer_annotates_streams_and_balance():
    r = simulate(_seed("power_to_gas"))
    # every stream carries a canonical energy_kw
    for st in r["streams"].values():
        assert "energy_kw" in st
    # every unit carries an energy balance
    for res in r["units"].values():
        bal = res["balance"]
        assert {"in_kw", "out_kw", "loss_kw"} <= set(bal)
        assert bal["loss_kw"] >= 0


def test_flows_are_prejoined():
    seed = _seed("power_to_gas")
    r = simulate(seed)
    assert len(r["flows"]) == len(seed["streams"])
    f = r["flows"][0]
    assert {"from_label", "to_label", "carrier", "energy_kw", "quantity"} <= set(f)


def test_overall_efficiency_is_sensible():
    assert simulate(_seed("biomass_chp"))["kpi"]["overall_efficiency_pct"] == pytest.approx(85.0, abs=1.0)
    assert simulate(_seed("power_to_gas"))["kpi"]["overall_efficiency_pct"] == pytest.approx(39.3, abs=1.0)


def test_fanned_out_electricity_is_not_double_counted():
    # h2 seed: the power source feeds BOTH the electrolyzer (10 MW) and the
    # compressor drive (<1 MW). Each branch must reflect the consumer's real draw.
    r = simulate(_seed("h2_power_plant"))
    elec = {(f["from_unit"], f["to_unit"]): f["energy_kw"]
            for f in r["flows"] if f["carrier"] == "electricity"}
    to_elz = elec[("power_source", "electrolyzer")]
    to_comp = elec[("power_source", "compressor")]
    assert to_elz == pytest.approx(4000, rel=0.01)   # electrolyzer draw at 40% CF
    assert to_comp < 1000


# ── Graph validation ─────────────────────────────────────────────────────────

def test_cycle_is_rejected():
    port = lambda i, o: [{"id": "i", "carrier": "hydrogen", "direction": "in"},
                         {"id": "o", "carrier": "hydrogen", "direction": "out"}]
    g = {
        "units": [
            {"id": "a", "equipment_type": "compressor", "operating_conditions": {}, "ports": port("i", "o")},
            {"id": "b", "equipment_type": "compressor", "operating_conditions": {}, "ports": port("i", "o")},
        ],
        "streams": [
            {"id": "s1", "source": {"unit_id": "a", "port_id": "o"}, "target": {"unit_id": "b", "port_id": "i"}, "carrier": "hydrogen"},
            {"id": "s2", "source": {"unit_id": "b", "port_id": "o"}, "target": {"unit_id": "a", "port_id": "i"}, "carrier": "hydrogen"},
        ],
    }
    with pytest.raises(GraphError):
        simulate(g)


def test_empty_graph_is_noop():
    r = simulate({"units": [], "streams": []})
    assert r["units"] == {} and r["kpi"] == {}


# ── Component behaviour + catalogue precedence ───────────────────────────────

def test_component_uses_catalogue_efficiency_when_no_setpoint():
    _, result = components.electrolyzer_pem(
        {"id": "e"}, {"power_in": {"carrier": "electricity", "power_kw": 1000}},
        {}, {"efficiency_pct": 84},
    )
    assert result["efficiency_pct"] == 84.0
    assert result["h2_kg_h"] == pytest.approx(1000 * 0.84 / 39.4, rel=0.02)


def test_operating_condition_overrides_catalogue():
    _, result = components.electrolyzer_pem(
        {"id": "e"}, {"power_in": {"power_kw": 1000}},
        {"nominal_efficiency_pct_hhv": 60}, {"efficiency_pct": 84},
    )
    assert result["efficiency_pct"] == 60.0


def test_unknown_equipment_type_falls_back_to_passthrough():
    outlets, result = components.passthrough(
        {"id": "x", "ports": [{"id": "out", "carrier": "hydrogen", "direction": "out"}]},
        {"in": {"carrier": "hydrogen", "h2_kg_h": 5}}, {}, {},
    )
    assert "note" in result
    assert outlets["out"]["h2_kg_h"] == 5


# ── Process schema graph-consistency validator ───────────────────────────────

def test_seed_processes_validate():
    for slug in ("h2_power_plant", "ccs_amine"):
        Process.model_validate(_seed(slug))   # graph validator runs on construction


def test_carrier_mismatch_is_rejected():
    bad = {
        "slug": "bad", "name": "Bad",
        "units": [
            {"id": "a", "name": "A", "equipment_type": "power_source",
             "ports": [{"id": "o", "carrier": "electricity", "direction": "out"}]},
            {"id": "b", "name": "B", "equipment_type": "electrolyzer_pem",
             "ports": [{"id": "i", "carrier": "hydrogen", "direction": "in"}]},
        ],
        # electricity OUT wired into a hydrogen IN → must be rejected
        "streams": [
            {"id": "s", "source": {"unit_id": "a", "port_id": "o"},
             "target": {"unit_id": "b", "port_id": "i"}, "carrier": "electricity"},
        ],
    }
    with pytest.raises(Exception):
        Process.model_validate(bad)

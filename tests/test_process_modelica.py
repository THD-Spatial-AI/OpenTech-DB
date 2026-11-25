"""
Tests for the OpenModelica engine (ADR-0004, Phase 5).

The structural tests run anywhere. The parity test compiles and simulates every
seed Process with OpenModelica and checks it agrees with the steady-state
engine; it is skipped where omc/OMPython are not installed (run it inside the
processsim container).
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "services" / "processsim"))

import modelica_compiler as mc  # noqa: E402
import solver  # noqa: E402
from components import COMPONENTS  # noqa: E402

SEEDS = sorted((REPO / "data" / "processes").glob("*.json"))
HAS_OMC = bool(shutil.which("omc")) and importlib.util.find_spec("OMPython") is not None


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_every_equipment_type_has_a_modelica_model():
    assert set(COMPONENTS) == set(mc.MODELICA_MAP)
    assert {cls for cls, _ in mc.MODELICA_MAP.values()} == set(mc.RESULT_VARS)


def test_unmodelled_equipment_type_is_an_error():
    graph = {"units": [{"id": "x", "equipment_type": "fusion_reactor", "ports": []}], "streams": []}
    with pytest.raises(ValueError, match="fusion_reactor"):
        mc.build_system_model(graph)


@pytest.mark.parametrize("seed", SEEDS, ids=lambda p: p.stem)
def test_every_seed_compiles_to_a_model(seed):
    src, meta = mc.build_system_model(_load(seed))
    assert len(meta) == len(_load(seed)["units"])
    assert src.startswith("model FlowSystem")


def _close(a, b):
    if isinstance(a, dict) and isinstance(b, dict):
        assert a.keys() == b.keys()
        for k in a:
            _close(a[k], b[k])
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)):
        assert a == pytest.approx(b, rel=1e-4, abs=0.11)   # one rounding step
    else:
        assert a == b


@pytest.mark.skipif(not HAS_OMC, reason="OpenModelica (omc + OMPython) not installed")
@pytest.mark.parametrize("seed", SEEDS, ids=lambda p: p.stem)
def test_openmodelica_matches_steady_state(seed, monkeypatch):
    monkeypatch.setattr(solver, "resolve_tech_params", lambda ref: {})
    graph = _load(seed)
    ss = solver.simulate(graph)
    om = mc.simulate(graph, lambda ref: {})

    assert om["engine"] == "openmodelica"
    for uid, res in ss["units"].items():
        omres = dict(om["units"][uid])
        omres.pop("level_kg", None)          # dynamic state, OpenModelica only
        _close(omres, res)
    _close(om["streams"], ss["streams"])
    _close(om["kpi"], ss["kpi"])
    assert [f["energy_kw"] for f in om["flows"]] == pytest.approx(
        [f["energy_kw"] for f in ss["flows"]], abs=0.11)

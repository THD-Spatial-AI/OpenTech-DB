"""
solver.py
=========
Steady-state flowsheet solver for the Process simulation engine (ADR-0004,
Phase 3). This is the Python counterpart of the ADR's *Flowsheet compiler*: it
walks a Process graph in topological order, evaluates each Unit's Component
model, propagates Stream states, and aggregates KPIs.

Input graph shape (as sent by the builder / `/api/v1/processes`):
    { "units":   [{ id, equipment_type, operating_conditions, ports, … }],
      "streams": [{ id, source:{unit_id,port_id}, target:{unit_id,port_id}, carrier }] }
"""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

from components import COMPONENTS, passthrough
from catalogue import resolve_tech_params


class GraphError(ValueError):
    """Raised when the Process graph cannot be solved (e.g. it contains a cycle)."""


def _unwrap_oc(oc: dict | None) -> dict[str, Any]:
    """operating_conditions store ParameterValue dicts ({value,unit,…}); pull the value."""
    out: dict[str, Any] = {}
    for key, pv in (oc or {}).items():
        out[key] = pv.get("value") if isinstance(pv, dict) else pv
    return out


def _topo_order(units: dict[str, dict], streams: list[dict]) -> list[str]:
    out_streams: dict[str, list] = defaultdict(list)
    indeg = {uid: 0 for uid in units}
    for s in streams:
        src, tgt = s["source"]["unit_id"], s["target"]["unit_id"]
        if src not in units or tgt not in units:
            raise GraphError(f"Stream '{s.get('id')}' references an unknown Unit.")
        out_streams[src].append(s)
        indeg[tgt] += 1

    queue = deque(sorted(uid for uid, d in indeg.items() if d == 0))
    order: list[str] = []
    while queue:
        uid = queue.popleft()
        order.append(uid)
        for s in out_streams[uid]:
            t = s["target"]["unit_id"]
            indeg[t] -= 1
            if indeg[t] == 0:
                queue.append(t)

    if len(order) != len(units):
        raise GraphError("Process graph contains a cycle — cannot solve in steady state.")
    return order


def simulate(graph: dict) -> dict:
    units = {u["id"]: u for u in graph.get("units", [])}
    streams = graph.get("streams", [])
    if not units:
        return {"units": {}, "streams": {}, "kpi": {}, "engine": "steady_state"}

    in_streams: dict[str, list] = defaultdict(list)
    out_streams: dict[str, list] = defaultdict(list)
    for s in streams:
        in_streams[s["target"]["unit_id"]].append(s)
        out_streams[s["source"]["unit_id"]].append(s)

    order = _topo_order(units, streams)

    stream_state: dict[str, dict] = {}
    unit_result: dict[str, dict] = {}

    for uid in order:
        unit = units[uid]
        oc = _unwrap_oc(unit.get("operating_conditions"))
        inlets = {
            s["target"]["port_id"]: stream_state[s["id"]]
            for s in in_streams[uid] if s["id"] in stream_state
        }
        tech = resolve_tech_params(unit.get("technology_ref"))
        fn = COMPONENTS.get(unit.get("equipment_type"), passthrough)
        outlets, result = fn(unit, inlets, oc, tech)
        unit_result[uid] = result
        for s in out_streams[uid]:
            pid = s["source"]["port_id"]
            if pid in outlets:
                stream_state[s["id"]] = outlets[pid]

    return {
        "units": unit_result,
        "streams": stream_state,
        "kpi": _kpi(units, unit_result),
        "engine": "steady_state",
    }


def _kpi(units: dict[str, dict], results: dict[str, dict]) -> dict:
    def _sum(pred, key):
        return round(sum(results[uid].get(key, 0) or 0
                         for uid, u in units.items() if pred(u)), 1)

    is_type = lambda t: (lambda u: u.get("equipment_type") == t)

    power_in  = _sum(is_type("power_source"), "power_kw")
    power_out = _sum(is_type("grid_sink"), "power_kw") or _sum(is_type("fuel_cell_pem"), "power_kw")
    h2        = _sum(is_type("electrolyzer_pem"), "h2_kg_h")
    co2_cap   = _sum(is_type("co2_absorber_amine"), "co2_captured_kg_h")
    parasitic = round(sum(results[uid].get("power_kw", 0) or 0
                          for uid, u in units.items()
                          if u.get("equipment_type") in ("compressor", "co2_compressor")), 1)

    kpi: dict[str, Any] = {}
    if power_in:
        kpi["source_power_kw"] = power_in
    if power_out:
        kpi["output_power_kw"] = power_out
    if power_in and power_out:
        kpi["round_trip_efficiency_pct"] = round(power_out / power_in * 100, 1)
    if h2:
        kpi["h2_production_kg_h"] = h2
    if co2_cap:
        kpi["co2_captured_kg_h"] = co2_cap
        kpi["co2_captured_mtco2_yr"] = round(co2_cap * 8760 / 1e9, 4)
    if parasitic:
        kpi["parasitic_load_kw"] = parasitic
    return kpi

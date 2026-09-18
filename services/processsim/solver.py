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

from components import COMPONENTS, passthrough, H2_HHV_KWH_PER_KG
from catalogue import resolve_tech_params


class GraphError(ValueError):
    """Raised when the Process graph cannot be solved (e.g. it contains a cycle)."""


# Ordered canonical energy fields written by the component models. Electricity and
# hydrogen streams already carry `power_kw`; pure-mass carriers (water, CO₂) have
# none and resolve to 0 — they appear in the stream table but not the energy Sankey.
_ENERGY_FIELDS = ("power_kw", "ch4_kw", "biogas_kw", "fuel_kw", "heat_kw", "flue_kw")


def _stream_energy_kw(state: dict) -> float:
    """Canonical energy content [kW] of a stream state, comparable across carriers."""
    for k in _ENERGY_FIELDS:
        v = state.get(k)
        if v is not None:
            return float(v)
    h2 = state.get("h2_kg_h")
    return float(h2) * H2_HHV_KWH_PER_KG if h2 is not None else 0.0


def _delivered_energy_kw(stream: dict, state: dict, unit_result: dict) -> float:
    """Energy actually transferred on a stream. Electricity is a shared utility: a
    source broadcasts its capacity onto every branch, so the real delivered power is
    the *consumer's* draw (avoids double-counting a fanned-out source)."""
    if state.get("carrier") == "electricity":
        tr = unit_result.get(stream["target"]["unit_id"], {})
        draw = tr.get("power_in_kw")
        if draw is None:
            draw = tr.get("power_kw")   # compressor drive / grid delivery
        if draw is not None:
            return float(draw)
    return _stream_energy_kw(state)


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
                # copy so fanned-out branches (same port → many targets) stay independent
                stream_state[s["id"]] = dict(outlets[pid])

    # ── Energy layer: canonical energy_kw per stream + per-unit balance ────────
    for s in streams:
        st = stream_state.get(s["id"])
        if st is not None:
            st["energy_kw"] = round(_delivered_energy_kw(s, st, unit_result), 1)

    for uid in units:
        in_kw = sum(stream_state[s["id"]].get("energy_kw", 0.0)
                    for s in in_streams[uid] if s["id"] in stream_state)
        out_kw = sum(stream_state[s["id"]].get("energy_kw", 0.0)
                     for s in out_streams[uid] if s["id"] in stream_state)
        # loss is only meaningful for a conversion node (energy both in and out)
        loss = in_kw - out_kw if (in_kw > 0 and out_kw > 0) else 0.0
        unit_result.setdefault(uid, {})["balance"] = {
            "in_kw": round(in_kw, 1), "out_kw": round(out_kw, 1),
            "loss_kw": round(max(loss, 0.0), 1),
        }

    flows = _flows(units, streams, stream_state)

    return {
        "units": unit_result,
        "streams": stream_state,
        "flows": flows,
        "kpi": _kpi(units, streams, unit_result, stream_state),
        "engine": "steady_state",
    }


def _flows(units: dict[str, dict], streams: list[dict], stream_state: dict[str, dict]) -> list[dict]:
    """Pre-joined edge list for the Sankey + stream table (graph × computed state)."""
    def _label(uid: str) -> str:
        return units.get(uid, {}).get("name") or uid

    out: list[dict] = []
    for s in streams:
        st = stream_state.get(s["id"], {})
        quantity = {k: v for k, v in st.items()
                    if k not in ("carrier", "energy_kw") and v is not None}
        out.append({
            "stream_id": s["id"],
            "from_unit": s["source"]["unit_id"], "from_label": _label(s["source"]["unit_id"]),
            "to_unit": s["target"]["unit_id"], "to_label": _label(s["target"]["unit_id"]),
            "carrier": s.get("carrier") or st.get("carrier"),
            "energy_kw": st.get("energy_kw", 0.0),
            "quantity": quantity,
        })
    return out


def _kpi(units: dict[str, dict], streams: list[dict],
         results: dict[str, dict], stream_state: dict[str, dict]) -> dict:
    def _sum(pred, key):
        return round(sum(results[uid].get(key, 0) or 0
                         for uid, u in units.items() if pred(u)), 1)

    is_type = lambda t: (lambda u: u.get("equipment_type") == t)

    power_in  = _sum(is_type("power_source"), "power_kw")
    power_out = (_sum(is_type("grid_sink"), "power_kw")
                 or _sum(is_type("fuel_cell_pem"), "power_kw")
                 or _sum(is_type("biomass_chp"), "power_kw"))
    h2        = _sum(is_type("electrolyzer_pem"), "h2_kg_h")
    co2_cap   = _sum(is_type("co2_absorber_amine"), "co2_captured_kg_h")
    heat_out  = _sum(is_type("heat_sink"), "heat_kw") or _sum(is_type("biomass_chp"), "heat_kw")
    methane   = _sum(is_type("gas_grid_sink"), "methane_kw")
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
    if heat_out:
        kpi["heat_output_kw"] = heat_out
    if methane:
        kpi["methane_output_kw"] = methane

    # ── System energy balance (graph-derived source/sink energy) ──────────────
    has_in = {s["target"]["unit_id"] for s in streams}
    has_out = {s["source"]["unit_id"] for s in streams}
    src_kw = round(sum(stream_state[s["id"]].get("energy_kw", 0.0)
                       for s in streams if s["source"]["unit_id"] not in has_in
                       and s["id"] in stream_state), 1)
    sink_kw = round(sum(stream_state[s["id"]].get("energy_kw", 0.0)
                        for s in streams if s["target"]["unit_id"] not in has_out
                        and s["id"] in stream_state), 1)
    total_loss = round(sum((results[uid].get("balance") or {}).get("loss_kw", 0.0)
                           for uid in units), 1)
    if src_kw and sink_kw:
        kpi["overall_efficiency_pct"] = round(sink_kw / src_kw * 100, 1)
    if total_loss:
        kpi["total_loss_kw"] = total_loss
    return kpi

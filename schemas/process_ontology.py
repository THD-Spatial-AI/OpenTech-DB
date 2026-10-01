"""
schemas/process_ontology.py
===========================
OEO-aligned equipment ontology + the Process validator (ADR-0006).

`EQUIPMENT_ONTOLOGY` is the single source of truth for each equipment type's
interface: its OEO class, category, and typed ports (carrier, direction, and
whether an input is *required* for the unit to function). `validate_process`
runs the layered rules (L1 carrier, L2 required inputs, L3 stream-state
compatibility, L4 process validity) and returns structured errors/warnings.
"""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

# ── L2: equipment interface contracts ────────────────────────────────────────
# port: {id, carrier, direction: "in"|"out", required: bool}
EQUIPMENT_ONTOLOGY: dict[str, dict[str, Any]] = {
    "power_source": {
        "label": "Power Source", "oeo_class": "oeo:PowerGeneratingUnit", "category": "generation",
        "ports": [{"id": "power_out", "carrier": "electricity", "direction": "out", "required": False}],
    },
    "water_source": {
        "label": "Water Supply", "oeo_class": "oeo:Reservoir", "category": None,
        "ports": [{"id": "water_out", "carrier": "water", "direction": "out", "required": False}],
    },
    "flue_gas_source": {
        "label": "Flue Gas Source", "oeo_class": "oeo:CombustionUnit", "category": "generation",
        "ports": [{"id": "flue_out", "carrier": "flue_gas", "direction": "out", "required": False}],
    },
    "electrolyzer_pem": {
        "label": "Electrolyzer", "oeo_class": "oeo:Electrolyser", "category": "conversion",
        "ports": [
            {"id": "power_in", "carrier": "electricity", "direction": "in", "required": True},
            {"id": "water_in", "carrier": "water", "direction": "in", "required": True},
            {"id": "h2_out", "carrier": "hydrogen", "direction": "out", "required": False},
        ],
    },
    "fuel_cell_pem": {
        "label": "Fuel Cell", "oeo_class": "oeo:FuelCell", "category": "conversion",
        "ports": [
            {"id": "h2_in", "carrier": "hydrogen", "direction": "in", "required": True},
            {"id": "power_out", "carrier": "electricity", "direction": "out", "required": False},
        ],
    },
    "compressor": {
        "label": "Compressor", "oeo_class": "oeo:Compressor", "category": "conversion",
        "ports": [
            {"id": "h2_in", "carrier": "hydrogen", "direction": "in", "required": True},
            # drive power is an auxiliary utility, not a required process stream
            {"id": "power_in", "carrier": "electricity", "direction": "in", "required": False},
            {"id": "h2_out", "carrier": "hydrogen", "direction": "out", "required": False},
        ],
    },
    "co2_compressor": {
        "label": "CO₂ Compressor", "oeo_class": "oeo:Compressor", "category": "conversion",
        "ports": [
            {"id": "co2_in", "carrier": "co2", "direction": "in", "required": True},
            {"id": "power_in", "carrier": "electricity", "direction": "in", "required": False},
            {"id": "co2_out", "carrier": "co2", "direction": "out", "required": False},
        ],
    },
    "co2_absorber_amine": {
        "label": "CO₂ Absorber", "oeo_class": "oeo:CarbonCaptureUnit", "category": "conversion",
        "ports": [
            {"id": "flue_in", "carrier": "flue_gas", "direction": "in", "required": True},
            {"id": "co2_rich_out", "carrier": "co2", "direction": "out", "required": False},
        ],
    },
    "solvent_stripper": {
        "label": "Stripper", "oeo_class": "oeo:SeparationUnit", "category": "conversion",
        "ports": [
            {"id": "co2_rich_in", "carrier": "co2", "direction": "in", "required": True},
            {"id": "heat_in", "carrier": "steam", "direction": "in", "required": False},
            {"id": "co2_pure_out", "carrier": "co2", "direction": "out", "required": False},
        ],
    },
    "h2_tank": {
        "label": "H₂ Storage", "oeo_class": "oeo:StorageUnit", "category": "storage",
        "ports": [
            {"id": "h2_in", "carrier": "hydrogen", "direction": "in", "required": True},
            {"id": "h2_out", "carrier": "hydrogen", "direction": "out", "required": False},
        ],
    },
    "co2_geological_storage": {
        "label": "CO₂ Storage", "oeo_class": "oeo:StorageUnit", "category": "storage",
        "ports": [{"id": "co2_in", "carrier": "co2", "direction": "in", "required": True}],
    },
    "grid_sink": {
        "label": "Grid / Load", "oeo_class": "oeo:Load", "category": None,
        "ports": [{"id": "power_in", "carrier": "electricity", "direction": "in", "required": True}],
    },
    # ── Bioenergy + power-to-gas ─────────────────────────────────────────────
    "biomass_source": {
        "label": "Biomass Supply", "oeo_class": "oeo:Biomass", "category": "generation",
        "ports": [{"id": "biomass_out", "carrier": "biomass", "direction": "out", "required": False}],
    },
    "co2_source": {
        "label": "CO₂ Supply", "oeo_class": "oeo:Reservoir", "category": None,
        "ports": [{"id": "co2_out", "carrier": "co2", "direction": "out", "required": False}],
    },
    "biomass_chp": {
        "label": "Biomass CHP", "oeo_class": "oeo:CombinedHeatAndPowerGeneratingUnit", "category": "generation",
        "ports": [
            {"id": "biomass_in", "carrier": "biomass", "direction": "in", "required": True},
            {"id": "power_out", "carrier": "electricity", "direction": "out", "required": False},
            {"id": "heat_out", "carrier": "heat", "direction": "out", "required": False},
        ],
    },
    "anaerobic_digester": {
        "label": "Anaerobic Digester", "oeo_class": "oeo:BiogasPlant", "category": "conversion",
        "ports": [
            {"id": "biomass_in", "carrier": "biomass", "direction": "in", "required": True},
            {"id": "biogas_out", "carrier": "biogas", "direction": "out", "required": False},
        ],
    },
    "biogas_upgrader": {
        "label": "Biogas Upgrader", "oeo_class": "oeo:SeparationUnit", "category": "conversion",
        "ports": [
            {"id": "biogas_in", "carrier": "biogas", "direction": "in", "required": True},
            {"id": "gas_out", "carrier": "methane", "direction": "out", "required": False},
            {"id": "co2_out", "carrier": "co2", "direction": "out", "required": False},
        ],
    },
    "methanation_reactor": {
        "label": "Methanation Reactor", "oeo_class": "oeo:ChemicalReactor", "category": "conversion",
        "ports": [
            {"id": "h2_in", "carrier": "hydrogen", "direction": "in", "required": True},
            {"id": "co2_in", "carrier": "co2", "direction": "in", "required": True},
            {"id": "gas_out", "carrier": "methane", "direction": "out", "required": False},
        ],
    },
    "heat_sink": {
        "label": "Heat Demand", "oeo_class": "oeo:Load", "category": None,
        "ports": [{"id": "heat_in", "carrier": "heat", "direction": "in", "required": True}],
    },
    "gas_grid_sink": {
        "label": "Gas Grid / Load", "oeo_class": "oeo:Load", "category": None,
        "ports": [{"id": "gas_in", "carrier": "methane", "direction": "in", "required": True}],
    },
}

_SOURCE_TYPES = {"power_source", "water_source", "flue_gas_source", "biomass_source", "co2_source"}


def _issue(code: str, message: str, **loc) -> dict:
    return {"code": code, "message": message, **{k: v for k, v in loc.items() if v is not None}}


def _oc(unit: dict) -> dict:
    out = {}
    for k, pv in (unit.get("operating_conditions") or {}).items():
        out[k] = pv.get("value") if isinstance(pv, dict) else pv
    return out


def validate_process(graph: dict) -> dict:
    """Run the layered validity rules. Returns {valid, errors, warnings}."""
    units = graph.get("units", []) or []
    streams = graph.get("streams", []) or []
    by_id = {u["id"]: u for u in units}
    onto = EQUIPMENT_ONTOLOGY

    errors: list[dict] = []
    warnings: list[dict] = []

    def ports_of(u: dict) -> dict[str, dict]:
        spec = onto.get(u.get("equipment_type"))
        return {p["id"]: p for p in (spec["ports"] if spec else u.get("ports", []))}

    if not units:
        return {"valid": True, "errors": [], "warnings": []}

    # incoming/outgoing per (unit, port)
    incoming: dict[tuple[str, str], list] = defaultdict(list)
    outgoing: dict[tuple[str, str], list] = defaultdict(list)

    # ── L1: streams reference known units/ports with matching carriers ────────
    for s in streams:
        su, sp = s["source"]["unit_id"], s["source"]["port_id"]
        tu, tp = s["target"]["unit_id"], s["target"]["port_id"]
        if su not in by_id or tu not in by_id:
            errors.append(_issue("unknown_unit", "Stream references a unit that no longer exists.", stream_id=s.get("id")))
            continue
        sport = ports_of(by_id[su]).get(sp)
        tport = ports_of(by_id[tu]).get(tp)
        if not sport or not tport:
            errors.append(_issue("unknown_port", "Stream references a port that does not exist on its unit.", stream_id=s.get("id")))
            continue
        if sport["direction"] != "out" or tport["direction"] != "in":
            errors.append(_issue("bad_direction", "A stream must go from an OUT port to an IN port.", stream_id=s.get("id")))
            continue
        if not (s.get("carrier") == sport["carrier"] == tport["carrier"]):
            errors.append(_issue("carrier_mismatch",
                                 f"Carrier mismatch on this stream ({sport['carrier']} → {tport['carrier']}).",
                                 stream_id=s.get("id")))
        outgoing[(su, sp)].append(s)
        incoming[(tu, tp)].append(s)

    for u in units:
        uid, et = u["id"], u.get("equipment_type")
        spec = onto.get(et)
        label = (spec or {}).get("label", et)
        if spec is None:
            warnings.append(_issue("unknown_equipment", f"'{et}' is not in the equipment ontology — it cannot be validated.", unit_id=uid))
            continue

        # ── L2: required inputs must be connected ─────────────────────────────
        for p in spec["ports"]:
            if p["direction"] == "in" and p.get("required") and not incoming[(uid, p["id"])]:
                errors.append(_issue("missing_required_input",
                                     f"{label} requires a {p['carrier']} input ({p['id']}).", unit_id=uid))
            # an input port fed by more than one source is ambiguous
            if p["direction"] == "in" and len(incoming[(uid, p["id"])]) > 1:
                errors.append(_issue("multiple_inputs",
                                     f"{label}'s {p['id']} input is fed by more than one stream.", unit_id=uid))

        # ── L4: products with no consumer (informational) ─────────────────────
        for p in spec["ports"]:
            if p["direction"] == "out" and et not in _SOURCE_TYPES and not outgoing[(uid, p["id"])]:
                warnings.append(_issue("unconsumed_output",
                                       f"{label} produces {p['carrier']} that nothing consumes.", unit_id=uid))

        # orphan unit (no connections at all)
        connected = any(incoming[(uid, p["id"])] or outgoing[(uid, p["id"])] for p in spec["ports"])
        if not connected and len(units) > 1:
            warnings.append(_issue("orphan_unit", f"{label} is not connected to anything.", unit_id=uid))

    # ── L4: a process needs at least one source ───────────────────────────────
    if not any(u.get("equipment_type") in _SOURCE_TYPES for u in units):
        warnings.append(_issue("no_source", "The process has no source unit (power / water / flue gas)."))

    # ── L4: no cycles (steady state) ──────────────────────────────────────────
    if _has_cycle(units, streams, by_id):
        errors.append(_issue("cycle", "The process graph contains a cycle — it cannot be solved in steady state."))

    # ── L3: a few stream-state compatibility warnings ─────────────────────────
    warnings.extend(_pressure_warnings(units, streams, by_id))

    return {"valid": len(errors) == 0, "errors": errors, "warnings": warnings}


def _has_cycle(units: list, streams: list, by_id: dict) -> bool:
    indeg = {u["id"]: 0 for u in units}
    adj = defaultdict(list)
    for s in streams:
        su, tu = s["source"]["unit_id"], s["target"]["unit_id"]
        if su in by_id and tu in by_id:
            adj[su].append(tu)
            indeg[tu] += 1
    q = deque([u for u, d in indeg.items() if d == 0])
    seen = 0
    while q:
        n = q.popleft(); seen += 1
        for m in adj[n]:
            indeg[m] -= 1
            if indeg[m] == 0:
                q.append(m)
    return seen != len(units)


def _pressure_warnings(units: list, streams: list, by_id: dict) -> list[dict]:
    """L3: flag obvious pressure mismatches along hydrogen/CO₂ streams."""
    out: list[dict] = []
    for s in streams:
        tu = by_id.get(s["target"]["unit_id"])
        su = by_id.get(s["source"]["unit_id"])
        if not tu or not su:
            continue
        s_oc, t_oc = _oc(su), _oc(tu)
        # compressor → tank: tank max pressure should meet the compressor outlet
        if su.get("equipment_type") in ("compressor", "co2_compressor") and tu.get("equipment_type") in ("h2_tank",):
            p_out = s_oc.get("target_pressure_bar")
            p_max = t_oc.get("max_pressure_bar")
            if p_out and p_max and p_out > p_max + 1e-6:
                out.append(_issue("pressure_mismatch",
                                  f"Compressor outlet ({p_out} bar) exceeds the tank's max pressure ({p_max} bar).",
                                  stream_id=s.get("id")))
    return out

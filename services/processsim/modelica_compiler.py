"""
modelica_compiler.py
====================
The Flowsheet compiler (ADR-0004, Phase 5): turns a Process graph into a system
Modelica model against the OTDBComponents library, then drives OpenModelica
(via OMPython) to simulate it and return per-Unit results, Stream states, and
KPIs — the same result shape as the steady-state engine, plus dynamic traces.

Each Unit becomes an OTDBComponents block instance parameterised from its
operating conditions and composed Catalogue Technology; each Stream becomes a
``connect(...)`` between the Ports (named identically in the library). Any
undriven input Port is tied to a Zero source so the flattened model is balanced.

If OpenModelica (or its C toolchain) is unavailable, ``simulate`` raises and the
caller (main.py) falls back to the steady-state engine.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any, Callable

from components import H2_HHV_KWH_PER_KG as HHV_KWH_PER_KG
from solver import finish

log = logging.getLogger("processsim.modelica")

MODELICA_DIR = Path(__file__).parent / "modelica"
LIB_FILE = MODELICA_DIR / "OTDBComponents.mo"

_OMHOME = os.getenv("OPENMODELICAHOME", r"C:\Program Files\OpenModelica1.26.3-64bit")


def _mid(s: str) -> str:
    """Sanitise an id into a valid Modelica identifier."""
    x = re.sub(r"[^A-Za-z0-9_]", "_", str(s))
    return x if re.match(r"^[A-Za-z_]", x) else "u_" + x


def _fmt(v: float) -> str:
    return repr(float(v))


def _pick(oc: dict, tech: dict, oc_key: str, tech_key: str | None, default: float) -> float:
    v = oc.get(oc_key)
    if v is None and tech_key:
        v = tech.get(tech_key)
    try:
        return float(v) if v is not None else float(default)
    except (TypeError, ValueError):
        return float(default)


# equipment_type → (Modelica class, params(oc, tech) -> {modelica_param: value})
MODELICA_MAP: dict[str, tuple[str, Callable[[dict, dict], dict]]] = {
    "power_source": ("PowerSource", lambda oc, tech: {
        "capacity_kw": _pick(oc, tech, "capacity_kw", "capacity_kw", 10000),
        "capacity_factor": _pick(oc, tech, "capacity_factor", None, 1)}),
    "water_source": ("WaterSource", lambda oc, tech: {}),
    "flue_gas_source": ("FlueGasSource", lambda oc, tech: {
        "capacity_kw": _pick(oc, tech, "capacity_kw", None, 400000),
        "capacity_factor": _pick(oc, tech, "capacity_factor", None, 1),
        "co2_emission_kg_kwh": _pick(oc, tech, "co2_emission_kg_kwh", None, 0.35)}),
    "biomass_source": ("BiomassSource", lambda oc, tech: {
        "fuel_input_kw": _pick(oc, tech, "fuel_input_kw", "capacity_kw", 20000),
        "capacity_factor": _pick(oc, tech, "capacity_factor", None, 1)}),
    "co2_source": ("CO2Source", lambda oc, tech: {
        "co2_supply_kg_h": _pick(oc, tech, "co2_supply_kg_h", None, 1000),
        "pressure_bar": _pick(oc, tech, "pressure_bar", None, 1.5)}),
    "electrolyzer_pem": ("ElectrolyzerPEM", lambda oc, tech: {
        "efficiency": _pick(oc, tech, "nominal_efficiency_pct_hhv", "efficiency_pct", 70) / 100.0}),
    "compressor": ("Compressor", lambda oc, tech: {
        "target_pressure_bar": _pick(oc, tech, "target_pressure_bar", None, 350),
        "isentropic_efficiency": _pick(oc, tech, "isentropic_efficiency", None, 0.78)}),
    "fuel_cell_pem": ("FuelCellPEM", lambda oc, tech: {
        "efficiency": _pick(oc, tech, "nominal_efficiency_pct", "efficiency_pct", 58) / 100.0}),
    "co2_absorber_amine": ("CO2AbsorberAmine", lambda oc, tech: {
        "capture_rate": _pick(oc, tech, "capture_rate_pct", None, 90) / 100.0,
        "energy_requirement_gj_tco2": _pick(oc, tech, "energy_requirement_gj_tco2", None, 3.7)}),
    "solvent_stripper": ("SolventStripper", lambda oc, tech: {
        "reboiler_temp_c": _pick(oc, tech, "reboiler_temp_c", None, 120)}),
    "co2_compressor": ("CO2Compressor", lambda oc, tech: {
        "target_pressure_bar": _pick(oc, tech, "target_pressure_bar", None, 110)}),
    "h2_tank": ("H2Tank", lambda oc, tech: {
        "max_pressure_bar": _pick(oc, tech, "max_pressure_bar", None, 350),
        "round_trip_efficiency": _pick(oc, tech, "round_trip_efficiency_pct", None, 99) / 100.0}),
    "co2_geological_storage": ("CO2GeologicalStorage", lambda oc, tech: {}),
    "grid_sink": ("GridSink", lambda oc, tech: {}),
    "biomass_chp": ("BiomassCHP", lambda oc, tech: {
        "electrical_efficiency": _pick(oc, tech, "electrical_efficiency_pct", "efficiency_pct", 30) / 100.0,
        "thermal_efficiency": _pick(oc, tech, "thermal_efficiency_pct", None, 55) / 100.0}),
    "anaerobic_digester": ("AnaerobicDigester", lambda oc, tech: {
        "biogas_yield": _pick(oc, tech, "biogas_yield_pct", None, 60) / 100.0,
        "methane_content": _pick(oc, tech, "methane_content_pct", None, 60) / 100.0}),
    "biogas_upgrader": ("BiogasUpgrader", lambda oc, tech: {
        "methane_recovery": _pick(oc, tech, "methane_recovery_pct", None, 98) / 100.0,
        "delivery_pressure_bar": _pick(oc, tech, "delivery_pressure_bar", None, 8)}),
    "methanation_reactor": ("MethanationReactor", lambda oc, tech: {
        "conversion": _pick(oc, tech, "conversion_efficiency_pct", None, 80) / 100.0,
        "delivery_pressure_bar": _pick(oc, tech, "delivery_pressure_bar", None, 8)}),
    "heat_sink": ("HeatSink", lambda oc, tech: {}),
    "gas_grid_sink": ("GasGridSink", lambda oc, tech: {}),
}

# Unit results read back per Modelica class: (Modelica var, result key, rounding).
# Keys and rounding mirror components.py so both engines return the same shape;
# rounding may instead be a callable mapping the raw value.
RESULT_VARS: dict[str, list[tuple[str, str, Any]]] = {
    "PowerSource":      [("power_out", "power_kw", 1)],
    "WaterSource":      [],
    "FlueGasSource":    [("flue_out", "co2_generated_kg_h", 1), ("capacity_kw", "capacity_kw", 1),
                         ("capacity_factor", "capacity_factor", 2)],
    "BiomassSource":    [("biomass_out", "fuel_input_kw", 1), ("biomass_out_biomass_kg_h", "biomass_kg_h", 1),
                         ("capacity_factor", "capacity_factor", 2)],
    "CO2Source":        [("co2_out", "co2_kg_h", 1)],
    "ElectrolyzerPEM":  [("power_in", "power_in_kw", 1), ("h2_out", "h2_kg_h", 2),
                         ("efficiency_pct", "efficiency_pct", 1), ("water_kg_h", "water_kg_h", 1)],
    "Compressor":       [("power_kw", "power_kw", 1), ("target_pressure_bar", "outlet_pressure_bar", 1),
                         ("h2_out", "h2_kg_h", 2)],
    "FuelCellPEM":      [("power_out", "power_kw", 1), ("efficiency_pct", "efficiency_pct", 1),
                         ("h2_in", "h2_kg_h", 2)],
    "CO2AbsorberAmine": [("co2_rich_out", "co2_captured_kg_h", 1), ("capture_rate_pct", "capture_rate_pct", 1),
                         ("reboiler_duty_kw", "reboiler_duty_kw", 1)],
    "SolventStripper":  [("co2_pure_out", "co2_kg_h", 1), ("reboiler_temp_c", "reboiler_temp_c", 1)],
    "CO2Compressor":    [("power_kw", "power_kw", 1), ("target_pressure_bar", "outlet_pressure_bar", 1),
                         ("co2_out", "co2_kg_h", 1)],
    "BiomassCHP":       [("power_out", "power_kw", 1), ("heat_out", "heat_kw", 1),
                         ("electrical_efficiency_pct", "electrical_efficiency_pct", 1),
                         ("total_efficiency_pct", "total_efficiency_pct", 1)],
    "AnaerobicDigester": [("biogas_out", "biogas_kw", 1), ("methane_content_pct", "methane_content_pct", 1)],
    "BiogasUpgrader":   [("gas_out", "biomethane_kw", 1), ("co2_out", "co2_removed_kg_h", 1),
                         ("methane_recovery_pct", "methane_recovery_pct", 1)],
    "MethanationReactor": [("gas_out_ch4_kg_h", "ch4_kg_h", 2), ("gas_out", "ch4_kw", 1),
                           ("conversion_pct", "conversion_pct", 1),
                           ("limited_by_h2", "limiting_reactant", lambda v: "H2" if v > 0.5 else "CO2")],
    "H2Tank":           [("h2_in", "throughput_kg_h", 2),
                         ("round_trip_efficiency_pct", "round_trip_efficiency_pct", 1),
                         ("level_kg", "level_kg", 3)],
    "CO2GeologicalStorage": [("injected_kg_h", "injected_kg_h", 1), ("injected_mtco2_yr", "injected_mtco2_yr", 4)],
    "GridSink":         [("power_kw", "power_kw", 1)],
    "HeatSink":         [("heat_kw", "heat_kw", 1)],
    "GasGridSink":      [("methane_kw", "methane_kw", 1), ("ch4_kg_h", "ch4_kg_h", 2)],
}

# The quantity a port's connector carries, by carrier (the Stream state key).
PRIMARY: dict[str, str] = {
    "electricity": "power_kw", "hydrogen": "h2_kg_h", "co2": "co2_kg_h",
    "flue_gas": "co2_kg_h", "biomass": "fuel_kw", "biogas": "biogas_kw",
    "methane": "ch4_kw", "heat": "heat_kw", "steam": "heat_kw", "water": "water_kg_h",
}

# Extra Stream-state fields an out-port exposes as <port>_<field> variables.
OUT_EXTRAS: dict[str, dict[str, list[str]]] = {
    "FlueGasSource":      {"flue_out": ["flue_kw"]},
    "BiomassSource":      {"biomass_out": ["biomass_kg_h"]},
    "CO2Source":          {"co2_out": ["pressure_bar"]},
    "ElectrolyzerPEM":    {"h2_out": ["pressure_bar"]},
    "Compressor":         {"h2_out": ["pressure_bar"]},
    "SolventStripper":    {"co2_pure_out": ["pressure_bar"]},
    "CO2Compressor":      {"co2_out": ["pressure_bar"]},
    "AnaerobicDigester":  {"biogas_out": ["methane_frac"]},
    "BiogasUpgrader":     {"gas_out": ["ch4_kg_h", "pressure_bar"]},
    "MethanationReactor": {"gas_out": ["ch4_kg_h", "pressure_bar"]},
    "H2Tank":             {"h2_out": ["pressure_bar"]},
}


def _unwrap_oc(oc: dict | None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, pv in (oc or {}).items():
        out[k] = pv.get("value") if isinstance(pv, dict) else pv
    return out


def build_system_model(graph: dict, tech_resolver: Callable[[str | None], dict] | None = None,
                       model_name: str = "FlowSystem") -> tuple[str, dict[str, str]]:
    """Generate the system Modelica model text from a Process graph.

    Returns (model_source, unit_id → {"inst": instance_name, "class": class}).
    """
    resolve = tech_resolver or (lambda ref: {})
    units = graph.get("units", [])
    streams = graph.get("streams", [])

    decls: list[str] = []
    conns: list[str] = []
    meta: dict[str, dict] = {}

    missing = sorted({u.get("equipment_type") for u in units} - MODELICA_MAP.keys(), key=str)
    if missing:
        raise ValueError("No Modelica model for equipment type(s): " + ", ".join(map(str, missing)))

    for u in units:
        cls, param_fn = MODELICA_MAP[u.get("equipment_type")]
        name = "u_" + _mid(u["id"])
        oc = _unwrap_oc(u.get("operating_conditions"))
        tech = resolve(u.get("technology_ref"))
        params = param_fn(oc, tech)
        mods = ", ".join(f"{k}={_fmt(v)}" for k, v in params.items())
        decls.append(f"  OTDBComponents.{cls} {name}{('(' + mods + ')') if mods else ''};")
        meta[u["id"]] = {"inst": name, "class": cls}

    driven: set[tuple[str, str]] = set()
    for s in streams:
        su, sp = s["source"]["unit_id"], s["source"]["port_id"]
        tu, tp = s["target"]["unit_id"], s["target"]["port_id"]
        if su in meta and tu in meta:
            conns.append(f"  connect({meta[su]['inst']}.{_mid(sp)}, {meta[tu]['inst']}.{_mid(tp)});")
            driven.add((tu, tp))

    # Tie any undriven input Port to a Zero source so the model is balanced.
    z = 0
    for u in units:
        for p in u.get("ports", []):
            if p.get("direction") == "in" and (u["id"], p["id"]) not in driven:
                zn = f"zero{z}"; z += 1
                decls.append(f"  OTDBComponents.Zero {zn};")
                conns.append(f"  connect({zn}.y, {meta[u['id']]['inst']}.{_mid(p['id'])});")

    src = (f"model {model_name}\n" + "\n".join(decls) +
           "\nequation\n" + "\n".join(conns) + f"\nend {model_name};\n")
    return src, meta


# ── OpenModelica session ─────────────────────────────────────────────────────

def _session():
    # Windows: point at the bundled toolchain and use gcc (the bundled clang
    # doesn't resolve on this install's compile PATH). Linux/containers: omc is
    # on PATH and OPENMODELICAHOME is set by the package — leave the env alone.
    om = os.environ.get("OPENMODELICAHOME") or _OMHOME
    is_windows = os.name == "nt"
    if is_windows and Path(om).exists():
        os.environ["OPENMODELICAHOME"] = om
        os.environ["PATH"] = ";".join([
            om + r"\bin", om + r"\tools\msys\ucrt64\bin",
            om + r"\tools\msys\usr\bin", os.environ.get("PATH", ""),
        ])
    from OMPython import OMCSessionZMQ
    omc = OMCSessionZMQ()
    if is_windows:
        omc.sendExpression('setCompiler("gcc")')
    return omc


def check_models(graph: dict, tech_resolver=None) -> dict:
    """Front-end verification (parse + flatten) — no C compilation. Returns
    {'library_ok', 'system_ok', 'messages'}. Usable where the C toolchain is
    blocked, to prove the generated Modelica is structurally valid."""
    omc = _session()
    lib_load = omc.sendExpression(f'loadFile("{LIB_FILE.as_posix()}")')
    src, _ = build_system_model(graph, tech_resolver)
    sys_load = omc.sendExpression('loadString("' + src.replace("\\", "\\\\").replace('"', '\\"') + '")')
    check = omc.sendExpression("checkModel(FlowSystem)")
    return {"library_ok": bool(lib_load), "system_loaded": bool(sys_load),
            "check": check, "errors": omc.sendExpression("getErrorString()")}


def simulate(graph: dict, tech_resolver=None, stop_time: float = 3600.0,
             intervals: int = 25, omc=None) -> dict:
    """Compile and simulate the Process with OpenModelica. Raises on any failure
    so the caller can fall back to the steady-state engine. Pass ``omc`` to reuse
    a warm session (see :class:`ModelicaEngine`)."""
    if omc is None:
        omc = _session()
    import tempfile
    workdir = Path(tempfile.mkdtemp(prefix="otdbsim_")).as_posix()
    omc.sendExpression(f'cd("{workdir}")')   # keep artifacts out of the repo
    if not omc.sendExpression(f'loadFile("{LIB_FILE.as_posix()}")'):
        raise RuntimeError("Could not load OTDBComponents library: " + str(omc.sendExpression("getErrorString()")))
    src, meta = build_system_model(graph, tech_resolver)
    if not omc.sendExpression('loadString("' + src.replace("\\", "\\\\").replace('"', '\\"') + '")'):
        raise RuntimeError("Could not load system model: " + str(omc.sendExpression("getErrorString()")))

    res = omc.sendExpression(f"simulate(FlowSystem, stopTime={stop_time}, numberOfIntervals={intervals})")
    rf = res.get("resultFile") if isinstance(res, dict) else None
    if not rf:
        raise RuntimeError("Simulation failed: " + (res.get("messages", "") if isinstance(res, dict) else str(res)))

    def _final(inst: str, var: str) -> float:
        v = omc.sendExpression(f'val({inst}.{var}, {stop_time}, "{rf}")')
        if not isinstance(v, (int, float)):
            raise RuntimeError(f"Could not read {inst}.{var}: {omc.sendExpression('getErrorString()')}")
        return float(v)

    units_out: dict[str, dict] = {}
    for uid, m in meta.items():
        units_out[uid] = {rk: (nd(_final(m["inst"], mv)) if callable(nd) else round(_final(m["inst"], mv), nd))
                          for mv, rk, nd in RESULT_VARS[m["class"]]}

    # Stream states from the source Port's final value, keyed like components.py.
    ports = {(u["id"], p["id"]): p.get("carrier") for u in graph.get("units", []) for p in u.get("ports", [])}
    stream_state: dict[str, dict] = {}
    for s in graph.get("streams", []):
        su, sp = s["source"]["unit_id"], s["source"]["port_id"]
        carrier = ports.get((su, sp)) or s.get("carrier")
        inst, cls = meta[su]["inst"], meta[su]["class"]
        if carrier == "water":
            stream_state[s["id"]] = {"carrier": carrier, "water_kg_h": None}
            continue
        st = {"carrier": carrier, PRIMARY.get(carrier, "value"): _final(inst, _mid(sp))}
        for field in OUT_EXTRAS.get(cls, {}).get(sp, []):
            st[field] = _final(inst, f"{_mid(sp)}_{field}")
        if carrier == "hydrogen":
            st["power_kw"] = st["h2_kg_h"] * HHV_KWH_PER_KG
        stream_state[s["id"]] = st

    # Dynamic traces — the whole point of the Modelica engine over steady-state.
    # H2Tank carries a real state (level_kg); sample it over time with val()
    # (robust; the same call used for the unit results). Non-fatal.
    trace_vars = [(f"{m['inst']}.level_kg", f"{uid} level", "kg")
                  for uid, m in meta.items() if m["class"] == "H2Tank"]
    time_series = None
    if trace_vars:
        try:
            n = max(2, intervals + 1)
            times = [stop_time * i / (n - 1) for i in range(n)]
            series = []
            for var, lbl, unit in trace_vars:
                pts = [omc.sendExpression(f'val({var}, {t}, "{rf}")') for t in times]
                series.append({"name": lbl, "unit": unit,
                               "data": [round(float(x), 3) for x in pts]})
            time_series = {"time_s": [round(t, 1) for t in times], "series": series}
        except Exception as exc:  # noqa: BLE001 — traces are a bonus, never fatal
            log.warning("Could not read dynamic traces: %s", exc)

    result = finish(graph, units_out, stream_state, engine="openmodelica")
    result["time_series"] = time_series
    return result


# ── Warm, reusable engine + kill (for the job worker, ADR-0005) ──────────────

def _omc_pids() -> set[int]:
    try:
        import psutil
        return {p.pid for p in psutil.process_iter(["name"])
                if (p.info.get("name") or "").lower() == "omc.exe"}
    except Exception:  # noqa: BLE001
        return set()


def _kill_tree(pid: int) -> None:
    try:
        import psutil
        proc = psutil.Process(pid)
        for child in proc.children(recursive=True):
            try: child.kill()
            except Exception: pass  # noqa: BLE001,E701
        proc.kill()
    except Exception:  # noqa: BLE001
        pass


class ModelicaEngine:
    """A warm OpenModelica engine: one session serves many simulations without
    re-paying session startup. ``kill()`` aborts a running simulation (killing the
    omc/compiler process tree) and drops the session so the next call rebuilds it."""

    def __init__(self):
        self._omc = None
        self._pids: set[int] = set()

    def _ensure(self):
        if self._omc is None:
            before = _omc_pids()
            self._omc = _session()
            self._pids = _omc_pids() - before
        return self._omc

    def simulate(self, graph: dict, tech_resolver=None, stop_time: float = 3600.0,
                 intervals: int = 25) -> dict:
        try:
            return simulate(graph, tech_resolver, stop_time, intervals, omc=self._ensure())
        except Exception:
            # A failed/killed run can leave the session unusable — reset it.
            self._omc = None
            raise

    def kill(self) -> None:
        for pid in list(self._pids):
            _kill_tree(pid)
        self._omc = None
        self._pids = set()

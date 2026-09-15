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
        "capacity_kw": _pick(oc, tech, "capacity_kw", "capacity_kw", 400000),
        "co2_emission_kg_kwh": _pick(oc, tech, "co2_emission_kg_kwh", None, 0.35)}),
    "electrolyzer_pem": ("ElectrolyzerPEM", lambda oc, tech: {
        "efficiency": _pick(oc, tech, "nominal_efficiency_pct_hhv", "efficiency_pct", 70) / 100.0}),
    "compressor": ("Compressor", lambda oc, tech: {
        "target_pressure_bar": _pick(oc, tech, "target_pressure_bar", None, 350),
        "isentropic_efficiency": _pick(oc, tech, "isentropic_efficiency", None, 0.78)}),
    "fuel_cell_pem": ("FuelCellPEM", lambda oc, tech: {
        "efficiency": _pick(oc, tech, "nominal_efficiency_pct", "efficiency_pct", 58) / 100.0}),
    "co2_absorber_amine": ("CO2AbsorberAmine", lambda oc, tech: {
        "capture_rate": _pick(oc, tech, "capture_rate_pct", None, 90) / 100.0}),
    "solvent_stripper": ("SolventStripper", lambda oc, tech: {
        "reboiler_temp_c": _pick(oc, tech, "reboiler_temp_c", None, 120)}),
    "co2_compressor": ("CO2Compressor", lambda oc, tech: {
        "target_pressure_bar": _pick(oc, tech, "target_pressure_bar", None, 110)}),
    "h2_tank": ("H2Tank", lambda oc, tech: {
        "max_pressure_bar": _pick(oc, tech, "max_pressure_bar", None, 350),
        "round_trip_efficiency": _pick(oc, tech, "round_trip_efficiency_pct", None, 99) / 100.0}),
    "co2_geological_storage": ("CO2GeologicalStorage", lambda oc, tech: {}),
    "grid_sink": ("GridSink", lambda oc, tech: {}),
}

# Unit-result variables to read back per Modelica class (Modelica var → result key).
RESULT_VARS: dict[str, dict[str, str]] = {
    "PowerSource":      {"power_out": "power_kw"},
    "ElectrolyzerPEM":  {"h2_out": "h2_kg_h", "water_kg_h": "water_kg_h"},
    "Compressor":       {"power_kw": "power_kw", "h2_out": "h2_kg_h"},
    "FuelCellPEM":      {"power_out": "power_kw"},
    "CO2AbsorberAmine": {"co2_rich_out": "co2_captured_kg_h"},
    "SolventStripper":  {"co2_pure_out": "co2_kg_h"},
    "CO2Compressor":    {"power_kw": "power_kw", "co2_out": "co2_kg_h"},
    "H2Tank":           {"h2_out": "h2_kg_h", "level_kg": "level_kg"},
    "CO2GeologicalStorage": {"injected_kg_h": "injected_kg_h"},
    "GridSink":         {"power_kw": "power_kw"},
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

    for u in units:
        et = u.get("equipment_type")
        entry = MODELICA_MAP.get(et)
        if not entry:
            continue   # unmodelled equipment is skipped (its streams are dropped)
        cls, param_fn = entry
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
        if u["id"] not in meta:
            continue
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

    def _final(var: str):
        v = omc.sendExpression(f'val({meta_inst}.{var}, {stop_time}, "{rf}")')
        return round(float(v), 3) if isinstance(v, (int, float)) else None

    units_out: dict[str, dict] = {}
    for uid, m in meta.items():
        meta_inst = m["inst"]
        res_map = RESULT_VARS.get(m["class"], {})
        units_out[uid] = {rk: _final(mv) for mv, rk in res_map.items()}

    # KPIs mirror the steady-state engine.
    def _sum(cls_key, rk):
        return round(sum((units_out[uid].get(rk) or 0)
                         for uid, m in meta.items() if m["class"] == cls_key), 1)
    power_in = _sum("PowerSource", "power_kw")
    power_out = _sum("GridSink", "power_kw") or _sum("FuelCellPEM", "power_kw")
    h2 = _sum("ElectrolyzerPEM", "h2_kg_h")
    co2 = _sum("CO2AbsorberAmine", "co2_captured_kg_h")
    kpi: dict[str, Any] = {}
    if power_in: kpi["source_power_kw"] = power_in
    if power_out: kpi["output_power_kw"] = power_out
    if power_in and power_out: kpi["round_trip_efficiency_pct"] = round(power_out / power_in * 100, 1)
    if h2: kpi["h2_production_kg_h"] = h2
    if co2:
        kpi["co2_captured_kg_h"] = co2
        kpi["co2_captured_mtco2_yr"] = round(co2 * 8760 / 1e9, 4)

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

    return {"units": units_out, "streams": {}, "kpi": kpi,
            "engine": "openmodelica", "time_series": time_series}


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

"""
components.py
=============
Steady-state component models for the Process simulation engine (ADR-0004,
Phase 3). Each equipment_type maps to a function:

    fn(unit, inlets, oc, tech) -> (outlets, result)

  inlets  : {port_id: StreamState}   — resolved upstream stream states
  oc      : {key: number}            — operating conditions (setpoints), unwrapped
  tech    : {efficiency_pct, capacity_kw, …} — the composed Catalogue Technology's
            params (Phase 5); used as defaults, overridden by operating conditions
  outlets : {port_id: StreamState}   — states written onto this unit's out-streams
  result  : {…}                      — per-unit KPIs surfaced to the UI

A StreamState is a plain dict carrying the carrier and the quantity relevant to
it (power_kw for electricity, h2_kg_h for hydrogen, co2_kg_h for CO₂, …).

This is a deliberately simple analytical model. It runs anywhere (no
OpenModelica), reproduces the H₂ and CCS seed Processes, and is the fallback the
Modelica Component library (a later phase) will supersede for dynamics.
"""

from __future__ import annotations

import math
from typing import Any, Callable

H2_HHV_KWH_PER_KG = 39.4          # higher heating value of hydrogen
WATER_KG_PER_KG_H2 = 9.0          # stoichiometric electrolysis water demand
CO2_EMISSION_KG_PER_KWH = 0.35    # default flue-gas CO₂ intensity (gas-like)
BIOMASS_LHV_KWH_PER_KG = 4.9      # wood chips ~18 MJ/kg (as-received)
CH4_LHV_KWH_PER_KG = 13.9         # methane lower heating value (~50 MJ/kg)
# Sabatier (CO₂ + 4 H₂ → CH₄ + 2 H₂O), molar masses in kg/mol
_M_H2, _M_CO2, _M_CH4 = 0.002016, 0.04401, 0.016043

State = dict[str, Any]


def _st(carrier: str, **q) -> State:
    return {"carrier": carrier, **q}


def _num(oc: dict, key: str, default: float) -> float:
    v = oc.get(key)
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


# ── Sources ──────────────────────────────────────────────────────────────────

def power_source(unit, inlets, oc, tech):
    cap = _num(oc, "capacity_kw", tech.get("capacity_kw") or 10000.0)
    cf  = _num(oc, "capacity_factor", 1.0)
    p   = cap * cf
    return {"power_out": _st("electricity", power_kw=p)}, {"power_kw": round(p, 1)}


def water_source(unit, inlets, oc, tech):
    # Availability node; downstream demand is computed by the consumer.
    return {"water_out": _st("water", water_kg_h=None)}, {}


def flue_gas_source(unit, inlets, oc, tech):
    cap = _num(oc, "capacity_kw", 400000.0)
    ef  = _num(oc, "co2_emission_kg_kwh", CO2_EMISSION_KG_PER_KWH)
    co2 = cap * ef
    return (
        {"flue_out": _st("flue_gas", co2_kg_h=co2, flue_kw=cap)},
        {"co2_generated_kg_h": round(co2, 1), "capacity_kw": round(cap, 1)},
    )


# ── Conversion ───────────────────────────────────────────────────────────────

def electrolyzer_pem(unit, inlets, oc, tech):
    p_in = (inlets.get("power_in") or {}).get("power_kw", _num(oc, "capacity_kw", tech.get("capacity_kw") or 1000.0))
    eff  = _num(oc, "nominal_efficiency_pct_hhv", tech.get("efficiency_pct") or 70.0) / 100.0
    h2   = p_in * eff / H2_HHV_KWH_PER_KG          # kg/h
    water = h2 * WATER_KG_PER_KG_H2
    return (
        {"h2_out": _st("hydrogen", h2_kg_h=h2, power_kw=h2 * H2_HHV_KWH_PER_KG, pressure_bar=30)},
        {"power_in_kw": round(p_in, 1), "h2_kg_h": round(h2, 2),
         "efficiency_pct": round(eff * 100, 1), "water_kg_h": round(water, 1)},
    )


def compressor(unit, inlets, oc, tech):
    h2 = (inlets.get("h2_in") or {}).get("h2_kg_h", 0.0)
    p_out = _num(oc, "target_pressure_bar", 350.0)
    eta   = _num(oc, "isentropic_efficiency", 0.78)
    spec  = 0.5 * math.log(max(p_out, 2.0)) / max(eta, 0.1)   # kWh/kg (analytical)
    power = spec * h2
    return (
        {"h2_out": _st("hydrogen", h2_kg_h=h2, power_kw=h2 * H2_HHV_KWH_PER_KG, pressure_bar=p_out)},
        {"power_kw": round(power, 1), "outlet_pressure_bar": round(p_out, 1), "h2_kg_h": round(h2, 2)},
    )


def fuel_cell_pem(unit, inlets, oc, tech):
    h2  = (inlets.get("h2_in") or {}).get("h2_kg_h", 0.0)
    eff = _num(oc, "nominal_efficiency_pct", tech.get("efficiency_pct") or 58.0) / 100.0
    power = h2 * H2_HHV_KWH_PER_KG * eff
    return (
        {"power_out": _st("electricity", power_kw=power)},
        {"power_kw": round(power, 1), "efficiency_pct": round(eff * 100, 1), "h2_kg_h": round(h2, 2)},
    )


def co2_absorber_amine(unit, inlets, oc, tech):
    co2_in = (inlets.get("flue_in") or {}).get("co2_kg_h", 0.0)
    rate   = _num(oc, "capture_rate_pct", 90.0) / 100.0
    captured = co2_in * rate
    energy_gj = _num(oc, "energy_requirement_gj_tco2", 3.7)
    return (
        {"co2_rich_out": _st("co2", co2_kg_h=captured)},
        {"co2_captured_kg_h": round(captured, 1), "capture_rate_pct": round(rate * 100, 1),
         "reboiler_duty_kw": round(captured / 1000 * energy_gj * 1e6 / 3600, 1)},
    )


def solvent_stripper(unit, inlets, oc, tech):
    co2 = (inlets.get("co2_rich_in") or {}).get("co2_kg_h", 0.0)
    return (
        {"co2_pure_out": _st("co2", co2_kg_h=co2, pressure_bar=1.5)},
        {"co2_kg_h": round(co2, 1), "reboiler_temp_c": _num(oc, "reboiler_temp_c", 120.0)},
    )


def co2_compressor(unit, inlets, oc, tech):
    co2 = (inlets.get("co2_in") or {}).get("co2_kg_h", 0.0)
    p_out = _num(oc, "target_pressure_bar", 110.0)
    spec  = 0.02 * math.log(max(p_out, 2.0))     # kWh/kg
    power = spec * co2
    return (
        {"co2_out": _st("co2", co2_kg_h=co2, pressure_bar=p_out)},
        {"power_kw": round(power, 1), "outlet_pressure_bar": round(p_out, 1), "co2_kg_h": round(co2, 1)},
    )


# ── Bioenergy + power-to-gas ─────────────────────────────────────────────────

def biomass_source(unit, inlets, oc, tech):
    fuel = _num(oc, "fuel_input_kw", tech.get("capacity_kw") or 20000.0)   # LHV thermal
    return (
        {"biomass_out": _st("biomass", fuel_kw=fuel, biomass_kg_h=fuel / BIOMASS_LHV_KWH_PER_KG)},
        {"fuel_input_kw": round(fuel, 1), "biomass_kg_h": round(fuel / BIOMASS_LHV_KWH_PER_KG, 1)},
    )


def co2_source(unit, inlets, oc, tech):
    co2 = _num(oc, "co2_supply_kg_h", 1000.0)
    return {"co2_out": _st("co2", co2_kg_h=co2, pressure_bar=_num(oc, "pressure_bar", 1.5))}, \
           {"co2_kg_h": round(co2, 1)}


def biomass_chp(unit, inlets, oc, tech):
    fuel = (inlets.get("biomass_in") or {}).get("fuel_kw", 0.0)
    eta_el = _num(oc, "electrical_efficiency_pct", tech.get("efficiency_pct") or 30.0) / 100.0
    eta_th = _num(oc, "thermal_efficiency_pct", 55.0) / 100.0
    power, heat = fuel * eta_el, fuel * eta_th
    return (
        {"power_out": _st("electricity", power_kw=power),
         "heat_out": _st("heat", heat_kw=heat)},
        {"power_kw": round(power, 1), "heat_kw": round(heat, 1),
         "electrical_efficiency_pct": round(eta_el * 100, 1),
         "total_efficiency_pct": round((eta_el + eta_th) * 100, 1)},
    )


def anaerobic_digester(unit, inlets, oc, tech):
    fuel = (inlets.get("biomass_in") or {}).get("fuel_kw", 0.0)
    yield_pct = _num(oc, "biogas_yield_pct", 60.0) / 100.0     # energy → biogas
    ch4_frac = _num(oc, "methane_content_pct", 60.0) / 100.0   # raw biogas CH₄ share
    biogas = fuel * yield_pct
    return (
        {"biogas_out": _st("biogas", biogas_kw=biogas, methane_frac=ch4_frac)},
        {"biogas_kw": round(biogas, 1), "methane_content_pct": round(ch4_frac * 100, 1)},
    )


def biogas_upgrader(unit, inlets, oc, tech):
    biogas = (inlets.get("biogas_in") or {}).get("biogas_kw", 0.0)
    recovery = _num(oc, "methane_recovery_pct", 98.0) / 100.0
    ch4 = biogas * recovery                                    # biomethane energy out
    # CO₂ removed: crude mass estimate from the non-CH₄ balance of raw biogas
    co2 = biogas * 0.20 / CH4_LHV_KWH_PER_KG * (_M_CO2 / _M_CH4) * 10
    return (
        {"gas_out": _st("methane", ch4_kw=ch4, pressure_bar=_num(oc, "delivery_pressure_bar", 8.0)),
         "co2_out": _st("co2", co2_kg_h=co2)},
        {"biomethane_kw": round(ch4, 1), "co2_removed_kg_h": round(co2, 1),
         "methane_recovery_pct": round(recovery * 100, 1)},
    )


def methanation_reactor(unit, inlets, oc, tech):
    h2 = (inlets.get("h2_in") or {}).get("h2_kg_h", 0.0)
    co2 = (inlets.get("co2_in") or {}).get("co2_kg_h", 0.0)
    conv = _num(oc, "conversion_efficiency_pct", 80.0) / 100.0
    # limiting reactant for CH₄: 4 mol H₂ or 1 mol CO₂ per mol CH₄
    ch4_from_h2 = (h2 / _M_H2) / 4.0
    ch4_from_co2 = co2 / _M_CO2
    ch4_mol = min(ch4_from_h2, ch4_from_co2) * conv
    ch4_kg = ch4_mol * _M_CH4
    ch4_kw = ch4_kg * CH4_LHV_KWH_PER_KG
    return (
        {"gas_out": _st("methane", ch4_kw=ch4_kw, ch4_kg_h=ch4_kg,
                        pressure_bar=_num(oc, "delivery_pressure_bar", 8.0))},
        {"ch4_kg_h": round(ch4_kg, 2), "ch4_kw": round(ch4_kw, 1),
         "conversion_pct": round(conv * 100, 1),
         "limiting_reactant": "H2" if ch4_from_h2 < ch4_from_co2 else "CO2"},
    )


def heat_sink(unit, inlets, oc, tech):
    heat = (inlets.get("heat_in") or {}).get("heat_kw", 0.0)
    return {}, {"heat_kw": round(heat, 1)}


def gas_grid_sink(unit, inlets, oc, tech):
    st = inlets.get("gas_in") or {}
    ch4 = st.get("ch4_kw", 0.0)
    return {}, {"methane_kw": round(ch4, 1), "ch4_kg_h": round(st.get("ch4_kg_h", 0.0) or 0.0, 2)}


# ── Storage / sinks ──────────────────────────────────────────────────────────

def h2_tank(unit, inlets, oc, tech):
    h2  = (inlets.get("h2_in") or {}).get("h2_kg_h", 0.0)
    rte = _num(oc, "round_trip_efficiency_pct", 99.0) / 100.0
    out = h2 * rte
    return (
        {"h2_out": _st("hydrogen", h2_kg_h=out, power_kw=out * H2_HHV_KWH_PER_KG,
                       pressure_bar=_num(oc, "max_pressure_bar", 350.0))},
        {"throughput_kg_h": round(h2, 2), "round_trip_efficiency_pct": round(rte * 100, 1)},
    )


def co2_geological_storage(unit, inlets, oc, tech):
    co2 = (inlets.get("co2_in") or {}).get("co2_kg_h", 0.0)
    return {}, {"injected_kg_h": round(co2, 1), "injected_mtco2_yr": round(co2 * 8760 / 1e9, 4)}


def grid_sink(unit, inlets, oc, tech):
    p = (inlets.get("power_in") or {}).get("power_kw", 0.0)
    return {}, {"power_kw": round(p, 1)}


def passthrough(unit, inlets, oc, tech):
    """Fallback for equipment types without a model yet — forwards the first inlet."""
    first = next(iter(inlets.values()), None)
    outs = {}
    for pid, port in [(p["id"], p) for p in unit.get("ports", []) if p.get("direction") == "out"]:
        if first:
            outs[pid] = dict(first, carrier=port["carrier"])
    return outs, {"note": "no model for equipment_type — passthrough"}


COMPONENTS: dict[str, Callable] = {
    "power_source":            power_source,
    "water_source":            water_source,
    "flue_gas_source":         flue_gas_source,
    "electrolyzer_pem":        electrolyzer_pem,
    "compressor":              compressor,
    "fuel_cell_pem":           fuel_cell_pem,
    "co2_absorber_amine":      co2_absorber_amine,
    "solvent_stripper":        solvent_stripper,
    "co2_compressor":          co2_compressor,
    "h2_tank":                 h2_tank,
    "co2_geological_storage":  co2_geological_storage,
    "grid_sink":               grid_sink,
    "biomass_source":          biomass_source,
    "co2_source":              co2_source,
    "biomass_chp":             biomass_chp,
    "anaerobic_digester":      anaerobic_digester,
    "biogas_upgrader":         biogas_upgrader,
    "methanation_reactor":     methanation_reactor,
    "heat_sink":               heat_sink,
    "gas_grid_sink":           gas_grid_sink,
}

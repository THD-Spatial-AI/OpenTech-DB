"""
adapters/calliope_adapter.py
============================
Translates OEO-aligned Technology / EquipmentInstance objects into the
YAML-compatible parameter dictionaries expected by Calliope.

Two output versions are supported via ``to_calliope(..., version=...)``:

* ``"0.6"`` (default) — the classic nested ``essentials`` / ``constraints`` /
  ``costs`` structure of Calliope 0.6.x.
  Reference: https://calliope.readthedocs.io/en/v0.6.9/
* ``"0.7"`` — the flat technology definition of Calliope 0.7:
  ``base_tech`` instead of ``parent``, ``flow_*`` parameter names, and
  costs as ``cost_*`` keys with ``{data, index, dims: costs}`` blocks.
  Reference: https://calliope.readthedocs.io/en/latest/migrating/

v0.6 → v0.7 key renames applied (per the official migration guide):

  energy_cap_max               → flow_cap_max
  energy_eff                   → flow_out_eff  (storage: flow_in_eff + flow_out_eff)
  energy_ramping               → flow_ramping
  energy_cap_min_use           → flow_out_min_relative
  energy_cap_per_storage_cap_max → flow_cap_per_storage_cap_max
  energy_eff_per_distance      → flow_out_eff_per_distance
  resource_eff                 → source_eff
  parasitic_eff                → flow_out_parasitic_eff
  resource_area_max            → area_use_max
  resource_area_per_energy_cap → area_use_per_flow_cap
  parent: supply_plus          → base_tech: supply       (class removed in 0.7)
  parent: conversion_plus      → base_tech: conversion   (class removed in 0.7)
  carrier                      → carrier_in + carrier_out (alias removed in 0.7)
  carrier_ratios               → flow_out_eff indexed over carriers
  costs.monetary.energy_cap    → cost_flow_cap    {data, index: monetary, dims: costs}
  costs.monetary.om_annual     → cost_om_annual   (same pattern)
  costs.monetary.om_prod       → cost_flow_out
  costs.monetary.om_con        → cost_flow_in
  costs.monetary.storage_cap   → cost_storage_cap
  costs.monetary.interest_rate → cost_interest_rate
  costs.co2.om_prod            → merged into cost_flow_out index [monetary, co2]
  resource: file=… / force_resource → dropped (0.7 loads timeseries via
  top-level ``data_tables``; a migration hint is left in ``opentech_note``)

Calliope technology parents handled
-------------------------------------
  supply          → PowerPlant (dispatchable)
  supply_plus     → VREPlant  (variable renewables with time-series resource)
  storage         → EnergyStorage
  transmission    → TransmissionLine
  conversion      → ConversionTechnology (single carrier-out)
  conversion_plus → ConversionTechnology with multiple output carriers

Parameter mapping table
-----------------------
All unit notes follow the Calliope 0.6.x reference.
``energy_cap_max`` and all capacity fields are in **kW** (not MW).
Costs are in the project currency (default EUR).

OEO / Database field                     Calliope key                          Notes
---------------------------------------  ------------------------------------  ----------------------------------------
inst.capacity_kw                  [kW]   constraints.energy_cap_max    [kW]   Direct 1:1
tech.max_capacity_mw              [MW]   constraints.energy_cap_max    [kW]   ×1000 unit conversion
inst.electrical_efficiency        [frac] constraints.energy_eff        [frac] Direct 1:1
inst.min_stable_generation        [frac] constraints.energy_cap_min_use[frac] Dispatchable plants only
inst.economic_lifetime_yr         [yr]   constraints.lifetime          [yr]   Direct 1:1
inst.ramp_up_rate             [%cap/min] constraints.energy_ramping [frac/h]  ÷100 × 60; stricter of up/down used
inst.ramp_down_rate           [%cap/min] constraints.energy_ramping [frac/h]  Same formula, min(up, down) wins
tech.loss_per_km              [frac/km]  constraints.energy_eff_per_dist[frac/km] 1 − loss_per_km
inst.capex_per_kw          [EUR/kW]      costs.monetary.energy_cap  [EUR/kW]  Calliope CAPEX cost key is 'energy_cap'
inst.opex_fixed_per_kw_yr  [EUR/kW/yr]  costs.monetary.om_annual   [EUR/kW]  Direct 1:1
inst.opex_variable_per_mwh [EUR/MWh]    costs.monetary.om_prod     [EUR/kWh] ÷1000 unit conversion
inst.co2_emission_factor   [tCO2/MWh]   costs.co2.om_prod          [tCO2/kWh] Separate 'co2' cost class ÷1000
inst.discount_rate         [frac]        costs.monetary.interest_rate[frac]   Direct 1:1

Storage-specific
-----------------------------
inst.electrical_efficiency        [frac]    constraints.energy_eff                    [frac]    One-way (charge or discharge)
tech.fleet_roundtrip_efficiency   [frac]    constraints.energy_eff                    [frac]    √rt_eff fallback
tech.fleet_energy_to_power_ratio  [h]       constraints.energy_cap_per_storage_cap_max[h⁻¹]    1 / E2P
tech.fleet_self_discharge_rate    [frac/h]  constraints.storage_loss                  [frac/h]  Direct 1:1
tech.fleet_dod_max                [frac]    constraints.storage_discharge_depth       [frac]    1 − dod_max
inst.capacity_kw × E2P_ratio      [kWh]     constraints.storage_cap_max               [kWh]     Derived
inst.initial_soc                  [frac]    constraints.storage_initial               [frac]    Direct 1:1
inst.capex_per_kwh                [EUR/kWh] costs.monetary.storage_cap                [EUR/kWh] Direct 1:1
inst.fuel_cost_per_mwh            [EUR/MWh] costs.monetary.om_con                     [EUR/kWh] ÷1000

VRE-specific (supply_plus)
-----------------------------
tech.force_resource               [bool]    constraints.force_resource                [bool]    Direct 1:1
tech.resource_efficiency          [frac]    constraints.resource_eff                  [frac]    Direct 1:1
tech.parasitic_efficiency         [frac]    constraints.parasitic_eff                 [frac]    Direct 1:1
tech.resource_area_max_m2         [m²]      constraints.resource_area_max             [m²]      Direct 1:1
tech.resource_area_per_kw         [m²/kW]   constraints.resource_area_per_energy_cap  [m²/kW]   Direct 1:1

Conversion-specific
-----------------------------
inst.fuel_cost_per_mwh            [EUR/MWh] costs.monetary.om_con                     [EUR/kWh] ÷1000

Usage example
-------------
>>> from schemas.models import PowerPlant
>>> from adapters.calliope_adapter import to_calliope
>>> import json, pathlib
>>> raw = json.loads(pathlib.Path("data/generation/generation_technologies.json").read_text())
>>> plant = PowerPlant.model_validate(raw["technologies"][0])
>>> calliope_dict = to_calliope(plant, instance_index=0)
>>> import yaml; print(yaml.dump(calliope_dict, sort_keys=False))
"""

from __future__ import annotations

from typing import Any

from schemas.models import (
    Technology,
    PowerPlant,
    VREPlant,
    EnergyStorage,
    TransmissionLine,
    ConversionTechnology,
    TechnologyCategory,
    EquipmentInstance,
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _val(param) -> float | None:
    """Safely extract the scalar value from a ParameterValue or None."""
    return param.value if param is not None else None


def _safe_str(v) -> str | None:
    return str(v) if v is not None else None


def _carrier_str(carriers: list) -> str | None:
    """Return the first carrier value as a string, or None."""
    return carriers[0].value if carriers else None


def _resolve_instance(tech: Technology, instance_index: int | None) -> EquipmentInstance | None:
    """Return the requested EquipmentInstance, or None if the technology has none."""
    if not tech.instances:
        return None
    if instance_index is None:
        return tech.instances[0]
    if instance_index < 0 or instance_index >= len(tech.instances):
        raise IndexError(
            f"instance_index {instance_index} out of range "
            f"(technology has {len(tech.instances)} instances)."
        )
    return tech.instances[instance_index]


def _ramp_fraction_per_hour(pct_per_min: float) -> float:
    """
    Convert a ramp rate expressed as '% of capacity per minute'
    to Calliope's 'fraction of capacity per hour' unit.
    """
    return (pct_per_min / 100.0) * 60.0


def _opex_var_eur_per_kwh(eur_per_mwh: float) -> float:
    """Convert variable O&M from EUR/MWh to EUR/kWh (Calliope om_prod unit)."""
    return eur_per_mwh / 1000.0


def _co2_t_per_kwh(t_per_mwh: float) -> float:
    """Convert CO2 factor from tCO2/MWh to tCO2/kWh (Calliope om_prod unit)."""
    return t_per_mwh / 1000.0


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def to_calliope(
    tech: Technology,
    *,
    instance_index: int | None = 0,
    cost_class: str = "monetary",
    version: str = "0.6",
) -> dict[str, Any]:
    """
    Translate a Technology and one EquipmentInstance into a Calliope
    technology configuration dictionary.

    Parameters
    ----------
    tech:
        An OEO-aligned Technology object.
    instance_index:
        Which EquipmentInstance to use (default: 0).  Pass ``None`` to use the
        first available instance.
    cost_class:
        Primary Calliope cost class name (default: ``monetary``).  A secondary
        ``co2`` cost class is generated automatically when CO2 emission data
        are present.
    version:
        Target Calliope version: ``"0.6"`` (default) or ``"0.7"``.

    Returns
    -------
    dict
        For ``version="0.6"``, a nested dict matching Calliope 0.6.x's
        ``techs.<name>`` YAML structure::

            {
              "essentials":  { "name": ..., "parent": ..., ... },
              "constraints": { "energy_cap_max": ..., "energy_eff": ..., ... },
              "costs":       { "monetary": { "energy_cap": ..., ... }, ... }
            }

        For ``version="0.7"``, a flat dict matching Calliope 0.7's
        technology definition::

            {
              "name": ..., "base_tech": "supply", "carrier_out": ...,
              "flow_out_eff": ..., "flow_cap_max": ..., "lifetime": ...,
              "cost_flow_cap": { "data": ..., "index": "monetary", "dims": "costs" },
              ...
            }

        Can be serialised directly with ``yaml.dump()``.

    Notes on units
    --------------
    * ``energy_cap_max``                      kW   (Calliope 0.6.x native unit)
    * ``energy_cap`` cost                     EUR/kW
    * ``om_annual``                           EUR/kW/yr
    * ``om_prod``                             EUR/kWh  (converted from EUR/MWh ÷ 1000)
    * ``storage_cap_max``                     kWh
    * ``energy_cap_per_storage_cap_max``      h⁻¹  (= 1 / E2P_hours)
    * ``energy_eff_per_distance``             fraction/km  (= 1 − loss_per_km)
    * ``energy_ramping``                      fraction/h   (= ramp_%cap/min ÷ 100 × 60)

    All units carry over unchanged to ``version="0.7"`` (capacity fields stay
    in kW / kWh); 0.7 does not prescribe units.
    """
    if version not in ("0.6", "0.7"):
        raise ValueError(f"Unsupported Calliope version {version!r}; use '0.6' or '0.7'.")

    inst = _resolve_instance(tech, instance_index)

    if tech.category == TechnologyCategory.GENERATION:
        result = _supply_tech(tech, inst, cost_class)       # type: ignore[arg-type]
    elif tech.category == TechnologyCategory.STORAGE:
        result = _storage_tech(tech, inst, cost_class)      # type: ignore[arg-type]
    elif tech.category == TechnologyCategory.TRANSMISSION:
        result = _transmission_tech(tech, inst, cost_class) # type: ignore[arg-type]
    elif tech.category == TechnologyCategory.CONVERSION:
        result = _conversion_tech(tech, inst, cost_class)   # type: ignore[arg-type]
    else:
        # Fallback for unknown categories
        result = {
            "essentials":  {"name": tech.name, "oeo_class": tech.oeo_class},
            "constraints": {},
            "costs":       {},
        }

    if version == "0.7":
        return _to_v07(result, tech, inst)
    return result


# ---------------------------------------------------------------------------
# Generation (supply / supply_plus)
# ---------------------------------------------------------------------------

def _supply_tech(
    tech: PowerPlant | VREPlant,
    inst: EquipmentInstance | None,
    cost_class: str,
) -> dict[str, Any]:
    """
    Map a PowerPlant or VREPlant to a Calliope ``supply`` / ``supply_plus`` tech.

    VRE plants (``is_dispatchable=False``) become ``supply_plus`` and require
    a resource time-series profile referenced via ``tech.profile_key``.
    """
    is_vre    = isinstance(tech, VREPlant) or not getattr(tech, "is_dispatchable", True)
    tech_type = "supply_plus" if is_vre else "supply"

    # --- Resolve parameters (instance overrides fleet defaults) ---------------
    eff    = (_val(inst.electrical_efficiency)    if inst else None) \
             or _val(getattr(tech, "fleet_electrical_efficiency", None))
    capex  = (_val(inst.capex_per_kw)             if inst else None) \
             or _val(getattr(tech, "fleet_capex_per_kw", None))
    opex_f = (_val(inst.opex_fixed_per_kw_yr)     if inst else None) \
             or _val(getattr(tech, "fleet_opex_fixed_per_kw_yr", None))
    opex_v = _val(inst.opex_variable_per_mwh)     if inst else None
    cap_kw = _val(inst.capacity_kw)               if inst else None
    life   = _val(inst.economic_lifetime_yr)      if inst else None
    co2    = (_val(inst.co2_emission_factor)      if inst else None) \
             or _val(getattr(tech, "fleet_co2_emission_factor", None))
    disc   = _val(inst.discount_rate)             if inst else None

    # Ramp rate: use the stricter (smaller) of up/down, convert %/min -> frac/h
    ramp_up   = _val(inst.ramp_up_rate)   if inst else None
    ramp_down = _val(inst.ramp_down_rate) if inst else None
    ramp_candidates = [
        _ramp_fraction_per_hour(r)
        for r in [ramp_up, ramp_down]
        if r is not None
    ]
    energy_ramping = min(ramp_candidates) if ramp_candidates else None

    # --- essentials -----------------------------------------------------------
    essentials: dict[str, Any] = {
        "name":        inst.label if inst else tech.name,
        "color":       "#f4a460" if not is_vre else "#ffd700",
        "parent":      tech_type,
        "carrier_out": _carrier_str(tech.output_carriers) or "electricity",
        # OEO traceability (Calliope ignores unknown keys)
        "oeo_class":   tech.oeo_class,
        "oeo_uri":     _safe_str(tech.oeo_uri),
    }
    if tech.input_carriers:
        essentials["carrier_in"] = _carrier_str(tech.input_carriers)

    # --- constraints ----------------------------------------------------------
    constraints: dict[str, Any] = {}

    if eff is not None:
        constraints["energy_eff"] = eff                        # fraction, resource->carrier_out

    # energy_cap_max in kW (Calliope 0.6.x native unit)
    if cap_kw is not None:
        constraints["energy_cap_max"] = cap_kw                 # kW

    if life is not None:
        constraints["lifetime"] = life                         # years

    if energy_ramping is not None:
        constraints["energy_ramping"] = energy_ramping         # fraction/hour

    if not is_vre:
        # Minimum stable generation (dispatchable plants only)
        min_gen = _val(inst.min_stable_generation) if inst else None
        if min_gen is not None:
            constraints["energy_cap_min_use"] = min_gen        # fraction of energy_cap

    if is_vre:
        # Time-series capacity-factor profile
        if getattr(tech, "profile_key", None):
            constraints["resource"]      = f"file=profiles/{tech.profile_key}.csv"  # type: ignore[attr-defined]
            constraints["resource_unit"] = "energy_per_cap"                          # kWh/kW per timestep

        # Must-run: all available resource must be consumed each timestep
        if getattr(tech, "force_resource", False):
            constraints["force_resource"] = True

        # Resource capture efficiency (e.g. CSP collector mirror reflectivity)
        res_eff = _val(getattr(tech, "resource_efficiency", None))
        if res_eff is not None:
            constraints["resource_eff"] = res_eff                                    # fraction

        # Parasitic efficiency: post-conversion internal loss (e.g. PV DC→AC inverter)
        par_eff = _val(getattr(tech, "parasitic_efficiency", None))
        if par_eff is not None:
            constraints["parasitic_eff"] = par_eff                                   # fraction

        # Land / rooftop area constraints
        area_max = _val(getattr(tech, "resource_area_max_m2", None))
        if area_max is not None:
            constraints["resource_area_max"] = area_max                              # m²
        area_per_cap = _val(getattr(tech, "resource_area_per_kw", None))
        if area_per_cap is not None:
            constraints["resource_area_per_energy_cap"] = area_per_cap              # m²/kW

    # --- costs ----------------------------------------------------------------
    monetary: dict[str, Any] = {}

    if capex is not None:
        monetary["energy_cap"] = capex                         # EUR/kW  (CAPEX — Calliope key is 'energy_cap')
    if opex_f is not None:
        monetary["om_annual"]  = opex_f                        # EUR/kW/yr
    if opex_v is not None:
        monetary["om_prod"]    = _opex_var_eur_per_kwh(opex_v) # EUR/kWh (converted from EUR/MWh)
    if disc is not None:
        monetary["interest_rate"] = disc                       # fraction

    costs: dict[str, Any] = {}
    if monetary:
        costs[cost_class] = monetary

    # CO2 emissions tracked in a separate cost class so they remain independent
    # of monetary costs and can be used in emission-limit constraints.
    if co2 is not None:
        costs["co2"] = {"om_prod": _co2_t_per_kwh(co2)}       # tCO2/kWh

    return {
        "essentials":  {k: v for k, v in essentials.items()  if v is not None},
        "constraints": constraints,
        "costs":       costs,
    }


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def _storage_tech(
    tech: EnergyStorage,
    inst: EquipmentInstance | None,
    cost_class: str,
) -> dict[str, Any]:
    """
    Map an EnergyStorage to a Calliope ``storage`` technology.

    Key mapping decisions
    ~~~~~~~~~~~~~~~~~~~~~
    * ``energy_eff``  = one-way (charge or discharge) efficiency.
      Derived as sqrt(round_trip_efficiency) when only fleet data is available.
    * ``energy_cap_per_storage_cap_max``  = 1 / E2P_ratio  [h^-1]
      This is the C-rate: maximum power as a fraction of energy capacity.
    * ``storage_cap_max``  (kWh) is set when both capacity_kw and E2P are known.
    * ``storage_discharge_depth``  defines the minimum allowed state of charge.
      Derived as  1 - fleet_dod_max  (e.g. dod_max=0.8 -> min SOC=0.2).
    * ``storage_loss``  = self-discharge rate [fraction/hour].
    """
    rt_eff = _val(getattr(tech, "fleet_roundtrip_efficiency",  None))
    e2p    = _val(getattr(tech, "fleet_energy_to_power_ratio", None))  # hours
    sdr    = _val(getattr(tech, "fleet_self_discharge_rate",   None))  # frac/h
    dod    = _val(getattr(tech, "fleet_dod_max",               None))  # fraction

    # One-way efficiency: prefer instance value, fall back to sqrt(round-trip)
    inst_eff    = _val(inst.electrical_efficiency) if inst else None
    one_way_eff = inst_eff or (rt_eff ** 0.5 if rt_eff is not None else None)

    capex     = _val(inst.capex_per_kw)          if inst else None
    opex_f    = _val(inst.opex_fixed_per_kw_yr)  if inst else None
    opex_v    = _val(inst.opex_variable_per_mwh) if inst else None
    cap_kw    = _val(inst.capacity_kw)           if inst else None
    life      = _val(inst.economic_lifetime_yr)  if inst else None
    disc      = _val(inst.discount_rate)         if inst else None
    capex_kwh = _val(inst.capex_per_kwh)         if inst else None   # EUR/kWh, storage energy CAPEX
    fuel_cost = _val(inst.fuel_cost_per_mwh)     if inst else None   # EUR/MWh, input carrier cost
    init_soc  = _val(inst.initial_soc)           if inst else None   # fraction, SOC at t=0

    # --- essentials -----------------------------------------------------------
    essentials: dict[str, Any] = {
        "name":      inst.label if inst else tech.name,
        "color":     "#70a0e0",
        "parent":    "storage",
        "carrier":   _carrier_str(tech.output_carriers) or "electricity",
        "oeo_class": tech.oeo_class,
        "oeo_uri":   _safe_str(tech.oeo_uri),
    }

    # --- constraints ----------------------------------------------------------
    constraints: dict[str, Any] = {}

    if one_way_eff is not None:
        constraints["energy_eff"] = one_way_eff                # fraction (one-way step)

    # energy_cap_max = nameplate power capacity [kW]
    if cap_kw is not None:
        constraints["energy_cap_max"] = cap_kw                 # kW

    # C-rate: energy_cap_per_storage_cap_max = 1 / E2P [h^-1]
    if e2p is not None and e2p > 0:
        constraints["energy_cap_per_storage_cap_max"] = 1.0 / e2p   # h^-1

    # Explicit storage energy capacity [kWh]
    if cap_kw is not None and e2p is not None:
        constraints["storage_cap_max"] = cap_kw * e2p          # kWh

    # Self-discharge loss per hour
    if sdr is not None:
        constraints["storage_loss"] = sdr                      # fraction/hour

    # Minimum state-of-charge as depth-of-discharge threshold
    # dod_max=0.8 (80% depth allowed) -> minimum SOC = 1 - 0.8 = 0.2
    if dod is not None:
        constraints["storage_discharge_depth"] = 1.0 - dod     # fraction

    # Initial state of charge at the first model timestep
    if init_soc is not None:
        constraints["storage_initial"] = init_soc              # fraction [0–1]

    if life is not None:
        constraints["lifetime"] = life                         # years

    # --- costs ----------------------------------------------------------------
    monetary: dict[str, Any] = {}

    if capex is not None:
        monetary["energy_cap"] = capex                         # EUR/kW
    if opex_f is not None:
        monetary["om_annual"]  = opex_f                        # EUR/kW/yr
    if opex_v is not None:
        monetary["om_prod"]    = _opex_var_eur_per_kwh(opex_v) # EUR/kWh
    if disc is not None:
        monetary["interest_rate"] = disc                       # fraction
    if capex_kwh is not None:
        monetary["storage_cap"] = capex_kwh                    # EUR/kWh (energy capacity CAPEX)
    if fuel_cost is not None:
        monetary["om_con"] = _opex_var_eur_per_kwh(fuel_cost)  # EUR/kWh (input carrier cost)

    costs: dict[str, Any] = {}
    if monetary:
        costs[cost_class] = monetary

    return {
        "essentials":  {k: v for k, v in essentials.items() if v is not None},
        "constraints": constraints,
        "costs":       costs,
    }


# ---------------------------------------------------------------------------
# Transmission
# ---------------------------------------------------------------------------

def _transmission_tech(
    tech: TransmissionLine,
    inst: EquipmentInstance | None,
    cost_class: str,
) -> dict[str, Any]:
    """
    Map a TransmissionLine to a Calliope ``transmission`` technology.

    Key mapping decisions
    ~~~~~~~~~~~~~~~~~~~~~
    * ``energy_cap_max`` sourced from ``inst.capacity_kw`` [kW] when available,
      or from ``tech.max_capacity_mw * 1000`` [kW] otherwise.
    * ``energy_eff``  = endpoint-to-endpoint efficiency (from instance data).
    * ``energy_eff_per_distance``  = efficiency per km [fraction/km].
      Derived as  1 - tech.loss_per_km.  Requires ``distance`` to be set at
      the Calliope location/link level.
    """
    eff     = _val(inst.electrical_efficiency)  if inst else None
    capex   = _val(inst.capex_per_kw)           if inst else None
    opex_f  = _val(inst.opex_fixed_per_kw_yr)   if inst else None
    life    = _val(inst.economic_lifetime_yr)   if inst else None
    disc    = _val(inst.discount_rate)          if inst else None
    loss_km = _val(getattr(tech, "loss_per_km", None))

    # Maximum capacity in kW (Calliope native unit)
    if inst and inst.capacity_kw is not None:
        cap_kw: float | None = _val(inst.capacity_kw)       # already kW
    elif tech.max_capacity_mw is not None:
        cap_kw = _val(tech.max_capacity_mw) * 1000.0        # MW -> kW
    else:
        cap_kw = None

    # Infer carrier from output_carriers; default to electricity
    carrier = _carrier_str(tech.output_carriers) or "electricity"

    # --- essentials -----------------------------------------------------------
    essentials: dict[str, Any] = {
        "name":      inst.label if inst else tech.name,
        "color":     "#888888",
        "parent":    "transmission",
        "carrier":   carrier,
        "oeo_class": tech.oeo_class,
        "oeo_uri":   _safe_str(tech.oeo_uri),
    }

    # --- constraints ----------------------------------------------------------
    constraints: dict[str, Any] = {}

    if eff is not None:
        constraints["energy_eff"] = eff                            # fraction (total)

    if cap_kw is not None:
        constraints["energy_cap_max"] = cap_kw                     # kW

    # Per-km efficiency loss -> Calliope distance-based loss model
    if loss_km is not None:
        constraints["energy_eff_per_distance"] = 1.0 - loss_km    # fraction/km

    if life is not None:
        constraints["lifetime"] = life                             # years

    # --- costs ----------------------------------------------------------------
    monetary: dict[str, Any] = {}

    if capex is not None:
        monetary["energy_cap"] = capex                             # EUR/kW
    if opex_f is not None:
        monetary["om_annual"]  = opex_f                            # EUR/kW/yr
    if disc is not None:
        monetary["interest_rate"] = disc                           # fraction

    costs: dict[str, Any] = {}
    if monetary:
        costs[cost_class] = monetary

    return {
        "essentials":  {k: v for k, v in essentials.items() if v is not None},
        "constraints": constraints,
        "costs":       costs,
    }


# ---------------------------------------------------------------------------
# Conversion
# ---------------------------------------------------------------------------

def _conversion_tech(
    tech: ConversionTechnology,
    inst: EquipmentInstance | None,
    cost_class: str,
) -> dict[str, Any]:
    """
    Map a ConversionTechnology to a Calliope ``conversion`` / ``conversion_plus``
    technology.

    Key mapping decisions
    ~~~~~~~~~~~~~~~~~~~~~
    * Single output-carrier technologies use ``conversion``.
    * Technologies with >1 output carriers (e.g. CHP electricity + heat) use
      ``conversion_plus``.
    * ``energy_eff``  = primary output efficiency (carrier_in -> primary carrier_out).
    * For ``conversion_plus``, ``carrier_ratios`` are computed automatically from
      ``inst.thermal_efficiency / inst.electrical_efficiency`` when both are present,
      or can be overridden via ``inst.extra["carrier_ratios"]``.
    * ``energy_ramping``  is mapped from ramp_up/down_rate when available.
    * ``om_prod``  covers variable O&M on the output carrier [EUR/kWh].
    """
    el_eff    = (_val(inst.electrical_efficiency)    if inst else None) \
                or _val(getattr(tech, "fleet_conversion_efficiency", None))
    th_eff    = _val(inst.thermal_efficiency)    if inst else None
    capex     = _val(inst.capex_per_kw)          if inst else None
    opex_f    = _val(inst.opex_fixed_per_kw_yr)  if inst else None
    opex_v    = _val(inst.opex_variable_per_mwh) if inst else None
    cap_kw    = _val(inst.capacity_kw)           if inst else None
    life      = _val(inst.economic_lifetime_yr)  if inst else None
    disc      = _val(inst.discount_rate)         if inst else None
    co2       = _val(inst.co2_emission_factor)   if inst else None
    fuel_cost = _val(inst.fuel_cost_per_mwh)     if inst else None   # EUR/MWh input carrier cost

    # Ramp rate -> Calliope energy_ramping [frac/h]
    ramp_up   = _val(inst.ramp_up_rate)   if inst else None
    ramp_down = _val(inst.ramp_down_rate) if inst else None
    ramp_candidates = [
        _ramp_fraction_per_hour(r)
        for r in [ramp_up, ramp_down]
        if r is not None
    ]
    energy_ramping = min(ramp_candidates) if ramp_candidates else None

    # Detect multi-output-carrier technologies -> conversion_plus
    n_out  = len(tech.output_carriers)
    parent = "conversion_plus" if n_out > 1 else "conversion"

    # Primary efficiency: depends on what the primary output carrier is.
    # Thermal-primary techs (boilers, heat pumps) use thermal_efficiency (= COP / thermal eff).
    # All other techs (electrolyzers, fuel cells, chemical processes) use electrical_efficiency.
    _THERMAL_CARRIERS = {"heat", "steam", "cooling"}
    primary_out = tech.output_carriers[0].value if tech.output_carriers else "electricity"
    if primary_out in _THERMAL_CARRIERS:
        primary_eff = th_eff or _val(getattr(tech, "fleet_conversion_efficiency", None))
    else:
        primary_eff = el_eff

    # --- essentials -----------------------------------------------------------
    essentials: dict[str, Any] = {
        "name":        inst.label if inst else tech.name,
        "color":       "#90ee90",
        "parent":      parent,
        "carrier_in":  _carrier_str(tech.input_carriers)  or "electricity",
        "carrier_out": _carrier_str(tech.output_carriers) or "hydrogen",
        "oeo_class":   tech.oeo_class,
        "oeo_uri":     _safe_str(tech.oeo_uri),
    }

    # --- constraints ----------------------------------------------------------
    constraints: dict[str, Any] = {}

    if primary_eff is not None:
        constraints["energy_eff"] = primary_eff                # fraction, carrier_in->primary carrier_out

    if cap_kw is not None:
        constraints["energy_cap_max"] = cap_kw                 # kW

    if life is not None:
        constraints["lifetime"] = life                         # years

    if energy_ramping is not None:
        constraints["energy_ramping"] = energy_ramping         # fraction/hour

    # conversion_plus: carrier_ratios define secondary output quantities
    # relative to the primary output.
    # Ratio = secondary_eff / primary_eff (e.g. heat_out / elec_out for CHP).
    # Prefer explicit carrier_ratios from extra, else auto-compute from efficiencies.
    if parent == "conversion_plus" and n_out >= 2:
        extra_ratios = (inst.extra.get("carrier_ratios") if inst and inst.extra else None)
        if extra_ratios is not None:
            constraints["carrier_ratios"] = extra_ratios
        elif el_eff and th_eff and el_eff > 0:
            secondary_carrier = tech.output_carriers[1].value
            constraints["carrier_ratios"] = {
                f"carrier_out.{secondary_carrier}": round(th_eff / el_eff, 4)
            }
    elif inst and inst.extra:
        # For single-output: still honour any manually set extra constraints
        for key, val in inst.extra.items():
            constraints.setdefault(key, val)

    # --- costs ----------------------------------------------------------------
    monetary: dict[str, Any] = {}

    if capex is not None:
        monetary["energy_cap"] = capex                         # EUR/kW
    if opex_f is not None:
        monetary["om_annual"]  = opex_f                        # EUR/kW/yr
    if opex_v is not None:
        monetary["om_prod"]    = _opex_var_eur_per_kwh(opex_v) # EUR/kWh (output carrier)
    if disc is not None:
        monetary["interest_rate"] = disc                       # fraction
    if fuel_cost is not None:
        monetary["om_con"] = _opex_var_eur_per_kwh(fuel_cost)  # EUR/kWh (input carrier cost)

    costs: dict[str, Any] = {}
    if monetary:
        costs[cost_class] = monetary

    if co2 is not None:
        costs["co2"] = {"om_prod": _co2_t_per_kwh(co2)}       # tCO2/kWh

    return {
        "essentials":  {k: v for k, v in essentials.items()  if v is not None},
        "constraints": constraints,
        "costs":       costs,
    }


# ---------------------------------------------------------------------------
# Calliope 0.7 transform
# ---------------------------------------------------------------------------

# v0.6 constraint key → v0.7 parameter name (identity renames omitted:
# lifetime, storage_cap_max, storage_loss, storage_initial,
# storage_discharge_depth are unchanged in 0.7).
_V07_CONSTRAINT_RENAMES: dict[str, str] = {
    "energy_cap_max":                 "flow_cap_max",
    "energy_ramping":                 "flow_ramping",
    "energy_cap_min_use":             "flow_out_min_relative",
    "energy_cap_per_storage_cap_max": "flow_cap_per_storage_cap_max",
    "energy_eff_per_distance":        "flow_out_eff_per_distance",
    "resource_eff":                   "source_eff",
    "parasitic_eff":                  "flow_out_parasitic_eff",
    "resource_area_max":              "area_use_max",
    "resource_area_per_energy_cap":   "area_use_per_flow_cap",
}

# v0.6 cost key (within a cost class) → v0.7 top-level cost parameter name.
_V07_COST_RENAMES: dict[str, str] = {
    "energy_cap":    "cost_flow_cap",
    "om_annual":     "cost_om_annual",
    "om_prod":       "cost_flow_out",
    "om_con":        "cost_flow_in",
    "storage_cap":   "cost_storage_cap",
    "interest_rate": "cost_interest_rate",
}

# 0.6 base classes removed in 0.7.
_V07_BASE_TECH: dict[str, str] = {
    "supply_plus":     "supply",
    "conversion_plus": "conversion",
}


def _to_v07(
    v06: dict[str, Any],
    tech: Technology,
    inst: EquipmentInstance | None,
) -> dict[str, Any]:
    """
    Convert a v0.6 export (essentials/constraints/costs) into the flat
    Calliope 0.7 technology definition.

    Follows https://calliope.readthedocs.io/en/latest/migrating/ — see the
    module docstring for the full rename table.  Timeseries references
    (``resource: file=…`` / ``force_resource``) cannot be expressed inside a
    0.7 tech definition (they moved to top-level ``data_tables``); they are
    dropped and a migration hint is left in ``opentech_note``.
    """
    essentials  = v06.get("essentials", {})
    constraints = v06.get("constraints", {})
    costs       = v06.get("costs", {})

    parent = essentials.get("parent")
    out: dict[str, Any] = {}
    notes: list[str] = []

    # --- identity ------------------------------------------------------------
    for key in ("name", "color"):
        if key in essentials:
            out[key] = essentials[key]

    if parent:
        out["base_tech"] = _V07_BASE_TECH.get(parent, parent)
        if parent == "supply_plus":
            notes.append("supply_plus was removed in 0.7; using base_tech: supply.")
        if parent == "conversion_plus":
            notes.append("conversion_plus was removed in 0.7; using base_tech: conversion "
                         "with carrier_out as a list.")

    # --- carriers (0.7 requires explicit carrier_in / carrier_out) ------------
    if "carrier" in essentials:  # 0.6 alias for same in/out (storage, transmission)
        out["carrier_in"]  = essentials["carrier"]
        out["carrier_out"] = essentials["carrier"]
    else:
        # 0.7 supply techs have no carrier_in — the resource enters via
        # source_use, not as a carrier (0.6 supply/supply_plus listed it).
        if "carrier_in" in essentials and parent not in ("supply", "supply_plus"):
            out["carrier_in"] = essentials["carrier_in"]
        if "carrier_out" in essentials:
            if len(tech.output_carriers) > 1:
                out["carrier_out"] = [c.value for c in tech.output_carriers]
            else:
                out["carrier_out"] = essentials["carrier_out"]

    # Provenance strings — 0.7 treats unknown keys as user-defined parameters.
    for key in ("oeo_class", "oeo_uri"):
        if essentials.get(key) is not None:
            out[key] = essentials[key]

    # --- constraints → flat parameters ----------------------------------------
    eff    = constraints.get("energy_eff")
    ratios = constraints.get("carrier_ratios")

    for key, value in constraints.items():
        if key in ("energy_eff", "carrier_ratios"):
            continue  # handled below
        if key in ("resource", "resource_unit"):
            if key == "resource":
                notes.append(
                    f"Timeseries resource ({value!r}) must be loaded via the "
                    "top-level data_tables key in 0.7 "
                    "(rows: timesteps, add_dims.parameters: source_use_max)."
                )
            continue
        if key == "force_resource":
            notes.append("force_resource → supply the profile as source_use_equals "
                         "via data_tables in 0.7.")
            continue
        out[_V07_CONSTRAINT_RENAMES.get(key, key)] = value

    # Efficiency: 0.7 splits inflow/outflow; storage can carry both sides.
    if eff is not None:
        if parent == "storage":
            eta_in, eta_out = eff, eff
            extra = inst.extra if inst and inst.extra else {}
            if isinstance(extra.get("charge_efficiency_fraction"), (int, float)):
                eta_in = float(extra["charge_efficiency_fraction"])
            if isinstance(extra.get("discharge_efficiency_fraction"), (int, float)):
                eta_out = float(extra["discharge_efficiency_fraction"])
            out["flow_in_eff"]  = eta_in
            out["flow_out_eff"] = eta_out
        elif ratios and isinstance(ratios, dict):
            # carrier_ratios removed in 0.7 → flow_out_eff indexed over carriers
            primary_carrier = essentials.get("carrier_out")
            data, index = [eff], [primary_carrier]
            for rkey, ratio in ratios.items():
                if isinstance(ratio, (int, float)):
                    data.append(round(eff * ratio, 6))
                    index.append(str(rkey).split(".")[-1])
            out["flow_out_eff"] = {"data": data, "index": index, "dims": "carriers"}
        else:
            out["flow_out_eff"] = eff
    elif ratios:
        notes.append("carrier_ratios could not be converted: no primary energy_eff set.")

    # --- costs → cost_* parameters with {data, index, dims} -------------------
    merged: dict[str, tuple[list[Any], list[str]]] = {}
    for cls, block in costs.items():
        for key, value in block.items():
            target = _V07_COST_RENAMES.get(key, f"cost_{key}")
            data, index = merged.setdefault(target, ([], []))
            data.append(value)
            index.append(cls)
    for target, (data, index) in merged.items():
        out[target] = {
            "data":  data[0]  if len(data)  == 1 else data,
            "index": index[0] if len(index) == 1 else index,
            "dims":  "costs",
        }

    if notes:
        out["opentech_note"] = " ".join(notes)

    return out

"""
adapters/calliope_adapter.py
============================
Translates OEO-aligned Technology / EquipmentInstance objects into the
YAML-compatible parameter dictionaries expected by Calliope.

Calliope reference docs: https://calliope.readthedocs.io/

Calliope technology types handled:
  - supply / supply_plus → PowerPlant / VREPlant
  - storage              → EnergyStorage
  - transmission         → TransmissionLine
  - conversion           → ConversionTechnology

The dictionaries returned here match the structure under
``techs.<tech_name>.essentials`` and ``techs.<tech_name>.constraints`` /
``costs.monetary`` in a Calliope config.

Usage example
-------------
>>> from schemas.models import PowerPlant
>>> from adapters.calliope_adapter import to_calliope
>>> import json, pathlib
>>> raw = json.loads(pathlib.Path("data/generation/gas_turbine_ccgt.json").read_text())
>>> plant = PowerPlant.model_validate(raw)
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
# Helpers
# ---------------------------------------------------------------------------

def _val(param) -> float | None:
    """Safely extract the scalar value from a ParameterValue or None."""
    return param.value if param is not None else None


def _safe_str(v) -> str | None:
    return str(v) if v is not None else None


def _resolve_instance(tech: Technology, instance_index: int | None) -> EquipmentInstance | None:
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


# ---------------------------------------------------------------------------
# Public translator
# ---------------------------------------------------------------------------

def to_calliope(
    tech: Technology,
    *,
    instance_index: int | None = 0,
    cost_class: str = "monetary",
) -> dict[str, Any]:
    """
    Translate a Technology and one EquipmentInstance into a Calliope
    technology configuration dictionary.

    Parameters
    ----------
    tech:
        An OEO-aligned Technology object.
    instance_index:
        Which EquipmentInstance to use (default: 0).
    cost_class:
        Calliope cost class name (default: ``monetary``).

    Returns
    -------
    dict
        Nested dict matching Calliope's``techs.<name>`` YAML structure:
        ``{"essentials": {...}, "constraints": {...}, "costs": {...}}``.
        Can be serialised directly with ``yaml.dump()``.
    """
    inst = _resolve_instance(tech, instance_index)

    if tech.category == TechnologyCategory.GENERATION:
        return _supply_tech(tech, inst, cost_class)  # type: ignore[arg-type]
    if tech.category == TechnologyCategory.STORAGE:
        return _storage_tech(tech, inst, cost_class)  # type: ignore[arg-type]
    if tech.category == TechnologyCategory.TRANSMISSION:
        return _transmission_tech(tech, inst, cost_class)  # type: ignore[arg-type]
    if tech.category == TechnologyCategory.CONVERSION:
        return _conversion_tech(tech, inst, cost_class)  # type: ignore[arg-type]

    # Fallback
    return {
        "essentials": {"name": tech.name, "oeo_class": tech.oeo_class},
        "constraints": {},
        "costs": {},
    }


# ---------------------------------------------------------------------------
# Component-specific translators
# ---------------------------------------------------------------------------

def _carrier_str(carriers: list) -> str | None:
    return carriers[0].value if carriers else None


def _supply_tech(
    tech: PowerPlant | VREPlant,
    inst: EquipmentInstance | None,
    cost_class: str,
) -> dict[str, Any]:
    """Calliope ``supply`` or ``supply_plus`` technology."""
    is_vre   = isinstance(tech, VREPlant) or not getattr(tech, "is_dispatchable", True)
    tech_type = "supply_plus" if is_vre else "supply"

    eff    = (_val(inst.electrical_efficiency) if inst else None) or _val(getattr(tech, "fleet_electrical_efficiency", None))
    capex  = (_val(inst.capex_per_kw) if inst else None) or _val(getattr(tech, "fleet_capex_per_kw", None))
    opex_f = (_val(inst.opex_fixed_per_kw_yr) if inst else None) or _val(getattr(tech, "fleet_opex_fixed_per_kw_yr", None))
    opex_v = _val(inst.opex_variable_per_mwh) if inst else None
    p_nom  = _val(inst.capacity_kw) if inst else None
    life   = _val(inst.economic_lifetime_yr) if inst else None
    co2    = (_val(inst.co2_emission_factor) if inst else None) or _val(getattr(tech, "fleet_co2_emission_factor", None))

    essentials: dict[str, Any] = {
        "name":         inst.label if inst else tech.name,
        "color":        "#f4a460" if not is_vre else "#ffd700",
        "parent":       tech_type,
        "carrier_out":  _carrier_str(tech.output_carriers) or "electricity",
        # OEO metadata (Calliope ignores unknown keys but they aid traceability)
        "oeo_class":    tech.oeo_class,
        "oeo_uri":      _safe_str(tech.oeo_uri),
    }
    if tech.input_carriers:
        essentials["carrier_in"] = _carrier_str(tech.input_carriers)

    constraints: dict[str, Any] = {}
    if eff is not None:
        constraints["energy_eff"] = eff
    if p_nom is not None:
        constraints["energy_cap_max"] = p_nom / 1e3   # kW → MW  (Calliope uses MW by default)
    if getattr(tech, "is_dispatchable", True):
        min_gen = _val(inst.min_stable_generation) if inst else None
        if min_gen is not None:
            constraints["energy_cap_min_use"] = min_gen
    if is_vre and getattr(tech, "profile_key", None):
        constraints["resource"] = f"file=profiles/{tech.profile_key}.csv"  # type: ignore[attr-defined]
        constraints["resource_unit"] = "energy_per_cap"
    if life is not None:
        constraints["lifetime"] = life

    costs: dict[str, Any] = {"_comment": f"All costs in EUR (or project currency). Class: {cost_class}."}
    if capex is not None:
        costs["investment"] = capex          # EUR/kW
    if opex_f is not None:
        costs["om_annual"] = opex_f          # EUR/kW/yr
    if opex_v is not None:
        costs["om_prod"] = opex_v            # EUR/MWh
    if co2 is not None:
        costs["co2"] = co2                   # tCO2/MWh_fuel

    return {
        "essentials":   {k: v for k, v in essentials.items() if v is not None},
        "constraints":  constraints,
        "costs":        {cost_class: {k: v for k, v in costs.items() if v is not None}},
    }


def _storage_tech(
    tech: EnergyStorage,
    inst: EquipmentInstance | None,
    cost_class: str,
) -> dict[str, Any]:
    """Calliope ``storage`` technology."""
    rt_eff = _val(getattr(tech, "fleet_roundtrip_efficiency", None))
    e2p    = _val(getattr(tech, "fleet_energy_to_power_ratio", None))
    sdr    = _val(getattr(tech, "fleet_self_discharge_rate", None))
    cyclic_eff = (_val(inst.electrical_efficiency) if inst else None) or (rt_eff ** 0.5 if rt_eff else None)

    capex  = _val(inst.capex_per_kw) if inst else None
    opex_f = _val(inst.opex_fixed_per_kw_yr) if inst else None
    life   = _val(inst.economic_lifetime_yr) if inst else None

    essentials: dict[str, Any] = {
        "name":        inst.label if inst else tech.name,
        "color":       "#70a0e0",
        "parent":      "storage",
        "carrier":     _carrier_str(tech.output_carriers) or "electricity",
        "oeo_class":   tech.oeo_class,
        "oeo_uri":     _safe_str(tech.oeo_uri),
    }

    constraints: dict[str, Any] = {}
    if cyclic_eff is not None:
        constraints["energy_eff"] = cyclic_eff
    if e2p is not None:
        constraints["storage_cap_per_unit"] = e2p    # h
    if sdr is not None:
        constraints["storage_loss"] = sdr            # fraction/h
    p_nom = _val(inst.capacity_kw) if inst else None
    if p_nom is not None:
        constraints["energy_cap_max"] = p_nom / 1e3
    if life is not None:
        constraints["lifetime"] = life

    costs: dict[str, Any] = {}
    if capex is not None:
        costs["investment"] = capex
    if opex_f is not None:
        costs["om_annual"] = opex_f
    opex_v = _val(inst.opex_variable_per_mwh) if inst else None
    if opex_v is not None:
        costs["om_prod"] = opex_v

    return {
        "essentials":  {k: v for k, v in essentials.items() if v is not None},
        "constraints": constraints,
        "costs":       {cost_class: costs},
    }


def _transmission_tech(
    tech: TransmissionLine,
    inst: EquipmentInstance | None,
    cost_class: str,
) -> dict[str, Any]:
    """Calliope ``transmission`` technology."""
    eff    = _val(inst.electrical_efficiency) if inst else None
    capex  = _val(inst.capex_per_kw) if inst else None
    opex_f = _val(inst.opex_fixed_per_kw_yr) if inst else None
    life   = _val(inst.economic_lifetime_yr) if inst else None

    essentials: dict[str, Any] = {
        "name":       inst.label if inst else tech.name,
        "color":      "#888888",
        "parent":     "transmission",
        "carrier":    "electricity",
        "oeo_class":  tech.oeo_class,
        "oeo_uri":    _safe_str(tech.oeo_uri),
    }

    constraints: dict[str, Any] = {}
    if eff is not None:
        constraints["energy_eff"] = eff
    cap = _val(tech.max_capacity_mw) if tech.max_capacity_mw else (
          _val(inst.capacity_kw) / 1e3 if (inst and inst.capacity_kw) else None)
    if cap is not None:
        constraints["energy_cap_max"] = cap
    if life is not None:
        constraints["lifetime"] = life

    costs: dict[str, Any] = {}
    if capex is not None:
        costs["investment"] = capex
    if opex_f is not None:
        costs["om_annual"] = opex_f

    return {
        "essentials":  {k: v for k, v in essentials.items() if v is not None},
        "constraints": constraints,
        "costs":       {cost_class: costs},
    }


def _conversion_tech(
    tech: ConversionTechnology,
    inst: EquipmentInstance | None,
    cost_class: str,
) -> dict[str, Any]:
    """Calliope ``conversion`` technology (e.g. electrolyzer)."""
    eff    = (_val(inst.electrical_efficiency) if inst else None) or _val(tech.fleet_conversion_efficiency)
    capex  = _val(inst.capex_per_kw) if inst else None
    opex_f = _val(inst.opex_fixed_per_kw_yr) if inst else None
    life   = _val(inst.economic_lifetime_yr) if inst else None

    essentials: dict[str, Any] = {
        "name":        inst.label if inst else tech.name,
        "color":       "#90ee90",
        "parent":      "conversion",
        "carrier_in":  _carrier_str(tech.input_carriers) or "electricity",
        "carrier_out": _carrier_str(tech.output_carriers) or "hydrogen",
        "oeo_class":   tech.oeo_class,
        "oeo_uri":     _safe_str(tech.oeo_uri),
    }

    constraints: dict[str, Any] = {}
    if eff is not None:
        constraints["energy_eff"] = eff
    p_nom = _val(inst.capacity_kw) if inst else None
    if p_nom is not None:
        constraints["energy_cap_max"] = p_nom / 1e3
    if life is not None:
        constraints["lifetime"] = life

    costs: dict[str, Any] = {}
    if capex is not None:
        costs["investment"] = capex
    if opex_f is not None:
        costs["om_annual"] = opex_f
    opex_v = _val(inst.opex_variable_per_mwh) if inst else None
    if opex_v is not None:
        costs["om_prod"] = opex_v

    return {
        "essentials":  {k: v for k, v in essentials.items() if v is not None},
        "constraints": constraints,
        "costs":       {cost_class: costs},
    }

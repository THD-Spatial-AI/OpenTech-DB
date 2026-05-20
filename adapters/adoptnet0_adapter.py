"""
adapters/adoptnet0_adapter.py
=============================
Translates OEO-aligned Technology / EquipmentInstance objects into the
parameter dictionaries expected by ADOPTNet0 (Adaptive Decarbonisation and
Optimal Planning Tool – Net Zero), a THD-Spatial-AI research framework for
multi-sector energy system optimisation.

ADOPTNet0 parameter conventions
---------------------------------
All numeric parameters include their unit in a parallel ``_units`` block
so the JSON can be consumed without a separate data dictionary.

Technology categories map to ADOPTNet0 "tech_type" strings:

  OEO Category          ADOPTNet0 tech_type
  ──────────────────    ────────────────────────────
  GENERATION            "supply"  (dispatchable or VRE)
  STORAGE               "storage"
  TRANSMISSION          "transmission"
  CONVERSION            "conversion"

Carrier strings follow an IEEE / ADOPTNet0 vocabulary:

  EnergyCarrier         ADOPTNet0 carrier ID
  ──────────────        ─────────────────────
  ELECTRICITY           "elec"
  NATURAL_GAS           "gas"
  HYDROGEN              "h2"
  HEAT                  "heat"
  COOLING               "cool"
  COAL                  "coal"
  OIL                   "oil"
  BIOMASS               "biomass"
  BIOGAS                "biogas"
  NUCLEAR_FUEL          "nuclear"
  SOLAR_IRRADIANCE      "solar"
  WIND                  "wind"
  WATER                 "hydro"
  CO2                   "co2"
  AMMONIA               "nh3"
  STEAM                 "steam"
  SYNGAS                "syngas"

All monetary values default to EUR as the project currency.

Usage example
-------------
>>> from schemas.models import PowerPlant
>>> from adapters.adoptnet0_adapter import to_adoptnet0
>>> import json, pathlib
>>> raw = json.loads(pathlib.Path("data/generation/generation_technologies.json").read_text())
>>> tech = PowerPlant.model_validate(raw["technologies"][0])
>>> params = to_adoptnet0(tech, instance_index=0)
>>> print(json.dumps(params, indent=2))
"""

from __future__ import annotations

import re
from typing import Any

from schemas.models import (
    Technology,
    PowerPlant,
    VREPlant,
    EnergyStorage,
    TransmissionLine,
    ConversionTechnology,
    TechnologyCategory,
    EnergyCarrier,
    EquipmentInstance,
)

# ---------------------------------------------------------------------------
# Carrier vocabulary
# ---------------------------------------------------------------------------

_CARRIER_MAP: dict[EnergyCarrier, str] = {
    EnergyCarrier.ELECTRICITY:      "elec",
    EnergyCarrier.NATURAL_GAS:      "gas",
    EnergyCarrier.HYDROGEN:         "h2",
    EnergyCarrier.HEAT:             "heat",
    EnergyCarrier.COOLING:          "cool",
    EnergyCarrier.STEAM:            "steam",
    EnergyCarrier.OIL:              "oil",
    EnergyCarrier.COAL:             "coal",
    EnergyCarrier.BIOMASS:          "biomass",
    EnergyCarrier.BIOGAS:           "biogas",
    EnergyCarrier.SYNGAS:           "syngas",
    EnergyCarrier.WATER:            "hydro",
    EnergyCarrier.CO2:              "co2",
    EnergyCarrier.AMMONIA:          "nh3",
    EnergyCarrier.WIND:             "wind",
    EnergyCarrier.SOLAR_IRRADIANCE: "solar",
    EnergyCarrier.NUCLEAR_FUEL:     "nuclear",
}


def _carrier(c: EnergyCarrier | None) -> str | None:
    if c is None:
        return None
    return _CARRIER_MAP.get(c, c.value.lower())


def _carriers(lst: list[EnergyCarrier]) -> list[str]:
    return [_CARRIER_MAP.get(c, c.value.lower()) for c in lst]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _val(param) -> float | None:
    return param.value if param is not None else None


def _pv(param) -> dict[str, Any] | None:
    """Expand a ParameterValue into an ADOPTNet0-style annotated value dict."""
    if param is None:
        return None
    d: dict[str, Any] = {"value": param.value}
    if param.unit is not None:
        d["unit"] = param.unit
    if param.min is not None:
        d["min"] = param.min
    if param.max is not None:
        d["max"] = param.max
    if param.source is not None:
        d["source"] = param.source
    if param.year is not None:
        d["year"] = param.year
    return d


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


def _tech_id(tech: Technology) -> str:
    return re.sub(r"[^a-z0-9_]", "_", tech.name.lower()).strip("_")


def _ontology_block(tech: Technology) -> dict[str, Any]:
    return {
        "oeo_class": tech.oeo_class,
        "oeo_uri":   str(tech.oeo_uri) if tech.oeo_uri else None,
    }


def _instance_meta(inst: EquipmentInstance | None) -> dict[str, Any]:
    if inst is None:
        return {}
    return {
        "instance_id":    str((inst.extra or {}).get("instance_id", "")),
        "instance_label": inst.label,
        "manufacturer":   inst.manufacturer,
        "reference_year": inst.reference_year,
        "life_cycle_stage": inst.life_cycle_stage.value if inst.life_cycle_stage else None,
    }


# ---------------------------------------------------------------------------
# Component translators
# ---------------------------------------------------------------------------

def _supply_block(
    tech: PowerPlant | VREPlant,
    inst: EquipmentInstance | None,
) -> dict[str, Any]:
    """Generation (dispatchable or VRE) → ADOPTNet0 supply block."""

    eff = (
        _val(inst.electrical_efficiency) if inst else None
    ) or _val(getattr(tech, "fleet_electrical_efficiency", None))

    capex   = (inst.capex_per_kw          if inst else None) or getattr(tech, "fleet_capex_per_kw", None)
    opex_f  = (inst.opex_fixed_per_kw_yr  if inst else None) or getattr(tech, "fleet_opex_fixed_per_kw_yr", None)
    opex_v  = inst.opex_variable_per_mwh   if inst else None
    life    = inst.economic_lifetime_yr    if inst else None
    cf      = inst.capacity_factor         if inst else None
    co2     = (inst.co2_emission_factor    if inst else None) or getattr(tech, "fleet_co2_emission_factor", None)
    cap_kw  = inst.capacity_kw             if inst else None
    dr      = inst.discount_rate           if inst else None

    block: dict[str, Any] = {
        "id":          _tech_id(tech),
        "name":        tech.name,
        "tech_type":   "supply",
        "supply_type": "vre" if isinstance(tech, VREPlant) else "dispatchable",
        "ontology":    _ontology_block(tech),
        "instance":    _instance_meta(inst),
        "carriers": {
            "in":  _carriers(tech.input_carriers)  if tech.input_carriers  else [],
            "out": _carriers(tech.output_carriers) if tech.output_carriers else ["elec"],
        },
        "techno_economics": {
            "capital_cost_eur_per_kw":      _pv(capex),
            "fixed_om_eur_per_kw_yr":       _pv(opex_f),
            "variable_om_eur_per_mwh":      _pv(opex_v),
            "economic_lifetime_yr":         _pv(life),
            "discount_rate":                _pv(dr),
            "electrical_efficiency":        {"value": eff, "unit": "fraction"} if eff is not None else None,
            "installed_capacity_kw":        _pv(cap_kw),
            "capacity_factor":              _pv(cf),
        },
        "emissions": {
            "co2_factor_tco2_per_mwh_fuel": _pv(co2),
        },
        "flexibility": {
            "ramp_up_rate_pct_per_min":   _pv(inst.ramp_up_rate          if inst else None),
            "ramp_down_rate_pct_per_min": _pv(inst.ramp_down_rate        if inst else None),
            "min_stable_load_fraction":   _pv(inst.min_stable_generation if inst else None),
            "start_up_cost_eur_per_mw":   _pv(inst.start_up_cost         if inst else None),
        },
    }

    # VRE extras
    if isinstance(tech, VREPlant):
        block["vre"] = {
            "profile_key":        tech.profile_key,
            "force_resource":     tech.force_resource,
            "resource_efficiency": _pv(tech.resource_efficiency),
            "parasitic_efficiency": _pv(tech.parasitic_efficiency),
            "resource_area_max_m2": _pv(tech.resource_area_max_m2),
            "resource_area_per_kw": _pv(tech.resource_area_per_kw),
        }

    return block


def _storage_block(
    tech: EnergyStorage,
    inst: EquipmentInstance | None,
) -> dict[str, Any]:
    """Energy storage → ADOPTNet0 storage block."""

    rt_eff   = getattr(tech, "fleet_roundtrip_efficiency",  None)
    e2p      = getattr(tech, "fleet_energy_to_power_ratio", None)
    sd_rate  = getattr(tech, "fleet_self_discharge_rate",   None)
    dod_max  = getattr(tech, "fleet_dod_max",               None)
    cycles   = getattr(tech, "fleet_cycle_lifetime",        None)

    capex_kw  = inst.capex_per_kw        if inst else None
    capex_kwh = inst.capex_per_kwh       if inst else None
    opex_f    = inst.opex_fixed_per_kw_yr if inst else None
    opex_v    = inst.opex_variable_per_mwh if inst else None
    life      = inst.economic_lifetime_yr  if inst else None
    dr        = inst.discount_rate         if inst else None
    init_soc  = inst.initial_soc           if inst else None

    return {
        "id":        _tech_id(tech),
        "name":      tech.name,
        "tech_type": "storage",
        "storage_type": getattr(tech, "storage_type", None),
        "ontology":  _ontology_block(tech),
        "instance":  _instance_meta(inst),
        "carriers": {
            "stored": _carrier(getattr(tech, "stored_carrier", None)),
            "in":     _carriers(tech.input_carriers)  if tech.input_carriers  else ["elec"],
            "out":    _carriers(tech.output_carriers) if tech.output_carriers else ["elec"],
        },
        "techno_economics": {
            "capital_cost_power_eur_per_kw":  _pv(capex_kw),
            "capital_cost_energy_eur_per_kwh": _pv(capex_kwh),
            "fixed_om_eur_per_kw_yr":          _pv(opex_f),
            "variable_om_eur_per_mwh":         _pv(opex_v),
            "economic_lifetime_yr":            _pv(life),
            "discount_rate":                   _pv(dr),
        },
        "storage_characteristics": {
            "roundtrip_efficiency":         _pv(rt_eff),
            "energy_to_power_ratio_h":      _pv(e2p),
            "self_discharge_rate_frac_h":   _pv(sd_rate),
            "max_depth_of_discharge":       _pv(dod_max),
            "cycle_lifetime_cycles":        _pv(cycles),
            "initial_state_of_charge":      _pv(init_soc),
        },
    }


def _transmission_block(
    tech: TransmissionLine,
    inst: EquipmentInstance | None,
) -> dict[str, Any]:
    """Transmission line → ADOPTNet0 transmission block."""

    capex   = inst.capex_per_kw          if inst else None
    opex_f  = inst.opex_fixed_per_kw_yr  if inst else None
    opex_v  = inst.opex_variable_per_mwh if inst else None
    life    = inst.economic_lifetime_yr  if inst else None
    dr      = inst.discount_rate         if inst else None

    voltage = getattr(tech, "voltage_kv",   None)
    length  = getattr(tech, "length_km",    None)
    loss_km = getattr(tech, "loss_per_km",  None)
    max_cap = getattr(tech, "max_capacity_mw", None)

    return {
        "id":        _tech_id(tech),
        "name":      tech.name,
        "tech_type": "transmission",
        "transmission_type": getattr(tech, "transmission_type", None),
        "ontology":  _ontology_block(tech),
        "instance":  _instance_meta(inst),
        "carriers": {
            "in":  _carriers(tech.input_carriers)  if tech.input_carriers  else ["elec"],
            "out": _carriers(tech.output_carriers) if tech.output_carriers else ["elec"],
        },
        "techno_economics": {
            "capital_cost_eur_per_kw":   _pv(capex),
            "fixed_om_eur_per_kw_yr":    _pv(opex_f),
            "variable_om_eur_per_mwh":   _pv(opex_v),
            "economic_lifetime_yr":      _pv(life),
            "discount_rate":             _pv(dr),
        },
        "line_parameters": {
            "voltage_kv":           _pv(voltage),
            "length_km":            _pv(length),
            "loss_per_km_fraction": _pv(loss_km),
            "max_capacity_mw":      _pv(max_cap),
        },
    }


def _conversion_block(
    tech: ConversionTechnology,
    inst: EquipmentInstance | None,
) -> dict[str, Any]:
    """Sector-coupling / conversion technology → ADOPTNet0 conversion block."""

    eff = (
        _val(inst.electrical_efficiency) if inst else None
    ) or _val(getattr(tech, "fleet_conversion_efficiency", None))

    capex  = inst.capex_per_kw          if inst else None
    opex_f = inst.opex_fixed_per_kw_yr  if inst else None
    opex_v = inst.opex_variable_per_mwh if inst else None
    life   = inst.economic_lifetime_yr  if inst else None
    dr     = inst.discount_rate         if inst else None
    fuel_c = inst.fuel_cost_per_mwh     if inst else None

    return {
        "id":        _tech_id(tech),
        "name":      tech.name,
        "tech_type": "conversion",
        "conversion_type": getattr(tech, "conversion_type", None),
        "ontology":  _ontology_block(tech),
        "instance":  _instance_meta(inst),
        "carriers": {
            "in":  _carriers(tech.input_carriers)  if tech.input_carriers  else [],
            "out": _carriers(tech.output_carriers) if tech.output_carriers else [],
        },
        "techno_economics": {
            "capital_cost_eur_per_kw":  _pv(capex),
            "fixed_om_eur_per_kw_yr":   _pv(opex_f),
            "variable_om_eur_per_mwh":  _pv(opex_v),
            "economic_lifetime_yr":     _pv(life),
            "discount_rate":            _pv(dr),
            "fuel_input_cost_eur_per_mwh": _pv(fuel_c),
        },
        "performance": {
            "conversion_efficiency": {"value": eff, "unit": "fraction"} if eff is not None else None,
            "ramp_up_rate_pct_per_min":   _pv(inst.ramp_up_rate   if inst else None),
            "ramp_down_rate_pct_per_min": _pv(inst.ramp_down_rate if inst else None),
        },
    }


# ---------------------------------------------------------------------------
# Public translator
# ---------------------------------------------------------------------------

def to_adoptnet0(
    tech: Technology,
    *,
    instance_index: int | None = 0,
) -> dict[str, Any]:
    """
    Translate a Technology (and one of its EquipmentInstances) into an
    ADOPTNet0-compatible parameter dictionary.

    Parameters
    ----------
    tech:
        An OEO-aligned Technology object.
    instance_index:
        Which EquipmentInstance to use. Defaults to 0 (first entry).
        Pass ``None`` to use technology-level fleet defaults only.

    Returns
    -------
    dict
        Nested JSON-serialisable dict structured for ADOPTNet0 ingestion.

        Top-level keys:
        - ``id``              : snake_case technology identifier
        - ``name``            : canonical technology name
        - ``tech_type``       : "supply" | "storage" | "transmission" | "conversion"
        - ``ontology``        : OEO class and URI for provenance
        - ``instance``        : originating instance metadata
        - ``carriers``        : structured input/output carrier sets
        - ``techno_economics``: cost and lifetime parameters (each with unit/source)
        - Additional category-specific blocks (``vre``, ``storage_characteristics``, etc.)

    Notes
    -----
    *   Every numeric parameter is wrapped in a provenance envelope
        ``{"value": …, "unit": …, "min": …, "max": …, "source": …, "year": …}``
        so full OEO traceability is preserved in the output.
    *   ``None`` values signal a missing / unknown parameter.
    """
    inst = _resolve_instance(tech, instance_index)

    if tech.category == TechnologyCategory.GENERATION:
        return _supply_block(tech, inst)      # type: ignore[arg-type]
    if tech.category == TechnologyCategory.STORAGE:
        return _storage_block(tech, inst)     # type: ignore[arg-type]
    if tech.category == TechnologyCategory.TRANSMISSION:
        return _transmission_block(tech, inst)  # type: ignore[arg-type]
    if tech.category == TechnologyCategory.CONVERSION:
        return _conversion_block(tech, inst)  # type: ignore[arg-type]

    # Unknown category – return minimal record
    return {
        "id":        _tech_id(tech),
        "name":      tech.name,
        "tech_type": tech.category.value.lower(),
        "ontology":  _ontology_block(tech),
        "instance":  _instance_meta(inst),
    }

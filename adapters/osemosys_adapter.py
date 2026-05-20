"""
adapters/osemosys_adapter.py
============================
Translates OEO-aligned Technology / EquipmentInstance objects into the
parameter dictionaries expected by OSeMOSYS (Open Source energy MOdeling
SYStem).

OSeMOSYS reference: https://osemosys.readthedocs.io/en/latest/

Unit conventions used throughout
---------------------------------
OSeMOSYS uses **GW** for capacity and **PJ** for energy.  All cost
parameters follow the MEUR/GW (or MUSD/GW) convention – numerically
identical to EUR/kW because 1 EUR/kW × (1 GW / 1 000 kW) × (1 / 1 000
EUR/kEUR) → same number when expressed as MEUR/GW.

Key unit conversions applied:
  EUR/kW       → MEUR/GW           : ×1 (identity)
  EUR/kW/yr    → MEUR/GW/yr        : ×1 (identity)
  EUR/MWh      → MEUR/PJ           : ×0.27778  (1 PJ = 277 778 MWh)
  tCO2/MWh     → Mt CO2/PJ         : ×0.27778  (same ratio; Mt = 10⁶ t)
  %/min ramp   → fraction/yr       : not directly used (OSeMOSYS is annual)

Capacity-to-Activity unit
-------------------------
1 GW running continuously for 1 year = 8 760 GWh = 31.536 PJ.
``CapacityToActivityUnit = 31.536`` PJ/GW/yr is set automatically.

Storage notes
-------------
OSeMOSYS models storage via pairs of charge / discharge technologies linked
to a named STORAGE set.  ``to_osemosys()`` on an ``EnergyStorage`` returns a
dict with a ``"storage_model"`` key containing *both* sub-technology records
plus the shared ``STORAGE`` name.  Downstream tools should split these into
the two separate OSeMOSYS TECHNOLOGY records.

Emission accounting
-------------------
The adapter maps ``co2_emission_factor`` to OSeMOSYS
``EmissionActivityRatio`` in Mt CO2 / PJ, tied to an emission commodity
``"CO2"``.  Additional emission types can be added via the ``extra``
field on an instance.

Usage example
-------------
>>> from schemas.models import PowerPlant
>>> from adapters.osemosys_adapter import to_osemosys
>>> import json, pathlib
>>> raw = json.loads(pathlib.Path("data/generation/generation_technologies.json").read_text())
>>> tech = PowerPlant.model_validate(raw["technologies"][0])
>>> params = to_osemosys(tech, instance_index=0)
>>> print(params)
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
# Constants
# ---------------------------------------------------------------------------

#: 1 GW × 1 year (8 760 h) expressed in PJ  (= 8 760 GWh × 0.0036 PJ/GWh)
CAPACITY_TO_ACTIVITY = 31.536  # PJ/GW/yr

#: EUR/MWh → MEUR/PJ  (1 PJ = 277 778 MWh → 1 EUR/MWh = 277 778 EUR/PJ = 0.27778 MEUR/PJ)
EUR_PER_MWH_TO_MEUR_PER_PJ = 277_778 / 1_000_000  # ≈ 0.27778

#: tCO2/MWh → Mt CO2/PJ  (same ratio as energy, Mt = 10⁶ t)
TCO2_PER_MWH_TO_MT_PER_PJ = 277_778 / 1_000_000  # ≈ 0.27778


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _val(param) -> float | None:
    return param.value if param is not None else None


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
    """Derive a safe OSeMOSYS TECHNOLOGY identifier (uppercase, underscores)."""
    base = re.sub(r"[^a-z0-9]", "_", tech.name.lower()).strip("_")
    return base.upper()


def _fuel_id(carrier: EnergyCarrier | None, tech: Technology) -> str:
    """Map an EnergyCarrier to a conventional OSeMOSYS FUEL commodity name."""
    _FUEL_MAP: dict[EnergyCarrier, str] = {
        EnergyCarrier.ELECTRICITY:      "ELEC",
        EnergyCarrier.NATURAL_GAS:      "GAS",
        EnergyCarrier.HYDROGEN:         "H2",
        EnergyCarrier.HEAT:             "HEAT",
        EnergyCarrier.COAL:             "COAL",
        EnergyCarrier.OIL:              "OIL",
        EnergyCarrier.BIOMASS:          "BIOM",
        EnergyCarrier.BIOGAS:           "BIOG",
        EnergyCarrier.NUCLEAR_FUEL:     "NUC",
        EnergyCarrier.SOLAR_IRRADIANCE: "SOLAR",
        EnergyCarrier.WIND:             "WIND",
        EnergyCarrier.WATER:            "HYDRO",
        EnergyCarrier.CO2:              "CO2STORE",
        EnergyCarrier.AMMONIA:          "NH3",
        EnergyCarrier.SYNGAS:           "SYNGAS",
        EnergyCarrier.STEAM:            "STEAM",
        EnergyCarrier.COOLING:          "COOL",
    }
    if carrier is not None:
        return _FUEL_MAP.get(carrier, carrier.value.upper())
    # fallback: first output carrier
    if tech.output_carriers:
        return _FUEL_MAP.get(tech.output_carriers[0], tech.output_carriers[0].value.upper())
    return "ELEC"


def _common_meta(tech: Technology) -> dict[str, Any]:
    return {
        "_oeo_class": tech.oeo_class,
        "_oeo_uri":   str(tech.oeo_uri) if tech.oeo_uri else None,
        "_category":  tech.category.value,
    }


# ---------------------------------------------------------------------------
# Component translators
# ---------------------------------------------------------------------------

def _generation_params(
    tech: PowerPlant | VREPlant,
    inst: EquipmentInstance | None,
) -> dict[str, Any]:
    """Generation technology → OSeMOSYS parameter dict."""

    fuel_in  = _fuel_id(getattr(tech, "primary_fuel", None), tech)
    fuel_out = (_fuel_id(tech.output_carriers[0], tech) if tech.output_carriers else "ELEC")

    eff = (
        _val(inst.electrical_efficiency) if inst else None
    ) or _val(getattr(tech, "fleet_electrical_efficiency", None))

    capex   = (_val(inst.capex_per_kw)         if inst else None) or _val(getattr(tech, "fleet_capex_per_kw", None))
    opex_f  = (_val(inst.opex_fixed_per_kw_yr) if inst else None) or _val(getattr(tech, "fleet_opex_fixed_per_kw_yr", None))
    opex_v  = _val(inst.opex_variable_per_mwh) if inst else None
    life    = _val(inst.economic_lifetime_yr)   if inst else 25.0
    cf      = _val(inst.capacity_factor)        if inst else None
    co2     = (_val(inst.co2_emission_factor)   if inst else None) or _val(getattr(tech, "fleet_co2_emission_factor", None))

    # InputActivityRatio: how many PJ of fuel needed per PJ of electricity out
    input_activity: float | None = None
    if eff and eff > 0:
        input_activity = round(1.0 / eff, 6)

    emission_ratio: float | None = None
    if co2 is not None:
        emission_ratio = round(co2 * TCO2_PER_MWH_TO_MT_PER_PJ, 6)

    result: dict[str, Any] = {
        "TECHNOLOGY": _tech_id(tech),
        # Fuel commodity links
        "InputActivityRatio":  {fuel_in: input_activity}  if input_activity  else {},
        "OutputActivityRatio": {fuel_out: 1.0},
        # Techno-economics (MEUR/GW = EUR/kW numerically)
        "CapitalCost":          capex,
        "FixedCost":            opex_f,
        "VariableCost":         round(opex_v * EUR_PER_MWH_TO_MEUR_PER_PJ, 6) if opex_v is not None else None,
        "OperationalLife":      int(life) if life else None,
        "AvailabilityFactor":   cf,
        "CapacityToActivityUnit": CAPACITY_TO_ACTIVITY,
        # Emissions
        "EmissionActivityRatio": {"CO2": emission_ratio} if emission_ratio else {},
        # Units annotation (informational only)
        "_units": {
            "CapitalCost":  "MEUR/GW",
            "FixedCost":    "MEUR/GW/yr",
            "VariableCost": "MEUR/PJ",
        },
    }

    # VRE: AvailabilityFactor doubles as capacity factor profile placeholder
    if isinstance(tech, VREPlant):
        result["_profile_key"]     = tech.profile_key
        result["_is_variable_vre"] = True

    return {**result, **_common_meta(tech)}


def _storage_params(
    tech: EnergyStorage,
    inst: EquipmentInstance | None,
) -> dict[str, Any]:
    """
    Energy storage → OSeMOSYS storage model dict.

    OSeMOSYS represents storage via two linked TECHNOLOGY records (one for
    charging, one for discharging) plus a STORAGE commodity.  Both subtechs
    are returned under the ``"storage_model"`` key.
    """
    rt_eff  = _val(getattr(tech, "fleet_roundtrip_efficiency", None))
    e2p     = _val(getattr(tech, "fleet_energy_to_power_ratio", None))
    sd_rate = _val(getattr(tech, "fleet_self_discharge_rate", None))

    one_way_eff = (rt_eff ** 0.5) if (rt_eff and rt_eff > 0) else None

    capex_kw  = _val(inst.capex_per_kw)  if inst else None
    capex_kwh = _val(inst.capex_per_kwh) if inst else None
    opex_f    = _val(inst.opex_fixed_per_kw_yr) if inst else None
    life      = _val(inst.economic_lifetime_yr)  if inst else 15.0

    stored_carrier = _fuel_id(getattr(tech, "stored_carrier", None), tech)
    base_id        = _tech_id(tech)
    storage_name   = f"S_{base_id}"

    charge_tech: dict[str, Any] = {
        "TECHNOLOGY":         f"{base_id}_CHG",
        "InputActivityRatio":  {"ELEC": 1.0},
        "OutputActivityRatio": {storage_name: (round(one_way_eff, 6) if one_way_eff else 1.0)},
        "CapitalCost":         capex_kw,
        "FixedCost":           opex_f,
        "OperationalLife":     int(life) if life else None,
        "TechnologyToStorage": {storage_name: 1},
        "CapacityToActivityUnit": CAPACITY_TO_ACTIVITY,
    }

    discharge_tech: dict[str, Any] = {
        "TECHNOLOGY":         f"{base_id}_DIS",
        "InputActivityRatio":  {storage_name: 1.0},
        "OutputActivityRatio": {"ELEC": (round(one_way_eff, 6) if one_way_eff else 1.0)},
        "CapitalCost":         capex_kwh,      # energy capacity CAPEX → discharge side
        "FixedCost":           None,
        "OperationalLife":     int(life) if life else None,
        "TechnologyFromStorage": {storage_name: 1},
        "CapacityToActivityUnit": CAPACITY_TO_ACTIVITY,
    }

    storage_entity: dict[str, Any] = {
        "STORAGE":                storage_name,
        "StoredCarrier":          stored_carrier,
        "E2P_ratio_h":            e2p,
        "SelfDischargeRate_frac_h": sd_rate,
        "RoundtripEfficiency":    rt_eff,
    }

    return {
        "TECHNOLOGY": base_id,
        "storage_model": {
            "charge_technology":    charge_tech,
            "discharge_technology": discharge_tech,
            "storage_entity":       storage_entity,
        },
        "_units": {
            "CapitalCost":  "MEUR/GW",
            "FixedCost":    "MEUR/GW/yr",
            "VariableCost": "MEUR/PJ",
        },
        **_common_meta(tech),
    }


def _transmission_params(
    tech: TransmissionLine,
    inst: EquipmentInstance | None,
) -> dict[str, Any]:
    """Transmission line → OSeMOSYS TECHNOLOGY dict (modelled as an efficiency link)."""

    capex   = _val(inst.capex_per_kw)         if inst else None
    opex_f  = _val(inst.opex_fixed_per_kw_yr) if inst else None
    opex_v  = _val(inst.opex_variable_per_mwh) if inst else None
    life    = _val(inst.economic_lifetime_yr)  if inst else 40.0
    loss_km = _val(getattr(tech, "loss_per_km", None))
    len_km  = _val(getattr(tech, "length_km",   None))

    # Net one-way efficiency
    eff = 1.0
    if loss_km is not None and len_km is not None:
        eff = max(0.0, 1.0 - loss_km * len_km)

    return {
        "TECHNOLOGY":          _tech_id(tech),
        "InputActivityRatio":  {"ELEC_A": 1.0},
        "OutputActivityRatio": {"ELEC_B": round(eff, 6)},
        "CapitalCost":         capex,
        "FixedCost":           opex_f,
        "VariableCost":        round(opex_v * EUR_PER_MWH_TO_MEUR_PER_PJ, 6) if opex_v is not None else None,
        "OperationalLife":     int(life) if life else None,
        "CapacityToActivityUnit": CAPACITY_TO_ACTIVITY,
        "_transmission_efficiency":    round(eff, 6),
        "_loss_per_km":        loss_km,
        "_length_km":          len_km,
        "_units": {
            "CapitalCost":  "MEUR/GW",
            "FixedCost":    "MEUR/GW/yr",
            "VariableCost": "MEUR/PJ",
        },
        **_common_meta(tech),
    }


def _conversion_params(
    tech: ConversionTechnology,
    inst: EquipmentInstance | None,
) -> dict[str, Any]:
    """Conversion / sector-coupling technology → OSeMOSYS TECHNOLOGY dict."""

    eff = (
        _val(inst.electrical_efficiency) if inst else None
    ) or _val(getattr(tech, "fleet_conversion_efficiency", None))

    capex   = _val(inst.capex_per_kw)          if inst else None
    opex_f  = _val(inst.opex_fixed_per_kw_yr)  if inst else None
    opex_v  = _val(inst.opex_variable_per_mwh) if inst else None
    life    = _val(inst.economic_lifetime_yr)   if inst else 20.0

    fuel_in  = _fuel_id(tech.input_carriers[0],  tech) if tech.input_carriers  else "ELEC"
    fuel_out = _fuel_id(tech.output_carriers[0], tech) if tech.output_carriers else "H2"

    input_activity  = round(1.0 / eff, 6) if (eff and eff > 0) else None
    output_activity = 1.0

    return {
        "TECHNOLOGY":          _tech_id(tech),
        "InputActivityRatio":  {fuel_in: input_activity}  if input_activity else {},
        "OutputActivityRatio": {fuel_out: output_activity},
        "CapitalCost":         capex,
        "FixedCost":           opex_f,
        "VariableCost":        round(opex_v * EUR_PER_MWH_TO_MEUR_PER_PJ, 6) if opex_v is not None else None,
        "OperationalLife":     int(life) if life else None,
        "CapacityToActivityUnit": CAPACITY_TO_ACTIVITY,
        "_units": {
            "CapitalCost":  "MEUR/GW",
            "FixedCost":    "MEUR/GW/yr",
            "VariableCost": "MEUR/PJ",
        },
        **_common_meta(tech),
    }


# ---------------------------------------------------------------------------
# Public translator
# ---------------------------------------------------------------------------

def to_osemosys(
    tech: Technology,
    *,
    instance_index: int | None = 0,
) -> dict[str, Any]:
    """
    Translate a Technology (and one of its EquipmentInstances) into an
    OSeMOSYS parameter dictionary.

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
        OSeMOSYS parameter dict keyed by OSeMOSYS parameter names.

        Capacity costs are expressed in **MEUR/GW** (numerically identical to
        EUR/kW).  Energy costs are in **MEUR/PJ**.  ``CapacityToActivityUnit``
        is always 31.536 PJ/GW/yr for electric-sector technologies.

        For ``EnergyStorage``, the result contains a ``"storage_model"`` sub-
        dict with charge/discharge technology records and the shared STORAGE
        entity — see module docstring for details.

    Notes
    -----
    *   All ``None`` values in the returned dict signal a missing / unknown
        parameter that a downstream workflow should fill or ignore.
    *   Fields prefixed with ``_`` are informational only and not part of
        the OSeMOSYS parameter set.
    """
    inst = _resolve_instance(tech, instance_index)

    if tech.category == TechnologyCategory.GENERATION:
        return _generation_params(tech, inst)  # type: ignore[arg-type]
    if tech.category == TechnologyCategory.STORAGE:
        return _storage_params(tech, inst)     # type: ignore[arg-type]
    if tech.category == TechnologyCategory.TRANSMISSION:
        return _transmission_params(tech, inst)  # type: ignore[arg-type]
    if tech.category == TechnologyCategory.CONVERSION:
        return _conversion_params(tech, inst)  # type: ignore[arg-type]

    return {"TECHNOLOGY": _tech_id(tech), **_common_meta(tech)}

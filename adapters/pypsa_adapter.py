"""
adapters/pypsa_adapter.py
=========================
Translates OEO-aligned Technology / EquipmentInstance objects into the
parameter dictionaries expected by PyPSA components.

PyPSA reference docs: https://pypsa.readthedocs.io/en/latest/components.html

Key PyPSA components handled:
  - Generator           → PowerPlant / VREPlant
  - StorageUnit         → EnergyStorage
  - Link                → ConversionTechnology / TransmissionLine

Usage example
-------------
>>> from schemas.models import PowerPlant
>>> from adapters.pypsa_adapter import to_pypsa
>>> import json, pathlib
>>> raw = json.loads(pathlib.Path("data/generation/gas_turbine_ccgt.json").read_text())
>>> plant = PowerPlant.model_validate(raw)
>>> # translate using the first instance (Siemens SGT-800)
>>> params = to_pypsa(plant, instance_index=0)
>>> print(params)
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


def _resolve_instance(tech: Technology, instance_index: int | None) -> EquipmentInstance | None:
    """Return the requested instance, or None if no instances exist."""
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


def _annualized_capex(capex_eur_per_kw: float, lifetime_yr: float, discount_rate: float = 0.07) -> float:
    """
    Convert overnight capex [EUR/kW] to annualised capital cost [EUR/kW/yr]
    using the Capital Recovery Factor (CRF).

        CRF = r * (1+r)^n / ((1+r)^n - 1)
    """
    r, n = discount_rate, lifetime_yr
    crf = r * (1 + r) ** n / ((1 + r) ** n - 1)
    return capex_eur_per_kw * crf


# ---------------------------------------------------------------------------
# Public translator
# ---------------------------------------------------------------------------

def to_pypsa(
    tech: Technology,
    *,
    instance_index: int | None = 0,
    discount_rate: float = 0.07,
) -> dict[str, Any]:
    """
    Translate a Technology (and one of its EquipmentInstances) into a
    PyPSA component parameter dictionary.

    Parameters
    ----------
    tech:
        An OEO-aligned Technology object.
    instance_index:
        Which EquipmentInstance to use. Defaults to 0 (first entry).
        Pass None to use technology-level fleet defaults only.
    discount_rate:
        Annual discount rate used when computing `capital_cost`. Overridden
        per instance if the instance carries its own `discount_rate` field.

    Returns
    -------
    dict
        Ready to pass as keyword arguments to a PyPSA component, e.g.:
        ``network.add("Generator", name, **params)``
    """
    inst = _resolve_instance(tech, instance_index)
    dr   = _val(inst.discount_rate) if (inst and inst.discount_rate) else discount_rate

    # ---- Dispatch by technology category --------------------------------
    if tech.category == TechnologyCategory.GENERATION:
        return _generator_params(tech, inst, dr)  # type: ignore[arg-type]
    if tech.category == TechnologyCategory.STORAGE:
        return _storage_unit_params(tech, inst, dr)  # type: ignore[arg-type]
    if tech.category == TechnologyCategory.TRANSMISSION:
        return _link_params_transmission(tech, inst, dr)  # type: ignore[arg-type]
    if tech.category == TechnologyCategory.CONVERSION:
        return _link_params_conversion(tech, inst, dr)  # type: ignore[arg-type]

    # Fallback — return minimal common fields
    return {"name": tech.name, "_oeo_class": tech.oeo_class}


# ---------------------------------------------------------------------------
# Component-specific translators
# ---------------------------------------------------------------------------

def _generator_params(
    tech: PowerPlant | VREPlant,
    inst: EquipmentInstance | None,
    discount_rate: float,
) -> dict[str, Any]:
    """Translate to PyPSA Generator parameters."""

    # Efficiency: instance → fleet default
    eff = (
        _val(inst.electrical_efficiency) if inst else None
    ) or _val(getattr(tech, "fleet_electrical_efficiency", None))

    # Costs
    capex  = (_val(inst.capex_per_kw) if inst else None) or _val(getattr(tech, "fleet_capex_per_kw", None))
    opex_f = (_val(inst.opex_fixed_per_kw_yr) if inst else None) or _val(getattr(tech, "fleet_opex_fixed_per_kw_yr", None))
    opex_v = _val(inst.opex_variable_per_mwh) if inst else None
    life   = _val(inst.economic_lifetime_yr) if inst else 25.0

    capital_cost = None
    if capex is not None and life:
        capital_cost = _annualized_capex(capex, life, discount_rate)
    if capital_cost is not None and opex_f is not None:
        capital_cost += opex_f  # PyPSA capital_cost = annualised capex + fixed O&M

    # CO₂ intensity → marginal_cost addend removed (PyPSA uses co2_emissions separately)
    co2 = (_val(inst.co2_emission_factor) if inst else None) or _val(getattr(tech, "fleet_co2_emission_factor", None))

    # Ramp limits
    ramp_up   = _val(inst.ramp_up_rate)   if inst else None  # %/min → fraction already?
    ramp_down = _val(inst.ramp_down_rate) if inst else None
    p_min_pu  = _val(inst.min_stable_generation) if inst else None

    params: dict[str, Any] = {
        # --- Identity ---
        "_oeo_class": tech.oeo_class,
        "_oeo_uri":   str(tech.oeo_uri) if tech.oeo_uri else None,
        "_source_label": inst.label if inst else tech.name,
        # --- PyPSA Generator fields ---
        "carrier":        (tech.output_carriers[0].value if tech.output_carriers else "electricity"),
        "p_nom":          _val(inst.capacity_kw) / 1000 if (inst and inst.capacity_kw) else None,  # kW → MW
        "efficiency":     eff,
        "capital_cost":   capital_cost,   # EUR/MW/yr
        "marginal_cost":  opex_v,         # EUR/MWh
        "co2_emissions":  co2,            # tCO2/MWh_fuel
        "committable":    getattr(tech, "is_dispatchable", True),
        "p_min_pu":       p_min_pu,
    }

    # VRE-specific
    if isinstance(tech, VREPlant):
        params.update({
            "p_max_pu":      1.0,   # set externally to time-series for real runs
            "_profile_key":  tech.profile_key,
        })

    # Ramp rates: PyPSA expects fraction-of-capacity per hour
    if ramp_up is not None:
        params["ramp_limit_up"]   = min(ramp_up   / 100 * 60, 1.0)  # %/min → fraction/h capped at 1
    if ramp_down is not None:
        params["ramp_limit_down"] = min(ramp_down / 100 * 60, 1.0)

    return {k: v for k, v in params.items() if v is not None}


def _storage_unit_params(
    tech: EnergyStorage,
    inst: EquipmentInstance | None,
    discount_rate: float,
) -> dict[str, Any]:
    """Translate to PyPSA StorageUnit parameters."""
    rt_eff = _val(getattr(tech, "fleet_roundtrip_efficiency", None))
    e2p    = _val(getattr(tech, "fleet_energy_to_power_ratio", None))
    sdr    = _val(getattr(tech, "fleet_self_discharge_rate", None))

    capex  = _val(inst.capex_per_kw) if inst else None
    opex_f = _val(inst.opex_fixed_per_kw_yr) if inst else None
    life   = _val(inst.economic_lifetime_yr) if inst else 20.0
    eff    = _val(inst.electrical_efficiency) if inst else None

    # PyPSA uses one-way efficiencies; derive from round-trip
    cyclic_eff = eff or (rt_eff ** 0.5 if rt_eff else None)

    capital_cost = None
    if capex is not None and life:
        capital_cost = _annualized_capex(capex, life, discount_rate)
    if capital_cost is not None and opex_f is not None:
        capital_cost += opex_f

    return {k: v for k, v in {
        "_oeo_class":           tech.oeo_class,
        "_oeo_uri":             str(tech.oeo_uri) if tech.oeo_uri else None,
        "_source_label":        inst.label if inst else tech.name,
        "carrier":              "electricity",
        "p_nom":                _val(inst.capacity_kw) / 1000 if (inst and inst.capacity_kw) else None,
        "max_hours":            e2p,
        "efficiency_store":     cyclic_eff,
        "efficiency_dispatch":  cyclic_eff,
        "standing_loss":        sdr * 3600 if sdr else None,  # fraction/h → fraction/3600s (PyPSA per-hour)
        "capital_cost":         capital_cost,
        "marginal_cost":        _val(inst.opex_variable_per_mwh) if inst else None,
        "cyclic_state_of_charge": True,
    }.items() if v is not None}


def _link_params_transmission(
    tech: TransmissionLine,
    inst: EquipmentInstance | None,
    discount_rate: float,
) -> dict[str, Any]:
    """Translate to PyPSA Link parameters for a transmission line."""
    eff    = _val(inst.electrical_efficiency) if inst else None
    capex  = _val(inst.capex_per_kw) if inst else None
    opex_f = _val(inst.opex_fixed_per_kw_yr) if inst else None
    life   = _val(inst.economic_lifetime_yr) if inst else 40.0

    capital_cost = None
    if capex is not None and life:
        capital_cost = _annualized_capex(capex, life, discount_rate)
    if capital_cost is not None and opex_f is not None:
        capital_cost += opex_f

    return {k: v for k, v in {
        "_oeo_class":    tech.oeo_class,
        "_source_label": inst.label if inst else tech.name,
        "carrier":       "electricity",
        "p_nom":         _val(tech.max_capacity_mw) if tech.max_capacity_mw else (
                             _val(inst.capacity_kw) / 1000 if (inst and inst.capacity_kw) else None
                         ),
        "efficiency":    eff,
        "capital_cost":  capital_cost,
        "marginal_cost": 0.0,
    }.items() if v is not None}


def _link_params_conversion(
    tech: ConversionTechnology,
    inst: EquipmentInstance | None,
    discount_rate: float,
) -> dict[str, Any]:
    """Translate to PyPSA Link parameters for a conversion unit (e.g. electrolyzer)."""
    eff    = (_val(inst.electrical_efficiency) if inst else None) or _val(tech.fleet_conversion_efficiency)
    capex  = _val(inst.capex_per_kw) if inst else None
    opex_f = _val(inst.opex_fixed_per_kw_yr) if inst else None
    life   = _val(inst.economic_lifetime_yr) if inst else 20.0

    capital_cost = None
    if capex is not None and life:
        capital_cost = _annualized_capex(capex, life, discount_rate)
    if capital_cost is not None and opex_f is not None:
        capital_cost += opex_f

    bus0_carrier = tech.input_carriers[0].value  if tech.input_carriers  else "electricity"
    bus1_carrier = tech.output_carriers[0].value if tech.output_carriers else "hydrogen"

    return {k: v for k, v in {
        "_oeo_class":    tech.oeo_class,
        "_source_label": inst.label if inst else tech.name,
        "bus0_carrier":  bus0_carrier,
        "bus1_carrier":  bus1_carrier,
        "efficiency":    eff,
        "p_nom":         _val(inst.capacity_kw) / 1000 if (inst and inst.capacity_kw) else None,
        "capital_cost":  capital_cost,
        "marginal_cost": _val(inst.opex_variable_per_mwh) if inst else None,
    }.items() if v is not None}

"""
adapters/adoptnet0_adapter.py
=============================
Translates OEO-aligned Technology / EquipmentInstance objects into the
JSON input files expected by AdOpT-NET0 (Advanced Optimization Tool for
Networks and Energy Technologies, https://github.com/UU-ER/AdOpT-NET0).

AdOpT-NET0 reads one JSON file per technology (``tec_type`` "RES", "STOR",
"CONV1"–"CONV4", …) and one JSON file per network.  The dicts returned here
match those files 1:1 and can be written straight into a case study's
``technology_data`` / ``network_data`` folder:

  OEO category                AdOpT-NET0 output
  ─────────────────────       ─────────────────────────────────────────────
  GENERATION (VRE)            tec_type "RES"    (capacity-factor based)
  GENERATION (dispatchable)   tec_type "CONV2"  (fuel → output(s), linear)
  CONVERSION                  tec_type "CONV2"
  STORAGE                     tec_type "STOR"
  TRANSMISSION                network JSON (networks are separate files
                              in AdOpT-NET0, not technologies)

Unit conversions applied (OpenTech-DB → AdOpT-NET0):

  capex      [USD/kW]     → unit_CAPEX    [USD/MW]   (×1000; CONV/RES, size in MW)
  capex      [USD/kW]     → unit_CAPEX    [USD/MWh]  (×1000 ÷ duration_h; STOR, size in MWh)
  opex fixed [USD/kW/yr]  → OPEX_fixed    [fraction of up-front CAPEX per year]
  opex var   [USD/MWh]    → OPEX_variable [USD/MWh]  (1:1)
  loss rate  [%/km]       → loss          [fraction/km]
  c-rate     [1/h]        → charge_rate / discharge_rate  (1:1)

Notes
-----
*   ``discount_rate`` is exported as ``-1`` when the instance does not carry
    one — AdOpT-NET0 then falls back to the global discount rate in its
    model configuration.
*   ``min_part_load`` is exported as ``0``: with ``performance_function_type
    1`` (linear, no on/off integers) AdOpT-NET0 would otherwise force the
    technology to run above min load in *every* timestep.  The measured
    value is preserved in the ``OpenTechDB`` block.
*   Every exported dict carries an extra ``OpenTechDB`` block with
    provenance (sources, instance id, OEO class) and a list of defaults
    that were applied.  AdOpT-NET0 ignores unknown keys, so the block is
    harmless on ingestion.

Usage example
-------------
>>> from adapters.adoptnet0_adapter import to_adoptnet0
>>> params = to_adoptnet0(tech, instance_index=0)
>>> with open(f"{tech.name}.json", "w") as fh:
...     json.dump(params, fh, indent=2)
"""

from __future__ import annotations

import math
from typing import Any

from schemas.models import (
    Technology,
    VREPlant,
    EnergyStorage,
    TransmissionLine,
    TechnologyCategory,
    EnergyCarrier,
    EquipmentInstance,
)

# ---------------------------------------------------------------------------
# Carrier vocabulary (AdOpT-NET0 template conventions)
# ---------------------------------------------------------------------------

_CARRIER_MAP: dict[EnergyCarrier, str] = {
    EnergyCarrier.ELECTRICITY: "electricity",
    EnergyCarrier.NATURAL_GAS: "gas",
    EnergyCarrier.METHANE:     "gas",
    EnergyCarrier.HYDROGEN:    "hydrogen",
    EnergyCarrier.HEAT:        "heat",
    EnergyCarrier.COOLING:     "cooling",
    EnergyCarrier.CO2:         "CO2captured",
}

_THERMAL_CARRIERS = {EnergyCarrier.HEAT, EnergyCarrier.STEAM, EnergyCarrier.COOLING}

# Default size caps, matching the magnitudes used in AdOpT-NET0 templates.
_DEFAULT_SIZE_MAX_MW  = 10_000        # CONV / RES / networks [MW]
_DEFAULT_SIZE_MAX_MWH = 1.0e7         # STOR [MWh]


def _carrier(c: EnergyCarrier | None) -> str | None:
    if c is None:
        return None
    return _CARRIER_MAP.get(c, c.value)


def _carriers(lst: list[EnergyCarrier]) -> list[str]:
    seen: list[str] = []
    for c in lst:
        mapped = _CARRIER_MAP.get(c, c.value)
        if mapped not in seen:
            seen.append(mapped)
    return seen


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


def _extra_num(inst: EquipmentInstance | None, *keys: str) -> float | None:
    """First numeric value found in inst.extra under any of `keys`."""
    if inst is None or not inst.extra:
        return None
    for key in keys:
        v = inst.extra.get(key)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return float(v)
    return None


def _collect_sources(inst: EquipmentInstance | None) -> list[str]:
    if inst is None:
        return []
    sources: list[str] = []
    for pv in (
        inst.capex_per_kw, inst.capex_per_kwh, inst.opex_fixed_per_kw_yr,
        inst.opex_variable_per_mwh, inst.economic_lifetime_yr,
        inst.electrical_efficiency, inst.thermal_efficiency,
        inst.co2_emission_factor,
    ):
        if pv is not None and pv.source and pv.source not in sources:
            sources.append(pv.source)
    ref = (inst.extra or {}).get("reference_source")
    if ref and ref not in sources:
        sources.append(ref)
    return sources


def _meta_block(
    tech: Technology,
    inst: EquipmentInstance | None,
    defaults_applied: list[str],
    **extra_meta: Any,
) -> dict[str, Any]:
    """Provenance block appended to every export (ignored by AdOpT-NET0)."""
    return {
        "comment":          "Exported by OpenTech-DB; provenance block, ignored by AdOpT-NET0.",
        "technology_name":  tech.name,
        "oeo_class":        tech.oeo_class,
        "oeo_uri":          str(tech.oeo_uri) if tech.oeo_uri else None,
        "instance_id":      str((inst.extra or {}).get("instance_id", "")) if inst else None,
        "instance_label":   inst.label if inst else None,
        "currency":         "USD",
        "sources":          _collect_sources(inst),
        "defaults_applied": defaults_applied,
        **extra_meta,
    }


def _economics(
    inst: EquipmentInstance | None,
    defaults: list[str],
    *,
    unit_capex: float | None,
    capex_comment: str,
) -> dict[str, Any]:
    """Build the AdOpT-NET0 Economics block (CAPEX model 1, linear)."""
    capex_kw = _val(inst.capex_per_kw) if inst else None
    opex_f   = _val(inst.opex_fixed_per_kw_yr) if inst else None
    opex_v   = _val(inst.opex_variable_per_mwh) if inst else None
    lifetime = _val(inst.economic_lifetime_yr) if inst else None
    dr       = _val(inst.discount_rate) if inst else None

    if unit_capex is None:
        unit_capex = 0.0
        defaults.append("unit_CAPEX=0 (no capex data)")

    # AdOpT-NET0 expects fixed OPEX as an annual fraction of up-front CAPEX.
    if opex_f is not None and capex_kw:
        opex_fixed_frac = round(opex_f / capex_kw, 6)
    else:
        opex_fixed_frac = 0.0
        if opex_f is not None:
            defaults.append("OPEX_fixed=0 (no capex to express fixed OPEX as fraction)")

    if lifetime is None:
        lifetime = 25
        defaults.append("lifetime=25 yr (missing)")

    return {
        "comment": capex_comment,
        "CAPEX_model":   1,
        "unit_CAPEX":    unit_capex,
        "fix_CAPEX":     0,
        "OPEX_variable": opex_v if opex_v is not None else 0,
        "OPEX_fixed":    opex_fixed_frac,
        "discount_rate": dr if dr is not None else -1,
        "lifetime":      lifetime,
        "decommission_cost": 0,
    }


def _ramping_time_h(inst: EquipmentInstance | None) -> float:
    """
    AdOpT-NET0 ramping_time = hours to ramp across the full capacity range
    (ramping_rate = size / ramping_time).  -1 disables the constraint;
    rates faster than 1 h full-range are not binding at hourly resolution.
    """
    ramp_pct_min = _val(inst.ramp_up_rate) if inst else None
    if not ramp_pct_min or ramp_pct_min <= 0:
        return -1
    full_range_h = (100.0 / ramp_pct_min) / 60.0
    return round(full_range_h, 4) if full_range_h > 1.0 else -1


# ---------------------------------------------------------------------------
# Category translators
# ---------------------------------------------------------------------------

def _res_block(tech: VREPlant, inst: EquipmentInstance | None) -> dict[str, Any]:
    """VRE plant → AdOpT-NET0 tec_type RES (capacity-factor based, no input)."""
    defaults: list[str] = []

    capex_kw = _val(inst.capex_per_kw) if inst else None
    out_cars = _carriers(tech.output_carriers) or ["electricity"]

    performance: dict[str, Any] = {
        "comment": "contains fitting data on unit of input, technology types and input/output carriers",
        "output_carrier": out_cars,
        "curtailment": 1,
        "emission_factor": (_val(inst.co2_emission_factor) if inst else None) or 0,
    }
    # AdOpT-NET0 fits wind performance from hub height when present.
    hub_height = _extra_num(inst, "hub_height_m", "hubheight")
    if hub_height is not None:
        performance["hubheight"] = hub_height

    name_lower = f"{tech.name} {getattr(tech, 'technology_type', '') or ''}".lower()
    if "csp" in name_lower or "solar_thermal" in name_lower or "solarthermal" in name_lower:
        suggested = "SolarThermal"
    elif "offshore" in name_lower:
        suggested = "WindTurbine_Offshore_6000"
    elif "wind" in name_lower or "marine" in name_lower:
        suggested = "WindTurbine_Onshore_4000"
    else:
        suggested = "Photovoltaic"

    return {
        "tec_type": "RES",
        "size_min": 0,
        "size_max": _DEFAULT_SIZE_MAX_MW,
        "size_is_int": 0,
        "decommission": "impossible",
        "Economics": _economics(
            inst, defaults,
            unit_capex=capex_kw * 1000 if capex_kw is not None else None,
            capex_comment="CAPEX in USD/MW, OPEX_variable in USD/MWh total output, OPEX_fixed in % of up-front CAPEX",
        ),
        "Performance": performance,
        "Units": {
            "size": "MW",
            "output_carrier": {c: "MW" for c in out_cars},
        },
        "OpenTechDB": _meta_block(
            tech, inst, defaults,
            suggested_adoptnet0_name=suggested,
            note="AdOpT-NET0 fits RES capacity factors by technology *name* "
                 "(Photovoltaic / WindTurbine_* / SolarThermal); name the JSON "
                 "file accordingly.",
        ),
    }


def _conv_block(tech: Technology, inst: EquipmentInstance | None) -> dict[str, Any]:
    """Dispatchable generation or conversion → tec_type CONV2, linear fit."""
    defaults: list[str] = []

    capex_kw = _val(inst.capex_per_kw) if inst else None
    in_cars  = _carriers(tech.input_carriers)
    out_cars = _carriers(tech.output_carriers) or ["electricity"]
    if not in_cars:
        primary = getattr(tech, "primary_fuel", None)
        in_cars = [_carrier(primary)] if primary else ["electricity"]
        defaults.append(f"input_carrier={in_cars} (not specified in source data)")

    el_eff = _val(inst.electrical_efficiency) if inst else None
    th_eff = _val(inst.thermal_efficiency) if inst else None

    # CONV2: each output carrier is a linear function of total input.
    out_performance: dict[str, list[float]] = {}
    for car in tech.output_carriers or [EnergyCarrier.ELECTRICITY]:
        eff = th_eff if car in _THERMAL_CARRIERS else el_eff
        if eff is None:
            eff = el_eff if el_eff is not None else th_eff
        if eff is None:
            eff = 1.0
            defaults.append(f"efficiency for '{_carrier(car)}'=1.0 (missing)")
        out_performance[_carrier(car)] = [0, round(eff, 6)]

    min_part_load = (
        _val(inst.min_stable_generation) if inst else None
    ) or _extra_num(inst, "min_load_fraction")

    return {
        "tec_type": "CONV2",
        "size_min": 0,
        "size_max": _DEFAULT_SIZE_MAX_MW,
        "size_is_int": 0,
        "size_based_on": "output",
        "decommission": "impossible",
        "Economics": _economics(
            inst, defaults,
            unit_capex=capex_kw * 1000 if capex_kw is not None else None,
            capex_comment="CAPEX in USD/MW, OPEX_variable in USD/MWh total output, OPEX_fixed in % of up-front CAPEX",
        ),
        "Performance": {
            "comment": "contains fitting data on unit of input, technology types and input/output carriers",
            "performance_function_type": 1,
            "input_carrier":      in_cars,
            "main_input_carrier": in_cars[0],
            "output_carrier":     out_cars,
            "emission_factor":    (_val(inst.co2_emission_factor) if inst else None) or 0,
            "min_part_load":      0,
            "performance": {
                "in":  [0, 1],
                "out": out_performance,
            },
            "ramping_time":      _ramping_time_h(inst),
            "ref_size":          -1,
            "ramping_const_int": -1,
            "standby_power":     -1,
            "min_uptime":        -1,
            "min_downtime":      -1,
            "SU_time":           -1,
            "SD_time":           -1,
            "SU_load":           -1,
            "SD_load":           -1,
            "max_startups":      -1,
        },
        "Units": {
            "size": "MW",
            "input_carrier":  {c: "MW" for c in in_cars},
            "output_carrier": {c: "MW" for c in out_cars},
        },
        "OpenTechDB": _meta_block(
            tech, inst, defaults,
            measured_min_part_load=min_part_load,
            note="min_part_load exported as 0: with performance_function_type 1 "
                 "AdOpT-NET0 would enforce it in every timestep (must-run).",
        ),
    }


def _stor_block(tech: EnergyStorage, inst: EquipmentInstance | None) -> dict[str, Any]:
    """Energy storage → tec_type STOR (size in MWh, CAPEX per MWh)."""
    defaults: list[str] = []

    stored = _carrier(tech.stored_carrier) or "electricity"
    in_cars  = _carriers(tech.input_carriers)  or [stored]
    out_cars = _carriers(tech.output_carriers) or [stored]
    main_in  = stored if stored in in_cars else in_cars[0]

    # --- Charge / discharge efficiency ---------------------------------
    eta_in  = _extra_num(inst, "charge_efficiency_fraction")
    eta_out = _extra_num(inst, "discharge_efficiency_fraction")
    if eta_in is None or eta_out is None:
        roundtrip = _extra_num(inst, "roundtrip_efficiency_fraction")
        if roundtrip is None:
            roundtrip = _val(inst.electrical_efficiency) if inst else None
        if roundtrip is not None:
            side = round(math.sqrt(roundtrip), 6)
            eta_in  = eta_in  if eta_in  is not None else side
            eta_out = eta_out if eta_out is not None else side
        else:
            eta_in, eta_out = 1.0, 1.0
            defaults.append("eta_in=eta_out=1.0 (no efficiency data)")

    # --- Self-discharge --------------------------------------------------
    self_discharge = (
        _val(getattr(tech, "fleet_self_discharge_rate", None))
        or _extra_num(inst, "self_discharge_fraction_per_h", "self_discharge_rate")
        or 0
    )

    # --- Energy/power coupling -------------------------------------------
    duration_h = _extra_num(inst, "duration_hours")
    if duration_h is None:
        energy_mwh = _extra_num(inst, "energy_capacity_mwh")
        power_mw   = _extra_num(inst, "typical_capacity_mw")
        if energy_mwh and power_mw:
            duration_h = energy_mwh / power_mw
    if duration_h is None:
        e2p = _val(getattr(tech, "fleet_energy_to_power_ratio", None))
        duration_h = e2p if e2p else None

    charge_rate    = _extra_num(inst, "c_rate_max_charge")
    discharge_rate = _extra_num(inst, "c_rate_max_discharge")
    if charge_rate is None:
        charge_rate = round(1 / duration_h, 6) if duration_h else 0.25
        if not duration_h:
            defaults.append("charge_rate=0.25 (no c-rate or duration data)")
    if discharge_rate is None:
        discharge_rate = round(1 / duration_h, 6) if duration_h else 0.25
        if not duration_h:
            defaults.append("discharge_rate=0.25 (no c-rate or duration data)")

    # --- CAPEX per MWh of energy capacity --------------------------------
    capex_kwh = _val(inst.capex_per_kwh) if inst else None
    capex_kw  = _val(inst.capex_per_kw) if inst else None
    if capex_kwh is not None:
        unit_capex = capex_kwh * 1000
    elif capex_kw is not None and duration_h:
        unit_capex = round(capex_kw * 1000 / duration_h, 2)
    elif capex_kw is not None:
        # No duration: treat power CAPEX as energy CAPEX for a 1 h system.
        unit_capex = capex_kw * 1000
        defaults.append("unit_CAPEX assumes 1 h duration (no energy-capacity data)")
    else:
        unit_capex = None

    return {
        "tec_type": "STOR",
        "size_min": 0,
        "size_max": _DEFAULT_SIZE_MAX_MWH,
        "size_is_int": 0,
        "decommission": "impossible",
        "Economics": _economics(
            inst, defaults,
            unit_capex=unit_capex,
            capex_comment="CAPEX in USD/MWh, OPEX_variable in USD/MWh total output, OPEX_fixed in % of up-front CAPEX",
        ),
        "Performance": {
            "comment": "contains fitting data on unit of input, technology types and input/output carriers",
            "input_carrier":      in_cars,
            "main_input_carrier": main_in,
            "output_carrier":     out_cars,
            "emission_factor":    (_val(inst.co2_emission_factor) if inst else None) or 0,
            "allow_only_one_direction": 1,
            "performance": {
                "eta_in":  eta_in,
                "eta_out": eta_out,
                "lambda":  self_discharge,
                "theta":   0,
            },
        },
        "Flexibility": {
            "comment": "determines the flexibility of the power capacity compared to the energy capacity",
            "power_energy_ratio":     "fixedratio",
            "charge_rate":            charge_rate,
            "discharge_rate":         discharge_rate,
            "capex_charging_power":   0,
            "capex_discharging_power": 0,
        },
        "Units": {
            "size": "MWh",
            "input_carrier":  {c: "MW" for c in in_cars},
            "output_carrier": {c: "MW" for c in out_cars},
        },
        "OpenTechDB": _meta_block(
            tech, inst, defaults,
            storage_type=getattr(tech, "storage_type", None),
            duration_hours=duration_h,
        ),
    }


def _network_block(tech: TransmissionLine, inst: EquipmentInstance | None) -> dict[str, Any]:
    """
    Transmission line / pipeline → AdOpT-NET0 *network* JSON.

    Networks are a separate input class in AdOpT-NET0 (network_data folder,
    arc-based, with distance matrices).  CAPEX model there is
    ``gamma1 + gamma2·S + gamma3·L + gamma4·S·L``; when a corridor length is
    known the per-kW cost is converted to a per-MW-per-km coefficient
    (gamma4), otherwise it is exported as a per-MW coefficient (gamma2).
    """
    defaults: list[str] = []

    carrier = _carriers(tech.output_carriers or tech.input_carriers) or ["electricity"]
    carrier = carrier[0]

    capex_kw  = _val(inst.capex_per_kw) if inst else None
    opex_f    = _val(inst.opex_fixed_per_kw_yr) if inst else None
    opex_v    = _val(inst.opex_variable_per_mwh) if inst else None
    lifetime  = _val(inst.economic_lifetime_yr) if inst else None
    dr        = _val(inst.discount_rate) if inst else None

    length_km = (
        _val(tech.length_km)
        or _extra_num(inst, "corridor_length_km")
    )

    gamma2 = 0.0
    gamma4 = 0.0
    if capex_kw is not None and length_km:
        gamma4 = round(capex_kw * 1000 / length_km, 4)
    elif capex_kw is not None:
        gamma2 = capex_kw * 1000
        defaults.append("CAPEX as gamma2 [USD/MW] (no corridor length for USD/MW/km)")
    else:
        defaults.append("gamma2=gamma4=0 (no capex data)")

    # loss: fraction of transported energy per km
    loss_per_km = (
        _val(tech.loss_per_km)
        or (lambda p: p / 100 if p is not None else None)(_extra_num(inst, "loss_rate_pct_per_km"))
    )
    if loss_per_km is None:
        eff = _val(inst.electrical_efficiency) if inst else None
        if eff is not None and length_km:
            loss_per_km = round((1 - eff) / length_km, 8)
        else:
            loss_per_km = 0
            defaults.append("loss=0 (no loss data)")

    if opex_f is not None and capex_kw:
        opex_fixed_frac = round(opex_f / capex_kw, 6)
    else:
        opex_fixed_frac = 0.0

    if lifetime is None:
        lifetime = 40
        defaults.append("lifetime=40 yr (missing)")

    return {
        "network_type": "electricity" if carrier == "electricity" else "fluid",
        "size_min": 0,
        "size_max": _DEFAULT_SIZE_MAX_MW,
        "size_is_int": 0,
        "decommission": "impossible",
        "Economics": {
            "comment": "CAPEX coefficients are in USD, USD/MW or USD/MW/km, OPEX_variable in USD/MWh total output, OPEX_fixed in % of up-front CAPEX",
            "gamma1": 0,
            "gamma2": gamma2,
            "gamma3": 0,
            "gamma4": gamma4,
            "OPEX_variable": opex_v if opex_v is not None else 0,
            "OPEX_fixed":    opex_fixed_frac,
            "discount_rate": dr if dr is not None else -1,
            "lifetime":      lifetime,
            "decommission_cost": 0,
        },
        "Performance": {
            "carrier":           carrier,
            "loss":              loss_per_km,
            "min_transport":     0,
            "bidirectional_network": 0,
            "loss2emissions":    0,
            "emissionfactor":    0,
            "energyconsumption": [],
        },
        "Units": {
            "size": "MW",
            "transport_carrier": {carrier: "MW"},
        },
        "OpenTechDB": _meta_block(
            tech, inst, defaults,
            transmission_type=getattr(tech, "transmission_type", None),
            reference_length_km=length_km,
            note="This is an AdOpT-NET0 *network* definition (network_data "
                 "folder), not a technology; loss is per km of arc length.",
        ),
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
    AdOpT-NET0 input JSON dict.

    Parameters
    ----------
    tech:
        An OEO-aligned Technology object.
    instance_index:
        Which EquipmentInstance to use. Defaults to 0 (first entry).
        Pass ``None`` to use the first instance if any.

    Returns
    -------
    dict
        The exact content of an AdOpT-NET0 JSON input file:

        - GENERATION (VRE)           → technology JSON, ``tec_type`` "RES"
        - GENERATION (dispatchable)  → technology JSON, ``tec_type`` "CONV2"
        - CONVERSION                 → technology JSON, ``tec_type`` "CONV2"
        - STORAGE                    → technology JSON, ``tec_type`` "STOR"
        - TRANSMISSION               → *network* JSON (``network_type`` key)

        Write it to ``<TechnologyName>.json`` inside the case study's
        ``technology_data`` (or ``network_data``) folder.  The extra
        ``OpenTechDB`` key carries provenance and is ignored by AdOpT-NET0.
    """
    inst = _resolve_instance(tech, instance_index)

    if tech.category == TechnologyCategory.GENERATION:
        if isinstance(tech, VREPlant) or not getattr(tech, "is_dispatchable", True):
            return _res_block(tech, inst)  # type: ignore[arg-type]
        return _conv_block(tech, inst)
    if tech.category == TechnologyCategory.STORAGE:
        return _stor_block(tech, inst)     # type: ignore[arg-type]
    if tech.category == TechnologyCategory.TRANSMISSION:
        return _network_block(tech, inst)  # type: ignore[arg-type]
    if tech.category == TechnologyCategory.CONVERSION:
        return _conv_block(tech, inst)

    raise ValueError(f"Unsupported technology category: {tech.category!r}")

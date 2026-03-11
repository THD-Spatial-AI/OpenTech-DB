"""
schemas/models.py
=================
Core Pydantic data models aligned with the Open Energy Ontology (OEO).

OEO reference: https://openenergy-platform.org/ontology/oeo/

Key OEO concepts mapped here:
  - oeo:PowerGeneratingUnit          → PowerPlant
  - oeo:ElectricEnergyStorageUnit    → EnergyStorage
  - oeo:TransmissionLine             → TransmissionLine
  - oeo:ConversionUnit               → ConversionTechnology
  - oeo:CapitalExpenditure           → capex_per_kw
  - oeo:OperationAndMaintenanceCost  → opex_fixed_per_kw, opex_variable_per_mwh
  - oeo:ElectricalEfficiency         → electrical_efficiency
  - oeo:CO2EmissionFactor            → co2_emission_factor
  - oeo:RampingRate                  → ramp_up_rate, ramp_down_rate
  - oeo:InstalledCapacity            → capacity_kw (on EquipmentInstance)
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any
from uuid import uuid4

from pydantic import BaseModel, Field, HttpUrl, model_validator
from uuid import UUID


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class TechnologyCategory(str, Enum):
    """Broad OEO-aligned technology categories."""
    GENERATION  = "generation"
    STORAGE     = "storage"
    TRANSMISSION = "transmission"
    CONVERSION  = "conversion"


class EnergyCarrier(str, Enum):
    """Energy carriers following OEO vocabulary."""
    ELECTRICITY      = "electricity"
    NATURAL_GAS      = "natural_gas"
    HYDROGEN         = "hydrogen"
    HEAT             = "heat"
    COOLING          = "cooling"
    STEAM            = "steam"
    OIL              = "oil"
    COAL             = "coal"
    BIOMASS          = "biomass"
    BIOGAS           = "biogas"
    SYNGAS           = "syngas"
    WATER            = "water"
    CO2              = "co2"
    AMMONIA          = "ammonia"
    WIND             = "wind"
    SOLAR_IRRADIANCE = "solar_irradiance"
    NUCLEAR_FUEL     = "nuclear_fuel"


class LifeCycleStage(str, Enum):
    """Lifecycle stage of an equipment instance."""
    COMMERCIAL    = "commercial"
    DEMONSTRATION = "demonstration"
    PROJECTION    = "projection"
    RETIRED       = "retired"


# ---------------------------------------------------------------------------
# Shared value-with-uncertainty helper
# ---------------------------------------------------------------------------

class ParameterValue(BaseModel):
    """
    A scalar parameter that may carry uncertainty bounds and a data source.
    Aligns with oeo:MeasuredValue / oeo:UncertaintyValue.
    """
    value: float = Field(..., description="Central / best-estimate value.")
    unit:  str   = Field(..., description="SI or conventional unit string (e.g. 'EUR/kW', '%', 'tCO2/MWh').")
    min:   float | None = Field(None, description="Lower uncertainty bound.")
    max:   float | None = Field(None, description="Upper uncertainty bound.")
    source: str  | None = Field(None, description="Bibliographic reference or URL.")
    year:   int  | None = Field(None, description="Reference year for the value.")

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def bounds_consistent(self) -> "ParameterValue":
        if self.min is not None and self.max is not None:
            if self.min > self.max:
                raise ValueError("`min` must be ≤ `max`.")
        return self


# ---------------------------------------------------------------------------
# Equipment instance  (one row = one real-world model / projection)
# ---------------------------------------------------------------------------

class EquipmentInstance(BaseModel):
    """
    One concrete equipment record within a Technology definition.

    Allows multiple manufacturer variants, years, or projection scenarios
    to coexist under the same technology umbrella.

    OEO alignment: oeo:Artefact / oeo:PowerGeneratingUnit individual.
    """
    id:           UUID        = Field(default_factory=uuid4)
    label:        str         = Field(..., description="Human-readable label, e.g. 'Siemens SGT-800 (2024)'.")
    manufacturer: str | None  = Field(None, description="Manufacturer or data source name.")
    reference_year: int | None = Field(None, description="Year the data represent.")
    life_cycle_stage: LifeCycleStage = Field(LifeCycleStage.COMMERCIAL)

    # --- Economic parameters (OEO: oeo:CapitalExpenditure, oeo:OperationAndMaintenanceCost) ---
    capex_per_kw:          ParameterValue | None = Field(None, description="Capital expenditure [EUR/kW or USD/kW].")
    opex_fixed_per_kw_yr:  ParameterValue | None = Field(None, description="Annual fixed O&M cost [EUR/kW/yr].")
    opex_variable_per_mwh: ParameterValue | None = Field(None, description="Variable O&M cost [EUR/MWh].")
    economic_lifetime_yr:  ParameterValue | None = Field(None, description="Economic/technical lifetime [years].")
    discount_rate:         ParameterValue | None = Field(None, description="Project discount rate [fraction, e.g. 0.07].")

    # --- Technical parameters (OEO: oeo:ElectricalEfficiency, oeo:ThermalEfficiency) ---
    electrical_efficiency:  ParameterValue | None = Field(None, description="Net electrical efficiency [fraction].")
    thermal_efficiency:     ParameterValue | None = Field(None, description="Net thermal efficiency [fraction].")
    capacity_kw:            ParameterValue | None = Field(None, description="Installed / nameplate capacity [kW].")
    capacity_factor:        ParameterValue | None = Field(None, description="Annual average capacity factor [fraction].")

    # --- Environmental (OEO: oeo:CO2EmissionFactor) ---
    co2_emission_factor:    ParameterValue | None = Field(None, description="Direct CO₂ emissions [tCO₂/MWh_fuel].")

    # --- Operational flexibility (OEO: oeo:RampingRate) ---
    ramp_up_rate:           ParameterValue | None = Field(None, description="Max ramp-up rate [% of capacity / min].")
    ramp_down_rate:         ParameterValue | None = Field(None, description="Max ramp-down rate [% of capacity / min].")
    min_stable_generation:  ParameterValue | None = Field(None, description="Minimum stable generation [fraction of capacity].")
    start_up_cost:          ParameterValue | None = Field(None, description="Start-up cost [EUR/MW or USD/MW].")

    # --- Storage / conversion instance-level parameters ---
    # These map to Calliope constraint / cost keys that have no generic equivalent.
    capex_per_kwh:     ParameterValue | None = Field(
        None,
        description="Storage energy capacity CAPEX [EUR/kWh or USD/kWh]. "
                    "Maps to Calliope costs.{cost_class}.storage_cap [EUR/kWh].",
    )
    fuel_cost_per_mwh: ParameterValue | None = Field(
        None,
        description="Input carrier / fuel cost [EUR/MWh]. "
                    "Maps to Calliope costs.{cost_class}.om_con [EUR/kWh after ÷1000].",
    )
    initial_soc:       ParameterValue | None = Field(
        None,
        description="Initial state of charge at the first model timestep [fraction 0–1]. "
                    "Maps to Calliope constraints.storage_initial.",
    )

    # --- Arbitrary extra parameters for model-specific needs ---
    extra: dict[str, Any] = Field(default_factory=dict, description="Model-specific or extended parameters.")

    model_config = {"extra": "allow"}


# ---------------------------------------------------------------------------
# Base Technology
# ---------------------------------------------------------------------------

class Technology(BaseModel):
    """
    Abstract base for all energy technologies.

    OEO class: oeo:EnergyConversionDevice (parent of all below).
    """
    id:          UUID   = Field(default_factory=uuid4)
    name:        str    = Field(..., description="Canonical technology name.")
    category:    TechnologyCategory
    description: str | None = Field(None)
    tags:        list[str]  = Field(default_factory=list, description="Free taxonomy tags.")

    # OEO linkage (primary concept URI)
    oeo_class:   str | None = Field(
        None,
        description="Short OEO class name, e.g. 'oeo:GasTurbine'.",
        examples=["oeo:GasTurbine", "oeo:PhotovoltaicPlant"],
    )
    oeo_uri:     HttpUrl | None = Field(
        None,
        description="Full IRI linking to the OEO concept.",
        examples=["https://openenergy-platform.org/ontology/oeo/OEO_00000150"],
    )

    # Energy carriers
    input_carriers:  list[EnergyCarrier] = Field(default_factory=list)
    output_carriers: list[EnergyCarrier] = Field(default_factory=list)

    # Multiple equipment instances (manufacturers, years, scenarios …)
    instances: list[EquipmentInstance] = Field(
        default_factory=list,
        description="One entry per manufacturer model or projection year.",
    )

    model_config = {"extra": "forbid"}


# ---------------------------------------------------------------------------
# Generation technologies
# ---------------------------------------------------------------------------

class PowerPlant(Technology):
    """
    Thermal or renewable power generation unit.
    OEO class: oeo:PowerGeneratingUnit
    """
    category: TechnologyCategory = TechnologyCategory.GENERATION

    # Technology-level defaults (may be overridden per instance)
    technology_type: str | None = Field(
        None,
        description="Sub-type, e.g. 'CCGT', 'PV_utility', 'onshore_wind'.",
    )
    primary_fuel: EnergyCarrier | None = None
    is_dispatchable: bool = Field(True, description="True for controllable plants.")
    is_renewable: bool    = Field(False)

    # Typical fleet-wide values (if no instance specifies them)
    fleet_capex_per_kw:   ParameterValue | None = None
    fleet_opex_fixed_per_kw_yr: ParameterValue | None = None
    fleet_electrical_efficiency: ParameterValue | None = None
    fleet_co2_emission_factor:   ParameterValue | None = None


class VREPlant(PowerPlant):
    """
    Variable Renewable Energy plant (wind, PV).
    OEO class: oeo:RenewableEnergyPlant
    """
    is_dispatchable: bool = False
    is_renewable:    bool = True
    # time-series profile key (e.g. reference to a capacity factor profile)
    profile_key: str | None = Field(
        None,
        description="Key referencing hourly/sub-hourly capacity factor profile data.",
    )

    # --- VRE-specific Calliope constraints ---
    force_resource:       bool               = Field(
        False,
        description="Force all available resource to be consumed each timestep (must-run). "
                    "Maps to Calliope constraints.force_resource.",
    )
    resource_efficiency:  ParameterValue | None = Field(
        None,
        description="Resource capture efficiency, e.g. CSP collector reflectivity [fraction]. "
                    "Maps to Calliope constraints.resource_eff.",
    )
    parasitic_efficiency: ParameterValue | None = Field(
        None,
        description="Post-conversion internal loss, e.g. PV DC\u2192AC inverter [fraction]. "
                    "Maps to Calliope constraints.parasitic_eff.",
    )
    resource_area_max_m2: ParameterValue | None = Field(
        None,
        description="Maximum deployable resource capture area [m\u00b2]. "
                    "Maps to Calliope constraints.resource_area_max.",
    )
    resource_area_per_kw: ParameterValue | None = Field(
        None,
        description="Resource area required per kW of installed capacity [m\u00b2/kW]. "
                    "Maps to Calliope constraints.resource_area_per_energy_cap.",
    )


# ---------------------------------------------------------------------------
# Storage technologies
# ---------------------------------------------------------------------------

class EnergyStorage(Technology):
    """
    Energy storage unit.
    OEO class: oeo:ElectricEnergyStorageUnit
    """
    category: TechnologyCategory = TechnologyCategory.STORAGE

    storage_type: str | None = Field(None, description="e.g. 'lithium_ion', 'pumped_hydro', 'compressed_air'.")
    stored_carrier: EnergyCarrier | None = None

    # Storage-specific instance defaults
    fleet_roundtrip_efficiency: ParameterValue | None = Field(
        None, description="Round-trip efficiency [fraction]."
    )
    fleet_energy_to_power_ratio: ParameterValue | None = Field(
        None, description="Hours of storage at rated power [h]."
    )
    fleet_self_discharge_rate:   ParameterValue | None = Field(
        None, description="Self-discharge per hour [fraction/h]."
    )
    fleet_dod_max:               ParameterValue | None = Field(
        None, description="Maximum depth-of-discharge [fraction]."
    )
    fleet_cycle_lifetime:        ParameterValue | None = Field(
        None, description="Cycle lifetime [full charge-discharge cycles]."
    )


# ---------------------------------------------------------------------------
# Transmission technologies
# ---------------------------------------------------------------------------

class TransmissionLine(Technology):
    """
    Power or gas transmission infrastructure.
    OEO class: oeo:TransmissionLine / oeo:Pipeline
    """
    category: TechnologyCategory = TechnologyCategory.TRANSMISSION

    transmission_type: str | None = Field(None, description="e.g. 'HVAC', 'HVDC', 'gas_pipeline'.")
    voltage_kv:        ParameterValue | None = None
    length_km:         ParameterValue | None = None
    loss_per_km:       ParameterValue | None = Field(
        None, description="Electrical loss per km [fraction/km]."
    )
    max_capacity_mw:   ParameterValue | None = None


# ---------------------------------------------------------------------------
# Conversion technologies
# ---------------------------------------------------------------------------

class ConversionTechnology(Technology):
    """
    Energy conversion unit (e.g. electrolyzer, fuel cell, heat pump).
    OEO class: oeo:EnergyConversionDevice
    """
    category: TechnologyCategory = TechnologyCategory.CONVERSION

    conversion_type: str | None = Field(None, description="e.g. 'electrolyzer_PEM', 'fuel_cell_SOFC', 'heat_pump_ASHP'.")
    fleet_conversion_efficiency: ParameterValue | None = Field(
        None, description="Primary conversion efficiency [fraction]."
    )


# ---------------------------------------------------------------------------
# Registry / Catalogue response models
# ---------------------------------------------------------------------------

class TechnologySummary(BaseModel):
    """Lightweight summary used in list endpoints."""
    id:         UUID
    name:       str
    category:   TechnologyCategory
    oeo_class:  str | None
    oeo_uri:    HttpUrl | None
    n_instances: int = Field(0, description="Number of equipment instances available.")

    model_config = {"from_attributes": True}


class TechnologyCatalogue(BaseModel):
    """Top-level catalogue response."""
    total: int
    technologies: list[TechnologySummary]

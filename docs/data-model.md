# Data Model

The data model is defined in `schemas/models.py` using Pydantic v2. All classes map to [Open Energy Ontology](https://openenergy-platform.org/ontology/oeo/) concepts.

---

## Class Hierarchy

```
Technology  ← oeo:EnergyConversionDevice
│  id (UUID)  name  category  description  tags
│  oeo_class  oeo_uri             ← OEO linkage
│  input_carriers  output_carriers
│  instances: list[EquipmentInstance]
│
├── PowerPlant    ← oeo:PowerGeneratingUnit
│     technology_type  primary_fuel  is_dispatchable  is_renewable
│     fleet_capex_per_kw  fleet_opex_fixed_per_kw_yr
│     fleet_electrical_efficiency  fleet_co2_emission_factor
│
├── VREPlant      ← oeo:RenewableEnergyPlant  (extends PowerPlant)
│     profile_key  ← reference to hourly capacity-factor series
│
├── EnergyStorage ← oeo:ElectricEnergyStorageUnit
│     storage_type  stored_carrier
│     fleet_roundtrip_efficiency  fleet_energy_to_power_ratio
│     fleet_self_discharge_rate  fleet_dod_max  fleet_cycle_lifetime
│
├── TransmissionLine ← oeo:TransmissionLine
│     transmission_type  voltage_kv  length_km
│     loss_per_km  max_capacity_mw
│
└── ConversionTechnology ← oeo:EnergyConversionDevice
      conversion_type  fleet_conversion_efficiency
```

---

## EquipmentInstance

One record per manufacturer / vintage / projection scenario.

| Field | OEO concept | Notes |
|---|---|---|
| `instance_id` | — | Unique slug |
| `label` | — | Human-readable name |
| `manufacturer` | — | Optional |
| `reference_year` | — | Data vintage |
| `life_cycle_stage` | — | `commercial`, `projection`, `demonstration` |
| `capex_per_kw` | `oeo:CapitalExpenditure` | `ParameterValue` |
| `opex_fixed_per_kw_yr` | `oeo:OperationAndMaintenanceCost` | `ParameterValue` |
| `opex_variable_per_mwh` | — | `ParameterValue` |
| `electrical_efficiency` | `oeo:ElectricalEfficiency` | `ParameterValue` |
| `capacity_kw` | `oeo:InstalledCapacity` | `ParameterValue` |
| `capacity_factor` | — | `ParameterValue` |
| `co2_emission_factor` | `oeo:CO2EmissionFactor` | `ParameterValue` |
| `ramp_up_rate` / `ramp_down_rate` | `oeo:RampingRate` | `ParameterValue` |
| `min_stable_generation` | — | `ParameterValue` |
| `economic_lifetime_yr` | — | `ParameterValue` |
| `extra` | — | Model-specific extensions (dict) |

---

## ParameterValue

Every measured quantity is wrapped in a `ParameterValue` to carry full provenance:

```python
class ParameterValue:
    value:  float
    unit:   str
    min:    float | None
    max:    float | None
    source: str | None    # bibliographic reference
    year:   int | None    # reference year
```

OEO concept: `oeo:MeasuredValue`

---

## OEO Field Mapping

| OEO concept | Field |
|---|---|
| `oeo:PowerGeneratingUnit` | `oeo_class` + `oeo_uri` on `PowerPlant` |
| `oeo:ElectricEnergyStorageUnit` | `oeo_class` + `oeo_uri` on `EnergyStorage` |
| `oeo:TransmissionLine` | `oeo_class` + `oeo_uri` on `TransmissionLine` |
| `oeo:EnergyConversionDevice` | `oeo_class` + `oeo_uri` on `ConversionTechnology` |
| `oeo:CapitalExpenditure` | `capex_per_kw` |
| `oeo:OperationAndMaintenanceCost` | `opex_fixed_per_kw_yr` |
| `oeo:ElectricalEfficiency` | `electrical_efficiency` |
| `oeo:CO2EmissionFactor` | `co2_emission_factor` |
| `oeo:RampingRate` | `ramp_up_rate`, `ramp_down_rate` |
| `oeo:InstalledCapacity` | `capacity_kw` |
| `oeo:MeasuredValue` | `ParameterValue` |

OEO browser: <https://openenergy-platform.org/ontology/oeo/>

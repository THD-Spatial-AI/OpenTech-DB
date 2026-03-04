# Building Block View

## Level 1 — System Decomposition

```
techs_database
|
+-- main.py              Application entry point; creates FastAPI app,
|                        registers routers, configures logging.
|
+-- schemas/
|   +-- models.py        All Pydantic data models (Technology hierarchy,
|                        EquipmentInstance, ParameterValue, enumerations).
|
+-- api/
|   +-- routes.py        HTTP route handlers + dual-format JSON data loader.
|                        Exposes /technologies and /debug endpoints.
|
+-- adapters/
|   +-- pypsa_adapter.py     Translates Technology -> PyPSA component dict.
|   +-- calliope_adapter.py  Translates Technology -> Calliope config dict.
|
+-- data/
    +-- generation/      JSON technology files (catalogue + individual)
    +-- storage/
    +-- transmission/
    +-- conversion/
```

## schemas/models.py — Data Model

| Class | OEO concept | Description |
|---|---|---|
| `ParameterValue` | `oeo:MeasuredValue` | Scalar with unit, uncertainty bounds, source, year. |
| `EquipmentInstance` | OEO individual | One manufacturer/vintage/scenario row within a Technology. |
| `Technology` | `oeo:EnergyConversionDevice` | Abstract base; all technologies inherit from this. |
| `PowerPlant` | `oeo:PowerGeneratingUnit` | Thermal and dispatchable generation. |
| `VREPlant` | `oeo:RenewableEnergyPlant` | Variable renewable (extends PowerPlant). |
| `EnergyStorage` | `oeo:ElectricEnergyStorageUnit` | Battery, hydro, thermal, H2 storage. |
| `TransmissionLine` | `oeo:TransmissionLine` | Electrical lines, cables, pipelines. |
| `ConversionTechnology` | `oeo:EnergyConversionDevice` | Electrolyzers, heat pumps, CHP, DAC. |
| `TechnologySummary` | — | Lightweight list-endpoint response model. |
| `TechnologyCatalogue` | — | Paginated catalogue response wrapper. |

## api/routes.py — Loader Pipeline

```
File on disk
   |
   v
_load_json_file()          raw dict
   |
   +-- _is_catalogue()?
       |-- YES --> _load_catalogue_file()  -> list[Technology]
       |           (maps flat fields via _map_catalogue_instance)
       |-- NO  --> _pick_legacy_model()    -> Technology subclass
                   model_cls.model_validate(raw)
                        |
                        v
                 dict[str, Technology]   (LRU cached)
                        |
                        v
               HTTP route handlers
```

## adapters/ — Framework Translation

Both adapters follow the same pattern:

1. Receive a `Technology` + `instance_index`.
2. Resolve the instance; extract scalar values with `_val()`.
3. Compute derived values (e.g. annualised CAPEX via CRF).
4. Return a plain `dict` matching the target framework parameter names.

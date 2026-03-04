# Glossary

| Term | Definition |
|------|------------|
| **ADOPTNet0** | Agent-based Decarbonisation Optimisation and Planning Tool for Net Zero. Energy system model developed at THD. |
| **Adapter** | A module (`adapters/*.py`) that translates an OEO-aligned `Technology` object into parameters required by a specific modelling framework. |
| **arc42** | A documentation template for software and system architectures (www.arc42.org). |
| **ATB** | Annual Technology Baseline. Annual cost and performance report published by NREL. |
| **CAPEX** | Capital Expenditure. Upfront investment cost. Stored as `capex_per_kw` in EUR or USD per kW of installed capacity. |
| **Calliope** | Open-source energy system modelling framework (<https://calliope.readthedocs.io>). |
| **Carrier** | Energy carrier or commodity flowing through a technology (electricity, natural_gas, hydrogen, heat, etc.). Mapped to OEO vocabulary. |
| **CHP** | Combined Heat and Power. A conversion technology producing both electricity and useful heat. |
| **CRF** | Capital Recovery Factor. Used to annualise overnight CAPEX: `CRF = r(1+r)^n / ((1+r)^n - 1)`. |
| **DAC** | Direct Air Capture. Technology removing CO₂ directly from the atmosphere. |
| **EquipmentInstance** | A single row of parameters representing one manufacturer model, vintage year, or projection scenario within a Technology. |
| **LRU cache** | Least Recently Used cache. Python `@lru_cache` memoises JSON loading; invalidated by `POST /debug/reload`. |
| **OEO** | Open Energy Ontology. A formal ontology for the energy domain maintained on the Open Energy Platform (<https://openenergy-platform.org/ontology/oeo/>). |
| **OEO URI** | A fully-qualified IRI pointing to a specific concept in the OEO, e.g. `https://openenergy-platform.org/ontology/oeo/OEO_00000044`. |
| **OEP** | Open Energy Platform. German open-data platform for energy system research. |
| **OPEX** | Operational Expenditure. Fixed (`opex_fixed_per_kw_yr`) and variable (`opex_variable_per_mwh`). |
| **OSeMOSYS** | Open Source Energy Modelling System. Linear programming energy model. |
| **ParameterValue** | Pydantic model wrapping a single numeric parameter with `value`, `unit`, `min`, `max`, `source`, and `year`. |
| **PowerPlant** | Technology subclass for dispatchable thermal and nuclear generation. |
| **PyPSA** | Python for Power System Analysis. Open-source power system modelling framework (<https://pypsa.org>). |
| **Technology** | Base Pydantic model representing an energy technology entry in the database. |
| **TechnologyCategory** | Enum: `generation`, `storage`, `transmission`, `conversion`. |
| **VREPlant** | Variable Renewable Energy plant (wind, solar, marine). Extends PowerPlant. |
| **UUID v5** | Name-based UUID derived deterministically from a namespace + name string. Used to generate stable IDs for catalogue-format technologies. |

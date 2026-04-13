# Glossary

| Term | Definition |
|------|------------|
| **ADOPTNet0** | Agent-based Decarbonisation Optimisation and Planning Tool for Net Zero. Energy system model developed at THD. |
| **Adapter** | A module (`adapters/*.py`) that translates an OEO-aligned `Technology` object into parameters required by a specific modelling framework. |
| **AdminPanel** | React component (`components/admin/AdminPanel.tsx`) for reviewing contributor submissions and managing users. Guarded by `isAdmin` flag. |
| **arc42** | A documentation template for software and system architectures (www.arc42.org). |
| **ATB** | Annual Technology Baseline. Annual cost and performance report published by NREL. |
| **AuthContext** | React context (`context/AuthContext.tsx`) managing JWT, user identity, and `isAdmin` flag across the SPA. |
| **CAPEX** | Capital Expenditure. Upfront investment cost. Stored as `capex_per_kw` in EUR or USD per kW of installed capacity. |
| **Calliope** | Open-source energy system modelling framework (<https://calliope.readthedocs.io>). |
| **Carrier** | Energy carrier or commodity flowing through a technology (electricity, natural_gas, hydrogen, heat, etc.). Mapped to OEO vocabulary. |
| **CHP** | Combined Heat and Power. A conversion technology producing both electricity and useful heat. |
| **ContributorWorkspace** | React component (`components/contributor/ContributorWorkspace.tsx`) for submitting new technology records or time-series profiles. |
| **CRF** | Capital Recovery Factor. Used to annualise overnight CAPEX: `CRF = r(1+r)^n / ((1+r)^n - 1)`. |
| **DAC** | Direct Air Capture. Technology removing CO₂ directly from the atmosphere. |
| **DetailsModal** | React component showing full technology details (all instances, parameters, sources, ECharts charts) in a modal overlay. |
| **ECharts** | Apache ECharts charting library used via `echarts-for-react` in the frontend for cost and efficiency visualisations. |
| **EquipmentInstance** | A single row of parameters representing one manufacturer model, vintage year, or projection scenario within a Technology. |
| **ErrorBoundary** | React component (`components/ErrorBoundary.tsx`) that catches rendering errors and displays a fallback UI instead of crashing the SPA. |
| **JWT** | JSON Web Token. Used to authenticate contributors and admins; issued by the backend after ORCID login; stored in `sessionStorage`. |
| **Leaflet** | Open-source JavaScript mapping library used in `MapPickerModal.tsx` for geographic location selection. |
| **LRU cache** | Least Recently Used cache. Python `@lru_cache` memoises JSON loading; invalidated by `POST /debug/reload`. |
| **MapPickerModal** | React component using Leaflet to let contributors select a geographic location when submitting a time-series profile. |
| **ngrok** | Tunnelling service used to expose a local FastAPI instance publicly for demos. The `ngrok-skip-browser-warning` header bypasses ngrok's interstitial page. |
| **OEO** | Open Energy Ontology. A formal ontology for the energy domain maintained on the Open Energy Platform (<https://openenergy-platform.org/ontology/oeo/>). |
| **OEO URI** | A fully-qualified IRI pointing to a specific concept in the OEO, e.g. `https://openenergy-platform.org/ontology/oeo/OEO_00000044`. |
| **OEP** | Open Energy Platform. German open-data platform for energy system research. |
| **OPEX** | Operational Expenditure. Fixed (`opex_fixed_per_kw_yr`) and variable (`opex_variable_per_mwh`). |
| **ORCID** | Open Researcher and Contributor ID. A persistent digital identifier for researchers, used as the primary login method for contributors. |
| **OSeMOSYS** | Open Source Energy Modelling System. Linear programming energy model. |
| **ParameterValue** | Pydantic model wrapping a single numeric parameter with `value`, `unit`, `min`, `max`, `source`, and `year`. |
| **PowerPlant** | Technology subclass for dispatchable thermal and nuclear generation. |
| **profile_key** | String identifier on a `VREPlant` instance referencing an hourly capacity factor series in the time-series catalogue. |
| **ProfileViewer** | React component rendering an hourly ECharts line chart for a selected time-series profile. |
| **PyPSA** | Python for Power System Analysis. Open-source power system modelling framework (<https://pypsa.org>). |
| **React Flow** | Library for node-based diagrams, used in the frontend for system topology visualisation. |
| **SPA** | Single-Page Application. The frontend is a React SPA served as static files; all routing is client-side. |
| **Supabase** | Open-source Firebase alternative providing managed auth (email, GitHub OAuth), database, and user metadata. Used for frontend session management and admin role storage. |
| **Technology** | Base Pydantic model representing an energy technology entry in the database. |
| **TechnologyCategory** | Enum: `generation`, `storage`, `transmission`, `conversion`. |
| **TimeSeriesCatalogue** | React component for browsing, searching, and managing hourly time-series profiles. |
| **UploadProfile** | React form component for contributor upload of a new hourly profile file with metadata. |
| **UUID v5** | Name-based UUID derived deterministically from a namespace + name string. Used to generate stable IDs for catalogue-format technologies. |
| **Vite** | Fast frontend build tool and dev server. Used to bundle the React SPA (`frontend/`). Current version: 8.0. |
| **VREPlant** | Variable Renewable Energy plant (wind, solar, marine). Extends PowerPlant. Carries `profile_key` linking to a time-series profile. |
| **Zustand** | Minimal React state management library. Used in the frontend for category selection, search query, and UI state. Current version: 5.0. |

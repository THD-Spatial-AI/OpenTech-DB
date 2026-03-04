# Context & Scope
## Business Context

The `techs_database` system sits at the centre of an energy modelling workflow. It receives data inputs from **curators** (researchers who maintain JSON files) and exposes a REST API consumed by **modelling framework clients**.

```
┌─────────────────────────────────────────────────────────────────┐
│                        External Actors                          │
│                                                                 │
│  [Data Curator]──JSON files──►[techs_database API]             │
│                                        │                        │
│                           ┌────────────┼────────────┐           │
│                           ▼            ▼            ▼           │
│                       [PyPSA]     [Calliope]  [OSeMOSYS /       │
│                       models       models     ADOPTNet0]        │
│                                                                 │
│  [OEP / Open Energy Platform]◄──oeo_uri links (human/bot)      │
└─────────────────────────────────────────────────────────────────┘
```

| Partner System | Direction | Interface | Description |
|---|---|---|---|
| Data Curator (human) | → techs_database | JSON files on disk | Creates/updates technology JSON files in `data/<category>/`. |
| PyPSA model scripts | ← techs_database | HTTP REST + `/adapt/pypsa/{id}` | Retrieves PyPSA-ready parameter dicts. |
| Calliope model scripts | ← techs_database | HTTP REST + `/adapt/calliope/{id}` | Retrieves Calliope YAML-ready dicts. |
| OSeMOSYS / ADOPTNet0 | ← techs_database | HTTP REST `/technologies/{id}` | Retrieves raw OEO-aligned records; adapters to be implemented. |
| Open Energy Platform (OEP) | ↔ link | `oeo_uri` hyperlinks | Records reference OEO concept URIs for semantic interoperability. |

## Technical Context

The system is a single Python process exposing an HTTP API. All data lives in the filesystem (`data/` directory). There is no runtime external dependency (no database, no message queue).

```
┌───────────────────────────────────────┐
│          techs_database process       │
│                                       │
│  ┌─────────┐   ┌───────────────────┐  │
│  │ main.py │──►│ FastAPI router    │  │
│  └─────────┘   │ (api/routes.py)   │  │
│                └────────┬──────────┘  │
│          ┌──────────────┼──────────┐  │
│          ▼              ▼          ▼  │
│  ┌──────────────┐ ┌──────────┐        │
│  │ JSON loader  │ │ Pydantic │        │
│  │ (dual-format)│ │ schemas  │        │
│  └──────┬───────┘ └──────────┘        │
│         │  ┌──────────────────────┐   │
│         └─►│  data/ (filesystem) │   │
│            └──────────────────────┘   │
│  ┌────────────────┐ ┌──────────────┐  │
│  │ pypsa_adapter  │ │calliope_     │  │
│  │                │ │adapter       │  │
│  └────────────────┘ └──────────────┘  │
└───────────────────────────────────────┘
       ▲ HTTP :8000
  [Client scripts / notebooks]
```
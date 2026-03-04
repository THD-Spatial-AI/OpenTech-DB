# Crosscutting Concepts

## 1. OEO Alignment

All technology records carry:

- `oeo_class` — short human-readable OEO class name (e.g. `oeo:GasTurbine`).
- `oeo_uri` — full resolvable IRI to the OEO concept on the Open Energy Platform.

The `EnergyCarrier` and `TechnologyCategory` enumerations mirror OEO vocabulary.

## 2. Data Validation (Pydantic v2)

Pydantic models are the single source of truth for data contracts:

- All inbound JSON (from files) is validated at load time.
- All outbound JSON (API responses) is serialised by Pydantic.
- Validation errors are caught per-file and logged; a single bad file does not crash
  the server.
- The `ParameterValue.bounds_consistent` validator enforces `min <= max`.

## 3. Parameter Provenance

Every `ParameterValue` carries `source` (bibliographic reference or URL) and `year`
(reference year). This makes every parameter in every model run traceable to a primary
source, which is a hard requirement for scientific reproducibility.

## 4. Dual-format JSON Loading

File format is auto-detected at load time:

- **Catalogue format** (`metadata` + `technologies[]`): flat numeric fields, multiple
  technologies per file.
- **Legacy individual format**: nested `ParameterValue` objects, one technology per file.

Both are normalised into the same internal Pydantic models so all downstream code (routes,
adapters) is format-agnostic.

## 5. In-memory Caching

The `@lru_cache(maxsize=1)` on `_load_all_technologies()` ensures JSON files are parsed
exactly once per process lifetime. The `POST /api/v1/debug/reload` endpoint explicitly
clears the cache for hot-reload without server restart.

## 6. Logging

Structured logging is configured in `main.py` using Python's standard `logging` module.
All loader events (file found, OK, FAIL with error detail) are logged at INFO/ERROR level.
HTTP access is logged by uvicorn.

## 7. Error Handling

- File-level parse/validation errors are caught, logged, and skipped. The API continues
  serving all successfully loaded technologies.
- API-level errors return standard 404 JSON responses via `HTTPException`.
- The `/api/v1/debug/data` endpoint surfaces all file errors for diagnostics.

## 8. Annualised Cost Calculation (Capital Recovery Factor)

The PyPSA adapter converts overnight CAPEX to annual capital costs using the CRF formula:

```
CRF = r * (1+r)^n / ((1+r)^n - 1)
capital_cost = capex_per_kw * CRF + opex_fixed_per_kw_yr
```

This is applied consistently in `adapters/pypsa_adapter.py`.

## 9. Unit Conventions

| Quantity | Internal unit | Notes |
|---|---|---|
| Power | kW | All `capacity_kw` fields |
| Energy | MWh | All `per_mwh` cost fields |
| Cost | EUR/kW or EUR/kWh | Stated in `ParameterValue.unit` |
| Efficiency | fraction (0–1) | Not percent |
| CO₂ intensity | tCO₂/MWh_fuel | Operational only |
| Ramp rate | %capacity/min | As-reported from manufacturer data |
| Lifetime | years | |

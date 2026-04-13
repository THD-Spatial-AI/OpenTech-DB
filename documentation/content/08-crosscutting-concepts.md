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
- Frontend uses an `ErrorBoundary` component to catch rendering failures and display a
  graceful fallback without crashing the whole SPA.

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
| Efficiency | fraction (0–1) | Not percent; catalogue `efficiency_percent` divided by 100 |
| CO₂ intensity | tCO₂/MWh_fuel | Operational only |
| Ramp rate | %capacity/min | As-reported from manufacturer data |
| Lifetime | years | |

## 10. Authentication & Authorisation

- **ORCID OAuth** (`api/auth.py`): researchers log in via their ORCID iD. The backend
  exchanges the OAuth code, issues a signed JWT, and redirects to the frontend with
  `?token=<jwt>`. The frontend stores the token in `sessionStorage`.
- **Supabase** (`frontend/src/lib/supabase.ts`): manages email/password and GitHub OAuth
  sessions for the frontend. Admin role is stored as Supabase user metadata and synced
  into `AuthContext`.
- **Route protection**: `AdminPanel` and `ContributorWorkspace` are guarded by
  `isAdmin` / `isAuthenticated` flags from `AuthContext`. Backend admin endpoints
  validate the JWT on the `Authorization: Bearer` header.

## 11. Frontend State Management

- **Zustand 5** is used for lightweight global state (selected category, search query,
  modal visibility). No Redux boilerplate.
- **React 19 concurrent features** are used throughout:
  - `use()` hook inside `<Suspense>` replaces `useEffect + useState` for data fetching.
  - `startTransition` wraps category tab changes to keep the current grid visible.
  - `useDeferredValue` defers search query so typing stays at 60 fps.
  - `useOptimistic` provides instant feedback on share/copy actions.

## 12. Time-Series Profile Lifecycle

```
Contributor uploads profile (UploadProfile.tsx)
    |
    v
POST /api/v1/timeseries/submit  → stored in data/timeseries/pending/
    |
    v
Admin reviews (AdminPanel.tsx)
    |
    +-- approve → moved to data/timeseries/, catalogue updated
    +-- reject  → removed from pending/
    |
    v
Available at GET /api/v1/timeseries/{id}/data
Referenced by VREPlant.profile_key
```

## 13. CORS Policy

CORS is configured explicitly in `main.py`. In development, origins `localhost:5173`,
`5174`, `5175`, and `4173` (Vite dev + preview) are allowed. The `Authorization`,
`Content-Type`, `ngrok-skip-browser-warning`, and `Accept` headers are whitelisted.
In production the allowed origin list must be updated to the deployed frontend URL.

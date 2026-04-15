# Data Formats

The data loader supports two JSON formats, detected automatically at runtime. Both can coexist in the same `data/` directory.

---

## 1. Catalogue format (recommended)

One file covers all technologies in a domain. Contains a `metadata` block and a `technologies` array with flat numeric fields per instance.

**Files:** `data/<category>/<category>_technologies.json`

```json
{
  "metadata": {
    "domain": "generation",
    "version": "1.0.0",
    "description": "...",
    "primary_sources": ["NREL ATB 2023", "IRENA 2023"]
  },
  "technologies": [
    {
      "technology_id": "ccgt",
      "technology_name": "Combined Cycle Gas Turbine (CCGT)",
      "domain": "generation",
      "carrier": "natural_gas",
      "oeo_class": "http://openenergy-platform.org/ontology/oeo/OEO_00000044",
      "description": "...",
      "instances": [
        {
          "instance_id": "ccgt_800mw_current",
          "instance_name": "CCGT – 800 MW (Current, 2024)",
          "typical_capacity_mw": 800,
          "capex_usd_per_kw": 900,
          "opex_fixed_usd_per_kw_yr": 20.0,
          "opex_var_usd_per_mwh": 3.5,
          "efficiency_percent": 58.0,
          "lifetime_years": 30,
          "co2_emission_factor_operational_g_per_kwh": 202,
          "ramping_rate_percent_per_min": 8.0,
          "reference_source": "NREL ATB 2023"
        }
      ]
    }
  ]
}
```

### Field mapping (catalogue → internal model)

| Catalogue field | Internal field | Conversion |
|---|---|---|
| `capex_usd_per_kw` | `capex_per_kw.value` | direct |
| `efficiency_percent` | `electrical_efficiency.value` | ÷ 100 |
| `typical_capacity_mw` | `capacity_kw.value` | × 1000 |
| `co2_emission_factor_operational_g_per_kwh` | `co2_emission_factor.value` | ÷ 1000 → tCO₂/MWh |
| `ramping_rate_percent_per_min` | `ramp_up_rate.value` + `ramp_down_rate.value` | direct |
| `oeo_class` (full URI) | `oeo_uri` + `oeo_class` (last segment) | split |

---

## 2. Individual format (legacy, fully supported)

One JSON file per technology using nested `ParameterValue` objects. Detected automatically by the absence of a `metadata`/`technologies` root structure.

---

## Adding a new technology

### Catalogue format (preferred)

1. Open `data/<category>/<category>_technologies.json`.
2. Add a new entry to the `technologies` array following the schema above.
3. Reload the API:

```bash
curl -X POST http://localhost:8000/api/v1/debug/reload
```

4. Verify via `GET /api/v1/technologies/{your_new_id}`.

### Individual format

1. Create `data/<category>/<tech_id>.json` with a nested `ParameterValue` schema.
2. The `id` field must be a valid UUID.
3. Add at least one entry in `instances`.
4. Reload via the debug endpoint above.

---

## Timeseries profile format

Files in `data/timeseries/` are referenced by `profile_key` on VRE technologies. Metadata is indexed in `timeseries_catalogue.json`.

```json
{
  "profile_id": "de_solar_pv_utility_cf_2019",
  "name": "Germany Solar PV Utility CF 2019",
  "type": "capacity_factor",
  "resolution": "1h",
  "location": "DE",
  "carrier": "solar",
  "year": 2019,
  "n_timesteps": 8760,
  "source": "...",
  "values": [0.0, 0.0, ..., 0.72, ...]
}
```

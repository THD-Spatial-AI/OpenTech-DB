# Time-Series Catalogue

Hourly capacity factors and load profiles are stored in `data/timeseries/` and served via `/api/v1/timeseries`.

---

## Available profiles

The catalogue includes profiles for Germany, France, UK, Spain, Italy, Greece, Norway, Denmark, and Austria — covering solar PV, onshore/offshore wind, hydroelectric, day-ahead prices, and electricity load for 2019.

---

## API usage

```bash
# List all available profiles (paginated)
curl "http://localhost:8000/api/v1/timeseries"

# Fetch hourly data for a specific profile
curl "http://localhost:8000/api/v1/timeseries/de_solar_pv_utility_cf_2019/data"
```

```python
import requests

BASE = "http://localhost:8000/api/v1"

# Get all available profiles
profiles = requests.get(f"{BASE}/timeseries").json()
for p in profiles["profiles"]:
    print(p["profile_id"], "-", p["name"], f"({p['n_timesteps']} h)")

# Fetch hourly solar CF for Germany 2019
data = requests.get(f"{BASE}/timeseries/de_solar_pv_utility_cf_2019/data").json()
cf_series = data["values"]   # list of 8760 floats (0–1)
```

---

## Profile metadata fields

| Field | Description |
|---|---|
| `profile_id` | Unique identifier (used in API path) |
| `name` | Human-readable name |
| `type` | `capacity_factor`, `load`, `price`, etc. |
| `resolution` | Time resolution (e.g. `1h`) |
| `location` | Country or region code |
| `source` | Data source reference |
| `carrier` | Energy carrier (e.g. `solar`, `wind`) |
| `year` | Data year |
| `n_timesteps` | Number of time steps (typically 8760) |

---

## Contributing a new profile

Authenticated users can upload profiles via the web UI (Contributor Workspace) or via the API:

```bash
curl -X POST http://localhost:8000/api/v1/timeseries/submit \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "profile_id": "...", "name": "...", "values": [...] }'
```

Submitted profiles are queued for admin review. See [Authentication](authentication.md) for obtaining a JWT.

Admin endpoints:

```bash
# List pending submissions
GET /api/v1/admin/timeseries/submissions

# Approve a submission
PATCH /api/v1/admin/timeseries/{id}/approve
```

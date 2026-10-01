# Hydrogen Plant Simulation API — Frontend Integration Guide

## 1. Overview

This document is for frontend developers (React / Electron or any HTTP client)
who need to call the Hydrogen Plant Simulation Bridge API hosted on the
simulation VM.

The VM runs a FastAPI server backed by **MATLAB R2024a**. You send simulation
parameters, the server runs the physics model, and returns time-series results
and KPIs.

---

## 2. Connection Details

| Property | Value |
|---|---|
| **VM IP Address** | `10.1.66.27` |
| **Port** | `8765` |
| **Base URL** | `http://10.1.66.27:8765` |
| **Protocol** | HTTP (REST) + WebSocket |
| **Auth** | None (open — internal network only) |

> If you are on the **same machine** as the VM, use `http://localhost:8765`.
> If you are on a **different machine on the same network**, use `http://10.1.66.27:8765`.
> If you are **remote** (VPN / SSH tunnel): `ssh -L 8765:localhost:8765 admin1@10.1.66.27` then use `http://localhost:8765`.

### Frontend .env configuration

```env
# React / Vite project — .env file
VITE_H2_SERVICE_URL=http://10.1.66.27:8765

# If running frontend on the same machine:
# VITE_H2_SERVICE_URL=http://localhost:8765
```

---

## 3. API Endpoints

### 3.1  GET `/api/hydrogen/health`

Check whether the server and MATLAB engine are ready before sending jobs.

**Request**
```
GET http://10.1.66.27:8765/api/hydrogen/health
```

**Response — 200 OK**
```json
{
  "engine_ready": true,
  "engine_error": null,
  "active_jobs": 0
}
```

| Field | Type | Meaning |
|---|---|---|
| `engine_ready` | boolean | `true` = MATLAB is up and ready for simulations |
| `engine_error` | string \| null | Error message if MATLAB failed to start |
| `active_jobs` | integer | Number of simulations currently running |

> **Always call `/health` first.** Wait until `engine_ready === true` before submitting jobs.
> MATLAB takes up to 60 s after service start to initialize.

---

### 3.2  POST `/api/hydrogen/simulate`

Submit a simulation job. Returns immediately with a `job_id` — the simulation
runs in the background.

**Request**
```
POST http://10.1.66.27:8765/api/hydrogen/simulate
Content-Type: application/json
```

**Request Body — full example**
```json
{
  "electrolyzer": {
    "grid_power_kw":       200.0,
    "water_flow_rate_lpm": 60.0,
    "temperature_c":       70.0
  },
  "storage": {
    "compressor_efficiency": 0.78,
    "max_tank_pressure_bar": 350.0
  },
  "fuel_cell": {
    "h2_flow_rate_nm3h":    40.0,
    "oxidant_pressure_bar": 2.5,
    "cooling_capacity_kw":  35.0
  },
  "simulation": {
    "t_end_s": 3600.0,
    "dt_s":    60.0
  }
}
```

**Parameter reference**

| Section | Field | Unit | Default | Min | Max | Description |
|---|---|---|---|---|---|---|
| `electrolyzer` | `grid_power_kw` | kW | 100 | 0 | 2000 | Electrical grid power input |
| `electrolyzer` | `water_flow_rate_lpm` | L/min | 30 | 0 | 500 | Water feed to electrolyzer |
| `electrolyzer` | `temperature_c` | °C | 70 | 20 | 100 | Electrolyzer operating temperature |
| `storage` | `compressor_efficiency` | — | 0.75 | 0.3 | 1.0 | H2 compressor efficiency (0–1) |
| `storage` | `max_tank_pressure_bar` | bar | 350 | 50 | 700 | Maximum H2 storage tank pressure |
| `fuel_cell` | `h2_flow_rate_nm3h` | Nm³/h | 20 | 0 | 200 | H2 flow into the fuel cell stack |
| `fuel_cell` | `oxidant_pressure_bar` | bar | 2.0 | 1 | 10 | Oxidant (air/O₂) supply pressure |
| `fuel_cell` | `cooling_capacity_kw` | kW | 20 | 0 | 200 | Fuel cell cooling system capacity |
| `simulation` | `t_end_s` | s | 3600 | 60 | 86400 | Simulation duration (up to 24 h) |
| `simulation` | `dt_s` | s | 60 | 1 | 600 | Time step size |

> All fields are **optional** — omitted fields use their defaults.

**Response — 200 OK**
```json
{
  "job_id": "62db490c-16a8-4064-8d9a-ee4832cad83f",
  "status": "queued",
  "message": "Simulation job 62db490c-16a8-4064-8d9a-ee4832cad83f queued successfully."
}
```

**Save the `job_id`** — you need it for status polling and WebSocket subscription.

---

### 3.3  GET `/api/hydrogen/status/{job_id}`

Poll for job progress and retrieve results when done.

**Request**
```
GET http://10.1.66.27:8765/api/hydrogen/status/62db490c-16a8-4064-8d9a-ee4832cad83f
```

**Response — job in progress**
```json
{
  "job_id":       "62db490c-16a8-4064-8d9a-ee4832cad83f",
  "status":       "running",
  "progress_pct": 50,
  "error":        null,
  "result":       null
}
```

**Response — job complete**
```json
{
  "job_id":       "62db490c-16a8-4064-8d9a-ee4832cad83f",
  "status":       "done",
  "progress_pct": 100,
  "error":        null,
  "result": {
    "time_s":                  [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600],
    "h2_production_nm3h":      [43.27, 43.41, 43.19, ...],
    "tank_pressure_bar":       [200.0, 215.0, 230.0, ...],
    "fc_terminal_voltage_v":   [200.0, 199.4, 198.8, ...],
    "fc_current_density_acm2": [0.609, 0.601, 0.614, ...],
    "fc_power_output_kw":      [9749.3, 9583.8, 9757.5, ...],
    "system_efficiency_pct":   [100.0, 100.0, 100.0, ...],
    "electrolyzer_power_kw":   [200.0, 200.0, 200.0, ...],
    "kpi": {
      "avg_h2_production_nm3h": 43.27,
      "peak_tank_pressure_bar": 350.0,
      "avg_fc_power_kw":        2.89,
      "system_efficiency_pct":  1.45
    }
  }
}
```

**Response fields**

| Field | Type | Description |
|---|---|---|
| `status` | string | `queued` \| `running` \| `done` \| `error` |
| `progress_pct` | integer | 0–100 progress percentage |
| `error` | string \| null | Error message (only when `status = "error"`) |
| `result` | object \| null | Full results (only when `status = "done"`) |

**Result arrays** — each array has exactly `ceil(t_end_s / dt_s) + 1` elements,
one per time step starting at `t = 0`.

| Array field | Unit | Description |
|---|---|---|
| `time_s` | s | Time vector |
| `h2_production_nm3h` | Nm³/h | Hydrogen production rate |
| `tank_pressure_bar` | bar | H2 storage tank pressure |
| `fc_terminal_voltage_v` | V | Fuel cell stack terminal voltage |
| `fc_current_density_acm2` | A/cm² | Fuel cell current density |
| `fc_power_output_kw` | kW | Fuel cell electrical power output |
| `system_efficiency_pct` | % | Overall system efficiency |
| `electrolyzer_power_kw` | kW | Electrolyzer actual power consumption |

**KPI fields**

| Field | Unit | Description |
|---|---|---|
| `avg_h2_production_nm3h` | Nm³/h | Mean H2 production rate over simulation |
| `peak_tank_pressure_bar` | bar | Maximum achieved tank pressure |
| `avg_fc_power_kw` | kW | Mean fuel cell output power |
| `system_efficiency_pct` | % | Mean system efficiency |

---

### 3.4  WebSocket `/api/hydrogen/ws/{job_id}`

Connect **before or after** submitting a job to receive real-time progress
events without polling.

**WebSocket URL**
```
ws://10.1.66.27:8765/api/hydrogen/ws/62db490c-16a8-4064-8d9a-ee4832cad83f
```

**Server → Client messages**

Progress update (sent at 0%, 25%, 50%, 75%):
```json
{ "status": "running", "progress_pct": 50 }
```

Completion (includes full result):
```json
{ "status": "done", "result": { ... } }
```

Error:
```json
{ "status": "error", "error": "Description of the error" }
```

**Client → Server keep-alive** (send periodically to keep connection alive):
```
ping
```
Server replies:
```
pong
```

---

## 4. Complete Frontend Workflow

```
1. GET  /api/hydrogen/health          → wait for engine_ready === true
2. POST /api/hydrogen/simulate        → get job_id
3. Connect WebSocket ws/.../ws/{job_id}
4. Receive { status: "running", progress_pct: N }  × 4
5. Receive { status: "done", result: {...} }
6. (Optional) GET /api/hydrogen/status/{job_id} to re-fetch result later
```

---

## 5. JavaScript / TypeScript Code Examples

### 5.1 Health check
```typescript
const BASE_URL = import.meta.env.VITE_H2_SERVICE_URL; // e.g. "http://10.1.66.27:8765"

async function waitForEngine(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/api/hydrogen/health`);
    const data = await res.json();
    if (data.engine_ready) return;
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error("MATLAB engine did not become ready in time");
}
```

### 5.2 Submit simulation
```typescript
interface HydrogenSimulateRequest {
  electrolyzer: {
    grid_power_kw:       number;
    water_flow_rate_lpm: number;
    temperature_c:       number;
  };
  storage: {
    compressor_efficiency: number;
    max_tank_pressure_bar: number;
  };
  fuel_cell: {
    h2_flow_rate_nm3h:    number;
    oxidant_pressure_bar: number;
    cooling_capacity_kw:  number;
  };
  simulation: {
    t_end_s: number;
    dt_s:    number;
  };
}

async function submitSimulation(params: HydrogenSimulateRequest): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/hydrogen/simulate`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Simulate failed: ${res.status}`);
  const data = await res.json();
  return data.job_id;  // save this!
}
```

### 5.3 Poll for result
```typescript
async function pollResult(jobId: string, intervalMs = 2000): Promise<object> {
  while (true) {
    const res  = await fetch(`${BASE_URL}/api/hydrogen/status/${jobId}`);
    const data = await res.json();
    if (data.status === "done")   return data.result;
    if (data.status === "error")  throw new Error(data.error);
    await new Promise(r => setTimeout(r, intervalMs));
  }
}
```

### 5.4 Subscribe via WebSocket (recommended over polling)
```typescript
function subscribeToJob(
  jobId: string,
  onProgress: (pct: number) => void,
  onDone:     (result: object) => void,
  onError:    (err: string) => void,
): WebSocket {
  const WS_BASE = BASE_URL.replace(/^http/, "ws");
  const ws = new WebSocket(`${WS_BASE}/api/hydrogen/ws/${jobId}`);

  // Keep-alive ping every 30s
  const ping = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send("ping");
  }, 30_000);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.status === "running") onProgress(msg.progress_pct);
    if (msg.status === "done")    { clearInterval(ping); ws.close(); onDone(msg.result); }
    if (msg.status === "error")   { clearInterval(ping); ws.close(); onError(msg.error); }
  };

  ws.onerror = () => { clearInterval(ping); onError("WebSocket connection error"); };

  return ws;
}
```

### 5.5 Full example — submit and wait for results
```typescript
async function runSimulation(params: HydrogenSimulateRequest): Promise<object> {
  await waitForEngine();

  const jobId = await submitSimulation(params);

  return new Promise((resolve, reject) => {
    subscribeToJob(
      jobId,
      (pct) => console.log(`Progress: ${pct}%`),
      (result) => resolve(result),
      (err)    => reject(new Error(err)),
    );
  });
}

// Usage:
const result = await runSimulation({
  electrolyzer: { grid_power_kw: 200, water_flow_rate_lpm: 60, temperature_c: 70 },
  storage:      { compressor_efficiency: 0.78, max_tank_pressure_bar: 350 },
  fuel_cell:    { h2_flow_rate_nm3h: 40, oxidant_pressure_bar: 2.5, cooling_capacity_kw: 35 },
  simulation:   { t_end_s: 3600, dt_s: 60 },
});

console.log("KPIs:", result.kpi);
// Plot result.time_s vs result.h2_production_nm3h, etc.
```

---

## 6. curl Examples (for testing without frontend)

```bash
# Health check
curl http://10.1.66.27:8765/api/hydrogen/health

# Submit simulation
curl -X POST http://10.1.66.27:8765/api/hydrogen/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "electrolyzer": {"grid_power_kw": 200, "water_flow_rate_lpm": 60, "temperature_c": 70},
    "storage":      {"compressor_efficiency": 0.78, "max_tank_pressure_bar": 350},
    "fuel_cell":    {"h2_flow_rate_nm3h": 40, "oxidant_pressure_bar": 2.5, "cooling_capacity_kw": 35},
    "simulation":   {"t_end_s": 600, "dt_s": 60}
  }'

# Poll status (replace JOB_ID)
curl http://10.1.66.27:8765/api/hydrogen/status/JOB_ID
```

---

## 7. CORS — Allowed Origins

The API allows requests from:

| Origin | Use case |
|---|---|
| `http://localhost:5173` | Vite dev server |
| `http://localhost:4173` | Vite preview |
| `app://.` | Electron production renderer |
| `*` | All origins (current VM setting for flexibility) |

No CORS headers or proxy configuration needed for standard React/Vite dev setups.

---

## 8. Error Handling

| HTTP Status | Meaning |
|---|---|
| `200` | Success |
| `404` | `job_id` not found — check you are using the correct ID |
| `422` | Validation error — a parameter is out of range or wrong type |
| `500` | Internal server error — check server logs |

When `status === "error"` in a job response, the `error` field contains the
MATLAB or Python exception message.

---

## 9. VM Service Management

The API runs as a Windows Scheduled Task named `HydrogenSimBridge` and starts
automatically on login. If you need to restart it manually:

```powershell
# On the VM (RDP or local access) — stops and restarts the API
schtasks /End /TN HydrogenSimBridge
schtasks /Run /TN HydrogenSimBridge

# Check if it is running (should return engine_ready: true after ~60s)
curl http://localhost:8765/api/hydrogen/health
```

**Log files** (on the VM):
```
C:\Users\admin1\Desktop\MATLAB_API\hydrogen-plant-sim\service.log   ← stdout
C:\Users\admin1\Desktop\MATLAB_API\hydrogen-plant-sim\service.err   ← stderr
```

---

## 10. Network Access — Firewall Rule

If the frontend machine cannot reach `10.1.66.27:8765`, run this once on the VM
(requires admin):

```powershell
netsh advfirewall firewall add rule `
  name="HydrogenSimBridge" `
  dir=in action=allow protocol=TCP localport=8765
```

---

## 11. Swagger / Interactive Docs

The API ships with built-in interactive documentation:

| URL | Description |
|---|---|
| `http://10.1.66.27:8765/docs` | Swagger UI — try endpoints in browser |
| `http://10.1.66.27:8765/redoc` | ReDoc — clean reference docs |

You can submit a real simulation directly from the browser at `/docs` without
writing any code.

---

## 12. Quick Sanity Check Checklist

Before writing frontend code, verify from any browser or terminal:

- [ ] `http://10.1.66.27:8765/api/hydrogen/health` → `engine_ready: true`
- [ ] `http://10.1.66.27:8765/docs` → Swagger UI loads
- [ ] POST simulate from Swagger → returns `job_id`
- [ ] GET status with `job_id` → eventually returns `status: done`

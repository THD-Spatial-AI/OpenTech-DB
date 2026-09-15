/**
 * hydrogenService.js
 * ------------------
 * API client for the Python/FastAPI OpenModelica Bridge running on the simulation service.
 *
 * Provides:
 *   checkHealth()          → Promise<HealthResponse>
 *   startSimulation(params)→ Promise<{ job_id, status }>
 *   pollStatus(jobId)      → Promise<JobStatusResponse>
 *   runSimulation(params, callbacks) → Promise<cancelFn>
 *     ↳ tries WebSocket first; if WS fails within 3 s falls back to HTTP polling
 *
 * URL configured via: VITE_H2_SERVICE_URL in .env
 */

import { simulateH2Chain } from "./h2Physics";

// Base URL strategy:
//   DEV  → relative path "/h2-proxy", Vite dev-server proxies it to VITE_H2_SERVICE_URL.
//          This avoids the browser trying to reach the VM directly (CORS / firewall / Docker).
//   PROD → full URL from VITE_H2_SERVICE_URL (Electron opens file://, so no proxy available).
const _RAW_URL = (import.meta.env.VITE_H2_SERVICE_URL ?? "http://localhost:8765").replace(/\/$/, "");
const BASE_URL  = import.meta.env.DEV ? "/h2-proxy" : _RAW_URL;

// ── helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (networkErr) {
    const err = new Error(
      "Cannot reach the Hydrogen Plant simulation service on the VM. " +
        "Check that the VM is reachable and the service is running (uvicorn main:app --port 8765). " +
        "Update VITE_H2_SERVICE_URL in your .env file if the VM address has changed."
    );
    err.code = "NETWORK_ERROR";
    throw err;
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      detail = body?.detail ?? body?.message ?? JSON.stringify(body) ?? detail;
    } catch (_) { /* ignore */ }
    const err = new Error(detail);
    err.status = response.status;
    throw err;
  }

  return response.json();
}

/** Like apiFetch but returns `null` instead of throwing on HTTP 4xx/5xx/network errors.
 *  Used for health probes so a cold or misconfigured bridge never crashes the UI. */
async function apiFetchSafe(path) {
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) return null;
    return response.json();
  } catch (_) {
    return null;
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Check whether the OpenModelica simulation engine is alive and ready.
 *
 * Tries /api/health first (standard FastAPI convention), then falls back to
 * /api/hydrogen/health (older bridge versions).  Never throws — returns a safe
 * object so the UI can degrade gracefully while the simulation engine initializes.
 *
 * @returns {Promise<{ engine_ready: boolean, engine_error: string|null, active_jobs: number, _path: string }>}
 */
export async function checkHealth() {
  // Candidate paths in preference order
  const candidates = [
    "/api/health",
    "/api/hydrogen/health",
    "/health",
  ];

  for (const path of candidates) {
    const data = await apiFetchSafe(path);
    if (data !== null) {
      // Normalise: both { engine_ready } and { status: "ok" } shapes are accepted
      return {
        engine_ready: !!(data.engine_ready ?? (data.status === "ok" || data.status === "ready")),
        engine_error: data.engine_error ?? data.error ?? null,
        active_jobs:  data.active_jobs  ?? 0,
        _path: path,   // lets the UI show which path responded (useful for debugging)
      };
    }
  }

  // All paths unreachable
  throw new Error(
    `Cannot reach the Hydrogen Plant simulation service at ${BASE_URL}. ` +
    `Tried: ${candidates.join(", ")}. ` +
    "Possible causes: (1) not connected to VPN/lab network, " +
    "(2) Docker container not running on the VM, " +
    "(3) wrong IP/port in VITE_H2_SERVICE_URL (.env)."
  );
}

/**
 * Submit a new hydrogen-plant simulation.
 *
 * Payload schema v2.0 — built by {@link buildSimPayload} in h2SimPayload.js.
 * Every key includes its unit in the name for clarity and precision.
 *
 * @param {{
 *   schema_version: "2.0",
 *   simulation: { t_end_s: number, dt_s: number },
 *   source: {
 *     tech_type:      "solar"|"wind"|"nuclear"|"hydro"|"gas"|"coal"|"biomass"|"geothermal"|"generic",
 *     name:           string|null,
 *     capacity_kw:    number|null,
 *     efficiency_pct: number|null,
 *     profile:        Array<{ time_s: number, power_kw: number }>
 *   },
 *   electrolyzer: {
 *     tech_type:                  "pem"|"alkaline"|"soec"|"aem",
 *     name:                       string|null,
 *     capacity_kw:                number,
 *     nominal_efficiency_pct_hhv: number,
 *     min_load_pct:               number,
 *     max_load_pct:               number,
 *     operating_temperature_c:    number,
 *     water_flow_rate_lpm:        number,
 *     h2_hhv_kwh_per_kg:          39.4
 *   },
 *   compressor: {
 *     tech_type:                  "reciprocating"|"ionic"|"linear",
 *     name:                       string|null,
 *     isentropic_efficiency_frac: number,
 *     inlet_pressure_bar:         number,
 *     target_pressure_bar:        number
 *   },
 *   storage: {
 *     tech_type:                 "compressed_h2"|"liquid_h2"|"metal_hydride"|"cavern",
 *     name:                      string|null,
 *     max_pressure_bar:          number,
 *     min_pressure_bar:          number,
 *     initial_soc_pct:           number,
 *     round_trip_efficiency_pct: number
 *   },
 *   fuel_cell: {
 *     tech_type:              "pem"|"sofc"|"mcfc"|"pafc"|"alkaline",
 *     name:                   string|null,
 *     rated_power_kw:         number|null,
 *     nominal_efficiency_pct: number,
 *     min_load_pct:           number,
 *     h2_flow_rate_nm3h:      number,
 *     operating_pressure_bar: number,
 *     cooling_capacity_kw:    number
 *   }
 * }} params
 *
 * Expected OpenModelica response (nested v2 or flat v1 — both handled by normalizeSimResult):
 * {
 *   time_s: number[],
 *   electrolyzer: { power_in_kw, h2_production_nm3h, h2_production_kg_h, efficiency_pct },
 *   compressor:   { power_consumed_kw, outlet_pressure_bar },
 *   storage:      { pressure_bar, soc_pct, h2_mass_kg },
 *   fuel_cell:    { power_output_kw, h2_consumed_nm3h, terminal_voltage_v, current_density_acm2, efficiency_pct },
 *   kpi: { total_h2_produced_kg, total_h2_consumed_kg, total_energy_consumed_kwh,
 *          overall_system_efficiency_pct, specific_energy_kwh_kg,
 *          peak_h2_production_kg_h, avg_electrolyzer_load_pct, capacity_factor_pct }
 * }
 *
 * @returns {Promise<{ job_id: string, status: string, message: string }>}
 */
export async function startSimulation(params) {
  return apiFetch("/api/hydrogen/simulate", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/**
 * Poll the current status (and final result) of a simulation job.
 *
 * @param {string} jobId
 * @returns {Promise<{
 *   job_id: string,
 *   status: 'queued'|'running'|'done'|'error',
 *   progress_pct: number,
 *   error: string|null,
 *   result: SimulationResult|null
 * }>}
 */
export async function pollStatus(jobId) {
  return apiFetch(`/api/hydrogen/status/${jobId}`);
}

// ── WebSocket path ────────────────────────────────────────────────────────────

function wsUrlForJob(jobId) {
  if (import.meta.env.DEV) {
    // In dev the Vite proxy handles WS too (ws: true in vite.config.js).
    // Use the current page's host so the WS upgrade goes through the proxy.
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/h2-proxy/api/hydrogen/ws/${jobId}`;
  }
  // Production (Electron): connect directly to the VM.
  return `${_RAW_URL.replace(/^http/, "ws")}/api/hydrogen/ws/${jobId}`;
}

/**
 * Fetch the full result from /api/hydrogen/result/{jobId}.
 * The /status endpoint always returns result:null — the result lives here.
 */
async function fetchResult(jobId) {
  return apiFetch(`/api/hydrogen/result/${jobId}`);
}

// ── Polling fallback ──────────────────────────────────────────────────────────

/**
 * Poll /status/{jobId} every `intervalMs` ms until done or error.
 * Returns a cancel function.
 */
// Normalise the many status strings different bridge versions may return.
function isStatusDone(s)  { return s === "done" || s === "completed" || s === "success" || s === "finished"; }
function isStatusError(s) { return s === "error" || s === "failed"; }

const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10-minute hard cap

function startPolling(jobId, { onProgress, onResult, onError }, intervalMs = 2000) {
  let stopped = false;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  (async () => {
    while (!stopped) {
      await new Promise((r) => setTimeout(r, intervalMs));
      if (stopped) break;

      if (Date.now() > deadline) {
        onError?.("Simulation timed out after 10 minutes with no result. Check that the simulation completed on the server.");
        break;
      }

      try {
        const data = await pollStatus(jobId);
        if (stopped) break;

        if (isStatusDone(data.status)) {
          // /status always returns result:null — fetch from dedicated endpoint
          try {
            const full = await fetchResult(jobId);
            onResult?.(full.result ?? full);
          } catch (e) {
            onError?.(e.message);
          }
          break;
        } else if (isStatusError(data.status)) {
          onError?.(data.error ?? data.message ?? "Unknown simulation error");
          break;
        } else {
          onProgress?.(data);
        }
      } catch (e) {
        if (!stopped) onError?.(e.message);
        break;
      }
    }
  })();

  return () => { stopped = true; };
}

// ── WebSocket with automatic polling fallback ─────────────────────────────────

/**
 * Try to open a WebSocket for `jobId`.
 * If WS fails to open within 3 s, automatically falls back to HTTP polling.
 * Returns a cancel/close function.
 */
function openResultsSocketWithFallback(jobId, callbacks = {}) {
  const { onProgress, onResult, onError, onClose } = callbacks;

  let cancelled      = false;
  let stopPolling     = () => {};
  let keepAlive       = null;
  let resolved        = false; // true once we received a final result or error via WS
  let pollingStarted  = false; // guard: prevent starting two polling loops

  // Fallback timer: if WS hasn't opened within 4 s, switch to HTTP polling
  const fallbackTimer = setTimeout(() => startFallbackPolling(), 4000);

  let ws;
  try {
    ws = new WebSocket(wsUrlForJob(jobId));
  } catch (_) {
    clearTimeout(fallbackTimer);
    stopPolling = startPolling(jobId, { onProgress, onResult, onError });
    return () => { cancelled = true; stopPolling(); };
  }

  ws.onopen = () => {
    clearTimeout(fallbackTimer); // WS is up — cancel the polling fallback
    if (import.meta.env.DEV) console.log(`[hydrogenService] WS open for job ${jobId}`);
    // Keep-alive: API docs require client to send "ping" every 30 s
    keepAlive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 30_000);
  };

  ws.onmessage = (evt) => {
    // Server sends plain-text "pong" in response to our keep-alive "ping" — ignore it
    if (evt.data === "pong") return;

    let data;
    try { data = JSON.parse(evt.data); } catch (_) { return; }

    // The server uses a 'type' discriminator field, not 'status':
    //   { "type": "result",   "result": {...} }
    //   { "type": "error",    "error": "..." }
    //   { "type": "progress", "progress_pct": N }
    // Normalise to a unified shape so both server versions work.
    const msgType   = data.type   ?? data.status ?? null;
    const isDone    = isStatusDone(msgType)  || msgType === "result";
    const isError   = isStatusError(msgType) || msgType === "error";

    if (isDone && data.result) {
      resolved = true;
      clearInterval(keepAlive);
      onResult?.(data.result);
      ws.close();
    } else if (isError) {
      resolved = true;
      clearInterval(keepAlive);
      onError?.(data.error ?? data.message ?? "Unknown simulation error");
      ws.close();
    } else {
      // progress update: { type: "progress", progress_pct: N }
      onProgress?.({
        status:       "running",
        progress_pct: data.progress_pct ?? 0,
        ...data,
      });
    }
  };

  const startFallbackPolling = () => {
    if (pollingStarted || cancelled || resolved) return;
    pollingStarted = true;
    if (import.meta.env.DEV)
      console.warn(`[hydrogenService] Falling back to HTTP polling for job ${jobId}`);
    stopPolling = startPolling(jobId, { onProgress, onResult, onError });
  };

  ws.onerror = () => {
    clearTimeout(fallbackTimer);
    clearInterval(keepAlive);
    // ws.close() below will fire ws.onclose, which calls startFallbackPolling.
    // Call ws.close() BEFORE startFallbackPolling so the flag is already set.
    ws.close();
  };

  ws.onclose = () => {
    clearTimeout(fallbackTimer);
    clearInterval(keepAlive);
    // WS dropped before a final result arrived — switch to HTTP polling.
    startFallbackPolling();
    onClose?.();
  };

  return () => {
    cancelled = true;
    clearTimeout(fallbackTimer);
    clearInterval(keepAlive);
    stopPolling();
    try { if (ws.readyState < WebSocket.CLOSING) ws.close(); } catch (_) { /* */ }
  };
}

// ── Main convenience function ─────────────────────────────────────────────────

/**
 * Start a simulation and subscribe to progress/result updates.
 *
 * PRIMARY PATH — MATLAB (when service reachable):
 *   Submits the job, then receives results via WebSocket (falls back to polling).
 *
 * FALLBACK PATH — Local JS Physics (when service unreachable / no VPN):
 *   Runs `simulateH2Chain()` from h2Physics.js entirely in the browser.
 *   The result carries `_local: true` so the UI can show a badge.
 *   Progress callbacks are faked over ~600 ms for a smooth UX.
 *
 * @param {object} params      – payload from buildSimPayload()
 * @param {{
 *   onQueued?:   (jobId: string) => void,
 *   onProgress?: (data) => void,
 *   onResult?:   (result) => void,
 *   onError?:    (msg: string) => void,
 * }} callbacks
 * @returns {Promise<() => void>}  cancel/unsubscribe function
 */
export async function runSimulation(params, callbacks = {}) {
  try {
    const simResponse = await startSimulation(params);

    // Handle synchronous 200 OK response — MATLAB bridge may return the full
    // result inline instead of the async 202 + { job_id } path.
    // Detect this by checking for the presence of a time-series key.
    if (simResponse.time_s != null || simResponse.electrolyzer != null) {
      callbacks.onQueued?.("sync");
      callbacks.onProgress?.({ status: "running", progress_pct: 100 });
      callbacks.onResult?.(simResponse);
      return () => {};
    }

    // job_id field — handle snake_case (contract) and camelCase (some bridge versions)
    const job_id = simResponse.job_id ?? simResponse.jobId ?? simResponse.id;
    if (!job_id) {
      throw new Error(
        `Bridge returned a 202/queued response but no job identifier. ` +
        `Got: ${JSON.stringify(simResponse)}. ` +
        `Expected a field named 'job_id', 'jobId', or 'id'.`
      );
    }

    callbacks.onQueued?.(job_id);
    const cancel = openResultsSocketWithFallback(job_id, callbacks);
    return cancel;
  } catch (networkErr) {
    // ── Local physics fallback ──────────────────────────────────────────────
    if (import.meta.env.DEV) {
      console.warn(
        "[hydrogenService] Simulation service unreachable — running local JS physics fallback.",
        networkErr.message
      );
    }

    let cancelled = false;

    // Fake progressive updates (600 ms total) so the UI shows the spinner.
    callbacks.onQueued?.("local-sim");
    const fakeProgress = [15, 40, 65, 85].map((pct, idx) =>
      setTimeout(() => {
        if (!cancelled) callbacks.onProgress?.({ status: "running", progress_pct: pct });
      }, (idx + 1) * 120)
    );

    setTimeout(() => {
      if (cancelled) return;
      fakeProgress.forEach(clearTimeout);
      try {
        const result = simulateH2Chain(params);
        callbacks.onResult?.(result);
      } catch (physicsErr) {
        callbacks.onError?.(physicsErr.message);
      }
    }, 620);

    return () => { cancelled = true; fakeProgress.forEach(clearTimeout); };
  }
}

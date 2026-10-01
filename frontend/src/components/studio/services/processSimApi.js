/**
 * processSimApi.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Client for Process simulation (ADR-0005). Requests go through the
 * authenticated opentech-db gateway, which enqueues on the internal processsim
 * job queue and returns a job handle; we poll it to completion.
 *
 *   POST /api/v1/processes/simulate            → { job_id, status, position, … }
 *   GET  /api/v1/processes/simulate/{job_id}   → { status, position, result, … }
 */

const API =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
  'http://localhost:8000/api/v1';

const TERMINAL = new Set(['done', 'error', 'timeout', 'cancelled']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function _json(res) {
  let body = null;
  try { body = await res.json(); } catch { /* */ }
  if (!res.ok) {
    const detail = body?.detail ?? `HTTP ${res.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return body;
}

/**
 * Submit a Process graph and poll the job to completion.
 * @param {{units:any[], streams:any[]}} graph
 * @param {{ onStatus?: (job)=>void, signal?: AbortSignal, intervalMs?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<Object>} the simulation result
 */
export async function runProcessSimulation(graph, opts = {}) {
  const { onStatus, signal, intervalMs = 1500, timeoutMs = 5 * 60 * 1000 } = opts;

  let job = await _json(await fetch(`${API}/processes/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(graph),
    signal,
  }));
  onStatus?.(job);

  const deadline = Date.now() + timeoutMs;
  while (!TERMINAL.has(job.status)) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the simulation.');
    await sleep(intervalMs);
    job = await _json(await fetch(`${API}/processes/simulate/${encodeURIComponent(job.job_id)}`, {
      credentials: 'include', signal,
    }));
    onStatus?.(job);
  }

  if (job.status !== 'done') {
    throw new Error(job.error || `Simulation ${job.status}.`);
  }
  return job.result;
}

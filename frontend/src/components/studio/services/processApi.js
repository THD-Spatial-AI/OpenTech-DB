/**
 * processApi.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Frontend client for the OpenTech-DB Process API (ADR-0004, Phase 1).
 *
 *   GET /api/v1/processes                → list Process summaries
 *   GET /api/v1/processes/{id_or_slug}   → full Process (Units + Streams)
 *
 * Base URL follows the main app (VITE_API_BASE_URL, already includes /api/v1).
 */

const BASE =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
  'http://localhost:8000/api/v1';

const TIMEOUT_MS = 10_000;

async function apiFetch(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal, credentials: 'include' });
    if (!res.ok) {
      let detail = '';
      try { detail = JSON.stringify((await res.json())?.detail ?? '').slice(0, 200); } catch { /* */ }
      throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** List Process summaries. @returns {Promise<{total, processes, has_more}>} */
export async function listProcesses({ status, domain } = {}) {
  const params = new URLSearchParams({ limit: '100' });
  if (status) params.set('status', status);
  if (domain) params.set('domain', domain);
  return apiFetch(`/processes?${params}`);
}

/** Fetch one full Process by UUID or slug. @returns {Promise<Process>} */
export async function getProcess(idOrSlug) {
  return apiFetch(`/processes/${encodeURIComponent(idOrSlug)}`);
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json())?.detail ?? detail; } catch { /* */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return res.json();
}

/** Contribute a Process for review. @param {Object} process full Process payload */
export async function submitProcess(process) {
  return post('/processes/submit', process);
}

/** List Process submissions (review queue). @param {string} [status] */
export async function listSubmissions(status) {
  return apiFetch(`/processes/submissions${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}

/** Approve or reject a submission. @param {'approve'|'reject'} action */
export async function reviewSubmission(id, action, reason) {
  return post(`/processes/submissions/${encodeURIComponent(id)}/review`, { action, reason });
}

import { useCallback, useEffect, useRef, useState } from 'react';

// Simulation lifecycle states for a physics-sim service (H2 plant, CCS chain).
export const SIM_STATES = { IDLE: 'idle', QUEUED: 'queued', RUNNING: 'running', DONE: 'done', ERROR: 'error' };

/**
 * Drives the queued → running → done/error lifecycle of a physics simulation
 * service and polls its /health every 30 s. Extracted from HydrogenPlantDashboard
 * so the async state machine is testable in isolation (feed it a fake runFn) and
 * reusable by any panel that runs an H2/CCS-style job.
 *
 * @param {() => Promise<object>} checkHealth  service health probe (polled every 30 s)
 *
 * Usage:
 *   const sim = useUnitSimulation(checkHealth);
 *   sim.run(() => ({ runFn, payload, normalize }));  // build the request lazily
 *   // runFn(payload, { onQueued, onProgress, onResult, onError }) → cancel fn
 *
 * The caller keeps its own payload building; only the state machine lives here.
 */
export function useUnitSimulation(checkHealth) {
  const [simState, setSimState] = useState(SIM_STATES.IDLE);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);
  const cancelRef = useRef(null);

  const pingHealth = useCallback(async () => {
    try {
      const h = await checkHealth();
      setHealth(h);
      setHealthError(null);
    } catch (e) {
      setHealth(null);
      setHealthError(e.message);
    }
  }, [checkHealth]);

  useEffect(() => {
    pingHealth();
    const id = setInterval(pingHealth, 30_000);
    return () => clearInterval(id);
  }, [pingHealth]);

  // buildRequest() returns { runFn, payload, normalize }. It runs inside the
  // try, so a throw while building the payload surfaces as an ERROR state too.
  const run = useCallback(async (buildRequest) => {
    setSimState(SIM_STATES.QUEUED);
    setProgress(0);
    setResult(null);
    setErrorMsg(null);

    try {
      const { runFn, payload, normalize } = buildRequest();
      const cancel = await runFn(payload, {
        onQueued:   () => setSimState(SIM_STATES.QUEUED),
        onProgress: (d) => { setSimState(SIM_STATES.RUNNING); setProgress(d.progress_pct ?? 0); },
        onResult:   (r) => { setResult(normalize(r)); setSimState(SIM_STATES.DONE); pingHealth(); },
        onError:    (m) => { setErrorMsg(typeof m === 'string' ? m : (m?.message ?? String(m ?? 'Unknown error'))); setSimState(SIM_STATES.ERROR); },
      });
      cancelRef.current = cancel;
    } catch (e) {
      setErrorMsg(e.message);
      setSimState(SIM_STATES.ERROR);
    }
  }, [pingHealth]);

  const stop = useCallback(() => {
    cancelRef.current?.();
    setSimState(SIM_STATES.IDLE);
    setProgress(0);
  }, []);

  const reset = useCallback(() => {
    stop();
    setResult(null);
    setErrorMsg(null);
  }, [stop]);

  return {
    simState, setSimState,
    progress, setProgress,
    result, setResult,
    errorMsg, setErrorMsg,
    health, healthError, pingHealth,
    run, stop, reset,
  };
}

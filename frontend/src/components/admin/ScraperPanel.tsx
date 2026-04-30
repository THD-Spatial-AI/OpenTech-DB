/**
 * components/admin/ScraperPanel.tsx
 * ───────────────────────────────────
 * Admin UI for the automated web-scraping pipeline.
 *
 * Tabs
 * ────
 * 1. Dashboard — scheduler status, enabled sources, queue summary, last run
 * 2. Candidates — paginated list; filter by status / technology
 *    ↳ CandidateDetailModal — full paper details + extracted params + approve/reject
 */

import { useState, useCallback, useEffect } from "react";
import {
  fetchScraperStatus,
  fetchScraperCandidates,
  fetchScraperRuns,
  triggerScraperRun,
  approveScraperCandidate,
  rejectScraperCandidate,
} from "../../services/api";
import type { ScraperStatus, ScraperCandidate, ScraperRun, ExtractedParam, ScraperSchedulerJob } from "../../types/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function StatusPill({ status }: { status: ScraperCandidate["status"] }) {
  const map = {
    pending:  "bg-amber-100 text-amber-800 border-amber-200",
    approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
    rejected: "bg-red-100 text-red-700 border-red-200",
  } as const;
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${map[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, value) * 100);
  const color =
    pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] tabular-nums text-slate-400 w-7 text-right">{pct}%</span>
    </div>
  );
}

// ── Candidate detail modal ────────────────────────────────────────────────────

function CandidateDetailModal({
  candidate,
  token,
  onClose,
  onAction,
}: {
  candidate: ScraperCandidate;
  token: string;
  onClose: () => void;
  onAction: (id: string, newStatus: "approved" | "rejected") => void;
}) {
  const [acting, setActing] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const isPending = candidate.status === "pending";

  const handleApprove = async () => {
    setActing(true);
    setActionError(null);
    try {
      await approveScraperCandidate(token, candidate.candidate_id);
      onAction(candidate.candidate_id, "approved");
      onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    setActing(true);
    setActionError(null);
    try {
      await rejectScraperCandidate(token, candidate.candidate_id, rejectReason || undefined);
      onAction(candidate.candidate_id, "rejected");
      onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  };

  const paramKeys = Object.keys(candidate.extracted_params);

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-slate-800 truncate">
                {candidate.paper.title || "Untitled Paper"}
              </h2>
              <StatusPill status={candidate.status} />
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {candidate.paper.authors.length > 0 && (
                <span className="text-[11px] text-slate-400">
                  {candidate.paper.authors.slice(0, 3).join(", ")}
                  {candidate.paper.authors.length > 3 ? " et al." : ""}
                </span>
              )}
              {candidate.paper.year && (
                <span className="text-[11px] text-slate-400">{candidate.paper.year}</span>
              )}
              {candidate.paper.venue && (
                <span className="text-[11px] text-slate-400 italic">{candidate.paper.venue}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 transition-colors p-1 ml-3"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto max-h-[65vh]">

          {/* Technology target */}
          <div className="border-b border-slate-100">
            <div className="flex items-center gap-2 px-5 py-2 bg-slate-50/70">
              <span className="material-symbols-outlined text-[13px] text-indigo-500">bolt</span>
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Target Technology</p>
            </div>
            <div className="px-5 py-3 flex items-center gap-3">
              <span className="text-sm font-bold text-slate-800">{candidate.technology_name}</span>
              <span className="text-[10px] font-mono text-slate-400">{candidate.technology_id}</span>
            </div>
          </div>

          {/* Abstract */}
          {candidate.paper.abstract && (
            <div className="border-b border-slate-100">
              <div className="flex items-center gap-2 px-5 py-2 bg-slate-50/70">
                <span className="material-symbols-outlined text-[13px] text-indigo-500">article</span>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Abstract</p>
              </div>
              <div className="px-5 py-3">
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-5">
                  {candidate.paper.abstract}
                </p>
              </div>
            </div>
          )}

          {/* Source & links */}
          <div className="border-b border-slate-100">
            <div className="flex items-center gap-2 px-5 py-2 bg-slate-50/70">
              <span className="material-symbols-outlined text-[13px] text-indigo-500">link</span>
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Source & Links</p>
            </div>
            <div className="px-5 py-3 flex items-center gap-4 flex-wrap">
              <span className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
                {candidate.paper.source}
              </span>
              {candidate.paper.doi && (
                <a
                  href={`https://doi.org/${candidate.paper.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
                >
                  <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                  DOI: {candidate.paper.doi}
                </a>
              )}
              {candidate.paper.url && !candidate.paper.doi && (
                <a
                  href={candidate.paper.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
                >
                  <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                  View Paper
                </a>
              )}
            </div>
          </div>

          {/* Extracted parameters */}
          {paramKeys.length > 0 && (
            <div className="border-b border-slate-100">
              <div className="flex items-center gap-2 px-5 py-2 bg-slate-50/70">
                <span className="material-symbols-outlined text-[13px] text-indigo-500">analytics</span>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                  Extracted Parameters ({paramKeys.length})
                </p>
              </div>
              <div className="px-5 py-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {paramKeys.map((key) => {
                    const p = candidate.extracted_params[key] as ExtractedParam;
                    return (
                      <div key={key} className="rounded-lg border border-slate-100 p-3">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                          {key.replace(/_/g, " ")}
                        </p>
                        <p className="text-sm font-bold text-slate-800 tabular-nums">
                          {p.value} <span className="text-xs font-normal text-slate-400">{p.unit}</span>
                        </p>
                        <ConfidenceBar value={p.confidence} />
                        {p.source_text && (
                          <p className="mt-1.5 text-[10px] text-slate-400 italic leading-relaxed line-clamp-2">
                            "{p.source_text}"
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Proposed catalogue instance */}
          {Object.keys(candidate.proposed_instance).length > 0 && (
            <div className="border-b border-slate-100">
              <div className="flex items-center gap-2 px-5 py-2 bg-slate-50/70">
                <span className="material-symbols-outlined text-[13px] text-indigo-500">data_object</span>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Proposed Catalogue Instance</p>
              </div>
              <div className="px-5 py-3">
                <pre className="text-[10px] text-slate-600 font-mono bg-slate-50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(candidate.proposed_instance, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Metadata */}
          <div>
            <div className="flex items-center gap-2 px-5 py-2 bg-slate-50/70">
              <span className="material-symbols-outlined text-[13px] text-indigo-500">info</span>
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Metadata</p>
            </div>
            <div className="px-5 py-3 flex flex-wrap gap-x-6 gap-y-1">
              <p className="text-[11px] text-slate-400">
                <span className="font-semibold">Created:</span> {fmt(candidate.created_at)}
              </p>
              {candidate.reviewed_at && (
                <p className="text-[11px] text-slate-400">
                  <span className="font-semibold">Reviewed:</span> {fmt(candidate.reviewed_at)}
                  {candidate.reviewed_by ? ` by ${candidate.reviewed_by}` : ""}
                </p>
              )}
              {candidate.review_notes && (
                <p className="text-[11px] text-slate-400">
                  <span className="font-semibold">Notes:</span> {candidate.review_notes}
                </p>
              )}
              <p className="text-[9px] font-mono text-slate-300 w-full mt-1">ID: {candidate.candidate_id}</p>
            </div>
          </div>
        </div>

        {/* Footer — action buttons */}
        <div className="px-6 py-4 border-t border-slate-100">
          {actionError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">
              <span className="material-symbols-outlined text-[13px] text-red-500">error</span>
              <p className="text-xs text-red-700">{actionError}</p>
            </div>
          )}

          {rejectMode ? (
            <div className="space-y-3">
              <textarea
                rows={2}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Rejection reason (optional — shown in logs)"
                className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2
                           focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setRejectMode(false); setRejectReason(""); }}
                  className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2 rounded-xl hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={acting}
                  className="flex items-center gap-1.5 text-sm font-bold text-white bg-red-500 hover:bg-red-600
                             px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[14px]">cancel</span>
                  {acting ? "Rejecting…" : "Confirm Reject"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 justify-between items-center">
              <button
                onClick={onClose}
                className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2 rounded-xl hover:bg-slate-100 transition-colors"
              >
                Close
              </button>
              {isPending && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setRejectMode(true)}
                    disabled={acting}
                    className="flex items-center gap-1.5 text-sm font-bold text-white bg-red-500 hover:bg-red-600
                               px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[14px]">cancel</span>
                    Reject
                  </button>
                  <button
                    onClick={handleApprove}
                    disabled={acting}
                    className="flex items-center gap-1.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700
                               px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[14px]">check_circle</span>
                    {acting ? "Approving…" : "Approve & Merge"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Dashboard tab ─────────────────────────────────────────────────────────────

function DashboardTab({
  status,
  loading,
  onRefresh,
  onRun,
  running,
}: {
  status: ScraperStatus | null;
  loading: boolean;
  onRefresh: () => void;
  onRun: () => void;
  running: boolean;
}) {
  if (!status) {
    return (
      <div className="flex items-center justify-center py-20 gap-3">
        <span className="material-symbols-outlined text-[28px] text-indigo-400 animate-spin">autorenew</span>
        <p className="text-slate-400 text-sm">Loading scraper status…</p>
      </div>
    );
  }

  const { scheduler, enabled_sources, candidates, last_run } = status;

  // Pick the soonest scheduled job to display
  const nextJob: ScraperSchedulerJob | undefined =
    scheduler.jobs.length > 0
      ? scheduler.jobs.slice().sort((a, b) => {
          if (!a.next_run) return 1;
          if (!b.next_run) return -1;
          return a.next_run < b.next_run ? -1 : 1;
        })[0]
      : undefined;

  return (
    <div className="space-y-6">
      {/* Top row stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {([
          { label: "Pending Review", value: candidates.pending,  icon: "pending",       color: "text-amber-600  bg-amber-50  border-amber-100"  },
          { label: "Approved",       value: candidates.approved, icon: "check_circle",  color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
          { label: "Rejected",       value: candidates.rejected, icon: "cancel",        color: "text-red-600    bg-red-50    border-red-100"    },
          { label: "Sources Active", value: enabled_sources.length, icon: "hub",        color: "text-indigo-600 bg-indigo-50  border-indigo-100" },
        ] as const).map(({ label, value, icon, color }) => (
          <div key={label} className={`rounded-2xl border p-4 ${color}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[16px]">{icon}</span>
              <p className="text-[9px] font-bold uppercase tracking-widest opacity-70">{label}</p>
            </div>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {/* Scheduler + Run Now */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 bg-slate-50/70 border-b border-slate-100">
          <span className="material-symbols-outlined text-[13px] text-indigo-500">schedule</span>
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Scheduler</p>
          <div className="ml-auto flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${scheduler.running ? "bg-emerald-500" : "bg-slate-300"}`}
            />
            <span className="text-[10px] font-semibold text-slate-500">
              {scheduler.running ? "Running" : "Stopped"}
            </span>
          </div>
        </div>
        <div className="px-5 py-4 flex flex-wrap items-center gap-4 justify-between">
          <div>
            <p className="text-[10px] text-slate-400 font-semibold">Next scheduled run</p>
            <p className="text-sm font-bold text-slate-700 mt-0.5">
              {nextJob?.next_run ? fmt(nextJob.next_run) : "Not scheduled"}
            </p>
            {nextJob && (
              <p className="text-[10px] text-slate-400 mt-0.5">{nextJob.name}</p>
            )}
            <p className="text-[10px] text-slate-400 mt-2">
              Runs automatically on the 1st and 15th of each month at 02:00 UTC.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600
                         border border-slate-200 px-3 py-2 rounded-xl hover:bg-indigo-50 transition-colors"
            >
              <span className={`material-symbols-outlined text-[14px] ${loading ? "animate-spin" : ""}`}>
                refresh
              </span>
              Refresh
            </button>
            <button
              onClick={onRun}
              disabled={running}
              className="flex items-center gap-1.5 text-xs font-bold text-white bg-indigo-600
                         hover:bg-indigo-700 px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-[14px] ${running ? "animate-spin" : ""}`}>
                {running ? "progress_activity" : "play_arrow"}
              </span>
              {running ? "Running…" : "Run Now"}
            </button>
          </div>
        </div>
      </div>

      {/* Enabled sources */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 bg-slate-50/70 border-b border-slate-100">
          <span className="material-symbols-outlined text-[13px] text-indigo-500">hub</span>
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Data Sources</p>
        </div>
        <div className="px-5 py-4 flex flex-wrap gap-2">
          {enabled_sources.map((src) => (
            <span
              key={src}
              className="flex items-center gap-1.5 text-xs font-semibold bg-indigo-50 text-indigo-700
                         border border-indigo-100 px-3 py-1 rounded-full"
            >
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
              {src}
            </span>
          ))}
        </div>
      </div>

      {/* Last run summary */}
      {last_run && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 bg-slate-50/70 border-b border-slate-100">
            <span className="material-symbols-outlined text-[13px] text-indigo-500">history</span>
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Last Pipeline Run</p>
          </div>
          <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider mb-1">Started</p>
              <p className="text-xs font-bold text-slate-700">{fmt(last_run.started_at)}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider mb-1">Finished</p>
              <p className="text-xs font-bold text-slate-700">{fmt(last_run.finished_at)}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider mb-1">Papers Found</p>
              <p className="text-xl font-bold text-slate-700 tabular-nums">{last_run.papers_found}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider mb-1">Candidates Created</p>
              <p className="text-xl font-bold text-indigo-600 tabular-nums">{last_run.candidates_created}</p>
            </div>
          </div>
          {last_run.error && (
            <div className="mx-5 mb-4 flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <span className="material-symbols-outlined text-[13px] text-red-500 mt-0.5">error</span>
              <p className="text-xs text-red-700 font-mono">{last_run.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Activity / Run log tab ────────────────────────────────────────────────────

function ActivityTab() {
  const [runs,      setRuns]      = useState<ScraperRun[] | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [expanded,  setExpanded]  = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchScraperRuns(50)
      .then((data) => setRuns(data.runs))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load runs."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const dur = (r: ScraperRun) => {
    if (!r.started_at || !r.finished_at) return null;
    const secs = Math.round(
      (new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000
    );
    return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Last 50 pipeline runs, newest first.</p>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600
                     border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
        >
          <span className={`material-symbols-outlined text-[13px] ${loading ? "animate-spin" : ""}`}>refresh</span>
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <span className="material-symbols-outlined text-red-500">error</span>
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading && runs === null && (
        <div className="flex items-center justify-center py-16 gap-3">
          <span className="material-symbols-outlined text-[28px] text-indigo-400 animate-spin">autorenew</span>
          <p className="text-slate-400 text-sm">Loading run history…</p>
        </div>
      )}

      {!loading && runs !== null && runs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <span className="material-symbols-outlined text-5xl text-slate-200">history</span>
          <p className="text-slate-400 font-semibold">No runs yet</p>
          <p className="text-slate-300 text-sm">Trigger a pipeline run from the Dashboard tab to see activity here.</p>
        </div>
      )}

      {runs && runs.length > 0 && (
        <div className="space-y-2">
          {runs.map((run) => {
            const isOpen   = expanded === run.run_id;
            const hasErr   = run.errors.length > 0;
            const isOk     = !hasErr && (run.finished_at !== null);
            return (
              <div key={run.run_id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {/* Summary row */}
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : run.run_id)}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`material-symbols-outlined text-[18px] ${isOk ? "text-emerald-500" : hasErr ? "text-amber-500" : "text-slate-300"}`}>
                      {isOk ? "check_circle" : hasErr ? "warning" : "pending"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="text-xs font-bold text-slate-700">{fmt(run.started_at)}</span>
                        {dur(run) && <span className="text-[10px] text-slate-400">({dur(run)})</span>}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
                        <span className="text-[10px] text-slate-500">
                          <span className="font-semibold">{run.technologies_processed}</span> techs
                        </span>
                        <span className="text-[10px] text-slate-500">
                          <span className="font-semibold">{run.papers_fetched}</span> papers
                        </span>
                        <span className="text-[10px] text-indigo-600 font-semibold">
                          +{run.candidates_created} candidates
                        </span>
                        {hasErr && (
                          <span className="text-[10px] text-amber-600 font-semibold">
                            {run.errors.length} errors
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`material-symbols-outlined text-[16px] text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}>
                      expand_more
                    </span>
                  </div>
                </button>

                {/* Detail panel */}
                {isOpen && (
                  <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: "Run ID",      value: run.run_id.slice(0, 8) + "…" },
                        { label: "Started",     value: fmt(run.started_at) },
                        { label: "Finished",    value: fmt(run.finished_at) },
                        { label: "Duration",    value: dur(run) ?? "—" },
                        { label: "Technologies", value: String(run.technologies_processed) },
                        { label: "Papers",      value: String(run.papers_fetched) },
                        { label: "Candidates",  value: String(run.candidates_created) },
                        { label: "Errors",      value: String(run.errors.length) },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
                          <p className="text-xs font-semibold text-slate-700 mt-0.5">{value}</p>
                        </div>
                      ))}
                    </div>
                    {hasErr && (
                      <div>
                        <p className="text-[9px] font-bold text-amber-600 uppercase tracking-wider mb-2">Errors / Warnings</p>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {run.errors.map((err, i) => (
                            <p key={i} className="text-[10px] font-mono text-amber-800 bg-amber-50 rounded px-2 py-1 leading-snug">
                              {err}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Candidates tab ────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ["all", "pending", "approved", "rejected"] as const;
type CandidateFilter = (typeof STATUS_OPTIONS)[number];

function CandidatesTab({
  token,
}: {
  token: string;
}) {
  const [candidates,   setCandidates]   = useState<ScraperCandidate[] | null>(null);
  const [loadError,    setLoadError]    = useState<string | null>(null);
  const [filter,       setFilter]       = useState<CandidateFilter>("pending");
  const [techFilter,   setTechFilter]   = useState("");
  const [selected,     setSelected]     = useState<ScraperCandidate | null>(null);
  const [loading,      setLoading]      = useState(false);

  const load = useCallback((status: CandidateFilter, techId?: string) => {
    setLoading(true);
    setLoadError(null);
    fetchScraperCandidates({
      status: status === "all" ? undefined : status,
      technology_id: techId || undefined,
      limit: 200,
    })
      .then((res) => setCandidates(res.candidates))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load candidates."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(filter, techFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, techFilter]);

  const handleAction = useCallback(
    (id: string, newStatus: "approved" | "rejected") => {
      setCandidates((prev) =>
        prev ? prev.map((c) => c.candidate_id === id ? { ...c, status: newStatus } : c) : prev
      );
    },
    []
  );

  const visible = candidates ?? [];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={[
                "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors capitalize",
                filter === s
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200",
              ].join(" ")}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Filter by technology ID…"
          value={techFilter}
          onChange={(e) => setTechFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 flex-1 max-w-xs
                     focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <button
          onClick={() => load(filter, techFilter)}
          disabled={loading}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600
                     border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors ml-auto"
        >
          <span className={`material-symbols-outlined text-[13px] ${loading ? "animate-spin" : ""}`}>
            refresh
          </span>
          Refresh
        </button>
      </div>

      {/* Error */}
      {loadError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <span className="material-symbols-outlined text-red-500">error</span>
          <p className="text-sm text-red-700">{loadError}</p>
        </div>
      )}

      {/* Loading */}
      {loading && candidates === null && (
        <div className="flex items-center justify-center py-16 gap-3">
          <span className="material-symbols-outlined text-[28px] text-indigo-400 animate-spin">autorenew</span>
          <p className="text-slate-400 text-sm">Loading candidates…</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && candidates !== null && visible.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <span className="material-symbols-outlined text-5xl text-slate-200">search_off</span>
          <p className="text-slate-400 font-semibold">No {filter === "all" ? "" : filter} candidates</p>
          <p className="text-slate-300 text-sm">
            Run the scraper pipeline to discover new candidates from the literature.
          </p>
        </div>
      )}

      {/* Candidate list */}
      {visible.length > 0 && (
        <div className="space-y-2">
          {visible.map((c) => (
            <button
              key={c.candidate_id}
              type="button"
              onClick={() => setSelected(c)}
              className="w-full text-left bg-white rounded-xl border border-slate-200 hover:border-indigo-300
                         hover:shadow-sm transition-all p-4 group"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <StatusPill status={c.status} />
                    <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded capitalize">
                      {c.technology_name}
                    </span>
                    {c.paper.year && (
                      <span className="text-[10px] text-slate-400">{c.paper.year}</span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-800 truncate group-hover:text-indigo-700 transition-colors">
                    {c.paper.title || "Untitled"}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    {c.paper.authors.length > 0 && (
                      <p className="text-[11px] text-slate-400 truncate">
                        {c.paper.authors.slice(0, 2).join(", ")}
                        {c.paper.authors.length > 2 ? " et al." : ""}
                      </p>
                    )}
                    {c.paper.venue && (
                      <p className="text-[11px] text-slate-400 italic truncate">{c.paper.venue}</p>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 flex flex-col items-end gap-1">
                  <span className="text-[10px] font-semibold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded">
                    {Object.keys(c.extracted_params).length} params
                  </span>
                  <span className="text-[9px] text-slate-400 font-mono">{c.paper.source}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <CandidateDetailModal
          candidate={selected}
          token={token}
          onClose={() => setSelected(null)}
          onAction={(id, newStatus) => {
            handleAction(id, newStatus);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

// ── ScraperPanel (exported) ───────────────────────────────────────────────────

type ScraperTab = "dashboard" | "candidates" | "activity";

export default function ScraperPanel({ token }: { token: string }) {
  const [tab,      setTab]      = useState<ScraperTab>("dashboard");
  const [status,   setStatus]   = useState<ScraperStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [running,  setRunning]  = useState(false);
  const [runMsg,   setRunMsg]   = useState<string | null>(null);

  const loadStatus = useCallback(() => {
    setLoading(true);
    setStatusErr(null);
    fetchScraperStatus()
      .then((data) => setStatus(data))
      .catch((e) => setStatusErr(e instanceof Error ? e.message : "Failed to load scraper status."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleRun = async () => {
    setRunning(true);
    setRunMsg(null);
    try {
      const res = await triggerScraperRun(token);
      setRunMsg(res.message);
      // Refresh status after a short delay so queue counts update
      setTimeout(() => loadStatus(), 3000);
    } catch (e) {
      setRunMsg(e instanceof Error ? e.message : "Run failed.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-indigo-600">travel_explore</span>
            Scraper Pipeline
          </h2>
          <p className="text-slate-400 text-xs mt-0.5">
            Automated literature scraping — review and approve extracted technology parameters.
          </p>
        </div>
      </div>

      {statusErr && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <span className="material-symbols-outlined text-red-500 mt-0.5">error</span>
          <div>
            <p className="text-sm font-semibold text-red-700">{statusErr}</p>
            {(statusErr.includes("404") || statusErr.toLowerCase().includes("not found") || statusErr.toLowerCase().includes("fetch")) && (
              <p className="text-xs text-red-500 mt-1">
                The scraper API is not reachable. Make sure the backend server is running and restart it
                if you recently updated the code (<code className="font-mono bg-red-100 px-1 rounded">uvicorn main:app --reload</code>).
              </p>
            )}
          </div>
        </div>
      )}

      {runMsg && (
        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
          <span className="material-symbols-outlined text-indigo-500">info</span>
          <p className="text-sm text-indigo-700">{runMsg}</p>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-slate-100">
        {([
          { id: "dashboard"  as ScraperTab, label: "Dashboard",  icon: "dashboard"    },
          { id: "candidates" as ScraperTab, label: "Candidates", icon: "rate_review"  },
          { id: "activity"   as ScraperTab, label: "Activity",   icon: "history"      },
        ]).map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={[
              "flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl transition-colors border-b-2",
              tab === id
                ? "text-indigo-600 border-indigo-500 bg-indigo-50/60"
                : "text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50",
            ].join(" ")}
          >
            <span className="material-symbols-outlined text-[15px]">{icon}</span>
            {label}
            {id === "candidates" && status && status.candidates.pending > 0 && (
              <span className="ml-1 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                {status.candidates.pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "dashboard" && (
        <DashboardTab
          status={status}
          loading={loading}
          onRefresh={loadStatus}
          onRun={handleRun}
          running={running}
        />
      )}

      {tab === "candidates" && (
        <CandidatesTab token={token} />
      )}

      {tab === "activity" && (
        <ActivityTab />
      )}
    </div>
  );
}

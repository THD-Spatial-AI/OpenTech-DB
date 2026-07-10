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
  stopScraperRun,
  approveScraperCandidate,
  rejectScraperCandidate,
  fetchAdminProfileSubmissions,
  runTimeseriesPipeline,
} from "../../services/api";
import type {
  ScraperStatus,
  ScraperCandidate,
  ScraperRun,
  ScraperRunEvent,
  ExtractedParam,
  ScraperSchedulerJob,
} from "../../types/api";

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
  currentIndex,
  totalCount,
  onPrev,
  onNext,
}: {
  candidate: ScraperCandidate;
  token: string;
  onClose: () => void;
  onAction: (id: string, newStatus: "approved" | "rejected") => void;
  currentIndex?: number;
  totalCount?: number;
  onPrev?: () => void;
  onNext?: () => void;
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
          {/* Nav controls + position indicator */}
          <div className="flex items-center gap-1 ml-3 flex-shrink-0">
            {currentIndex !== undefined && totalCount !== undefined && (
              <span className="text-[10px] font-semibold text-slate-400 tabular-nums px-1">
                {currentIndex + 1} / {totalCount}
              </span>
            )}
            {onPrev && (
              <button
                onClick={onPrev}
                disabled={currentIndex === 0}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100
                           disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Previous"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>
            )}
            {onNext && (
              <button
                onClick={onNext}
                disabled={currentIndex !== undefined && totalCount !== undefined && currentIndex >= totalCount - 1}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100
                           disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Next"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 transition-colors p-1 ml-1"
              aria-label="Close"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
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

function fmtElapsed(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "00")}s` : `${s}s`;
}

function runDurSecs(r: ScraperRun): number | null {
  if (!r.started_at || !r.finished_at) return null;
  return Math.round(
    (new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000
  );
}

function runDur(r: ScraperRun): string | null {
  const s = runDurSecs(r);
  if (s === null) return null;
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function DashboardTab({
  status,
  loading,
  onRefresh,
  onRun,
  onStop,
  stopping,
  running,
  runStartTime,
  runs,
  runsLoading,
  runsError,
}: {
  status: ScraperStatus | null;
  loading: boolean;
  onRefresh: () => void;
  onRun: () => void;
  onStop: () => void;
  stopping: boolean;
  running: boolean;
  runStartTime: Date | null;
  runs: ScraperRun[];
  runsLoading: boolean;
  runsError: string | null;
}) {
  // Tick elapsed seconds while a run is active
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!runStartTime) { setElapsed(0); return; }
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - runStartTime.getTime()) / 1000)),
      1000
    );
    return () => clearInterval(id);
  }, [runStartTime]);

  if (!status) {
    return (
      <div className="flex items-center justify-center py-20 gap-3">
        <span className="material-symbols-outlined text-[28px] text-indigo-400 animate-spin">autorenew</span>
        <p className="text-slate-400 text-sm">Loading scraper status…</p>
      </div>
    );
  }

  const { scheduler, enabled_sources, candidates } = status;
  const liveRun = status.current_run ?? null;
  const logTail = (liveRun?.log_tail && liveRun.log_tail.length > 0)
    ? liveRun.log_tail
    : (status.current_log_tail ?? []);

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

      {/* ── LIVE STATUS BANNER ─────────────────────────────────────────────── */}
      {(() => {
        // Compute average duration from last 5 completed runs for ETA
        const completedDurs = runs
          .filter(r => r.started_at && r.finished_at)
          .slice(0, 5)
          .map(r => runDurSecs(r)!)
          .filter(Boolean);
        const avgSecs = completedDurs.length
          ? Math.round(completedDurs.reduce((a, b) => a + b, 0) / completedDurs.length)
          : null;
        const elapsedSecs = liveRun?.elapsed_seconds ?? elapsed;
        const progressPctLive = (running && avgSecs && elapsedSecs > 0)
          ? Math.min(95, Math.round((elapsedSecs / avgSecs) * 100))
          : null;
        const remaining = (running && avgSecs) ? Math.max(0, avgSecs - elapsedSecs) : null;

        return running ? (
          <div className="relative overflow-hidden bg-gradient-to-r from-indigo-600 to-violet-600
                          text-white rounded-2xl shadow-lg">
            <div className="relative px-5 py-4 flex items-center gap-5">
              <span className="material-symbols-outlined text-[38px] animate-spin flex-shrink-0">
                progress_activity
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm leading-none">Pipeline is running…</p>
                <p className="text-indigo-200 text-xs mt-1">
                  {liveRun?.current_technology
                    ? `Technology: ${liveRun.current_technology}`
                    : `Querying ${enabled_sources.length} source${enabled_sources.length !== 1 ? "s" : ""}`}
                </p>
                <p className="text-indigo-100 text-[11px] mt-1">
                  {liveRun?.current_source ? `Source: ${liveRun.current_source}` : "Source: preparing"}
                  {liveRun?.current_phase ? ` • Phase: ${liveRun.current_phase}` : ""}
                </p>
                {liveRun && (
                  <p className="text-indigo-200 text-[10px] mt-1">
                    {liveRun.technologies_processed}/{Math.max(1, liveRun.technologies_total)} techs • {liveRun.papers_fetched} papers • {liveRun.candidates_created} candidates
                  </p>
                )}
                {/* Phase labels */}
                <div className="mt-2 flex items-center gap-3 text-[10px] font-semibold">
                  {["Fetch papers", "Extract params", "Store candidates"].map((phase, i) => {
                    const phasePct = progressPctLive ?? 0;
                    const active = phasePct < 40 ? i === 0 : phasePct < 80 ? i === 1 : i === 2;
                    const done   = phasePct < 40 ? false : phasePct < 80 ? i === 0 : i < 2;
                    return (
                      <span key={phase} className={[
                        "flex items-center gap-1 px-2 py-0.5 rounded-full transition-all",
                        done   ? "bg-white/30 text-white" :
                        active ? "bg-white/20 text-white animate-pulse" :
                                 "text-indigo-300",
                      ].join(" ")}>
                        <span className="material-symbols-outlined text-[11px]">
                          {done ? "check" : active ? "radio_button_checked" : "radio_button_unchecked"}
                        </span>
                        {phase}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="text-right flex-shrink-0 space-y-0.5">
                <p className="text-2xl font-bold tabular-nums leading-none">{fmtElapsed(elapsedSecs)}</p>
                <p className="text-indigo-300 text-[10px]">elapsed</p>
                {remaining !== null && (
                  <p className="text-indigo-200 text-[10px]">
                    ~{fmtElapsed(remaining)} left
                  </p>
                )}
                {avgSecs && (
                  <p className="text-indigo-300 text-[9px]">avg {fmtElapsed(avgSecs)}</p>
                )}
              </div>
            </div>
            {/* Determinate or indeterminate progress bar */}
            <div className="h-1.5 bg-white/20">
              {progressPctLive !== null ? (
                <div
                  className="h-full bg-white/70 rounded-full transition-all duration-1000"
                  style={{ width: `${progressPctLive}%` }}
                />
              ) : (
                <div
                  className="h-full bg-white/50 rounded-full"
                  style={{ width: "35%", animation: "progressSlide 1.8s ease-in-out infinite alternate" }}
                />
              )}
            </div>
            <style>{`@keyframes progressSlide{from{margin-left:0%}to{margin-left:65%}}`}</style>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
            <p className="text-sm font-semibold text-slate-600">Pipeline idle</p>
            {avgSecs && (
              <span className="text-[10px] text-slate-400">
                avg run: {fmtElapsed(avgSecs)}
              </span>
            )}
            {runs.length > 0 && runs[0].finished_at && (
              <p className="text-xs text-slate-400 ml-auto">
                Last run: <span className="font-semibold">{fmt(runs[0].finished_at)}</span>
                {runDur(runs[0]) && <span className="ml-1 text-slate-300">({runDur(runs[0])})</span>}
              </p>
            )}
          </div>
        );
      })()}

      {/* ── ACTIVE PROCESS STATUS ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-3 flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full ${(liveRun?.running ?? false) ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
        <p className="text-sm font-semibold text-slate-700">
          {(liveRun?.running ?? false) ? "Active pipeline process detected" : "No active pipeline process"}
        </p>
        {liveRun?.run_id && (
          <span className="text-[10px] font-mono text-slate-400">run {String(liveRun.run_id).slice(0, 8)}</span>
        )}
        {liveRun?.current_phase && (
          <span className="text-[10px] text-slate-500 ml-auto">phase: {liveRun.current_phase}</span>
        )}
      </div>

      {/* ── STAT CARDS ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {([
          { label: "Pending Review", value: candidates.pending,     icon: "pending",      color: "text-amber-600   bg-amber-50   border-amber-100"   },
          { label: "Approved",       value: candidates.approved,    icon: "check_circle", color: "text-emerald-600 bg-emerald-50 border-emerald-100"  },
          { label: "Rejected",       value: candidates.rejected,    icon: "cancel",       color: "text-red-600     bg-red-50     border-red-100"      },
          { label: "Sources Active", value: enabled_sources.length, icon: "hub",          color: "text-indigo-600  bg-indigo-50  border-indigo-100"   },
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

      {/* ── SCHEDULER + RUN NOW ────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 bg-slate-50/70 border-b border-slate-100">
          <span className="material-symbols-outlined text-[13px] text-indigo-500">schedule</span>
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Scheduler</p>
          <div className="ml-auto flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${scheduler.running ? "bg-emerald-500" : "bg-slate-300"}`} />
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
            {nextJob && <p className="text-[10px] text-slate-400 mt-0.5">{nextJob.name}</p>}
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
            <button
              onClick={onStop}
              disabled={!running || stopping}
              className="flex items-center gap-1.5 text-xs font-bold text-white bg-red-600
                         hover:bg-red-700 px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
              title={!running ? "No active run" : "Request pipeline stop"}
            >
              <span className={`material-symbols-outlined text-[14px] ${stopping ? "animate-spin" : ""}`}>
                {stopping ? "progress_activity" : "stop"}
              </span>
              {stopping ? "Stopping…" : "Stop"}
            </button>
          </div>
        </div>
      </div>

      {/* ── DATA SOURCES ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 bg-slate-50/70 border-b border-slate-100">
          <span className="material-symbols-outlined text-[13px] text-indigo-500">hub</span>
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Data Sources</p>
          <span className="ml-auto text-[10px] font-semibold text-slate-400">
            {enabled_sources.length} active
          </span>
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

      {/* ── PIPELINE ACTIVITY LOG ──────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 bg-slate-50/70 border-b border-slate-100">
          <span className="material-symbols-outlined text-[13px] text-indigo-500">receipt_long</span>
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Pipeline Activity</p>
          {runsLoading && (
            <span className="material-symbols-outlined text-[13px] text-slate-400 animate-spin ml-1">
              autorenew
            </span>
          )}
          <span className="ml-auto text-[9px] text-slate-400">
            {runs.length > 0 ? `${runs.length} run${runs.length !== 1 ? "s" : ""}` : ""}
          </span>
        </div>

        {(liveRun?.events?.length ?? 0) > 0 && (
          <div className="px-5 py-4 border-b border-slate-100 bg-indigo-50/30">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2 h-2 rounded-full ${liveRun?.running ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} />
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-700">Live Events</p>
              {liveRun?.running && <span className="text-[10px] text-indigo-500">running</span>}
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {liveRun!.events.slice(-10).reverse().map((ev: ScraperRunEvent, i: number) => {
                const tone = ev.level === "error"
                  ? "text-red-700 bg-red-50"
                  : ev.level === "warning"
                    ? "text-amber-700 bg-amber-50"
                    : "text-slate-700 bg-white";
                return (
                  <div key={`${ev.at}-${i}`} className={`rounded-lg border border-slate-100 px-3 py-1.5 ${tone}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono text-slate-400">{fmt(ev.at)}</span>
                      {ev.technology_id && <span className="text-[9px] font-mono text-indigo-500">{ev.technology_id}</span>}
                      {ev.source && <span className="text-[9px] font-mono text-violet-500">{ev.source}</span>}
                    </div>
                    <p className="text-[11px] leading-snug">{ev.message}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {logTail.length > 0 && (
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-950">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[13px] text-emerald-400">terminal</span>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Pipeline Terminal</p>
              <span className="ml-auto text-[9px] text-slate-400">{logTail.length} lines</span>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
              {logTail.slice(-80).map((line, idx) => (
                <p key={`${idx}-${line.slice(0, 18)}`} className="font-mono text-[10px] leading-relaxed text-emerald-200 whitespace-pre-wrap break-all">
                  {line}
                </p>
              ))}
            </div>
          </div>
        )}

        {runsError && (
          <div className="mx-5 my-4 flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <span className="material-symbols-outlined text-red-400 text-[15px] mt-0.5">error</span>
            <div>
              <p className="text-xs font-semibold text-red-700">Could not load run history</p>
              <p className="text-[11px] text-red-500 mt-0.5">{runsError}</p>
              <p className="text-[10px] text-red-400 mt-1">
                Make sure the backend is running and the{" "}
                <code className="bg-red-100 px-1 rounded font-mono">scraper_runs</code>{" "}
                table exists in Supabase (run <code className="bg-red-100 px-1 rounded font-mono">db/migrations/001_scraper_tables.sql</code>).
              </p>
            </div>
          </div>
        )}

        {!runsError && !runsLoading && runs.length === 0 && (
          <div className="px-5 py-10 flex flex-col items-center gap-2 text-center">
            <span className="material-symbols-outlined text-4xl text-slate-200">history</span>
            <p className="text-sm text-slate-400 font-semibold">No runs yet</p>
            <p className="text-xs text-slate-300">Trigger a pipeline run above to see activity here.</p>
          </div>
        )}

        {runs.length > 0 && (() => {
          // Max duration across all runs for relative bar width
          const maxSecs = Math.max(
            1,
            ...runs.map(r => runDurSecs(r) ?? 0)
          );
          return (
            <div className="divide-y divide-slate-100">
              {runs.map((run) => {
                const durSecs = runDurSecs(run);
                const d = runDur(run);
                const hasErr = run.errors.length > 0;
                const isActive = !!run.started_at && !run.finished_at;
                const isOk = !hasErr && !!run.finished_at;
                const barPct = durSecs ? Math.round((durSecs / maxSecs) * 100) : 0;

                return (
                  <div key={run.run_id} className="px-5 py-3 group hover:bg-slate-50/60 transition-colors">
                    <div className="flex items-start gap-3">
                      {/* Status icon */}
                      <span className={`material-symbols-outlined text-[17px] mt-0.5 flex-shrink-0 ${
                        isActive ? "text-indigo-500 animate-spin"
                        : isOk   ? "text-emerald-500"
                        : hasErr ? "text-amber-500"
                                 : "text-slate-300"
                      }`}>
                        {isActive ? "progress_activity" : isOk ? "check_circle" : hasErr ? "warning" : "pending"}
                      </span>

                      <div className="flex-1 min-w-0">
                        {/* Date + duration */}
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-700">{fmt(run.started_at)}</span>
                          {d && (
                            <span className="text-[10px] font-semibold text-slate-500
                                             bg-slate-100 px-1.5 py-0.5 rounded tabular-nums">
                              {d}
                            </span>
                          )}
                          {isActive && (
                            <span className="text-[10px] font-semibold text-indigo-400 animate-pulse">
                              running…
                            </span>
                          )}
                        </div>

                        {/* Stats row */}
                        <div className="flex flex-wrap gap-x-3 gap-y-0 mt-1">
                          <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                            <span className="material-symbols-outlined text-[11px] text-slate-400">bolt</span>
                            <span className="font-semibold">{run.technologies_processed}</span> techs
                          </span>
                          <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                            <span className="material-symbols-outlined text-[11px] text-slate-400">article</span>
                            <span className="font-semibold">{run.papers_fetched}</span> papers
                          </span>
                          <span className="text-[10px] font-semibold text-indigo-600 flex items-center gap-0.5">
                            <span className="material-symbols-outlined text-[11px]">add_circle</span>
                            {run.candidates_created} candidates
                          </span>
                          {hasErr && (
                            <span className="text-[10px] font-semibold text-amber-600 flex items-center gap-0.5">
                              <span className="material-symbols-outlined text-[11px]">warning</span>
                              {run.errors.length} error{run.errors.length !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>

                        {/* Duration timeline bar */}
                        {durSecs !== null && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              {/* Segment: papers (60%), extraction (25%), store (15%) */}
                              <div className="h-full flex rounded-full overflow-hidden transition-all duration-500"
                                   style={{ width: `${barPct}%` }}>
                                <div className="bg-indigo-400" style={{ width: "60%" }} />
                                <div className="bg-violet-400" style={{ width: "25%" }} />
                                <div className="bg-emerald-400" style={{ width: "15%" }} />
                              </div>
                            </div>
                            <span className="text-[9px] text-slate-300 tabular-nums w-6 text-right">
                              {barPct}%
                            </span>
                          </div>
                        )}
                        {/* Legend (shows on hover) */}
                        <div className="hidden group-hover:flex items-center gap-3 mt-1">
                          {[
                            { color: "bg-indigo-400", label: "Fetch" },
                            { color: "bg-violet-400", label: "Extract" },
                            { color: "bg-emerald-400", label: "Store" },
                          ].map(({ color, label }) => (
                            <span key={label} className="flex items-center gap-1 text-[9px] text-slate-400">
                              <span className={`w-2 h-2 rounded-sm ${color}`} />
                              {label}
                            </span>
                          ))}
                        </div>

                        {/* Inline errors */}
                        {hasErr && (
                          <div className="mt-1.5 space-y-0.5 max-h-20 overflow-y-auto">
                            {run.errors.map((err, i) => (
                              <p key={i} className="text-[10px] font-mono text-amber-700
                                                    bg-amber-50 rounded px-2 py-0.5 leading-snug">
                                {err}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Run ID */}
                      <span className="text-[9px] font-mono text-slate-300 flex-shrink-0 pt-0.5 hidden sm:block">
                        {run.run_id.slice(0, 8)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Candidates tab ────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ["all", "pending", "approved", "rejected"] as const;
type CandidateFilter = (typeof STATUS_OPTIONS)[number];

function CandidatesTab({ token }: { token: string }) {
  const [candidates,    setCandidates]    = useState<ScraperCandidate[] | null>(null);
  const [loadError,     setLoadError]     = useState<string | null>(null);
  const [filter,        setFilter]        = useState<CandidateFilter>("pending");
  const [techFilter,    setTechFilter]    = useState("all");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading,       setLoading]       = useState(false);
  // Checkbox multi-select
  const [checked,       setChecked]       = useState<Set<string>>(new Set());
  // Collapsed technology groups
  const [collapsed,     setCollapsed]     = useState<Set<string>>(new Set());
  // Bulk action state
  const [bulkActing,    setBulkActing]    = useState(false);
  const [bulkProgress,  setBulkProgress]  = useState<{done:number;total:number}|null>(null);

  const load = useCallback((status: CandidateFilter, techId?: string) => {
    setLoading(true);
    setLoadError(null);
    setChecked(new Set());
    fetchScraperCandidates({
      status: status === "all" ? undefined : status,
      technology_id: (techId && techId !== "all") ? techId : undefined,
      limit: 500,
      token,
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
    (id: string, newStatus: "approved" | "rejected", advanceToNext = true) => {
      setCandidates((prev) => {
        if (!prev) return prev;
        return prev.map((c) => c.candidate_id === id ? { ...c, status: newStatus } : c);
      });
      setChecked((prev) => { const n = new Set(prev); n.delete(id); return n; });
      if (advanceToNext) {
        setSelectedIndex((idx) => {
          if (idx === null) return null;
          const len = (candidates ?? []).length;
          return idx < len - 1 ? idx + 1 : idx - 1 >= 0 ? idx - 1 : null;
        });
      }
    },
    [candidates]
  );

  // Bulk approve all checked candidates
  const handleBulkApprove = async () => {
    const ids = [...checked];
    if (!ids.length) return;
    setBulkActing(true);
    setBulkProgress({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i++) {
      try {
        await approveScraperCandidate(token, ids[i]);
        setCandidates((prev) =>
          prev ? prev.map((c) => c.candidate_id === ids[i] ? { ...c, status: "approved" } : c) : prev
        );
      } catch { /* continue on individual failures */ }
      setBulkProgress({ done: i + 1, total: ids.length });
    }
    setChecked(new Set());
    setBulkActing(false);
    setBulkProgress(null);
  };

  // Bulk reject all checked candidates
  const handleBulkReject = async () => {
    const ids = [...checked];
    if (!ids.length) return;
    setBulkActing(true);
    setBulkProgress({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i++) {
      try {
        await rejectScraperCandidate(token, ids[i]);
        setCandidates((prev) =>
          prev ? prev.map((c) => c.candidate_id === ids[i] ? { ...c, status: "rejected" } : c) : prev
        );
      } catch { /* continue */ }
      setBulkProgress({ done: i + 1, total: ids.length });
    }
    setChecked(new Set());
    setBulkActing(false);
    setBulkProgress(null);
  };

  const all = candidates ?? [];

  // Unique technology options for the dropdown
  const techOptions = Array.from(
    new Map(all.map((c) => [c.technology_id, c.technology_name])).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  // Apply tech dropdown filter on top of already-fetched candidates
  const visible = techFilter === "all" ? all
    : all.filter((c) => c.technology_id === techFilter);

  // Group by technology_name
  const groups = Array.from(
    visible.reduce((map, c) => {
      const key = c.technology_id;
      if (!map.has(key)) map.set(key, { name: c.technology_name, items: [] });
      map.get(key)!.items.push(c);
      return map;
    }, new Map<string, { name: string; items: ScraperCandidate[] }>())
  );

  // Flat ordered list of visible items (for modal navigation)
  const flatVisible = groups.flatMap(([, g]) => g.items);
  const selected = selectedIndex !== null ? flatVisible[selectedIndex] ?? null : null;

  // Toggle helper for individual checkbox
  const toggleCheck = (id: string) =>
    setChecked((prev) => { const n = new Set(prev); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; });

  // Group-level select-all
  const toggleGroupAll = (items: ScraperCandidate[]) => {
    const ids = items.map((c) => c.candidate_id);
    const allChecked = ids.every((id) => checked.has(id));
    setChecked((prev) => {
      const n = new Set(prev);
      ids.forEach((id) => allChecked ? n.delete(id) : n.add(id));
      return n;
    });
  };

  // Select/deselect all visible
  const allVisibleChecked = visible.length > 0 && visible.every((c) => checked.has(c.candidate_id));
  const toggleSelectAll = () => {
    if (allVisibleChecked) {
      setChecked((prev) => {
        const n = new Set(prev);
        visible.forEach((c) => n.delete(c.candidate_id));
        return n;
      });
    } else {
      setChecked((prev) => {
        const n = new Set(prev);
        visible.forEach((c) => n.add(c.candidate_id));
        return n;
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
        {/* Status filter + tech dropdown row */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex gap-1">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => { setFilter(s); setSelectedIndex(null); }}
                className={[
                  "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors capitalize",
                  filter === s ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                ].join(" ")}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Technology dropdown */}
          <select
            value={techFilter}
            onChange={(e) => { setTechFilter(e.target.value); setSelectedIndex(null); setChecked(new Set()); }}
            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5
                       focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white text-slate-600 flex-1 max-w-[220px]"
          >
            <option value="all">All technologies ({all.length})</option>
            {techOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name} ({all.filter(c => c.technology_id === id).length})
              </option>
            ))}
          </select>

          <button
            onClick={() => load(filter, techFilter)}
            disabled={loading}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600
                       border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors ml-auto"
          >
            <span className={`material-symbols-outlined text-[13px] ${loading ? "animate-spin" : ""}`}>refresh</span>
            Refresh
          </button>
        </div>

        {/* Bulk actions row */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Select-all checkbox */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allVisibleChecked}
              onChange={toggleSelectAll}
              disabled={visible.length === 0}
              className="w-4 h-4 rounded accent-indigo-600"
            />
            <span className="text-xs text-slate-500">
              {checked.size > 0 ? `${checked.size} selected` : "Select all"}
            </span>
          </label>

          {checked.size > 0 && (
            <>
              <span className="w-px h-4 bg-slate-200" />
              {bulkActing && bulkProgress ? (
                <span className="text-xs font-semibold text-indigo-600">
                  Processing {bulkProgress.done}/{bulkProgress.total}…
                </span>
              ) : (
                <>
                  <button
                    onClick={handleBulkApprove}
                    disabled={bulkActing}
                    className="flex items-center gap-1.5 text-xs font-bold text-white bg-emerald-600
                               hover:bg-emerald-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[13px]">check_circle</span>
                    Approve {checked.size}
                  </button>
                  <button
                    onClick={handleBulkReject}
                    disabled={bulkActing}
                    className="flex items-center gap-1.5 text-xs font-bold text-white bg-red-500
                               hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[13px]">cancel</span>
                    Reject {checked.size}
                  </button>
                  <button
                    onClick={() => setChecked(new Set())}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Clear
                  </button>
                </>
              )}
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            {visible.length > 0 && (
              <span className="text-[10px] font-semibold text-slate-400">
                {visible.length} candidate{visible.length !== 1 ? "s" : ""}
                {groups.length > 1 ? ` in ${groups.length} groups` : ""}
              </span>
            )}
            {visible.length > 0 && (
              <button
                onClick={() => setSelectedIndex(0)}
                className="flex items-center gap-1.5 text-xs font-bold text-white bg-indigo-600
                           hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-[13px]">rate_review</span>
                Review Queue
              </button>
            )}
          </div>
        </div>
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
          <p className="text-slate-300 text-sm">Run the scraper pipeline to discover new candidates.</p>
        </div>
      )}

      {/* ── Grouped candidate list ─────────────────────────────────────────── */}
      {visible.length > 0 && (
        <div className="space-y-3">
          {groups.map(([techId, group]) => {
            const isCollapsed = collapsed.has(techId);
            const groupIds = group.items.map((c) => c.candidate_id);
            const allGroupChecked = groupIds.length > 0 && groupIds.every((id) => checked.has(id));
            const someGroupChecked = groupIds.some((id) => checked.has(id));
            const pendingCount = group.items.filter((c) => c.status === "pending").length;

            return (
              <div key={techId}
                   className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Group header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-slate-50/80 border-b border-slate-100">
                  {/* Group select-all checkbox */}
                  <input
                    type="checkbox"
                    checked={allGroupChecked}
                    ref={(el) => { if (el) el.indeterminate = !allGroupChecked && someGroupChecked; }}
                    onChange={() => toggleGroupAll(group.items)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded accent-indigo-600 flex-shrink-0"
                  />
                  <button
                    onClick={() => setCollapsed((prev) => {
                      const n = new Set(prev);
                      if (n.has(techId)) { n.delete(techId); } else { n.add(techId); }
                      return n;
                    })}
                    className="flex-1 flex items-center gap-2 text-left"
                  >
                    <span className="material-symbols-outlined text-[14px] text-indigo-400">bolt</span>
                    <span className="text-sm font-bold text-slate-700">{group.name}</span>
                    <span className="text-[10px] font-mono text-slate-400">{techId}</span>
                    <div className="ml-auto flex items-center gap-2">
                      {pendingCount > 0 && (
                        <span className="text-[9px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full">
                          {pendingCount} pending
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400">{group.items.length} items</span>
                      <span className={`material-symbols-outlined text-[16px] text-slate-400 transition-transform ${
                        isCollapsed ? "" : "rotate-180"
                      }`}>expand_more</span>
                    </div>
                  </button>
                </div>

                {/* Group items */}
                {!isCollapsed && (
                  <div className="divide-y divide-slate-50">
                    {group.items.map((c) => {
                      const flatIdx = flatVisible.findIndex((f) => f.candidate_id === c.candidate_id);
                      const isChecked = checked.has(c.candidate_id);
                      return (
                        <div
                          key={c.candidate_id}
                          className={[
                            "flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors group",
                            isChecked ? "bg-indigo-50/40" : "",
                          ].join(" ")}
                        >
                          {/* Per-row checkbox */}
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleCheck(c.candidate_id)}
                            className="mt-1 w-4 h-4 rounded accent-indigo-600 flex-shrink-0"
                          />
                          {/* Card content — click opens modal */}
                          <button
                            type="button"
                            onClick={() => setSelectedIndex(flatIdx)}
                            className="flex-1 min-w-0 text-left"
                          >
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              <StatusPill status={c.status} />
                              {c.paper.year && (
                                <span className="text-[10px] text-slate-400">{c.paper.year}</span>
                              )}
                              <span className="text-[9px] font-mono text-slate-300">{c.paper.source}</span>
                            </div>
                            <p className="text-sm font-semibold text-slate-800 truncate
                                          group-hover:text-indigo-700 transition-colors">
                              {c.paper.title || "Untitled"}
                            </p>
                            {c.paper.authors.length > 0 && (
                              <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                {c.paper.authors.slice(0, 2).join(", ")}
                                {c.paper.authors.length > 2 ? " et al." : ""}
                              </p>
                            )}
                          </button>
                          {/* Param count badge */}
                          <span className="text-[10px] font-semibold text-indigo-500 bg-indigo-50
                                           px-2 py-0.5 rounded flex-shrink-0 mt-0.5">
                            {Object.keys(c.extracted_params).length}p
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <CandidateDetailModal
          candidate={selected}
          token={token}
          onClose={() => setSelectedIndex(null)}
          onAction={(id, newStatus) => handleAction(id, newStatus, true)}
          currentIndex={selectedIndex ?? undefined}
          totalCount={flatVisible.length}
          onPrev={selectedIndex !== null && selectedIndex > 0
            ? () => setSelectedIndex((i) => (i ?? 1) - 1) : undefined}
          onNext={selectedIndex !== null && selectedIndex < flatVisible.length - 1
            ? () => setSelectedIndex((i) => (i ?? 0) + 1) : undefined}
        />
      )}
    </div>
  );
}

// ── Timeseries Pipeline Tab ───────────────────────────────────────────────────

function TimeseriesPipelineTab({ token }: { token: string }) {
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [loadError,    setLoadError]    = useState<string | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [running,      setRunning]      = useState(false);
  const [runMsg,       setRunMsg]       = useState<string | null>(null);
  const [runError,     setRunError]     = useState<string | null>(null);

  const loadCount = useCallback(() => {
    setLoadingCount(true);
    setLoadError(null);
    fetchAdminProfileSubmissions(token, "pending_review")
      .then((subs) => setPendingCount(subs.length))
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load count."))
      .finally(() => setLoadingCount(false));
  }, [token]);

  useEffect(() => { loadCount(); }, [loadCount]);

  const handleRun = async () => {
    setRunning(true);
    setRunMsg(null);
    setRunError(null);
    try {
      const res = await runTimeseriesPipeline(token);
      setRunMsg(res.message ?? "Pipeline started.");
      setTimeout(loadCount, 3000);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Failed to start pipeline.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">

      {/* Header card */}
      <div className="bg-gradient-to-r from-teal-600 to-cyan-600 rounded-2xl p-5 text-white shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <span className="material-symbols-outlined text-[28px]">ssid_chart</span>
          <div>
            <p className="font-bold text-base leading-none">Timeseries Acquisition Pipeline</p>
            <p className="text-teal-200 text-xs mt-1">PVGIS + Open-Meteo ERA5 | Hourly capacity factor, wind speed, solar irradiance</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 bg-white text-teal-700 font-bold text-sm
                       rounded-xl hover:bg-teal-50 transition-colors disabled:opacity-60"
          >
            <span className={`material-symbols-outlined text-[16px] ${running ? "animate-spin" : ""}`}>
              {running ? "progress_activity" : "play_arrow"}
            </span>
            {running ? "Starting…" : "Run Now"}
          </button>
          <p className="text-teal-100 text-xs">
            Fetches new profiles for all configured locations and writes them to pending review.
          </p>
        </div>
      </div>

      {/* Status messages */}
      {runMsg && (
        <div className="flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-xl px-4 py-3">
          <span className="material-symbols-outlined text-teal-600 text-[18px]">check_circle</span>
          <p className="text-sm text-teal-800">{runMsg}</p>
        </div>
      )}
      {runError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <span className="material-symbols-outlined text-red-500 text-[18px]">error</span>
          <p className="text-sm text-red-700">{runError}</p>
        </div>
      )}
      {loadError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <span className="material-symbols-outlined text-red-500 text-[18px]">error</span>
          <p className="text-sm text-red-700">{loadError}</p>
        </div>
      )}

      {/* Pending submissions count */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <span className="material-symbols-outlined text-amber-600 text-[20px]">pending</span>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Pending Review</p>
            <p className="text-2xl font-bold text-slate-800 leading-none mt-1">
              {loadingCount ? "…" : (pendingCount ?? "—")}
            </p>
          </div>
          <button
            type="button"
            onClick={loadCount}
            disabled={loadingCount}
            className="ml-auto text-slate-300 hover:text-indigo-500 transition-colors"
            title="Refresh count"
          >
            <span className={`material-symbols-outlined text-[16px] ${loadingCount ? "animate-spin" : ""}`}>refresh</span>
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center">
            <span className="material-symbols-outlined text-teal-600 text-[20px]">cloud_download</span>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Sources</p>
            <p className="text-sm font-bold text-slate-700 mt-1">PVGIS · Open-Meteo</p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-100 flex items-center justify-center">
            <span className="material-symbols-outlined text-cyan-600 text-[20px]">public</span>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Coverage</p>
            <p className="text-sm font-bold text-slate-700 mt-1">EU-30 + Global 20</p>
          </div>
        </div>
      </div>

      {/* Info about the pipeline */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
        <p className="text-sm font-semibold text-slate-700">Pipeline details</p>
        <ul className="text-sm text-slate-500 space-y-1.5">
          <li className="flex gap-2">
            <span className="material-symbols-outlined text-[14px] text-teal-500 mt-0.5">solar_power</span>
            <span><strong>PVGIS v5.2</strong> — Solar PV capacity factors for EU-30 (years 2005–2020, SARAH-2 dataset)</span>
          </li>
          <li className="flex gap-2">
            <span className="material-symbols-outlined text-[14px] text-teal-500 mt-0.5">air</span>
            <span><strong>Open-Meteo ERA5</strong> — Wind speed (100m), wind CF (IEC Class II curve), solar irradiance (GHI) for 50 countries</span>
          </li>
          <li className="flex gap-2">
            <span className="material-symbols-outlined text-[14px] text-teal-500 mt-0.5">check_circle</span>
            <span>All fetched profiles go to <strong>pending review</strong> — approve them in the Profile Submissions tab</span>
          </li>
          <li className="flex gap-2">
            <span className="material-symbols-outlined text-[14px] text-amber-500 mt-0.5">schedule</span>
            <span>Runtime: approximately <strong>20–40 minutes</strong> for a full run (810 fetches with rate limiting). Pipeline runs in the background.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

// ── ScraperPanel (exported) ───────────────────────────────────────────────────

type ScraperTab = "dashboard" | "candidates" | "timeseries";

export default function ScraperPanel({ token }: { token: string }) {
  const [tab,          setTab]          = useState<ScraperTab>("dashboard");
  const [status,       setStatus]       = useState<ScraperStatus | null>(null);
  const [statusErr,    setStatusErr]    = useState<string | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [running,      setRunning]      = useState(false);
  const [runMsg,       setRunMsg]       = useState<string | null>(null);
  const [runStartTime, setRunStartTime] = useState<Date | null>(null);
  const [runs,         setRuns]         = useState<ScraperRun[]>([]);
  const [runsLoading,  setRunsLoading]  = useState(false);
  const [runsError,    setRunsError]    = useState<string | null>(null);
  const [stopping,     setStopping]     = useState(false);
  const [awaitingStart, setAwaitingStart] = useState(false);
  const isLiveRunning = Boolean(status?.current_run?.running);

  const loadStatus = useCallback(() => {
    setLoading(true);
    setStatusErr(null);
    fetchScraperStatus()
      .then((data) => setStatus(data))
      .catch((e) => setStatusErr(e instanceof Error ? e.message : "Failed to load scraper status."))
      .finally(() => setLoading(false));
  }, []);

  const loadRuns = useCallback(() => {
    setRunsLoading(true);
    setRunsError(null);
    fetchScraperRuns(30, token)
      .then((data) => setRuns(data.runs))
      .catch((e) => setRunsError(e instanceof Error ? e.message : "Failed to load run history."))
      .finally(() => setRunsLoading(false));
  }, []);

  // Initial load
  useEffect(() => { loadStatus(); loadRuns(); }, [loadStatus, loadRuns]);

  // Poll status regularly so logs/timer appear even during run-start race windows.
  useEffect(() => {
    const id = setInterval(() => { loadStatus(); loadRuns(); }, 5000);
    return () => clearInterval(id);
  }, [loadStatus, loadRuns]);

  useEffect(() => {
    if (isLiveRunning) {
      setAwaitingStart(false);
      setRunning(false);
      return;
    }
    if (awaitingStart && !isLiveRunning) {
      const timeoutId = setTimeout(() => setAwaitingStart(false), 30000);
      return () => clearTimeout(timeoutId);
    }
  }, [awaitingStart, isLiveRunning]);

  const handleRun = async () => {
    setRunning(true);
    setAwaitingStart(true);
    setRunMsg(null);
    setRunStartTime(new Date());
    try {
      const res = await triggerScraperRun(token);
      setRunMsg(res.message);
      loadStatus();
      loadRuns();
      // Refresh status + runs after a short delay so counts update
      setTimeout(() => { loadStatus(); loadRuns(); }, 3000);
    } catch (e) {
      setRunMsg(e instanceof Error ? e.message : "Run failed.");
      setAwaitingStart(false);
      setRunning(false);
    } finally {
      setRunStartTime(null);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    try {
      const res = await stopScraperRun(token);
      setRunMsg(res.message);
      loadStatus();
      loadRuns();
      setTimeout(() => { loadStatus(); loadRuns(); }, 2000);
    } catch (e) {
      setRunMsg(e instanceof Error ? e.message : "Stop failed.");
    } finally {
      setStopping(false);
      setAwaitingStart(false);
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
          { id: "dashboard"  as ScraperTab, label: "Dashboard",           icon: "dashboard"   },
          { id: "candidates" as ScraperTab, label: "Candidates",          icon: "rate_review" },
          { id: "timeseries" as ScraperTab, label: "Timeseries Pipeline", icon: "ssid_chart"  },
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
          onRefresh={() => { loadStatus(); loadRuns(); }}
          onRun={handleRun}
          onStop={handleStop}
          stopping={stopping}
          running={running || awaitingStart || isLiveRunning}
          runStartTime={runStartTime}
          runs={runs}
          runsLoading={runsLoading}
          runsError={runsError}
        />
      )}

      {tab === "candidates" && (
        <CandidatesTab token={token} />
      )}

      {tab === "timeseries" && (
        <TimeseriesPipelineTab token={token} />
      )}
    </div>
  );
}

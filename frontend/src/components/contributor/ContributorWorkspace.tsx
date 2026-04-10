/**
 * components/contributor/ContributorWorkspace.tsx
 * ─────────────────────────────────────────────────
 * Page-level wrapper for the authenticated Contributor Workspace.
 *
 * Architecture
 * ────────────
 * The OntologySchema is fetched once and memoised as a stable Promise.
 * It is passed to <AddTechnology> which calls use() on it, suspending
 * until the schema resolves. The <Suspense> boundary here shows a
 * skeleton in the meantime — identical pattern to TechGrid in App.tsx.
 *
 * Why memoised at this level?
 * React 19's use() requires the same Promise reference across re-renders.
 * By creating the Promise in a useMemo with an empty dep array, we guarantee
 * it is stable for the entire lifetime of this page component.
 */

import { Suspense, useMemo, useState, useCallback, useEffect } from "react";
import { fetchOntologySchema, fetchMySubmissions } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import VisualTechBuilder from "./visual-builder/VisualTechBuilder";
import ErrorBoundary from "../ErrorBoundary";
import type { SubmissionRecord } from "../../types/api";
import UploadProfile from "../timeseries/UploadProfile";


function FormSkeleton() {
  return (
    <div className="animate-pulse space-y-8" aria-label="Loading form…" aria-busy>
      {/* Section 1 skeleton */}
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-7 space-y-5">
        <div className="flex items-center gap-4 pb-4 border-b border-outline-variant/15">
          <div className="w-8 h-8 rounded-full bg-surface-container-high" />
          <div className="space-y-2 flex-1">
            <div className="h-4 bg-surface-container-high rounded w-48" />
            <div className="h-3 bg-surface-container rounded w-72" />
          </div>
        </div>
        {/* Input skeletons */}
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 bg-surface-container-high rounded w-32" />
            <div className="h-10 bg-surface-container rounded w-full" />
          </div>
        ))}
      </div>

      {/* Section 2 skeleton */}
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-7 space-y-4">
        <div className="flex items-center gap-4 pb-4 border-b border-outline-variant/15">
          <div className="w-8 h-8 rounded-full bg-surface-container-high" />
          <div className="space-y-2 flex-1">
            <div className="h-4 bg-surface-container-high rounded w-56" />
            <div className="h-3 bg-surface-container rounded w-64" />
          </div>
        </div>
        <div className="rounded-xl border border-outline-variant/25 p-5 space-y-4">
          <div className="h-10 bg-surface-container rounded w-1/2" />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 bg-surface-container rounded" />
            ))}
          </div>
        </div>
      </div>

      {/* Submit row skeleton */}
      <div className="flex justify-end pt-2">
        <div className="h-12 w-48 bg-primary/20 rounded-xl" />
      </div>
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<SubmissionRecord["status"], { label: string; color: string; icon: string }> = {
  pending_review: { label: "Pending Review", color: "text-amber-700 bg-amber-100",  icon: "schedule"      },
  approved:       { label: "Approved",        color: "text-green-700 bg-green-100",  icon: "check_circle"  },
  rejected:       { label: "Rejected",        color: "text-red-700 bg-red-100",      icon: "cancel"        },
};

function StatusBadge({ status }: { status: SubmissionRecord["status"] }) {
  const { label, color, icon } = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${color}`}>
      <span className="material-symbols-outlined text-[13px]">{icon}</span>
      {label}
    </span>
  );
}

// ── My Submissions tab — fetches live from the database ───────────────────────

function MySubmissionsPanel({ token }: { token: string }) {
  const [submissions, setSubmissions] = useState<SubmissionRecord[] | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMySubmissions(token);
      setSubmissions(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load submissions.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3">
        <span className="material-symbols-outlined text-[28px] text-primary/50 animate-spin">autorenew</span>
        <p className="text-on-surface-variant text-sm">Loading your submissions…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <span className="material-symbols-outlined text-4xl text-tertiary/60">error</span>
        <p className="text-on-surface-variant text-sm">{error}</p>
        <button
          onClick={() => void load()}
          className="text-xs font-bold text-primary border border-primary/30 px-3 py-1.5 rounded-lg hover:bg-primary/5"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!submissions || submissions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/25">inbox</span>
        <p className="text-on-surface-variant text-base font-medium">No submissions yet</p>
        <p className="text-on-surface-variant/60 text-sm max-w-xs">
          Switch to the <strong>New Submission</strong> tab to add your first technology.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-5">
        <p className="text-xs text-on-surface-variant/60">
          {submissions.length} submission{submissions.length !== 1 ? "s" : ""} — reviewed by an administrator before appearing in the catalogue.
        </p>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-primary transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">refresh</span>
          Refresh
        </button>
      </div>
      {submissions.map((sub) => (
        <div
          key={sub.submission_id}
          className="flex items-start justify-between gap-4 rounded-xl border border-outline-variant/20
                     bg-surface-container-lowest px-5 py-4"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-on-surface truncate">{sub.technology_name}</p>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              {sub.domain && (
                <span className="text-[10px] font-semibold bg-surface-container text-on-surface-variant/60 px-1.5 py-0.5 rounded capitalize">
                  {sub.domain}
                </span>
              )}
              <p className="text-xs text-on-surface-variant/50">
                {new Date(sub.submitted_at).toLocaleDateString(undefined, {
                  year: "numeric", month: "short", day: "numeric",
                })}
              </p>
            </div>
            {sub.status === "rejected" && sub.rejection_reason && (
              <p className="text-xs text-red-600 mt-1.5 italic">
                Reason: {sub.rejection_reason}
              </p>
            )}
          </div>
          <StatusBadge status={sub.status} />
        </div>
      ))}
    </div>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

type Tab = "new" | "my" | "timeseries";

export default function ContributorWorkspace() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("new");
  const [submissionCount, setSubmissionCount] = useState(0);

  // Stable Promise reference — created once, never re-created on re-renders.
  // use() in AddTechnology will read this same reference each time.
  const schemaPromise = useMemo(() => fetchOntologySchema(), []);

  const handleSuccess = useCallback(
    (_technologyName: string) => {
      setSubmissionCount((n) => n + 1);
    },
    []
  );

  const TABS: { id: Tab; label: string; icon: string; count?: number }[] = [
    { id: "new",        label: "New Technology",     icon: "add_circle" },
    { id: "timeseries", label: "Upload Profile",     icon: "show_chart" },
    { id: "my",         label: "My Submissions",     icon: "list_alt",  count: submissionCount > 0 ? submissionCount : undefined },
  ];

  return (
    <>
      <title>OpenTech DB | Contributor Workspace</title>
      <meta
        name="description"
        content="Add new energy technologies to the OEO-aligned opentech-db database."
      />

      {/* ── Unified full-screen shell — same structure for every tab ── */}
      <div className="flex flex-col" style={{ height: "calc(100vh - 57px)" }}>

        {/* Shared tab strip */}
        <div
          role="tablist"
          className="flex-shrink-0 flex items-center gap-1 px-6
                     border-b border-outline-variant/15 bg-surface-container-low/50"
        >
          {TABS.map(({ id, label, icon, count }) => (
            <button
              key={id}
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={[
                "flex items-center gap-2 px-4 py-2.5 text-sm font-bold transition-all",
                "border-b-2 -mb-px rounded-t",
                activeTab === id
                  ? "border-primary text-primary"
                  : "border-transparent text-on-surface-variant hover:text-on-surface hover:border-outline-variant/40",
              ].join(" ")}
            >
              <span className="material-symbols-outlined text-[17px]">{icon}</span>
              {label}
              {count !== undefined && count > 0 && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    activeTab === id
                      ? "bg-primary/15 text-primary"
                      : "bg-surface-container text-on-surface-variant"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content — fills all remaining height */}
        <div className="flex-1 min-h-0">

          {/* ── New Technology ─────────────────────────────────────────── */}
          {activeTab === "new" && (
            <ErrorBoundary context="contributor-workspace">
              <Suspense fallback={<FormSkeleton />}>
                <VisualTechBuilder
                  schemaPromise={schemaPromise}
                  onSubmitSuccess={(name) => {
                    handleSuccess(name);
                    setActiveTab("my");
                  }}
                />
              </Suspense>
            </ErrorBoundary>
          )}

          {/* ── Upload Profile ─────────────────────────────────────────── */}
          {activeTab === "timeseries" && (
            <UploadProfile
              onUploadSuccess={(_id, _name) => {
                /* success state shown inline — stay on tab */
              }}
            />
          )}

          {/* ── My Submissions ─────────────────────────────────────────── */}
          {activeTab === "my" && (
            token ? (
              <div className="h-full overflow-y-auto">
                <div className="max-w-3xl mx-auto px-8 py-8">
                  <MySubmissionsPanel token={token} />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 h-full justify-center text-center">
                <span className="material-symbols-outlined text-5xl text-on-surface-variant/25">lock</span>
                <p className="text-on-surface-variant text-sm">Sign in to view your submissions.</p>
              </div>
            )
          )}

        </div>
      </div>
    </>
  );
}

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

import { Suspense, useMemo, useState, useCallback } from "react";
import { fetchOntologySchema } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import AddTechnology from "./AddTechnology";
import ErrorBoundary from "../ErrorBoundary";

// ── Submission record (stored in localStorage) ────────────────────────────────

interface SubmissionRecord {
  id: string;
  technologyName: string;
  submittedAt: string; // ISO date string
  status: "pending_review" | "approved" | "rejected";
}

const STORAGE_KEY_PREFIX = "opentech_submissions_";

function loadSubmissions(userId: string): SubmissionRecord[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`);
    return raw ? (JSON.parse(raw) as SubmissionRecord[]) : [];
  } catch {
    return [];
  }
}

function saveSubmissions(userId: string, submissions: SubmissionRecord[]): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, JSON.stringify(submissions));
  } catch {
    // ignore storage quota errors
  }
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

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

// ── Info banner ───────────────────────────────────────────────────────────────

function ContributorInfoBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      className="flex items-start gap-4 rounded-xl bg-secondary-container/40
                 border border-outline-variant/20 px-5 py-4 mb-8"
      role="note"
    >
      <span className="material-symbols-outlined text-xl text-secondary flex-shrink-0 mt-0.5">
        info
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-on-surface">
          Ontology-Aligned Data Entry
        </p>
        <p className="text-sm text-on-surface-variant mt-1 leading-relaxed">
          To maintain the integrity of the OEO-aligned database, key taxonomic
          fields (<em>Domain</em>, <em>Carrier</em>, <em>OEO Class</em>,{" "}
          <em>Reference Source</em>) are locked to approved controlled-vocabulary
          lists. These lists are fetched live from the ontology schema endpoint
          and validated on both the client and server.
        </p>
        <p className="text-xs text-on-surface-variant/70 mt-2">
          Free-text input for these fields is intentionally disabled. Contact a
          data steward to request additions to the controlled vocabulary.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss info banner"
        className="flex-shrink-0 text-on-surface-variant/50 hover:text-on-surface-variant
                   transition-colors mt-0.5"
      >
        <span className="material-symbols-outlined text-[18px]">close</span>
      </button>
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

// ── My Submissions tab ────────────────────────────────────────────────────────

function MySubmissionsPanel({ submissions }: { submissions: SubmissionRecord[] }) {
  if (submissions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/25">inbox</span>
        <p className="text-on-surface-variant text-base font-medium">No submissions yet</p>
        <p className="text-on-surface-variant/60 text-sm max-w-xs">
          Switch to the <strong>New Submission</strong> tab to add your first technology.
          Submitted records appear here for tracking.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-on-surface-variant/60 mb-5">
        {submissions.length} submission{submissions.length !== 1 ? "s" : ""} recorded locally.
        An administrator reviews each entry before it appears in the public catalogue.
      </p>
      {submissions.map((sub) => (
        <div
          key={sub.id}
          className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/20
                     bg-surface-container-lowest px-5 py-4"
        >
          <div className="min-w-0">
            <p className="text-sm font-bold text-on-surface truncate">{sub.technologyName}</p>
            <p className="text-xs text-on-surface-variant/60 mt-0.5">
              Submitted {new Date(sub.submittedAt).toLocaleDateString(undefined, {
                year: "numeric", month: "short", day: "numeric",
              })}
            </p>
          </div>
          <StatusBadge status={sub.status} />
        </div>
      ))}
    </div>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

type Tab = "new" | "my";

export default function ContributorWorkspace() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("new");
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>(() =>
    user ? loadSubmissions(user.id) : []
  );

  // Stable Promise reference — created once, never re-created on re-renders.
  // use() in AddTechnology will read this same reference each time.
  const schemaPromise = useMemo(() => fetchOntologySchema(), []);

  const handleSuccess = useCallback(
    (technologyName: string) => {
      if (!user) return;
      const record: SubmissionRecord = {
        id: crypto.randomUUID(),
        technologyName,
        submittedAt: new Date().toISOString(),
        status: "pending_review",
      };
      setSubmissions((prev) => {
        const next = [record, ...prev];
        saveSubmissions(user.id, next);
        return next;
      });
    },
    [user]
  );

  const TABS: { id: Tab; label: string; icon: string; count?: number }[] = [
    { id: "new", label: "New Submission", icon: "add_circle" },
    { id: "my",  label: "My Submissions", icon: "list_alt",  count: submissions.length },
  ];

  return (
    <>
      {/* React 19: title/meta hoisted to <head> automatically */}
      <title>OpenTech DB | Contributor Workspace</title>
      <meta
        name="description"
        content="Add new energy technologies to the OEO-aligned opentech-db database."
      />

      <div className="max-w-[1440px] mx-auto px-8 py-12 w-full">
        {/* ── Page header ──────────────────────────────────────────────── */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-xl text-primary">
                add_circle
              </span>
            </div>
            <div>
              <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface">
                Contributor Workspace
              </h1>
            </div>
          </div>
          <p className="text-on-surface-variant text-lg leading-relaxed max-w-2xl ml-[52px]">
            Submit new energy technologies for review. All fields are validated
            against the live OEO schema to guarantee ontology alignment.
          </p>
        </header>

        {/* ── Tabs ─────────────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-8 border-b border-outline-variant/15">
          {TABS.map(({ id, label, icon, count }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              aria-selected={activeTab === id}
              role="tab"
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

        {/* ── Tab content ──────────────────────────────────────────────── */}
        {activeTab === "new" ? (
          <>
            {/* ── Info callout ─────────────────────────────────────────── */}
            <ContributorInfoBanner />

            {/* ── Form — ErrorBoundary catches API / promise rejection ── */}
            <ErrorBoundary context="contributor-workspace">
              <Suspense fallback={<FormSkeleton />}>
                <AddTechnology
                  schemaPromise={schemaPromise}
                  onSuccess={(name) => {
                    handleSuccess(name);
                    setActiveTab("my");
                  }}
                />
              </Suspense>
            </ErrorBoundary>
          </>
        ) : (
          <MySubmissionsPanel submissions={submissions} />
        )}
      </div>
    </>
  );
}

/**
 * components/admin/AdminPanel.tsx
 * ────────────────────────────────
 * Admin review dashboard for pending technology submissions.
 *
 * Layout
 * ──────
 * • If not logged in as admin: shows the admin login form.
 * • If logged in as admin:
 *   - Stat bar (total / pending / approved / rejected counts)
 *   - Tab filter (All | Pending | Approved | Rejected)
 *   - Submission cards with Approve / Reject actions + reject reason
 *
 * Auth
 * ────
 * Admin token is stored in sessionStorage under "opentech_admin_token".
 * On approve/reject the token is sent as Authorization: Bearer <token>.
 */

import { useState, useCallback, useTransition } from "react";
import { z } from "zod";
import {
  adminLogin,
  fetchAdminSubmissions,
  actOnSubmission,
} from "../../services/api";
import type { SubmissionRecord } from "../../types/api";

const ADMIN_TOKEN_KEY = "opentech_admin_token";

// ── Zod schema ────────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  email:    z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SubmissionRecord["status"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending_review: { label: "Pending Review", cls: "bg-amber-100 text-amber-800 border-amber-200" },
    approved:       { label: "Approved",        cls: "bg-green-100 text-green-800 border-green-200" },
    rejected:       { label: "Rejected",        cls: "bg-red-100 text-red-700 border-red-200"   },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-600 border-slate-200" };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

// ── Submission card ───────────────────────────────────────────────────────────

function SubmissionCard({
  record,
  token,
  onAction,
}: {
  record: SubmissionRecord;
  token: string;
  onAction: (id: string, action: "approve" | "reject", reason?: string) => void;
}) {
  const [expanded,     setExpanded]     = useState(false);
  const [rejectMode,   setRejectMode]   = useState(false);
  const [reason,       setReason]       = useState("");
  const [acting,       setActing]       = useState(false);
  const [actionError,  setActionError]  = useState<string | null>(null);

  const handleAction = useCallback(async (action: "approve" | "reject") => {
    setActing(true);
    setActionError(null);
    try {
      await actOnSubmission(token, record.submission_id, action, reason || undefined);
      onAction(record.submission_id, action, reason || undefined);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  }, [token, record.submission_id, reason, onAction]);

  const isPending = record.status === "pending_review";
  const date = new Date(record.submitted_at).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-slate-800 truncate">
              {record.technology_name}
            </h3>
            <StatusBadge status={record.status} />
            {record.domain && (
              <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded capitalize">
                {record.domain}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Submitted {date}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isPending && !rejectMode && (
            <>
              <button
                type="button"
                disabled={acting}
                onClick={() => handleAction("approve")}
                className="flex items-center gap-1 text-xs font-bold text-white bg-emerald-600
                           hover:bg-emerald-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[14px]">check_circle</span>
                Approve
              </button>
              <button
                type="button"
                disabled={acting}
                onClick={() => setRejectMode(true)}
                className="flex items-center gap-1 text-xs font-bold text-white bg-red-500
                           hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[14px]">cancel</span>
                Reject
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100"
            aria-label={expanded ? "Collapse" : "Expand details"}
          >
            <span className="material-symbols-outlined text-[16px]">
              {expanded ? "expand_less" : "expand_more"}
            </span>
          </button>
        </div>
      </div>

      {/* Reject reason input */}
      {rejectMode && isPending && (
        <div className="px-5 pb-4 border-t border-slate-100 pt-3 space-y-2">
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            Rejection Reason (optional)
          </label>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
            placeholder="e.g. Missing reference source, duplicate entry…"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={acting}
              onClick={() => handleAction("reject")}
              className="text-xs font-bold text-white bg-red-500 hover:bg-red-600
                         px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {acting ? "Rejecting…" : "Confirm Reject"}
            </button>
            <button
              type="button"
              onClick={() => { setRejectMode(false); setReason(""); }}
              className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {actionError && (
        <div className="mx-5 mb-3 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span className="material-symbols-outlined text-[14px] text-red-500">error</span>
          <p className="text-xs text-red-700">{actionError}</p>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="px-5 pb-4 border-t border-slate-100 pt-3 space-y-2">
          {record.oeo_class && (
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                OEO Class
              </span>
              <p className="text-xs font-mono text-slate-600 break-all mt-0.5">
                {record.oeo_class}
              </p>
            </div>
          )}
          {record.description && (
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Description
              </span>
              <p className="text-xs text-slate-600 leading-relaxed mt-0.5">
                {record.description}
              </p>
            </div>
          )}
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Submission ID
            </span>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              {record.submission_id}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Login form ────────────────────────────────────────────────────────────────

function AdminLoginForm({ onLogin }: { onLogin: (token: string) => void }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [pending,  startLogin]  = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = LoginSchema.safeParse({ email, password });
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    startLogin(async () => {
      try {
        const resp = await adminLogin(email, password);
        sessionStorage.setItem(ADMIN_TOKEN_KEY, resp.token);
        onLogin(resp.token);
      } catch {
        setError("Invalid admin credentials. Please try again.");
      }
    });
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-8 w-full max-w-md">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
            <span className="material-symbols-outlined text-white text-[20px]">
              admin_panel_settings
            </span>
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">Admin Login</h2>
            <p className="text-xs text-slate-400">OpenTech DB administration panel</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Email
            </label>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5
                         focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="admin@example.com"
              required
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5
                         focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="••••••••"
              required
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <span className="material-symbols-outlined text-[14px] text-red-500">error</span>
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600
                       text-white rounded-xl text-sm font-bold hover:bg-indigo-700
                       active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {pending ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">autorenew</span>
                Signing in…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">login</span>
                Sign In
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon, color,
}: {
  label: string;
  value: number;
  icon: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
        <span className="material-symbols-outlined text-[20px] text-white">{icon}</span>
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-800 tabular-nums">{value}</p>
        <p className="text-xs text-slate-400">{label}</p>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type StatusTab = "all" | "pending_review" | "approved" | "rejected";

export default function AdminPanel() {
  const [token,       setToken]       = useState<string | null>(
    () => sessionStorage.getItem(ADMIN_TOKEN_KEY)
  );
  const [submissions, setSubmissions] = useState<SubmissionRecord[] | null>(null);
  const [loadError,   setLoadError]   = useState<string | null>(null);
  const [activeTab,   setActiveTab]   = useState<StatusTab>("all");
  const [loading,     startLoad]      = useTransition();

  const load = useCallback((tok: string) => {
    startLoad(async () => {
      setLoadError(null);
      try {
        const data = await fetchAdminSubmissions(tok);
        setSubmissions(data);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load submissions.");
        // Token might be expired
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        setToken(null);
      }
    });
  }, []);

  const handleLogin = useCallback((tok: string) => {
    setToken(tok);
    load(tok);
  }, [load]);

  // Auto-load when we already have a stored token
  const [autoLoaded, setAutoLoaded] = useState(false);
  if (token && !autoLoaded && submissions === null && !loading) {
    setAutoLoaded(true);
    load(token);
  }

  const handleAction = useCallback(
    (id: string, action: "approve" | "reject") => {
      setSubmissions((prev) =>
        prev
          ? prev.map((s) =>
              s.submission_id === id
                ? { ...s, status: (action === "approve" ? "approved" : "rejected") as SubmissionRecord["status"] }
                : s
            )
          : prev
      );
    },
    []
  );

  const handleSignOut = useCallback(() => {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setToken(null);
    setSubmissions(null);
    setAutoLoaded(false);
  }, []);

  // ── Not logged in ─────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className="max-w-[1200px] mx-auto px-8 py-12 w-full">
        <AdminLoginForm onLogin={handleLogin} />
      </div>
    );
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const all      = submissions ?? [];
  const pending  = all.filter((s) => s.status === "pending_review");
  const approved = all.filter((s) => s.status === "approved");
  const rejected = all.filter((s) => s.status === "rejected");

  const tabItems: { id: StatusTab; label: string; count: number }[] = [
    { id: "all",            label: "All",      count: all.length      },
    { id: "pending_review", label: "Pending",  count: pending.length  },
    { id: "approved",       label: "Approved", count: approved.length },
    { id: "rejected",       label: "Rejected", count: rejected.length },
  ];

  const visibleSubmissions =
    activeTab === "all"
      ? all
      : all.filter((s) => s.status === activeTab);

  return (
    <div className="max-w-[1200px] mx-auto px-8 py-12 w-full space-y-8">
      {/* Page title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
            <span className="material-symbols-outlined text-[28px] text-indigo-600">
              admin_panel_settings
            </span>
            Admin Review Panel
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage technology submissions — approve or reject before they enter the catalogue.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => token && load(token)}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600
                       border border-slate-200 px-3 py-2 rounded-xl hover:bg-indigo-50 transition-colors"
          >
            <span className={`material-symbols-outlined text-[16px] ${loading ? "animate-spin" : ""}`}>
              refresh
            </span>
            Refresh
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-red-600
                       border border-slate-200 px-3 py-2 rounded-xl hover:bg-red-50 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
            Sign out
          </button>
        </div>
      </div>

      {/* Error loading */}
      {loadError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <span className="material-symbols-outlined text-red-500">error</span>
          <p className="text-sm text-red-700">{loadError}</p>
        </div>
      )}

      {/* Stats */}
      {submissions !== null && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Submissions" value={all.length}      icon="database"      color="bg-indigo-500" />
          <StatCard label="Pending Review"    value={pending.length}  icon="pending"       color="bg-amber-500"  />
          <StatCard label="Approved"          value={approved.length} icon="check_circle"  color="bg-emerald-500"/>
          <StatCard label="Rejected"          value={rejected.length} icon="cancel"        color="bg-red-500"    />
        </div>
      )}

      {/* Tab bar */}
      {submissions !== null && (
        <div className="flex gap-1 border-b border-slate-200 pb-0">
          {tabItems.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-t-xl transition-colors border-b-2
                ${activeTab === tab.id
                  ? "text-indigo-600 border-indigo-500 bg-indigo-50/60"
                  : "text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50"}
              `}
            >
              {tab.label}
              <span
                className={`
                  text-[10px] font-bold px-1.5 py-0.5 rounded-full
                  ${activeTab === tab.id ? "bg-indigo-500 text-white" : "bg-slate-200 text-slate-600"}
                `}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Submission list */}
      {loading && (
        <div className="flex items-center gap-3 py-12 justify-center">
          <span className="material-symbols-outlined text-[30px] text-indigo-400 animate-spin">autorenew</span>
          <p className="text-slate-500 text-sm">Loading submissions…</p>
        </div>
      )}

      {!loading && submissions !== null && visibleSubmissions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <span className="material-symbols-outlined text-5xl text-slate-200">inbox</span>
          <p className="text-slate-400 font-semibold">
            {activeTab === "pending_review"
              ? "No pending submissions"
              : `No ${activeTab} submissions`}
          </p>
          <p className="text-slate-300 text-sm">
            {activeTab === "pending_review" && "All caught up — great work!"}
          </p>
        </div>
      )}

      {!loading && submissions !== null && visibleSubmissions.length > 0 && (
        <div className="space-y-3">
          {visibleSubmissions.map((record) => (
            <SubmissionCard
              key={record.submission_id}
              record={record}
              token={token}
              onAction={handleAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

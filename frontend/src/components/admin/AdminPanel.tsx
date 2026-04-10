/**
 * components/admin/AdminPanel.tsx
 * ────────────────────────────────
 * Admin review dashboard for pending technology submissions.
 *
 * Auth is handled by AuthContext — the user must be logged in with
 * is_admin: true (set when signing in with admin credentials via the
 * standard Sign In form).  No separate login form in this component.
 */

import { useState, useCallback, useTransition, useEffect, useRef } from "react";
import * as echarts from "echarts";
import {
  fetchAdminSubmissions,
  actOnSubmission,
  fetchAdminCatalogueTechnologies,
  adminEditTechnology,
  adminDeleteTechnology,
  fetchAdminProfileSubmissions,
  actOnProfileSubmission,
  fetchAdminProfileSubmissionData,
} from "../../services/api";
import type { CatalogueTechEntry, ProfileSubmissionRecord, ProfileSubmissionData } from "../../services/api";
import { deleteTimeSeriesProfile, invalidateTimeSeriesCatalogue } from "../../services/timeseries";
import type { TimeSeriesProfile } from "../../types/timeseries";
import { useAuth } from "../../context/AuthContext";
import type { SubmissionRecord, CreateTechnologyInstancePayload } from "../../types/api";

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

// ── Detail section wrapper (module-level to avoid focus loss) ───────────────

function DetailSection({
  icon, title, isPending, children,
}: {
  icon: string;
  title: string;
  isPending: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-2 px-5 py-2 bg-slate-50/70">
        <span className="material-symbols-outlined text-[13px] text-indigo-500">{icon}</span>
        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{title}</p>
        {isPending && (
          <span className="ml-auto text-[9px] text-indigo-400 italic">editable</span>
        )}
      </div>
      <div className="px-5 py-3">{children}</div>
    </div>
  );
}

// ── Editable number field ─────────────────────────────────────────────────────

function EditNum({
  label, unit, value, onChange,
}: { label: string; unit: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step="any"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5
                     focus:outline-none focus:ring-2 focus:ring-indigo-300 tabular-nums"
        />
        <span className="text-[9px] text-slate-400 whitespace-nowrap">{unit}</span>
      </div>
    </div>
  );
}

function EditText({
  label, value, onChange, mono = false, multiline = false,
}: { label: string; value: string; onChange: (v: string) => void; mono?: boolean; multiline?: boolean }) {
  const cls = `w-full text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5
    focus:outline-none focus:ring-2 focus:ring-indigo-300 ${mono ? "font-mono" : ""}`;
  return (
    <div>
      <label className="block text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
        {label}
      </label>
      {multiline
        ? <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={`${cls} resize-none`} />
        : <input type="text"  value={value} onChange={(e) => onChange(e.target.value)} className={cls} />}
    </div>
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
  const [expanded,    setExpanded]    = useState(false);
  const [rejectMode,  setRejectMode]  = useState(false);
  const [reason,      setReason]      = useState("");
  const [adminNotes,  setAdminNotes]  = useState("");
  const [acting,      setActing]      = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Editable copies of the payload fields ──────────────────────────────────
  const orig = record.payload;
  const [editName,        setEditName]        = useState(record.technology_name);
  const [editDomain,      setEditDomain]      = useState(orig?.domain        ?? record.domain        ?? "");
  const [editCarrier,     setEditCarrier]     = useState(orig?.carrier       ?? "");
  const [editOeo,         setEditOeo]         = useState(orig?.oeo_class     ?? record.oeo_class     ?? "");
  const [editDescription, setEditDescription] = useState(orig?.description   ?? record.description   ?? "");
  const [editInstances,   setEditInstances]   = useState<CreateTechnologyInstancePayload[]>(
    orig?.instances ?? []
  );

  const updateInstance = useCallback(
    (i: number, patch: Partial<CreateTechnologyInstancePayload>) =>
      setEditInstances((prev) => prev.map((inst, idx) => idx === i ? { ...inst, ...patch } : inst)),
    []
  );

  // Build the edited payload for submission
  const buildEditedPayload = useCallback(() => ({
    ...(orig ?? {}),
    technology_name: editName,
    domain:          editDomain,
    carrier:         editCarrier,
    oeo_class:       editOeo,
    description:     editDescription,
    instances:       editInstances,
  }), [orig, editName, editDomain, editCarrier, editOeo, editDescription, editInstances]);

  const handleAction = useCallback(async (action: "approve" | "reject") => {
    setActing(true);
    setActionError(null);
    try {
      const edited = buildEditedPayload();
      await actOnSubmission(
        token,
        record.submission_id,
        action,
        reason || undefined,
        edited,
        adminNotes || undefined,
      );
      onAction(record.submission_id, action, reason || undefined);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  }, [token, record.submission_id, reason, adminNotes, buildEditedPayload, onAction]);

  const isPending = record.status === "pending_review";
  const date = new Date(record.submitted_at).toLocaleString("en-GB", {
    dateStyle: "medium", timeStyle: "short",
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

      {/* ── Card header ── */}
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-slate-800 truncate">{record.technology_name}</h3>
            <StatusBadge status={record.status} />
            {record.domain && (
              <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded capitalize">
                {record.domain}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {record.submitter_email && (
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">person</span>
                {record.submitter_email}
              </span>
            )}
            <p className="text-[11px] text-slate-400">Submitted {date}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isPending && !rejectMode && (
            <>
              <button
                type="button" disabled={acting}
                onClick={() => handleAction("approve")}
                className="flex items-center gap-1 text-xs font-bold text-white bg-emerald-600
                           hover:bg-emerald-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[14px]">check_circle</span>
                Approve
              </button>
              <button
                type="button" disabled={acting}
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

      {/* ── Reject reason input ── */}
      {rejectMode && isPending && (
        <div className="px-5 pb-4 border-t border-slate-100 pt-3 space-y-2">
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            Rejection Reason (shown to submitter)
          </label>
          <textarea
            rows={2} value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
            placeholder="e.g. Missing reference source, duplicate entry…"
          />
          <div className="flex gap-2">
            <button
              type="button" disabled={acting}
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

      {/* ── Error ── */}
      {actionError && (
        <div className="mx-5 mb-3 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span className="material-symbols-outlined text-[14px] text-red-500">error</span>
          <p className="text-xs text-red-700">{actionError}</p>
        </div>
      )}

      {/* ── Expanded full-detail editor ── */}
      {expanded && (
        <div className="border-t border-slate-100 text-[11px]">
          <>
                {/* ── Identity ── */}
                <DetailSection icon="label" title="Identity & Taxonomy" isPending={isPending}>
                  <div className="grid grid-cols-2 gap-3">
                    {isPending
                      ? <EditText label="Technology Name" value={editName} onChange={setEditName} />
                      : <div><p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Name</p><p className="text-xs text-slate-700 mt-0.5">{record.technology_name}</p></div>
                    }
                    {isPending
                      ? <EditText label="Domain" value={editDomain} onChange={setEditDomain} />
                      : <div><p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Domain</p><p className="text-xs text-slate-700 capitalize mt-0.5">{record.domain ?? "—"}</p></div>
                    }
                    {isPending
                      ? <EditText label="Carrier" value={editCarrier} onChange={setEditCarrier} />
                      : <div><p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Carrier</p><p className="text-xs text-slate-700 mt-0.5">{orig?.carrier ?? "—"}</p></div>
                    }
                    {isPending
                      ? <EditText label="OEO Class URI" value={editOeo} onChange={setEditOeo} mono />
                      : <div><p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">OEO Class</p><p className="text-xs font-mono text-slate-500 break-all mt-0.5">{record.oeo_class ?? "—"}</p></div>
                    }
                  </div>
                  <div className="mt-3">
                    {isPending
                      ? <EditText label="Description" value={editDescription} onChange={setEditDescription} multiline />
                      : <><p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Description</p><p className="text-xs text-slate-600 leading-relaxed">{record.description ?? "—"}</p></>
                    }
                  </div>
                </DetailSection>

                {/* ── Technical Variants ── */}
                {editInstances.length > 0 && (
                  <DetailSection icon="engineering" title={`Technical Variants (${editInstances.length})`} isPending={isPending}>
                    <div className="space-y-4">
                      {editInstances.map((inst, i) => (
                        <div key={i} className="rounded-xl border border-slate-200 overflow-hidden">
                          {/* Variant header */}
                          <div className="flex items-center gap-2 px-4 py-2 bg-slate-100/80 border-b border-slate-200">
                            <span className="material-symbols-outlined text-[13px] text-slate-500">settings</span>
                            {isPending
                              ? <input
                                  type="text"
                                  value={inst.variant_name}
                                  onChange={(e) => updateInstance(i, { variant_name: e.target.value })}
                                  className="flex-1 text-xs font-bold bg-white border border-slate-200 rounded px-2 py-1
                                             focus:outline-none focus:ring-1 focus:ring-indigo-300"
                                />
                              : <p className="text-xs font-bold text-slate-700 flex-1">{inst.variant_name || `Variant ${i + 1}`}</p>
                            }
                          </div>
                          {/* Parameter grid */}
                          <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {isPending ? <>
                              <EditNum label="CAPEX"         unit="USD/kW"     value={inst.capex_usd_per_kw}                           onChange={(v) => updateInstance(i, { capex_usd_per_kw: v })} />
                              <EditNum label="OPEX Fixed"    unit="USD/kW·yr"  value={inst.opex_fixed_usd_per_kw_yr}                   onChange={(v) => updateInstance(i, { opex_fixed_usd_per_kw_yr: v })} />
                              <EditNum label="OPEX Variable" unit="USD/MWh"    value={inst.opex_var_usd_per_mwh}                       onChange={(v) => updateInstance(i, { opex_var_usd_per_mwh: v })} />
                              <EditNum label="Efficiency"    unit="%"          value={inst.efficiency_percent}                          onChange={(v) => updateInstance(i, { efficiency_percent: v })} />
                              <EditNum label="Lifetime"      unit="years"      value={inst.lifetime_years}                              onChange={(v) => updateInstance(i, { lifetime_years: v })} />
                              <EditNum label="CO₂ Factor"   unit="g CO₂/kWh"  value={inst.co2_emission_factor_operational_g_per_kwh}   onChange={(v) => updateInstance(i, { co2_emission_factor_operational_g_per_kwh: v })} />
                            </> : <>
                              {([
                                ["CAPEX",         inst.capex_usd_per_kw,                          "USD/kW"],
                                ["OPEX Fixed",    inst.opex_fixed_usd_per_kw_yr,                  "USD/kW·yr"],
                                ["OPEX Variable", inst.opex_var_usd_per_mwh,                      "USD/MWh"],
                                ["Efficiency",    inst.efficiency_percent,                         "%"],
                                ["Lifetime",      inst.lifetime_years,                             "years"],
                                ["CO₂ Factor",   inst.co2_emission_factor_operational_g_per_kwh,  "g CO₂/kWh"],
                              ] as [string, number, string][]).map(([label, val, unit]) => (
                                <div key={label}>
                                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
                                  <p className="text-sm font-bold text-slate-800 tabular-nums mt-0.5">
                                    {val != null ? val.toLocaleString() : <span className="text-slate-300">—</span>}
                                  </p>
                                  <p className="text-[9px] text-slate-400">{unit}</p>
                                </div>
                              ))}
                            </>}
                          </div>
                          {/* Reference source */}
                          <div className="px-4 pb-3">
                            {isPending
                              ? <EditText label="Reference Source" value={inst.reference_source} onChange={(v) => updateInstance(i, { reference_source: v })} />
                              : <><p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Reference Source</p><p className="text-xs text-slate-500 italic mt-0.5">{inst.reference_source || "—"}</p></>
                            }
                          </div>
                        </div>
                      ))}
                    </div>
                  </DetailSection>
                )}

                {/* ── Admin Notes (always visible for pending) ── */}
                {isPending && (
                  <DetailSection icon="rate_review" title="Admin Notes / Feedback" isPending={isPending}>
                    <p className="text-[10px] text-slate-400 mb-2 leading-relaxed">
                      Visible to the submitter in their "My Submissions" view. Explain any edits you made or why you changed specific values.
                    </p>
                    <textarea
                      rows={3}
                      value={adminNotes}
                      onChange={(e) => setAdminNotes(e.target.value)}
                      className="w-full text-xs bg-white border border-slate-200 rounded-lg px-3 py-2
                                 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
                      placeholder="e.g. Corrected CAPEX to match IRENA 2023 reference values. Adjusted OEO class to the more specific sub-class."
                    />
                  </DetailSection>
                )}

                {/* ── Rejection reason ── */}
                {record.rejection_reason && (
                  <div className="px-5 py-3 bg-red-50/50 border-t border-red-100">
                    <p className="text-[9px] font-bold text-red-400 uppercase tracking-widest mb-1">Admin Feedback</p>
                    <p className="text-xs text-red-700">{record.rejection_reason}</p>
                  </div>
                )}

                {/* ── Footer meta ── */}
                <div className="px-5 py-2.5 bg-slate-50/40 flex items-center gap-4">
                  <p className="text-[9px] font-mono text-slate-300 flex-1">ID: {record.submission_id}</p>
                  {isPending && (
                    <p className="text-[9px] text-indigo-400 italic">
                      Edits above are saved when you Approve or Reject
                    </p>
                  )}
                </div>
          </>
        </div>
      )}
    </div>
  );
}

// ── Catalogue Tech Edit Modal ─────────────────────────────────────────────────

function CatalogueTechModal({
  tech,
  token,
  onSave,
  onClose,
}: {
  tech: CatalogueTechEntry;
  token: string;
  onSave: () => void;
  onClose: () => void;
}) {
  const [name,        setName]        = useState(tech.technology_name);
  const [carrier,     setCarrier]     = useState(tech.carrier);
  const [oeoClass,    setOeoClass]    = useState(tech.oeo_class);
  const [description, setDescription] = useState(tech.description);
  const [instances,   setInstances]   = useState<Record<string, unknown>[]>(
    tech.instances.map((i) => ({ ...i }))
  );
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const updateInst = (idx: number, field: string, value: unknown) =>
    setInstances((prev) => prev.map((inst, i) => i === idx ? { ...inst, [field]: value } : inst));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminEditTechnology(token, tech.technology_id, {
        technology_name: name,
        carrier,
        oeo_class: oeoClass,
        description,
        instances,
      });
      onSave();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-800">Edit Technology</h2>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{tech.technology_id}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors p-1">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <EditText label="Technology Name" value={name} onChange={setName} />
            </div>
            <EditText label="Carrier" value={carrier} onChange={setCarrier} />
            <EditText label="OEO Class" value={oeoClass} onChange={setOeoClass} mono />
            <div className="col-span-2">
              <EditText label="Description" value={description} onChange={setDescription} multiline />
            </div>
          </div>

          {instances.length > 0 && (
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                Technical Variants ({instances.length})
              </p>
              <div className="space-y-3">
                {instances.map((inst, i) => (
                  <div key={i} className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200">
                      <span className="material-symbols-outlined text-[13px] text-slate-400">settings</span>
                      <input
                        type="text"
                        value={String(inst.instance_name ?? "")}
                        onChange={(e) => updateInst(i, "instance_name", e.target.value)}
                        placeholder="Instance name"
                        className="flex-1 text-xs font-bold bg-white border border-slate-200 rounded px-2 py-1
                                   focus:outline-none focus:ring-1 focus:ring-indigo-300"
                      />
                      <button
                        type="button"
                        onClick={() => setInstances((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Remove instance"
                      >
                        <span className="material-symbols-outlined text-[15px]">delete</span>
                      </button>
                    </div>
                    <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {([
                        ["capacity_mw",                               "Capacity",     "MW"],
                        ["capex_usd_per_kw",                         "CAPEX",        "USD/kW"],
                        ["opex_fixed_usd_per_kw_yr",                 "OPEX Fixed",   "USD/kW·yr"],
                        ["opex_var_usd_per_mwh",                     "OPEX Var",     "USD/MWh"],
                        ["efficiency_percent",                        "Efficiency",   "%"],
                        ["lifetime_years",                            "Lifetime",     "years"],
                        ["co2_emission_factor_operational_g_per_kwh","CO₂ Factor",   "g/kWh"],
                      ] as [string, string, string][]).map(([field, label, unit]) => (
                        <EditNum
                          key={field}
                          label={label}
                          unit={unit}
                          value={Number(inst[field] ?? 0)}
                          onChange={(v) => updateInst(i, field, v)}
                        />
                      ))}
                    </div>
                    <div className="px-4 pb-3">
                      <EditText
                        label="Reference Source"
                        value={String(inst.reference_source ?? "")}
                        onChange={(v) => updateInst(i, "reference_source", v)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span className="material-symbols-outlined text-[14px] text-red-500">error</span>
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2 rounded-xl hover:bg-slate-100 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700
                       px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[15px] ${saving ? "animate-spin" : ""}`}>
              {saving ? "progress_activity" : "save"}
            </span>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Catalogue: Profiles sub-tab ─────────────────────────────────────────────

const PROFILE_TYPE_COLOR: Record<string, string> = {
  capacity_factor: "bg-amber-100 text-amber-800",
  generation:      "bg-emerald-100 text-emerald-800",
  load:            "bg-blue-100 text-blue-800",
  weather:         "bg-sky-100 text-sky-800",
  price:           "bg-purple-100 text-purple-800",
};

function CatalogueProfilesTab({ token }: { token: string }) {
  const [profiles,      setProfiles]      = useState<TimeSeriesProfile[] | null>(null);
  const [loadError,     setLoadError]     = useState<string | null>(null);
  const [loading,       startLoad]        = useTransition();
  const [deleteConfirm, setDeleteConfirm] = useState<TimeSeriesProfile | null>(null);
  const [deleting,      setDeleting]      = useState(false);
  const [search,        setSearch]        = useState("");

  const BASE_URL =
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
    "http://localhost:8000/api/v1";

  const load = useCallback(() => {
    startLoad(async () => {
      setLoadError(null);
      try {
        const res = await fetch(`${BASE_URL}/timeseries?limit=1000`, {
          headers: {
            "ngrok-skip-browser-warning": "true",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) throw new Error(`API error ${res.status}`);
        const data = await res.json() as { profiles: TimeSeriesProfile[] };
        setProfiles(data.profiles);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load profiles.");
      }
    });
  }, [token, BASE_URL]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await deleteTimeSeriesProfile(deleteConfirm.profile_id, token);
      invalidateTimeSeriesCatalogue();
      setProfiles((prev) => prev ? prev.filter((p) => p.profile_id !== deleteConfirm.profile_id) : prev);
      setDeleteConfirm(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const filtered = (profiles ?? []).filter(
    (p) =>
      search === "" ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.type.toLowerCase().includes(search.toLowerCase()) ||
      p.location.toLowerCase().includes(search.toLowerCase()) ||
      (p.carrier ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <span className="material-symbols-outlined absolute left-3 top-2.5 text-[16px] text-slate-400">search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search profiles…"
            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50
                       focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white"
          />
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={load}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600
                     border border-slate-200 px-3 py-2 rounded-xl hover:bg-indigo-50 transition-colors"
        >
          <span className={`material-symbols-outlined text-[16px] ${loading ? "animate-spin" : ""}`}>refresh</span>
          Refresh
        </button>
        {profiles && (
          <p className="text-xs text-slate-400 ml-auto">{filtered.length} of {profiles.length} profiles</p>
        )}
      </div>

      {loadError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <span className="material-symbols-outlined text-red-500">error</span>
          <p className="text-sm text-red-700">{loadError}</p>
        </div>
      )}

      {loading && !profiles && (
        <div className="flex items-center gap-3 py-16 justify-center">
          <span className="material-symbols-outlined text-[28px] text-indigo-400 animate-spin">autorenew</span>
          <p className="text-slate-400 text-sm">Loading profiles…</p>
        </div>
      )}

      {profiles && (
        <div className="rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Profile</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden sm:table-cell">Type</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden md:table-cell">Location</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden lg:table-cell">Resolution</th>
                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Points</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400 text-sm">
                    {search ? "No matching profiles" : "No profiles in catalogue yet"}
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr key={p.profile_id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-800 text-sm">{p.name}</p>
                    <p className="text-[10px] font-mono text-slate-300 truncate max-w-[220px]">{p.profile_id}</p>
                    {p.unit && (
                      <span className="text-[10px] text-slate-400">{p.unit}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${PROFILE_TYPE_COLOR[p.type] ?? "bg-slate-100 text-slate-500"}`}>
                      {p.type.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 uppercase hidden md:table-cell">{p.location || "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 hidden lg:table-cell">{p.resolution}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs font-bold text-slate-600 tabular-nums">{p.n_timesteps.toLocaleString()}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(p)}
                        className="flex items-center gap-1 text-[11px] font-semibold text-red-500 hover:text-red-700
                                   bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        <span className="material-symbols-outlined text-[13px]">delete</span>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[28px] text-red-500 flex-shrink-0">delete_forever</span>
              <div>
                <h3 className="font-bold text-slate-800">Delete Profile?</h3>
                <p className="text-sm text-slate-500 mt-1">
                  <span className="font-semibold text-slate-700">{deleteConfirm.name}</span>{" "}
                  will be permanently removed from the catalogue. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2 rounded-xl hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 text-sm font-bold text-white bg-red-600 hover:bg-red-700
                           px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
              >
                <span className={`material-symbols-outlined text-[15px] ${deleting ? "animate-spin" : ""}`}>
                  {deleting ? "progress_activity" : "delete"}
                </span>
                {deleting ? "Deleting…" : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Catalogue management tab ──────────────────────────────────────────────────

type CatalogueSubTab = "technologies" | "profiles";

function CatalogueManager({ token }: { token: string }) {
  const [subTab,        setSubTab]        = useState<CatalogueSubTab>("technologies");
  const [techs,         setTechs]         = useState<CatalogueTechEntry[] | null>(null);
  const [loadError,     setLoadError]     = useState<string | null>(null);
  const [loading,       startLoad]        = useTransition();
  const [editTarget,    setEditTarget]    = useState<CatalogueTechEntry | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CatalogueTechEntry | null>(null);
  const [deleting,      setDeleting]      = useState(false);
  const [search,        setSearch]        = useState("");

  const load = useCallback(() => {
    startLoad(async () => {
      setLoadError(null);
      try {
        const data = await fetchAdminCatalogueTechnologies(token);
        setTechs(data);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load catalogue.");
      }
    });
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await adminDeleteTechnology(token, deleteConfirm.technology_id);
      setTechs((prev) => prev ? prev.filter((t) => t.technology_id !== deleteConfirm.technology_id) : prev);
      setDeleteConfirm(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const filtered = (techs ?? []).filter(
    (t) =>
      search === "" ||
      t.technology_name.toLowerCase().includes(search.toLowerCase()) ||
      t.domain.toLowerCase().includes(search.toLowerCase()) ||
      t.carrier.toLowerCase().includes(search.toLowerCase())
  );

  const domainColor: Record<string, string> = {
    generation:   "bg-amber-100 text-amber-800",
    storage:      "bg-blue-100 text-blue-800",
    conversion:   "bg-emerald-100 text-emerald-800",
    transmission: "bg-purple-100 text-purple-800",
  };

  return (
    <div className="space-y-5">

      {/* ── Sub-tab switcher ── */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {([
          { id: "technologies" as CatalogueSubTab, label: "Technologies", icon: "bolt"      },
          { id: "profiles"     as CatalogueSubTab, label: "Time-Series Profiles", icon: "ssid_chart" },
        ] as { id: CatalogueSubTab; label: string; icon: string }[]).map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={[
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
              subTab === id
                ? "bg-white text-indigo-700 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            ].join(" ")}
          >
            <span className="material-symbols-outlined text-[15px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* ── Profiles sub-tab ── */}
      {subTab === "profiles" && <CatalogueProfilesTab token={token} />}

      {/* ── Technologies sub-tab ── */}
      {subTab === "technologies" && (<>
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-[16px] text-slate-400">search</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search technologies…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50
                         focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white"
            />
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={load}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600
                       border border-slate-200 px-3 py-2 rounded-xl hover:bg-indigo-50 transition-colors"
          >
            <span className={`material-symbols-outlined text-[16px] ${loading ? "animate-spin" : ""}`}>refresh</span>
            Refresh
          </button>
          {techs && (
            <p className="text-xs text-slate-400 ml-auto">{filtered.length} of {techs.length} technologies</p>
          )}
        </div>

        {loadError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <span className="material-symbols-outlined text-red-500">error</span>
            <p className="text-sm text-red-700">{loadError}</p>
          </div>
        )}

        {loading && !techs && (
          <div className="flex items-center gap-3 py-16 justify-center">
            <span className="material-symbols-outlined text-[28px] text-indigo-400 animate-spin">autorenew</span>
            <p className="text-slate-400 text-sm">Loading catalogue…</p>
          </div>
        )}

        {techs && (
          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Technology</th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden sm:table-cell">Domain</th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden md:table-cell">Carrier</th>
                  <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Variants</th>
                  <th className="text-right px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-slate-400 text-sm">
                      {search ? "No matching technologies" : "Catalogue is empty"}
                    </td>
                  </tr>
                )}
                {filtered.map((tech) => (
                  <tr key={tech.technology_id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800 text-sm">{tech.technology_name}</p>
                      <p className="text-[10px] font-mono text-slate-300 truncate max-w-[200px]">{tech.technology_id}</p>
                      {tech.source === "contributor_submission" && (
                        <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded-full">contributed</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${domainColor[tech.domain] ?? "bg-slate-100 text-slate-500"}`}>
                        {tech.domain}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 capitalize hidden md:table-cell">{tech.carrier || "—"}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs font-bold text-slate-600 tabular-nums">{tech.instances.length}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditTarget(tech)}
                          className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800
                                     bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition-colors"
                        >
                          <span className="material-symbols-outlined text-[13px]">edit</span>
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(tech)}
                          className="flex items-center gap-1 text-[11px] font-semibold text-red-500 hover:text-red-700
                                     bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors"
                        >
                          <span className="material-symbols-outlined text-[13px]">delete</span>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editTarget && (
          <CatalogueTechModal
            tech={editTarget}
            token={token}
            onSave={load}
            onClose={() => setEditTarget(null)}
          />
        )}

        {deleteConfirm && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[28px] text-red-500 flex-shrink-0">delete_forever</span>
                <div>
                  <h3 className="font-bold text-slate-800">Delete Technology?</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    <span className="font-semibold text-slate-700">{deleteConfirm.technology_name}</span>{" "}
                    will be permanently removed from the catalogue. This cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2 rounded-xl hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-1.5 text-sm font-bold text-white bg-red-600 hover:bg-red-700
                             px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
                >
                  <span className={`material-symbols-outlined text-[15px] ${deleting ? "animate-spin" : ""}`}>
                    {deleting ? "progress_activity" : "delete"}
                  </span>
                  {deleting ? "Deleting…" : "Delete Permanently"}
                </button>
              </div>
            </div>
          </div>
        )}
      </>)}
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

// ── Mini ECharts canvas for profile preview ────────────────────────────────────

function MiniChart({ data, unit, color }: { data: ProfileSubmissionData; unit: string; color: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(containerRef.current, undefined, { renderer: "canvas" });
    }
    const chart = chartRef.current;

    // Downsample to ≤500 points for performance
    const pts  = data.points;
    const step = Math.max(1, Math.floor(pts.length / 500));
    const xs: string[] = [];
    const ys: number[] = [];
    for (let i = 0; i < pts.length; i += step) {
      xs.push(pts[i].timestamp);
      ys.push(pts[i].value);
    }

    chart.setOption({
      animation: false,
      grid:      { top: 8, right: 8, bottom: 30, left: 50 },
      tooltip:   { trigger: "axis", formatter: (p: unknown) => {
        const params = p as { axisValue: string; value: number }[];
        return params[0] ? `${params[0].axisValue}<br/>${params[0].value.toFixed(4)} ${unit}` : "";
      }},
      xAxis: {
        type:        "category",
        data:        xs,
        axisLabel:   { show: true, fontSize: 10, rotate: 30, interval: Math.floor(xs.length / 6) },
        axisLine:    { lineStyle: { color: "#e2e8f0" } },
        axisTick:    { show: false },
      },
      yAxis: {
        type:       "value",
        axisLabel:  { fontSize: 10 },
        splitLine:  { lineStyle: { color: "#f1f5f9" } },
      },
      series: [{
        type:      "line",
        data:      ys,
        smooth:    false,
        symbol:    "none",
        lineStyle: { color, width: 1.5 },
        areaStyle: { color: `${color}18` },
      }],
    } as echarts.EChartsOption);

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); };
  }, [data, unit, color]);

  return <div ref={containerRef} className="w-full h-48" />;
}

// ── Profile Submission Card ───────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  capacity_factor: "#f59e0b",
  generation:      "#22c55e",
  load:            "#3b82f6",
  weather:         "#0ea5e9",
  price:           "#a855f7",
};

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 min-w-[80px]">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</span>
      <span className="text-sm font-semibold text-slate-700 mt-0.5">{value}</span>
    </div>
  );
}

function fmtVal(v: number): string {
  const a = Math.abs(v);
  if (a >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  if (a >= 100)    return v.toFixed(2);
  if (a >= 1)      return v.toFixed(4);
  return v.toFixed(5);
}

function ProfileSubmissionCard({
  record,
  token,
  onAction,
}: {
  record: ProfileSubmissionRecord;
  token: string;
  onAction: (id: string, action: "approve" | "reject") => void;
}) {
  const [expanded,     setExpanded]   = useState(false);
  const [confirming,   setConfirming] = useState<"approve" | "reject" | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError,  setActionError]  = useState<string | null>(null);
  const [acting,       startAct]       = useTransition();

  // Lazy data fetch for chart
  const [chartData,    setChartData]   = useState<ProfileSubmissionData | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError,   setChartError]   = useState<string | null>(null);

  const isPending = record.status === "pending_review";
  const typeColor = TYPE_COLOR[record.type] ?? "#6366f1";

  // Load chart data when first expanded
  useEffect(() => {
    if (!expanded || chartData || chartLoading) return;
    setChartLoading(true);
    setChartError(null);
    fetchAdminProfileSubmissionData(token, record.submission_id)
      .then((d) => { setChartData(d); setChartLoading(false); })
      .catch((e) => { setChartError(e instanceof Error ? e.message : "Failed to load data."); setChartLoading(false); });
  }, [expanded, chartData, chartLoading, token, record.submission_id]);

  const doAction = (action: "approve" | "reject") => {
    setActionError(null);
    startAct(async () => {
      try {
        await actOnProfileSubmission(token, record.submission_id, action, action === "reject" ? rejectReason : undefined);
        onAction(record.submission_id, action);
        setConfirming(null);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Action failed.");
      }
    });
  };

  const s = record.stats;

  return (
    <div className={[
      "border rounded-2xl bg-white shadow-sm transition-all",
      isPending ? "border-amber-200" : record.status === "approved" ? "border-emerald-200" : "border-red-200",
    ].join(" ")}>
      {/* Header row */}
      <button
        type="button"
        className="w-full text-left px-6 py-4 flex items-center justify-between gap-4"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="material-symbols-outlined text-[20px] shrink-0" style={{ color: typeColor }}>ssid_chart</span>
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 text-sm truncate">{record.name}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {record.type} · {record.resolution} · {record.location} · {record.n_timesteps.toLocaleString()} points
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {s && (
            <span className="hidden md:flex items-center gap-2 text-[11px] text-slate-500 bg-slate-50 px-3 py-1 rounded-lg border border-slate-100">
              <span>min {fmtVal(s.v_min)}</span>
              <span className="text-slate-300">·</span>
              <span>mean {fmtVal(s.v_mean)}</span>
              <span className="text-slate-300">·</span>
              <span>max {fmtVal(s.v_max)}</span>
              <span className="ml-1 text-slate-400">{record.unit}</span>
            </span>
          )}
          <StatusBadge status={record.status as "pending_review" | "approved" | "rejected"} />
          <span className="material-symbols-outlined text-slate-400 text-[18px]">
            {expanded ? "expand_less" : "expand_more"}
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-6 pb-6 border-t border-slate-100 space-y-5 pt-5">

          {/* ── Metadata grid ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
            {([
              ["Source",    record.source],
              ["Carrier",   record.carrier],
              ["Year",      String(record.year)],
              ["Unit",      record.unit],
              ["Submitted", record.submitted_at],
              ["Submitter", record.submitter_email ?? "—"],
              ...(s ? [["From", s.first_ts], ["To", s.last_ts]] : []),
            ] as [string, string][]).map(([label, val]) => (
              <div key={label}>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
                <p className="text-slate-700 text-[13px] truncate">{val || "—"}</p>
              </div>
            ))}
          </div>

          {/* ── Statistical summary ── */}
          {s && (
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Statistics</p>
              <div className="flex flex-wrap gap-2">
                <StatPill label="Min"    value={`${fmtVal(s.v_min)} ${record.unit}`}  />
                <StatPill label="P10"    value={`${fmtVal(s.v_p10)} ${record.unit}`}  />
                <StatPill label="Mean"   value={`${fmtVal(s.v_mean)} ${record.unit}`} />
                <StatPill label="P90"    value={`${fmtVal(s.v_p90)} ${record.unit}`}  />
                <StatPill label="Max"    value={`${fmtVal(s.v_max)} ${record.unit}`}  />
                <StatPill label="Std"    value={`${fmtVal(s.v_std)} ${record.unit}`}  />
                <StatPill label="Points" value={record.n_timesteps.toLocaleString()}  />
              </div>
            </div>
          )}

          {/* ── Chart preview ── */}
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Data Preview</p>
            {chartLoading && (
              <div className="h-48 flex items-center justify-center gap-2 bg-slate-50 rounded-xl border border-slate-100">
                <span className="material-symbols-outlined text-indigo-400 animate-spin text-[22px]">autorenew</span>
                <span className="text-sm text-slate-400">Loading chart…</span>
              </div>
            )}
            {chartError && (
              <div className="h-16 flex items-center justify-center bg-red-50 rounded-xl border border-red-100">
                <span className="text-sm text-red-500">{chartError}</span>
              </div>
            )}
            {chartData && !chartLoading && (
              <div className="rounded-xl border border-slate-100 overflow-hidden bg-white">
                <MiniChart data={chartData} unit={record.unit} color={typeColor} />
              </div>
            )}
          </div>

          {record.description && (
            <p className="text-sm text-slate-600 bg-slate-50 px-4 py-3 rounded-xl">{record.description}</p>
          )}

          {record.rejection_reason && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 px-4 py-3 rounded-xl">
              Rejection reason: {record.rejection_reason}
            </p>
          )}

          {actionError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 px-4 py-2 rounded-xl">{actionError}</p>
          )}

          {/* ── Actions ── */}
          {isPending && !confirming && (
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                disabled={acting}
                onClick={() => setConfirming("approve")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600
                           text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Approve
              </button>
              <button
                type="button"
                disabled={acting}
                onClick={() => setConfirming("reject")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-100 hover:bg-red-200
                           text-red-700 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">cancel</span>
                Reject
              </button>
            </div>
          )}

          {confirming === "approve" && (
            <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <p className="text-sm text-emerald-800 flex-1">Approve this profile and publish it to the catalogue?</p>
              <button
                type="button"
                disabled={acting}
                onClick={() => doAction("approve")}
                className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                {acting ? "…" : "Confirm"}
              </button>
              <button type="button" onClick={() => setConfirming(null)} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
            </div>
          )}

          {confirming === "reject" && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 space-y-3">
              <p className="text-sm text-red-800 font-semibold">Reject this profile submission?</p>
              <textarea
                rows={2}
                placeholder="Reason for rejection (optional)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full text-sm border border-red-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => doAction("reject")}
                  className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  {acting ? "…" : "Confirm Reject"}
                </button>
                <button type="button" onClick={() => setConfirming(null)} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type StatusTab = "all" | "pending_review" | "approved" | "rejected";
type PanelTab  = "submissions" | "catalogue" | "profiles";

export default function AdminPanel() {
  const { user, token, isAdmin } = useAuth();
  const [submissions,        setSubmissions]        = useState<SubmissionRecord[] | null>(null);
  const [profileSubmissions, setProfileSubmissions] = useState<ProfileSubmissionRecord[] | null>(null);
  const [loadError,          setLoadError]          = useState<string | null>(null);
  const [profileLoadError,   setProfileLoadError]   = useState<string | null>(null);
  const [activeTab,          setActiveTab]          = useState<StatusTab>("all");
  const [panelTab,           setPanelTab]           = useState<PanelTab>("submissions");
  const [loading,            startLoad]             = useTransition();
  const [profileLoading,     startProfileLoad]      = useTransition();

  const load = useCallback((tok: string) => {
    startLoad(async () => {
      setLoadError(null);
      try {
        const data = await fetchAdminSubmissions(tok);
        setSubmissions(data);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load submissions.");
      }
    });
  }, []);

  const loadProfiles = useCallback((tok: string) => {
    startProfileLoad(async () => {
      setProfileLoadError(null);
      try {
        const data = await fetchAdminProfileSubmissions(tok);
        setProfileSubmissions(data);
      } catch (e) {
        setProfileLoadError(e instanceof Error ? e.message : "Failed to load profile submissions.");
      }
    });
  }, []);

  // Auto-load once when admin is confirmed and token is available.
  // Must be inside useEffect — calling startTransition during render is illegal.
  useEffect(() => {
    if (isAdmin && token) {
      load(token);
      loadProfiles(token);
    }
    // Run only once on mount (or when isAdmin/token first become truthy)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, token]);

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

  const handleProfileAction = useCallback(
    (id: string, action: "approve" | "reject") => {
      setProfileSubmissions((prev) =>
        prev
          ? prev.map((s) =>
              s.submission_id === id
                ? { ...s, status: action === "approve" ? "approved" : "rejected" }
                : s
            )
          : prev
      );
    },
    []
  );

  // ── Not an admin ──────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-8">
        <span className="material-symbols-outlined text-6xl text-slate-200">lock</span>
        <div>
          <h2 className="text-xl font-bold text-slate-700">
            {user ? "Admin access required" : "Sign in to access this page"}
          </h2>
          <p className="text-slate-400 text-sm mt-2 max-w-sm">
            {user
              ? "Your account does not have admin privileges. Sign out and use the admin credentials to continue."
              : "Use the Sign In button and enter your admin credentials to access this panel."}
          </p>
        </div>
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
            Admin Panel
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage submissions and edit the live technology catalogue.
          </p>
        </div>
        {panelTab === "submissions" && (
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
        )}
      </div>

      {/* ── Top-level panel tabs ── */}
      <div className="flex gap-1 border-b border-slate-200">
        {([
          { id: "submissions" as PanelTab, label: "Submissions",         icon: "inbox"           },
          { id: "profiles"   as PanelTab, label: "Profile Submissions",  icon: "ssid_chart"      },
          { id: "catalogue"  as PanelTab, label: "Catalogue Management", icon: "database"        },
        ]).map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanelTab(id)}
            className={[
              "flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-t-xl transition-colors border-b-2",
              panelTab === id
                ? "text-indigo-600 border-indigo-500 bg-indigo-50/60"
                : "text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50",
            ].join(" ")}
          >
            <span className="material-symbols-outlined text-[16px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* ── Catalogue management panel ── */}
      {panelTab === "catalogue" && token && (
        <CatalogueManager token={token} />
      )}

      {/* ── Profile submissions panel ── */}
      {panelTab === "profiles" && (<>
        {profileLoadError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <span className="material-symbols-outlined text-red-500">error</span>
            <p className="text-sm text-red-700">{profileLoadError}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {profileSubmissions === null
              ? "Loading…"
              : `${profileSubmissions.length} submission${profileSubmissions.length !== 1 ? "s" : ""} total`}
          </p>
          <button
            type="button"
            disabled={profileLoading}
            onClick={() => token && loadProfiles(token)}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600
                       border border-slate-200 px-3 py-2 rounded-xl hover:bg-indigo-50 transition-colors"
          >
            <span className={`material-symbols-outlined text-[16px] ${profileLoading ? "animate-spin" : ""}`}>refresh</span>
            Refresh
          </button>
        </div>

        {profileLoading && (
          <div className="flex items-center gap-3 py-12 justify-center">
            <span className="material-symbols-outlined text-[30px] text-indigo-400 animate-spin">autorenew</span>
            <p className="text-slate-500 text-sm">Loading profile submissions…</p>
          </div>
        )}

        {!profileLoading && profileSubmissions !== null && profileSubmissions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <span className="material-symbols-outlined text-5xl text-slate-200">ssid_chart</span>
            <p className="text-slate-400 font-semibold">No profile submissions yet</p>
          </div>
        )}

        {!profileLoading && profileSubmissions !== null && profileSubmissions.length > 0 && (
          <div className="space-y-3">
            {profileSubmissions.map((record) => (
              <ProfileSubmissionCard
                key={record.submission_id}
                record={record}
                token={token!}
                onAction={handleProfileAction}
              />
            ))}
          </div>
        )}
      </>)}

      {/* ── Submissions panel ── */}
      {panelTab === "submissions" && (<>

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
              token={token!}
              onAction={handleAction}
            />
          ))}
        </div>
      )}
      </>)}
    </div>
  );
}

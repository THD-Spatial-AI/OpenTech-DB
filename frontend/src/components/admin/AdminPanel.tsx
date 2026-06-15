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
import type { TimeSeriesProfile, ProfileType, ProfileResolution } from "../../types/timeseries";
import { useAuth } from "../../context/AuthContext";
import type { SubmissionRecord, CreateTechnologyInstancePayload } from "../../types/api";
import ScraperPanel from "./ScraperPanel";

const TS_UNIT_OPTIONS = [
  "pu", "%", "W", "kW", "MW", "GW", "TW",
  "Wh", "kWh", "MWh", "GWh", "TWh", "GJ", "TJ", "PJ",
  "EUR/MWh", "USD/MWh", "EUR/kWh", "USD/kWh", "EUR/GJ", "USD/GJ", "EUR/MW", "USD/MW",
  "W/m²", "kW/m²", "Wh/m²", "kWh/m²",
  "m/s", "km/h", "°C", "K", "°F", "Pa", "hPa",
  "kg CO₂/MWh", "t CO₂/MWh", "g CO₂/kWh", "kg CO₂/GJ",
  "m³", "m³/s", "kg/s", "t/h",
  "hours", "dimensionless",
];

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
  onAction: (id: string, action: "approve" | "reject", prUrl?: string) => void;
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
      const result = await actOnSubmission(
        token,
        record.submission_id,
        action,
        reason || undefined,
        edited,
        adminNotes || undefined,
      );
      onAction(record.submission_id, action, result.pr_url);
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
                  {record.pr_url && (
                    <a
                      href={record.pr_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600
                                 hover:text-indigo-800 hover:underline"
                    >
                      <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                      View GitHub PR
                    </a>
                  )}
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

// ── Catalogue Tech Edit Drawer ────────────────────────────────────────────────

const CORE_FIELDS: [string, string, string][] = [
  ["capacity_mw",                                "Capacity",      "MW"],
  ["capex_usd_per_kw",                           "CAPEX",         "USD/kW"],
  ["opex_fixed_usd_per_kw_yr",                   "OPEX Fixed",    "USD/kW·yr"],
  ["opex_var_usd_per_mwh",                       "OPEX Variable", "USD/MWh"],
  ["efficiency_percent",                          "Efficiency",    "%"],
  ["lifetime_years",                              "Lifetime",      "years"],
  ["co2_emission_factor_operational_g_per_kwh",  "CO₂ Factor",    "g/kWh"],
];

const CORE_FIELD_KEYS = new Set(
  ["instance_id", "instance_name", "reference_source", ...CORE_FIELDS.map(([k]) => k)]
);

function blankInstance(): Record<string, unknown> {
  return {
    instance_id:   `new_instance_${Date.now()}`,
    instance_name: "",
    capacity_mw: 0, capex_usd_per_kw: 0, opex_fixed_usd_per_kw_yr: 0,
    opex_var_usd_per_mwh: 0, efficiency_percent: 0, lifetime_years: 20,
    co2_emission_factor_operational_g_per_kwh: 0, reference_source: "",
  };
}

function ExtraParamRow({
  paramKey, value, onKeyChange, onValueChange, onRemove,
}: {
  paramKey: string;
  value: string;
  onKeyChange: (k: string) => void;
  onValueChange: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={paramKey}
        onChange={(e) => onKeyChange(e.target.value)}
        placeholder="param_key"
        className="flex-1 min-w-0 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5
                   focus:outline-none focus:ring-2 focus:ring-indigo-300"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder="value"
        className="flex-1 min-w-0 text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5
                   focus:outline-none focus:ring-2 focus:ring-indigo-300"
      />
      <button
        type="button"
        onClick={onRemove}
        className="text-slate-300 hover:text-red-500 transition-colors shrink-0"
      >
        <span className="material-symbols-outlined text-[16px]">remove_circle</span>
      </button>
    </div>
  );
}

function InstanceEditor({
  inst,
  idx,
  onUpdate,
  onRemove,
}: {
  inst: Record<string, unknown>;
  idx: number;
  onUpdate: (idx: number, field: string, value: unknown) => void;
  onRemove: (idx: number) => void;
}) {
  const [expanded, setExpanded] = useState(idx === 0);

  // Extra params: anything not in CORE_FIELD_KEYS
  const [extraPairs, setExtraPairs] = useState<{ k: string; v: string }[]>(() =>
    Object.entries(inst)
      .filter(([k]) => !CORE_FIELD_KEYS.has(k))
      .map(([k, v]) => ({ k, v: String(v ?? "") }))
  );

  // Push extra params back up whenever they change
  const syncExtra = (pairs: { k: string; v: string }[]) => {
    setExtraPairs(pairs);
    // Remove old extra keys, add new ones
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(inst)) {
      if (CORE_FIELD_KEYS.has(k)) cleaned[k] = v;
    }
    for (const { k, v } of pairs) {
      if (k.trim()) cleaned[k.trim()] = v;
    }
    for (const [k, v] of Object.entries(cleaned)) {
      if (!CORE_FIELD_KEYS.has(k)) {
        onUpdate(idx, k, v);
      }
    }
  };

  const addExtraParam = () => syncExtra([...extraPairs, { k: "", v: "" }]);

  const updateExtraKey = (i: number, k: string) => {
    const next = extraPairs.map((p, pi) => pi === i ? { ...p, k } : p);
    syncExtra(next);
  };
  const updateExtraVal = (i: number, v: string) => {
    const next = extraPairs.map((p, pi) => pi === i ? { ...p, v } : p);
    syncExtra(next);
  };
  const removeExtra = (i: number) => syncExtra(extraPairs.filter((_, pi) => pi !== i));

  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
      {/* Instance header — always visible */}
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-slate-50 to-white
                   border-b border-slate-200 hover:bg-slate-50 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 text-[11px] font-bold
                         flex items-center justify-center shrink-0">
          {idx + 1}
        </span>
        <span className="flex-1 text-sm font-semibold text-slate-700 truncate">
          {String(inst.instance_name || inst.instance_id || `Variant ${idx + 1}`)}
        </span>
        {/* Key stats inline preview */}
        {!expanded && (
          <span className="hidden sm:flex items-center gap-3 text-[11px] text-slate-400 shrink-0">
            {inst.capex_usd_per_kw != null && (
              <span className="font-mono">{Number(inst.capex_usd_per_kw).toLocaleString()} USD/kW</span>
            )}
            {inst.lifetime_years != null && (
              <span className="font-mono">{String(inst.lifetime_years)} yr</span>
            )}
          </span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
            className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors"
            title="Remove variant"
          >
            <span className="material-symbols-outlined text-[15px]">delete</span>
          </button>
          <span className={`material-symbols-outlined text-[16px] text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}>
            expand_more
          </span>
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="p-4 space-y-4">
          {/* Instance name + ID */}
          <div className="grid grid-cols-2 gap-3">
            <EditText
              label="Instance Name"
              value={String(inst.instance_name ?? "")}
              onChange={(v) => onUpdate(idx, "instance_name", v)}
            />
            <EditText
              label="Instance ID"
              value={String(inst.instance_id ?? "")}
              onChange={(v) => onUpdate(idx, "instance_id", v)}
              mono
            />
          </div>

          {/* Core numeric params */}
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Core Parameters
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {CORE_FIELDS.map(([field, label, unit]) => (
                <EditNum
                  key={field}
                  label={label}
                  unit={unit}
                  value={Number(inst[field] ?? 0)}
                  onChange={(v) => onUpdate(idx, field, v)}
                />
              ))}
            </div>
          </div>

          {/* Reference source */}
          <EditText
            label="Reference Source"
            value={String(inst.reference_source ?? "")}
            onChange={(v) => onUpdate(idx, "reference_source", v)}
          />

          {/* Extra / custom parameters */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Extra Parameters
              </p>
              <button
                type="button"
                onClick={addExtraParam}
                className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600
                           hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-[13px]">add</span>
                Add parameter
              </button>
            </div>
            {extraPairs.length === 0 && (
              <p className="text-[11px] text-slate-300 italic">No extra parameters. Click "Add parameter" to extend this variant.</p>
            )}
            <div className="space-y-2">
              {extraPairs.map((p, i) => (
                <ExtraParamRow
                  key={i}
                  paramKey={p.k}
                  value={p.v}
                  onKeyChange={(k) => updateExtraKey(i, k)}
                  onValueChange={(v) => updateExtraVal(i, v)}
                  onRemove={() => removeExtra(i)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Catalogue: Profiles sub-tab ─────────────────────────────────────────────

const PROFILE_TYPE_META: Record<string, { color: string; bg: string; ring: string; icon: string; label: string }> = {
  capacity_factor: { color: "text-amber-700",   bg: "bg-amber-50",   ring: "ring-amber-200",   icon: "percent",       label: "Capacity Factor" },
  generation:      { color: "text-emerald-700", bg: "bg-emerald-50", ring: "ring-emerald-200", icon: "bolt",          label: "Generation"      },
  load:            { color: "text-blue-700",    bg: "bg-blue-50",    ring: "ring-blue-200",    icon: "electric_meter", label: "Load"           },
  weather:         { color: "text-sky-700",     bg: "bg-sky-50",     ring: "ring-sky-200",     icon: "wb_sunny",      label: "Weather"         },
  price:           { color: "text-purple-700",  bg: "bg-purple-50",  ring: "ring-purple-200",  icon: "payments",      label: "Price"           },
};

const PROFILE_TYPE_BADGE: Record<string, string> = {
  capacity_factor: "bg-amber-100 text-amber-800",
  generation:      "bg-emerald-100 text-emerald-800",
  load:            "bg-blue-100 text-blue-800",
  weather:         "bg-sky-100 text-sky-800",
  price:           "bg-purple-100 text-purple-800",
};

const PROFILE_TYPE_HEX: Record<string, string> = {
  capacity_factor: "#f59e0b",
  generation:      "#22c55e",
  load:            "#3b82f6",
  weather:         "#0ea5e9",
  price:           "#a855f7",
};

// ── Admin profile chart helpers ───────────────────────────────────────────
type AdminPreset = "full" | "1w" | "1d";
type AdminAgg    = "raw" | "hourly" | "daily";
interface DispPoint  { ts: number; v: number; oi: number }
interface AdminStats { min: number; max: number; mean: number; median: number; stddev: number; n: number }

function resolveAdminWindow(preset: AdminPreset, firstMs: number, lastMs: number): [number, number] {
  const H = 3_600_000;
  switch (preset) {
    case "1d": return [firstMs, Math.min(firstMs + 24  * H, lastMs)];
    case "1w": return [firstMs, Math.min(firstMs + 168 * H, lastMs)];
    default:   return [firstMs, lastMs];
  }
}

const ADMIN_AGG_MS: Record<AdminAgg, number> = { raw: 0, hourly: 3_600_000, daily: 86_400_000 };

function adminAggregate(pts: DispPoint[], bucketMs: number): DispPoint[] {
  if (bucketMs === 0 || pts.length === 0) return pts;
  const buckets = new Map<number, { sum: number; n: number; oi: number }>();
  for (const { ts, v, oi } of pts) {
    const key = Math.floor(ts / bucketMs) * bucketMs;
    const b   = buckets.get(key) ?? { sum: 0, n: 0, oi };
    b.sum += v; b.n++;
    buckets.set(key, b);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([ts, { sum, n, oi }]) => ({ ts, v: sum / n, oi }));
}

function adminFmt(v: number, unit: string): string {
  const abs = Math.abs(v);
  const s = abs >= 10_000 ? `${(v / 1000).toFixed(2)}k`
          : abs >= 100    ? v.toFixed(1)
          : abs >= 1      ? v.toFixed(3)
          :                 v.toFixed(4);
  return `${s} ${unit}`;
}

function adminComputeStats(values: number[]): AdminStats {
  if (!values.length) return { min: 0, max: 0, mean: 0, median: 0, stddev: 0, n: 0 };
  const n        = values.length;
  const sum      = values.reduce((a, b) => a + b, 0);
  const mean     = sum / n;
  const variance = values.reduce((a, vv) => a + (vv - mean) ** 2, 0) / n;
  const sorted   = [...values].sort((a, b) => a - b);
  const median   = sorted.length % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  return { min: sorted[0], max: sorted[n - 1], mean, median, stddev: Math.sqrt(variance), n };
}

/** Detail panel — Info / Chart / Data tabs with full editing. */
function ProfileDetailPanel({
  profile,
  token,
  onDeleted,
  onUpdated,
}: {
  profile: TimeSeriesProfile;
  token: string;
  onDeleted: () => void;
  onUpdated: (updated: TimeSeriesProfile) => void;
}) {
  const BASE_URL =
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
    "http://localhost:8000/api/v1";

  // ── Tab ─────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"info" | "chart" | "data">("info");

  // ── Metadata form state ──────────────────────────────────────────────────
  const [pName,        setPName]        = useState(profile.name);
  const [pType,        setPType]        = useState(profile.type);
  const [pResolution,  setPResolution]  = useState(profile.resolution);
  const [pLocation,    setPLocation]    = useState(profile.location);
  const [pSource,      setPSource]      = useState(profile.source);
  const [pCarrier,     setPCarrier]     = useState(profile.carrier ?? "");
  const [pYear,        setPYear]        = useState(String(profile.year ?? ""));
  const [pUnit,        setPUnit]        = useState(profile.unit);
  const [pDescription, setPDescription] = useState(profile.description ?? "");
  const [savingMeta,   setSavingMeta]   = useState(false);
  const [metaError,    setMetaError]    = useState<string | null>(null);

  // ── Raw data state ───────────────────────────────────────────────────────
  const [points,      setPoints]      = useState<{ timestamp: string; value: number }[] | null>(null);
  const pointsRef                     = useRef<{ timestamp: string; value: number }[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError,   setDataError]   = useState<string | null>(null);
  const [savingData,  setSavingData]  = useState(false);
  const [isDirty,     setIsDirty]     = useState(false);
  const [dataPage,    setDataPage]    = useState(0);
  const PAGE_SIZE = 50;
  const [jumpRow,      setJumpRow]     = useState("");
  const [activeRow,    setActiveRow]   = useState<number | null>(null);
  // Tracks the raw string while user is mid-typing in a value cell
  const [editingVal,   setEditingVal]  = useState<{ gi: number; draft: string } | null>(null);
  const [tsFilter,     setTsFilter]    = useState("");

  // ── Chart state ──────────────────────────────────────────────────────────
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef  = useRef<echarts.ECharts | null>(null);
  const drawModeRef       = useRef(false);
  const displayRef        = useRef<DispPoint[]>([]);
  const [drawMode,    setDrawMode]    = useState(false);
  const [selectedPt,  setSelectedPt]  = useState<{ idx: number; ts: string; val: number } | null>(null);
  const [editVal,     setEditVal]     = useState("");
  const [chartPreset, setChartPreset] = useState<AdminPreset>("full");
  const [chartAgg,    setChartAgg]    = useState<AdminAgg>("raw");
  const [chartType,   setChartType]   = useState<"line" | "bar">("line");
  const [chartStats,  setChartStats]  = useState<AdminStats | null>(null);

  // ── Delete state ─────────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  // ── Reset on profile change ───────────────────────────────────────────────
  useEffect(() => {
    setPName(profile.name);
    setPType(profile.type);
    setPResolution(profile.resolution);
    setPLocation(profile.location);
    setPSource(profile.source);
    setPCarrier(profile.carrier ?? "");
    setPYear(String(profile.year ?? ""));
    setPUnit(profile.unit);
    setPDescription(profile.description ?? "");
    setMetaError(null);
    setPoints(null);
    pointsRef.current = [];
    setIsDirty(false);
    setActiveTab("info");
    setSelectedPt(null);
    setDrawMode(false);
    drawModeRef.current = false;
    setDeleteConfirm(false);
    setDataPage(0);
    setDataError(null);
    setJumpRow("");
    setActiveRow(null);
    setEditingVal(null);
    setTsFilter("");
    setChartPreset("full");
    setChartAgg("raw");
    setChartType("line");
    setChartStats(null);
    displayRef.current = [];
    if (chartInstanceRef.current) {
      chartInstanceRef.current.dispose();
      chartInstanceRef.current = null;
    }
  }, [profile.profile_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load data points ─────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoadingData(true);
    setDataError(null);
    try {
      const res = await fetch(`${BASE_URL}/timeseries/${profile.profile_id}/data`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const d = (await res.json()) as { points: { timestamp: string; value: number }[] };
      setPoints(d.points);
      pointsRef.current = d.points;
    } catch (e) {
      setDataError(e instanceof Error ? e.message : "Failed to load data.");
    } finally {
      setLoadingData(false);
    }
  }, [token, profile.profile_id, BASE_URL]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if ((activeTab === "chart" || activeTab === "data") && points === null && !loadingData) {
      loadData();
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save metadata ─────────────────────────────────────────────────────────
  const saveMeta = async () => {
    setSavingMeta(true);
    setMetaError(null);
    try {
      const body: Record<string, unknown> = {
        name: pName, type: pType, resolution: pResolution,
        location: pLocation, source: pSource, unit: pUnit, description: pDescription,
      };
      if (pCarrier) body.carrier = pCarrier;
      if (pYear)    body.year    = Number(pYear);
      const res = await fetch(`${BASE_URL}/timeseries/${profile.profile_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? `API error ${res.status}`);
      }
      const updated = (await res.json()) as Record<string, unknown>;
      onUpdated({
        ...profile,
        name:        String(updated.name        ?? pName),
        type:        (updated.type        as TimeSeriesProfile["type"])       ?? profile.type,
        resolution:  (updated.resolution  as TimeSeriesProfile["resolution"]) ?? profile.resolution,
        location:    String(updated.location    ?? pLocation),
        source:      String(updated.source      ?? pSource),
        carrier:     pCarrier || null,
        year:        pYear ? Number(pYear) : null,
        unit:        String(updated.unit        ?? pUnit),
        description: String(updated.description ?? pDescription),
      });
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingMeta(false);
    }
  };

  // ── Save data ─────────────────────────────────────────────────────────────
  const saveData = async () => {
    const pts = pointsRef.current;
    if (!pts.length) return;
    setSavingData(true);
    setDataError(null);
    try {
      const res = await fetch(`${BASE_URL}/timeseries/${profile.profile_id}/data`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ points: pts }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? `API error ${res.status}`);
      }
      setIsDirty(false);
    } catch (e) {
      setDataError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingData(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteTimeSeriesProfile(profile.profile_id, token);
      invalidateTimeSeriesCatalogue();
      onDeleted();
    } catch (_e) {
      setDeleting(false);
    }
  };

  // ── Chart: init + wire draw/click ────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== "chart") {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
      return;
    }
    if (!chartContainerRef.current || !points) return;

    const hexColor  = PROFILE_TYPE_HEX[profile.type] ?? "#6366f1";
    const unitLabel = pUnit;

    // Build display data from current edits + preset/agg
    const rawMs: DispPoint[] = pointsRef.current.map((p, i) => ({
      ts: new Date(p.timestamp).getTime(), v: p.value, oi: i,
    }));
    const firstMs = rawMs[0]?.ts ?? 0;
    const lastMs  = rawMs[rawMs.length - 1]?.ts ?? 0;
    const [winStart, winEnd] = resolveAdminWindow(chartPreset, firstMs, lastMs);
    const visible  = rawMs.filter((p) => p.ts >= winStart && p.ts <= winEnd);
    const display  = adminAggregate(visible, ADMIN_AGG_MS[chartAgg]);
    displayRef.current = display;
    setChartStats(adminComputeStats(display.map((p) => p.v)));

    const seriesData = display.map((p) => [p.ts, p.v]);
    const series: echarts.SeriesOption = chartType === "line"
      ? { type: "line",  name: pName, data: seriesData, symbol: "none",
          lineStyle: { color: hexColor, width: 1.8 },
          areaStyle: { color: hexColor, opacity: 0.07 } }
      : { type: "bar",   name: pName, data: seriesData,
          itemStyle: { color: hexColor, borderRadius: [2, 2, 0, 0] },
          barMaxWidth: 6, large: true, largeThreshold: 2000 };

    const chart = echarts.init(chartContainerRef.current, undefined, { renderer: "canvas" });
    chartInstanceRef.current = chart;

    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      grid: { top: 16, right: 18, bottom: 72, left: 60, containLabel: false },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", lineStyle: { color: hexColor, opacity: 0.35 } },
        backgroundColor: "#fff",
        borderColor: "#e0e3e5",
        borderWidth: 1,
        formatter: (params: unknown) => {
          const pp = params as Array<{ value: [number, number]; dataIndex: number }>;
          if (!pp[0]) return "";
          const dt = new Date(pp[0].value[0]);
          const dateStr = dt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
          const dp   = displayRef.current[pp[0].dataIndex];
          const hint = chartAgg === "raw"
            ? `<span style="opacity:0.5;font-size:10px">idx\u00a0${dp?.oi ?? "?"} \u00b7 click to select</span>`
            : `<span style="opacity:0.5;font-size:10px">${chartAgg}\u00a0avg</span>`;
          return `<div style="font-family:Inter,sans-serif;font-size:11px;color:#434655;">${dateStr}</div>`
            + `<strong style="font-size:13px;color:${hexColor}">${adminFmt(pp[0].value[1], unitLabel)}</strong><br/>${hint}`;
        },
      },
      xAxis: {
        type: "time",
        min: winStart, max: winEnd,
        axisLine:  { lineStyle: { color: "#c3c6d7" } },
        axisLabel: { color: "#434655", fontFamily: "Inter,sans-serif", fontSize: 11, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: unitLabel,
        nameTextStyle: { color: "#737686", fontSize: 11, fontFamily: "Inter,sans-serif", padding: [0, 8, 0, 0] },
        axisLabel: {
          color: "#434655", fontFamily: "Inter,sans-serif", fontSize: 11,
          formatter: (v: number) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`,
        },
        splitLine: { lineStyle: { color: "#c3c6d7", opacity: 0.35 } },
      },
      dataZoom: [
        {
          type: "slider", xAxisIndex: 0, bottom: 8, height: 26,
          borderColor: "#c3c6d7", backgroundColor: "#f2f4f6",
          dataBackground:         { lineStyle: { color: hexColor, opacity: 0.45 }, areaStyle: { color: hexColor, opacity: 0.08 } },
          selectedDataBackground: { lineStyle: { color: hexColor }, areaStyle: { color: hexColor, opacity: 0.22 } },
          fillerColor: `${hexColor}22`,
          handleStyle:     { color: hexColor, borderColor: hexColor },
          moveHandleStyle: { color: hexColor },
          textStyle: { color: "#434655", fontFamily: "Inter,sans-serif", fontSize: 10 },
        },
        { type: "inside", xAxisIndex: 0 },
      ],
      series: [series],
    } as echarts.EChartsOption);

    requestAnimationFrame(() => { if (chartInstanceRef.current) chartInstanceRef.current.resize(); });

    // Click → select point (raw only)
    chart.on("click", (params) => {
      if (chartAgg !== "raw") return;
      if (params.componentType === "series" && params.dataIndex != null) {
        const dp = displayRef.current[params.dataIndex as number];
        if (!dp) return;
        const pt = pointsRef.current[dp.oi];
        if (!pt) return;
        setSelectedPt({ idx: dp.oi, ts: pt.timestamp, val: pt.value });
        setEditVal(String(pt.value));
      }
    });

    // Draw mode: drag to paint values (raw only)
    let drawActive = false;
    const applyDraw = (px: number, py: number) => {
      if (chartAgg !== "raw") return;
      const pos = chart.convertFromPixel({ gridIndex: 0 }, [px, py]) as [number, number] | null;
      if (!pos) return;
      const [targetTsMs, targetV] = pos;
      const disp = displayRef.current;
      if (!disp.length) return;
      let best = 0, bestDist = Math.abs(disp[0].ts - targetTsMs);
      for (let i = 1; i < disp.length; i++) {
        const d = Math.abs(disp[i].ts - targetTsMs);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      const oi = disp[best].oi;
      const v  = Math.round(targetV * 10000) / 10000;
      pointsRef.current[oi] = { ...pointsRef.current[oi], value: v };
      disp[best] = { ...disp[best], v };
      chart.setOption({ series: [{ data: disp.map((p) => [p.ts, p.v]) }] }, false);
      setIsDirty(true);
    };
    const zr = chart.getZr();
    zr.on("mousedown", (e: { offsetX: number; offsetY: number }) => {
      if (!drawModeRef.current) return;
      drawActive = true;
      applyDraw(e.offsetX, e.offsetY);
    });
    zr.on("mousemove", (e: { offsetX: number; offsetY: number }) => {
      if (!drawModeRef.current || !drawActive) return;
      applyDraw(e.offsetX, e.offsetY);
    });
    zr.on("mouseup", () => {
      if (!drawActive) return;
      drawActive = false;
      setPoints([...pointsRef.current]);
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(chartContainerRef.current!);
    return () => {
      ro.disconnect();
      chart.off("click");
      zr.off("mousedown"); zr.off("mousemove"); zr.off("mouseup");
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, [activeTab, chartPreset, chartAgg, chartType, !!points, profile.profile_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep drawModeRef in sync with state
  useEffect(() => {
    drawModeRef.current = drawMode;
    const dom = chartInstanceRef.current?.getDom() as HTMLElement | undefined;
    if (dom) dom.style.cursor = drawMode ? "crosshair" : "default";
  }, [drawMode]);

  // Apply selected-point edit
  const applyPointEdit = () => {
    if (!selectedPt || points === null) return;
    const v = parseFloat(editVal);
    if (isNaN(v)) return;
    const updated = points.map((p, i) => i === selectedPt.idx ? { ...p, value: v } : p);
    setPoints(updated);
    pointsRef.current = updated;
    // Update display ref + chart without full reinit
    const di = displayRef.current.findIndex((d) => d.oi === selectedPt.idx);
    if (di >= 0) {
      displayRef.current[di] = { ...displayRef.current[di], v };
      chartInstanceRef.current?.setOption({
        series: [{ data: displayRef.current.map((p) => [p.ts, p.v]) }],
      });
    }
    setChartStats(adminComputeStats(displayRef.current.map((p) => p.v)));
    setIsDirty(true);
    setSelectedPt(null);
  };

  const tm = PROFILE_TYPE_META[profile.type] ?? { color: "text-slate-600", bg: "bg-slate-50", ring: "ring-slate-200", icon: "ssid_chart", label: profile.type };

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ── */}
      <div className={`flex items-start gap-3 px-5 py-4 border-b border-slate-200 shrink-0 ${tm.bg}`}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ring-1 ${tm.ring} bg-white`}>
          <span className={`material-symbols-outlined text-[18px] ${tm.color}`}>{tm.icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-slate-800 text-sm truncate">{pName || profile.profile_id}</p>
          <p className="text-[10px] font-mono text-slate-400 truncate">{profile.profile_id}</p>
        </div>
        {isDirty && (
          <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
            <span className="material-symbols-outlined text-[12px]">edit</span>
            Unsaved
          </span>
        )}
        <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full capitalize ${PROFILE_TYPE_BADGE[profile.type] ?? "bg-slate-100 text-slate-600"}`}>
          {tm.label}
        </span>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-1 px-4 py-2 border-b border-slate-100 shrink-0 bg-slate-50">
        {([
          { id: "info"  as const, label: "Info",                                          icon: "info"       },
          { id: "chart" as const, label: "Chart",                                         icon: "ssid_chart" },
          { id: "data"  as const, label: `Data (${profile.n_timesteps.toLocaleString()})`, icon: "table_rows" },
        ]).map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={[
              "flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all",
              activeTab === id ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700",
            ].join(" ")}
          >
            <span className="material-symbols-outlined text-[14px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab bodies ── */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* INFO */}
        {activeTab === "info" && (
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
            <EditText label="Name" value={pName} onChange={setPName} />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Type</label>
                <select
                  value={pType}
                  onChange={(e) => setPType(e.target.value as ProfileType)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white"
                >
                  {["capacity_factor","generation","load","weather","price"].map((t) => (
                    <option key={t} value={t}>{t.replace("_", " ")}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Resolution</label>
                <select
                  value={pResolution}
                  onChange={(e) => setPResolution(e.target.value as ProfileResolution)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white"
                >
                  {["15min","30min","hourly","daily"].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <EditText label="Location" value={pLocation} onChange={setPLocation} />
              <div>
                <label className="block text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Unit</label>
                <select
                  value={pUnit}
                  onChange={(e) => setPUnit(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white"
                >
                  {!TS_UNIT_OPTIONS.includes(pUnit) && pUnit && (
                    <option value={pUnit}>{pUnit} (current)</option>
                  )}
                  {TS_UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <EditText label="Source"  value={pSource}  onChange={setPSource}  />
              <EditText label="Carrier" value={pCarrier} onChange={setPCarrier} />
            </div>
            <EditText label="Year (reference)" value={pYear} onChange={setPYear} />
            <EditText label="Description" value={pDescription} onChange={setPDescription} multiline />
            {metaError && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <span className="material-symbols-outlined text-[15px] text-red-500">error</span>
                <p className="text-xs text-red-700 flex-1">{metaError}</p>
              </div>
            )}
            <button
              type="button"
              onClick={saveMeta}
              disabled={savingMeta}
              className="flex items-center gap-1.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700
                         px-5 py-2 rounded-xl transition-colors disabled:opacity-50 shadow-sm"
            >
              <span className={`material-symbols-outlined text-[15px] ${savingMeta ? "animate-spin" : ""}`}>
                {savingMeta ? "progress_activity" : "save"}
              </span>
              {savingMeta ? "Saving…" : "Save Parameters"}
            </button>
          </div>
        )}

        {/* CHART */}
        {activeTab === "chart" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {loadingData && (
              <div className="flex items-center justify-center flex-1 gap-2">
                <span className="material-symbols-outlined text-[24px] text-slate-300 animate-spin">autorenew</span>
                <p className="text-sm text-slate-400">Loading data…</p>
              </div>
            )}
            {dataError && !loadingData && (
              <p className="px-5 py-4 text-sm text-red-600">{dataError}</p>
            )}
            {points && !loadingData && (
              <>
                {/* ── Toolbar ── */}
                <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-100 bg-white shrink-0 flex-wrap">

                  {/* Window presets */}
                  {([{ key: "1d" as const, label: "1 day" }, { key: "1w" as const, label: "1 week" }, { key: "full" as const, label: "Full" }]).map(({ key, label }) => (
                    <button key={key} type="button"
                      onClick={() => { setChartPreset(key); setSelectedPt(null); }}
                      className={["px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap",
                        chartPreset === key ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"].join(" ")}
                    >{label}</button>
                  ))}

                  <span className="w-px h-4 bg-slate-200 mx-0.5" />

                  {/* Aggregation */}
                  {([{ key: "raw" as const, label: "Raw" }, { key: "hourly" as const, label: "Hour avg" }, { key: "daily" as const, label: "Day avg" }]).map(({ key, label }) => (
                    <button key={key} type="button"
                      onClick={() => { setChartAgg(key); setSelectedPt(null); if (key !== "raw") setDrawMode(false); }}
                      className={["px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap",
                        chartAgg === key ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"].join(" ")}
                    >{label}</button>
                  ))}

                  <span className="w-px h-4 bg-slate-200 mx-0.5" />

                  {/* Chart type */}
                  <button type="button" title="Line chart" onClick={() => setChartType("line")}
                    className={["px-2 py-1 rounded-lg transition-all", chartType === "line" ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"].join(" ")}
                  ><span className="material-symbols-outlined text-[14px] leading-none">show_chart</span></button>
                  <button type="button" title="Bar chart" onClick={() => setChartType("bar")}
                    className={["px-2 py-1 rounded-lg transition-all", chartType === "bar" ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"].join(" ")}
                  ><span className="material-symbols-outlined text-[14px] leading-none">bar_chart</span></button>

                  <span className="w-px h-4 bg-slate-200 mx-0.5" />

                  {/* Draw mode */}
                  <button type="button"
                    onClick={() => { if (chartAgg !== "raw") return; setDrawMode((d) => !d); setSelectedPt(null); }}
                    disabled={chartAgg !== "raw"}
                    title={chartAgg !== "raw" ? "Switch to Raw to enable draw mode" : "Drag to paint values"}
                    className={["flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap",
                      drawMode ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"].join(" ")}
                  >
                    <span className="material-symbols-outlined text-[13px] leading-none">brush</span>
                    {drawMode ? "Drawing…" : "Draw"}
                  </button>

                  {/* Hint text */}
                  <span className="flex-1 text-[10px] text-slate-400 hidden sm:block px-1">
                    {drawMode
                      ? "Drag to paint · mouseup commits"
                      : chartAgg === "raw"
                        ? "Click point to select & edit"
                        : "Switch to Raw to edit values"}
                  </span>

                  {/* Save */}
                  {isDirty && (
                    <button type="button" onClick={saveData} disabled={savingData}
                      className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700
                                 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                    >
                      <span className={`material-symbols-outlined text-[13px] ${savingData ? "animate-spin" : ""}`}>
                        {savingData ? "progress_activity" : "save"}
                      </span>
                      {savingData ? "Saving…" : "Save changes"}
                    </button>
                  )}
                </div>

                {/* ECharts canvas — fills remaining height */}
                <div ref={chartContainerRef} className="flex-1 min-h-0" />

                {/* Selected-point editor */}
                {selectedPt && !drawMode && (
                  <div className="border-t border-indigo-100 px-4 py-2.5 bg-indigo-50/40 flex items-center gap-3 shrink-0">
                    <span className="material-symbols-outlined text-[15px] text-indigo-400">my_location</span>
                    <p className="text-[11px] font-mono text-slate-500 truncate max-w-[200px]">{selectedPt.ts}</p>
                    <input
                      type="number" step="any" value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && applyPointEdit()}
                      className="w-28 px-2.5 py-1 text-sm border border-indigo-300 rounded-lg bg-white
                                 focus:outline-none focus:ring-2 focus:ring-indigo-300 font-mono text-right"
                    />
                    <span className="text-xs text-slate-400">{pUnit}</span>
                    <button type="button" onClick={applyPointEdit}
                      className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors"
                    >Apply</button>
                    <button type="button" onClick={() => setSelectedPt(null)}
                      className="text-slate-400 hover:text-slate-600 ml-auto"
                    ><span className="material-symbols-outlined text-[16px]">close</span></button>
                  </div>
                )}

                {/* Stats strip */}
                {chartStats && (
                  <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="grid grid-cols-4 gap-2">
                      {([
                        { label: "Min",    value: adminFmt(chartStats.min,    pUnit) },
                        { label: "Mean",   value: adminFmt(chartStats.mean,   pUnit), accent: true },
                        { label: "Max",    value: adminFmt(chartStats.max,    pUnit) },
                        { label: "Std",    value: adminFmt(chartStats.stddev, pUnit), sub: `n\u00a0=\u00a0${chartStats.n.toLocaleString()}` },
                      ] as { label: string; value: string; accent?: boolean; sub?: string }[]).map(({ label, value, accent, sub }) => (
                        <div key={label}
                          className={["rounded-lg border px-2.5 py-1.5",
                            accent ? "border-indigo-200 bg-indigo-50/60" : "border-slate-200 bg-white"].join(" ")}
                        >
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
                          <p className={["text-xs font-bold tabular-nums leading-tight",
                            accent ? "text-indigo-700" : "text-slate-700"].join(" ")}>{value}</p>
                          {sub && <p className="text-[9px] text-slate-400 font-mono">{sub}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* DATA TABLE */}
        {activeTab === "data" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {loadingData && (
              <div className="flex items-center justify-center flex-1 gap-2">
                <span className="material-symbols-outlined text-[24px] text-slate-300 animate-spin">autorenew</span>
                <p className="text-sm text-slate-400">Loading data…</p>
              </div>
            )}
            {dataError && !loadingData && (
              <p className="px-5 py-4 text-sm text-red-600">{dataError}</p>
            )}
            {points && !loadingData && (() => {
              const filterLower = tsFilter.trim().toLowerCase();
              const filteredRows = points
                .map((pt, gi) => ({ pt, gi }))
                .filter(({ pt }) => !filterLower || pt.timestamp.toLowerCase().includes(filterLower));
              const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
              const safePage = Math.min(dataPage, totalPages - 1);
              const pageRows = filteredRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
              return (
                <>
                  {/* ── Toolbar ── */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50 shrink-0 flex-wrap">
                    {/* Row count / filter badge */}
                    <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                      {filterLower
                        ? <>{filteredRows.length.toLocaleString()} <span className="text-indigo-400">match</span> / {points.length.toLocaleString()} rows</>
                        : <>{points.length.toLocaleString()} rows</>}
                    </span>

                    {/* Timestamp filter */}
                    <div className="flex items-center gap-1.5 border-l border-slate-200 pl-2 ml-1">
                      <span className="material-symbols-outlined text-[13px] text-slate-400">search</span>
                      <input
                        type="text"
                        value={tsFilter}
                        onChange={(e) => { setTsFilter(e.target.value); setDataPage(0); setActiveRow(null); }}
                        placeholder="filter timestamps…"
                        className="w-36 px-2 py-1 text-xs border border-slate-200 rounded-lg bg-white
                                   focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400
                                   placeholder:text-slate-300"
                      />
                      {tsFilter && (
                        <button
                          type="button"
                          onClick={() => { setTsFilter(""); setDataPage(0); }}
                          className="text-slate-300 hover:text-slate-600 transition-colors"
                          title="Clear filter"
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      )}
                    </div>

                    {/* Jump to row */}
                    <div className="flex items-center gap-1.5 border-l border-slate-200 pl-2">
                      <span className="text-[10px] text-slate-400 hidden sm:block">Jump:</span>
                      <input
                        type="number" min={0} max={points.length - 1}
                        value={jumpRow}
                        onChange={(e) => setJumpRow(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          const n = parseInt(jumpRow);
                          if (!isNaN(n) && n >= 0 && n < points.length) {
                            setDataPage(Math.floor(n / PAGE_SIZE));
                            setActiveRow(n);
                          }
                        }}
                        placeholder="row #"
                        className="w-20 px-2 py-1 text-xs border border-slate-200 rounded-lg bg-white
                                   focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400
                                   tabular-nums placeholder:text-slate-300"
                      />
                    </div>

                    <div className="ml-auto flex items-center gap-2">
                      {isDirty && (
                        <button
                          type="button"
                          onClick={() => {
                            setPoints(null);
                            pointsRef.current = [];
                            setIsDirty(false);
                            setEditingVal(null);
                            loadData();
                          }}
                          className="text-[11px] font-semibold text-slate-500 hover:text-slate-700
                                     px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                          Discard
                        </button>
                      )}
                      {isDirty && (
                        <button
                          type="button" onClick={saveData} disabled={savingData}
                          className="flex items-center gap-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700
                                     px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <span className={`material-symbols-outlined text-[13px] ${savingData ? "animate-spin" : ""}`}>
                            {savingData ? "progress_activity" : "save"}
                          </span>
                          {savingData ? "Saving…" : "Save data"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── Scrollable table ── */}
                  <div className="flex-1 overflow-y-auto">
                    <table className="w-full border-collapse">
                      <thead className="sticky top-0 bg-white border-b-2 border-slate-200 z-10 shadow-sm">
                        <tr>
                          <th className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider w-[52px]">#</th>
                          <th className="px-2 py-2.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">Timestamp</th>
                          <th className="px-2 py-2.5 text-right text-[10px] font-bold text-slate-400 uppercase tracking-wider w-36">Value ({pUnit})</th>
                          <th className="px-2 py-2.5 w-10" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pageRows.map(({ pt, gi }) => {
                          const isActive = activeRow === gi;
                          return (
                            <tr
                              key={gi}
                              className={isActive ? "bg-indigo-50/60" : "hover:bg-slate-50"}
                              onMouseDown={() => setActiveRow(gi)}
                            >
                              {/* Row index */}
                              <td className={`px-3 py-2.5 text-[10px] font-mono tabular-nums w-[52px] select-none
                                              ${isActive ? "text-indigo-400 font-semibold" : "text-slate-300"}`}>
                                {gi}
                              </td>

                              {/* Timestamp */}
                              <td className="px-2 py-2">
                                <input
                                  type="text"
                                  value={pt.timestamp}
                                  onFocus={() => setActiveRow(gi)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === "ArrowDown") {
                                      e.preventDefault();
                                      const next = gi + 1;
                                      if (next < points.length) {
                                        setActiveRow(next);
                                        if (next >= (dataPage + 1) * PAGE_SIZE) setDataPage((p) => p + 1);
                                      }
                                    } else if (e.key === "ArrowUp") {
                                      e.preventDefault();
                                      const prev = gi - 1;
                                      if (prev >= 0) {
                                        setActiveRow(prev);
                                        if (prev < dataPage * PAGE_SIZE) setDataPage((p) => p - 1);
                                      }
                                    }
                                  }}
                                  onChange={(e) => {
                                    const u = [...points];
                                    u[gi] = { ...u[gi], timestamp: e.target.value };
                                    setPoints(u); pointsRef.current = u; setIsDirty(true);
                                  }}
                                  className={[
                                    "w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border transition-colors",
                                    "focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400",
                                    isActive
                                      ? "border-indigo-200 bg-white text-slate-700"
                                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                                  ].join(" ")}
                                />
                              </td>

                              {/* Value */}
                              <td className="px-2 py-2 w-36">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={editingVal?.gi === gi ? editingVal.draft : String(pt.value)}
                                  onFocus={() => {
                                    setActiveRow(gi);
                                    setEditingVal({ gi, draft: String(pt.value) });
                                  }}
                                  onBlur={() => {
                                    if (editingVal?.gi === gi) {
                                      const v = parseFloat(editingVal.draft);
                                      if (!isNaN(v)) {
                                        const u = [...points];
                                        u[gi] = { ...u[gi], value: v };
                                        setPoints(u); pointsRef.current = u; setIsDirty(true);
                                      }
                                      setEditingVal(null);
                                    }
                                  }}
                                  onChange={(e) => setEditingVal({ gi, draft: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === "ArrowDown") {
                                      e.preventDefault();
                                      (e.target as HTMLInputElement).blur();
                                      const next = gi + 1;
                                      if (next < points.length) {
                                        setActiveRow(next);
                                        if (next >= (dataPage + 1) * PAGE_SIZE) setDataPage((p) => p + 1);
                                      }
                                    } else if (e.key === "ArrowUp") {
                                      e.preventDefault();
                                      (e.target as HTMLInputElement).blur();
                                      const prev = gi - 1;
                                      if (prev >= 0) {
                                        setActiveRow(prev);
                                        if (prev < dataPage * PAGE_SIZE) setDataPage((p) => p - 1);
                                      }
                                    } else if (e.key === "Escape") {
                                      setEditingVal(null);
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  className={[
                                    "w-full px-2.5 py-1.5 text-xs font-mono font-semibold rounded-lg border text-right transition-colors",
                                    "focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400",
                                    isActive
                                      ? "border-indigo-200 bg-white text-slate-800"
                                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                                  ].join(" ")}
                                />
                              </td>

                              {/* Delete */}
                              <td className="px-2 py-2 w-10">
                                <button
                                  type="button"
                                  title="Delete row"
                                  onClick={() => {
                                    const u = points.filter((_, i) => i !== gi);
                                    setPoints(u); pointsRef.current = u; setIsDirty(true);
                                    if (activeRow === gi) setActiveRow(null);
                                  }}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg
                                             text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[15px]">delete</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* ── Footer: add row + pagination ── */}
                  <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-slate-200 bg-white">
                    {/* Add row */}
                    <button
                      type="button"
                      onClick={() => {
                        const last = points[points.length - 1];
                        const u = [...points, { timestamp: last?.timestamp ?? "", value: 0 }];
                        setPoints(u); pointsRef.current = u; setIsDirty(true);
                        const newPage = Math.floor((u.length - 1) / PAGE_SIZE);
                        setDataPage(newPage);
                        setActiveRow(u.length - 1);
                      }}
                      className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800
                                 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">add</span>
                      Add row
                    </button>

                    {/* Pagination */}
                    <div className="flex items-center gap-1 ml-auto">
                      <button
                        type="button" disabled={safePage === 0}
                        onClick={() => { setDataPage((p) => p - 1); setActiveRow(null); }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg
                                   text-slate-400 hover:text-slate-700 hover:bg-slate-100
                                   disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                      </button>
                      <span className="text-[11px] text-slate-500 tabular-nums px-1 min-w-[80px] text-center">
                        p.&nbsp;{safePage + 1}&nbsp;/&nbsp;{totalPages}
                      </span>
                      <button
                        type="button" disabled={safePage + 1 >= totalPages}
                        onClick={() => { setDataPage((p) => p + 1); setActiveRow(null); }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg
                                   text-slate-400 hover:text-slate-700 hover:bg-slate-100
                                   disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── Footer: delete ── */}
      <div className="shrink-0 flex items-center gap-2 px-5 py-3 border-t border-slate-100 bg-white">
        {deleteConfirm ? (
          <>
            <p className="text-xs text-red-600 flex-1">Permanently delete this profile?</p>
            <button
              type="button" onClick={() => setDeleteConfirm(false)}
              className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >Cancel</button>
            <button
              type="button" onClick={handleDelete} disabled={deleting}
              className="flex items-center gap-1 text-xs font-bold text-white bg-red-600 hover:bg-red-700
                         px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-[13px] ${deleting ? "animate-spin" : ""}`}>
                {deleting ? "progress_activity" : "delete"}
              </span>
              {deleting ? "Deleting…" : "Confirm"}
            </button>
          </>
        ) : (
          <button
            type="button" onClick={() => setDeleteConfirm(true)}
            className="flex items-center gap-1.5 text-sm font-semibold text-red-500 hover:text-red-700
                       bg-red-50 hover:bg-red-100 px-4 py-2 rounded-xl transition-colors"
          >
            <span className="material-symbols-outlined text-[15px]">delete</span>
            Delete Profile
          </button>
        )}
      </div>
    </div>
  );
}

function CatalogueProfilesTab({ token }: { token: string }) {
  const [profiles,  setProfiles]  = useState<TimeSeriesProfile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading,   startLoad]    = useTransition();
  const [selected,  setSelected]  = useState<TimeSeriesProfile | null>(null);
  const [search,    setSearch]    = useState("");
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());

  const BASE_URL =
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
    "http://localhost:8000/api/v1";

  const load = useCallback(() => {
    startLoad(async () => {
      setLoadError(null);
      try {
        const res = await fetch(`${BASE_URL}/timeseries?limit=500`, {
          headers: {
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

  const toggleType = (t: string) =>
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) { next.delete(t); } else { next.add(t); }
      return next;
    });

  const filtered = (profiles ?? []).filter((p) => {
    if (search === "") return true;
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.profile_id.toLowerCase().includes(q) ||
      p.location.toLowerCase().includes(q) ||
      (p.carrier ?? "").toLowerCase().includes(q)
    );
  });

  const grouped = filtered.reduce<Record<string, TimeSeriesProfile[]>>((acc, p) => {
    (acc[p.type] ??= []).push(p);
    return acc;
  }, {});

  const handleDeleted = () => {
    if (!selected) return;
    const deletedId = selected.profile_id;
    setProfiles((prev) => prev ? prev.filter((p) => p.profile_id !== deletedId) : prev);
    setSelected(null);
  };

  const handleUpdated = (updated: TimeSeriesProfile) => {
    setProfiles((prev) => prev ? prev.map((p) => p.profile_id === updated.profile_id ? updated : p) : prev);
    setSelected(updated);
  };

  return (
    <>
      {loadError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-3">
          <span className="material-symbols-outlined text-red-500">error</span>
          <p className="text-sm text-red-700">{loadError}</p>
        </div>
      )}

      {/* Two-panel split layout */}
      <div
        className="flex border border-slate-200 rounded-2xl overflow-hidden shadow-sm"
        style={{ height: "calc(100vh - 230px)", minHeight: "540px" }}
      >
        {/* LEFT: compact navigable profile list grouped by type */}
        <div className="w-[320px] shrink-0 flex flex-col border-r border-slate-200 bg-white">

          {/* Search */}
          <div className="p-3 border-b border-slate-100">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2.5 top-2 text-[15px] text-slate-400">search</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search profiles…"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-slate-50
                           focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white"
              />
            </div>
          </div>

          {/* Type-grouped list */}
          <div className="flex-1 overflow-y-auto">
            {loading && !profiles && (
              <div className="flex items-center justify-center py-10 gap-2">
                <span className="material-symbols-outlined text-[18px] text-slate-300 animate-spin">autorenew</span>
                <p className="text-xs text-slate-400">Loading…</p>
              </div>
            )}
            {profiles && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <span className="material-symbols-outlined text-[28px] text-slate-200">search_off</span>
                <p className="text-xs text-slate-400">{search ? "No matches" : "No profiles yet"}</p>
              </div>
            )}
            {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([type, items]) => {
              const tm = PROFILE_TYPE_META[type] ?? { color: "text-slate-600", bg: "bg-slate-50", ring: "", icon: "ssid_chart", label: type };
              const collapsed = collapsedTypes.has(type);
              return (
                <div key={type}>
                  {/* Type header */}
                  <button
                    type="button"
                    onClick={() => toggleType(type)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100
                               border-b border-slate-100 transition-colors"
                  >
                    <span className={`material-symbols-outlined text-[14px] ${tm.color}`}>{tm.icon}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-widest flex-1 text-left ${tm.color}`}>
                      {tm.label}
                    </span>
                    <span className="text-[10px] text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full font-semibold">
                      {items.length}
                    </span>
                    <span className={`material-symbols-outlined text-[14px] text-slate-400 transition-transform duration-150 ${collapsed ? "rotate-180" : ""}`}>
                      expand_less
                    </span>
                  </button>

                  {/* Profile rows */}
                  {!collapsed && items.map((p) => {
                    const isSelected = selected?.profile_id === p.profile_id;
                    return (
                      <button
                        key={p.profile_id}
                        type="button"
                        onClick={() => setSelected(p)}
                        className={[
                          "w-full flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 text-left transition-colors",
                          isSelected
                            ? "bg-indigo-50 border-l-2 border-l-indigo-500"
                            : "hover:bg-slate-50 border-l-2 border-l-transparent",
                        ].join(" ")}
                      >
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs font-semibold truncate leading-snug ${isSelected ? "text-indigo-700" : "text-slate-700"}`}>
                            {p.name}
                          </p>
                          <p className="text-[9px] font-mono text-slate-300 truncate">{p.location} · {p.resolution}</p>
                        </div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 tabular-nums
                          ${isSelected ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-400"}`}>
                          {p.n_timesteps >= 1000 ? `${(p.n_timesteps / 1000).toFixed(0)}k` : p.n_timesteps}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* List footer */}
          <div className="shrink-0 flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-slate-50">
            <p className="text-[10px] text-slate-400">
              {filtered.length}{profiles && filtered.length !== profiles.length ? ` / ${profiles.length}` : ""} profiles
            </p>
            <button
              type="button"
              disabled={loading}
              onClick={load}
              title="Refresh profiles"
              className="text-slate-400 hover:text-indigo-600 transition-colors"
            >
              <span className={`material-symbols-outlined text-[15px] ${loading ? "animate-spin" : ""}`}>refresh</span>
            </button>
          </div>
        </div>

        {/* RIGHT: detail panel */}
        <div className="flex-1 overflow-hidden flex flex-col bg-white">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
              <span className="material-symbols-outlined text-[48px] text-slate-200">arrow_back</span>
              <p className="text-sm font-semibold text-slate-400">Select a profile</p>
              <p className="text-xs text-slate-300">Choose any entry from the list on the left to view its details.</p>
            </div>
          ) : (
            <ProfileDetailPanel
              key={selected.profile_id}
              profile={selected}
              token={token}
              onDeleted={handleDeleted}
              onUpdated={handleUpdated}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ── Catalogue management tab ──────────────────────────────────────────────────

type CatalogueSubTab = "technologies" | "profiles";

const DOMAIN_META: Record<string, { color: string; bg: string; ring: string; icon: string }> = {
  generation:   { color: "text-amber-700",   bg: "bg-amber-50",   ring: "ring-amber-200",   icon: "bolt"         },
  storage:      { color: "text-blue-700",    bg: "bg-blue-50",    ring: "ring-blue-200",    icon: "battery_5_bar" },
  conversion:   { color: "text-emerald-700", bg: "bg-emerald-50", ring: "ring-emerald-200", icon: "recycling"    },
  transmission: { color: "text-purple-700",  bg: "bg-purple-50",  ring: "ring-purple-200",  icon: "cable"        },
};

const DOMAIN_BADGE: Record<string, string> = {
  generation:   "bg-amber-100 text-amber-800",
  storage:      "bg-blue-100 text-blue-800",
  conversion:   "bg-emerald-100 text-emerald-800",
  transmission: "bg-purple-100 text-purple-800",
};

/** Inline editor rendered in the right panel — no overlay or backdrop. */
function TechInlineEditor({
  tech,
  token,
  onSave,
  onDeleted,
}: {
  tech: CatalogueTechEntry;
  token: string;
  onSave: (updated: CatalogueTechEntry) => void;
  onDeleted: () => void;
}) {
  const [name,          setName]          = useState(tech.technology_name);
  const [carrier,       setCarrier]       = useState(tech.carrier);
  const [oeoClass,      setOeoClass]      = useState(tech.oeo_class);
  const [description,   setDescription]   = useState(tech.description);
  const [instances,     setInstances]     = useState<Record<string, unknown>[]>(
    tech.instances.map((i) => ({ ...i }))
  );
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [activeSection, setActiveSection] = useState<"metadata" | "variants">("metadata");

  // Reset when switching to a different technology
  useEffect(() => {
    setName(tech.technology_name);
    setCarrier(tech.carrier);
    setOeoClass(tech.oeo_class);
    setDescription(tech.description);
    setInstances(tech.instances.map((i) => ({ ...i })));
    setError(null);
    setDeleteConfirm(false);
    setActiveSection("metadata");
  }, [tech.technology_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateInst = (idx: number, field: string, value: unknown) =>
    setInstances((prev) => prev.map((inst, i) => i === idx ? { ...inst, [field]: value } : inst));
  const removeInst = (idx: number) =>
    setInstances((prev) => prev.filter((_, i) => i !== idx));
  const addInst = () =>
    setInstances((prev) => [...prev, blankInstance()]);

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
      onSave({ ...tech, technology_name: name, carrier, oeo_class: oeoClass, description, instances });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await adminDeleteTechnology(token, tech.technology_id);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  };

  const dm = DOMAIN_META[tech.domain] ?? { color: "text-slate-600", bg: "bg-slate-50", ring: "ring-slate-200", icon: "memory" };

  return (
    <div className="flex flex-col h-full">

      {/* Editor header */}
      <div className={`flex items-start gap-3 px-5 py-4 border-b border-slate-200 shrink-0 ${dm.bg}`}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ring-1 ${dm.ring} bg-white`}>
          <span className={`material-symbols-outlined text-[18px] ${dm.color}`}>{dm.icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-slate-800 text-sm truncate">{name || tech.technology_id}</p>
          <p className="text-[10px] font-mono text-slate-400 truncate">{tech.technology_id}</p>
        </div>
        <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full capitalize ${DOMAIN_BADGE[tech.domain] ?? "bg-slate-100 text-slate-600"}`}>
          {tech.domain}
        </span>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-slate-100 shrink-0 bg-slate-50">
        {([
          { id: "metadata" as const, label: "Metadata",                       icon: "info" },
          { id: "variants" as const, label: `Variants (${instances.length})`, icon: "tune" },
        ]).map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveSection(id)}
            className={[
              "flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all",
              activeSection === id ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700",
            ].join(" ")}
          >
            <span className="material-symbols-outlined text-[14px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* Scrollable form body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

        {activeSection === "metadata" && (
          <div className="space-y-4">
            <EditText label="Technology Name" value={name} onChange={setName} />
            <div className="grid grid-cols-2 gap-4">
              <EditText label="Carrier / Fuel" value={carrier} onChange={setCarrier} />
              <EditText label="OEO Class URI"  value={oeoClass} onChange={setOeoClass} mono />
            </div>
            <EditText label="Description" value={description} onChange={setDescription} multiline />
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="flex items-center gap-1 text-[11px] bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full">
                <span className="material-symbols-outlined text-[12px]">category</span>
                {tech.domain}
              </span>
              <span className="flex items-center gap-1 text-[11px] bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full">
                <span className="material-symbols-outlined text-[12px]">stacks</span>
                {instances.length} variant{instances.length !== 1 ? "s" : ""}
              </span>
              {tech.source && (
                <span className="flex items-center gap-1 text-[11px] bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full">
                  <span className="material-symbols-outlined text-[12px]">source</span>
                  {tech.source}
                </span>
              )}
            </div>
          </div>
        )}

        {activeSection === "variants" && (
          <div className="space-y-4">
            {instances.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 py-12 flex flex-col items-center gap-3 text-center">
                <span className="material-symbols-outlined text-[36px] text-slate-300">tune</span>
                <p className="text-sm text-slate-400">No technical variants yet.</p>
                <button
                  type="button"
                  onClick={addInst}
                  className="flex items-center gap-1.5 text-sm font-semibold text-indigo-600
                             bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded-xl transition-colors"
                >
                  <span className="material-symbols-outlined text-[15px]">add_circle</span>
                  Add first variant
                </button>
              </div>
            )}
            {instances.map((inst, i) => (
              <InstanceEditor
                key={String(inst.instance_id ?? i)}
                inst={inst}
                idx={i}
                onUpdate={updateInst}
                onRemove={removeInst}
              />
            ))}
            {instances.length > 0 && (
              <button
                type="button"
                onClick={addInst}
                className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-indigo-600
                           border-2 border-dashed border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50
                           rounded-2xl py-3 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">add_circle</span>
                Add variant
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <span className="material-symbols-outlined text-[15px] text-red-500">error</span>
            <p className="text-xs text-red-700 flex-1">{error}</p>
          </div>
        )}
      </div>

      {/* Sticky action footer */}
      <div className="shrink-0 flex items-center gap-2 px-5 py-3 border-t border-slate-100 bg-white">
        {deleteConfirm ? (
          <>
            <p className="text-xs text-red-600 flex-1">Permanently delete this technology?</p>
            <button
              type="button"
              onClick={() => setDeleteConfirm(false)}
              className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1 text-xs font-bold text-white bg-red-600 hover:bg-red-700
                         px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-[13px] ${deleting ? "animate-spin" : ""}`}>
                {deleting ? "progress_activity" : "delete"}
              </span>
              {deleting ? "Deleting…" : "Confirm"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 px-3 py-1.5
                         rounded-lg hover:bg-red-50 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">delete</span>
              Delete
            </button>
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={() => {
                  setName(tech.technology_name);
                  setCarrier(tech.carrier);
                  setOeoClass(tech.oeo_class);
                  setDescription(tech.description);
                  setInstances(tech.instances.map((i) => ({ ...i })));
                  setError(null);
                }}
                className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2 rounded-xl hover:bg-slate-100 transition-colors"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700
                           px-5 py-2 rounded-xl transition-colors disabled:opacity-50 shadow-sm"
              >
                <span className={`material-symbols-outlined text-[15px] ${saving ? "animate-spin" : ""}`}>
                  {saving ? "progress_activity" : "save"}
                </span>
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CatalogueManager({ token }: { token: string }) {
  const [subTab,            setSubTab]            = useState<CatalogueSubTab>("technologies");
  const [techs,             setTechs]             = useState<CatalogueTechEntry[] | null>(null);
  const [loadError,         setLoadError]         = useState<string | null>(null);
  const [loading,           startLoad]            = useTransition();
  const [selected,          setSelected]          = useState<CatalogueTechEntry | null>(null);
  const [search,            setSearch]            = useState("");
  const [collapsedDomains,  setCollapsedDomains]  = useState<Set<string>>(new Set());

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

  const toggleDomain = (d: string) =>
    setCollapsedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(d)) { next.delete(d); } else { next.add(d); }
      return next;
    });

  const filtered = (techs ?? []).filter((t) => {
    if (search === "") return true;
    const q = search.toLowerCase();
    return (
      t.technology_name.toLowerCase().includes(q) ||
      t.technology_id.toLowerCase().includes(q) ||
      t.carrier.toLowerCase().includes(q)
    );
  });

  const grouped = filtered.reduce<Record<string, CatalogueTechEntry[]>>((acc, t) => {
    (acc[t.domain] ??= []).push(t);
    return acc;
  }, {});

  const handleSaved = (updated: CatalogueTechEntry) => {
    setTechs((prev) => prev ? prev.map((t) => t.technology_id === updated.technology_id ? updated : t) : prev);
    setSelected(updated);
  };

  const handleDeleted = () => {
    if (!selected) return;
    const deletedId = selected.technology_id;
    setTechs((prev) => prev ? prev.filter((t) => t.technology_id !== deletedId) : prev);
    setSelected(null);
  };

  return (
    <div className="space-y-5">

      {/* Sub-tab switcher */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {([
          { id: "technologies" as CatalogueSubTab, label: "Technologies",         icon: "bolt"       },
          { id: "profiles"     as CatalogueSubTab, label: "Time-Series Profiles", icon: "ssid_chart" },
        ] as { id: CatalogueSubTab; label: string; icon: string }[]).map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={[
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
              subTab === id ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700",
            ].join(" ")}
          >
            <span className="material-symbols-outlined text-[15px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {subTab === "profiles" && <CatalogueProfilesTab token={token} />}

      {subTab === "technologies" && (
        <>
          {loadError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <span className="material-symbols-outlined text-red-500">error</span>
              <p className="text-sm text-red-700">{loadError}</p>
            </div>
          )}

          {/* ── Two-panel split layout ── */}
          <div
            className="flex border border-slate-200 rounded-2xl overflow-hidden shadow-sm"
            style={{ height: "calc(100vh - 230px)", minHeight: "540px" }}
          >
            {/* LEFT: compact navigable tech list */}
            <div className="w-[320px] shrink-0 flex flex-col border-r border-slate-200 bg-white">

              {/* Search input */}
              <div className="p-3 border-b border-slate-100">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-2.5 top-2 text-[15px] text-slate-400">search</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search…"
                    className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-slate-50
                               focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white"
                  />
                </div>
              </div>

              {/* Domain-grouped tech list */}
              <div className="flex-1 overflow-y-auto">
                {loading && !techs && (
                  <div className="flex items-center justify-center py-10 gap-2">
                    <span className="material-symbols-outlined text-[18px] text-slate-300 animate-spin">autorenew</span>
                    <p className="text-xs text-slate-400">Loading…</p>
                  </div>
                )}
                {techs && filtered.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <span className="material-symbols-outlined text-[28px] text-slate-200">search_off</span>
                    <p className="text-xs text-slate-400">{search ? "No matches" : "Empty catalogue"}</p>
                  </div>
                )}
                {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([domain, items]) => {
                  const dm = DOMAIN_META[domain] ?? { color: "text-slate-600", bg: "bg-slate-50", ring: "", icon: "memory" };
                  const collapsed = collapsedDomains.has(domain);
                  return (
                    <div key={domain}>
                      {/* Domain header row — click to collapse/expand */}
                      <button
                        type="button"
                        onClick={() => toggleDomain(domain)}
                        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100
                                   border-b border-slate-100 transition-colors"
                      >
                        <span className={`material-symbols-outlined text-[14px] ${dm.color}`}>{dm.icon}</span>
                        <span className={`text-[10px] font-bold uppercase tracking-widest capitalize flex-1 text-left ${dm.color}`}>
                          {domain}
                        </span>
                        <span className="text-[10px] text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full font-semibold">
                          {items.length}
                        </span>
                        <span className={`material-symbols-outlined text-[14px] text-slate-400 transition-transform duration-150 ${collapsed ? "rotate-180" : ""}`}>
                          expand_less
                        </span>
                      </button>

                      {/* Tech rows */}
                      {!collapsed && items.map((tech) => {
                        const isSelected = selected?.technology_id === tech.technology_id;
                        return (
                          <button
                            key={tech.technology_id}
                            type="button"
                            onClick={() => setSelected(tech)}
                            className={[
                              "w-full flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 text-left transition-colors",
                              isSelected
                                ? "bg-indigo-50 border-l-2 border-l-indigo-500"
                                : "hover:bg-slate-50 border-l-2 border-l-transparent",
                            ].join(" ")}
                          >
                            <div className="min-w-0 flex-1">
                              <p className={`text-xs font-semibold truncate leading-snug ${isSelected ? "text-indigo-700" : "text-slate-700"}`}>
                                {tech.technology_name}
                              </p>
                              <p className="text-[9px] font-mono text-slate-300 truncate">{tech.technology_id}</p>
                            </div>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 tabular-nums
                              ${isSelected ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-400"}`}>
                              {tech.instances.length}v
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {/* List footer */}
              <div className="shrink-0 flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-slate-50">
                <p className="text-[10px] text-slate-400">
                  {filtered.length}{techs && filtered.length !== techs.length ? ` / ${techs.length}` : ""} techs
                </p>
                <button
                  type="button"
                  disabled={loading}
                  onClick={load}
                  title="Refresh catalogue"
                  className="text-slate-400 hover:text-indigo-600 transition-colors"
                >
                  <span className={`material-symbols-outlined text-[15px] ${loading ? "animate-spin" : ""}`}>refresh</span>
                </button>
              </div>
            </div>

            {/* RIGHT: inline editor */}
            <div className="flex-1 overflow-hidden flex flex-col bg-white">
              {!selected ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                  <span className="material-symbols-outlined text-[48px] text-slate-200">arrow_back</span>
                  <p className="text-sm font-semibold text-slate-400">Select a technology</p>
                  <p className="text-xs text-slate-300">Choose any entry from the list on the left to view and edit its details.</p>
                </div>
              ) : (
                <TechInlineEditor
                  key={selected.technology_id}
                  tech={selected}
                  token={token}
                  onSave={handleSaved}
                  onDeleted={handleDeleted}
                />
              )}
            </div>
          </div>
        </>
      )}
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
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4 flex items-center gap-4 hover:shadow-md transition-shadow">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-inner ${color}`}>
        <span className="material-symbols-outlined text-[21px] text-white">{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-slate-800 tabular-nums leading-none">{value}</p>
        <p className="text-xs text-slate-400 mt-1 leading-snug">{label}</p>
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
type PanelTab  = "submissions" | "catalogue" | "profiles" | "scraper";

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
    (id: string, action: "approve" | "reject", prUrl?: string) => {
      setSubmissions((prev) =>
        prev
          ? prev.map((s) =>
              s.submission_id === id
                ? {
                    ...s,
                    status: (action === "approve" ? "approved" : "rejected") as SubmissionRecord["status"],
                    pr_url: prUrl ?? s.pr_url ?? null,
                  }
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
    <div className="w-full">
      {/* ── Header strip ── */}
      <div className="px-8 pt-8 pb-0 border-b border-slate-200/80">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-sm shrink-0">
              <span className="material-symbols-outlined text-[20px] text-white">admin_panel_settings</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight leading-none">Admin Panel</h1>
              <p className="text-slate-400 text-xs mt-1 leading-none">
                Manage submissions and edit the live technology catalogue.
              </p>
            </div>
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

        {/* ── Top-level nav tabs ── */}
        <div className="flex gap-0.5">
          {([
            { id: "submissions" as PanelTab, label: "Submissions",         icon: "inbox"          },
            { id: "profiles"   as PanelTab, label: "Profile Submissions",  icon: "ssid_chart"     },
            { id: "catalogue"  as PanelTab, label: "Catalogue",            icon: "database"       },
            { id: "scraper"    as PanelTab, label: "Scraper Pipeline",     icon: "travel_explore" },
          ]).map(({ id, label, icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPanelTab(id)}
              className={[
                "flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-t-lg transition-all border-b-2 -mb-px",
                panelTab === id
                  ? "text-indigo-700 border-indigo-500 bg-white shadow-[0_-1px_3px_0_rgb(0,0,0,0.04)]"
                  : "text-slate-400 border-transparent hover:text-slate-600 hover:border-slate-300 hover:bg-slate-50/80",
              ].join(" ")}
            >
              <span className={`material-symbols-outlined text-[15px] ${panelTab === id ? "text-indigo-500" : ""}`}>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="px-8 py-7 space-y-6">

      {/* ── Catalogue management panel ── */}
      {panelTab === "catalogue" && token && (
        <CatalogueManager token={token} />
      )}

      {/* ── Scraper pipeline panel ── */}
      {panelTab === "scraper" && token && (
        <ScraperPanel token={token} />
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
      </>
      )}
      </div>
    </div>
  );
}

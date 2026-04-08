/**
 * components/contributor/AddTechnology.tsx
 * ─────────────────────────────────────────
 * Full multi-section form for adding a new energy technology to opentech-db.
 *
 * React 19 patterns used
 * ──────────────────────
 * • `use(schemaPromise)` — suspends rendering until the OntologySchema resolves,
 *   guaranteeing that dropdowns are never empty when the form mounts.
 * • `useActionState` — manages the async POST submission lifecycle; the action
 *   function re-validates with Zod before reaching the network, providing a
 *   server-side guard even if client-side JS was bypassed.
 * • `useFormStatus` (in `<SubmitButton>`) — tracks the pending state of the
 *   parent `<form action={...}>` automatically.
 * • `startTransition` — wraps optimistic UI state resets without blocking the
 *   pending action.
 *
 * Validation strategy
 * ───────────────────
 * 1. Client intercept: `onSubmit` runs `createTechnologySchema(ontology).safeParse()`
 *    on the controlled state. If it fails, errors are stored locally and the
 *    form action is NOT triggered (via `e.preventDefault()`).
 * 2. If client validation passes, the typed payload is JSON-serialised into
 *    the hidden `_payload` input so the FormData-based action receives it.
 * 3. The `formAction` (from `useActionState`) re-validates the JSON payload
 *    before calling the API, guarding against browser dev-tool tampering.
 */

import { use, useActionState, useState, useRef, startTransition } from "react";
import { useFormStatus } from "react-dom";
import type { OntologySchema } from "../../types/api";
import { submitTechnology } from "../../services/api";
import {
  createTechnologySchema,
  getFieldError,
} from "../../schemas/technology";
import type { InstanceFormValues } from "./InstanceSubForm";
import SelectField from "./SelectField";
import InstanceSubForm from "./InstanceSubForm";
import type { z } from "zod";

// ── Types ────────────────────────────────────────────────────────────────────

interface ParentFormValues {
  technology_name: string;
  domain: string;
  carrier: string;
  oeo_class: string;
  description: string;
}

type SubmissionState =
  | { status: "idle" }
  | { status: "success"; technologyName: string }
  | { status: "error"; message: string };

// ── Default factories ─────────────────────────────────────────────────────────

function defaultParent(): ParentFormValues {
  return {
    technology_name: "",
    domain: "",
    carrier: "",
    oeo_class: "",
    description: "",
  };
}

let instanceCounter = 0;
function defaultInstance(): InstanceFormValues {
  return {
    _id: `inst-${++instanceCounter}`,
    variant_name: "",
    capacity_mw: "",
    capex_usd_per_kw: "",
    opex_fixed_usd_per_kw_yr: "",
    opex_var_usd_per_mwh: "",
    efficiency_percent: "",
    lifetime_years: "",
    co2_emission_factor_operational_g_per_kwh: "",
    reference_source: "",
  };
}

// ── Submit button (uses useFormStatus) ───────────────────────────────────────

function SubmitButton({ instanceCount }: { instanceCount: number }) {
  // useFormStatus reads the pending state of the nearest parent <form action>
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={[
        "inline-flex items-center gap-2.5 rounded-xl px-8 py-3.5",
        "text-sm font-bold text-on-primary transition-all duration-200",
        pending
          ? "bg-primary/60 cursor-not-allowed"
          : "bg-primary hover:bg-primary-container shadow-sm hover:shadow-md active:scale-[0.98]",
      ].join(" ")}
      aria-busy={pending}
    >
      {pending ? (
        <>
          <span className="material-symbols-outlined text-lg animate-spin">
            progress_activity
          </span>
          Submitting…
        </>
      ) : (
        <>
          <span className="material-symbols-outlined text-lg">add_circle</span>
          Add Technology
          {instanceCount > 1 && (
            <span className="opacity-70 font-normal">
              ({instanceCount} instances)
            </span>
          )}
        </>
      )}
    </button>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────

function SectionHeading({
  step,
  title,
  subtitle,
}: {
  step: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-4 pb-4 border-b border-outline-variant/15 mb-6">
      <span
        className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary
                   text-sm font-bold flex items-center justify-center"
      >
        {step}
      </span>
      <div>
        <h2 className="text-base font-bold text-on-surface">{title}</h2>
        <p className="text-sm text-on-surface-variant mt-0.5 leading-relaxed">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

// ── Text input helper ────────────────────────────────────────────────────────

function TextInput({
  id,
  label,
  value,
  onChange,
  error,
  placeholder,
  required,
  hint,
  multiline,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  multiline?: boolean;
}) {
  const hasError = Boolean(error);
  const sharedClass = [
    "w-full rounded-lg border bg-surface-container-lowest px-3 py-2.5",
    "text-sm text-on-surface placeholder:text-on-surface-variant/40",
    "focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary",
    "transition-colors duration-150",
    hasError
      ? "border-tertiary ring-1 ring-tertiary/30"
      : "border-outline-variant/40 hover:border-outline-variant",
  ].join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-on-surface">
        {label}
        {required && (
          <span className="ml-0.5 text-tertiary" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {multiline ? (
        <textarea
          id={id}
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={hasError}
          aria-describedby={hasError ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={`${sharedClass} resize-y min-h-[100px]`}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={hasError}
          aria-describedby={hasError ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={sharedClass}
        />
      )}
      {hasError ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="flex items-center gap-1 text-xs text-tertiary font-medium"
        >
          <span className="material-symbols-outlined text-[13px]">error</span>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-on-surface-variant/70">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ── OEO tooltip texts ─────────────────────────────────────────────────────────

const OEO_TOOLTIPS = {
  domain:
    "The high-level energy system domain this technology belongs to, as defined " +
    "in the Open Energy Ontology (OEO). Examples: 'electricity', 'heat', " +
    "'mobility'. This maps to oeo:EnergySystemComponent subclasses.",
  carrier:
    "The primary energy carrier input or output for this technology, drawn from " +
    "the OEO carrier taxonomy. Determines how the technology is connected in " +
    "an energy system graph (PyPSA buses / Calliope carriers).",
  oeo_class:
    "The canonical OEO class URI for this technology (e.g. " +
    "'oeo:WindTurbine', 'oeo:PhotovoltaicPlant'). This is the primary semantic " +
    "anchor that links the technology to the Open Energy Ontology knowledge graph.",
} as const;

// ── The form action (React 19 useActionState action) ─────────────────────────

async function submitAction(
  _prevState: SubmissionState,
  formData: FormData
): Promise<SubmissionState> {
  const raw = formData.get("_payload");
  if (typeof raw !== "string" || raw === "") {
    return { status: "error", message: "Submission payload was missing. Please try again." };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return { status: "error", message: "Malformed submission payload." };
  }

  try {
    const result = await submitTechnology(
      payload as Parameters<typeof submitTechnology>[0]
    );
    return { status: "success", technologyName: result.technology_name };
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while contacting the server.",
    };
  }
}

// ── Main component ────────────────────────────────────────────────────────────

interface AddTechnologyProps {
  /** Stable promise created by ContributorWorkspace; resolved via use(). */
  schemaPromise: Promise<OntologySchema>;
  /** Called after a successful submission to allow the parent to react. */
  onSuccess?: (technologyName: string) => void;
}

export default function AddTechnology({
  schemaPromise,
  onSuccess,
}: AddTechnologyProps) {
  // ── React 19: use() suspends until the OntologySchema Promise resolves.
  // The <Suspense> boundary in ContributorWorkspace shows a skeleton instead.
  const ontology = use(schemaPromise);

  // ── Form state (controlled) ──────────────────────────────────────────────
  const [parent, setParent] = useState<ParentFormValues>(defaultParent);
  const [instances, setInstances] = useState<InstanceFormValues[]>([
    defaultInstance(),
  ]);
  const [zodIssues, setZodIssues] = useState<z.ZodIssue[]>([]);

  // Hidden input ref — carries JSON-serialised payload to the FormData action
  const payloadRef = useRef<HTMLInputElement>(null);

  // ── React 19: useActionState manages async submission state ──────────────
  const [actionState, formAction] = useActionState<SubmissionState, FormData>(
    submitAction,
    { status: "idle" }
  );

  // ── Instance management ──────────────────────────────────────────────────
  const addInstance = () =>
    setInstances((prev) => [...prev, defaultInstance()]);

  const removeInstance = (index: number) => {
    if (instances.length <= 1) return;
    setInstances((prev) => prev.filter((_, i) => i !== index));
  };

  const updateInstance = (
    index: number,
    field: keyof InstanceFormValues,
    value: string
  ) =>
    setInstances((prev) =>
      prev.map((inst, i) => (i === index ? { ...inst, [field]: value } : inst))
    );

  // ── Client-side validation intercept ────────────────────────────────────
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // Build the typed payload from controlled state.
    // Numeric strings are converted to numbers here; Zod validates the results.
    const payload = {
      technology_name: parent.technology_name.trim(),
      domain: parent.domain,
      carrier: parent.carrier,
      oeo_class: parent.oeo_class,
      description: parent.description.trim(),
      instances: instances.map((inst) => ({
        variant_name: inst.variant_name.trim(),
        capacity_mw: parseFloat(inst.capacity_mw),
        capex_usd_per_kw: parseFloat(inst.capex_usd_per_kw),
        opex_fixed_usd_per_kw_yr: parseFloat(inst.opex_fixed_usd_per_kw_yr),
        opex_var_usd_per_mwh: parseFloat(inst.opex_var_usd_per_mwh),
        efficiency_percent: parseFloat(inst.efficiency_percent),
        lifetime_years: parseInt(inst.lifetime_years, 10),
        co2_emission_factor_operational_g_per_kwh: parseFloat(
          inst.co2_emission_factor_operational_g_per_kwh
        ),
        reference_source: inst.reference_source,
      })),
    };

    const schema = createTechnologySchema(ontology);
    const result = schema.safeParse(payload);

    if (!result.success) {
      // Surface errors locally; prevent the FormData action from running.
      e.preventDefault();
      setZodIssues(result.error.issues);
      // Scroll to first error
      const firstErrorEl = (e.currentTarget as HTMLFormElement).querySelector(
        "[aria-invalid='true']"
      );
      firstErrorEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // Validation passed — serialise payload into the hidden input so the
    // FormData-based action can deserialise it.
    setZodIssues([]);
    if (payloadRef.current) {
      payloadRef.current.value = JSON.stringify(result.data);
    }
    // The form's native action (formAction) will fire after this returns.
  };

  // ── Success state — call parent callback via startTransition ────────────
  if (actionState.status === "success") {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <span className="material-symbols-outlined text-4xl text-primary">
            check_circle
          </span>
        </div>
        <div>
          <h2 className="font-headline text-2xl font-bold text-on-surface">
            Technology Submitted!
          </h2>
          <p className="text-on-surface-variant mt-2 max-w-sm leading-relaxed">
            <strong className="text-on-surface">{actionState.technologyName}</strong>{" "}
            has been added to the review queue and will appear in the catalogue
            once approved by a data steward.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            startTransition(() => {
              setParent(defaultParent());
              setInstances([defaultInstance()]);
              setZodIssues([]);
              onSuccess?.(actionState.technologyName);
            });
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-6 py-3
                     text-sm font-bold text-primary hover:bg-primary/20 transition-colors"
        >
          <span className="material-symbols-outlined text-lg">add</span>
          Add another technology
        </button>
      </div>
    );
  }

  // ── Parent field error helper ────────────────────────────────────────────
  const pe = (field: string) => getFieldError(zodIssues, field);

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate>
      {/* Hidden payload carrier */}
      <input ref={payloadRef} type="hidden" name="_payload" />

      <div className="space-y-10">
        {/* ── API error banner ──────────────────────────────────────────── */}
        {actionState.status === "error" && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl bg-tertiary-container/40
                       border border-tertiary/20 px-5 py-4"
          >
            <span className="material-symbols-outlined text-xl text-tertiary flex-shrink-0 mt-0.5">
              error
            </span>
            <div>
              <p className="text-sm font-bold text-tertiary">Submission failed</p>
              <p className="text-sm text-on-tertiary-container mt-0.5">
                {actionState.message}
              </p>
            </div>
          </div>
        )}

        {/* ── Validation summary (top-level Zod issues) ─────────────────── */}
        {zodIssues.length > 0 && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl bg-tertiary-container/30
                       border border-tertiary/20 px-5 py-4"
          >
            <span className="material-symbols-outlined text-xl text-tertiary flex-shrink-0 mt-0.5">
              warning
            </span>
            <div>
              <p className="text-sm font-bold text-tertiary">
                Please fix {zodIssues.length} validation error
                {zodIssues.length !== 1 ? "s" : ""} before submitting
              </p>
              <p className="text-xs text-on-surface-variant mt-1">
                Fields with errors are highlighted below. All ontology-controlled
                fields must come from the approved dropdown lists.
              </p>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            SECTION 1 — PARENT TECHNOLOGY
        ════════════════════════════════════════════════════════════════ */}
        <section
          aria-labelledby="section-parent"
          className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-7"
        >
          <SectionHeading
            step="1"
            title="Parent Technology"
            subtitle="Define the canonical identity of the technology. Ontology-controlled fields are locked to approved values to ensure OEO alignment."
          />

          <div className="space-y-5">
            {/* Technology name */}
            <TextInput
              id="tech-name"
              label="Technology Name"
              value={parent.technology_name}
              onChange={(v) =>
                setParent((p) => ({ ...p, technology_name: v }))
              }
              error={pe("technology_name")}
              placeholder='e.g. "Onshore Wind Turbine" or "Proton Exchange Membrane Electrolyser"'
              required
              hint="Use the canonical English name as it appears in the OEO or major literature"
            />

            {/* OEO-controlled selects — 2-up grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              <SelectField
                id="tech-domain"
                name="tech-domain"
                label="Domain"
                options={ontology.allowed_domains}
                value={parent.domain}
                onChange={(v) => setParent((p) => ({ ...p, domain: v }))}
                error={pe("domain")}
                required
                oeoTooltip={OEO_TOOLTIPS.domain}
                hint="The high-level sector or system domain"
              />

              <SelectField
                id="tech-carrier"
                name="tech-carrier"
                label="Energy Carrier"
                options={ontology.allowed_carriers}
                value={parent.carrier}
                onChange={(v) => setParent((p) => ({ ...p, carrier: v }))}
                error={pe("carrier")}
                required
                oeoTooltip={OEO_TOOLTIPS.carrier}
                hint="Primary input or output carrier"
              />
            </div>

            <SelectField
              id="tech-oeo-class"
              name="tech-oeo-class"
              label="OEO Class"
              options={ontology.allowed_oeo_classes}
              value={parent.oeo_class}
              onChange={(v) => setParent((p) => ({ ...p, oeo_class: v }))}
              error={pe("oeo_class")}
              required
              oeoTooltip={OEO_TOOLTIPS.oeo_class}
              hint="Canonical OEO class URI — the semantic anchor for this technology"
              placeholder="— select OEO class —"
            />

            {/* Description */}
            <TextInput
              id="tech-description"
              label="Description"
              value={parent.description}
              onChange={(v) => setParent((p) => ({ ...p, description: v }))}
              error={pe("description")}
              placeholder="Concise description of the technology, its operating principle, and key distinguishing characteristics…"
              required
              hint="Minimum 10 characters. Aim for 2–4 sentences."
              multiline
            />
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════
            SECTION 2 — PARAMETER INSTANCES
        ════════════════════════════════════════════════════════════════ */}
        <section
          aria-labelledby="section-instances"
          className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-7"
        >
          <SectionHeading
            step="2"
            title="Parameter Instances"
            subtitle="Each instance represents a distinct variant, scenario, or data point for this technology. At least one instance is required."
          />

          {/* Array-level error (e.g. "at least one instance required") */}
          {getFieldError(zodIssues, "instances") && (
            <p
              role="alert"
              className="flex items-center gap-1.5 text-sm text-tertiary font-medium mb-5 -mt-2"
            >
              <span className="material-symbols-outlined text-[16px]">error</span>
              {getFieldError(zodIssues, "instances")}
            </p>
          )}

          <div className="space-y-4">
            {instances.map((inst, i) => (
              <InstanceSubForm
                key={inst._id}
                index={i}
                values={inst}
                onChange={updateInstance}
                onRemove={removeInstance}
                allIssues={zodIssues}
                allowedReferenceSources={ontology.allowed_reference_sources}
                removable={instances.length > 1}
              />
            ))}
          </div>

          {/* Add instance button */}
          <button
            type="button"
            onClick={addInstance}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border
                       border-dashed border-primary/30 px-5 py-3
                       text-sm font-medium text-primary/80 hover:text-primary
                       hover:border-primary/60 hover:bg-primary/5
                       transition-all duration-150 w-full justify-center"
          >
            <span className="material-symbols-outlined text-lg">add</span>
            Add another instance
          </button>
        </section>

        {/* ── Submit row ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-on-surface-variant max-w-sm leading-relaxed">
            <span className="material-symbols-outlined text-[14px] mr-1 align-middle">
              lock
            </span>
            Submissions are reviewed by a data steward before publication.
            Ontology-field values are validated against the live OEO schema on
            both client and server.
          </p>
          <SubmitButton instanceCount={instances.length} />
        </div>
      </div>
    </form>
  );
}

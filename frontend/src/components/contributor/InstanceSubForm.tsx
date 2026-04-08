/**
 * components/contributor/InstanceSubForm.tsx
 * ───────────────────────────────────────────
 * A collapsible sub-form representing one "Parameter Instance" within the
 * Add Technology form.
 *
 * Each instance captures a distinct variant/scenario of a technology
 * (e.g. "2025 projection" vs "2030 projection"), with full techno-economic
 * and environmental parameter sets.
 *
 * Props
 * ─────
 * • `index`   — Position in the instances array (for error path resolution).
 * • `values`  — Controlled string state (numbers stored as strings for inputs).
 * • `onChange`— Field-level update callback.
 * • `onRemove`— Removes this instance from the parent's list.
 * • `errors`  — Zod issues; pass all root-level issues and filter by index.
 * • `allowedReferenceSources` — Live ontology list for the strict select.
 * • `removable` — Whether the remove button is shown (false for the first instance).
 */

import { useState } from "react";
import type { z } from "zod";
import SelectField from "./SelectField";
import { getFieldError } from "../../schemas/technology";

export interface InstanceFormValues {
  /** Unique stable key for React list rendering — never sent to API. */
  _id: string;
  variant_name: string;
  capacity_mw: string;
  capex_usd_per_kw: string;
  opex_fixed_usd_per_kw_yr: string;
  opex_var_usd_per_mwh: string;
  efficiency_percent: string;
  lifetime_years: string;
  co2_emission_factor_operational_g_per_kwh: string;
  reference_source: string;
}

interface InstanceSubFormProps {
  index: number;
  values: InstanceFormValues;
  onChange: (index: number, field: keyof InstanceFormValues, value: string) => void;
  onRemove: (index: number) => void;
  allIssues: z.ZodIssue[];
  allowedReferenceSources: string[];
  removable: boolean;
}

// ── Reusable number input ─────────────────────────────────────────────────────

function NumberInput({
  id,
  label,
  value,
  onChange,
  error,
  unit,
  hint,
  min = 0,
  step = "any",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  unit: string;
  hint?: string;
  min?: number;
  step?: string | number;
}) {
  const hasError = Boolean(error);
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-sm font-semibold text-on-surface leading-none"
      >
        {label}
        <span className="ml-0.5 text-tertiary" aria-hidden="true">
          *
        </span>
      </label>
      <div className="flex items-stretch">
        <input
          id={id}
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hasError ? `${id}-error` : undefined}
          aria-invalid={hasError}
          className={[
            "flex-1 rounded-l-lg border bg-surface-container-lowest px-3 py-2.5",
            "text-sm text-on-surface font-mono",
            "focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary",
            "transition-colors duration-150",
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none",
            hasError
              ? "border-tertiary ring-1 ring-tertiary/30"
              : "border-outline-variant/40 hover:border-outline-variant border-r-0",
          ].join(" ")}
        />
        <span
          className={[
            "inline-flex items-center rounded-r-lg px-3 text-xs font-mono",
            "bg-surface-container border border-l-0 text-on-surface-variant select-none",
            hasError ? "border-tertiary" : "border-outline-variant/40",
          ].join(" ")}
        >
          {unit}
        </span>
      </div>
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
        <p className="text-xs text-on-surface-variant/70">{hint}</p>
      ) : null}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InstanceSubForm({
  index,
  values,
  onChange,
  onRemove,
  allIssues,
  allowedReferenceSources,
  removable,
}: InstanceSubFormProps) {
  const [collapsed, setCollapsed] = useState(false);

  const err = (field: string) =>
    getFieldError(allIssues, "instances", index, field);

  const field =
    (f: keyof InstanceFormValues) =>
    (value: string) =>
      onChange(index, f, value);

  const label =
    values.variant_name.trim() !== ""
      ? values.variant_name.trim()
      : `Instance ${index + 1}`;

  return (
    <div
      className={[
        "rounded-xl border transition-colors duration-150",
        allIssues.some((i) => i.path[1] === index)
          ? "border-tertiary/40 bg-tertiary-container/20"
          : "border-outline-variant/25 bg-surface-container-lowest",
      ].join(" ")}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-variant/15">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2.5 text-sm font-bold text-on-surface hover:text-primary transition-colors"
          aria-expanded={!collapsed}
        >
          <span className="material-symbols-outlined text-[18px] text-primary/70">
            {collapsed ? "expand_more" : "expand_less"}
          </span>
          Instance {index + 1}
          {values.variant_name && (
            <span className="text-on-surface-variant font-normal">— {label}</span>
          )}
        </button>

        {removable && (
          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label={`Remove instance ${index + 1}`}
            title="Remove instance"
            className="flex items-center gap-1 text-xs font-medium text-tertiary/80
                       hover:text-tertiary hover:bg-tertiary-container/30
                       px-2 py-1 rounded transition-colors"
          >
            <span className="material-symbols-outlined text-[15px]">delete</span>
            Remove
          </button>
        )}
      </div>

      {/* ── Body ── */}
      {!collapsed && (
        <div className="px-5 py-5 space-y-5">
          {/* Variant name */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`inst-${index}-variant`}
              className="text-sm font-semibold text-on-surface"
            >
              Variant Name
              <span className="ml-0.5 text-tertiary" aria-hidden="true">*</span>
            </label>
            <input
              id={`inst-${index}-variant`}
              type="text"
              value={values.variant_name}
              onChange={(e) => field("variant_name")(e.target.value)}
              placeholder='e.g. "2030 projection — conservative" or "Siemens 5MW offshore"'
              aria-invalid={Boolean(err("variant_name"))}
              className={[
                "w-full rounded-lg border bg-surface-container-lowest px-3 py-2.5",
                "text-sm text-on-surface placeholder:text-on-surface-variant/40",
                "focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary",
                err("variant_name")
                  ? "border-tertiary ring-1 ring-tertiary/30"
                  : "border-outline-variant/40 hover:border-outline-variant",
              ].join(" ")}
            />
            {err("variant_name") && (
              <p role="alert" className="flex items-center gap-1 text-xs text-tertiary font-medium">
                <span className="material-symbols-outlined text-[13px]">error</span>
                {err("variant_name")}
              </p>
            )}
          </div>

          {/* ── Numeric fields ── 2-column grid on wider screens */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <NumberInput
              id={`inst-${index}-capacity`}
              label="Installed Capacity"
              value={values.capacity_mw}
              onChange={field("capacity_mw")}
              error={err("capacity_mw")}
              unit="MW"
              hint="Rated installed power capacity of this variant"
              min={0}
            />

            <NumberInput
              id={`inst-${index}-capex`}
              label="CAPEX"
              value={values.capex_usd_per_kw}
              onChange={field("capex_usd_per_kw")}
              error={err("capex_usd_per_kw")}
              unit="USD/kW"
              hint="Total overnight capital cost per installed kilowatt"
              min={0}
            />

            <NumberInput
              id={`inst-${index}-opex-fixed`}
              label="Fixed OPEX"
              value={values.opex_fixed_usd_per_kw_yr}
              onChange={field("opex_fixed_usd_per_kw_yr")}
              error={err("opex_fixed_usd_per_kw_yr")}
              unit="USD/kW-yr"
              hint="Annual fixed operations & maintenance cost"
              min={0}
            />

            <NumberInput
              id={`inst-${index}-opex-var`}
              label="Variable OPEX"
              value={values.opex_var_usd_per_mwh}
              onChange={field("opex_var_usd_per_mwh")}
              error={err("opex_var_usd_per_mwh")}
              unit="USD/MWh"
              hint="Cost per unit of energy produced or converted"
              min={0}
            />

            <NumberInput
              id={`inst-${index}-efficiency`}
              label="Efficiency"
              value={values.efficiency_percent}
              onChange={field("efficiency_percent")}
              error={err("efficiency_percent")}
              unit="%"
              hint="Net conversion efficiency from input to output carrier"
              min={0}
              step={0.1}
            />

            <NumberInput
              id={`inst-${index}-lifetime`}
              label="Economic Lifetime"
              value={values.lifetime_years}
              onChange={field("lifetime_years")}
              error={err("lifetime_years")}
              unit="years"
              hint="Expected operational lifetime for economic calculations"
              min={1}
              step={1}
            />

            <NumberInput
              id={`inst-${index}-co2`}
              label="CO₂ Emission Factor"
              value={values.co2_emission_factor_operational_g_per_kwh}
              onChange={field("co2_emission_factor_operational_g_per_kwh")}
              error={err("co2_emission_factor_operational_g_per_kwh")}
              unit="g/kWh"
              hint="Operational (scope 1) CO₂ equivalent per unit of output"
              min={0}
            />
          </div>

          {/* Reference source — strict OEO-aligned select */}
          <SelectField
            id={`inst-${index}-ref-source`}
            name={`inst-${index}-ref-source`}
            label="Reference Source"
            options={allowedReferenceSources}
            value={values.reference_source}
            onChange={field("reference_source")}
            error={err("reference_source")}
            required
            oeoTooltip={
              "Select the authoritative source for these parameter values. " +
              "Only pre-approved, peer-reviewed sources aligned with the Open Energy " +
              "Ontology (OEO) provenance model are listed here. Contact the data " +
              "steward to request a new source be added."
            }
            hint="Only OEO-approved sources are listed"
          />
        </div>
      )}
    </div>
  );
}

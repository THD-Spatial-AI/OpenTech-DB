/**
 * schemas/technology.ts
 * ─────────────────────
 * Zod validation schemas for the Contributor Workspace.
 *
 * Design decisions
 * ────────────────
 * • Numeric fields use z.number() (not z.coerce). The form collects string
 *   input and converts to number before running safeParse, so coercion has
 *   already happened by validation time.
 * • `createTechnologySchema()` is a factory that accepts the live
 *   OntologySchema fetched from the API, baking the allowed string lists into
 *   `.refine()` checks. This guarantees that the client-side guard exactly
 *   mirrors the backend's controlled vocabularies.
 * • Error messages are written for domain experts, not generic "invalid input".
 */

import { z } from "zod";
import type { OntologySchema } from "../types/api";

// ── Instance (parameter set) ──────────────────────────────────────────────────

export const InstancePayloadSchema = z.object({
  variant_name: z
    .string()
    .min(1, "Variant name is required")
    .max(200, "Variant name is too long (max 200 chars)"),

  capex_usd_per_kw: z
    .number({ error: "Enter a numeric value for CAPEX" })
    .min(0, "CAPEX must be ≥ 0 USD/kW")
    .max(1_000_000, "CAPEX value is implausibly large (> 1,000,000 USD/kW)"),

  opex_fixed_usd_per_kw_yr: z
    .number({ error: "Enter a numeric value for fixed OPEX" })
    .min(0, "Fixed OPEX must be ≥ 0 USD/kW-yr"),

  opex_var_usd_per_mwh: z
    .number({ error: "Enter a numeric value for variable OPEX" })
    .min(0, "Variable OPEX must be ≥ 0 USD/MWh"),

  efficiency_percent: z
    .number({ error: "Enter a numeric value for efficiency" })
    .min(0, "Efficiency must be between 0 and 100%")
    .max(100, "Efficiency cannot exceed 100%"),

  lifetime_years: z
    .number({ error: "Enter a numeric value for lifetime" })
    .int("Lifetime must be a whole number of years")
    .min(1, "Lifetime must be at least 1 year")
    .max(150, "Lifetime > 150 years is unrealistic — check your entry"),

  co2_emission_factor_operational_g_per_kwh: z
    .number({ error: "Enter a numeric value for CO₂ emission factor" })
    .min(0, "CO₂ emission factor must be ≥ 0 g/kWh"),

  // reference_source is always validated against the live ontology list;
  // a plain .min(1) guard here catches the empty-select case before we
  // hit the .refine() produced by createTechnologySchema.
  reference_source: z.string().min(1, "Please select a reference source"),
});

export type InstancePayload = z.infer<typeof InstancePayloadSchema>;

// ── Parent technology (base, without ontology refinements) ────────────────────

export const BaseTechnologySchema = z.object({
  technology_name: z
    .string()
    .min(2, "Technology name must be at least 2 characters")
    .max(200, "Technology name is too long (max 200 chars)"),

  domain: z.string().min(1, "Please select a domain"),
  carrier: z.string().min(1, "Please select a carrier"),
  oeo_class: z.string().min(1, "Please select an OEO class"),

  description: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(2000, "Description is too long (max 2000 chars)"),

  instances: z
    .array(InstancePayloadSchema)
    .min(1, "At least one parameter instance must be provided"),
});

// ── Factory — adds live ontology refinements ──────────────────────────────────

/**
 * Produces a fully-hardened Zod schema by injecting the runtime ontology
 * allowlists into `.refine()` guards on every controlled-vocabulary field.
 * Call this once per form lifecycle after the OntologySchema has resolved.
 */
export function createTechnologySchema(ontology: OntologySchema) {
  const domainSet = new Set(ontology.allowed_domains);
  const carrierSet = new Set(ontology.allowed_carriers);
  const oeoClassSet = new Set(ontology.allowed_oeo_classes);
  const refSourceSet = new Set(ontology.allowed_reference_sources);

  return BaseTechnologySchema.extend({
    domain: z
      .string()
      .min(1, "Please select a domain")
      .refine(
        (v) => domainSet.has(v),
        "Selected domain is not in the OEO-aligned allowlist"
      ),

    carrier: z
      .string()
      .min(1, "Please select a carrier")
      .refine(
        (v) => carrierSet.has(v),
        "Selected carrier is not in the OEO-aligned allowlist"
      ),

    oeo_class: z
      .string()
      .min(1, "Please select an OEO class")
      .refine(
        (v) => oeoClassSet.has(v),
        "Selected OEO class is not in the allowlist — please refresh"
      ),

    instances: z
      .array(
        InstancePayloadSchema.extend({
          reference_source: z
            .string()
            .min(1, "Please select a reference source")
            .refine(
              (v) => refSourceSet.has(v),
              "Selected reference source is not in the OEO-aligned allowlist"
            ),
        })
      )
      .min(1, "At least one parameter instance must be provided"),
  });
}

export type CreateTechnologySchema = ReturnType<typeof createTechnologySchema>;
export type CreateTechnologyFormData = z.infer<CreateTechnologySchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Finds the first Zod issue matching a field path.
 * Path segments can be strings (field names) or numbers (array indices).
 *
 * Usage:
 *   getFieldError(issues, "instances", 0, "capex_usd_per_kw")
 */
export function getFieldError(
  issues: z.ZodIssue[],
  ...path: (string | number)[]
): string | undefined {
  return issues.find(
    (issue) =>
      issue.path.length === path.length &&
      issue.path.every((segment, i) => segment === path[i])
  )?.message;
}

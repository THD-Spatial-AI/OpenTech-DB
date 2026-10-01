/**
 * lib/consent.ts
 * ──────────────
 * Persistence helpers for the privacy-consent choice.
 *
 * Kept separate from ConsentBanner.tsx so that component file only exports
 * components (required for React Fast Refresh / react-refresh lint rule).
 */

const STORAGE_KEY = "opentech-consent-v1";

export type ConsentState = "accepted" | "declined" | null;

export function getStoredConsent(): ConsentState {
  return (localStorage.getItem(STORAGE_KEY) as ConsentState) ?? null;
}

export function setStoredConsent(choice: "accepted" | "declined"): void {
  localStorage.setItem(STORAGE_KEY, choice);
}

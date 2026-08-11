import { useState } from "react";
import { LegalDialog } from "./LegalDialogs";
import logoWithTitle from "../assets/icon_title.png";

const STORAGE_KEY = "opentech-consent-v1";

export type ConsentState = "accepted" | "declined" | null;

export function getStoredConsent(): ConsentState {
  return (localStorage.getItem(STORAGE_KEY) as ConsentState) ?? null;
}

function DataRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-outline-variant/10 last:border-0">
      <span className="material-symbols-outlined text-primary/70 text-base mt-0.5 flex-shrink-0">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-on-surface">{label}</p>
        <p className="text-xs text-on-surface-variant leading-relaxed">{value}</p>
      </div>
    </div>
  );
}

interface ConsentBannerProps {
  onDecide: (choice: "accepted" | "declined") => void;
}

export default function ConsentBanner({ onDecide }: ConsentBannerProps) {
  const [leaving, setLeaving] = useState(false);

  const decide = (choice: "accepted" | "declined") => {
    localStorage.setItem(STORAGE_KEY, choice);
    setLeaving(true);
    setTimeout(() => onDecide(choice), 280);
  };

  return (
    <div
      className={[
        "fixed inset-0 z-[200] flex items-center justify-center p-4",
        "bg-black/60 backdrop-blur-sm",
        leaving ? "opacity-0 transition-opacity duration-300" : "opacity-100",
      ].join(" ")}
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
    >
      <div className="w-full max-w-lg bg-surface border border-outline-variant/20 shadow-2xl flex flex-col max-h-[90vh]">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-outline-variant/15 flex-shrink-0">
          <img src={logoWithTitle} alt="OpenTech-DB" className="h-8 w-auto object-contain" />
          <div className="ml-auto flex items-center gap-1.5">
            <span className="material-symbols-outlined text-primary text-base">shield</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Privacy Notice
            </span>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* Intro */}
          <div>
            <h2 id="consent-title" className="text-base font-bold text-on-surface mb-1.5">
              Before you continue
            </h2>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              OpenTech-DB is an open research data platform operated by{" "}
              <strong className="text-on-surface">THD Spatial AI</strong>,
              Technische Hochschule Deggendorf. The technology catalogue is freely accessible
              to everyone — no account required.
            </p>
          </div>

          {/* What we process */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">
              What this site processes
            </p>
            <div className="bg-surface-container border border-outline-variant/15 px-4 py-1">
              <DataRow
                icon="public"
                label="IP address"
                value="Transmitted to Google (web fonts) and GitHub (world map data) when you load the site. Legal basis: consent."
              />
              <DataRow
                icon="manage_accounts"
                label="Account data (optional)"
                value="Email, ORCID iD, institution — only if you register as a Contributor. Legal basis: consent."
              />
              <DataRow
                icon="monitoring"
                label="Access logs"
                value="IP address, timestamp, HTTP path — retained max. 7 days for IT security. Legal basis: public interest."
              />
              <DataRow
                icon="storage"
                label="Session tokens"
                value="Stored in sessionStorage only — cleared when you close the tab. No tracking cookies."
              />
            </div>
          </div>

          {/* Key facts */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: "no_encryption_gae", text: "No tracking or analytics" },
              { icon: "database",          text: "Self-hosted on THD servers" },
              { icon: "lock_open",         text: "Catalogue access without account" },
              { icon: "undo",              text: "Withdraw consent anytime" },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-2 text-xs text-on-surface-variant">
                <span className="material-symbols-outlined text-primary/80 text-sm">{icon}</span>
                {text}
              </div>
            ))}
          </div>

          {/* Controller */}
          <div className="text-xs text-on-surface-variant border-t border-outline-variant/10 pt-4">
            <strong className="text-on-surface">Data controller:</strong>{" "}
            Deggendorf Institute of Technology (DIT) · Represented by Prof. Waldemar Berg<br />
            Project contact: ricardo.miranda@th-deg.de · DPO:{" "}
            <a href="mailto:datenschutz@th-deg.de" className="text-primary hover:underline">
              datenschutz@th-deg.de
            </a>
          </div>

          {/* Legal links */}
          <div className="flex gap-4 text-xs">
            <LegalDialog
              type="privacy"
              triggerClassName="text-primary hover:underline font-medium flex items-center gap-1"
            />
            <LegalDialog
              type="terms"
              triggerClassName="text-primary hover:underline font-medium flex items-center gap-1"
            />
            <LegalDialog
              type="impressum"
              triggerClassName="text-primary hover:underline font-medium flex items-center gap-1"
            />
          </div>
        </div>

        {/* ── Footer / action buttons ──────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-outline-variant/15 px-6 py-4">
          <p className="text-[11px] text-on-surface-variant/60 mb-3">
            Declining means you can still browse the public catalogue but cannot create an account
            or submit parameters. You can change this at any time via the Privacy link in the sidebar.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => decide("declined")}
              className="px-4 py-2 text-sm border border-outline-variant/40 text-on-surface-variant
                         hover:bg-surface-container transition-colors rounded-sm"
            >
              Decline optional
            </button>
            <button
              onClick={() => decide("accepted")}
              className="px-5 py-2 text-sm bg-primary text-on-primary font-medium
                         hover:bg-primary/90 transition-colors rounded-sm
                         flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-base">check</span>
              Accept & Continue
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

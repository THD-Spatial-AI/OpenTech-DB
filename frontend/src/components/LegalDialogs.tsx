import { useState } from "react";
import {
  Dialog, DialogTrigger, DialogContent,
  DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogClose,
} from "./ui/dialog";

// ── Shared prose helpers ───────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-primary mb-2 border-l-2 border-primary pl-2">
        {title}
      </h3>
      <div className="text-sm text-on-surface-variant leading-relaxed space-y-1.5">
        {children}
      </div>
    </div>
  );
}

function Tag({ children }: { children: string }) {
  return (
    <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 bg-primary/8
                     text-primary border border-primary/20 rounded-sm align-middle">
      {children}
    </span>
  );
}

function InfoBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container border border-outline-variant/20 rounded p-3 text-sm space-y-0.5">
      <p className="font-semibold text-on-surface">{title}</p>
      <div className="text-on-surface-variant leading-relaxed">{children}</div>
    </div>
  );
}

// ── Privacy Policy ─────────────────────────────────────────────────────────────

function PrivacyContent() {
  return (
    <>
      <Section title="1. Data Controller">
        <InfoBox title="Technische Hochschule Deggendorf (THD)">
          Edlmairstraße 6+8, 94469 Deggendorf, Germany<br />
          <a href="mailto:info@th-deg.de" className="text-primary hover:underline">info@th-deg.de</a>
        </InfoBox>
        <InfoBox title="Project Lead">
          Ricardo Ignacio Miranda · Research Associate<br />
          THD Spatial AI, Faculty of Applied Computer Science<br />
          <a href="mailto:ricardo.miranda@th-deg.de" className="text-primary hover:underline">
            ricardo.miranda@th-deg.de
          </a>
        </InfoBox>
        <p>
          Data Protection Officer:{" "}
          <a href="mailto:datenschutz@th-deg.de" className="text-primary hover:underline">
            datenschutz@th-deg.de
          </a>
        </p>
      </Section>

      <Section title="2. Data Processed &amp; Legal Bases">
        <div className="space-y-2">
          {[
            { cat: "Account data",      data: "Username, email, Keycloak account ID, optional linked GitHub/ORCID identity", basis: "Art. 6(1)(a) GDPR" },
            { cat: "Log data",          data: "IP address, timestamp, HTTP path (Caddy logs)",     basis: "Art. 6(1)(e) GDPR" },
            { cat: "Session data",      data: "Opaque HttpOnly session cookie and CSRF token; Keycloak tokens remain server-side", basis: "Art. 6(1)(a) GDPR" },
            { cat: "Content data",      data: "Submitted technology parameters, source references", basis: "Art. 6(1)(a)/(e)" },
            { cat: "Communications",    data: "Support emails sent to the project lead",           basis: "Art. 6(1)(f) GDPR" },
          ].map(({ cat, data, basis }) => (
            <div key={cat} className="flex gap-2 text-sm items-start">
              <span className="font-medium text-on-surface w-32 flex-shrink-0">{cat}</span>
              <span className="flex-1 text-on-surface-variant">{data}</span>
              <Tag>{basis}</Tag>
            </div>
          ))}
        </div>
      </Section>

      <Section title="3. Retention Periods">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><strong>Account data</strong> — deleted on account deletion request</li>
          <li><strong>Log data</strong> — max. 7 days (automatic Caddy log rotation)</li>
          <li><strong>Session data</strong> — expires after inactivity or logout, with an eight-hour absolute maximum</li>
          <li><strong>Approved content</strong> — retained permanently in the research catalogue; personal attribution pseudonymised on account deletion</li>
          <li><strong>Communications</strong> — max. 3 years (§§ 195, 199 BGB)</li>
        </ul>
      </Section>

      <Section title="4. Recipients">
        <p>
          <strong className="text-on-surface">GitHub Inc. (USA)</strong> — data processor under Art. 28 GDPR;
          version control and automated pull requests. Transfer covered by the EU–US Data Privacy Framework (10 Jul 2023).
        </p>
        <p>
          <strong className="text-on-surface">Google LLC (USA)</strong> — independent controller;
          Google Fonts CDN (web fonts). Transfer covered by EU–US DPF.
        </p>
        <p>
          <strong className="text-on-surface">Supabase</strong> — self-hosted on THD VM;
          optional catalogue/workflow storage only, not authentication; no data transfer to Supabase Inc.
        </p>
        <p>
          <strong className="text-on-surface">Keycloak, PostgreSQL, and Redis</strong> —
          self-hosted authentication, account, and server-side session storage on THD-managed infrastructure.
        </p>
      </Section>

      <Section title="5. Your Rights">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Access (Art. 15), rectification (Art. 16), erasure (Art. 17)</li>
          <li>Restriction (Art. 18), data portability (Art. 20)</li>
          <li>Objection (Art. 21), withdrawal of consent (Art. 7(3))</li>
          <li>Lodge a complaint with the BayLDA (Promenade 18, 91522 Ansbach)</li>
        </ul>
        <p>
          Contact:{" "}
          <a href="mailto:datenschutz@th-deg.de" className="text-primary hover:underline">
            datenschutz@th-deg.de
          </a>
        </p>
      </Section>

      <p className="text-[11px] text-on-surface-variant/50 border-t border-outline-variant/15 pt-3 mt-2">
        Full privacy policy:{" "}
        <a href="/privacy" target="_blank" rel="noopener" className="text-primary hover:underline">
          otdb.th-deg.de/privacy
        </a>
      </p>
    </>
  );
}

// ── Legal Notice ───────────────────────────────────────────────────────────────

function ImpressumContent() {
  return (
    <>
      <Section title="Publisher">
        <InfoBox title="Technische Hochschule Deggendorf (THD)">
          Edlmairstraße 6+8 · 94469 Deggendorf · Germany<br />
          Body of public law (Körperschaft des öffentlichen Rechts)<br />
          Tel. +49 (0) 991 3615-0 ·{" "}
          <a href="https://www.th-deg.de" target="_blank" rel="noopener" className="text-primary hover:underline">
            www.th-deg.de
          </a>
        </InfoBox>
      </Section>

      <Section title="Responsible for this Platform">
        <InfoBox title="Ricardo Ignacio Miranda">
          Research Associate · THD Spatial AI<br />
          Faculty of Applied Computer Science<br />
          <a href="mailto:ricardo.miranda@th-deg.de" className="text-primary hover:underline">
            ricardo.miranda@th-deg.de
          </a>
        </InfoBox>
      </Section>

      <Section title="Supervisory Authority">
        <p>
          Bavarian State Ministry of Science and the Arts<br />
          Salvatorstraße 2 · 80333 Munich, Germany
        </p>
      </Section>

      <Section title="Data Protection Officer">
        <p>
          <a href="mailto:datenschutz@th-deg.de" className="text-primary hover:underline">
            datenschutz@th-deg.de
          </a>
        </p>
      </Section>

      <Section title="Disclaimer">
        <p>
          Parameter values in the catalogue are provided for scientific purposes.
          THD assumes no liability for accuracy or completeness of the data.
          For external links, the respective operators are solely responsible for their content.
        </p>
      </Section>

      <Section title="Copyright">
        <p>
          Source code available under an open-source licence on{" "}
          <a href="https://github.com/THD-Spatial-AI/OpenTech-DB" target="_blank"
             rel="noopener" className="text-primary hover:underline">GitHub</a>.
          Catalogue data published under CC BY 4.0 — attribution required.
        </p>
      </Section>

      <p className="text-[11px] text-on-surface-variant/50 border-t border-outline-variant/15 pt-3 mt-2">
        Full legal notice:{" "}
        <a href="/impressum" target="_blank" rel="noopener" className="text-primary hover:underline">
          otdb.th-deg.de/impressum
        </a>
      </p>
    </>
  );
}

// ── Terms of Use (scroll-to-bottom gate) ──────────────────────────────────────

function TermsContent({ onReadToBottom }: { onReadToBottom: () => void }) {
  return (
    <div
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollTop / (el.scrollHeight - el.clientHeight) >= 0.98) onReadToBottom();
      }}
      className="flex-1 overflow-y-auto min-h-0 px-6 py-4"
    >
      <Section title="1. Scope">
        <p>
          These terms govern your use of OpenTech-DB (
          <a href="https://otdb.th-deg.de" className="text-primary hover:underline">otdb.th-deg.de</a>
          ), operated by THD Spatial AI, Technische Hochschule Deggendorf.
          By using the platform you agree to these terms.
        </p>
      </Section>

      <Section title="2. Public Access">
        <p>
          The technology catalogue, all parameter exports (PyPSA, Calliope, OSeMOSYS, AdOpT-NET0),
          and the map view are freely accessible without registration.
          Registration is only required to submit new technology parameters (Contributor role).
        </p>
      </Section>

      <Section title="3. Contributor Registration">
        <p>
          Researchers may register as Contributors to submit parameters.
          Requirements: a username, valid email address, password, and acceptance of these terms and the{" "}
          <a href="/privacy" target="_blank" rel="noopener" className="text-primary hover:underline">
            Privacy Policy
          </a>.
        </p>
      </Section>

      <Section title="4. Submitting Parameter Data">
        <p>By submitting data you confirm that:</p>
        <ul className="list-disc list-inside space-y-1 text-sm mt-1">
          <li>The data is accurate to the best of your knowledge and backed by valid source references.</li>
          <li>You are entitled to submit the data (no copyright infringement).</li>
          <li>Approved data will be permanently published under CC BY 4.0.</li>
          <li>Personal attribution fields are pseudonymised on account deletion; parameter data remains in the catalogue.</li>
        </ul>
      </Section>

      <Section title="5. Licence for Catalogue Data">
        <InfoBox title="Creative Commons Attribution 4.0 International (CC BY 4.0)">
          When using catalogue data, the following attribution is required:<br />
          <em>OpenTech-DB, THD Spatial AI, Technische Hochschule Deggendorf,
          https://otdb.th-deg.de</em>
        </InfoBox>
      </Section>

      <Section title="6. Prohibited Use">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Automated bulk requests to the API beyond normal research use</li>
          <li>Commercial use without explicit written permission</li>
          <li>Submitting false, manipulated, or unsupported parameter data</li>
          <li>Attempting to breach or disrupt the platform infrastructure</li>
        </ul>
      </Section>

      <Section title="7. Availability &amp; Liability">
        <p>
          THD strives to keep the platform available but makes no guarantee of uninterrupted service.
          Parameter values are provided for scientific purposes; use of the data is at your own risk.
          THD assumes no liability for the accuracy or suitability of the data for any specific application.
        </p>
      </Section>

      <Section title="8. Governing Law">
        <p>
          German law applies. Place of jurisdiction is Deggendorf, Germany, to the extent
          permitted by law. Questions:{" "}
          <a href="mailto:ricardo.miranda@th-deg.de" className="text-primary hover:underline">
            ricardo.miranda@th-deg.de
          </a>
        </p>
      </Section>

      <p className="text-[11px] text-on-surface-variant/50 border-t border-outline-variant/15 pt-3 mt-2">
        Full terms of use:{" "}
        <a href="/terms" target="_blank" rel="noopener" className="text-primary hover:underline">
          otdb.th-deg.de/terms
        </a>
      </p>
    </div>
  );
}

// ── Dialog config ──────────────────────────────────────────────────────────────

type LegalType = "privacy" | "impressum" | "terms";

const CONFIG: Record<LegalType, { label: string; title: string; hasGate: boolean }> = {
  privacy:   { label: "Privacy",  title: "Privacy Policy",  hasGate: false },
  impressum: { label: "Imprint",  title: "Legal Notice",    hasGate: false },
  terms:     { label: "Terms",    title: "Terms of Use",    hasGate: true  },
};

// ── Public component ───────────────────────────────────────────────────────────

export function LegalDialog({ type, triggerClassName }: {
  type: LegalType;
  triggerClassName?: string;
}) {
  const [readToBottom, setReadToBottom] = useState(false);
  const { label, title, hasGate } = CONFIG[type];

  return (
    <Dialog onOpenChange={() => setReadToBottom(false)}>
      <DialogTrigger asChild>
        <button
          className={
            triggerClassName ??
            "text-[11px] text-on-surface-variant/50 hover:text-on-surface-variant transition-colors"
          }
        >
          {label}
        </button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {type === "terms" ? (
          <TermsContent onReadToBottom={() => setReadToBottom(true)} />
        ) : (
          <DialogBody>
            {type === "privacy"   && <PrivacyContent />}
            {type === "impressum" && <ImpressumContent />}
          </DialogBody>
        )}

        <DialogFooter>
          {hasGate && !readToBottom && (
            <span className="text-[11px] text-on-surface-variant/60 mr-auto">
              Please read to the bottom before accepting.
            </span>
          )}
          <DialogClose asChild>
            <button
              className="px-3 py-1.5 text-sm border border-outline-variant/30
                         text-on-surface-variant hover:bg-surface-container
                         transition-colors rounded-sm"
            >
              Close
            </button>
          </DialogClose>
          {hasGate && (
            <DialogClose asChild>
              <button
                disabled={!readToBottom}
                className="px-3 py-1.5 text-sm bg-primary text-on-primary rounded-sm
                           transition-opacity disabled:opacity-40 disabled:cursor-not-allowed
                           hover:bg-primary-container"
              >
                I agree
              </button>
            </DialogClose>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
      <div className="text-sm text-on-surface-variant leading-relaxed space-y-2">
        {children}
      </div>
    </div>
  );
}

function InfoBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container border border-outline-variant/20 px-3 py-2.5 text-sm space-y-0.5 mb-2">
      <p className="font-semibold text-on-surface">{title}</p>
      <div className="text-on-surface-variant leading-relaxed">{children}</div>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc list-inside space-y-0.5 text-sm text-on-surface-variant">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

// ── Privacy Policy ─────────────────────────────────────────────────────────────

function PrivacyContent() {
  return (
    <>
      <p className="text-sm text-on-surface-variant leading-relaxed mb-5">
        OpenTech-DB is a web application managed and curated by the THD Spatial AI research
        group at the Deggendorf Institute of Technology (DIT), Faculty of Applied Computer
        Science. It is represented by the president Prof. Waldemar Berg.
      </p>

      <Section title="Controller &amp; Contact">
        <InfoBox title="Deggendorf Institute of Technology (DIT)">
          Dieter-Görlitz-Platz 1<br />
          94469 Deggendorf, Germany
        </InfoBox>
        <InfoBox title="Appointed Official Data Protection Officer">
          Prof. Dr. Sascha Kreiskott<br />
          Email:{" "}
          <a href="mailto:datenschutz@th-deg.de" className="text-primary hover:underline">
            datenschutz@th-deg.de
          </a>
        </InfoBox>
        <InfoBox title="Project Contact">
          Ricardo Ignacio Miranda · Research Associate<br />
          THD Spatial AI, Faculty of Applied Computer Science<br />
          <a href="mailto:ricardo.miranda@th-deg.de" className="text-primary hover:underline">
            ricardo.miranda@th-deg.de
          </a>
        </InfoBox>
        <p>
          In order to ensure the appropriate security of your data during transfer, we use
          encryption processes (e.g. SSL/TLS) and secured technical systems based on the
          state of the art. JavaScript is required for OpenTech-DB to function.
        </p>
      </Section>

      <Section title="Log Files">
        <p>
          When a user accesses OpenTech-DB, the following data may be stored in a protocol
          file:
        </p>
        <BulletList items={[
          "Date and time of the request",
          "Name of the requested file",
          "Page from which the file was requested",
          "Access status (e.g. file transferred, file not found)",
          "Web browser and operating system used",
          "Complete IP address of the requesting computer",
          "Data volume transferred",
        ]} />
        <p>Log data is retained for a maximum of 7 days and then automatically deleted.</p>
      </Section>

      <Section title="Local Storage &amp; Session Storage">
        <p>
          OpenTech-DB uses browser local storage and session storage for consent management
          and authentication. We do not use cookies or storage for social tracking, analytics,
          or any non-essential purpose.
        </p>

        <p className="font-semibold text-on-surface">Local Storage</p>
        <div className="bg-surface-container border border-outline-variant/15 px-3 py-2 text-sm">
          <p><strong>opentech-consent-v1</strong></p>
          <p>Storage Period: Until manually cleared (max. 365 days)</p>
          <p>
            Purpose: Records whether the user has accepted or declined this privacy notice,
            so the notice is not displayed on every visit.
          </p>
        </div>

        <p className="font-semibold text-on-surface">Session Storage (cleared on tab close)</p>
        <div className="bg-surface-container border border-outline-variant/15 px-3 py-2 text-sm">
          <p><strong>ORCID access token / Supabase JWT</strong></p>
          <p>Storage Period: Duration of the browser session</p>
          <p>
            Purpose: Authenticates the signed-in user with the OpenTech-DB API, granting
            access to the Contributor Workspace. Cleared automatically when the browser tab
            is closed. These entries are only created after a user actively logs in.
          </p>
        </div>
      </Section>

      <Section title="Data Processing &amp; Third-Party Services">
        <p className="font-semibold text-on-surface">Google LLC — Google Fonts CDN</p>
        <p>
          By accepting this privacy notice, you enable OpenTech-DB to load web fonts via
          Google's Content Delivery Network. Your IP address, browser type, and time of
          request may be transmitted to Google LLC (USA). The transfer is covered by the
          EU–US Data Privacy Framework (adequacy decision of 10 July 2023). For more
          information, see the{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener"
             className="text-primary hover:underline">
            Google Privacy Policy
          </a>.
        </p>

        <p className="font-semibold text-on-surface">GitHub Inc. — World Map Data</p>
        <p>
          The Technology World Map view loads geographic boundary data from
          raw.githubusercontent.com. Your IP address, browser type, and time of request
          may be transmitted to GitHub Inc. (USA) when you access the map. The transfer is
          covered by the EU–US Data Privacy Framework. For more information, see the{" "}
          <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"
             target="_blank" rel="noopener" className="text-primary hover:underline">
            GitHub Privacy Statement
          </a>.
        </p>

        <p className="font-semibold text-on-surface">GitHub Inc. — Version Control &amp; Pull Requests</p>
        <p>
          Approved technology parameter submissions are committed to the project repository
          on GitHub under a data processing agreement (Art. 28 GDPR). Contributor names
          attached to submissions may appear in the repository commit history.
        </p>

        <p className="font-semibold text-on-surface">Supabase (Self-Hosted)</p>
        <p>
          Contributor account data (email, ORCID iD, institution) are stored in a PostgreSQL
          database hosted on DIT's own infrastructure. No data is transmitted to Supabase Inc.
        </p>
      </Section>

      <Section title="Data Processing and Privacy">
        <p>
          Time limits for data deletion: Specific retention requirements and periods apply
          by virtue of statutory provisions. Once these periods have elapsed, the relevant
          data are routinely deleted. Personal data are deleted as soon as they are no longer
          required for the purpose for which they were collected or the legitimate basis for
          data handling ceases to apply (e.g. as a result of withdrawal of consent).
        </p>
        <p>
          When a contributor account is deleted, all account data (email, ORCID iD,
          institution) are removed. Approved parameter contributions attributed to that
          account will be pseudonymised — the contribution remains in the scientific catalogue
          but is no longer linked to the individual.
        </p>
        <p>
          Recorded data shall not be forwarded to third parties beyond the service providers
          listed above. All servers on which personal data are processed or recorded for
          OpenTech-DB users are located within the Federal Republic of Germany.
        </p>
      </Section>

      <Section title="Purposes and Legal Basis (Art. 6 GDPR)">
        <p>
          We provide our services and information about research activities on our website in
          accordance with Article 2, paragraph 6 BayHSchG, and Article 4, paragraph 1,
          sentences 1 and 2 BayEGovG.
        </p>
        <p>
          We use protocol files and logs to carry out maintenance of our web service and
          guarantee network and information security in accordance with Article 6(1)(e) GDPR;
          Article 6(1) BayDSG; Section 13(7) TMG; Article 11(1) BayEGovG.
        </p>
        <p>
          Contributor account registration, parameter submissions, and third-party service
          integrations (Google Fonts, GitHub GeoJSON) are activated only upon your freely
          given consent in accordance with Article 6(1)(a) GDPR. You may withdraw your
          consent at any time via the Privacy link in the sidebar; this does not affect the
          lawfulness of processing carried out before withdrawal.
        </p>
      </Section>

      <Section title="Right to Information and Rectification">
        <p>In accordance with the GDPR, you are entitled to the following rights:</p>
        <BulletList items={[
          "Right to obtain information about data stored about you (Art. 15 GDPR)",
          "Right to rectification of inaccurate personal data (Art. 16 GDPR)",
          "Right to erasure or restriction of processing (Art. 17, 18 GDPR)",
          "Right to object to processing (Art. 21 GDPR)",
          "Right to data portability where applicable (Art. 20 GDPR)",
          "Right to withdraw consent at any time without affecting prior processing (Art. 7(3) GDPR)",
        ]} />
        <p>
          For any queries, contact the Data Protection Officer at{" "}
          <a href="mailto:datenschutz@th-deg.de" className="text-primary hover:underline">
            datenschutz@th-deg.de
          </a>.
          You also have the right to lodge a complaint with the Bavarian State Data Protection
          Officer (BayLDA), Promenade 18, 91522 Ansbach.
        </p>
      </Section>

      <p className="text-[11px] text-on-surface-variant/50 border-t border-outline-variant/15 pt-3 mt-2">
        Amended: August 2026 · Full policy:{" "}
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
      <Section title="Institution">
        <InfoBox title="THD – Technische Hochschule Deggendorf / DIT – Deggendorf Institute of Technology">
          Dieter-Görlitz-Platz 1<br />
          94469 Deggendorf, Germany<br />
          Tel.: +49 991 3615 0 · Fax: +49 991 3615 297<br />
          <a href="mailto:info@th-deg.de" className="text-primary hover:underline">info@th-deg.de</a>
        </InfoBox>
        <p>
          The Deggendorf Institute of Technology is a state institution and also a legal
          personality under public law (pursuant to Section 4 Para. 1 Line 1 of the BayHIG).
          Its authorised statutory representative is President Prof. Waldemar Berg.
        </p>
      </Section>

      <Section title="Responsible Supervisory Authority">
        <p>
          Bavarian State Ministry of Science and the Arts<br />
          Bayerisches Staatsministerium für Wissenschaft und Kunst<br />
          Salvatorstraße 2 · 80333 München, Germany
        </p>
      </Section>

      <Section title="VAT Number">
        <p>DE 228493551 (according to Section 27a VAT Act [Umsatzsteuergesetz])</p>
      </Section>

      <Section title="Published By">
        <p>
          OpenTech-DB is a web application managed and curated by the THD Spatial AI research
          group at the Deggendorf Institute of Technology (DIT), Faculty of Applied Computer
          Science.
        </p>
        <InfoBox title="Contact for content issues">
          Ricardo Ignacio Miranda · Research Associate · THD Spatial AI<br />
          <a href="mailto:ricardo.miranda@th-deg.de" className="text-primary hover:underline">
            ricardo.miranda@th-deg.de
          </a>
        </InfoBox>
      </Section>

      <Section title="Conditions of Use">
        <p>
          Texts, images, graphics and the layout of this website may be subject to copyright
          law. According to Section 5 of the German Copyright Law [UrhG], official works
          published in the public interest are not subject to copyright, subject to the
          restrictions of Sections 62 and 63 UrhG.
        </p>
        <p>
          As a private individual, you are allowed to use material protected by copyright law
          for private and other personal use within the framework of Section 53 UrhG.
          Reproduction or use in other electronic or printed publications requires our consent.
          Reprinting and evaluation of press releases and speeches are generally permitted
          provided the source is cited.
        </p>
      </Section>

      <Section title="Exclusion of Liability">
        <p>
          The content of this website has been carefully researched and edited to the best of
          our knowledge and belief. Nevertheless, OpenTech-DB cannot guarantee the accuracy,
          completeness, legal certainty, quality, or availability of the information provided
          at all times.
        </p>
        <p>
          No liability is accepted for losses or consequences arising from direct or indirect
          use or non-use of the information provided, except where the provisions of Section
          839 of the German Civil Code (liability in the event of a breach of official duty)
          apply. No liability can be accepted for losses arising as a result of computer
          viruses, malware, or the installation or use of software or data accessed via
          this platform.
        </p>
        <p>
          As a service provider, OpenTech-DB is responsible for its own contents in
          accordance with general laws but is not obliged to monitor transmitted or stored
          third-party information. On learning of specific legal infringements, such content
          will immediately be removed. OpenTech-DB reserves the right to amend, add to, or
          delete individual pages or the entire website without special announcement.
        </p>
      </Section>

      <Section title="Links">
        <p>
          Our own content should be considered distinct from cross-references (links) to other
          providers' websites. When first linking to external content, we check for possible
          civil or criminal liability. However, we cannot constantly monitor third-party
          content and therefore accept no ongoing responsibility for it.
        </p>
      </Section>

      <Section title="Copyright">
        <p>
          Reproduction and reuse of texts and graphics requires permission from OpenTech-DB.
          Source code is available under an open-source licence on{" "}
          <a href="https://github.com/THD-Spatial-AI/OpenTech-DB" target="_blank"
             rel="noopener" className="text-primary hover:underline">GitHub</a>.
          Catalogue data is published under CC BY 4.0 — attribution required.
          Please note that images, graphics, text, or other files may be subject to
          third-party copyright in whole or in part.
        </p>
      </Section>

      <Section title="Other Information">
        <p>
          We reserve the right to adapt this imprint from time to time to meet current legal
          requirements. If you have any questions, in addition to the data protection officer
          at{" "}
          <a href="mailto:datenschutz@th-deg.de" className="text-primary hover:underline">
            datenschutz@th-deg.de
          </a>
          , you can also write to{" "}
          <a href="mailto:ricardo.miranda@th-deg.de" className="text-primary hover:underline">
            ricardo.miranda@th-deg.de
          </a>.
        </p>
      </Section>

      <p className="text-[11px] text-on-surface-variant/50 border-t border-outline-variant/15 pt-3 mt-2">
        Amended: August 2026 · Full legal notice:{" "}
        <a href="/impressum" target="_blank" rel="noopener" className="text-primary hover:underline">
          otdb.th-deg.de/impressum
        </a>
      </p>
    </>
  );
}

// ── Declaration of Consent ────────────────────────────────────────────────────

function ConsentDeclarationContent() {
  return (
    <>
      <p className="text-[11px] text-on-surface-variant/50 mb-4">
        Last updated: August 2026
      </p>

      <p className="text-sm text-on-surface-variant leading-relaxed mb-5">
        By creating a user account on OpenTech-DB, I consent to the storage and processing
        of my username and email address, which are essential for account creation and
        important communications related to my use of OpenTech-DB.
      </p>

      <Section title="Data Use">
        <p>
          I understand that any technology parameters I submit will be used solely for
          scientific research purposes within the OpenTech-DB catalogue. Submitted data
          will not be shared with or sold to third parties, and will not be used for
          commercial purposes without explicit written permission.
        </p>
      </Section>

      <Section title="Voluntary Consent &amp; Right to Withdraw">
        <p>
          I acknowledge that my consent is voluntary, and I have the right to withdraw it
          at any time by contacting the THD Spatial AI research group at the Deggendorf
          Institute of Technology (DIT) at{" "}
          <a href="mailto:ricardo.miranda@th-deg.de" className="text-primary hover:underline">
            ricardo.miranda@th-deg.de
          </a>.
          Upon revocation, my personal data will be deleted without undue delay, in
          accordance with legal and technical requirements. Any processing that occurred
          prior to revocation will remain lawful.
        </p>
        <p>
          Approved parameter contributions attributed to my account will be pseudonymised
          upon account deletion — the scientific data remains in the catalogue but is no
          longer linked to me personally.
        </p>
      </Section>

      <Section title="Data Controller">
        <InfoBox title="Deggendorf Institute of Technology (DIT)">
          Dieter-Görlitz-Platz 1 · 94469 Deggendorf, Germany<br />
          Project contact:{" "}
          <a href="mailto:ricardo.miranda@th-deg.de" className="text-primary hover:underline">
            ricardo.miranda@th-deg.de
          </a>
        </InfoBox>
      </Section>

      <Section title="Your Rights">
        <p>
          I have the right to access my personal data and request corrections or deletions
          in accordance with GDPR provisions (Art. 15–21 GDPR). For more details on how
          my data will be handled, I can review the{" "}
          <a href="/privacy" target="_blank" rel="noopener" className="text-primary hover:underline">
            Privacy Policy
          </a>.
        </p>
      </Section>

      <Section title="Legal Basis">
        <p>
          The legal basis for processing personal data is my consent in accordance with
          Art. 6(1)(a) GDPR.
        </p>
      </Section>

      <Section title="Updates to this Declaration">
        <p>
          I understand that this Declaration of Consent may be updated in the future.
          I will be notified of significant changes, and my continued use of OpenTech-DB
          after such notification constitutes acceptance of the updated terms. For any
          questions, contact{" "}
          <a href="mailto:datenschutz@th-deg.de" className="text-primary hover:underline">
            datenschutz@th-deg.de
          </a>{" "}
          or{" "}
          <a href="mailto:ricardo.miranda@th-deg.de" className="text-primary hover:underline">
            ricardo.miranda@th-deg.de
          </a>.
        </p>
      </Section>
    </>
  );
}

// ── Disclaimer ────────────────────────────────────────────────────────────────

function DisclaimerContent() {
  return (
    <>
      <p className="text-[11px] text-on-surface-variant/50 mb-4">Last updated: August 2026</p>

      <p className="text-sm text-on-surface-variant leading-relaxed mb-5">
        The technology parameter values in the OpenTech-DB catalogue are sourced from
        peer-reviewed literature, institutional reports (NREL ATB, IRENA, IEA), and
        automated data pipelines. While we strive for accuracy, these parameters are
        intended for research and informational purposes and should not be solely relied
        upon for significant financial, engineering, or policy decisions.
      </p>

      <Section title="Accuracy of Parameter Data">
        <p className="font-semibold text-on-surface">Data Sources and Assumptions</p>
        <BulletList items={[
          "Peer-reviewed literature: values extracted from academic publications may reflect specific geographic, temporal, or technological contexts that differ from your application.",
          "NREL ATB / IRENA / IEA: institutional reports provide projections and estimates based on scenario assumptions that may not reflect current market conditions.",
          "Automated extraction: parameters obtained via the scraper pipeline are subject to extraction errors and require human review before approval. Only admin-approved values appear in the catalogue.",
          "Contributor submissions: values submitted by registered researchers are reviewed for plausibility but are not independently verified by DIT.",
        ]} />
      </Section>

      <Section title="Estimated Values">
        <p>
          Technology cost and performance values (CAPEX, OPEX, efficiency, lifetime, etc.)
          are estimates based on available data and industry-standard sources. They are
          intended to provide a general reference for energy system modelling and should
          not be taken as precise or definitive values for any specific project.
        </p>
      </Section>

      <Section title="Limitations and Use">
        <BulletList items={[
          "Parameter values are intended for scientific research, educational purposes, and energy system modelling only.",
          "They should not be used as the sole basis for making significant financial, engineering, procurement, or policy decisions.",
          "Users should consult qualified professionals and consider local conditions, regulations, and market prices before relying on these values in real-world applications.",
        ]} />
      </Section>

      <Section title="No Warranty">
        <p>
          OpenTech-DB provides parameter data "as is" without any warranties, express or
          implied. We do not warrant that the values will be error-free, completely accurate,
          up-to-date, or applicable to every situation or geographic context.
        </p>
      </Section>

      <Section title="User Responsibility">
        <p>
          Users are responsible for verifying the accuracy and suitability of parameter
          values for their specific needs. Deggendorf Institute of Technology (DIT) and
          the THD Spatial AI research group shall not be liable for any losses or damages
          arising from the use of data provided in this catalogue.
        </p>
      </Section>

      <Section title="Changes and Updates">
        <p>
          Data sources and methodologies may change over time. OpenTech-DB reserves the
          right to update parameter values and underlying data without prior notice to
          reflect new scientific findings or improvements in data quality. Version
          information and source references are attached to each parameter value.
        </p>
      </Section>

      <Section title="Use of Submitted Data for Quality Improvement">
        <p>
          OpenTech-DB is committed to continuously improving the accuracy and reliability
          of the catalogue. To achieve this:
        </p>
        <BulletList items={[
          "Approved parameter submissions are analysed for consistency with existing values and published literature.",
          "Aggregated, anonymised data may be used to identify outliers, refine source weighting, and improve automated extraction pipelines.",
          "All data used for quality improvement is handled in accordance with the Privacy Policy. Personal identifiers are not used in analytical processes.",
          "Users are encouraged to report inaccuracies or anomalies via the contributor workspace or by email.",
        ]} />
      </Section>

      <Section title="Contact">
        <p>
          If you have questions about the accuracy or use of parameter data, please contact:{" "}
          <a href="mailto:ricardo.miranda@th-deg.de" className="text-primary hover:underline">
            ricardo.miranda@th-deg.de
          </a>
        </p>
        <p>
          By using OpenTech-DB, you acknowledge and agree to the terms of this disclaimer.
          Your use of the platform constitutes acceptance of these limitations.
        </p>
      </Section>
    </>
  );
}

// ── Acknowledgements ──────────────────────────────────────────────────────────

function AcknowledgementsContent() {
  function AckGroup({ items }: { items: { name: string; desc: string }[] }) {
    return (
      <div className="space-y-2">
        {items.map(({ name, desc }) => (
          <div key={name} className="flex gap-2 text-sm items-start">
            <span className="font-semibold text-on-surface w-36 flex-shrink-0">{name}</span>
            <span className="text-on-surface-variant leading-relaxed">{desc}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <p className="text-[11px] text-on-surface-variant/50 mb-4">Last updated: August 2026</p>

      <p className="text-sm text-on-surface-variant leading-relaxed mb-5">
        We would like to extend our gratitude to the developers and contributors of the
        following tools, frameworks, and data sources that make OpenTech-DB possible.
        Thank you for your continuous innovation and commitment to open science.
      </p>

      <Section title="Frontend">
        <AckGroup items={[
          { name: "React 19",        desc: "Open-source JavaScript library for building user interfaces, maintained by Meta and a community of developers. Uses the new use() hook and concurrent rendering features." },
          { name: "TypeScript",      desc: "Strongly typed superset of JavaScript providing compile-time safety and improved developer tooling across the entire codebase." },
          { name: "Vite",            desc: "Next-generation frontend build tool providing fast hot module replacement and optimised production bundles." },
          { name: "TailwindCSS",     desc: "Utility-first CSS framework used for the entire design system including custom colour tokens aligned with Material Design 3." },
          { name: "Radix UI",        desc: "Accessible, unstyled component primitives providing the foundation for dialogs, tooltips, and other interactive UI components." },
          { name: "Material Symbols", desc: "Google's open-source variable icon font used throughout the interface for consistent iconography." },
          { name: "Zustand",         desc: "Lightweight state management library used for UI state stores across the application." },
          { name: "Leaflet",         desc: "Open-source mapping library powering the Technology World Map view for interactive geographic visualisation of deployment data." },
          { name: "Apache ECharts",  desc: "Comprehensive charting and visualisation library used for technology parameter charts, time series profiles, and cost comparisons." },
        ]} />
      </Section>

      <Section title="Backend &amp; Infrastructure">
        <AckGroup items={[
          { name: "FastAPI",         desc: "High-performance Python web framework providing the REST API with automatic OpenAPI documentation and Pydantic v2 validation." },
          { name: "Pydantic v2",     desc: "Data validation and settings management library serving as the single source of truth for all technology parameter schemas." },
          { name: "PostgreSQL",      desc: "Powerful open-source relational database system used for scraper candidates, runs, and contributor account data." },
          { name: "Supabase",        desc: "Open-source Firebase alternative providing authentication (GoTrue) and database tooling. Self-hosted on DIT infrastructure — no data leaves the university." },
          { name: "APScheduler",     desc: "Python task scheduling library running the automated data collection pipeline on the 1st and 15th of each month." },
          { name: "Caddy",           desc: "Automatic HTTPS reverse proxy handling SSL termination, URL routing, and clean URL rewrites for the platform." },
          { name: "Docker",          desc: "Container platform used for consistent deployment and orchestration of all platform services." },
        ]} />
      </Section>

      <Section title="Data Sources">
        <AckGroup items={[
          { name: "NREL ATB",        desc: "National Renewable Energy Laboratory Annual Technology Baseline — a primary source of cost and performance projections for energy technologies in the United States." },
          { name: "IRENA",           desc: "International Renewable Energy Agency — providing global renewable energy cost and capacity data used in the catalogue." },
          { name: "IEA",             desc: "International Energy Agency — providing technology cost benchmarks and energy statistics referenced by catalogue parameters." },
          { name: "OpenAlex",        desc: "Open-access scientific literature index used by the automated scraper pipeline to discover and extract parameters from peer-reviewed papers." },
          { name: "Semantic Scholar", desc: "AI-powered literature search engine used by the scraper to identify relevant energy technology publications." },
          { name: "Crossref",        desc: "Scholarly metadata service used by the scraper pipeline to resolve DOIs and retrieve publication provenance for parameter sources." },
          { name: "Open Energy Ontology (OEO)", desc: "A shared ontology for the energy domain developed by the open_eGo project, used as the conceptual framework for aligning technology definitions and parameter semantics in this database." },
        ]} />
      </Section>

      <Section title="Framework Adapters">
        <AckGroup items={[
          { name: "PyPSA",           desc: "Python for Power System Analysis — open-source tool for simulating and optimising power systems. OpenTech-DB exports parameters directly to PyPSA-compatible format." },
          { name: "Calliope",        desc: "Versatile energy system modelling framework. OpenTech-DB supports exports for both Calliope 0.6 and 0.7 with appropriate name and unit mappings." },
          { name: "OSeMOSYS",        desc: "Open Source energy Modelling SYStem — a linear programming framework for long-term energy planning. OpenTech-DB provides OSeMOSYS-compatible parameter exports." },
          { name: "AdOpT-NET0",      desc: "Energy system optimisation framework developed by the Utrecht University Energy & Resources group. OpenTech-DB supports AdOpT-NET0 template export format." },
        ]} />
      </Section>

      <p className="text-[11px] text-on-surface-variant/50 border-t border-outline-variant/15 pt-3 mt-2">
        OpenTech-DB is developed at THD Spatial AI, Deggendorf Institute of Technology.
        Source code:{" "}
        <a href="https://github.com/THD-Spatial-AI/OpenTech-DB" target="_blank"
           rel="noopener" className="text-primary hover:underline">
          github.com/THD-Spatial-AI/OpenTech-DB
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
      <p className="text-sm text-on-surface-variant leading-relaxed mb-5">
        OpenTech-DB is a web application managed and curated by the THD Spatial AI research
        group at the Deggendorf Institute of Technology (DIT). By using this platform you
        agree to these terms of use.
      </p>

      <Section title="1. Scope">
        <p>
          These terms govern your use of OpenTech-DB (
          <a href="https://otdb.th-deg.de" className="text-primary hover:underline">otdb.th-deg.de</a>
          ), operated by THD Spatial AI, Deggendorf Institute of Technology.
        </p>
      </Section>

      <Section title="2. Public Access">
        <p>
          The technology catalogue, all parameter exports (PyPSA, Calliope, OSeMOSYS,
          AdOpT-NET0), and the map view are freely accessible without registration.
          Registration is only required to submit new technology parameters (Contributor role).
        </p>
      </Section>

      <Section title="3. Contributor Registration">
        <p>
          Researchers may register as Contributors to submit parameters. Requirements: a valid
          email address or ORCID iD, a scientific or research affiliation, and acceptance of
          these terms and the{" "}
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
          <li>
            Personal attribution fields are pseudonymised on account deletion; parameter data
            remains in the catalogue.
          </li>
        </ul>
      </Section>

      <Section title="5. Licence for Catalogue Data">
        <div className="bg-surface-container border border-outline-variant/20 px-3 py-2.5 text-sm">
          <p className="font-semibold text-on-surface mb-1">
            Creative Commons Attribution 4.0 International (CC BY 4.0)
          </p>
          <p>
            When using catalogue data, the following attribution is required:<br />
            <em>OpenTech-DB, THD Spatial AI, Deggendorf Institute of Technology,
            https://otdb.th-deg.de</em>
          </p>
        </div>
      </Section>

      <Section title="6. Prohibited Use">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Automated bulk requests to the API beyond normal research use</li>
          <li>Commercial use without explicit written permission from DIT</li>
          <li>Submitting false, manipulated, or unsupported parameter data</li>
          <li>Attempting to breach or disrupt the platform infrastructure</li>
        </ul>
      </Section>

      <Section title="7. Availability &amp; Liability">
        <p>
          DIT strives to keep the platform available but makes no guarantee of uninterrupted
          service. Parameter values are provided for scientific purposes; use of the data is
          at your own risk. DIT assumes no liability for the accuracy or suitability of the
          data for any specific application.
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

type LegalType = "privacy" | "impressum" | "terms" | "consent" | "disclaimer" | "acknowledgements";

const CONFIG: Record<LegalType, { label: string; title: string; hasGate: boolean }> = {
  privacy:          { label: "Privacy",    title: "Privacy Policy",         hasGate: false },
  impressum:        { label: "Imprint",    title: "Legal Notice",           hasGate: false },
  terms:            { label: "Terms",      title: "Terms of Use",           hasGate: true  },
  consent:          { label: "Consent",    title: "Declaration of Consent", hasGate: false },
  disclaimer:       { label: "Disclaimer", title: "Disclaimer",             hasGate: false },
  acknowledgements: { label: "Credits",    title: "Acknowledgements",       hasGate: false },
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
            {type === "privacy"          && <PrivacyContent />}
            {type === "impressum"        && <ImpressumContent />}
            {type === "consent"          && <ConsentDeclarationContent />}
            {type === "disclaimer"       && <DisclaimerContent />}
            {type === "acknowledgements" && <AcknowledgementsContent />}
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

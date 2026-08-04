# Data Protection Documentation — OpenTech | DB

*DPM-compliant documentation of collected data, external sources, and client-side storage*

---

## 1. General Information

| Field | Value |
|---|---|
| **File Number (Serial Number)** | *(to be assigned by THD DPM office)* |
| **Creation Date** | 2026-06-17 |
| **Last Status** | 2026-08-03 |

---

### 1.1 Name of the Processing Activity

**Operation of OpenTech-DB — OEO-Aligned Energy Technology Parameter Database**

---

### 1.2 Involved Persons

| Role | Abbrev. | Name / Contact |
|---|---|---|
| Responsible person | **V** | Technische Hochschule Deggendorf (THD) — Dieter-Görlitz-Platz 1, 94469 Deggendorf |
| Responsible person of the process | **VV** | Ricardo Miranda — THD Spatial AI — ric.ignaciom@gmail.com |
| Representation of the responsible person of the process | **VVV** | *(to be named)* |
| Contact for IT | **IT** | Ricardo Miranda — ric.ignaciom@gmail.com |
| Representation of the contact for IT | **VIT** | *(to be named)* |
| Official data protection officer | **DSB** | *(THD Data Protection Officer — contact via THD DPO office)* |
| Representation of the official data protection officer | **VDSB** | *(to be named)* |
| IT security officer | **ISB** | *(THD IT Security Officer — contact via THD IT department)* |

---

### 1.3 Short Description of the Underlying Process / Project / Deployment Scenario

**OpenTech-DB** is an open-access research data platform developed at THD Spatial AI (Technische Hochschule Deggendorf) for storing, managing, and exporting standardised technical and economic parameters for 55+ energy technologies (generation, storage, transmission, conversion). The database is aligned with the Open Energy Ontology (OEO) and supports export to energy modelling frameworks including PyPSA, Calliope, and OSeMOSYS.

**Web application URL:** `https://otdb.th-deg.de`

The system comprises:
- A **FastAPI backend** serving a versioned REST API (`/api/v1/`) and hosting an automated scraper pipeline that collects technology cost data from academic and regulatory sources (OpenAlex, Crossref, NREL ATB, etc.) twice monthly.
- A **React 19 single-page application** (SPA) allowing authenticated users to browse the technology catalogue, submit new parameters, and visualise data on a world map.
- A **self-hosted Supabase instance** (PostgreSQL + GoTrue auth) running on the THD university VM alongside the application stack. This instance stores user accounts, technology submission workflow records, and scraper pipeline audit logs. **No data is transferred to Supabase, Inc. cloud services.**
- A **JSON file catalogue** in `data/` (version-controlled in Git) as the primary, portable data store for technology parameters.

The system is deployed in **Docker containers on a THD-managed VM**, behind a Caddy reverse proxy with TLS termination. All personal data (user accounts, submission records) remains within THD infrastructure.

---

## 2. Purposes and Legal Bases of the Processing

### 2.1 Purposes

Description of the purposes for which the personal data listed in chapter 3 are required.

OpenTech-DB ist eine OEO-konforme (Open Energy Ontology) Technologieparameterdatenbank, die im Rahmen der Forschungsarbeit der THD Spatial AI der Technischen Hochschule Deggendorf entwickelt wurde. Die Plattform stellt standardisierte technische und wirtschaftliche Parameter für über 55 Energietechnologien bereit und ermöglicht deren Export in Energiemodellierungsframeworks (PyPSA, Calliope, OSeMOSYS).

Die Konto- und Identifikationsdaten (Login) sind die einzigen relevanten personenbezogenen Daten, die für den Zugang zu dieser Webplattform benötigt werden. Registrierte Forscher (Contributors) können zusätzlich Technologieparameter einreichen, wobei ihre Benutzer-ID und E-Mail-Adresse zur Rückverfolgbarkeit der Beiträge (wissenschaftliche Provenienz) gespeichert werden.

Die Rechtsgrundlagen werden auf der Website zum Zeitpunkt der Erstellung eines Kontos dargelegt, wobei die Nutzer entsprechende Informationen erhalten.

---

### 2.2 Legal Bases

| Legal Basis | Paragraph | Scope |
|---|---|---|
| Consent | Art. 6 Abs. 1 UAbs. 1 lit. a DSGVO i.V.m. Art. 7 DSGVO | User registration; transmission of IP address (e.g. during GeoJSON and font downloads) |
| Public task | Art. 6 Abs. 1 UAbs. 1 lit. e DSGVO i.V.m. Art. 6 Abs. 3 DSGVO, Art. 4 Abs. 1 BayDSG, Art. 2 Abs. 1 u. 2 BayHIG | Operation of the research data platform as part of THD's public research and teaching mandate |

---

### 2.2.1 Consent

The following documents must be uploaded to support the consent legal basis:

| Document | Status |
|---|---|
| **a) Declaration of consent** — PDF printout of the registration page showing the consent notice displayed to users at account creation | ⚠ *To be prepared and uploaded* |
| **a) Declaration of consent** — PDF printout of the page/notice shown when the user's IP address is transmitted (GeoJSON download, Google Fonts CDN) | ⚠ *To be prepared and uploaded* |
| **b) Decision making / ethics assessment** | Not required — target group (researchers) are adults with full legal capacity to assess and consent to data collection |

---

### 2.3 Tools for Processing

#### 2.3.1 Software and Other Tools

| Tool | Status | Action Required |
|---|---|---|
| **PostgreSQL (via self-hosted Supabase)** | Entry exists in THD software catalogue; **no Betriebsmittelbeschreibung (operational resource description) yet** | Complete using the template in the THD wiki and submit for review by email ⚠ |
| **GitHub (github.com)** | **No entry in THD software catalogue.** Softwareeinführungsprozess (software introduction process) status unknown | Confirm or initiate the software introduction process; respond by email ⚠ |

---

## 3. Personal Data

### 3.1 Categories of Personal Data

**Accountdaten:**
- Benutzername
- Passwort (nur für den integrierten Admin-Account als bcrypt-Hash; reguläre Nutzer authentifizieren sich über Supabase oder OAuth)
- E-Mail-Adresse
- ORCID iD (bei Anmeldung über ORCID OAuth)
- GitHub-Profildaten: Name, Avatar-URL (bei Anmeldung über GitHub OAuth)

---

**Protokolldaten / Server-Log:**

Bei jedem Zugriff auf diese Website und bei jedem Abruf von Daten wird vom Server ein Protokoll angelegt. Dies dient ausschließlich internen systembezogenen Zwecken. Folgende Daten werden dabei verarbeitet:
- Aufgerufene Website
- Zeitpunkt des Zugriffs
- Menge der gesendeten Daten
- Quelle/Verweis, von dem Sie auf die Seite gelangt sind
- Verwendeter Browser
- Verwendetes Betriebssystem
- Verwendete IP-Adresse

Diese Daten können keiner bestimmten Person zugeordnet werden und werden nicht mit anderen Datenquellen zusammengeführt. Wir behalten uns vor, diese Daten nachträglich zu prüfen, wenn uns konkrete Anhaltspunkte für eine rechtswidrige Nutzung bekannt werden.

Darüber hinaus werden Audit-Trails in den Tabellen `technology_submissions` und `scraper_candidates` geführt. Diese enthalten: `reviewed_by` (E-Mail-Adresse des prüfenden Admins), `reviewed_at` (Zeitstempel der Entscheidung) sowie `pr_url` (Link zum erzeugten GitHub Pull Request bei Genehmigung). Diese Daten dienen der wissenschaftlichen Nachvollziehbarkeit von Katalogentscheidungen und werden dauerhaft als Prüfprotokoll gespeichert.

---

**Kartendarstellung (Weltkarte / 3D-Globus):**

Zur Darstellung der Ländergrenzen in der Weltkarten- und 3D-Globus-Ansicht wird einmalig pro Sitzung eine GeoJSON-Datei von GitHub CDN (`raw.githubusercontent.com`) geladen. Dabei wird die IP-Adresse des Nutzers an GitHub Inc. (Microsoft Corporation, USA) übermittelt. Es werden keine Kartenkacheln geladen; die Karten werden ausschließlich aus GeoJSON-Polygonen gerendert.

> **Rechtsgrundlage:** Art. 6 Abs. 1 UAbs. 1 lit. a DSGVO i.V.m. Art. 7 DSGVO (Einwilligung).  
> **Empfehlung:** Lokale Bereitstellung der GeoJSON-Datei auf dem Webserver (geplant: `/api/v1/geojson/countries`), um die Übermittlung der IP-Adresse an GitHub CDN zu vermeiden.

---

**Web-Schriften (Google Fonts):**

Die Webanwendung lädt Schriftarten von Google Fonts CDN (`fonts.googleapis.com`). Bei jedem Seitenaufruf wird die IP-Adresse des Nutzers an Google LLC (USA) übermittelt.

> **Rechtsgrundlage:** Art. 6 Abs. 1 UAbs. 1 lit. a DSGVO i.V.m. Art. 7 DSGVO (Einwilligung).  
> **Empfehlung:** Lokale Bereitstellung der Schriftarten (Space Grotesk, Inter, Material Symbols Outlined) auf dem Webserver, um die Übermittlung der IP-Adresse zu vermeiden.

---

**Endgerätedaten (Client-Side Storage):**

Diese Anwendung setzt keine eigenen HTTP-Cookies. Authentifizierungstoken werden ausschließlich im `sessionStorage` des Browsers gespeichert und beim Schließen des Browser-Tabs automatisch gelöscht.

Folgende Einträge werden nach dem Login gespeichert:

| Schlüssel | Inhalt | Zweck | Speicherdauer |
|---|---|---|---|
| `opentech_orcid_token` | HS256 JWT: `sub`, `username`, `email`, `auth_provider`, `is_admin` | Authentifizierung (ORCID- und Admin-Pfad) | Bis zum Schließen des Browser-Tabs (max. 24 Stunden) |
| `sb-<instance-ref>-auth.session` | Supabase-Sitzungsobjekt: `access_token`, `refresh_token`, `user` | Supabase-Sitzung (E-Mail- und GitHub-Pfad); automatisch erneuert | Bis zum Schließen des Browser-Tabs (ca. 1 Stunde, automatisch erneuert) |

---

**Kommunikationsdaten:**

Wenn Sie uns eine Anfrage per E-Mail (ric.ignaciom@gmail.com) oder über GitHub Issues zukommen lassen, werden die bereitgestellten Informationen zum Zweck der Bearbeitung der Anfrage und für mögliche Folgefragen verarbeitet.

> **Social Media:** OpenTech-DB unterhält keine eigenen Social-Media-Auftritte. GitHub wird ausschließlich als OAuth-Identitätsprovider, als Code-Repository und für den Contribution-Workflow (Pull Requests) genutzt — nicht als Kommunikationsplattform im Social-Media-Sinne. Keine weiteren sozialen Netzwerke kommen zum Einsatz.

---

> **Hinweis zu verschobenen Inhalten:**  
> Angaben zur **Verschlüsselung** sind in Kapitel 10 (Technische und organisatorische Maßnahmen) dokumentiert.  
> **Speicherdauern** sind in Kapitel 7 (Löschung und Speicherfristen) festgehalten.

---

### 3.2 Storage Locations

| Datenkategorie | Speicherort | Technische Form | Zugriffskontrolle |
|---|---|---|---|
| Accountdaten (E-Mail, ORCID iD, Profil, GitHub-Daten) | Self-hosted Supabase `auth.users` — THD-VM | PostgreSQL-Tabelle, Disk-Verschlüsselung (VM-Ebene) | Service-Role-Key (nur Backend); RLS nach `auth.uid()` |
| Technologieeinreichungen, Admin-Prüfprotokoll | Self-hosted Supabase `technology_submissions`, `scraper_candidates` — THD-VM | PostgreSQL-Tabellen | Service-Role-Key (nur Backend); RLS |
| Scraper-Laufprotokoll | Self-hosted Supabase `scraper_runs` — THD-VM | PostgreSQL-Tabelle | Service-Role-Key (nur Backend) |
| Technologiekatalog (Parameter) | Docker Named Volume (`opentech-db-data`) — THD-VM | JSON-Dateien in `data/`; versioniert in Git | Nur Backend-Container; kein direkter Zugriff von außen |
| Authentifizierungstoken | Browser `sessionStorage` — Endgerät des Nutzers | HS256 JWT; Supabase-Sitzungsobjekt | Nur same-origin JavaScript; automatisch gelöscht beim Tab-Schließen |
| Server- / Zugriffsprotokolle | Caddy-Reverse-Proxy-Logdateien — THD-VM | Strukturiertes Text-/JSON-Format | Nur THD-Systemadministratoren |

---

## 4. Persons or Groups of Persons Concerned

**Betroffene Personen / Concerned Persons:**

Registrierte Nutzer der OpenTech-DB-Plattform:

- **Mitglieder der Technischen Hochschule Deggendorf:** Forscher, wissenschaftliche Mitarbeiter und Studierende, die sich auf der Plattform registrieren, um auf den Technologiekatalog zuzugreifen oder Technologieparameter einzureichen.
- **Externe Personen:** Forscher und Wissenschaftler anderer Hochschulen, Forschungseinrichtungen oder Organisationen, die sich auf der Plattform registrieren, um auf die Datenbank zuzugreifen oder Beiträge zu leisten.
- **Administratoren:** Mitglieder der THD Spatial AI, die Technologieeinreichungen prüfen und genehmigen sowie die Plattform verwalten.

Die Plattform richtet sich ausschließlich an Personen ab 18 Jahren im wissenschaftlichen und Forschungskontext.

---

## 5. External Data Sources & Third-Party Services

### 5.1 Geospatial Data (External Requests)

The application fetches country boundary data once per session to render the World Map and 3D Globe views. No raster tile providers are used, only GeoJSON polygon boundaries are loaded.

> **Note:** No background map tiles are requested. The 2D map (Leaflet) and 3D globe (globe.gl / Three.js) render entirely from the GeoJSON polygons, so IP addresses are **not** repeatedly sent to tile CDNs during normal use.

| Provider | URL Pattern | Data Type | Personal Data Shared | Legal Basis |
|---|---|---|---|---|
| Natural Earth / GitHub CDN | `https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json` | Country polygon boundaries (GeoJSON) | IP address (single request per session) | Art. 6(1)(a) DSGVO (consent) |

### 5.2 Authentication Providers

| Provider | Endpoint(s) | Data Shared | Legal Basis |
|---|---|---|---|
| ORCID OAuth | `https://orcid.org/oauth/authorize`, `https://orcid.org/oauth/token` | ORCID iD, researcher display name | Art. 6(1)(a) DSGVO (consent) |
| Self-hosted Supabase Auth | Internal VM endpoint — no external Supabase cloud traffic | Email address, bcrypt-hashed password (email path); GitHub profile data (OAuth path) | Art. 6(1)(a) DSGVO (consent) |
| GitHub OAuth (via Supabase) | `https://github.com/login/oauth/authorize` | GitHub email, display name, avatar URL | Art. 6(1)(a) DSGVO (consent) |

**Authentication configuration details:**

| Component | Description |
|---|---|
| Custom JWT algorithm | HS256, signed with `JWT_SECRET_KEY` |
| Custom JWT lifetime | 24 hours (ORCID and built-in admin paths) |
| Supabase JWT lifetime | ~1 hour, auto-refreshed by Supabase JS SDK |
| Token persistence | `sessionStorage` (cleared on browser tab close) |
| Protocol mappers (custom JWT) | `sub` (ORCID iD or "admin"), `username`, `email`, `auth_provider`, `is_contributor`, `is_admin` |
| Data stored server-side | User profile, role flags (`is_admin`, `is_contributor`) in self-hosted Supabase `auth.users` on THD VM |

### 5.3 Scraper Pipeline — Academic & Regulatory Sources

The automated scraper pipeline runs server-side twice monthly (1st and 15th, 02:00 UTC via APScheduler). **No user personal data is transmitted to these sources.** Only the server's IP address and a polite `User-Agent` header (including a contact email for API courtesy pools) are sent.

| Source | Base URL | Data Retrieved | Schedule | Personal Data Shared |
|---|---|---|---|---|
| OpenAlex | `https://api.openalex.org` | Paper metadata, abstracts, author lists | Twice monthly | None (server IP only) |
| Crossref | `https://api.crossref.org` | DOI metadata, citation counts | Twice monthly | None |
| arXiv | `https://export.arxiv.org/api/query` | Preprint metadata | Twice monthly | None |
| Europe PMC | `https://www.ebi.ac.uk/europepmc/webservices/rest` | Energy-adjacent life sciences literature | Twice monthly | None |
| NREL ATB | `https://oedi-data-lake.s3.amazonaws.com/ATB/electricity/csv/` | US technology cost data (CSV) | Twice monthly | None |
| EIA API | `https://api.eia.gov/v2` | US energy statistics | Twice monthly | None |
| PyPSA Technology Data | `https://raw.githubusercontent.com/PyPSA/technology-data/master/outputs/` | Aggregated European cost parameters (CSV) | Twice monthly | None |
| Semantic Scholar | `https://api.semanticscholar.org/graph/v1` | Paper metadata | **Disabled** | None |
| Scopus (Elsevier) | Proprietary Elsevier endpoint | Premium bibliographic data | **Disabled** | None |
| IRENA | `https://pxweb.irena.org/api/v1/en/IRENASTAT/` | Renewable energy cost reports | **Disabled** | None |
| IEA Reports | `https://www.iea.org/data-and-statistics/` | World Energy Outlook data | **Disabled** | None |
| Fraunhofer ISE | `https://www.ise.fraunhofer.de/` | Photovoltaics cost reports (PDF) | **Disabled** | None |

### 5.4 Content Delivery — Web Fonts

The frontend loads web fonts from Google's CDN on every page load. The user's IP address is transmitted as part of the HTTP request.

| Provider | URL Pattern | Data Type | Personal Data Shared | Legal Basis |
|---|---|---|---|---|
| Google Fonts | `https://fonts.googleapis.com/css2?family=Space+Grotesk…` | Space Grotesk, Inter, Material Symbols Outlined | IP address | Art. 6(1)(a) DSGVO (consent) |

> **Note:** Consider self-hosting fonts to eliminate this external IP address transfer.

### 5.5 Backend Integration Services

These services are called server-side by the FastAPI backend, not directly from the browser.

| Service | Purpose | Personal Data Shared | Legal Basis |
|---|---|---|---|
| Self-hosted Supabase PostgreSQL (THD VM) | Stores technology submissions and scraper candidates | `user_id`, `submitter_email`, full submission payload | Art. 6(1)(e) DSGVO (public task) |
| GitHub API (`api.github.com`) | Opens pull requests when an admin approves a contribution; merges payload into JSON catalogue | Submitter email (in PR metadata), admin GitHub token | Art. 6(1)(e) DSGVO (public task) |
| OpenAI API (optional) | LLM-based extraction of parameters from academic PDFs | Paper text only — no user personal data | Art. 6(1)(e) DSGVO (public task) |

---

## 6. Categories of Recipients

### 6.1 Internal Recipients

| Empfänger (Receiver) | Grund der Offenlegung / Verarbeitung |
|---|---|
| **THD Spatial AI** — Technische Hochschule Deggendorf *(exact organisational unit to be confirmed in DPM system — not "Projektmitarbeiter")* | Betrieb und Wartung der Plattform, wissenschaftliche Forschung und Validierung des Technologiekatalogs, Prüfung und Genehmigung von Nutzereinreichungen |

---

### 6.2 External Recipients

#### 5.2a Jointly Responsible Persons (Art. 26 GDPR)

Not applicable — no joint controllership arrangements exist for this processing activity.

---

#### 5.2b Order Processors (Art. 28 GDPR)

> **Note on Supabase Inc.:** The DPM reviewer requires a signed DPA with Supabase Inc. (Singapore). However, Supabase is **self-hosted on the THD university VM** — no personal data is transferred to Supabase Inc. or its infrastructure. The self-hosted deployment architecture should be documented and submitted to the DPM reviewer to clarify that no DPA with Supabase Inc. is required. If cloud-hosted Supabase is used at any point, a DPA must be concluded before processing begins. ⚠

| Processor | Country | Personal Data Transferred | Purpose | Legal Basis | DPA Status |
|---|---|---|---|---|---|
| **GitHub, Inc.** (subsidiary of Microsoft Corporation) | USA | Submitter email address in PR metadata (upon admin approval); admin GitHub token; repository content | Versionskontrolle des Technologiekatalogs; automatische Erstellung von Pull Requests bei Genehmigung von Contributor-Einreichungen (E-Mail des Einreichers in PR-Metadaten) | Art. 28 DSGVO — GitHub Data Processing Agreement | ⚠ *Signed DPA to be provided by THD DPM office, reviewed, and uploaded to DPM system* |

**Sub-processors of GitHub, Inc.:**

| Sub-processor | Country | Role |
|---|---|---|
| Microsoft Corporation / Microsoft Azure | USA | Infrastructure hosting for all GitHub services |

> **Action required (5.2b):**
> - Upload signed Auftragsverarbeitungsvertrag (AVV) with GitHub Inc. to DPM system ⚠
> - Datenschutzrechtliche Prüfung des AVV vor der Unterzeichnung; Bereitstellung per E-Mail an THD DPM-Büro ⚠
> - Note: Amazon Web Services (AWS) is listed as a Supabase Inc. sub-processor. Since Supabase is self-hosted on the THD VM, AWS is not involved. If the THD VM itself runs on a cloud platform, that provider must be listed here as well. ⚠

---

#### 5.2c Third Parties (Independently Responsible)

| Empfänger (Receiver) | Country | Purpose | Personal Data Shared | Legal Basis | Privacy Policy |
|---|---|---|---|---|---|
| **Google LLC** | USA | Download von Web-Schriften (Google Fonts CDN, `fonts.googleapis.com`) | IP-Adresse des Nutzers bei jedem Seitenaufruf | Art. 6 Abs. 1 UAbs. 1 lit. a DSGVO (Einwilligung) | [policies.google.com/privacy](https://policies.google.com/privacy) |
| **GitHub, Inc. / Microsoft Corporation** | USA | Download der GeoJSON-Ländergrenzen für Kartenansicht (GitHub CDN, `raw.githubusercontent.com`) | IP-Adresse des Nutzers (einmalig pro Sitzung) | Art. 6 Abs. 1 UAbs. 1 lit. a DSGVO (Einwilligung) | [github.com/privacy](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) |
| **ORCID Inc.** | USA | OAuth-Authentifizierung (Forscher-Identität via ORCID iD) | ORCID iD, Forscher-Anzeigename | Art. 6 Abs. 1 UAbs. 1 lit. a DSGVO (Einwilligung) | [info.orcid.org/privacy-policy](https://info.orcid.org/privacy-policy/) |

---

## 7. Transfers of Personal Data to Third Countries or International Organisations

*Relevant where personal data are transferred outside the EEA (Art. 44 ff. DSGVO).*

| Third Country / Int'l Org. | Recipient (incl. sub-processors) | Personal Data Transferred | Transfer Basis (Art. 44 ff. DSGVO) | Suitable Guarantees / Notes |
|---|---|---|---|---|
| **USA** | **GitHub, Inc.** (Microsoft Corporation) | Submitter email in PR metadata; admin GitHub token; IP address (GeoJSON CDN) | Art. 45 DSGVO — EU–US Data Privacy Framework (DPF) adequacy decision (10 July 2023) | DPF certificate confirmed: [dataprivacyframework.gov/list](https://www.dataprivacyframework.gov/list) ✓ — **Empfehlung:** Zusätzlicher Abschluss von EU-Standarddatenschutzklauseln (SCC) inkl. Transfer Impact Assessment (TIA) angesichts der aktuellen Rechtslage ⚠ |
| **USA** | **Microsoft Corporation / Microsoft Azure** (sub-processor of GitHub, Inc.) | Infrastructure processing of all GitHub-hosted data | Art. 45 DSGVO — EU–US DPF (covered under GitHub DPF certificate) | Microsoft DPF certification active ✓ |
| **USA** | **Google LLC** | IP address of user (Google Fonts CDN on every page load) | Art. 45 DSGVO — EU–US Data Privacy Framework (DPF) adequacy decision | **Empfehlung:** Self-hosting der Schriftarten, um Drittlandübermittlung vollständig zu vermeiden; alternativ SCCs + TIA abschließen ⚠ |
| **USA** | **ORCID Inc.** | ORCID iD, researcher display name (OAuth login) | Art. 46 DSGVO — EU Standard Contractual Clauses (SCC) or DPF (verify ORCID DPF certification status) | ⚠ DPF certificate for ORCID Inc. to be verified at [dataprivacyframework.gov/list](https://www.dataprivacyframework.gov/list); if not listed, SCCs + TIA required |
| **USA** | **OpenAI, Inc.** *(optional — currently disabled)* | Paper text extracted from academic PDFs (no personal data) | Art. 45 DSGVO — EU–US DPF / Art. 46 DSGVO — SCCs | Transfer only of non-personal data (paper text); activate only after DPA and TIA are in place ⚠ |
| **Singapore** | **Supabase, Inc.** | **NOT APPLICABLE** | — | Supabase is **self-hosted on the THD university VM** — no personal data is transferred to Supabase, Inc. (Singapore). No adequacy decision exists for Singapore (Art. 45 DSGVO); SCCs would be required if cloud-hosted Supabase were used. Clarification of self-hosted deployment to be submitted to DPM reviewer ⚠ |

> **Hinweis zur aktuellen Rechtslage:** Das EU–US Data Privacy Framework (DPF) ist seit Juli 2023 in Kraft. Angesichts der politischen Unsicherheiten (Executive Order 14086) wird ergänzend der Abschluss von EU-Standarddatenschutzklauseln (SCC, Moduln 2 und/oder 4) inkl. eines Transfer Impact Assessment (TIA) empfohlen, um Rechtskonformität auch bei einem etwaigen Wegfall des DPF sicherzustellen.

---

## 8. Scheduled Deadlines for Deleting the Various Categories of Data

> **Hinweis — Inhaltsdaten (Technologieeinreichungen):** Der Reviewer weist darauf hin, dass Inhaltsdaten in Kap. 3 fehlen. Inhaltsdaten umfassen die von Contributoren eingereichten Technologieparameter (CAPEX, OPEX, Wirkungsgrade etc.) als strukturierte JSON-Nutzlast in `technology_submissions`. Diese sind in Kap. 3.1 unter „Technologieeinreichungen" (Contribution Metadata) zu ergänzen. ⚠

---

**Datenkategorie: Accountdaten**

| Feld | Inhalt |
|---|---|
| **Datenkategorie** | Accountdaten: E-Mail-Adresse, Benutzername, ORCID iD, GitHub-Profildaten (Name, Avatar-URL), Passwort-Hash (nur Admin-Account) |
| **Rechtsgrundlage** | Art. 6 Abs. 1 UAbs. 1 lit. a DSGVO i.V.m. Art. 7 DSGVO (Einwilligung bei Registrierung) |
| **Löschfrist** | Mit Löschung des Nutzerkontos (auf Antrag des Nutzers oder nach festzulegender Inaktivitätsfrist) |

---

**Datenkategorie: Protokolldaten / Server-Log**

| Feld | Inhalt |
|---|---|
| **Datenkategorie** | Server-Zugriffsprotokolle: aufgerufene URL, Zeitstempel, Datenmenge, Referrer, Browser, Betriebssystem, IP-Adresse |
| **Rechtsgrundlage** | Art. 6 Abs. 1 UAbs. 1 lit. e DSGVO i.V.m. Art. 6 Abs. 3 DSGVO, Art. 4 Abs. 1 BayDSG (öffentliche Aufgabe — IT-Sicherheit und Systembetrieb) |
| **Löschfrist** | **Maximal 7 Tage** nach Aufzeichnung; automatische Rotation der Caddy-Logdateien auf dem THD-VM |

---

**Datenkategorie: Endgerätedaten (Client-Side Storage)**

| Feld | Inhalt |
|---|---|
| **Datenkategorie** | `sessionStorage`-Einträge: `opentech_orcid_token` (JWT), `sb-<instance-ref>-auth.session` (Supabase-Sitzungsobjekt) |
| **Rechtsgrundlage** | Art. 6 Abs. 1 UAbs. 1 lit. e DSGVO (öffentliche Aufgabe — sichere Sitzungsverwaltung) |
| **Löschfrist** | Automatisch beim Schließen des Browser-Tabs: ORCID-Token max. 24 Stunden, Supabase-Session ca. 1 Stunde (automatisch erneuert) |

---

**Datenkategorie: Inhaltsdaten / Technologieeinreichungen**

| Feld | Inhalt |
|---|---|
| **Datenkategorie** | Von Contributoren eingereichte Technologieparameter (JSON-Nutzlast: CAPEX, OPEX, Wirkungsgrade etc.) inkl. Benutzer-ID (`user_id`) und E-Mail (`submitter_email`) zur Provenienz-Rückverfolgbarkeit |
| **Rechtsgrundlage** | Art. 6 Abs. 1 UAbs. 1 lit. e DSGVO i.V.m. Art. 6 Abs. 3 DSGVO, Art. 4 Abs. 1 BayDSG, Art. 2 Abs. 1 u. 2 BayHIG (öffentliche Aufgabe — Forschungsdatenverwaltung) |
| **Löschfrist** | Bis zur Entscheidung durch Admin (Genehmigung oder Ablehnung); nach Genehmigung verbleiben die Parameterdaten dauerhaft im Forschungskatalog. Personenbezogene Felder (`submitter_email`, `user_id`) werden bei Kontolöschung anonymisiert (Pseudonymisierung). |

---

**Datenkategorie: Audit-Trail (Prüfprotokoll)**

| Feld | Inhalt |
|---|---|
| **Datenkategorie** | `reviewed_by` (E-Mail des prüfenden Admins), `reviewed_at` (Zeitstempel), `pr_url` in den Tabellen `technology_submissions` und `scraper_candidates`; E-Mail-Adressen des Einreichers in GitHub-Pull-Request-Metadaten und Git-Commit-Historie |
| **Rechtsgrundlage** | Art. 6 Abs. 1 UAbs. 1 lit. e DSGVO (öffentliche Aufgabe — wissenschaftliche Nachvollziehbarkeit und Rechenschaftspflicht) |
| **Löschfrist** | Dauerhaft (Audit-Trail für wissenschaftliche Provenienz) |

> ⚠ **Problem: Recht auf Vergessenwerden vs. dauerhafter Speicherung**  
> E-Mail-Adressen und Namen sind dauerhaft in der Git-Commit-Historie (GitHub-Repository) und im Datenbank-Audit-Trail gespeichert. Das Recht auf Löschung nach Art. 17 DSGVO kann für diese Daten nicht vollständig erfüllt werden.  
>  
> **Empfehlung (eine der folgenden Maßnahmen):**  
> 1. **(Automatische) Pseudonymisierung:** `reviewed_by` und `submitter_email` im Audit-Trail bei Kontolöschung durch einen Pseudonym-/Tombstone-Wert ersetzen (z. B. `[gelöscht-{hash}]`). Für die Git-Historie: keine realen E-Mail-Adressen in Commit-Metadaten verwenden (generische Contributor-E-Mail oder ORCID iD statt persönlicher E-Mail-Adresse).  
> 2. **Begründung der Forschungsausnahme:** Dokumentieren, dass die dauerhafte Speicherung zur Verwirklichung der Forschungsziele der wissenschaftlichen Datenprovenienz (OEO-Konformität, Rückverfolgbarkeit von Katalogentscheidungen) konkret erforderlich ist und die Löschung diese Ziele ernsthaft beeinträchtigen würde (Art. 17 Abs. 3 lit. d DSGVO). ⚠ *Begründung schriftlich zu dokumentieren und dem DPM beizufügen.*

---

**Datenkategorie: Kommunikationsdaten**

| Feld | Inhalt |
|---|---|
| **Datenkategorie** | E-Mail-Anfragen (Absender, Betreff, Inhalt) und GitHub-Issues (GitHub-Benutzername, Issue-Inhalt) |
| **Rechtsgrundlage** | Art. 6 Abs. 1 UAbs. 1 lit. e DSGVO (öffentliche Aufgabe) |
| **Löschfrist** | Nach Abschluss des Vorgangs; spätestens nach 3 Jahren (reguläre Verjährungsfrist gem. §§ 195, 199 BGB) |

---

**Datenkategorie: Scraper-Laufprotokoll**

| Feld | Inhalt |
|---|---|
| **Datenkategorie** | `scraper_runs`: Run-ID, Start-/Endzeit, verarbeitete Technologien, abgerufene Paper, Kandidatenanzahl, Fehler. Enthält keine personenbezogenen Daten. |
| **Rechtsgrundlage** | Art. 6 Abs. 1 UAbs. 1 lit. e DSGVO (öffentliche Aufgabe — Monitoring und Debugging) |
| **Löschfrist** | 12 Monate nach dem jeweiligen Scraper-Lauf (automatische Archivierung geplant) |

---

## 9. Security

### 9.1 Security of Processing (Art. 32 Abs. 1 DSGVO)

The technical and organisational measures (TOMs) implemented to ensure security of processing are documented in detail in **Chapter 17** of this document and must additionally be compiled into a PDF using the THD Word template and uploaded to the DPM system.

> ⚠ **Action required:**
> - Download the appropriate THD TOM Word template (externally hosted system / DIT computer centre template, as applicable for the THD VM deployment)
> - Select and supplement the technical & organisational measures from Chapter 17 of this document
> - Complete the general process information on the last page of the template
> - Generate a PDF and upload it to the DPM system as the official TOM attachment for this processing activity

**Deployment classification:** The application runs on a **THD-managed university VM** (not in the DIT computer centre, not a pure external cloud). Clarify with the ISB which THD TOM template applies (VM/server deployment on university infrastructure). ⚠

---

### 9.2 Home Office / Teleworking

**Determination by VV (Ricardo Miranda):**

| Field | Value |
|---|---|
| **Can this process be used in home office in principle?** | **Yes** — OpenTech-DB is a web application accessible via browser at `https://otdb.th-deg.de`. All user-facing operations (catalogue browsing, technology submission, admin review) are available remotely via HTTPS. VM administration (SSH) requires a THD VPN connection. |
| **Additional TOMs required for home office use?** | Yes — to be agreed with ISB |

**Additional TOMs for home office operation (to be incorporated into the IT security concept):**

| Measure | Description |
|---|---|
| VPN requirement | SSH access to the THD VM for admin/maintenance must be tunnelled via THD VPN; direct SSH exposure to the internet is not permitted |
| Screen lock | Home office workstation must be locked when unattended; no unencrypted data at rest on personal devices |
| No local data copies | No personal data (Supabase database dumps, log files, `.env` secrets) may be stored on personal home office devices |
| Encrypted transmission | Already enforced: all application communication via TLS 1.2+ (Caddy/Let's Encrypt); no unencrypted admin access permitted |
| Sole access | Developer/admin must ensure that no unauthorised persons can view screens or access devices during work sessions |

---

## 10. General Description of Measures Regarding Information Obligations (Art. 13 and Art. 14 DSGVO)

### 10.1 Information Duties

**Selected option: c) — Personal data are collected directly (Art. 13 DSGVO) and indirectly from the data subject (Art. 14 DSGVO)**

| Option | Applies | Reason |
|---|---|---|
| **a) Art. 13** — Data collected directly from data subjects | ✓ | User account registration (email, password hash); ORCID/GitHub OAuth login initiated by the user; server access logs generated by user requests; technology parameter submissions entered by contributors |
| **b) Art. 14** — Data NOT collected directly from data subjects | ✓ | Paper author metadata (names, institutional affiliations) collected by the scraper pipeline from publicly available academic databases (OpenAlex, Crossref, arXiv, Europe PMC) without direct contact with those individuals |
| **c) Both Art. 13 and Art. 14** | ✓ **Selected** | See above |
| d) Processing for a purpose other than collected | ✗ | Not applicable — data is only processed for the stated purposes |
| e) Information duties waived | ✗ | Not applicable |

**Data Protection Information (Datenschutzerklärung / Privacy Policy):**

> ⚠ **Action required:** Create and publish a Datenschutzerklärung accessible on the OpenTech-DB website (e.g., at `https://otdb.th-deg.de/privacy` or as a dedicated page linked in the footer). Generate a PDF printout of this page and upload it to the DPM system.

Once the DPM procedure is finalised, the data protection information will be publicly accessible at:
`https://dpm.th-deg.de/infoduties/e5Re4P`

This link must be referenced in the website Datenschutzerklärung and/or in the footer of every page.

---

### 10.2 Sources of Data Not Collected Directly from the Data Subject (Art. 14 DSGVO)

**b) Data obtained from third parties or publicly available sources:**

| Data Category | Source |
|---|---|
| Paper author metadata (names, institutional affiliations) as part of scraper candidate records (`scraper_candidates`) | OpenAlex (`https://api.openalex.org`) |
| DOI metadata, author information, citation data | Crossref (`https://api.crossref.org`) |
| Preprint author metadata | arXiv (`https://export.arxiv.org/api/query`) |
| Author metadata from life sciences literature | Europe PMC (`https://www.ebi.ac.uk/europepmc/webservices/rest`) |

> **Art. 14(5) Exception — Disproportionate effort / scientific research:**  
> The scraper pipeline is designed to extract energy technology cost parameters, not to profile individuals. Author names appear incidentally in retrieved paper metadata. Given the scale of the academic sources and the scientific research purpose, informing each individual author would require disproportionate effort (Art. 14 Abs. 5 lit. b DSGVO) and the data originates from publicly available sources (Art. 14 Abs. 5 lit. c DSGVO). Rejected scraper candidates are archived and deleted per the retention schedule in Chapter 7.

---

## 11. Privacy Impact Assessment

> **Hinweis des Reviewers:** Die Risikoeinschätzung ist erst final überprüfbar, wenn die Datenkategorien, Drittlandübermittlungen, TOMs, Löschfristen und AV-Verträge vollständig dokumentiert sind. Die folgende Einschätzung ist daher als vorläufig zu verstehen.

### 11.1 Risk Assessment by VV

**Selected: Low risk (geringes Risiko)**

**Begründung der Risikoeinschätzung (VV):**

Die Plattform verarbeitet ausschließlich Standardidentifikationsdaten (E-Mail-Adresse, ORCID iD, GitHub-Profildaten) zur Authentifizierung und wissenschaftlichen Beitragszuordnung. Es werden keine besonderen Kategorien personenbezogener Daten gem. Art. 9 DSGVO verarbeitet. Die Zielgruppe besteht ausschließlich aus erwachsenen Forschern und Wissenschaftlern, die die Konsequenzen der Datenerhebung vollständig einschätzen können. Es findet keine automatisierte Entscheidungsfindung mit erheblichen Auswirkungen auf Betroffene statt. Die Anzahl der betroffenen Personen ist gering. Standardmäßige technische und organisatorische Maßnahmen (HTTPS, JWT-Signaturprüfung, sessionStorage, bcrypt-Hashing, Supabase Row Level Security) sind implementiert.

**Residual risk factors acknowledged (not overriding low-risk classification, but to be monitored):**

| Risk factor | Status |
|---|---|
| Third-country transfers (USA: GitHub, Google, ORCID) | Mitigated by DPF adequacy / SCCs; low residual risk |
| IP address transmission to Google Fonts CDN and GitHub CDN | Consent-based; mitigation: self-hosting planned (Section 15.5) |
| Right to erasure limitation in Git history and audit trail | Addressed in Section 7; pseudonymisation or Art. 17(3)(d) research exception to be formally documented |
| Self-hosted Supabase — backup responsibility on THD IT | VM snapshot schedule to be confirmed with THD IT |

---

### 11.2 Result of the Impact Assessment

**No Data Protection Impact Assessment (DSFA / PIA) required** — processing is classified as low risk.

> If the risk classification is elevated to **high risk** at any point (e.g., due to scope expansion to special categories of data, large-scale processing, or systematic profiling), a full DSFA pursuant to Art. 35 DSGVO must be conducted using the PIA tool recommended by the Bayerischer Landesbeauftragter für den Datenschutz (BayLfD), in the version specified on the BayLfD website.

---

## 12. Client-Side Storage

### 12.1 Cookies

The OpenTech-DB backend sets **no HTTP cookies**. The self-hosted Supabase JS client may set session cookies depending on the GoTrue configuration on the THD VM; this behaviour is controlled by the self-hosted Supabase instance, not the application backend.

**Not Logged In:** No cookies set.

**Logged In:** No cookies set by this application. Self-hosted Supabase-managed cookies (if enabled) carry the session token with `Secure` and `HttpOnly` flags.

### 12.2 Session Storage

All authentication tokens are stored in `sessionStorage`, not `localStorage`. This ensures tokens are automatically cleared when the browser tab is closed — appropriate for shared or public research machines.

**Not Logged In**

No `sessionStorage` entries are set.

**Logged In**

| Key | Example Content | Purpose | Lifetime |
|---|---|---|---|
| `opentech_orcid_token` | HS256 JWT: `{ sub: "0000-0002-…", username: "Jane Smith", auth_provider: "orcid", … }` | Custom auth token for ORCID OAuth and built-in admin login paths | Until browser tab close (max 24 h) |
| `sb-<instance-ref>-auth.session` | Supabase session object: `{ access_token, refresh_token, user: { id, email, … } }` | Supabase auth session for email and GitHub OAuth paths; auto-refreshed while tab is open | Until browser tab close (~1 h, continuously auto-refreshed) |

**In-Memory State (not persisted)**

| Store | Content | Cleared when |
|---|---|---|
| React `AuthContext` | `{ user, token, isLoading, isAdmin }` | Component unmount / page reload |
| Promise cache (`services/api.ts`) | Technology category and detail responses | Page reload or explicit `invalidateAll()` call |
| Zustand `useTechBuilderStore` | Visual tech builder UI state | Page reload |

---

## 13. Data Flow Summary

1. **User registers or logs in** → personal data (email, ORCID iD, or GitHub profile) stored in self-hosted Supabase `auth.users` on the THD VM; a signed JWT is issued (custom HS256 for ORCID/admin, Supabase JWT for email/GitHub)
2. **Auth token stored client-side** → JWT placed in `sessionStorage["opentech_orcid_token"]` or Supabase session key; cleared automatically on browser tab close
3. **User submits a technology** → `user_id` (Supabase UUID or ORCID iD) and `submitter_email` written to self-hosted Supabase `technology_submissions` with status `pending_review`
4. **Admin approves a submission** → GitHub API opens a pull request merging the payload into the JSON catalogue; submission record updated with `status = "approved"`, `reviewed_by`, `reviewed_at`, and `pr_url`
5. **Scraper pipeline runs** (APScheduler, twice monthly) → fetches paper metadata and cost data from academic/regulatory sources; writes extracted candidates to self-hosted Supabase `scraper_candidates`; no user personal data is transmitted externally
6. **Frontend loads map and fonts** → a single GeoJSON request to GitHub CDN (for country boundaries) and font requests to Google Fonts CDN; user IP address is transmitted in both cases

---

## 14. Risks & Mitigations

| Risk | Description | Mitigation |
|---|---|---|
| Google Fonts CDN receives IP address | Every page load sends the user's IP to Google's servers for font delivery | Self-host Space Grotesk, Inter, and Material Symbols to eliminate the external request |
| GitHub CDN receives IP address | Single GeoJSON fetch per session sends IP to GitHub's CDN | Serve `countries.geo.json` from the OpenTech-DB backend (bundle file into `data/` and expose via `/api/v1/geojson/countries`) |
| ORCID placeholder email | The ORCID `/authenticate` scope does not expose the researcher's real email; a synthetic placeholder `{orcid_id}@orcid.org` is generated | Inform ORCID users at login; offer an optional post-login step to provide a real email address |
| Indefinite submission retention | No automatic deletion policy exists for `technology_submissions` or `scraper_candidates` | Define and implement a retention TTL (e.g., archive rejected candidates after 12 months); document in privacy policy |
| JWT secret key exposure | `JWT_SECRET_KEY` and `SUPABASE_JWT_SECRET` are stored in environment variables | Store secrets in Docker Secrets or HashiCorp Vault on the THD VM; rotate quarterly |
| Admin credentials in environment variables | `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` are env-var-based; no UI to rotate them | Use a strong bcrypt hash (cost factor ≥ 12); avoid default credentials; redeploy to rotate; document rotation procedure |
| LLM providers receive paper text | When enabled, OpenAI or Anthropic receive text extracted from academic PDFs | LLM extraction is disabled by default; no user personal data is included in prompts; establish a data processing agreement with the LLM provider before enabling in production |
| Session token in `sessionStorage` | `sessionStorage` is accessible to JavaScript on the same origin (XSS risk) | Enforce a strict `Content-Security-Policy` header; validate all JWT signatures server-side on every authenticated request |

---

## 15. Controller and Processor Roles

### 15.1 Data Controller

| Field | Value |
|---|---|
| **Organisation** | Technische Hochschule Deggendorf (THD) — THD Spatial AI |
| **Contact person** | Ricardo Miranda |
| **Email** | ric.ignaciom@gmail.com |
| **Role** | Data Controller — determines purposes and means of processing |

### 15.2 Data Processors

Third parties that process personal data on behalf of the controller under documented instructions. A Data Processing Agreement (DPA) must be in place before any personal data is transferred to a processor.

> **Note:** Supabase is **self-hosted on the THD VM** and is therefore not a third-party data processor. No personal data is transferred to Supabase, Inc. (US). All Supabase-managed data remains within THD infrastructure.

| Processor | Service | Personal Data Transferred | DPA Status | Legal Safeguard (if outside EEA) |
|---|---|---|---|---|
| **GitHub, Inc. / Microsoft** (US) | Git repository, Pull Request API, CDN (GeoJSON) | IP address (CDN), submitter email in PR metadata, admin GitHub token | GitHub Data Protection Agreement | EU–US Data Privacy Framework adequacy |
| **Google LLC** (US) | Fonts CDN | IP address | No explicit DPA for Fonts CDN public endpoint | EU–US Data Privacy Framework adequacy |
| **OpenAI, Inc.** (US) — *optional/disabled* | LLM parameter extraction | Paper text only — **no personal data** | OpenAI API data processing addendum | EU–US Data Privacy Framework adequacy |

> **Action required:** Before enabling the OpenAI/Anthropic LLM extraction feature in a production environment, confirm a Data Processing Agreement is signed and the processing is recorded in this document.

### 15.3 Internal Infrastructure

Since Supabase is self-hosted, all database operations are processed within THD infrastructure under THD's direct control. No sub-processor agreements with external cloud vendors are required for the database layer.

| Component | Location | Control |
|---|---|---|
| Self-hosted Supabase (PostgreSQL + GoTrue) | THD university VM (Docker container) | THD-managed |
| JSON technology catalogue (`data/`) | THD university VM (Docker named volume) | THD-managed |
| FastAPI backend | THD university VM (Docker container) | THD-managed |
| React frontend | THD university VM (Docker container, served by nginx) | THD-managed |

---

## 16. Data Subject Rights

Under Chapter III of the GDPR, data subjects (registered users of OpenTech-DB) hold the following rights. Requests must be responded to within **one calendar month** (Art. 12(3) GDPR); this may be extended by two further months for complex or numerous requests, with written notice to the data subject.

**How to submit a request:** Data subjects contact the controller at **ric.ignaciom@gmail.com** with the subject line `[OpenTech-DB] Data Subject Request`. Identity will be verified against the registered email address or ORCID iD before any data is released or deleted.

| Right | Article | Scope within OpenTech-DB | Fulfilment procedure |
|---|---|---|---|
| **Right of access** | Art. 15 | User may request a copy of all personal data held: Supabase `auth.users` record, all rows in `technology_submissions` linked to their `user_id`, admin review metadata | Controller exports the data via the self-hosted Supabase admin interface and provides it in a machine-readable format (JSON) within one month |
| **Right to rectification** | Art. 16 | User may correct their display name, email address, or ORCID iD | Controller updates the relevant Supabase record; JWT re-issued if email changes |
| **Right to erasure** | Art. 17 | User may request deletion of their account and associated personal data | Controller deletes the Supabase `auth.users` record; submission records are anonymised (nullify `submitter_email`, replace `user_id` with a tombstone value) rather than hard-deleted, to preserve catalogue audit trail. Residual audit trail is retained under Art. 17(3)(b) (statistical/scientific purpose and legitimate interest) |
| **Right to restriction** | Art. 18 | User may request that their data not be actively processed while a dispute is pending | Controller marks the user record as `restricted` and suspends any processing beyond storage |
| **Right to data portability** | Art. 20 | Applies to data provided by the data subject (account profile, technology submissions) | Controller provides data as a structured JSON export |
| **Right to object** | Art. 21 | Applies to processing based on public task (Art. 6(1)(e)): authentication metadata, scraper audit logs, admin review audit | Controller assesses whether compelling grounds override the objection; if not, processing is ceased |
| **Right not to be subject to automated decisions** | Art. 22 | No solely automated decisions producing legal or similarly significant effects are made in OpenTech-DB | N/A — the scraper pipeline produces *candidates* that require human admin review before any effect on the catalogue |

**Complaints:** Data subjects who consider that processing infringes the GDPR may lodge a complaint with the competent supervisory authority. For Bavaria (Germany): **Bayerisches Landesamt für Datenschutzaufsicht (BayLDA)**, Promenade 18, 91522 Ansbach — [www.lda.bayern.de](https://www.lda.bayern.de).

---

## 17. Technical and Organisational Measures (TOMs)

Measures implemented to ensure a level of security appropriate to the risk (Art. 32 GDPR). This section is the source reference for the TOM PDF to be uploaded under Section 9.1.

### 17.1 Confidentiality

| Measure | Implementation |
|---|---|
| Encryption in transit | All external communication uses HTTPS/TLS 1.2+. The FastAPI backend is deployed behind a Caddy reverse proxy with automatic TLS termination (Let's Encrypt) |
| Encryption at rest | THD VM disk encryption managed by THD IT infrastructure; self-hosted Supabase PostgreSQL data at rest is protected by OS-level disk encryption on the VM |
| Access control — backend | Role-based: `is_admin` and `is_contributor` flags in JWT claims; server-side validation on every authenticated endpoint. Admin endpoints reject non-admin tokens with HTTP 403 |
| Access control — database | Supabase Row Level Security (RLS) policies restrict data access by `auth.uid()`. The service-role key (bypasses RLS) is held only on the backend; never exposed to the frontend |
| Secrets management | `JWT_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD_HASH`, `ORCID_CLIENT_SECRET`, `GITHUB_TOKEN` are stored as environment variables / Docker secrets — never committed to the repository |
| Password hashing | Built-in admin password stored as bcrypt hash (cost factor ≥ 12). No plaintext passwords stored anywhere |
| Session lifetime | Custom JWTs expire after 24 hours. Supabase tokens expire after ~1 hour (auto-refreshed). All tokens are stored in `sessionStorage` and cleared on browser tab close |

### 17.2 Integrity

| Measure | Implementation |
|---|---|
| Input validation | All API request bodies validated by Pydantic v2 models before processing; invalid payloads rejected with HTTP 422 |
| JWT signature verification | Every authenticated request validates the JWT signature server-side using `JWT_SECRET_KEY`; expired or tampered tokens are rejected |
| Contribution workflow | Scraper-sourced and user-submitted technology data require explicit admin approval before merging into the JSON catalogue; no automated writes to the catalogue |
| Audit trail | `technology_submissions` and `scraper_candidates` record `reviewed_by` (admin email) and `reviewed_at` timestamp for every approval or rejection decision |

### 17.3 Availability

| Measure | Implementation |
|---|---|
| Database | Self-hosted Supabase PostgreSQL is backed up via scheduled VM snapshots and Docker volume exports managed by THD IT |
| JSON catalogue | `data/` directory is version-controlled in Git; full history of catalogue changes is retained |
| Scraper resilience | Pipeline errors are caught per-source; a single-source failure does not abort the full run. Errors are logged to `scraper_runs.errors` |

### 17.4 Resilience and Recovery

| Measure | Implementation |
|---|---|
| Stateless backend | FastAPI backend is stateless (session data held client-side); any instance can be restarted without loss of user sessions beyond the active tab |
| Cache invalidation | In-memory LRU cache can be cleared via `POST /debug/reload` without a full service restart |
| Incident response | In the event of a suspected personal data breach, the controller will notify BayLDA within 72 hours (Art. 33 GDPR) and affected data subjects without undue delay if high risk is identified (Art. 34 GDPR) |

### 17.5 Measures Not Yet Implemented (Planned)

| Measure | Priority | Notes |
|---|---|---|
| Content-Security-Policy header | High | Mitigates XSS risk to `sessionStorage` tokens; implement in Caddy reverse proxy config |
| Self-hosted fonts | Medium | Eliminates Google Fonts CDN IP address transfer |
| Self-hosted GeoJSON | Medium | Eliminates GitHub CDN IP address transfer; serve from `/api/v1/geojson/countries` |
| Secrets manager | Medium | Move secrets from env vars to Docker Secrets or HashiCorp Vault on THD VM |
| Retention TTL for rejected candidates | Low | Auto-archive rejected scraper candidates after 12 months |

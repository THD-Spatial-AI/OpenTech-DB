# Data Protection Documentation — OpenTech | DB

*Comprehensive DPM-compliant documentation of collected data, external sources, and client-side storage*

---

## 1. General Information

| Field | Value |
|---|---|
| **System / Application** | OpenTech-DB |
| **Module** | Web Application (FastAPI Backend + React 19 SPA + Supabase Auth + Scraper Pipeline) |
| **Prepared by** | Ricardo Miranda - THD Spatial AI |
| **Date** | 2026-06-17 |
| **Version** | 1.1 |

**Purpose of Processing:** Operation of an OEO-aligned (Open Energy Ontology) energy technology parameter database including user authentication, technology catalogue management, automated parameter extraction from academic and regulatory sources, and export to energy modelling frameworks.

---

## 2. Categories of Personal Data Processed

### 2.1 User-Provided Data

| Data Category | Specific Fields | Purpose of Processing | Legal Basis | Storage Location | Retention |
|---|---|---|---|---|---|
| Identification Data | Email, ORCID iD | Account creation, login, communication | Art. 6(1)(b) GDPR (contract) | Supabase `auth.users` | Until account deletion |
| Profile Data | Display name, username | UI personalization, contributor attribution | Art. 6(1)(b) GDPR | Supabase `auth.users.user_metadata` | Until account deletion |
| OAuth Provider Data (GitHub) | Name, avatar URL | GitHub sign-in identity | Art. 6(1)(b) GDPR | Supabase `auth.users.user_metadata` | Until account deletion |
| Contribution Metadata | Email, user ID (Supabase UUID or ORCID iD), technology payload | Technology submission workflow; traceability of catalogue contributions | Art. 6(1)(b) GDPR | Supabase `technology_submissions` | Until admin review; audit trail retained indefinitely |
| Admin Review Audit | `reviewed_by` (admin email), `reviewed_at` | Accountability for catalogue data decisions | Art. 6(1)(f) GDPR (legitimate interest) | Supabase `technology_submissions`, `scraper_candidates` | Indefinite (audit trail) |

### 2.2 System-Generated Data

| Data Category | Specific Fields | Purpose | Legal Basis | Storage Location | Retention |
|---|---|---|---|---|---|
| Authentication Metadata | JWT claims: `sub`, `iat`, `exp`, `auth_provider`, `is_admin`, `is_contributor` | Secure session management, role-based access control | Art. 6(1)(f) GDPR | `sessionStorage` (client-side) | Until browser tab close (24 h max) |
| Supabase Session Metadata | Access token, refresh token, user object | Token auto-refresh while session is active | Art. 6(1)(f) GDPR | `sessionStorage` (Supabase JS SDK) | Until browser tab close (~1 h; auto-refreshed) |
| Scraper Run Audit | Run ID, start/finish timestamps, technologies processed, papers fetched, candidate count, errors | Pipeline monitoring and debugging | Art. 6(1)(f) GDPR | Supabase `scraper_runs` | Indefinite |
| In-Memory Promise Cache | Technology JSON responses keyed by category/ID | Request deduplication and UI performance | Art. 6(1)(f) GDPR | Browser memory (React context) | Until page reload |

---

## 3. External Data Sources & Third-Party Services

### 3.1 Geospatial Data (External Requests)

The application fetches country boundary data once per session to render the World Map and 3D Globe views. No raster tile providers are used, only GeoJSON polygon boundaries are loaded.

> **Note:** No background map tiles are requested. The 2D map (Leaflet) and 3D globe (globe.gl / Three.js) render entirely from the GeoJSON polygons, so IP addresses are **not** repeatedly sent to tile CDNs during normal use.

| Provider | URL Pattern | Data Type | Personal Data Shared | Legal Basis |
|---|---|---|---|---|
| Natural Earth / GitHub CDN | `https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json` | Country polygon boundaries (GeoJSON) | IP address (single request per session) | Art. 6(1)(f) GDPR |

### 3.2 Authentication Providers

| Provider | Endpoint(s) | Data Shared | Legal Basis |
|---|---|---|---|
| ORCID OAuth | `https://orcid.org/oauth/authorize`, `https://orcid.org/oauth/token` | ORCID iD, researcher display name | Art. 6(1)(b) GDPR |
| Supabase Auth | `https://<project-ref>.supabase.co` | Email address, bcrypt-hashed password (email path); GitHub profile data (OAuth path) | Art. 6(1)(b) GDPR |
| GitHub OAuth (via Supabase) | `https://github.com/login/oauth/authorize` | GitHub email, display name, avatar URL | Art. 6(1)(b) GDPR |

**Authentication configuration details:**

| Component | Description |
|---|---|
| Custom JWT algorithm | HS256, signed with `JWT_SECRET_KEY` |
| Custom JWT lifetime | 24 hours (ORCID and built-in admin paths) |
| Supabase JWT lifetime | ~1 hour, auto-refreshed by Supabase JS SDK |
| Token persistence | `sessionStorage` (cleared on browser tab close) |
| Protocol mappers (custom JWT) | `sub` (ORCID iD or "admin"), `username`, `email`, `auth_provider`, `is_contributor`, `is_admin` |
| Data stored server-side | User profile, role flags (`is_admin`, `is_contributor`) in Supabase `auth.users` |

### 3.3 Scraper Pipeline — Academic & Regulatory Sources

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

### 3.4 Content Delivery — Web Fonts

The frontend loads web fonts from Google's CDN on every page load. The user's IP address is transmitted as part of the HTTP request.

| Provider | URL Pattern | Data Type | Personal Data Shared | Legal Basis |
|---|---|---|---|---|
| Google Fonts | `https://fonts.googleapis.com/css2?family=Space+Grotesk…` | Space Grotesk, Inter, Material Symbols Outlined | IP address | Art. 6(1)(f) GDPR |

> **Note:** All font providers require standard HTTP requests and will receive the user's IP address. Consider self-hosting fonts to eliminate this data transfer.

### 3.5 Backend Integration Services

These services are called server-side by the FastAPI backend, not directly from the browser.

| Service | Purpose | Personal Data Shared | Legal Basis |
|---|---|---|---|
| Supabase PostgreSQL | Stores technology submissions and scraper candidates | `user_id`, `submitter_email`, full submission payload | Art. 6(1)(b) GDPR |
| GitHub API (`api.github.com`) | Opens pull requests when an admin approves a contribution; merges payload into JSON catalogue | Submitter email (in PR metadata), admin GitHub token | Art. 6(1)(f) GDPR |
| OpenAI API (optional) | LLM-based extraction of parameters from academic PDFs | Paper text only — no user personal data | Art. 6(1)(f) GDPR |


---

## 4. Client-Side Storage

### 4.1 Cookies

The OpenTech-DB backend sets **no HTTP cookies**. The Supabase JS client may optionally set session cookies depending on the Supabase project configuration; this behaviour is controlled by Supabase, not by the application backend.

**Not Logged In:** No cookies set.

**Logged In:** No cookies set by this application. Supabase-managed cookies (if enabled in the Supabase project dashboard) would carry the session token with `Secure` and `HttpOnly` flags.

### 4.2 Session Storage

All authentication tokens are stored in `sessionStorage`, not `localStorage`. This ensures tokens are automatically cleared when the browser tab is closed — appropriate for shared or public research machines.

**Not Logged In**

No `sessionStorage` entries are set.

**Logged In**

| Key | Example Content | Purpose | Lifetime |
|---|---|---|---|
| `opentech_orcid_token` | HS256 JWT: `{ sub: "0000-0002-…", username: "Jane Smith", auth_provider: "orcid", … }` | Custom auth token for ORCID OAuth and built-in admin login paths | Until browser tab close (max 24 h) |
| `sb-<project-ref>-auth.session` | Supabase session object: `{ access_token, refresh_token, user: { id, email, … } }` | Supabase auth session for email and GitHub OAuth paths; auto-refreshed while tab is open | Until browser tab close (~1 h, continuously auto-refreshed) |

**In-Memory State (not persisted)**

| Store | Content | Cleared when |
|---|---|---|
| React `AuthContext` | `{ user, token, isLoading, isAdmin }` | Component unmount / page reload |
| Promise cache (`services/api.ts`) | Technology category and detail responses | Page reload or explicit `invalidateAll()` call |
| Zustand `useTechBuilderStore` | Visual tech builder UI state | Page reload |

---

## 5. Data Flow Summary

1. **User registers or logs in** → personal data (email, ORCID iD, or GitHub profile) stored in Supabase `auth.users`; a signed JWT is issued (custom HS256 for ORCID/admin, Supabase JWT for email/GitHub)
2. **Auth token stored client-side** → JWT placed in `sessionStorage["opentech_orcid_token"]` or Supabase session key; cleared automatically on browser tab close
3. **User submits a technology** → `user_id` (Supabase UUID or ORCID iD) and `submitter_email` written to Supabase `technology_submissions` with status `pending_review`
4. **Admin approves a submission** → GitHub API opens a pull request merging the payload into the JSON catalogue; submission record updated with `status = "approved"`, `reviewed_by`, `reviewed_at`, and `pr_url`
5. **Scraper pipeline runs** (APScheduler, twice monthly) → fetches paper metadata and cost data from academic/regulatory sources; writes extracted candidates to Supabase `scraper_candidates`; no user personal data is transmitted externally
6. **Frontend loads map and fonts** → a single GeoJSON request to GitHub CDN (for country boundaries) and font requests to Google Fonts CDN; user IP address is transmitted in both cases

---

## 6. Risks & Mitigations

| Risk | Description | Mitigation |
|---|---|---|
| Google Fonts CDN receives IP address | Every page load sends the user's IP to Google's servers for font delivery | Self-host Space Grotesk, Inter, and Material Symbols to eliminate the external request |
| GitHub CDN receives IP address | Single GeoJSON fetch per session sends IP to GitHub's CDN | Serve `countries.geo.json` from the OpenTech-DB backend (bundle file into `data/` and expose via `/api/v1/geojson/countries`) |
| ORCID placeholder email | The ORCID `/authenticate` scope does not expose the researcher's real email; a synthetic placeholder `{orcid_id}@orcid.org` is generated | Inform ORCID users at login; offer an optional post-login step to provide a real email address |
| Indefinite submission retention | No automatic deletion policy exists for `technology_submissions` or `scraper_candidates` | Define and implement a retention TTL (e.g., archive rejected candidates after 12 months); document in privacy policy |
| JWT secret key exposure | `JWT_SECRET_KEY` and `SUPABASE_JWT_SECRET` are stored in environment variables | Store secrets in a secrets manager (e.g., Supabase Vault, GitHub Secrets, or Vault by HashiCorp); rotate quarterly |
| Admin credentials in environment variables | `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` are env-var-based; no UI to rotate them | Use a strong bcrypt hash (cost factor ≥ 12); avoid default credentials; redeploy to rotate; document rotation procedure |
| LLM providers receive paper text | When enabled, OpenAI or Anthropic receive text extracted from academic PDFs | LLM extraction is disabled by default; no user personal data is included in prompts; establish a data processing agreement with the LLM provider before enabling in production |
| Session token in `sessionStorage` | `sessionStorage` is accessible to JavaScript on the same origin (XSS risk) | Enforce a strict `Content-Security-Policy` header; validate all JWT signatures server-side on every authenticated request |

---

## 7. Controller and Processor Roles

### 7.1 Data Controller

| Field | Value |
|---|---|
| **Organisation** | Technische Hochschule Deggendorf (THD) — THD Spatial AI |
| **Contact person** | Ricardo Miranda |
| **Email** | ric.ignaciom@gmail.com |
| **Role** | Data Controller — determines purposes and means of processing |

### 7.2 Data Processors

Third parties that process personal data on behalf of the controller under documented instructions. A Data Processing Agreement (DPA) must be in place before any personal data is transferred to a processor.

| Processor | Service | Personal Data Transferred | DPA Status | Legal Safeguard (if outside EEA) |
|---|---|---|---|---|
| **Supabase, Inc.** (US) | Auth, PostgreSQL database | Email, display name, GitHub profile, ORCID iD, submission payloads, admin review metadata | Supabase standard DPA (accepted via Terms of Service) | EU Standard Contractual Clauses (Supabase ToS, Annex) |
| **GitHub, Inc. / Microsoft** (US) | CDN (GeoJSON), Git repository, Pull Request API | IP address (CDN), submitter email in PR metadata, admin GitHub token | GitHub Data Protection Agreement (enterprise) | EU–US Data Privacy Framework adequacy |
| **Google LLC** (US) | Fonts CDN | IP address | Google Workspace DPA (if applicable); no explicit DPA for Fonts CDN public endpoint | EU–US Data Privacy Framework adequacy |
| **OpenAI, Inc.** (US) — *optional/disabled* | LLM parameter extraction | Paper text only — **no personal data** | OpenAI API data processing addendum | EU–US Data Privacy Framework adequacy |

> **Action required:** Before enabling the OpenAI/Anthropic LLM extraction feature in a production environment, confirm a Data Processing Agreement is signed and the processing is recorded in this document.

### 7.3 Sub-processors (Supabase)

Supabase's sub-processor list is published at [supabase.com/legal/privacy](https://supabase.com/legal/privacy). Key sub-processors relevant to this system: AWS (database hosting), Cloudflare (CDN/DDoS), Fly.io (edge functions). The controller acknowledges these sub-processors via acceptance of Supabase's Terms of Service.

---

## 8. Data Subject Rights

Under Chapter III of the GDPR, data subjects (registered users of OpenTech-DB) hold the following rights. Requests must be responded to within **one calendar month** (Art. 12(3) GDPR); this may be extended by two further months for complex or numerous requests, with written notice to the data subject.

**How to submit a request:** Data subjects contact the controller at **ric.ignaciom@gmail.com** with the subject line `[OpenTech-DB] Data Subject Request`. Identity will be verified against the registered email address or ORCID iD before any data is released or deleted.

| Right | Article | Scope within OpenTech-DB | Fulfilment procedure |
|---|---|---|---|
| **Right of access** | Art. 15 | User may request a copy of all personal data held: Supabase `auth.users` record, all rows in `technology_submissions` linked to their `user_id`, admin review metadata | Controller exports the data via Supabase dashboard and provides it in a machine-readable format (JSON) within one month |
| **Right to rectification** | Art. 16 | User may correct their display name, email address, or ORCID iD | Controller updates the relevant Supabase record; JWT re-issued if email changes |
| **Right to erasure** | Art. 17 | User may request deletion of their account and associated personal data | Controller deletes the Supabase `auth.users` record; submission records are anonymised (nullify `submitter_email`, replace `user_id` with a tombstone value) rather than hard-deleted, to preserve catalogue audit trail. Residual audit trail is retained under Art. 17(3)(b) (statistical/scientific purpose and legitimate interest) |
| **Right to restriction** | Art. 18 | User may request that their data not be actively processed while a dispute is pending | Controller marks the user record as `restricted` and suspends any processing beyond storage |
| **Right to data portability** | Art. 20 | Applies to data provided by the data subject under contract (Art. 6(1)(b)): account profile, technology submissions | Controller provides data as a structured JSON export |
| **Right to object** | Art. 21 | Applies to processing based on legitimate interest (Art. 6(1)(f)): authentication metadata, scraper audit logs, admin review audit | Controller assesses whether compelling grounds override the objection; if not, processing is ceased |
| **Right not to be subject to automated decisions** | Art. 22 | No solely automated decisions producing legal or similarly significant effects are made in OpenTech-DB | N/A — the scraper pipeline produces *candidates* that require human admin review before any effect on the catalogue |

**Complaints:** Data subjects who consider that processing infringes the GDPR may lodge a complaint with the competent supervisory authority. For Bavaria (Germany): **Bayerisches Landesamt für Datenschutzaufsicht (BayLDA)**, Promenade 18, 91522 Ansbach — [www.lda.bayern.de](https://www.lda.bayern.de).

---

## 9. Technical and Organisational Measures (TOMs)

Measures implemented to ensure a level of security appropriate to the risk (Art. 32 GDPR).

### 9.1 Confidentiality

| Measure | Implementation |
|---|---|
| Encryption in transit | All external communication uses HTTPS/TLS 1.2+. Supabase endpoints enforce TLS. The FastAPI backend must be deployed behind a reverse proxy (nginx/Caddy) with TLS termination |
| Encryption at rest | Supabase PostgreSQL storage is encrypted at rest by the cloud provider (AWS AES-256) |
| Access control — backend | Role-based: `is_admin` and `is_contributor` flags in JWT claims; server-side validation on every authenticated endpoint. Admin endpoints reject non-admin tokens with HTTP 403 |
| Access control — database | Supabase Row Level Security (RLS) policies restrict data access by `auth.uid()`. The service-role key (bypasses RLS) is held only on the backend; never exposed to the frontend |
| Secrets management | `JWT_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD_HASH`, `ORCID_CLIENT_SECRET`, `GITHUB_TOKEN` are stored as environment variables / deployment secrets — never committed to the repository |
| Password hashing | Built-in admin password stored as bcrypt hash (cost factor ≥ 12). No plaintext passwords stored anywhere |
| Session lifetime | Custom JWTs expire after 24 hours. Supabase tokens expire after ~1 hour (auto-refreshed). All tokens are stored in `sessionStorage` and cleared on browser tab close |

### 9.2 Integrity

| Measure | Implementation |
|---|---|
| Input validation | All API request bodies validated by Pydantic v2 models before processing; invalid payloads rejected with HTTP 422 |
| JWT signature verification | Every authenticated request validates the JWT signature server-side using `JWT_SECRET_KEY`; expired or tampered tokens are rejected |
| Contribution workflow | Scraper-sourced and user-submitted technology data require explicit admin approval before merging into the JSON catalogue; no automated writes to the catalogue |
| Audit trail | `technology_submissions` and `scraper_candidates` record `reviewed_by` (admin email) and `reviewed_at` timestamp for every approval or rejection decision |

### 9.3 Availability

| Measure | Implementation |
|---|---|
| Database | Supabase provides automated daily backups with point-in-time recovery (Pro plan) |
| JSON catalogue | `data/` directory is version-controlled in Git; full history of catalogue changes is retained |
| Scraper resilience | Pipeline errors are caught per-source; a single-source failure does not abort the full run. Errors are logged to `scraper_runs.errors` |

### 9.4 Resilience and Recovery

| Measure | Implementation |
|---|---|
| Stateless backend | FastAPI backend is stateless (session data held client-side); any instance can be restarted without loss of user sessions beyond the active tab |
| Cache invalidation | In-memory LRU cache can be cleared via `POST /debug/reload` without a full service restart |
| Incident response | In the event of a suspected personal data breach, the controller will notify BayLDA within 72 hours (Art. 33 GDPR) and affected data subjects without undue delay if high risk is identified (Art. 34 GDPR) |

### 9.5 Measures Not Yet Implemented (Planned)

| Measure | Priority | Notes |
|---|---|---|
| Content-Security-Policy header | High | Mitigates XSS risk to `sessionStorage` tokens; implement in reverse proxy config |
| Self-hosted fonts | Medium | Eliminates Google Fonts CDN IP address transfer |
| Self-hosted GeoJSON | Medium | Eliminates GitHub CDN IP address transfer |
| Secrets manager | Medium | Move secrets from env vars to Supabase Vault or equivalent |
| Retention TTL for rejected candidates | Low | Auto-archive after 12 months |

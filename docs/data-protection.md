# Data Protection Documentation — OpenTech | DB

*Comprehensive DPM-compliant documentation of collected data, external sources, and client-side storage*

---

## 1. General Information

| Field | Value |
|---|---|
| **System / Application** | OpenTech-DB |
| **Module** | Web Application (FastAPI Backend + React 19 SPA + Supabase Auth + Scraper Pipeline) |
| **Prepared by** | Ricardo Miranda - THD Spatial AI |
| **Date** | 2026-06-15 |
| **Version** | 1.0 |

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

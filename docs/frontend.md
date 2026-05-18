# Web Frontend

The `frontend/` directory contains a React 19 SPA built with Vite 8, TypeScript, TailwindCSS, ECharts, and Leaflet.

---

## Start the dev server

```bash
cd frontend
npm install
npm run dev    # http://localhost:5173
```

---

## Views and components

### Main catalogue (`TechGrid` + `TechCard`)

Entry point for browsing 55+ technologies. The **SideNavBar** allows filtering by category (`generation`, `storage`, `transmission`, `conversion`). The **TopNavBar** provides a full-text search bar. Results are paginated and displayed in a responsive grid.

- **`TechGrid.tsx`** — fetches a category's technologies using React 19 `use()` inside a `<Suspense>` boundary; uses `useDeferredValue` on the search query for non-blocking typing.
- **`TechCard.tsx`** — summary card: name, category badge, OEO URI link, instance count. Click opens `DetailsModal`.

### Technology detail (`DetailsModal` + `TechCharts`)

Full parameter view opened as a modal overlay:

- **Instances table** — all manufacturer/vintage variants with CAPEX, efficiency, lifetime, CO₂ factor.
- **ECharts bar charts** — side-by-side comparison of CAPEX (USD/kW), efficiency (%), and lifetime (years) across instances.
- **Adapter tabs** — copy-ready Calliope YAML or PyPSA dict for the selected instance.
- **Share button** — copies a `/technologies/{id}` deep-link using `useOptimistic` for instant feedback.

### Time-series viewer (`TimeSeriesCatalogue` + `ProfileViewer`)

Browse and visualise the hourly profile catalogue:

- List of all profiles: type, resolution, country, carrier, year, number of timesteps.
- Filter by profile type or location.
- Click a profile to open **`ProfileViewer`** — an ECharts line chart of the 8 760-step series.
- **`UploadProfile`** — contributor form: upload CSV or JSON with a location picker (`MapPickerModal` using Leaflet).

### World map view (`WorldMapView` + `TechGeoMap` + `CountryPanel`)

Geographic overview of technology instances:

- **`WorldMapView.tsx`** — zoom-able Leaflet map displaying pins per country where data originates from.
- **`TechGeoMap.tsx`** — clusters technology instances by country; click opens `CountryPanel`.
- **`CountryPanel.tsx`** — side panel listing all technologies with instances in a selected country, with links to full detail modals.

### Contributor workspace (`ContributorWorkspace`)

Authenticated researchers can:

1. Submit a new technology record via `AddTechnology` — multi-step form built with `InstanceSubForm` and `visual-builder/`.
2. Upload a new time-series profile via `UploadProfile`.
3. Pick a geographic location via `MapPickerModal` (Leaflet map).

Submissions enter admin review queue before becoming public.

### Admin panel (`AdminPanel` + `ScraperPanel`)

Guarded by `isAdmin` flag in `AuthContext`. Two sub-panels:

- **`AdminPanel.tsx`** — review pending technology and time-series submissions (approve / reject with notes).
- **`ScraperPanel.tsx`** — display current scraper pipeline status, trigger manual runs, browse scraped candidates, and approve/reject individual parameter extractions for merging into the catalogue.

### Authentication (`AuthPage` + `OAuthCallback`)

Three login methods:

1. **ORCID OAuth** — redirects to `orcid.org`; callback stores JWT in `sessionStorage`.
2. **Supabase email / password** — standard credential login.
3. **GitHub OAuth via Supabase** — one-click social login.

`AuthContext.tsx` provides the global `user`, `token`, and `isAdmin` state across the entire SPA.

---

## State management

| Mechanism | Used for |
|---|---|
| **`AuthContext`** (React Context) | JWT, user identity, `isAdmin` flag |
| **Zustand store** | Active category, search query, UI state (modal open/closed) |
| **React 19 `use()` + Promise cache** | Async data fetching with Suspense (no loading spinners) |
| **`useDeferredValue`** | Non-blocking search input — keeps grid visible while typing |
| **`startTransition`** | Smooth category switches without blocking the UI |
| **`useOptimistic`** | Instant share-button feedback before async completes |

---

## API client (`services/api.ts`)

The API client is a thin wrapper that:

1. **Memoises in-flight Promise objects** — identical calls within the same render cycle return the same Promise, preventing duplicate requests.
2. **Exposes Promises directly** — designed for React 19 `use()` inside `<Suspense>`, eliminating the need for `useEffect`/`useState` data-fetching boilerplate.
3. **Provides manual cache invalidation** — call `invalidateCategory()` or `invalidateAll()` after a data mutation.

---

## Environment variables

Create `frontend/.env.local`:

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

---

## Production build

```bash
cd frontend
npm run build    # TypeScript check + Vite bundle → frontend/dist/
npm run preview  # Serve dist/ locally for smoke-testing
```

Serve `frontend/dist/` with any static file server (nginx, Caddy, Vercel, GitHub Pages, Render static site, etc.).

---

## Tech stack

| Library | Version | Role |
|---|---|---|
| React | 19 | UI framework — Server Components pattern, `use()`, `startTransition` |
| Vite | 8 | Build tool and dev server (hot-module replacement) |
| TypeScript | 5.9 | Type safety across all components and services |
| TailwindCSS | 3.4 | Utility-first styling (Material Design 3 colour tokens) |
| ECharts | 6.x | Bar charts (CAPEX, efficiency) and line charts (time-series) |
| Leaflet | 1.9 | Interactive world map and location picker |
| Zustand | 5.x | Minimal global state management |
| Supabase JS | 2.x | Auth sessions (email, GitHub, ORCID via JWT) |

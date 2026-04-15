# Web Frontend

The `frontend/` directory contains a React 19 SPA built with Vite 8, TailwindCSS, ECharts, and Leaflet.

---

## Start the dev server

```bash
cd frontend
npm install
npm run dev    # http://localhost:5173
```

---

## Key views

| View | Component | Description |
|---|---|---|
| Technology catalogue | `TechGrid` + `TechCard` | Browse all 55+ technologies by category. Supports search and category filtering. |
| Technology detail | `DetailsModal` + `TechCharts` | Full instance table and ECharts bar charts (CAPEX, efficiency, lifetime). |
| Time-series | `TimeSeriesCatalogue` + `ProfileViewer` | Browse hourly profiles; view as ECharts line chart. |
| Contributor | `ContributorWorkspace` + `UploadProfile` + `MapPickerModal` | Submit new technologies or profiles. Includes a Leaflet map for location selection. |
| Admin | `AdminPanel` | Review and approve/reject pending submissions (admin only). |
| Auth | `AuthPage` + `OAuthCallback` | ORCID OAuth and Supabase email/GitHub login. |

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
npm run build    # outputs to frontend/dist/
```

Serve `frontend/dist/` with any static file server (nginx, Caddy, GitHub Pages, Vercel, etc.).

---

## Tech stack

| Library | Role |
|---|---|
| React 19 | UI framework |
| Vite 8 | Build tool and dev server |
| TypeScript | Type safety |
| TailwindCSS | Styling |
| ECharts | Charts (CAPEX, efficiency, time-series) |
| Leaflet | Interactive map (profile location picker) |
| Zustand | State management |
| Supabase JS v2 | Auth sessions |

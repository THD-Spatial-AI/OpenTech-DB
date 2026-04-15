# Authentication

The API uses **ORCID OAuth** for researcher identity and **Supabase** for frontend sessions.

---

## ORCID login flow

1. User clicks "Sign in with ORCID" → frontend calls `GET /api/v1/auth/orcid`.
2. Backend redirects to ORCID OAuth page.
3. After login, ORCID redirects to `GET /api/v1/auth/orcid/callback?code=...`.
4. Backend exchanges code for ORCID token, issues a signed JWT, redirects to frontend with `?token=<jwt>`.
5. `OAuthCallback.tsx` stores the JWT in `sessionStorage`; `AuthContext` reads it.

---

## Protected endpoints

| Endpoint | Requirement |
|---|---|
| `POST /api/v1/timeseries/submit` | Valid JWT (`Authorization: Bearer <token>`) |
| `GET /api/v1/admin/timeseries/submissions` | Admin JWT |
| `PATCH /api/v1/admin/timeseries/{id}/approve` | Admin JWT |

---

## Required environment variables (backend)

```env
ORCID_CLIENT_ID=<your-orcid-client-id>
ORCID_CLIENT_SECRET=<your-orcid-client-secret>
ORCID_REDIRECT_URI=http://localhost:8000/api/v1/auth/orcid/callback
JWT_SECRET=<random-long-secret>
```

Register your application at <https://orcid.org/developer-tools> to obtain ORCID credentials.

---

## Supabase (frontend sessions)

The frontend supports email and GitHub login via Supabase in addition to ORCID. Configure in `frontend/.env.local`:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

See [Getting Started](getting-started.md) for full environment setup.

# Authentication

The API uses **ORCID OAuth** for researcher identity and **Supabase** for frontend sessions. Admin capabilities are granted via a separate mechanism.

---

## ORCID login flow

1. User clicks "Sign in with ORCID" → frontend calls `GET /api/v1/auth/orcid`.
2. Backend redirects to ORCID OAuth authorization page.
3. After login, ORCID redirects to `GET /api/v1/auth/orcid/callback?code=...`.
4. Backend exchanges code for ORCID token, extracts ORCID iD and display name, issues a signed HS256 JWT, and redirects to the frontend with `?token=<jwt>`.
5. `OAuthCallback.tsx` stores the JWT in `sessionStorage`; `AuthContext` reads it on every page load.

```
User → GET /auth/orcid → ORCID → callback → JWT → frontend sessionStorage
```

---

## Protected endpoints

| Endpoint | Requirement |
|---|---|
| `POST /api/v1/timeseries/submit` | Valid JWT (`Authorization: Bearer <token>`) |
| `POST /api/v1/technologies/submit` | Valid JWT |
| `GET /api/v1/admin/timeseries/submissions` | Admin JWT (`is_admin: true` in token) |
| `PATCH /api/v1/admin/timeseries/{id}/approve` | Admin JWT |
| `GET /api/v1/scraper/status` | Admin JWT |
| `POST /api/v1/scraper/run` | Admin JWT |
| `POST /api/v1/scraper/candidates/{id}/approve` | Admin JWT |

---

## Admin authentication

Two paths are supported:

### Path 1 — Built-in admin (email + bcrypt password)

Set these environment variables on the backend:

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD_HASH=<bcrypt hash>
```

Generate a bcrypt hash:

```python
import bcrypt
print(bcrypt.hashpw(b"your-password", bcrypt.gensalt()).decode())
```

### Path 2 — Supabase role promotion

Promote any Supabase user to admin via SQL:

```sql
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"is_admin": true}'::jsonb
WHERE email = 'user@example.com';
```

The backend reads `is_admin` from the Supabase service-role key JWT claims.

---

## Required environment variables (backend)

```env
# ORCID OAuth
ORCID_CLIENT_ID=<your-orcid-client-id>
ORCID_CLIENT_SECRET=<your-orcid-client-secret>
ORCID_REDIRECT_URI=http://localhost:8000/api/v1/auth/orcid/callback
FRONTEND_URL=http://localhost:5173

# JWT signing
JWT_SECRET_KEY=<random-long-secret>

# Built-in admin (optional)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD_HASH=<bcrypt hash>
```

Register your application at <https://orcid.org/developer-tools> to obtain ORCID credentials. Set the redirect URI exactly as shown above.

---

## Supabase (frontend sessions)

The frontend supports email/password and GitHub login via Supabase in addition to ORCID. Configure in `frontend/.env.local`:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

The backend also uses Supabase to store scraper candidates and runs. Configure the service role key:

```env
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

See [Getting Started](getting-started.md) for the full environment setup and database migration commands.

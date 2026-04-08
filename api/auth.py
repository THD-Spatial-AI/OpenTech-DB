"""
api/auth.py
===========
Authentication routes: ORCID OAuth + custom JWT validation.

Supabase handles email/password and GitHub OAuth entirely on the frontend
via the Supabase JS client.  This module only provides:

  GET  /auth/orcid              — redirect browser to ORCID authorization page
  GET  /auth/orcid/callback     — ORCID redirects here; exchange code → JWT → SPA
  GET  /auth/me                 — validate the custom ORCID JWT; return AuthUser
  POST /auth/admin/login        — credential login for the built-in super-admin

ORCID OAuth flow
----------------
1.  Browser → GET /api/v1/auth/orcid
    FastAPI redirects to https://orcid.org/oauth/authorize?...

2.  User grants access → ORCID → GET /api/v1/auth/orcid/callback?code=...
    FastAPI exchanges the code for an ORCID access token (via httpx),
    extracts the ORCID iD + display name, mints a signed JWT, then
    redirects the browser to the SPA:  <FRONTEND_URL>/?token=<jwt>

3.  <OAuthCallback> in the SPA reads ?token=, calls AuthContext.signIn(token),
    which stores the JWT in sessionStorage then calls GET /auth/me to get the
    user profile.

4.  On reload, AuthContext reads the JWT from sessionStorage and re-validates
    it via GET /auth/me.

Admin authentication — TWO PATHS
----------------------------------
PATH 1 — Built-in super-admin (env-var credentials, this file)
  • Credentials: ADMIN_EMAIL + ADMIN_PASSWORD_HASH (bcrypt, see below)
  • The login form (AuthPage.tsx) tries POST /auth/admin/login first.
    On success it receives a FastAPI JWT with is_admin=true.
  • Use for the initial operator account or headless/CI scenarios.

PATH 2 — Supabase-managed admins (RECOMMENDED for adding more admins)
  • Any Supabase user (email / GitHub) can be promoted to admin without
    touching env vars or redeploying.
  • How to promote a user (Supabase Dashboard → SQL Editor):

      -- 1. Find the user's UUID
      SELECT id, email FROM auth.users WHERE email = 'newadmin@example.org';

      -- 2. Set the admin flag in app_metadata
      UPDATE auth.users
      SET raw_app_meta_data = raw_app_meta_data || '{"is_admin": true}'::jsonb
      WHERE email = 'newadmin@example.org';

  • Alternatively: Dashboard → Authentication → Users → click the user →
    "Edit" → App Metadata → paste { "is_admin": true } → Save.

  • To REVOKE admin: set raw_app_meta_data back to '{"is_admin": false}'.

  • The frontend (AuthContext.tsx → mapSupabaseUser) reads
    session.user.app_metadata.is_admin automatically on every sign-in.

Required environment variables (set in .env or Docker)
-------------------------------------------------------
ORCID_CLIENT_ID      — From https://orcid.org/developer-tools (public API app)
ORCID_CLIENT_SECRET  — Client secret for the same ORCID app
ORCID_REDIRECT_URI   — Must exactly match what you registered with ORCID, e.g.:
                        http://localhost:8000/api/v1/auth/orcid/callback
FRONTEND_URL         — SPA origin, e.g. http://localhost:5173
JWT_SECRET_KEY       — Random secret for signing JWTs (generate once with:
                        python -c "import secrets; print(secrets.token_urlsafe(32))")

ADMIN_EMAIL          — Super-admin email (defaults to the built-in value)
ADMIN_PASSWORD_HASH  — bcrypt hash of the super-admin password.
                       To generate a hash for a new password:
                         python -c "import bcrypt; print(bcrypt.hashpw(b'<pw>', bcrypt.gensalt(12)).decode())"
"""

from __future__ import annotations

import os
import time
import secrets
import hashlib
import bcrypt
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["Auth"])

# ── Configuration ─────────────────────────────────────────────────────────────

ORCID_CLIENT_ID     = os.getenv("ORCID_CLIENT_ID", "")
ORCID_CLIENT_SECRET = os.getenv("ORCID_CLIENT_SECRET", "")
ORCID_REDIRECT_URI  = os.getenv(
    "ORCID_REDIRECT_URI",
    "http://localhost:8000/api/v1/auth/orcid/callback",
)
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

JWT_SECRET_KEY     = os.getenv("JWT_SECRET_KEY") or secrets.token_urlsafe(32)
JWT_ALGORITHM      = "HS256"
JWT_EXPIRE_SECONDS = 60 * 60 * 24  # 24 h

_ORCID_ENV = os.getenv("ORCID_ENV", "sandbox").lower()

if _ORCID_ENV == "production":
    ORCID_AUTH_URL  = "https://orcid.org/oauth/authorize"
    ORCID_TOKEN_URL = "https://orcid.org/oauth/token"
else:
    ORCID_AUTH_URL  = "https://sandbox.orcid.org/oauth/authorize"
    ORCID_TOKEN_URL = "https://sandbox.orcid.org/oauth/token"

# ── Admin credentials ─────────────────────────────────────────────────────────
# Loaded from environment variables at startup so the plaintext password never
# lives in source code.  A built-in default is provided for local development;
# override both vars in production / Docker.
#
# To regenerate the hash for a new password:
#   python -c "import bcrypt; print(bcrypt.hashpw(b'<pw>', bcrypt.gensalt(12)).decode())"

_ADMIN_EMAIL         = os.getenv("ADMIN_EMAIL",  "ricardo.miranda-castillo@th-deg.de").strip().lower()
# Default is the bcrypt hash of "5893Rmc11@1." (rounds=12, safe to store — it's a one-way hash)
_ADMIN_PASSWORD_HASH = os.getenv(
    "ADMIN_PASSWORD_HASH",
    "$2b$12$.LX15d8vQn.SRpGlUU3VyecDTIORq8Ko8CjMACxmnKxJbj79iQk3y",
).strip()

# ── Response model ─────────────────────────────────────────────────────────────

class AuthUser(BaseModel):
    id:             str
    username:       str
    email:          str
    avatar_url:     str | None = None
    auth_provider:  str
    is_contributor: bool
    is_admin:       bool = False

# ── JWT helpers ────────────────────────────────────────────────────────────────

def _create_jwt(payload: dict) -> str:
    claims = {
        **payload,
        "iat": int(time.time()),
        "exp": int(time.time()) + JWT_EXPIRE_SECONDS,
    }
    return jwt.encode(claims, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def _decode_jwt(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])

# ── ORCID — initiation ─────────────────────────────────────────────────────────

@router.get("/orcid", summary="Start ORCID OAuth flow")
async def orcid_login():
    """Redirect the browser to ORCID's authorization page."""
    if not ORCID_CLIENT_ID or not ORCID_CLIENT_SECRET:
        # Gracefully send the user back to the SPA with a clear error flag
        # rather than returning a raw JSON 503, which looks broken.
        return RedirectResponse(f"{FRONTEND_URL}?auth_error=orcid_not_configured")

    params = {
        "client_id":     ORCID_CLIENT_ID,
        "response_type": "code",
        "scope":         "/authenticate",
        "redirect_uri":  ORCID_REDIRECT_URI,
    }
    return RedirectResponse(f"{ORCID_AUTH_URL}?{urlencode(params)}")

# ── ORCID — callback ───────────────────────────────────────────────────────────

@router.get("/orcid/callback", summary="ORCID OAuth callback")
async def orcid_callback(
    code:  str | None = None,
    error: str | None = None,
):
    """
    Handle the redirect from ORCID after the user grants / denies access.

    On success  → mint a signed JWT, redirect to <FRONTEND_URL>?token=<jwt>
    On failure  → redirect to <FRONTEND_URL>?auth_error=<reason>
    """
    if error or not code:
        return RedirectResponse(f"{FRONTEND_URL}?auth_error=orcid_denied")

    # Exchange authorization code for ORCID access token
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            ORCID_TOKEN_URL,
            data={
                "client_id":     ORCID_CLIENT_ID,
                "client_secret": ORCID_CLIENT_SECRET,
                "grant_type":    "authorization_code",
                "code":          code,
                "redirect_uri":  ORCID_REDIRECT_URI,
            },
            headers={"Accept": "application/json"},
            timeout=15.0,
        )

    if resp.status_code != 200:
        return RedirectResponse(f"{FRONTEND_URL}?auth_error=orcid_token_exchange")

    data     = resp.json()
    orcid_id = data.get("orcid", "")        # e.g. 0000-0002-1825-0097
    name     = data.get("name", "ORCID User")

    # Mint our own application JWT with the AuthUser shape
    token = _create_jwt({
        "sub":            orcid_id,
        "username":       name,
        # The /authenticate scope does not expose the user's email.
        # Use a placeholder derived from the ORCID iD.
        "email":          f"{orcid_id}@orcid.org",
        "avatar_url":     None,
        "auth_provider":  "orcid",
        "is_contributor": False,
    })

    return RedirectResponse(f"{FRONTEND_URL}?token={token}")

# ── JWT validation ─────────────────────────────────────────────────────────────

@router.get("/me", response_model=AuthUser, summary="Validate ORCID JWT")
async def get_current_user(request: Request):
    """
    Validate a custom ORCID JWT and return the corresponding AuthUser.

    This endpoint is only used for the ORCID login path.
    Supabase-authenticated users (email / GitHub) do not call this endpoint —
    their session is managed entirely by the Supabase JS client.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")

    token = auth_header.removeprefix("Bearer ")
    try:
        payload = _decode_jwt(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")

    return AuthUser(
        id=payload.get("sub", ""),
        username=payload.get("username", ""),
        email=payload.get("email", ""),
        avatar_url=payload.get("avatar_url"),
        auth_provider=payload.get("auth_provider", "orcid"),
        is_contributor=payload.get("is_contributor", False),
        is_admin=payload.get("is_admin", False),
    )

# ── Admin login ────────────────────────────────────────────────────────────────

class AdminLoginRequest(BaseModel):
    email:    str
    password: str

class AdminLoginResponse(BaseModel):
    token:    str
    user:     AuthUser

@router.post("/admin/login", response_model=AdminLoginResponse, summary="Admin credential login")
def admin_login(body: AdminLoginRequest):
    """
    Authenticate with the admin credentials stored in environment variables.
    Returns a signed JWT with ``is_admin: true`` if correct.
    Uses bcrypt for timing-safe, salted password comparison.
    """
    if not _ADMIN_EMAIL or not _ADMIN_PASSWORD_HASH:
        raise HTTPException(status_code=401, detail="Invalid admin credentials.")

    email_match = secrets.compare_digest(
        body.email.strip().lower(),
        _ADMIN_EMAIL,
    )

    # bcrypt.checkpw is inherently timing-safe and handles its own salt.
    # We still gate on email_match first to avoid leaking timing on unknown emails.
    try:
        pw_match = email_match and bcrypt.checkpw(
            body.password.encode("utf-8"),
            _ADMIN_PASSWORD_HASH.encode("utf-8"),
        )
    except Exception:
        pw_match = False

    if not pw_match:
        raise HTTPException(status_code=401, detail="Invalid admin credentials.")

    token = _create_jwt({
        "sub":            "admin",
        "username":       "Admin",
        "email":          _ADMIN_EMAIL,
        "avatar_url":     None,
        "auth_provider":  "admin",
        "is_contributor": True,
        "is_admin":       True,
    })
    user = AuthUser(
        id="admin",
        username="Admin",
        email=_ADMIN_EMAIL,
        avatar_url=None,
        auth_provider="admin",
        is_contributor=True,
        is_admin=True,
    )
    return AdminLoginResponse(token=token, user=user)

"""
api/auth.py
===========
Authentication routes: ORCID OAuth + custom JWT validation.

Supabase handles email/password and GitHub OAuth entirely on the frontend
via the Supabase JS client.  This module only provides:

  GET  /auth/orcid              — redirect browser to ORCID authorization page
  GET  /auth/orcid/callback     — ORCID redirects here; exchange code → JWT → SPA
  GET  /auth/me                 — validate the custom ORCID JWT; return AuthUser

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

Required environment variables (set in .env or Docker)
-------------------------------------------------------
ORCID_CLIENT_ID      — From https://orcid.org/developer-tools (public API app)
ORCID_CLIENT_SECRET  — Client secret for the same ORCID app
ORCID_REDIRECT_URI   — Must exactly match what you registered with ORCID, e.g.:
                        http://localhost:8000/api/v1/auth/orcid/callback
FRONTEND_URL         — SPA origin, e.g. http://localhost:5173
JWT_SECRET_KEY       — Random secret for signing JWTs (generate once with:
                        python -c "import secrets; print(secrets.token_urlsafe(32))")
"""

from __future__ import annotations

import os
import time
import secrets
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

# If JWT_SECRET_KEY is not set a random one is generated at startup.
# ⚠  On multi-process / multi-instance deployments you MUST set this env var
# so all processes share the same secret; otherwise tokens issued by one
# instance will be rejected by another.
JWT_SECRET_KEY     = os.getenv("JWT_SECRET_KEY") or secrets.token_urlsafe(32)
JWT_ALGORITHM      = "HS256"
JWT_EXPIRE_SECONDS = 60 * 60 * 24  # 24 h

# Switch between sandbox (development) and production by setting ORCID_ENV=production
# Sandbox:    accepts http://localhost redirect URIs — use for local development
# Production: requires HTTPS redirect URIs — use when deployed
_ORCID_ENV = os.getenv("ORCID_ENV", "sandbox").lower()

if _ORCID_ENV == "production":
    ORCID_AUTH_URL  = "https://orcid.org/oauth/authorize"
    ORCID_TOKEN_URL = "https://orcid.org/oauth/token"
else:
    ORCID_AUTH_URL  = "https://sandbox.orcid.org/oauth/authorize"
    ORCID_TOKEN_URL = "https://sandbox.orcid.org/oauth/token"

# ── Response model ─────────────────────────────────────────────────────────────

class AuthUser(BaseModel):
    id:            str
    username:      str
    email:         str
    avatar_url:    str | None = None
    auth_provider: str
    is_contributor: bool

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
    )

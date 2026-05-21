"""
api/_auth_helpers.py
====================
Supabase client, JWT auth helpers, and submission record model.

Exports used by api/routes.py:
  _get_sb, _is_admin_claim, _decode_supabase_jwt, _require_admin,
  _extract_user_from_token, SubmissionRecord, _row_to_record,
  _SUBMISSIONS_TABLE
"""
from __future__ import annotations

import base64 as _b64
import json as _json_mod
import logging
import os
import time as _time_mod

from fastapi import HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

_SUPABASE_URL      = os.getenv("SUPABASE_URL", "")
_SUPABASE_SVC_KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
# Optional: set to the JWT Secret from Supabase Dashboard → Settings → API.
# When present, Supabase tokens are verified cryptographically instead of
# structurally. Required for any public deployment.
_SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
_SUBMISSIONS_TABLE = "technology_submissions"
_sb_client         = None


def _get_sb():
    """Return a Supabase service-role client, or None if credentials are absent."""
    global _sb_client
    if not _SUPABASE_URL or not _SUPABASE_SVC_KEY:
        return None
    if _sb_client is None:
        from supabase import create_client as _create_sb
        _sb_client = _create_sb(_SUPABASE_URL, _SUPABASE_SVC_KEY)
    return _sb_client


def _is_admin_claim(payload: dict) -> bool:
    """True if the decoded JWT payload grants admin access (both token formats)."""
    if payload.get("is_admin"):
        return True
    return bool(payload.get("app_metadata", {}).get("is_admin"))


def _decode_supabase_jwt(token: str) -> dict:
    """
    Validate a Supabase JWT.

    When SUPABASE_JWT_SECRET is set (recommended for production), the token
    signature is verified cryptographically via HS256.

    When SUPABASE_JWT_SECRET is absent (local dev only), structural checks are
    performed instead and a warning is emitted.  This path accepts any
    well-formed Supabase-looking JWT without verifying authenticity — do not
    use in production without setting the secret.
    """
    if _SUPABASE_JWT_SECRET:
        from jose import JWTError, jwt as _jose_jwt
        try:
            payload = _jose_jwt.decode(
                token,
                _SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
        except JWTError as exc:
            raise ValueError(f"Supabase JWT signature invalid: {exc}") from exc
        iss = payload.get("iss", "")
        if not iss or "supabase" not in iss:
            raise ValueError("Not a Supabase JWT")
        return payload

    # --- structural-only path (local dev) ---
    logger.warning(
        "SUPABASE_JWT_SECRET is not set — Supabase token signatures are NOT "
        "verified. Set SUPABASE_JWT_SECRET for production deployments."
    )
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed JWT — expected 3 parts")

    def _b64d(s: str) -> bytes:
        return _b64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

    try:
        payload = _json_mod.loads(_b64d(parts[1]))
    except Exception as exc:
        raise ValueError(f"Cannot decode JWT payload: {exc}") from exc

    iss = payload.get("iss", "")
    if not iss or "supabase" not in iss:
        raise ValueError("Not a Supabase JWT")

    if payload.get("aud") != "authenticated":
        raise ValueError("JWT audience is not 'authenticated'")

    exp = payload.get("exp", 0)
    if exp and _time_mod.time() > exp:
        raise ValueError("Token expired")

    return payload


def _require_admin(authorization: str | None) -> dict:
    """
    Validate the bearer token and return the decoded payload.

    Accepts two token types:
    • Our HS256 JWT   — built-in super-admin (POST /auth/admin/login)
    • Supabase JWT    — users with app_metadata.is_admin set in Supabase

    Raises HTTP 401 for missing/invalid tokens, 403 for non-admin tokens.
    """
    from api.auth import _decode_jwt

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin token required.")

    token = authorization.removeprefix("Bearer ")
    payload: dict | None = None

    try:
        payload = _decode_jwt(token)
    except Exception:
        pass

    if payload is None:
        try:
            payload = _decode_supabase_jwt(token)
        except ValueError as exc:
            raise HTTPException(status_code=401, detail=str(exc))

    if not _is_admin_claim(payload):
        raise HTTPException(status_code=403, detail="Admin access required.")

    return payload


def _extract_user_from_token(authorization: str | None) -> tuple[str | None, str | None]:
    """Return (user_id, email) from a Bearer JWT, or (None, None)."""
    if not authorization or not authorization.startswith("Bearer "):
        return None, None
    token = authorization.removeprefix("Bearer ")
    try:
        p = _decode_supabase_jwt(token)
        return p.get("sub"), p.get("email")
    except Exception:
        pass
    try:
        from api.auth import _decode_jwt
        p = _decode_jwt(token)
        return p.get("sub"), p.get("email")
    except Exception:
        pass
    return None, None


class SubmissionRecord(BaseModel):
    submission_id:    str
    technology_name:  str
    submitted_at:     str
    status:           str
    domain:           str | None = None
    oeo_class:        str | None = None
    description:      str | None = None
    submitter_email:  str | None = None
    rejection_reason: str | None = None
    reviewed_at:      str | None = None
    reviewed_by:      str | None = None
    pr_url:           str | None = None
    filename:         str        = ""
    payload:          dict | None = None


def _row_to_record(row: dict, filename: str = "") -> SubmissionRecord:
    """Map a Supabase row dict to a SubmissionRecord."""
    payload = row.get("payload") or {}
    if row.get("carrier") and not payload.get("carrier"):
        payload = {**payload, "carrier": row["carrier"]}
    return SubmissionRecord(
        submission_id=str(row.get("id", row.get("submission_id", ""))),
        technology_name=row.get("technology_name", "—"),
        submitted_at=str(row.get("submitted_at", "")),
        status=row.get("status", "pending_review"),
        domain=row.get("domain"),
        oeo_class=row.get("oeo_class"),
        description=row.get("description"),
        submitter_email=row.get("submitter_email"),
        rejection_reason=row.get("rejection_reason"),
        reviewed_at=str(row["reviewed_at"]) if row.get("reviewed_at") else None,
        reviewed_by=row.get("reviewed_by"),
        pr_url=row.get("pr_url"),
        filename=filename,
        payload=payload if payload else None,
    )

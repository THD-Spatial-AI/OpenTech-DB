"""Database helpers, Go-session authorization, and submission models.

Supabase remains an optional server-side data service in this module. It is
not an identity provider. The standalone Go service owns Keycloak tokens and
places a validated OpenTech realm user on ``request.state``.
"""
from __future__ import annotations

import os

from fastapi import HTTPException, Request
from pydantic import BaseModel

_SUPABASE_URL      = os.getenv("SUPABASE_URL", "")
_SUPABASE_SVC_KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
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


def _request_identity(request: Request) -> dict:
    if getattr(request.state, "auth_service_unavailable", False):
        raise HTTPException(status_code=503, detail="Authentication service unavailable.")
    user = getattr(request.state, "auth_user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return user.as_identity()


def _require_admin(request: Request) -> dict:
    """Require a Go-validated OpenTech realm session carrying ``admin``."""
    identity = _request_identity(request)
    if "admin" not in identity["roles"]:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return identity


def _require_contributor(request: Request) -> dict:
    """Require a Go-validated contributor or admin realm role."""
    identity = _request_identity(request)
    if not ({"contributor", "admin"} & set(identity["roles"])):
        raise HTTPException(status_code=403, detail="Contributor access required.")
    return identity


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

"""Consume sessions owned by the standalone Go authentication service.

FastAPI does not implement an OAuth/OIDC flow and never receives a Keycloak
client secret or access token. It forwards the opaque ``session_id`` cookie to
the Go service's protected internal endpoint and authorizes using the returned
OpenTech realm identity.
"""
from __future__ import annotations

from dataclasses import dataclass
import logging
import os
from typing import Any

import httpx
from fastapi import Request

logger = logging.getLogger(__name__)

AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://localhost:8001").rstrip("/")
AUTH_INTERNAL_SECRET = os.getenv("AUTH_INTERNAL_SECRET", "")
AUTH_REALM = os.getenv("AUTH_REALM", "opentechdb")
SESSION_COOKIE_NAME = "session_id"
_ALLOWED_ROLES = frozenset({"contributor", "admin"})


class AuthServiceUnavailable(RuntimeError):
    """The API could not securely validate a session with the Go service."""


@dataclass(frozen=True, slots=True)
class RealmUser:
    id: str
    username: str
    email: str
    realm: str
    roles: frozenset[str]

    @property
    def is_admin(self) -> bool:
        return "admin" in self.roles

    @property
    def is_contributor(self) -> bool:
        return self.is_admin or "contributor" in self.roles

    def as_identity(self) -> dict[str, Any]:
        return {
            "sub": self.id,
            "preferred_username": self.username,
            "email": self.email,
            "realm": self.realm,
            "roles": sorted(self.roles),
        }


def _session_cookie_values(request: Request) -> list[str]:
    values: list[str] = []
    for part in request.headers.get("cookie", "").split(";"):
        name, separator, value = part.strip().partition("=")
        if separator and name == SESSION_COOKIE_NAME and value:
            values.append(value)
    return values


def has_single_session_cookie(request: Request) -> bool:
    return len(_session_cookie_values(request)) == 1


def has_session_cookie(request: Request) -> bool:
    """Return whether any opaque session cookie was presented.

    This is intentionally separate from :func:`has_single_session_cookie` so
    middleware can reject cookie/token ambiguity and apply Origin protection
    even when a request contains duplicate (therefore invalid) cookies.
    """
    return bool(_session_cookie_values(request))


def _parse_realm_user(payload: Any) -> RealmUser:
    if not isinstance(payload, dict):
        raise ValueError("invalid user response")
    user_id = str(payload.get("id") or "").strip()
    username = str(payload.get("username") or "").strip()
    email = str(payload.get("email") or "").strip().lower()
    realm = str(payload.get("realm") or "").strip()
    raw_roles = payload.get("roles")
    if not user_id or not username or not email or realm != AUTH_REALM or not isinstance(raw_roles, list):
        raise ValueError("invalid realm identity")
    roles = frozenset(str(role) for role in raw_roles if str(role) in _ALLOWED_ROLES)
    return RealmUser(id=user_id, username=username, email=email, realm=realm, roles=roles)


async def validate_request_session(request: Request) -> RealmUser | None:
    """Validate exactly one opaque browser session cookie with the Go service."""
    values = _session_cookie_values(request)
    if not values:
        return None
    if len(values) != 1:
        logger.warning("Rejected request with duplicate session cookies")
        return None
    if len(AUTH_INTERNAL_SECRET) < 32:
        raise AuthServiceUnavailable("AUTH_INTERNAL_SECRET is not securely configured")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
            response = await client.get(
                f"{AUTH_SERVICE_URL}/internal/validate-session",
                headers={"X-Internal-Auth": AUTH_INTERNAL_SECRET, "Accept": "application/json"},
                cookies={SESSION_COOKIE_NAME: values[0]},
            )
    except httpx.HTTPError as exc:
        logger.error("Go authentication service is unavailable: %s", exc)
        raise AuthServiceUnavailable("authentication service unavailable") from exc

    if response.status_code == 401:
        return None
    if response.status_code != 200:
        logger.error("Go authentication service returned HTTP %s", response.status_code)
        raise AuthServiceUnavailable("authentication service unavailable")
    try:
        body = response.json()
        return _parse_realm_user(body.get("user"))
    except (ValueError, TypeError) as exc:
        logger.error("Go authentication service returned an invalid identity")
        raise AuthServiceUnavailable("invalid authentication response") from exc

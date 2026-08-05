"""Self-service personal API tokens backed by the application data store.

Keycloak remains the only source of users and browser authentication.  This
module stores no application-user record: token rows merely reference the
immutable Keycloak subject and snapshot the public identity needed to
attribute API requests.  The plaintext token is returned once and only its
SHA-256 digest is persisted, following the Storcito-Wildfire token design.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import logging
import re
import secrets
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address

from api._auth_helpers import _get_sb, _request_identity
from api.auth_session import AUTH_REALM, RealmUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/profile/api-tokens", tags=["Auth"])
_limiter = Limiter(key_func=get_remote_address)

TOKEN_PREFIX = "otdb_"
TOKEN_RANDOM_BYTES = 32
TOKEN_DEFAULT_EXPIRY_DAYS = 90
TOKEN_MAX_EXPIRY_DAYS = 365
MAX_ACTIVE_TOKENS_PER_USER = 10
TOKEN_HISTORY_LIMIT = 90
_TOKEN_TABLE = "api_tokens"
_TOKEN_PATTERN = re.compile(r"^otdb_[A-Za-z0-9_-]{43}$")
_SAFE_METHODS = frozenset({"GET", "HEAD"})

_PUBLIC_COLUMNS = (
    "id,name,token_prefix,scope,expires_at,last_used_at,revoked_at,created_at"
)
_VALIDATION_COLUMNS = (
    "id,user_id,username,user_email,realm,roles,scope,expires_at,"
    "last_used_at,revoked_at"
)


class InvalidAuthorizationHeader(ValueError):
    """An Authorization header was present but was not one valid OTDB token."""


class PersonalTokenStoreUnavailable(RuntimeError):
    """The backend-only token store could not be reached safely."""


@dataclass(frozen=True, slots=True)
class GeneratedPersonalToken:
    """A freshly generated secret and the non-secret values safe to persist."""

    plaintext: str
    digest: str
    display_prefix: str


@dataclass(frozen=True, slots=True)
class ValidatedPersonalToken:
    """Authentication result attached to a request by the API middleware."""

    token_id: int
    user: RealmUser
    scope: Literal["read", "full"]


class CreatePersonalTokenRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    scope: Literal["read", "full"] = "read"
    expires_in_days: int = Field(
        default=TOKEN_DEFAULT_EXPIRY_DAYS,
        ge=0,
        le=TOKEN_MAX_EXPIRY_DAYS,
        description="0 means the token never expires.",
    )

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("Token name must not be blank.")
        return name


class PersonalTokenSummary(BaseModel):
    id: int
    name: str
    token_prefix: str
    scope: Literal["read", "full"]
    expires_at: datetime | None = None
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime


class CreatedPersonalToken(BaseModel):
    """Creation response. ``token`` is deliberately unavailable afterwards."""

    id: int
    name: str
    token: str
    token_prefix: str
    scope: Literal["read", "full"]
    expires_at: datetime | None = None
    created_at: datetime


def hash_personal_token(plaintext: str) -> str:
    """Return the lowercase SHA-256 digest stored in PostgreSQL."""
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def generate_personal_token() -> GeneratedPersonalToken:
    """Create a 256-bit, URL-safe opaque token."""
    plaintext = TOKEN_PREFIX + secrets.token_urlsafe(TOKEN_RANDOM_BYTES)
    return GeneratedPersonalToken(
        plaintext=plaintext,
        digest=hash_personal_token(plaintext),
        display_prefix=plaintext[: len(TOKEN_PREFIX) + 8],
    )


def bearer_token_from_request(request: Request) -> str | None:
    """Extract exactly one strictly formed ``Bearer otdb_...`` credential."""
    values = request.headers.getlist("authorization")
    if not values:
        return None
    if len(values) != 1:
        raise InvalidAuthorizationHeader("duplicate Authorization headers")

    parts = values[0].strip().split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise InvalidAuthorizationHeader("invalid bearer authorization")
    candidate = parts[1]
    if not _TOKEN_PATTERN.fullmatch(candidate):
        raise InvalidAuthorizationHeader("invalid personal token format")
    return candidate


def scope_allows_method(scope: str, method: str) -> bool:
    """Read tokens are limited to GET/HEAD; full tokens may use any method."""
    return scope == "full" or method.upper() in _SAFE_METHODS


def _parse_datetime(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        raise ValueError("invalid timestamp")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _token_is_active(row: dict[str, Any], now: datetime) -> bool:
    if row.get("revoked_at"):
        return False
    expires_at = _parse_datetime(row.get("expires_at"))
    return expires_at is None or expires_at > now


def _token_store():
    store = _get_sb()
    if store is None:
        raise PersonalTokenStoreUnavailable("personal token storage is not configured")
    return store


def _store_failure(operation: str, exc: Exception) -> PersonalTokenStoreUnavailable:
    # Do not log the exception body: some HTTP clients include the filtered
    # token digest in database error text.
    logger.error("Personal token %s failed (%s)", operation, type(exc).__name__)
    return PersonalTokenStoreUnavailable("personal token storage unavailable")


def _active_token_limit_error(exc: Exception) -> bool:
    """Recognize only the named PostgreSQL trigger failure, not arbitrary DB text."""
    return (
        str(getattr(exc, "code", "")) == "23514"
        and str(getattr(exc, "message", "")) == "maximum active personal API tokens reached"
    )


def validate_personal_token(plaintext: str) -> ValidatedPersonalToken | None:
    """Validate a token hash and return its non-admin Keycloak identity snapshot."""
    store = _token_store()
    try:
        result = (
            store.table(_TOKEN_TABLE)
            .select(_VALIDATION_COLUMNS)
            .eq("token_hash", hash_personal_token(plaintext))
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise _store_failure("validation", exc) from exc

    rows = result.data if isinstance(result.data, list) else []
    if len(rows) != 1 or not isinstance(rows[0], dict):
        return None
    row = rows[0]
    now = datetime.now(timezone.utc)
    try:
        token_id = int(row.get("id"))
        user_id = str(row.get("user_id") or "").strip()
        username = str(row.get("username") or "").strip()
        email = str(row.get("user_email") or "").strip().lower()
        realm = str(row.get("realm") or "").strip()
        scope = str(row.get("scope") or "")
        raw_roles = row.get("roles")
        if (
            token_id <= 0
            or not user_id
            or not username
            or not email
            or realm != AUTH_REALM
            or scope not in {"read", "full"}
            or not isinstance(raw_roles, list)
            or not _token_is_active(row, now)
        ):
            return None
    except (TypeError, ValueError):
        logger.warning("Rejected malformed personal token record")
        return None

    # Personal tokens can act as contributors when that role was present at
    # creation time, but can never carry the Keycloak admin role.
    roles = frozenset({"contributor"} & {str(role) for role in raw_roles})
    user = RealmUser(
        id=user_id,
        username=username,
        email=email,
        realm=realm,
        roles=roles,
    )

    try:
        last_used_at = _parse_datetime(row.get("last_used_at"))
    except (TypeError, ValueError):
        last_used_at = None
    if last_used_at is None or last_used_at < now - timedelta(minutes=1):
        try:
            (
                store.table(_TOKEN_TABLE)
                .update({"last_used_at": now.isoformat()})
                .eq("id", token_id)
                .is_("revoked_at", "null")
                .execute()
            )
        except Exception as exc:
            # Authentication already succeeded. Last-used telemetry is best
            # effort and must not turn a valid request into an outage.
            logger.warning("Could not update personal token usage (%s)", type(exc).__name__)

    return ValidatedPersonalToken(token_id=token_id, user=user, scope=scope)


def _require_browser_session(request: Request) -> dict[str, Any]:
    identity = _request_identity(request)
    if getattr(request.state, "auth_method", None) != "session":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A Keycloak browser session is required to manage API tokens.",
        )
    return identity


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


def _list_rows_for_user(user_id: str) -> list[dict[str, Any]]:
    store = _token_store()
    try:
        recent_result = (
            store.table(_TOKEN_TABLE)
            .select(_PUBLIC_COLUMNS)
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(TOKEN_HISTORY_LIMIT)
            .execute()
        )
        # Always include every active token even if a long revoked/expired
        # history pushed it out of the recent window. The two predicates are
        # deliberately separate to avoid interpolating PostgREST OR syntax.
        non_expiring_result = (
            store.table(_TOKEN_TABLE)
            .select(_PUBLIC_COLUMNS)
            .eq("user_id", user_id)
            .is_("revoked_at", "null")
            .is_("expires_at", "null")
            .limit(MAX_ACTIVE_TOKENS_PER_USER + 1)
            .execute()
        )
        unexpired_result = (
            store.table(_TOKEN_TABLE)
            .select(_PUBLIC_COLUMNS)
            .eq("user_id", user_id)
            .is_("revoked_at", "null")
            .gt("expires_at", datetime.now(timezone.utc).isoformat())
            .limit(MAX_ACTIVE_TOKENS_PER_USER + 1)
            .execute()
        )
    except Exception as exc:
        raise _store_failure("listing", exc) from exc

    result_sets = (recent_result.data, non_expiring_result.data, unexpired_result.data)
    if any(
        not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows)
        for rows in result_sets
    ):
        raise PersonalTokenStoreUnavailable("invalid personal token storage response")

    rows_by_id: dict[int, dict[str, Any]] = {}
    for rows in result_sets:
        for row in rows:
            try:
                rows_by_id.setdefault(int(row["id"]), row)
            except (KeyError, TypeError, ValueError) as exc:
                raise PersonalTokenStoreUnavailable("invalid personal token storage response") from exc
    return list(rows_by_id.values())


@router.get("", response_model=list[PersonalTokenSummary], summary="List my personal API tokens")
@_limiter.limit("30/minute")
def list_personal_tokens(request: Request, response: Response) -> list[PersonalTokenSummary]:
    identity = _require_browser_session(request)
    _no_store(response)
    try:
        return [PersonalTokenSummary.model_validate(row) for row in _list_rows_for_user(identity["sub"])]
    except PersonalTokenStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="Personal API token storage is unavailable.") from exc
    except (TypeError, ValueError) as exc:
        logger.error("Personal token listing returned malformed data")
        raise HTTPException(status_code=503, detail="Personal API token storage is unavailable.") from exc


@router.post(
    "",
    response_model=CreatedPersonalToken,
    status_code=status.HTTP_201_CREATED,
    summary="Generate a personal API token",
)
@_limiter.limit("5/minute")
def create_personal_token(
    request: Request,
    response: Response,
    payload: CreatePersonalTokenRequest,
) -> CreatedPersonalToken:
    identity = _require_browser_session(request)
    _no_store(response)
    now = datetime.now(timezone.utc)

    try:
        existing = _list_rows_for_user(identity["sub"])
    except PersonalTokenStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="Personal API token storage is unavailable.") from exc
    active_count = 0
    for row in existing:
        try:
            active_count += int(_token_is_active(row, now))
        except (TypeError, ValueError):
            logger.error("Personal token listing returned malformed expiry data")
            raise HTTPException(status_code=503, detail="Personal API token storage is unavailable.")
    if active_count >= MAX_ACTIVE_TOKENS_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Revoke an existing token before creating more (maximum {MAX_ACTIVE_TOKENS_PER_USER}).",
        )

    generated = generate_personal_token()
    expires_at = (
        now + timedelta(days=payload.expires_in_days)
        if payload.expires_in_days > 0
        else None
    )
    # Preserve contributor ability but explicitly clamp admin tokens. A user
    # without contributor access receives no elevated role in their token.
    token_roles = ["contributor"] if {"contributor", "admin"} & set(identity["roles"]) else []
    row = {
        "user_id": identity["sub"],
        "username": identity["preferred_username"],
        "user_email": identity["email"],
        "realm": identity["realm"],
        "name": payload.name,
        "token_hash": generated.digest,
        "token_prefix": generated.display_prefix,
        "scope": payload.scope,
        "roles": token_roles,
        "created_by": identity["sub"],
        "expires_at": expires_at.isoformat() if expires_at else None,
    }

    try:
        result = _token_store().table(_TOKEN_TABLE).insert(row).execute()
    except PersonalTokenStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="Personal API token storage is unavailable.") from exc
    except Exception as exc:
        if _active_token_limit_error(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Revoke an existing token before creating more (maximum {MAX_ACTIVE_TOKENS_PER_USER}).",
            ) from exc
        raise HTTPException(
            status_code=503,
            detail="Personal API token storage is unavailable.",
        ) from _store_failure("creation", exc)

    rows = result.data if isinstance(result.data, list) else []
    if len(rows) != 1 or not isinstance(rows[0], dict):
        raise HTTPException(status_code=503, detail="Personal API token storage is unavailable.")
    try:
        stored = PersonalTokenSummary.model_validate(rows[0])
    except (TypeError, ValueError) as exc:
        logger.error("Personal token creation returned malformed data")
        raise HTTPException(status_code=503, detail="Personal API token storage is unavailable.") from exc

    logger.info("Personal token created token_id=%s user_id=%s scope=%s", stored.id, identity["sub"], stored.scope)
    return CreatedPersonalToken(
        id=stored.id,
        name=stored.name,
        token=generated.plaintext,
        token_prefix=stored.token_prefix,
        scope=stored.scope,
        expires_at=stored.expires_at,
        created_at=stored.created_at,
    )


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Revoke my personal API token")
@_limiter.limit("10/minute")
def revoke_personal_token(request: Request, token_id: int) -> Response:
    identity = _require_browser_session(request)
    if token_id <= 0:
        raise HTTPException(status_code=422, detail="Invalid token ID.")
    now = datetime.now(timezone.utc)
    try:
        result = (
            _token_store()
            .table(_TOKEN_TABLE)
            .update({"revoked_at": now.isoformat()})
            .eq("id", token_id)
            .eq("user_id", identity["sub"])
            .is_("revoked_at", "null")
            .execute()
        )
    except PersonalTokenStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="Personal API token storage is unavailable.") from exc
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Personal API token storage is unavailable.",
        ) from _store_failure("revocation", exc)

    rows = result.data if isinstance(result.data, list) else []
    if not rows:
        raise HTTPException(status_code=404, detail="API token not found or already revoked.")
    logger.info("Personal token revoked token_id=%s user_id=%s", token_id, identity["sub"])
    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )

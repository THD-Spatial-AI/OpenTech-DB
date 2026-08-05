"""Security tests for the Go-session/Keycloak trust boundary."""
from __future__ import annotations

import httpx
import pytest
from fastapi import HTTPException
from starlette.requests import Request

from api import _auth_helpers as helpers
from api import auth_session


def make_request(cookie: str | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if cookie is not None:
        headers.append((b"cookie", cookie.encode()))
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers})


def valid_user_payload(**overrides) -> dict:
    payload = {
        "id": "user-123",
        "username": "researcher",
        "email": "Researcher@Example.org",
        "realm": "opentechdb",
        "roles": ["contributor"],
    }
    payload.update(overrides)
    return payload


class FakeAsyncClient:
    response = httpx.Response(200, json={"user": valid_user_payload()})
    calls: list[dict] = []

    def __init__(self, *args, **kwargs):
        del args, kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        del args

    async def get(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return self.response


class TestRealmUserParsing:
    def test_accepts_only_application_roles_and_normalizes_email(self):
        user = auth_session._parse_realm_user(
            valid_user_payload(roles=["offline_access", "admin", "contributor"])
        )
        assert user.email == "researcher@example.org"
        assert user.roles == frozenset({"admin", "contributor"})

    @pytest.mark.parametrize(
        "overrides",
        [
            {"realm": "enerplanet"},
            {"email": ""},
            {"username": ""},
            {"id": ""},
            {"roles": "admin"},
        ],
    )
    def test_rejects_wrong_realm_or_incomplete_identity(self, overrides):
        with pytest.raises(ValueError, match="invalid realm identity"):
            auth_session._parse_realm_user(valid_user_payload(**overrides))


class TestCookieBoundary:
    def test_requires_exactly_one_session_cookie(self):
        assert auth_session.has_single_session_cookie(make_request("session_id=abc"))
        assert not auth_session.has_single_session_cookie(
            make_request("session_id=abc; session_id=shadow")
        )
        assert not auth_session.has_single_session_cookie(make_request("other=value"))

    @pytest.mark.anyio
    async def test_validation_forwards_only_session_and_internal_secret(self, monkeypatch):
        FakeAsyncClient.calls = []
        FakeAsyncClient.response = httpx.Response(200, json={"user": valid_user_payload()})
        monkeypatch.setattr(auth_session.httpx, "AsyncClient", FakeAsyncClient)

        user = await auth_session.validate_request_session(
            make_request("unrelated=private; session_id=opaque-session")
        )

        assert user is not None
        assert user.id == "user-123"
        assert len(FakeAsyncClient.calls) == 1
        call = FakeAsyncClient.calls[0]
        assert call["url"].endswith("/internal/validate-session")
        assert call["headers"]["X-Internal-Auth"] == auth_session.AUTH_INTERNAL_SECRET
        assert call["cookies"] == {"session_id": "opaque-session"}

    @pytest.mark.anyio
    async def test_duplicate_session_cookie_never_reaches_auth_service(self, monkeypatch):
        FakeAsyncClient.calls = []
        monkeypatch.setattr(auth_session.httpx, "AsyncClient", FakeAsyncClient)
        user = await auth_session.validate_request_session(
            make_request("session_id=first; session_id=second")
        )
        assert user is None
        assert FakeAsyncClient.calls == []

    @pytest.mark.anyio
    async def test_auth_service_401_is_anonymous(self, monkeypatch):
        FakeAsyncClient.calls = []
        FakeAsyncClient.response = httpx.Response(401, json={"error": "invalid session"})
        monkeypatch.setattr(auth_session.httpx, "AsyncClient", FakeAsyncClient)
        assert await auth_session.validate_request_session(make_request("session_id=expired")) is None


def request_with_user(*, roles: frozenset[str]) -> Request:
    request = make_request()
    request.state.auth_service_unavailable = False
    request.state.auth_user = auth_session.RealmUser(
        id="user-123",
        username="researcher",
        email="researcher@example.org",
        realm="opentechdb",
        roles=roles,
    )
    return request


class TestRoleEnforcement:
    def test_admin_role_is_accepted(self):
        identity = helpers._require_admin(request_with_user(roles=frozenset({"admin"})))
        assert identity["sub"] == "user-123"

    def test_non_admin_is_forbidden(self):
        with pytest.raises(HTTPException) as exc:
            helpers._require_admin(request_with_user(roles=frozenset({"contributor"})))
        assert exc.value.status_code == 403

    @pytest.mark.parametrize("roles", [frozenset({"contributor"}), frozenset({"admin"})])
    def test_contributor_or_admin_is_accepted(self, roles):
        identity = helpers._require_contributor(request_with_user(roles=roles))
        assert identity["sub"] == "user-123"

    def test_missing_session_is_unauthorized(self):
        request = make_request()
        request.state.auth_service_unavailable = False
        request.state.auth_user = None
        with pytest.raises(HTTPException) as exc:
            helpers._require_admin(request)
        assert exc.value.status_code == 401

    def test_auth_service_failure_fails_closed(self):
        request = make_request()
        request.state.auth_service_unavailable = True
        request.state.auth_user = None
        with pytest.raises(HTTPException) as exc:
            helpers._require_contributor(request)
        assert exc.value.status_code == 503

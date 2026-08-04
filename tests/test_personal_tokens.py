"""Focused security tests for personal API-token generation and validation."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request

from api import personal_tokens
from api.auth_session import RealmUser


def make_request(
    *,
    method: str = "GET",
    headers: list[tuple[bytes, bytes]] | None = None,
) -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": "/api/v1/technologies",
            "headers": headers or [],
        }
    )


class FakeQuery:
    def __init__(self, store: "FakeStore"):
        self.store = store
        self.operation = ""
        self.filters: list[tuple[str, object]] = []

    def select(self, columns: str):
        self.operation = "select"
        self.store.selected_columns = columns
        return self

    def update(self, values: dict):
        self.operation = "update"
        self.store.updated_values = values
        return self

    def insert(self, values: dict):
        self.operation = "insert"
        self.store.inserted_values = values
        return self

    def eq(self, column: str, value: object):
        self.filters.append((column, value))
        return self

    def is_(self, column: str, value: object):
        self.filters.append((column, value))
        return self

    def gt(self, column: str, value: object):
        self.filters.append((column, value))
        return self

    def limit(self, value: int):
        self.store.limit = value
        return self

    def order(self, column: str, *, desc: bool = False):
        self.store.ordering = (column, desc)
        return self

    def execute(self):
        self.store.calls.append((self.operation, list(self.filters)))
        if self.operation == "update":
            return SimpleNamespace(data=[{"id": 7}])
        if self.operation == "insert":
            return SimpleNamespace(
                data=[
                    {
                        **(self.store.inserted_values or {}),
                        "id": 8,
                        "last_used_at": None,
                        "revoked_at": None,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }
                ]
            )
        if self.store.select_results is not None:
            return SimpleNamespace(data=self.store.select_results.pop(0))
        return SimpleNamespace(data=self.store.rows)


class FakeStore:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.calls: list[tuple[str, list[tuple[str, object]]]] = []
        self.selected_columns = ""
        self.updated_values: dict | None = None
        self.inserted_values: dict | None = None
        self.limit: int | None = None
        self.ordering: tuple[str, bool] | None = None
        self.select_results: list[list[dict]] | None = None

    def table(self, name: str):
        assert name == "api_tokens"
        return FakeQuery(self)


def active_row(**overrides) -> dict:
    row = {
        "id": 7,
        "user_id": "keycloak-subject-123",
        "username": "researcher",
        "user_email": "Researcher@Example.org",
        "realm": "opentechdb",
        "roles": ["contributor"],
        "scope": "read",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "last_used_at": None,
        "revoked_at": None,
    }
    row.update(overrides)
    return row


def test_generated_token_has_wildfire_strength_and_only_hash_is_persistable():
    generated = personal_tokens.generate_personal_token()

    assert generated.plaintext.startswith("otdb_")
    assert len(generated.plaintext) == 48
    assert generated.display_prefix == generated.plaintext[:13]
    assert generated.digest == personal_tokens.hash_personal_token(generated.plaintext)
    assert len(generated.digest) == 64
    assert generated.plaintext not in generated.digest


def test_authorization_header_is_strict_and_duplicate_safe():
    generated = personal_tokens.generate_personal_token()
    request = make_request(headers=[(b"authorization", f"bearer {generated.plaintext}".encode())])
    assert personal_tokens.bearer_token_from_request(request) == generated.plaintext

    duplicate = make_request(
        headers=[
            (b"authorization", f"Bearer {generated.plaintext}".encode()),
            (b"authorization", f"Bearer {generated.plaintext}".encode()),
        ]
    )
    with pytest.raises(personal_tokens.InvalidAuthorizationHeader):
        personal_tokens.bearer_token_from_request(duplicate)

    malformed = make_request(headers=[(b"authorization", b"Bearer not-an-opentech-token")])
    with pytest.raises(personal_tokens.InvalidAuthorizationHeader):
        personal_tokens.bearer_token_from_request(malformed)


def test_read_scope_allows_only_safe_methods():
    assert personal_tokens.scope_allows_method("read", "GET")
    assert personal_tokens.scope_allows_method("read", "HEAD")
    assert not personal_tokens.scope_allows_method("read", "POST")
    assert not personal_tokens.scope_allows_method("read", "DELETE")
    assert personal_tokens.scope_allows_method("full", "POST")


def test_validation_queries_by_hash_and_never_grants_admin(monkeypatch):
    plaintext = personal_tokens.generate_personal_token().plaintext
    store = FakeStore([active_row(roles=["contributor", "admin"])])
    monkeypatch.setattr(personal_tokens, "_get_sb", lambda: store)

    validated = personal_tokens.validate_personal_token(plaintext)

    assert validated is not None
    assert validated.user.email == "researcher@example.org"
    assert validated.user.roles == frozenset({"contributor"})
    select_filters = store.calls[0][1]
    assert ("token_hash", personal_tokens.hash_personal_token(plaintext)) in select_filters
    assert all(plaintext not in str(call) for call in store.calls)
    assert store.updated_values is not None and "last_used_at" in store.updated_values


@pytest.mark.parametrize(
    "row",
    [
        active_row(revoked_at=datetime.now(timezone.utc).isoformat()),
        active_row(expires_at=(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()),
        active_row(realm="another-app"),
    ],
)
def test_revoked_expired_or_wrong_realm_tokens_are_indistinguishably_invalid(monkeypatch, row):
    store = FakeStore([row])
    monkeypatch.setattr(personal_tokens, "_get_sb", lambda: store)
    assert personal_tokens.validate_personal_token(personal_tokens.generate_personal_token().plaintext) is None
    assert store.updated_values is None


def test_token_cannot_manage_more_tokens():
    request = make_request()
    request.state.auth_service_unavailable = False
    request.state.auth_method = "api_token"
    request.state.auth_user = RealmUser(
        id="keycloak-subject-123",
        username="researcher",
        email="researcher@example.org",
        realm="opentechdb",
        roles=frozenset({"contributor"}),
    )

    with pytest.raises(HTTPException) as exc:
        personal_tokens._require_browser_session(request)
    assert exc.value.status_code == 401


def test_creation_stores_digest_only_and_clamps_admin_to_contributor(monkeypatch):
    store = FakeStore([])
    monkeypatch.setattr(personal_tokens, "_get_sb", lambda: store)
    request = make_request(method="POST")
    request.state.auth_service_unavailable = False
    request.state.auth_method = "session"
    request.state.auth_user = RealmUser(
        id="keycloak-admin-123",
        username="administrator",
        email="administrator@example.org",
        realm="opentechdb",
        roles=frozenset({"admin", "contributor"}),
    )

    created = personal_tokens.create_personal_token.__wrapped__(
        request,
        Response(),
        personal_tokens.CreatePersonalTokenRequest(
            name="Automation",
            scope="full",
            expires_in_days=90,
        ),
    )

    assert store.inserted_values is not None
    assert created.token.startswith("otdb_")
    assert store.inserted_values["token_hash"] == personal_tokens.hash_personal_token(created.token)
    assert created.token not in str(store.inserted_values)
    assert store.inserted_values["roles"] == ["contributor"]
    assert "admin" not in store.inserted_values["roles"]


def test_revocation_is_scoped_to_current_keycloak_subject(monkeypatch):
    store = FakeStore([])
    monkeypatch.setattr(personal_tokens, "_get_sb", lambda: store)
    request = make_request(method="DELETE")
    request.state.auth_service_unavailable = False
    request.state.auth_method = "session"
    request.state.auth_user = RealmUser(
        id="keycloak-user-123",
        username="researcher",
        email="researcher@example.org",
        realm="opentechdb",
        roles=frozenset({"contributor"}),
    )

    response = personal_tokens.revoke_personal_token.__wrapped__(request, 7)

    assert response.status_code == 204
    assert ("id", 7) in store.calls[-1][1]
    assert ("user_id", "keycloak-user-123") in store.calls[-1][1]
    assert ("revoked_at", "null") in store.calls[-1][1]


def test_listing_keeps_old_active_tokens_visible(monkeypatch):
    store = FakeStore([])
    store.select_results = [
        [{"id": token_id} for token_id in range(100, 190)],
        [{"id": 7}],
        [],
    ]
    monkeypatch.setattr(personal_tokens, "_get_sb", lambda: store)

    rows = personal_tokens._list_rows_for_user("keycloak-user-123")

    assert len(rows) == 91
    assert any(row["id"] == 7 for row in rows)
    assert all(("user_id", "keycloak-user-123") in filters for _, filters in store.calls)

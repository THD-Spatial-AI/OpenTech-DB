"""
Process simulations require an authenticated user (browser session or personal
API token); anonymous requests are refused before reaching processsim.
"""
from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

import main
from api.auth_session import RealmUser
from api.personal_tokens import ValidatedPersonalToken, generate_personal_token

client = TestClient(main.app)
SIM = "/api/v1/processes/simulate"
GRAPH = {"units": [], "streams": []}


@pytest.fixture
def processsim(monkeypatch):
    """Record calls the backend forwards to processsim instead of sending them."""
    calls = []

    def fake(method):
        def _call(url, **kw):
            calls.append((method, url, kw.get("headers", {})))
            return SimpleNamespace(status_code=200, json=lambda: {"job_id": "job-1", "status": "queued"})
        return _call

    monkeypatch.setattr(httpx, "post", fake("POST"))
    monkeypatch.setattr(httpx, "get", fake("GET"))
    return calls


def _token(monkeypatch, scope: str, roles: frozenset[str] = frozenset()) -> dict:
    user = RealmUser(id="kc-user-1", username="alice", email="alice@example.org",
                     realm="opentechdb", roles=roles)
    monkeypatch.setattr(main, "validate_personal_token",
                        lambda plaintext: ValidatedPersonalToken(token_id=7, user=user, scope=scope))
    return {"Authorization": f"Bearer {generate_personal_token().plaintext}"}


def test_anonymous_cannot_submit_a_simulation(processsim):
    resp = client.post(SIM, json=GRAPH)
    assert resp.status_code == 401
    assert processsim == []


def test_anonymous_cannot_poll_a_simulation(processsim):
    resp = client.get(f"{SIM}/job-1")
    assert resp.status_code == 401
    assert processsim == []


def test_simulate_token_submits_as_its_user(monkeypatch, processsim):
    resp = client.post(SIM, json=GRAPH, headers=_token(monkeypatch, "simulate"))
    assert resp.status_code == 200
    assert resp.json()["job_id"] == "job-1"
    (_, url, headers), = processsim
    assert url.endswith("/api/process/jobs")
    assert headers["X-User-Id"] == "kc-user-1"
    assert headers["X-User-Tier"] == "2"


def test_simulate_token_can_poll(monkeypatch, processsim):
    resp = client.get(f"{SIM}/job-1", headers=_token(monkeypatch, "simulate"))
    assert resp.status_code == 200


def test_contributor_token_keeps_contributor_priority(monkeypatch, processsim):
    client.post(SIM, json=GRAPH, headers=_token(monkeypatch, "simulate", frozenset({"contributor"})))
    assert processsim[0][2]["X-User-Tier"] == "1"


def test_read_token_cannot_submit_a_simulation(monkeypatch, processsim):
    resp = client.post(SIM, json=GRAPH, headers=_token(monkeypatch, "read"))
    assert resp.status_code == 403
    assert processsim == []


def test_simulate_token_cannot_write_elsewhere(monkeypatch, processsim):
    resp = client.post("/api/v1/processes/submit", json={}, headers=_token(monkeypatch, "simulate"))
    assert resp.status_code == 403
    assert resp.json()["detail"] == "This API token can only read data and run simulations."

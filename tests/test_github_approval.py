"""
Tests for _create_github_pr_for_approval in api/_catalogue_ops.py

Uses unittest.mock to intercept httpx calls — no real GitHub requests.
Covers: success path, each failure point, and branch cleanup on rollback.
"""
from __future__ import annotations

import base64
import json
from unittest.mock import MagicMock, patch, call

import pytest
from fastapi import HTTPException

from api._catalogue_ops import _create_github_pr_for_approval

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_RECORD = {
    "submission_id": "abc12345-0000-0000-0000-000000000000",
    "technology_name": "Solar PV",
    "payload": {
        "technology_name": "Solar PV",
        "domain": "generation",
        "carrier": "solar",
        "instances": [{
            "variant_name": "100 MW utility",
            "capex_usd_per_kw": 1050.0,
            "lifetime_years": 30,
        }],
    },
}

_EMPTY_CAT = {"metadata": {"domain": "generation"}, "technologies": []}

def _encoded_cat(cat: dict) -> str:
    return base64.b64encode(
        (json.dumps(cat, indent=2) + "\n").encode()
    ).decode()


def _mock_response(status_code: int, body: dict | None = None) -> MagicMock:
    r = MagicMock()
    r.status_code = status_code
    r.json.return_value = body or {}
    return r


# ---------------------------------------------------------------------------
# Helper to build a patchable httpx mock sequence
# ---------------------------------------------------------------------------

def _github_responses(
    file_status: int = 200,
    ref_status:  int = 200,
    branch_status: int = 201,
    commit_status: int = 201,
    pr_status:   int = 201,
) -> list[MagicMock]:
    return [
        # 1. GET /contents/<file>
        _mock_response(file_status, {
            "sha": "abc",
            "content": _encoded_cat(_EMPTY_CAT),
        } if file_status == 200 else {}),
        # 2. GET /git/ref/heads/main
        _mock_response(ref_status, {"object": {"sha": "def"}} if ref_status == 200 else {}),
        # 3. POST /git/refs  (create branch)
        _mock_response(branch_status),
        # 4. PUT  /contents/<file>  (commit)
        _mock_response(commit_status),
        # 5. POST /pulls  (open PR)
        _mock_response(pr_status, {"html_url": "https://github.com/org/repo/pull/42"} if pr_status == 201 else {}),
    ]


# ---------------------------------------------------------------------------
# Success path
# ---------------------------------------------------------------------------

def test_success_returns_pr_url(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "fake-token")
    responses = iter(_github_responses())

    with patch("httpx.get",    side_effect=lambda *a, **kw: next(responses)), \
         patch("httpx.post",   side_effect=lambda *a, **kw: next(responses)), \
         patch("httpx.put",    side_effect=lambda *a, **kw: next(responses)):
        url = _create_github_pr_for_approval(_RECORD)

    assert url == "https://github.com/org/repo/pull/42"


def test_missing_catalogue_file_bootstraps_empty(monkeypatch):
    """A 404 on the catalogue file should not fail — start from empty."""
    monkeypatch.setenv("GITHUB_TOKEN", "fake-token")
    responses = iter(_github_responses(file_status=404))

    with patch("httpx.get",    side_effect=lambda *a, **kw: next(responses)), \
         patch("httpx.post",   side_effect=lambda *a, **kw: next(responses)), \
         patch("httpx.put",    side_effect=lambda *a, **kw: next(responses)):
        url = _create_github_pr_for_approval(_RECORD)

    assert url.startswith("https://")


# ---------------------------------------------------------------------------
# Missing token
# ---------------------------------------------------------------------------

def test_missing_github_token_raises_503(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    with pytest.raises(HTTPException) as exc:
        _create_github_pr_for_approval(_RECORD)
    assert exc.value.status_code == 503


# ---------------------------------------------------------------------------
# Failure points and branch cleanup
# ---------------------------------------------------------------------------

def test_commit_failure_deletes_branch(monkeypatch):
    """If the commit PUT fails, the newly created branch must be deleted."""
    monkeypatch.setenv("GITHUB_TOKEN", "fake-token")

    get_responses  = iter([
        _mock_response(200, {"sha": "abc", "content": _encoded_cat(_EMPTY_CAT)}),
        _mock_response(200, {"object": {"sha": "def"}}),
    ])
    post_responses = iter([
        _mock_response(201),  # branch created
    ])
    put_responses  = iter([
        _mock_response(500),  # commit fails
    ])
    delete_calls   = []

    def fake_delete(url, **kw):
        delete_calls.append(url)
        return _mock_response(204)

    with patch("httpx.get",    side_effect=lambda *a, **kw: next(get_responses)), \
         patch("httpx.post",   side_effect=lambda *a, **kw: next(post_responses)), \
         patch("httpx.put",    side_effect=lambda *a, **kw: next(put_responses)), \
         patch("httpx.delete", side_effect=fake_delete):
        with pytest.raises(HTTPException) as exc:
            _create_github_pr_for_approval(_RECORD)

    assert exc.value.status_code == 502
    assert len(delete_calls) == 1, "Branch must be deleted exactly once on commit failure"


def test_pr_failure_deletes_branch(monkeypatch):
    """If the PR POST fails, the branch (which has a commit) must be deleted."""
    monkeypatch.setenv("GITHUB_TOKEN", "fake-token")

    get_responses  = iter([
        _mock_response(200, {"sha": "abc", "content": _encoded_cat(_EMPTY_CAT)}),
        _mock_response(200, {"object": {"sha": "def"}}),
    ])
    post_call_count = [0]

    def fake_post(url, **kw):
        post_call_count[0] += 1
        if post_call_count[0] == 1:
            return _mock_response(201)   # branch
        return _mock_response(422)       # PR fails

    put_responses = iter([_mock_response(201)])
    delete_calls  = []

    def fake_delete(url, **kw):
        delete_calls.append(url)
        return _mock_response(204)

    with patch("httpx.get",    side_effect=lambda *a, **kw: next(get_responses)), \
         patch("httpx.post",   side_effect=fake_post), \
         patch("httpx.put",    side_effect=lambda *a, **kw: next(put_responses)), \
         patch("httpx.delete", side_effect=fake_delete):
        with pytest.raises(HTTPException) as exc:
            _create_github_pr_for_approval(_RECORD)

    assert exc.value.status_code == 502
    assert len(delete_calls) == 1, "Branch must be deleted on PR failure"


def test_github_api_error_fetching_catalogue_raises_502(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "fake-token")

    with patch("httpx.get", return_value=_mock_response(500)):
        with pytest.raises(HTTPException) as exc:
            _create_github_pr_for_approval(_RECORD)

    assert exc.value.status_code == 502

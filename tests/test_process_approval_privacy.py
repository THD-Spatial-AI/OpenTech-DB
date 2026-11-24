"""
Approved Process seeds are published to the public Git repository, whose
history cannot be erased. They must not carry the submitter's identity.
"""
from __future__ import annotations

import json

import api.processes as processes
from api.processes import ReviewAction, review_process_submission


def test_approved_seed_drops_author(tmp_path, monkeypatch):
    pending, published = tmp_path / "pending", tmp_path / "processes"
    pending.mkdir()
    monkeypatch.setattr(processes, "_PENDING_DIR", pending)
    monkeypatch.setattr(processes, "PROCESS_DIR", published)
    monkeypatch.setattr(processes, "_require_admin", lambda request: {"sub": "admin-sub"})
    monkeypatch.setattr(processes, "reload_processes", lambda: None)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)

    sid = "11111111-2222-3333-4444-555555555555"
    processes._sub_path(sid).write_text(json.dumps({
        "submission_id": sid,
        "status": "pending_review",
        "submitter": "researcher@example.org",
        "user_id": "keycloak-sub-123",
        "payload": {"slug": "demo_process", "name": "Demo", "author": "keycloak-sub-123"},
    }), encoding="utf-8")

    review_process_submission(None, sid, ReviewAction(action="approve"))

    seed = json.loads((published / "demo_process.json").read_text(encoding="utf-8"))
    assert seed["author"] is None
    assert "keycloak-sub-123" not in json.dumps(seed)
    assert "researcher@example.org" not in json.dumps(seed)

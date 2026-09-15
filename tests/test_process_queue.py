"""
Regression tests for the simulation job queue (ADR-0005).

Uses a fast fake executor so ordering / quota / timeout are deterministic and
network-free — the OpenModelica engine is just another ``run_fn``.
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "services" / "processsim"))

from jobqueue import JobQueue, JobStatus, QuotaError  # noqa: E402


def _wait_until(pred, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.02)
    return False


def test_priority_tiers_ordered_admin_first():
    order: list[str] = []
    gate = threading.Event()

    def run(g):
        if g["id"] == "blocker":
            gate.wait(2)            # hold the worker so the next three queue up
        order.append(g["id"])
        return {"engine": "test"}

    q = JobQueue(run, timeout_s=5)
    q.enqueue("u0", 2, {"id": "blocker"})
    _wait_until(lambda: q._current is not None)      # worker is on the blocker

    q.enqueue("uA", 2, {"id": "anon"})               # tier 2
    q.enqueue("uB", 1, {"id": "contributor"})        # tier 1
    q.enqueue("uC", 0, {"id": "admin"})              # tier 0
    gate.set()                                       # release the blocker

    assert _wait_until(lambda: len(order) == 4, timeout=5)
    assert order == ["blocker", "admin", "contributor", "anon"]


def test_per_user_quota_rejects_second_active_job():
    gate = threading.Event()
    q = JobQueue(lambda g: (gate.wait(2), {"engine": "test"})[1], timeout_s=5)
    q.enqueue("same", 1, {"id": "a"})
    with pytest.raises(QuotaError):
        q.enqueue("same", 1, {"id": "b"})
    gate.set()


def test_timeout_marks_job_and_calls_kill():
    killed = {"n": 0}
    q = JobQueue(lambda g: time.sleep(3), kill_fn=lambda: killed.__setitem__("n", killed["n"] + 1),
                 timeout_s=0.3)
    job, _ = q.enqueue("u", 1, {"id": "slow"})
    assert _wait_until(lambda: q.get(job.id)[0].status == JobStatus.TIMEOUT, timeout=3)
    assert killed["n"] == 1


def test_result_and_error_lifecycle():
    def run(g):
        if g["id"] == "boom":
            raise ValueError("kaboom")
        return {"engine": "test", "kpi": {"x": 1}}

    q = JobQueue(run, timeout_s=5)
    ok, _ = q.enqueue("u1", 1, {"id": "fine"})
    bad, _ = q.enqueue("u2", 1, {"id": "boom"})
    assert _wait_until(lambda: q.get(ok.id)[0].status == JobStatus.DONE)
    assert q.get(ok.id)[0].result["kpi"]["x"] == 1
    assert _wait_until(lambda: q.get(bad.id)[0].status == JobStatus.ERROR)
    assert "kaboom" in q.get(bad.id)[0].error

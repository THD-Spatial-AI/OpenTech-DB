"""
jobqueue.py
===========
Managed, prioritized job queue for the simulation engine (ADR-0005).

Engine-agnostic: it runs whatever ``run_fn(graph) -> result`` it is given, so its
ordering / quota / timeout behaviour is testable with the fast steady-state
executor and the OpenModelica engine simply plugs in as ``run_fn``.

Policy:
  • one serialized worker thread (in-memory queue)
  • priority = role tier (admin=0 → contributor=1 → anonymous=2), FIFO within tier
  • per-user quota: one active (queued|running) job per user
  • per-job wall-clock timeout → kill hook, job marked ``timeout``
  • memory guard: hold dispatch while free memory is below a floor
"""

from __future__ import annotations

import heapq
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable

log = logging.getLogger("processsim.jobs")


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"


_ACTIVE = {JobStatus.QUEUED, JobStatus.RUNNING}


@dataclass
class Job:
    id: str
    user_id: str
    tier: int
    graph: dict
    seq: int
    status: JobStatus = JobStatus.QUEUED
    result: dict | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None

    def public(self, position: int | None = None) -> dict:
        return {
            "job_id": self.id,
            "status": self.status.value,
            "position": position,
            "tier": self.tier,
            "result": self.result,
            "error": self.error,
            "engine": (self.result or {}).get("engine"),
            "wait_s": round((self.started_at or time.time()) - self.created_at, 1),
            "run_s": round((self.finished_at or time.time()) - self.started_at, 1) if self.started_at else None,
        }


class QuotaError(Exception):
    """Raised when a user already has an active job."""


class JobQueue:
    def __init__(self, run_fn: Callable[[dict], dict], kill_fn: Callable[[], None] | None = None,
                 *, timeout_s: float = 180, min_free_mb: float = 0,
                 free_mb_fn: Callable[[], float] | None = None):
        self._run_fn = run_fn
        self._kill_fn = kill_fn or (lambda: None)
        self._timeout_s = timeout_s
        self._min_free_mb = min_free_mb
        self._free_mb_fn = free_mb_fn or (lambda: float("inf"))
        self._heap: list[tuple[int, int, str]] = []
        self._jobs: dict[str, Job] = {}
        self._seq = 0
        self._current: str | None = None
        self._lock = threading.Lock()
        self._cv = threading.Condition(self._lock)
        threading.Thread(target=self._loop, name="sim-worker", daemon=True).start()

    # ── public API ────────────────────────────────────────────────────────────

    def enqueue(self, user_id: str, tier: int, graph: dict) -> tuple[Job, int | None]:
        with self._lock:
            for j in self._jobs.values():
                if j.user_id == user_id and j.status in _ACTIVE:
                    raise QuotaError("You already have a simulation in progress.")
            self._seq += 1
            job = Job(id=str(uuid.uuid4()), user_id=user_id, tier=int(tier), graph=graph, seq=self._seq)
            self._jobs[job.id] = job
            heapq.heappush(self._heap, (job.tier, job.seq, job.id))
            self._cv.notify()
            return job, self._position_locked(job.id)

    def get(self, job_id: str) -> tuple[Job | None, int | None]:
        with self._lock:
            j = self._jobs.get(job_id)
            return (j, self._position_locked(job_id)) if j else (None, None)

    def list_jobs(self) -> list[Job]:
        with self._lock:
            return sorted(self._jobs.values(), key=lambda j: (j.tier, j.seq))

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            j = self._jobs.get(job_id)
            if not j or j.status not in _ACTIVE:
                return False
            was_running = j.status == JobStatus.RUNNING and self._current == job_id
            j.status = JobStatus.CANCELLED
            j.finished_at = time.time()
            if was_running:
                self._kill_fn()
            return True

    def stats(self) -> dict:
        with self._lock:
            by = {s.value: 0 for s in JobStatus}
            for j in self._jobs.values():
                by[j.status.value] += 1
            return {"counts": by, "running": self._current, "free_mb": round(self._free_mb_fn(), 0)}

    # ── internals ──────────────────────────────────────────────────────────────

    def _position_locked(self, job_id: str) -> int | None:
        queued = sorted((j.tier, j.seq, j.id) for j in self._jobs.values() if j.status == JobStatus.QUEUED)
        for i, (_, _, jid) in enumerate(queued):
            if jid == job_id:
                return i + 1
        return None

    def _next_locked(self) -> Job | None:
        while self._heap:
            _, _, jid = heapq.heappop(self._heap)
            j = self._jobs.get(jid)
            if j and j.status == JobStatus.QUEUED:
                return j
        return None

    def _loop(self) -> None:
        while True:
            with self._cv:
                job = self._next_locked()
                while job is None:
                    self._cv.wait()
                    job = self._next_locked()
                while self._free_mb_fn() < self._min_free_mb:
                    log.warning("Low memory (%.0f MB < %.0f) — holding job %s",
                                self._free_mb_fn(), self._min_free_mb, job.id[:8])
                    self._cv.wait(timeout=5)
                job.status = JobStatus.RUNNING
                job.started_at = time.time()
                self._current = job.id
            self._run_with_timeout(job)
            with self._lock:
                self._current = None
                self._cv.notify_all()

    def _run_with_timeout(self, job: Job) -> None:
        box: dict = {}

        def target():
            try:
                box["result"] = self._run_fn(job.graph)
            except Exception as exc:  # noqa: BLE001
                box["error"] = str(exc)

        t = threading.Thread(target=target, daemon=True)
        t.start()
        t.join(self._timeout_s)

        with self._lock:
            if job.status == JobStatus.CANCELLED:
                return
            if t.is_alive():
                job.status = JobStatus.TIMEOUT
                job.error = f"Timed out after {self._timeout_s:.0f}s"
                self._kill_fn()   # abort the run; the abandoned thread errors out on its own
            elif "error" in box:
                job.status = JobStatus.ERROR
                job.error = box["error"]
            else:
                job.status = JobStatus.DONE
                job.result = box.get("result")
            job.finished_at = time.time()
            log.info("Job %s → %s (%.1fs)", job.id[:8], job.status.value, job.finished_at - (job.started_at or job.finished_at))

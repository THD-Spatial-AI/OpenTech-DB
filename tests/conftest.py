"""Shared test configuration loaded before application modules are imported."""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("AUTH_SERVICE_URL", "http://auth.test:8001")
os.environ.setdefault("AUTH_INTERNAL_SECRET", "test-internal-secret-with-at-least-32-characters")
os.environ.setdefault("AUTH_REALM", "opentechdb")
os.environ.setdefault("FRONTEND_URL", "http://localhost:5173")


@pytest.fixture
def anyio_backend():
    return "asyncio"

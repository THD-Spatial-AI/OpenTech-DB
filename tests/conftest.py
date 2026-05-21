"""
Shared pytest fixtures and env-var bootstrap.

api/auth.py raises RuntimeError at import time if ADMIN_EMAIL or
ADMIN_PASSWORD_HASH are missing.  Setting them here (at module level,
before any test collection) keeps local runs self-contained without
requiring a real .env file.  setdefault() means real env vars always win.
"""
from __future__ import annotations

import os

import bcrypt

os.environ.setdefault("ADMIN_EMAIL", "ci@example.com")
os.environ.setdefault("JWT_SECRET_KEY", "ci-test-jwt-secret")
os.environ.setdefault(
    "ADMIN_PASSWORD_HASH",
    bcrypt.hashpw(b"ci-test-password", bcrypt.gensalt(4)).decode(),
)

"""
Tests for api/auth.py and api/_auth_helpers.py

Covers:
  - Admin login: success, wrong password, wrong email, missing credentials
  - JWT round-trip: _create_jwt / _decode_jwt
  - _decode_supabase_jwt: structural path (no SUPABASE_JWT_SECRET)
  - _require_admin: accepts admin JWT, rejects missing/non-admin tokens
  - _decode_supabase_jwt: cryptographic path (with SUPABASE_JWT_SECRET)
"""
from __future__ import annotations

import time
import os
import pytest

# ---------------------------------------------------------------------------
# Helpers that don't touch the FastAPI app
# ---------------------------------------------------------------------------

def _make_supabase_jwt(
    sub: str = "user-uuid",
    aud: str = "authenticated",
    iss: str = "https://xyzproject.supabase.co/auth/v1",
    is_admin: bool = False,
    exp_offset: int = 3600,
    secret: str = "test-secret",
) -> str:
    """Mint a minimal Supabase-style HS256 JWT for testing."""
    import base64, json, hmac, hashlib

    header  = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b"=").decode()
    payload = {
        "sub": sub,
        "aud": aud,
        "iss": iss,
        "exp": int(time.time()) + exp_offset,
        "app_metadata": {"is_admin": is_admin},
    }
    body    = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    msg     = f"{header}.{body}".encode()
    sig     = hmac.new(secret.encode(), msg, hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{header}.{body}.{sig_b64}"


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

class TestJwtRoundTrip:
    def setup_method(self):
        os.environ.setdefault("JWT_SECRET_KEY", "test-secret-for-unit-tests")
        # Re-import after env is set so the module-level constant is initialised
        import importlib
        import api.auth as _auth_mod
        importlib.reload(_auth_mod)
        self.auth = _auth_mod

    def test_encode_decode_round_trip(self):
        token = self.auth._create_jwt({"sub": "admin", "is_admin": True})
        payload = self.auth._decode_jwt(token)
        assert payload["sub"] == "admin"
        assert payload["is_admin"] is True

    def test_expired_token_raises(self):
        from jose import JWTError
        token = self.auth._create_jwt({"sub": "x"})
        # Monkey-patch expiry to the past
        import jose.jwt as _jose
        orig = self.auth.JWT_EXPIRE_SECONDS
        self.auth.JWT_EXPIRE_SECONDS = -1
        expired = self.auth._create_jwt({"sub": "x"})
        self.auth.JWT_EXPIRE_SECONDS = orig
        with pytest.raises(JWTError):
            self.auth._decode_jwt(expired)


# ---------------------------------------------------------------------------
# Admin login
# ---------------------------------------------------------------------------

class TestAdminLogin:
    def setup_method(self):
        os.environ.setdefault("JWT_SECRET_KEY", "test-secret-for-unit-tests")
        # ADMIN_EMAIL and ADMIN_PASSWORD must be set in the environment before running tests.
        # ADMIN_PASSWORD_HASH must be the bcrypt hash of ADMIN_PASSWORD.
        if not os.environ.get("ADMIN_EMAIL") or not os.environ.get("ADMIN_PASSWORD") or not os.environ.get("ADMIN_PASSWORD_HASH"):
            import pytest
            pytest.skip("ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_PASSWORD_HASH env vars required for admin login tests")
        import importlib
        import api.auth as _auth_mod
        importlib.reload(_auth_mod)
        self.auth = _auth_mod

    def _login(self, email: str, password: str):
        from fastapi.testclient import TestClient
        from fastapi import FastAPI
        from slowapi import Limiter, _rate_limit_exceeded_handler
        from slowapi.errors import RateLimitExceeded
        from slowapi.util import get_remote_address

        app = FastAPI()
        limiter = Limiter(key_func=get_remote_address)
        app.state.limiter = limiter
        app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
        app.include_router(self.auth.router)
        client = TestClient(app, raise_server_exceptions=False)
        return client.post("/auth/admin/login", json={"email": email, "password": password})

    def test_correct_credentials_return_token(self):
        resp = self._login(
            os.environ["ADMIN_EMAIL"],
            os.environ["ADMIN_PASSWORD"],
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "token" in body
        assert body["user"]["is_admin"] is True

    def test_wrong_password_returns_401(self):
        resp = self._login(
            os.environ["ADMIN_EMAIL"],
            "wrong-password",
        )
        assert resp.status_code == 401

    def test_wrong_email_returns_401(self):
        resp = self._login("notadmin@example.com", os.environ["ADMIN_PASSWORD"])
        assert resp.status_code == 401

    def test_empty_body_returns_422(self):
        from fastapi.testclient import TestClient
        from fastapi import FastAPI
        from slowapi import Limiter, _rate_limit_exceeded_handler
        from slowapi.errors import RateLimitExceeded
        from slowapi.util import get_remote_address

        app = FastAPI()
        limiter = Limiter(key_func=get_remote_address)
        app.state.limiter = limiter
        app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
        app.include_router(self.auth.router)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post("/auth/admin/login", json={})
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Supabase JWT structural validation (no SUPABASE_JWT_SECRET)
# ---------------------------------------------------------------------------

class TestDecodeSupabaseJwtStructural:
    def setup_method(self):
        os.environ.pop("SUPABASE_JWT_SECRET", None)
        import importlib
        import api._auth_helpers as _helpers
        importlib.reload(_helpers)
        self.helpers = _helpers

    def _make_unsigned(
        self,
        iss: str = "https://proj.supabase.co/auth/v1",
        aud: str = "authenticated",
        exp_offset: int = 3600,
    ) -> str:
        import base64, json
        header  = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b"=").decode()
        payload = {"iss": iss, "aud": aud, "exp": int(time.time()) + exp_offset, "sub": "u1"}
        body    = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
        return f"{header}.{body}.fakesig"

    def test_valid_token_returns_payload(self):
        token = self._make_unsigned()
        payload = self.helpers._decode_supabase_jwt(token)
        assert payload["aud"] == "authenticated"

    def test_wrong_audience_raises(self):
        token = self._make_unsigned(aud="service_role")
        with pytest.raises(ValueError, match="audience"):
            self.helpers._decode_supabase_jwt(token)

    def test_non_supabase_issuer_raises(self):
        token = self._make_unsigned(iss="https://evil.com")
        with pytest.raises(ValueError, match="Not a Supabase JWT"):
            self.helpers._decode_supabase_jwt(token)

    def test_expired_token_raises(self):
        token = self._make_unsigned(exp_offset=-10)
        with pytest.raises(ValueError, match="expired"):
            self.helpers._decode_supabase_jwt(token)

    def test_malformed_token_raises(self):
        with pytest.raises(ValueError, match="Malformed"):
            self.helpers._decode_supabase_jwt("not.a.valid.jwt.here")


# ---------------------------------------------------------------------------
# Supabase JWT cryptographic validation (with SUPABASE_JWT_SECRET)
# ---------------------------------------------------------------------------

class TestDecodeSupabaseJwtCrypto:
    SECRET = "my-supabase-jwt-secret"

    def setup_method(self):
        os.environ["SUPABASE_JWT_SECRET"] = self.SECRET
        import importlib
        import api._auth_helpers as _helpers
        importlib.reload(_helpers)
        self.helpers = _helpers

    def teardown_method(self):
        os.environ.pop("SUPABASE_JWT_SECRET", None)

    def test_valid_signed_token_accepted(self):
        token = _make_supabase_jwt(secret=self.SECRET)
        payload = self.helpers._decode_supabase_jwt(token)
        assert payload["sub"] == "user-uuid"

    def test_wrong_signature_rejected(self):
        token = _make_supabase_jwt(secret="wrong-secret")
        with pytest.raises(ValueError, match="signature"):
            self.helpers._decode_supabase_jwt(token)


# ---------------------------------------------------------------------------
# _require_admin
# ---------------------------------------------------------------------------

class TestRequireAdmin:
    def setup_method(self):
        os.environ.setdefault("JWT_SECRET_KEY", "test-secret-for-unit-tests")
        os.environ.pop("SUPABASE_JWT_SECRET", None)
        import importlib
        import api.auth as _auth_mod
        import api._auth_helpers as _helpers
        importlib.reload(_auth_mod)
        importlib.reload(_helpers)
        self.auth    = _auth_mod
        self.helpers = _helpers

    def test_admin_orcid_jwt_accepted(self):
        token = self.auth._create_jwt({"sub": "admin", "is_admin": True})
        payload = self.helpers._require_admin(f"Bearer {token}")
        assert payload["is_admin"] is True

    def test_missing_token_raises_401(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            self.helpers._require_admin(None)
        assert exc.value.status_code == 401

    def test_non_admin_token_raises_403(self):
        from fastapi import HTTPException
        token = self.auth._create_jwt({"sub": "regularuser", "is_admin": False})
        with pytest.raises(HTTPException) as exc:
            self.helpers._require_admin(f"Bearer {token}")
        assert exc.value.status_code == 403

    def test_garbage_token_raises_401(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            self.helpers._require_admin("Bearer not-a-real-token")
        assert exc.value.status_code == 401

# Server crashes on startup when required env vars are absent

`api/auth.py` raises `RuntimeError` at import time if `JWT_SECRET_KEY`, `ADMIN_EMAIL`, or `ADMIN_PASSWORD_HASH` are not set. The server will not start.

The alternative — silent degradation (start without auth, disable protected endpoints) — was rejected because it produces a running server where auth silently fails and users cannot diagnose why. A hard crash with a descriptive error message is faster to debug and makes the dependency explicit. These three vars are generated locally with two shell commands and require no external accounts, so the setup cost is low.

Supabase and ORCID credentials are intentionally handled differently (graceful degradation) because those require external account registration and are not needed to browse the catalogue.

# Superseded: FastAPI-owned authentication secrets

This decision described the former `api/auth.py` implementation, which required
`JWT_SECRET_KEY`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD_HASH` at import time. That
implementation has been removed.

Authentication is now owned by the standalone Go service and the isolated
Keycloak `opentechdb` realm. FastAPI requires a securely configured
`AUTH_INTERNAL_SECRET` when validating a browser session and fails protected
requests closed with `503` if the auth service cannot be trusted or reached.
Admin accounts and application users are never created in Supabase/PostgreSQL.

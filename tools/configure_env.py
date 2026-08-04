"""Configure matching local OpenTech DB and Keycloak/Go auth secrets.

This script deliberately does not create Supabase Auth users. Authentication,
roles, and users live only in the isolated ``opentechdb`` Keycloak realm.
"""
from __future__ import annotations

import re
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND_ENV = ROOT / ".env"
AUTH_ENV = ROOT / "keycloak" / ".env.local"
FRONTEND_ENV = ROOT / "frontend" / ".env.local"


def read_env(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    data: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line.strip())
        if match:
            data[match.group(1)] = match.group(2).strip()
    return data


def set_env_var(path: Path, key: str, value: str) -> None:
    content = path.read_text(encoding="utf-8") if path.exists() else ""
    pattern = rf"^{re.escape(key)}=.*$"
    replacement = f"{key}={value}"
    if re.search(pattern, content, re.MULTILINE):
        content = re.sub(pattern, replacement, content, flags=re.MULTILINE)
    else:
        content = content.rstrip("\n") + f"\n{replacement}\n"
    path.write_text(content, encoding="utf-8")


def remove_env_vars(path: Path, keys: set[str]) -> None:
    if not path.exists():
        return
    lines = path.read_text(encoding="utf-8").splitlines()
    retained = [
        line for line in lines
        if line.strip().split("=", 1)[0] not in keys
    ]
    updated = "\n".join(retained).rstrip("\n") + "\n"
    if updated != path.read_text(encoding="utf-8"):
        path.write_text(updated, encoding="utf-8")
        print(f"  {path.relative_to(ROOT)}: removed retired browser/auth secrets  ✓")


def ensure_secret(path: Path, key: str, *, shared_value: str | None = None) -> str:
    current = read_env(path).get(key, "").strip()
    if shared_value is not None:
        if current != shared_value:
            set_env_var(path, key, shared_value)
            print(f"  {path.name}: {key} synchronized  ✓")
        else:
            print(f"  {path.name}: {key} already synchronized")
        return shared_value
    if current and not current.startswith("replace-with"):
        print(f"  {path.name}: {key} already set")
        return current
    value = shared_value or secrets.token_urlsafe(48)
    set_env_var(path, key, value)
    print(f"  {path.name}: {key} generated  ✓")
    return value


def main() -> None:
    if not BACKEND_ENV.exists():
        print(f"ERROR: {BACKEND_ENV} not found. Copy .env.example first.")
        sys.exit(1)

    if not AUTH_ENV.exists():
        AUTH_ENV.write_text(
            "KEYCLOAK_ADMIN_USERNAME=admin\n"
            "KEYCLOAK_DB_USER=keycloak\n",
            encoding="utf-8",
        )
        print(f"  created {AUTH_ENV.relative_to(ROOT)}")

    internal_secret = ensure_secret(BACKEND_ENV, "AUTH_INTERNAL_SECRET")
    remove_env_vars(BACKEND_ENV, {
        "ADMIN_EMAIL",
        "ADMIN_PASSWORD_HASH",
        "JWT_SECRET_KEY",
        "ORCID_CLIENT_ID",
        "ORCID_CLIENT_SECRET",
        "ORCID_REDIRECT_URI",
        "SUPABASE_ANON_KEY",
        "SUPABASE_JWT_SECRET",
    })
    remove_env_vars(FRONTEND_ENV, {
        "VITE_SUPABASE_ANON_KEY",
        "VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY",
        "VITE_SUPABASE_URL",
    })
    set_env_var(BACKEND_ENV, "AUTH_SERVICE_URL", "http://localhost:8001")
    set_env_var(BACKEND_ENV, "AUTH_REALM", "opentechdb")

    ensure_secret(AUTH_ENV, "KEYCLOAK_ADMIN_PASSWORD")
    ensure_secret(AUTH_ENV, "KEYCLOAK_DB_PASSWORD")
    ensure_secret(AUTH_ENV, "REDIS_PASSWORD")
    ensure_secret(AUTH_ENV, "OPENTECHDB_CLIENT_SECRET")
    ensure_secret(AUTH_ENV, "AUTH_INTERNAL_SECRET", shared_value=internal_secret)

    print("\n  Authentication configuration is ready.")
    print("  The 'make auth' target can start or rebuild the authentication stack.")
    print("  Grant the realm role 'admin' in Keycloak; no hardcoded admin exists.\n")


if __name__ == "__main__":
    main()

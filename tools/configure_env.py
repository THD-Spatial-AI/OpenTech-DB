"""
Interactive .env configurator.
Fills in JWT_SECRET_KEY (auto-generated) and ADMIN_EMAIL / ADMIN_PASSWORD_HASH
(prompted) if they are not already set, then creates the admin user in the
local Supabase instance with is_admin: true in app_metadata.

Called by:  make configure
Safe to re-run — skips any value already set.
"""

import getpass
import re
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV  = ROOT / ".env"

# Values that count as "not configured yet"
_PLACEHOLDERS = {"admin@example.com", "your-email@example.com", "change-me", ""}


# ── .env helpers ─────────────────────────────────────────────────────────────

def read_env(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    data: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
        if m:
            data[m.group(1)] = m.group(2)
    return data


def set_env_var(path: Path, key: str, value: str) -> None:
    content = path.read_text(encoding="utf-8") if path.exists() else ""
    pattern = rf"^{re.escape(key)}=.*$"
    replacement = f"{key}={value}"
    if re.search(pattern, content, re.MULTILINE):
        content = re.sub(pattern, replacement, content, flags=re.MULTILINE)
    else:
        content = content.rstrip("\n") + f"\n{key}={value}\n"
    path.write_text(content, encoding="utf-8")


def already_set(current: dict, key: str) -> bool:
    value = current.get(key, "").strip()
    return bool(value) and value not in _PLACEHOLDERS


# ── Supabase admin user creation ─────────────────────────────────────────────

def create_supabase_admin(url: str, service_key: str, email: str, password: str) -> None:
    """Create (or promote) a Supabase user with is_admin: true."""
    try:
        from supabase import create_client  # type: ignore[import]
    except ImportError:
        print("  Supabase admin user  skipped (supabase package not installed)")
        return

    if not url or not service_key:
        print("  Supabase admin user  skipped (SUPABASE_URL / SERVICE_ROLE_KEY not set)")
        return

    try:
        sb = create_client(url, service_key)

        # Try to create; if already exists, fetch and update instead
        try:
            result = sb.auth.admin.create_user({
                "email": email,
                "password": password,
                "email_confirm": True,
                "app_metadata": {"is_admin": True},
            })
            print(f"  Supabase admin user  created ({email})  ✓")
        except Exception as create_err:
            err_str = str(create_err).lower()
            if "already" in err_str or "exists" in err_str or "duplicate" in err_str:
                # User exists — just promote them
                users = sb.auth.admin.list_users()
                user = next((u for u in users if u.email == email), None)
                if user:
                    sb.auth.admin.update_user_by_id(
                        str(user.id),
                        {"app_metadata": {"is_admin": True}},
                    )
                    print(f"  Supabase admin user  already exists — promoted to admin  ✓")
                else:
                    print(f"  Supabase admin user  could not find existing user to promote")
            else:
                print(f"  Supabase admin user  warning: {create_err}")
                print("  You can promote manually in Supabase Studio → Authentication → Users")

    except Exception as e:
        print(f"  Supabase admin user  skipped (Supabase not reachable: {e})")
        print("  Run `make configure` again after `make supabase` to create the admin user.")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    if not ENV.exists():
        print(f"ERROR: {ENV} not found. Run `make install` first.")
        sys.exit(1)

    current = read_env(ENV)
    admin_email    = ""
    admin_password = ""
    print()

    # ── JWT_SECRET_KEY ────────────────────────────────────────────────────────
    if already_set(current, "JWT_SECRET_KEY"):
        print("  JWT_SECRET_KEY        already set — skipping")
    else:
        key = secrets.token_urlsafe(32)
        set_env_var(ENV, "JWT_SECRET_KEY", key)
        print("  JWT_SECRET_KEY        generated  ✓")

    # ── ADMIN_EMAIL ───────────────────────────────────────────────────────────
    if already_set(current, "ADMIN_EMAIL"):
        admin_email = current["ADMIN_EMAIL"]
        print(f"  ADMIN_EMAIL           already set ({admin_email}) — skipping")
    else:
        admin_email = input("  Enter admin email: ").strip()
        if admin_email:
            set_env_var(ENV, "ADMIN_EMAIL", admin_email)
            print("  ADMIN_EMAIL           set  ✓")
        else:
            print("  ADMIN_EMAIL           skipped")

    # ── ADMIN_PASSWORD_HASH ───────────────────────────────────────────────────
    if already_set(current, "ADMIN_PASSWORD_HASH"):
        print("  ADMIN_PASSWORD_HASH   already set — skipping")
        print()
        print("  Tip: run `make configure` to re-create the Supabase admin user if needed.")
    else:
        try:
            import bcrypt  # noqa: PLC0415
        except ImportError:
            print("  ADMIN_PASSWORD_HASH   skipped (bcrypt not in venv; run: pip install bcrypt)")
        else:
            admin_password = getpass.getpass("  Enter admin password (hidden): ").strip()
            if admin_password:
                hashed = bcrypt.hashpw(admin_password.encode(), bcrypt.gensalt(12)).decode()
                set_env_var(ENV, "ADMIN_PASSWORD_HASH", hashed)
                print("  ADMIN_PASSWORD_HASH   hashed and saved  ✓")
            else:
                print("  ADMIN_PASSWORD_HASH   skipped")

    # ── Supabase admin user ───────────────────────────────────────────────────
    # Re-read .env after edits above so we get the latest SUPABASE_* values
    current = read_env(ENV)
    if admin_email and admin_password:
        create_supabase_admin(
            url         = current.get("SUPABASE_URL", ""),
            service_key = current.get("SUPABASE_SERVICE_ROLE_KEY", ""),
            email       = admin_email,
            password    = admin_password,
        )
    elif admin_email:
        print("  Supabase admin user  skipped (no password provided)")

    print()
    print("  Done. Start the servers with:  make backend  /  make frontend")
    print()


if __name__ == "__main__":
    main()

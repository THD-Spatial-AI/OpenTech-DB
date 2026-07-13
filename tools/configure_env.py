"""
Interactive .env configurator.
Fills in JWT_SECRET_KEY (auto-generated) and ADMIN_EMAIL / ADMIN_PASSWORD_HASH
(prompted) if they are not already set.  Safe to run multiple times — it never
overwrites a value that already exists.

Called by:  make configure
"""

import getpass
import re
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV  = ROOT / ".env"


# ── Helpers ──────────────────────────────────────────────────────────────────

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
    return bool(current.get(key, "").strip())


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    if not ENV.exists():
        print(f"ERROR: {ENV} not found. Run `make install` first.")
        sys.exit(1)

    current = read_env(ENV)
    changed = False

    print()

    # ── JWT_SECRET_KEY ────────────────────────────────────────────────────────
    if already_set(current, "JWT_SECRET_KEY"):
        print("  JWT_SECRET_KEY        already set — skipping")
    else:
        key = secrets.token_urlsafe(32)
        set_env_var(ENV, "JWT_SECRET_KEY", key)
        print(f"  JWT_SECRET_KEY        generated  ✓")
        changed = True

    # ── ADMIN_EMAIL ───────────────────────────────────────────────────────────
    if already_set(current, "ADMIN_EMAIL"):
        print(f"  ADMIN_EMAIL           already set ({current['ADMIN_EMAIL']}) — skipping")
    else:
        email = input("  Enter admin email: ").strip()
        if not email:
            print("  Skipped (no value entered).")
        else:
            set_env_var(ENV, "ADMIN_EMAIL", email)
            print(f"  ADMIN_EMAIL           set  ✓")
            changed = True

    # ── ADMIN_PASSWORD_HASH ───────────────────────────────────────────────────
    if already_set(current, "ADMIN_PASSWORD_HASH"):
        print("  ADMIN_PASSWORD_HASH   already set — skipping")
    else:
        try:
            import bcrypt  # noqa: PLC0415
        except ImportError:
            print("  ADMIN_PASSWORD_HASH   skipped (bcrypt not installed; run pip install bcrypt)")
        else:
            pw = getpass.getpass("  Enter admin password (hidden): ").strip()
            if not pw:
                print("  Skipped (no value entered).")
            else:
                hashed = bcrypt.hashpw(pw.encode(), bcrypt.gensalt(12)).decode()
                set_env_var(ENV, "ADMIN_PASSWORD_HASH", hashed)
                print("  ADMIN_PASSWORD_HASH   hashed and saved  ✓")
                changed = True

    print()
    if changed:
        print("  .env updated. You're ready to run the servers.")
    else:
        print("  Nothing to do — all required values were already set.")
    print()


if __name__ == "__main__":
    main()

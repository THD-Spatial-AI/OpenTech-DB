"""
Parse `supabase status` and write local credentials into .env and
frontend/.env.local.  Called automatically by `make supabase`.
Handles both the new box-drawing format (Supabase CLI v2+) and the
older colon-separated format (v1).
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


# ── Supabase status parsing ───────────────────────────────────────────────────

def _status_env_format() -> dict | None:
    """Try `supabase status --output env` — returns dict or None on failure."""
    try:
        r = subprocess.run(
            ["supabase", "status", "--output", "env"],
            capture_output=True, text=True,
        )
        if r.returncode != 0 or not r.stdout.strip():
            return None
        data: dict[str, str] = {}
        for line in r.stdout.splitlines():
            m = re.match(r"^(\w+)=(.+)$", line.strip())
            if m:
                data[m.group(1)] = m.group(2)
        if not data.get("API_URL"):
            return None
        return {
            "api_url":          data.get("API_URL", ""),
            "anon_key":         data.get("ANON_KEY", ""),
            "service_role_key": data.get("SERVICE_ROLE_KEY", ""),
            "jwt_secret":       data.get(
                "JWT_SECRET",
                "super-secret-jwt-token-with-at-least-32-characters-long",
            ),
        }
    except FileNotFoundError:
        return None


def _status_text_format() -> dict | None:
    """Fall back to parsing the human-readable `supabase status` output."""
    try:
        r = subprocess.run(
            ["supabase", "status"],
            capture_output=True, text=True,
        )
        text = r.stdout + r.stderr
    except FileNotFoundError:
        print("ERROR: supabase CLI not found. Run:  npm install -g supabase")
        sys.exit(1)

    creds: dict[str, str] = {
        "api_url":          "",
        "anon_key":         "",
        "service_role_key": "",
        "jwt_secret":       "super-secret-jwt-token-with-at-least-32-characters-long",
    }

    for line in text.splitlines():
        # ── New box-drawing format (CLI v2+) ──────────────────────────────
        if "Project URL" in line:
            m = re.search(r"│\s*(http://[^\s│]+)\s*│", line)
            if m:
                creds["api_url"] = m.group(1).strip()
        if "Publishable" in line:
            m = re.search(r"│\s*(sb_publishable_\S+)\s*│", line)
            if m:
                creds["anon_key"] = m.group(1).strip()
        if re.search(r"│\s*Secret\s*│", line):
            m = re.search(r"│\s*(sb_secret_\S+)\s*│", line)
            if m:
                creds["service_role_key"] = m.group(1).strip()

        # ── Old colon-separated format (CLI v1) ───────────────────────────
        if re.match(r"\s*API URL\s*:", line):
            creds["api_url"] = line.split(":", 1)[1].strip()
        if re.match(r"\s*anon key\s*:", line):
            creds["anon_key"] = line.split(":", 1)[1].strip()
        if re.match(r"\s*service_role key\s*:", line):
            creds["service_role_key"] = line.split(":", 1)[1].strip()
        if re.match(r"\s*JWT secret\s*:", line):
            creds["jwt_secret"] = line.split(":", 1)[1].strip()

    return creds if creds["api_url"] else None


def get_credentials() -> dict:
    creds = _status_env_format() or _status_text_format()
    if not creds or not creds["api_url"]:
        print("ERROR: Could not read credentials from `supabase status`.")
        print("Copy them manually from the output above into .env and frontend/.env.local.")
        sys.exit(1)
    return creds


# ── .env file patcher ─────────────────────────────────────────────────────────

def patch_env(path: Path, updates: dict[str, str]) -> None:
    content = path.read_text(encoding="utf-8") if path.exists() else ""
    for key, value in updates.items():
        pattern = rf"^{re.escape(key)}=.*$"
        replacement = f"{key}={value}"
        if re.search(pattern, content, re.MULTILINE):
            content = re.sub(pattern, replacement, content, flags=re.MULTILINE)
        else:
            content = content.rstrip("\n") + f"\n{key}={value}\n"
    path.write_text(content, encoding="utf-8")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    creds = get_credentials()

    patch_env(ROOT / ".env", {
        "SUPABASE_URL":              creds["api_url"],
        "SUPABASE_SERVICE_ROLE_KEY": creds["service_role_key"],
        "SUPABASE_JWT_SECRET":       creds["jwt_secret"],
    })
    print(f"  .env              → SUPABASE_URL={creds['api_url']}")

    fe = ROOT / "frontend" / ".env.local"
    patch_env(fe, {
        "VITE_SUPABASE_URL":                     creds["api_url"],
        "VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY": creds["anon_key"],
    })
    print(f"  frontend/.env.local → VITE_SUPABASE_URL={creds['api_url']}")


if __name__ == "__main__":
    main()

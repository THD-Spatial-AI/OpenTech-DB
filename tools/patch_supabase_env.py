"""
Read the local Supabase data endpoint/credentials and write them into .env.
Called automatically by `make supabase`. Supabase Auth is intentionally not
configured and no Supabase credential is written to the frontend.
The running data-service containers are authoritative because CLI status omits
API keys when Supabase Auth is disabled; status parsing remains a fallback.
"""

import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


# ── Local project configuration ──────────────────────────────────────────────

def _local_config() -> dict:
    try:
        with (ROOT / "supabase" / "config.toml").open("rb") as handle:
            return tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError):
        return {}


def _api_url_from_config() -> str:
    api = _local_config().get("api", {})
    port = api.get("port")
    if not isinstance(port, int):
        return ""
    scheme = "https" if api.get("tls", {}).get("enabled") else "http"
    return f"{scheme}://127.0.0.1:{port}"


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
                value = m.group(2).strip()
                if (
                    len(value) >= 2
                    and value[0] == value[-1]
                    and value[0] in "\"'"
                ):
                    value = value[1:-1]
                data[m.group(1)] = value
        if not data.get("API_URL"):
            return None
        return {
            "api_url": data.get("API_URL", ""),
            "service_role_key": data.get("SERVICE_ROLE_KEY", "") or data.get("SECRET_KEY", ""),
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
        "api_url": "",
        "service_role_key": "",
    }

    for line in text.splitlines():
        # ── New box-drawing format (CLI v2+) ──────────────────────────────
        if "Project URL" in line:
            m = re.search(r"│\s*(http://[^\s│]+)\s*│", line)
            if m:
                creds["api_url"] = m.group(1).strip()
        if re.search(r"│\s*Secret\s*│", line):
            m = re.search(r"│\s*(sb_secret_\S+)\s*│", line)
            if m:
                creds["service_role_key"] = m.group(1).strip()

        # ── Old colon-separated format (CLI v1) ───────────────────────────
        if re.match(r"\s*API URL\s*:", line):
            creds["api_url"] = line.split(":", 1)[1].strip()
        if re.match(r"\s*service_role key\s*:", line):
            creds["service_role_key"] = line.split(":", 1)[1].strip()

    return creds if creds["api_url"] else None


def _service_role_key_from_docker() -> str:
    """Read the local service-role key from a Supabase-owned container.

    Supabase CLI omits API keys from ``status`` when ``[auth].enabled`` is
    false, even though the data services still receive those keys.  Inspect
    only containers carrying this project's Supabase label and never print
    the recovered credential.
    """
    project_id = _local_config().get("project_id")
    if not isinstance(project_id, str) or not project_id:
        return ""

    try:
        containers = subprocess.run(
            [
                "docker", "ps",
                "--filter", f"label=com.supabase.cli.project={project_id}",
                "--format", "{{.ID}}",
            ],
            capture_output=True,
            text=True,
        )
        container_ids = containers.stdout.split()
        if containers.returncode != 0 or not container_ids:
            return ""

        inspected = subprocess.run(
            ["docker", "inspect", *container_ids],
            capture_output=True,
            text=True,
        )
        if inspected.returncode != 0:
            return ""
        details = json.loads(inspected.stdout)
    except (FileNotFoundError, json.JSONDecodeError):
        return ""

    environments: list[dict[str, str]] = []
    for detail in details:
        values: dict[str, str] = {}
        for entry in detail.get("Config", {}).get("Env", []) or []:
            key, separator, value = entry.partition("=")
            if separator:
                values[key] = value
        environments.append(values)

    # Edge Runtime exposes the precise variable name. Storage's SERVICE_KEY
    # is the fallback when Edge Runtime is disabled.
    for variable in ("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "SERVICE_KEY"):
        for environment in environments:
            if environment.get(variable):
                return environment[variable]
    return ""


def get_credentials() -> dict:
    # The config and running containers are authoritative for local startup and
    # avoid a slow telemetry timeout in some CLI releases. Status remains a
    # compatibility fallback for older local stacks.
    creds = {
        "api_url": _api_url_from_config(),
        "service_role_key": _service_role_key_from_docker(),
    }
    if not creds.get("api_url") or not creds.get("service_role_key"):
        env_creds = _status_env_format() or {}
        creds["api_url"] = creds.get("api_url") or env_creds.get("api_url", "")
        creds["service_role_key"] = (
            creds.get("service_role_key") or env_creds.get("service_role_key", "")
        )
    if not creds.get("api_url") or not creds.get("service_role_key"):
        text_creds = _status_text_format() or {}
        creds["api_url"] = creds.get("api_url") or text_creds.get("api_url", "")
        creds["service_role_key"] = (
            creds.get("service_role_key")
            or text_creds.get("service_role_key", "")
            or _service_role_key_from_docker()
        )
    if not creds or not creds["api_url"] or not creds["service_role_key"]:
        print("ERROR: Could not read backend data credentials from `supabase status`.")
        print(
            "Copy the project URL and service-role key manually into .env, "
            "or ensure the local Supabase containers are running."
        )
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
    })
    print(f"  .env              → SUPABASE_URL={creds['api_url']}")


if __name__ == "__main__":
    main()

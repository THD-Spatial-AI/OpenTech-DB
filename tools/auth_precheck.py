"""
tools/auth_precheck.py
======================
Cross-platform wrapper for the optional Keycloak credential guard used by the
`make auth` / `make install` flow.

The vendored `keycloak/` content is a snapshot that may or may not include
`scripts/check-persistent-credentials.sh` (a bash guard that aborts when local
secrets no longer match the persisted Keycloak/Redis data). This wrapper:

  * runs that script when it is present and a POSIX shell (bash) is available,
    forwarding all arguments and its exit code; otherwise
  * prints a one-line notice and exits 0, so `make install` still completes on
    a fresh checkout and on any platform (Windows cmd.exe, Git Bash, macOS,
    Linux) without the guard becoming a hard dependency.

Usage:
    python tools/auth_precheck.py <AUTH_ENV> <AUTH_COMPOSE_FILE> \
        <retry_hint> <reset_hint> <data_description>
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys

_SCRIPT = os.path.join("keycloak", "scripts", "check-persistent-credentials.sh")


def main(argv: list[str]) -> int:
    if not os.path.exists(_SCRIPT):
        print(f"Note: skipping Keycloak credential guard ({_SCRIPT} not present in this checkout).")
        return 0

    bash = shutil.which("bash")
    if not bash:
        print("Note: skipping Keycloak credential guard (no bash found on PATH to run it).")
        return 0

    return subprocess.call([bash, _SCRIPT, *argv])


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

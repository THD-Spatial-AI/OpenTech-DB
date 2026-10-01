#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start.sh — One-command startup for the Hydrogen Plant Simulation Bridge.
#
# Usage:
#   ./start.sh            # normal start (MATLAB engine if available, else mock)
#   ./start.sh --mock     # force mock engine even if MATLAB is installed
#
# Conda environment:
#   This service requires Python 3.11 (MATLAB R2024a is incompatible with 3.12+)
#   Create the environment once with:
#     conda create -n matlab-bridge python=3.11
#     conda run -n matlab-bridge pip install -r requirements.txt
#     conda run -n matlab-bridge pip install <MATLAB_ROOT>/extern/engines/python
#   Then this script detects and uses it automatically.
# ─────────────────────────────────────────────────────────────────────────────

set -e

CONDA_ENV="matlab-bridge"

# ── Force mock engine if requested ────────────────────────────────────────────
if [[ "$1" == "--mock" ]]; then
    export FORCE_MOCK_ENGINE=1
    echo "[start.sh] --mock flag set: MATLAB engine will NOT be used."
fi

# ── Load .env if present ──────────────────────────────────────────────────────
if [ -f .env ]; then
    set -o allexport
    # shellcheck disable=SC2046
    export $(grep -v '^#' .env | grep -v '^[[:space:]]*$' | xargs)
    set +o allexport
    echo "[start.sh] .env loaded."
fi

HOST=${HOST:-0.0.0.0}
PORT=${PORT:-8765}

echo "──────────────────────────────────────────────────────"
echo "  Hydrogen Plant Simulation Bridge"
echo "  Binding: ${HOST}:${PORT}"
echo "  PID:     $$"
echo "──────────────────────────────────────────────────────"

# ── Use conda environment if available (required for matlabengine) ────────────
if conda env list 2>/dev/null | grep -q "^${CONDA_ENV}"; then
    echo "[start.sh] Using conda env '${CONDA_ENV}' (Python 3.11 + matlabengine)"
    exec conda run -n "$CONDA_ENV" uvicorn main:app \
        --host "$HOST" \
        --port "$PORT" \
        --workers 1 \
        --log-level info
else
    echo "[start.sh] WARNING: conda env '${CONDA_ENV}' not found — using system Python (mock engine only)"
    exec uvicorn main:app \
        --host "$HOST" \
        --port "$PORT" \
        --workers 1 \
        --log-level info
fi

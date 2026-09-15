#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# health_check.sh — Quick health probe for the Hydrogen Plant Simulation Bridge.
#
# Exit codes:
#   0  — Service is healthy and engine is ready.
#   1  — Service unreachable or engine not ready.
#
# Usage:
#   bash health_check.sh
#   PORT=9000 bash health_check.sh
# ─────────────────────────────────────────────────────────────────────────────

PORT=${PORT:-8765}

RESP=$(curl -sf "http://localhost:${PORT}/api/hydrogen/health" 2>/dev/null \
       || echo '{"engine_ready":false,"engine_error":"service unreachable","active_jobs":0}')

echo "$RESP"

if echo "$RESP" | grep -q '"engine_ready":true'; then
    exit 0
else
    exit 1
fi

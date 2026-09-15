# start.ps1 — Windows startup script for the Hydrogen Plant Simulation Bridge.
# Uses the 'matlab-bridge' conda environment (Python 3.11 + matlabengine).
#
# Usage:
#   .\start.ps1            # normal start (uses MATLAB R2024a)
#   .\start.ps1 -Mock      # force mock engine (skip MATLAB)

param(
    [switch]$Mock
)

$ErrorActionPreference = "Stop"

# Force mock engine if requested
if ($Mock) {
    $env:FORCE_MOCK_ENGINE = "1"
    Write-Host "[start.ps1] --Mock flag set: MATLAB engine will NOT be used."
}

# Load .env if present
if (Test-Path ".env") {
    Get-Content ".env" | Where-Object { $_ -match "^\s*[^#]" -and $_ -match "=" } | ForEach-Object {
        $parts = $_ -split "=", 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
    }
    Write-Host "[start.ps1] .env loaded."
}

$host_addr = if ($env:HOST) { $env:HOST } else { "0.0.0.0" }
$port      = if ($env:PORT) { $env:PORT } else { "8765" }

Write-Host "──────────────────────────────────────────────────────"
Write-Host "  Hydrogen Plant Simulation Bridge"
Write-Host "  Binding  : ${host_addr}:${port}"
Write-Host "  Conda env: matlab-bridge (Python 3.11 + matlabengine 24.1)"
Write-Host "  MATLAB   : R2024a"
Write-Host "──────────────────────────────────────────────────────"

conda run -n matlab-bridge uvicorn main:app --host $host_addr --port $port --workers 1 --log-level info

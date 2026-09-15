# install-service.ps1 — Must run as Administrator
# Installs HydrogenSimBridge as a Windows auto-start service via NSSM

$SVC     = "HydrogenSimBridge"
$UVICORN = "C:\Users\admin1\anaconda3\envs\matlab-bridge\Scripts\uvicorn.exe"
$ARGS_S  = "main:app --host 0.0.0.0 --port 8765 --workers 1 --log-level info"
$DIR     = "C:\Users\admin1\Desktop\MATLAB_API\hydrogen-plant-sim"
$LOG     = "$DIR\service.log"
$ERR     = "$DIR\service.err"
$OUT     = "$DIR\install-service-out.txt"

Start-Transcript -Path $OUT -Force

try {
    Write-Host "[1] Stopping and removing existing service (if any)..."
    & nssm stop   $SVC 2>&1 | Out-Null
    & nssm remove $SVC confirm 2>&1 | Out-Null
    Start-Sleep 2

    Write-Host "[2] Installing service..."
    & nssm install $SVC $UVICORN $ARGS_S

    Write-Host "[3] Configuring service properties..."
    & nssm set $SVC AppDirectory     $DIR
    & nssm set $SVC AppStdout        $LOG
    & nssm set $SVC AppStderr        $ERR
    & nssm set $SVC AppRotateFiles   1
    & nssm set $SVC AppRotateSeconds 86400
    & nssm set $SVC Start            SERVICE_AUTO_START
    & nssm set $SVC AppRestartDelay  10000
    & nssm set $SVC Description      "Hydrogen Plant MATLAB Simulation Bridge — FastAPI + MATLAB R2024a"

    Write-Host "[4] Starting service..."
    & nssm start $SVC
    Start-Sleep 5

    Write-Host "[5] Service status:"
    & sc.exe query $SVC

    Write-Host ""
    Write-Host "SUCCESS: HydrogenSimBridge service installed and started."
    Write-Host "API: http://localhost:8765"
    Write-Host "MATLAB engine ready in ~30-60s after start."
}
catch {
    Write-Host "ERROR: $_"
}

Stop-Transcript

# update.ps1 - Update the opentech-db deployment
# Run as Administrator for service restart

Set-Location "C:\Users\admin1\Desktop\opentech-db"

Write-Host "Stopping services..."
Stop-Service opentech-db -ErrorAction Stop
Stop-ScheduledTask -TaskName "opentech-ngrok" -ErrorAction SilentlyContinue
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Pulling latest code..."
git pull

Write-Host "Installing/updating dependencies..."
.venv\Scripts\pip install -r requirements.txt --quiet

Write-Host "Restarting API service..."
Start-Service opentech-db

Start-Sleep -Seconds 3
$status = (Get-Service opentech-db).Status
Write-Host "Service status: $status"

if ($status -eq "Running") {
    Write-Host "Starting ngrok tunnel..."
    Start-ScheduledTask -TaskName "opentech-ngrok"
    Write-Host "Update complete. API: http://127.0.0.1:8005  Public: https://marleigh-unmuttering-effortlessly.ngrok-free.dev"
} else {
    Write-Host "WARNING: Service failed to start. Check logs at logs\uvicorn.log"
}

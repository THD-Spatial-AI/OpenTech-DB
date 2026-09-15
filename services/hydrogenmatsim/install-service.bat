@echo off
:: install-service.bat  —  Run this ONCE as Administrator to register
:: HydrogenSimBridge as a Windows auto-start service.
::
:: Usage (from an elevated command prompt):
::   install-service.bat

SET SVC=HydrogenSimBridge
SET UVICORN=C:\Users\admin1\anaconda3\envs\matlab-bridge\Scripts\uvicorn.exe
SET ARGS=main:app --host 0.0.0.0 --port 8765 --workers 1 --log-level info
SET DIR=C:\Users\admin1\Desktop\MATLAB_API\hydrogen-plant-sim
SET LOG=%DIR%\service.log
SET ERR=%DIR%\service.err
SET NSSM=nssm

echo [install-service] Removing existing service (if any)...
%NSSM% stop  %SVC% 2>nul
%NSSM% remove %SVC% confirm 2>nul

echo [install-service] Installing service...
%NSSM% install       %SVC% "%UVICORN%" "%ARGS%"
%NSSM% set %SVC% AppDirectory       %DIR%
%NSSM% set %SVC% AppStdout          %LOG%
%NSSM% set %SVC% AppStderr          %ERR%
%NSSM% set %SVC% AppRotateFiles     1
%NSSM% set %SVC% AppRotateSeconds   86400
%NSSM% set %SVC% Start              SERVICE_AUTO_START
%NSSM% set %SVC% AppRestartDelay    10000
%NSSM% set %SVC% Description        "Hydrogen Plant MATLAB Simulation Bridge — FastAPI + MATLAB R2024a"

echo [install-service] Starting service...
%NSSM% start %SVC%

echo.
echo [install-service] Service status:
sc query %SVC%

echo.
echo [install-service] Done. The API will be live at http://localhost:8765
echo [install-service] MATLAB engine takes ~30-60s to become ready after service start.
echo.
pause

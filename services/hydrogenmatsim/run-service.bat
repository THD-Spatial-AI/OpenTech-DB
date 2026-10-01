@echo off
REM Wrapper script for Task Scheduler — starts the hydrogen-plant-sim service.
REM Task Scheduler runs this at system startup as the current user.

SET "UVICORN=C:\Users\admin1\anaconda3\envs\matlab-bridge\Scripts\uvicorn.exe"
SET "DIR=C:\Users\admin1\Desktop\MATLAB_API\hydrogen-plant-sim"

cd /d "%DIR%"
"%UVICORN%" main:app --host 0.0.0.0 --port 8765 --workers 1 --log-level info >> "%DIR%\service.log" 2>> "%DIR%\service.err"

@echo off
title Argus AML Compliance Platform Launcher
echo ====================================================================
echo             ARGUS EXPLAINABLE AI AML MONITORING PLATFORM
echo ====================================================================
echo.
echo Launching services...
echo.

:: Launch Python ML Service
echo [System] Starting ML & Graph Analytics Python Service (Port 5000)...
start "Argus - ML Service (Flask)" cmd /k "cd /d %~dp0 && .venv\Scripts\activate && python ml-service\app.py"

:: Launch Express Backend API
echo [System] Starting Express Gateway Gateway API (Port 5050)...
start "Argus - Gateway Backend (Express)" cmd /k "cd /d %~dp0\backend && npm start"

:: Launch Vite React Frontend Portal
echo [System] Starting React UI Web Portal (Port 3000)...
start "Argus - Frontend Client (Vite)" cmd /k "cd /d %~dp0\frontend && npm run dev"

echo.
echo ====================================================================
echo  All services triggered in background command prompts.
echo  - ML Service Diagnostic Check: http://localhost:5000/health
echo  - Express API gateway stats:  http://localhost:5505/api/admin/system-stats
echo  - React Investigator GUI:    http://localhost:3000/
echo ====================================================================
echo.
pause

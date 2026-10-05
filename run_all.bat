@echo off
title FundTraceAI AML Compliance Platform Launcher
echo ====================================================================
echo          FUNDTRACE AI: EXPLAINABLE AML MONITORING PLATFORM
echo ====================================================================
echo.
echo Launching services...
echo.

:: Launch Python ML Service
echo [System] Starting ML and Graph Analytics Python Service (Port 5000)...
start "FundTraceAI - ML Service (Flask)" cmd /k "cd /d %~dp0 && .venv\Scripts\activate && python ml-service\app.py"

:: Launch Express Backend API
echo [System] Starting Express Gateway API (Port 5050)...
start "FundTraceAI - Gateway Backend (Express)" cmd /k "cd /d %~dp0\backend && npm start"

:: Launch Vite React Frontend Portal
echo [System] Starting React UI Web Portal (Port 3000)...
start "FundTraceAI - Frontend Client (Vite)" cmd /k "cd /d %~dp0\frontend && npm run dev"

echo.
echo ====================================================================
echo  All services triggered in background command prompts.
echo  - ML Service Diagnostic Check: http://localhost:5000/health
echo  - Express API gateway stats:  http://localhost:5050/api/admin/system-stats
echo  - React Investigator GUI:    http://localhost:3000/
echo ====================================================================
echo.
pause

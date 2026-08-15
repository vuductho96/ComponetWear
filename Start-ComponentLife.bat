@echo off
title ComponentLife - Local Server and Auto-Sync Engine
cd /d "%~dp0"

if not exist "%~dp0ComponentLife\ComponentLife.ps1" (
  echo Error: ComponentLife.ps1 not found!
  pause
  exit /b 1
)

:: Ensure port 8787 is clean before fresh start
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8787 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ComponentLife\ComponentLife.ps1"

echo.
echo [ComponentLife] Server stopped.


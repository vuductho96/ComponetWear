@echo off
title ComponentLife - Local Server and Auto-Sync Engine
cd /d "%~dp0"

if not exist "%~dp0ComponentLife\ComponentLife.ps1" (
  echo ❌ ERROR: ComponentLife.ps1 not found!
  pause
  exit /b 1
)

echo.
echo ===================================================
echo   ComponentLife - Auto-Sync ^& Server Launcher
echo ===================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ComponentLife\ComponentLife.ps1"

echo.
echo [ComponentLife] Server stopped.
pause

@echo off
setlocal
cd /d "%~dp0"

if not exist "%~dp0ComponentLife\ComponentLife.ps1" (
  echo ERROR: ComponentLife\ComponentLife.ps1 not found.
  pause
  exit /b 1
)

echo Dang khoi dong Component Life Server...
powershell -ExecutionPolicy Bypass -File "%~dp0ComponentLife\ComponentLife.ps1"
if %ERRORLEVEL% NEQ 0 (
  echo Dang mo giao dien ComponentLife.html...
  start "" "%~dp0ComponentLife\ComponentLife.html"
)

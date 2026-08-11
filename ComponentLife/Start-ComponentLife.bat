@echo off
setlocal
cd /d "%~dp0"

if not exist "ComponentLife.html" (
  echo ERROR: ComponentLife.html was not found in this folder.
  pause
  exit /b 1
)

echo Starting Component Life...
start "" "%~dp0ComponentLife.html"

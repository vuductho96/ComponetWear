@echo off
title ComponentLife - Local Server & Auto-Sync Engine
cd /d "%~dp0"

if not exist "%~dp0ComponentLife\ComponentLife.ps1" (
  echo Error: ComponentLife.ps1 not found!
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ComponentLife\auto_sync_excel.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ComponentLife\ComponentLife.ps1"


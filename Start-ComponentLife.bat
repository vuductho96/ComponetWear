@echo off
if "%~1"=="h" goto :begin
mshta vbscript:createobject("wscript.shell").run("""%~f0"" h",0)(window.close)&exit
:begin
cd /d "%~dp0"

if not exist "%~dp0ComponentLife\ComponentLife.ps1" (
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0ComponentLife\auto_sync_excel.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0ComponentLife\ComponentLife.ps1"


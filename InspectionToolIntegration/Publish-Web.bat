@echo off
chcp 65001 >nul
title Publish Inspection Tool to Cloudflare
set "INSPECTION_TOOL_DIR=%~dp0"
echo Dang cap nhat web. Ban van co the giu Inspection Tool mo.
echo Khong dong cua so nay cho den khi hien ket qua.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$config=Get-Content -LiteralPath (Join-Path $env:INSPECTION_TOOL_DIR 'InspectionWebPublish.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json; & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $config.projectRoot 'Publish-Inspection-Web.ps1') -ProjectRoot $config.projectRoot; $resultCode=$LASTEXITCODE; $stateFile=Join-Path $config.projectRoot '.cloud-publish/manual-inspection-status.json'; if(Test-Path -LiteralPath $stateFile){$state=Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json; Write-Host $state.message}; exit $resultCode"
if errorlevel 1 echo Chua publish thanh cong. Kiem tra thong bao ben tren va thu lai.
echo.
pause

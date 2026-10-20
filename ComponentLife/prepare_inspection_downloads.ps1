param([string]$ProjectRoot=(Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference='Stop'
$runtime=Join-Path $ProjectRoot '.cloud-publish/python-runtime/Scripts/python.exe'
& $runtime (Join-Path $ProjectRoot 'ComponentLife/prepare_inspection_downloads.py') $ProjectRoot
if($LASTEXITCODE -ne 0){throw 'Could not prepare original inspection downloads.'}

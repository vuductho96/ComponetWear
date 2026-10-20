$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$temp=Join-Path $env:TEMP ('inspection-publish-test-'+[Guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path (Join-Path $temp 'ComponentLife'),(Join-Path $temp '.cloud-publish') -Force
function Assert($condition,$message) { if(-not $condition){throw $message};Write-Output "PASS: $message" }
$entryScript=Join-Path $project 'Publish-Inspection-Web.ps1'
$entryBytes=[IO.File]::ReadAllBytes($entryScript)
Assert ($entryBytes.Length -ge 3 -and $entryBytes[0] -eq 239 -and $entryBytes[1] -eq 187 -and $entryBytes[2] -eq 191) 'Windows PowerShell entry script preserves its UTF-8 BOM'
$parseTokens=$null; $parseErrors=$null
$null=[Management.Automation.Language.Parser]::ParseFile($entryScript,[ref]$parseTokens,[ref]$parseErrors)
Assert ($parseErrors.Count -eq 0) 'Manual publish entry script parses in Windows PowerShell'
try {
@'
function Write-PublishJson($Path,$Value){[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json),[Text.UTF8Encoding]::new($false))}
function Get-PublicAssetManifest($Root){[pscustomobject]@{snapshotId='new'}}
'@ | Set-Content (Join-Path $temp 'ComponentLife/cloud_publish.ps1') -Encoding UTF8
@'
$root=Split-Path $PSScriptRoot -Parent
if(Test-Path (Join-Path $root 'read-fail')){exit 9}
$retryFile=Join-Path $root 'source-changes'
if(Test-Path $retryFile){$remaining=[int](Get-Content $retryFile);if($remaining -gt 0){Set-Content $retryFile ($remaining-1);Add-Content (Join-Path $root 'retry.log') 'changed';exit 75}}

Add-Content (Join-Path $root 'reads.log') 'read'
'@ | Set-Content (Join-Path $temp 'ComponentLife/export_inspection.ps1') -Encoding UTF8
@'
param($ProjectRoot)
if(Test-Path (Join-Path $ProjectRoot 'publish-fail')){exit 7}
Add-Content (Join-Path $ProjectRoot 'publishes.log') 'publish'
'{"snapshotId":"new"}' | Set-Content (Join-Path $ProjectRoot '.cloud-publish/success.json')
'@ | Set-Content (Join-Path $temp 'Publish-ComponentLife.ps1') -Encoding UTF8
function Run-Manual {
    # Capture native failures without the test harness treating stderr as a terminating error.
    $ErrorActionPreference='Continue'
    $output=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $project 'Publish-Inspection-Web.ps1') -ProjectRoot $temp 2>&1
    return $LASTEXITCODE
}
Assert ((Run-Manual) -eq 0) 'Manual publish reads inspection then publishes successfully'
$state=Get-Content (Join-Path $temp '.cloud-publish/manual-inspection-status.json') -Raw | ConvertFrom-Json
Assert ($state.status -eq 'success' -and $state.stage -eq 'complete') 'Success shown only after publisher exits successfully'
Assert ((Run-Manual) -eq 0) 'Unchanged snapshot succeeds without another deployment'
Assert (@(Get-Content (Join-Path $temp 'publishes.log')).Count -eq 1) 'Unchanged files do not consume another deploy'
'{"snapshotId":"old"}' | Set-Content (Join-Path $temp '.cloud-publish/success.json')
New-Item -ItemType File -Path (Join-Path $temp 'publish-fail') | Out-Null
Assert ((Run-Manual) -eq 1) 'Failed publisher is reported as a failure'
Assert ((Get-Content (Join-Path $temp '.cloud-publish/success.json') -Raw | ConvertFrom-Json).snapshotId -eq 'old') 'Failure preserves the previous verified success'
Remove-Item -LiteralPath (Join-Path $temp 'publish-fail')
$hold=[IO.File]::Open((Join-Path $temp '.cloud-publish/manual-inspection.lock'),'OpenOrCreate','ReadWrite','None')
try { Assert ((Run-Manual) -eq 2) 'A second manual request is blocked while the first is running' } finally {$hold.Dispose()}
$hold=[IO.File]::Open((Join-Path $temp '.cloud-publish/publish.lock'),'OpenOrCreate','ReadWrite','None')
$readCount=@(Get-Content (Join-Path $temp 'reads.log')).Count
try { Assert ((Run-Manual) -eq 1) 'An active cloud deployment blocks data export' } finally {$hold.Dispose()}
Assert (@(Get-Content (Join-Path $temp 'reads.log')).Count -eq $readCount) 'Busy publisher does not change its input data'
New-Item -ItemType File -Path (Join-Path $temp 'read-fail') | Out-Null
Assert ((Run-Manual) -eq 1) 'Inspection read error blocks deployment'
Remove-Item -LiteralPath (Join-Path $temp 'read-fail')
Set-Content (Join-Path $temp 'source-changes') '2'
Assert ((Run-Manual) -eq 0) 'Two concurrent edits are retried automatically before success'
Assert (@(Get-Content (Join-Path $temp 'retry.log')).Count -eq 2) 'Only source-change errors are retried'
$publishCount=@(Get-Content (Join-Path $temp 'publishes.log')).Count
Set-Content (Join-Path $temp 'source-changes') '5'
Assert ((Run-Manual) -eq 1) 'Continuous edits stop after three attempts'
Assert (@(Get-Content (Join-Path $temp 'publishes.log')).Count -eq $publishCount) 'Unstable source never reaches deployment'
$state=Get-Content (Join-Path $temp '.cloud-publish/manual-inspection-status.json') -Raw | ConvertFrom-Json
Assert ($state.message -match '3') 'App explains persistent source edits instead of a Cloudflare error'

} finally { Remove-Item -LiteralPath $temp -Recurse -Force }

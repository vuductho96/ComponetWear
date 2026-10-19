$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('component-scheduler-' + [Guid]::NewGuid().ToString('N'))
$Root = Join-Path $fixtureRoot 'ComponentLife'
$DataDir = Join-Path $Root 'data'
function Assert($condition, [string]$message) { if (-not $condition) { throw "FAIL: $message" }; Write-Host "PASS: $message" }
function Log-Msg { param($msg, $color); Write-Host $msg }
try {
    foreach ($dir in @($Root, $DataDir, (Join-Path $Root 'js'), (Join-Path $Root 'css'))) { $null = New-Item -ItemType Directory -Path $dir -Force }
    foreach ($name in @('ComponentMaster.json', 'data/shoot-data.json', 'data/replacement-log.json')) { [IO.File]::WriteAllText((Join-Path $Root $name), '[]') }
    [IO.File]::WriteAllText((Join-Path $DataDir 'stock-data.json'), '{}')
    [IO.File]::WriteAllText((Join-Path $Root 'index.html'), '<h1>test</h1>')
    . (Join-Path $project 'ComponentLife/cloud_publish.ps1')
    $script:starts = 0
    function Start-Process {
        param($FilePath, $ArgumentList, $WindowStyle, [switch]$PassThru)
        $script:starts++
        return ([pscustomobject]@{ HasExited = $false; ExitCode = 0 } | Add-Member -MemberType ScriptMethod -Name Dispose -Value {} -PassThru)
    }
    Initialize-CloudPublisher
    $global:excelSyncHealthy = $true; $global:isSyncing = $false
    Update-CloudPublisher
    Assert ($script:starts -eq 0) 'Startup change is debounced'
    $script:publishChangedAt = [DateTime]::UtcNow.AddSeconds(-5)
    Update-CloudPublisher
    Assert ($script:starts -eq 1) 'Startup publishes without another Excel edit'
    [IO.File]::WriteAllText((Join-Path $Root 'index.html'), '<h1>new edit while publishing</h1>')
    Update-CloudPublisher
    Assert ($script:starts -eq 1) 'Changes cannot launch an overlapping process'
    $script:publishProcess.HasExited = $true
    Update-CloudPublisher
    $script:publishChangedAt = [DateTime]::UtcNow.AddSeconds(-5)
    Update-CloudPublisher
    Assert ($script:starts -eq 1) 'No second publish after startup succeeds, even if source changes'
    Initialize-CloudPublisher
    Update-CloudPublisher
    $script:publishChangedAt = [DateTime]::UtcNow.AddSeconds(-5)
    Update-CloudPublisher
    Assert ($script:starts -eq 2) 'Reopening starts a new update session'
    $script:publishProcess.HasExited = $true; $script:publishProcess.ExitCode = 1
    Update-CloudPublisher
    Assert ($script:starts -eq 2 -and $script:publishNextAttempt -gt [DateTime]::UtcNow) 'Failure backs off instead of reporting success'
    $script:publishNextAttempt = [DateTime]::MinValue
    Update-CloudPublisher
    Assert ($script:starts -eq 3) 'Failed deployment is retried'
    $script:publishProcess.HasExited = $true
    Write-PublishJson (Join-Path $script:publishDir 'success.json') ([pscustomobject]@{ snapshotId = (Get-PublicAssetManifest $Root).snapshotId })
    Update-CloudPublisher
    Assert ($script:starts -eq 3) 'Unchanged successful version is not republished'
    Initialize-CloudPublisher
    Update-CloudPublisher
    $script:publishChangedAt = [DateTime]::UtcNow.AddSeconds(-5)
    Update-CloudPublisher
    Assert ($script:starts -eq 3) 'Successful version survives a server restart'
    [IO.File]::WriteAllText((Join-Path $Root 'index.html'), '<h1>unhealthy Excel</h1>')
    $global:excelSyncHealthy = $false
    Update-CloudPublisher
    Assert ($script:starts -eq 3) 'Failed Excel sync blocks publication'

    # Corrupt workbook must leave all existing JSON unchanged.
    Copy-Item -LiteralPath (Join-Path $project 'ComponentLife/auto_sync_excel.ps1') -Destination $Root
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'broken.xlsx'), 'not an Excel ZIP')
    $before = Get-PublishFileHash (Join-Path $DataDir 'shoot-data.json')
    $failed = $false
    try { . (Join-Path $Root 'auto_sync_excel.ps1') } catch { $failed = $true }
    Assert $failed 'Unreadable workbook causes sync failure'
    Assert ((Get-PublishFileHash (Join-Path $DataDir 'shoot-data.json')) -eq $before) 'Unreadable workbook preserves previous JSON'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixtureRoot)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf).StartsWith('component-scheduler-')) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

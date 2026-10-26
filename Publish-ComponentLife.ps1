param(
    [switch]$BuildOnly,
    [string]$ProjectRoot = $PSScriptRoot,
    [string]$CloudUrl = 'https://componetlife.vuductho-th.workers.dev',
    [string]$ManualStatusFile = '',
    [string]$PreparedSnapshotId = ''
)
$ErrorActionPreference = 'Stop'
$source = Join-Path $ProjectRoot 'ComponentLife'
. (Join-Path $source 'cloud_publish.ps1')
$work = Join-Path $ProjectRoot '.cloud-publish'
$null = New-Item -ItemType Directory -Path $work -Force
$lock = $null
function Set-PublishPhase([string]$Message,[string]$Stage='publishing') {
    if ($ManualStatusFile -and (Test-Path -LiteralPath $ManualStatusFile)) {
        $state = Get-Content -LiteralPath $ManualStatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $now=[DateTime]::UtcNow
        if($state.phaseStartedAt -and $state.stage -ne $Stage){
            $seconds=($now-[DateTime]::Parse($state.phaseStartedAt).ToUniversalTime()).TotalSeconds
            $timings=@($state.timings | Where-Object {$_})+@([pscustomobject]@{stage=$state.stage;seconds=[Math]::Round($seconds,2)})
            $state | Add-Member -NotePropertyName timings -NotePropertyValue $timings -Force
            Add-Content -LiteralPath (Join-Path $work 'publish.log') -Value ('Duration {0}: {1:N2}s' -f $state.stage,$seconds)
        }
        if(-not $state.phaseStartedAt -or $state.stage -ne $Stage){$state | Add-Member -NotePropertyName phaseStartedAt -NotePropertyValue $now.ToString('o') -Force}
        $state.message = $Message
        $state.stage = $Stage
        $state.updatedAt = [DateTime]::UtcNow.ToString('o')
        Write-PublishJson $ManualStatusFile $state
    }
}
try {
    if (-not $BuildOnly) {
        $publishConfig=Get-Content -LiteralPath (Join-Path $ProjectRoot 'wrangler.jsonc') -Raw | ConvertFrom-Json
        if ($publishConfig.main -eq 'cloud/worker.mjs' -and (-not (Test-Path -LiteralPath (Join-Path $work 'accounts-ready.json')) -or -not (Test-Path -LiteralPath (Join-Path $work 'auth-verifier.json')))) {
            throw 'Accounts are not configured yet. Run Initialize-ComponentLifeAccounts.ps1 once to set the admin password and Cloudflare D1 before publishing.'
        }
    }
    # File lock also prevents overlapping publishers started from another server or terminal.
    $lock = [IO.File]::Open((Join-Path $work 'publish.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    $log = Join-Path $work 'publish.log'
    Add-Content -LiteralPath $log -Value "`n[$([DateTime]::UtcNow.ToString('o'))] Building snapshot"
    $downloadBuilder = Join-Path $source 'prepare_inspection_downloads.ps1'
    if (-not $PreparedSnapshotId -and (Test-Path -LiteralPath $downloadBuilder)) { & $downloadBuilder -ProjectRoot $ProjectRoot }
    $before = Get-PublicAssetManifest $source
    if ($PreparedSnapshotId -and $before.snapshotId -ne $PreparedSnapshotId) { throw 'Prepared publish inputs changed. Refresh the data before publishing again.' }
    if ($PreparedSnapshotId) { Add-Content -LiteralPath $log -Value 'Reusing the prepared downloads and verified local snapshot; duplicate preparation skipped.' }
    $baseline = Join-Path $work 'verification-baseline.json'
    if (-not $BuildOnly) {
        # Recover a prior timed-out deployment only when Cloudflare serves the
        # exact staged snapshot currently present on this machine.
        & node (Join-Path $PSScriptRoot 'verify-cloud.cjs') --capture-baseline $baseline $CloudUrl (Join-Path $source 'data/version.json')
        if ($LASTEXITCODE -ne 0) { throw 'Could not prepare cloud verification.' }
    }
    Set-PublishPhase 'Đang chuẩn bị các tệp cần publish…' 'staging'
    $assets = Join-Path $work 'assets'
    # Fixed allowlist, with a fresh staging folder each run. No source-folder upload.
    if (Test-Path -LiteralPath $assets) {
        $archive = Join-Path $work ('previous-' + [Guid]::NewGuid().ToString('N'))
        try { [IO.Directory]::Move($assets, $archive) }
        catch {
            # A viewer or scanner can hold the directory without delete-sharing.
            # Build a separate snapshot rather than touching the locked tree.
            $assets = Join-Path $work ('stage-' + [Guid]::NewGuid().ToString('N'))
        }
        $resolvedArchive = [IO.Path]::GetFullPath($archive)
        $resolvedWork = [IO.Path]::GetFullPath($work).TrimEnd('\') + '\'
        if (-not $resolvedArchive.StartsWith($resolvedWork, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe staging cleanup path.' }
        # Retire the previous stage immediately. Large NTFS trees can take minutes
        # to delete; clean them in the background only after cloud verification.
    }
    $null = New-Item -ItemType Directory -Path $assets -Force
    $stageWatch=[Diagnostics.Stopwatch]::StartNew()
    $stageInfo=New-Object Diagnostics.ProcessStartInfo
    $stageInfo.FileName='node';$stageInfo.Arguments='"'+(Join-Path $PSScriptRoot 'stage-assets.cjs')+'"'
    $stageInfo.UseShellExecute=$false;$stageInfo.CreateNoWindow=$true
    $stageInfo.RedirectStandardInput=$true;$stageInfo.RedirectStandardOutput=$true;$stageInfo.RedirectStandardError=$true
    $stageProcess=[Diagnostics.Process]::Start($stageInfo)
    try {
        $stageOutput=$stageProcess.StandardOutput.ReadToEndAsync();$stageError=$stageProcess.StandardError.ReadToEndAsync()
        $stageFiles=@($before.files | ForEach-Object { $_.Substring(0,$_.LastIndexOf('=')) })
        $stagePayload=[Text.Encoding]::UTF8.GetBytes((@{sourceRoot=$source;targetRoot=$assets;files=$stageFiles}|ConvertTo-Json -Compress -Depth 3))
        $stageProcess.StandardInput.BaseStream.Write($stagePayload,0,$stagePayload.Length);$stageProcess.StandardInput.Close()
        $stageProcess.WaitForExit()
        if($stageProcess.ExitCode -ne 0){throw "Snapshot preparation failed: $($stageError.Result)"}
        Add-Content -LiteralPath $log -Value ("Stage copy: {0:N2}s; {1}" -f $stageWatch.Elapsed.TotalSeconds,$stageOutput.Result)
    } finally {$stageProcess.Dispose()}
    $manifest = Get-PublicAssetManifest $assets
    $after = Get-PublicAssetManifest $source
    if ($before.snapshotId -ne $manifest.snapshotId -or $after.snapshotId -ne $manifest.snapshotId) {
        $expectedFiles=@{};$copiedFiles=@{};$currentFiles=@{}
        foreach($entry in $before.files){$separator=$entry.LastIndexOf('=');$expectedFiles[$entry.Substring(0,$separator)]=$entry.Substring($separator+1)}
        foreach($entry in $manifest.files){$separator=$entry.LastIndexOf('=');$copiedFiles[$entry.Substring(0,$separator)]=$entry.Substring($separator+1)}
        foreach($entry in $after.files){$separator=$entry.LastIndexOf('=');$currentFiles[$entry.Substring(0,$separator)]=$entry.Substring($separator+1)}
        $changed=@(@($expectedFiles.Keys)+@($copiedFiles.Keys)+@($currentFiles.Keys) | Sort-Object -Unique | Where-Object { $expectedFiles[$_] -ne $copiedFiles[$_] -or $expectedFiles[$_] -ne $currentFiles[$_] })
        Add-Content -LiteralPath $log -Value ('Files changed during staging: '+(($changed | Select-Object -First 20) -join ', '))
        throw 'Source changed during snapshot copy; retry required.'
    }
    Write-PublishJson (Join-Path $assets 'data/version.json') $manifest
    Write-PublishJson (Join-Path $source 'data/version.json') $manifest
    [IO.File]::WriteAllText((Join-Path $assets '_headers'), "/*`n  Cache-Control: no-cache, max-age=0, must-revalidate`n", (New-Object Text.UTF8Encoding($false)))
    if ($BuildOnly) { Write-Output "Snapshot built: $($manifest.snapshotId)"; exit 0 }
    Write-PublishJson (Join-Path $work 'status.json') ([pscustomobject]@{ status = 'publishing'; snapshotId = $manifest.snapshotId; updatedAt = [DateTime]::UtcNow.ToString('o') })

    Set-PublishPhase 'Đang deploy lên Cloudflare (chỉ upload nội dung thay đổi)…'
    $code=1
    for($deployAttempt=1;$deployAttempt -le 3;$deployAttempt++){
        if($deployAttempt -gt 1){
            Set-PublishPhase ("Kết nối Cloudflare bị gián đoạn. Đang tự thử lại ({0}/3)…" -f $deployAttempt)
            Add-Content -LiteralPath $log -Value ("Retrying Wrangler deploy ({0}/3) after a transient network/TLS failure." -f $deployAttempt)
        }
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = 'cmd.exe'
        $info.WorkingDirectory = $ProjectRoot
        $info.Arguments = '/d /s /c "npx --yes wrangler@4.86.0 deploy --config wrangler.jsonc"'
        if ($assets -ne (Join-Path $work 'assets')) {
            $info.Arguments = '/d /s /c "npx --yes wrangler@4.86.0 deploy --config wrangler.jsonc --assets ""' + $assets + '"""'
        }
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.StandardOutputEncoding = [Text.Encoding]::UTF8
        $info.StandardErrorEncoding = [Text.Encoding]::UTF8
        $deployLines=New-Object System.Collections.Generic.List[string]
        $proc = [Diagnostics.Process]::Start($info)
        try {
        # Drain both pipes concurrently and expose actual output while Wrangler runs.
        # ReadToEndAsync hid every progress message until the entire deploy finished.
        $streams=@($proc.StandardOutput,$proc.StandardError)
        $pending=@($streams[0].ReadLineAsync(),$streams[1].ReadLineAsync())
        $deployWatch=[Diagnostics.Stopwatch]::StartNew()
        while($pending[0] -or $pending[1] -or -not $proc.HasExited){
            for($i=0;$i -lt 2;$i++){
                if($pending[$i] -and $pending[$i].IsCompleted){
                    $line=$pending[$i].GetAwaiter().GetResult()
                    if($null -eq $line){$pending[$i]=$null}
                    else{
                        Add-Content -LiteralPath $log -Value $line -Encoding UTF8
                        $deployLines.Add($line)
                        $pending[$i]=$streams[$i].ReadLineAsync()
                    }
                }
            }
            if($deployWatch.Elapsed.TotalMilliseconds -ge 1200000){
                & taskkill.exe /PID $proc.Id /T /F | Out-Null
                throw 'Deploy timed out after 20 minutes.'
            }
            # Completed reads can be drained immediately, including after process exit.
            if(-not (($pending[0] -and $pending[0].IsCompleted) -or ($pending[1] -and $pending[1].IsCompleted))){Start-Sleep -Milliseconds 100}
        }
        $proc.WaitForExit()
        $code=$proc.ExitCode
        } finally {$proc.Dispose()}
        if($code -eq 0){break}
        $transient=(($deployLines -join "`n") -match '(?i)fetch failed|connectivity issue|self-signed certificate|ETIMEDOUT|ECONNRESET|ENOTFOUND|ECONNREFUSED')
        if(-not $transient -or $deployAttempt -ge 3){break}
        Start-Sleep -Seconds (5*$deployAttempt)
    }
    if ($code -ne 0) { throw "Wrangler exited with code $code. See publish.log." }
    if (Test-Path -LiteralPath $baseline) {
        Set-PublishPhase 'Web đã deploy. Đang xác minh các tệp thay đổi…' 'verifying'
    } else {
        Set-PublishPhase 'Web đã deploy. Đang xác minh đầy đủ vì chưa có bản đối chiếu…' 'verifying'
    }

    # Verify every changed byte. Unchanged bytes are reused only from a
    # self-consistent manifest currently served by the same Cloudflare worker.
    $verified = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $verification = & node (Join-Path $PSScriptRoot 'verify-cloud.cjs') (Join-Path $assets 'data/version.json') $CloudUrl $baseline 2>&1
            Add-Content -LiteralPath $log -Value ($verification -join "`n")
            if ($LASTEXITCODE -ne 0) { throw "Cloud hash verification failed: $verification" }
            $verified = $true; break
        } catch {
            Add-Content -LiteralPath $log -Value "Verification $attempt failed: $_"
            if ($attempt -lt 3) { Start-Sleep -Seconds 5 }
        }
    }
    if (-not $verified) { throw 'Cloud verification failed; success state was NOT updated.' }
    Write-PublishJson (Join-Path $work 'success.json') ([pscustomobject]@{ snapshotId = $manifest.snapshotId; verifiedAt = [DateTime]::UtcNow.ToString('o'); url = $CloudUrl })
    Write-PublishJson (Join-Path $work 'status.json') ([pscustomobject]@{ status = 'success'; snapshotId = $manifest.snapshotId; updatedAt = [DateTime]::UtcNow.ToString('o') })
    Add-Content -LiteralPath $log -Value "VERIFIED: $($manifest.snapshotId)"
    Write-Output "Cloud verified: $($manifest.snapshotId)"
    $cleanup = Join-Path $ProjectRoot 'Cleanup-ComponentLifeStage.ps1'
    if (Test-Path -LiteralPath $cleanup) {
        try {
            $cleanupInfo = New-Object Diagnostics.ProcessStartInfo
            $cleanupInfo.FileName = 'powershell.exe'
            $cleanupInfo.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $cleanup + '" -ProjectRoot "' + $ProjectRoot + '"'
            $cleanupInfo.WorkingDirectory = $ProjectRoot
            $cleanupInfo.UseShellExecute = $false
            $cleanupInfo.CreateNoWindow = $true
            $cleanupProcess = [Diagnostics.Process]::Start($cleanupInfo)
            $cleanupProcess.Dispose()
        } catch { Add-Content -LiteralPath $log -Value 'Stage cleanup deferred until the next successful publish.' }
    }
} catch {
    if ($lock) {
        Add-Content -LiteralPath (Join-Path $work 'publish.log') -Value "FAILED: $_"
        Write-PublishJson (Join-Path $work 'status.json') ([pscustomobject]@{ status = 'failed'; error = [string]$_; updatedAt = [DateTime]::UtcNow.ToString('o') })
    }
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    if ($lock) { $lock.Dispose() }
}

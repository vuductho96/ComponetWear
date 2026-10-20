param(
    [switch]$BuildOnly,
    [string]$ProjectRoot = $PSScriptRoot,
    [string]$CloudUrl = 'https://componetlife.vuductho-th.workers.dev',
    [string]$ManualStatusFile = ''
)
$ErrorActionPreference = 'Stop'
$source = Join-Path $ProjectRoot 'ComponentLife'
. (Join-Path $source 'cloud_publish.ps1')
$work = Join-Path $ProjectRoot '.cloud-publish'
$null = New-Item -ItemType Directory -Path $work -Force
$lock = $null
function Set-PublishPhase([string]$Message) {
    if ($ManualStatusFile -and (Test-Path -LiteralPath $ManualStatusFile)) {
        $state = Get-Content -LiteralPath $ManualStatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $state.message = $Message
        $state.updatedAt = [DateTime]::UtcNow.ToString('o')
        Write-PublishJson $ManualStatusFile $state
    }
}
try {
    # File lock also prevents overlapping publishers started from another server or terminal.
    $lock = [IO.File]::Open((Join-Path $work 'publish.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    $log = Join-Path $work 'publish.log'
    Add-Content -LiteralPath $log -Value "`n[$([DateTime]::UtcNow.ToString('o'))] Building snapshot"
    $downloadBuilder = Join-Path $source 'prepare_inspection_downloads.ps1'
    if (Test-Path -LiteralPath $downloadBuilder) { & $downloadBuilder -ProjectRoot $ProjectRoot }
    $baseline = Join-Path $work 'verification-baseline.json'
    if (-not $BuildOnly) {
        & node (Join-Path $PSScriptRoot 'verify-cloud.cjs') --capture-baseline $baseline (Join-Path $work 'success.json') $CloudUrl
        if ($LASTEXITCODE -ne 0) { throw 'Could not prepare cloud verification.' }
    }
    $before = Get-PublicAssetManifest $source
    Set-PublishPhase 'Đang chuẩn bị các tệp cần publish…'
    $assets = Join-Path $work 'assets'
    # Fixed allowlist, with a fresh staging folder each run. No source-folder upload.
    if (Test-Path -LiteralPath $assets) {
        $archive = Join-Path $work ('previous-' + [Guid]::NewGuid().ToString('N'))
        Move-Item -LiteralPath $assets -Destination $archive
        $resolvedArchive = [IO.Path]::GetFullPath($archive)
        $resolvedWork = [IO.Path]::GetFullPath($work).TrimEnd('\') + '\'
        if (-not $resolvedArchive.StartsWith($resolvedWork, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe staging cleanup path.' }
        Remove-Item -LiteralPath $resolvedArchive -Recurse -Force
    }
    $null = New-Item -ItemType Directory -Path $assets -Force
    foreach ($relative in (Get-PublicAssetFiles $source)) {
        $target = Join-Path $assets $relative
        $null = New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force
        $sourceFile = Join-Path $source $relative
        if ($relative -match '^data/inspection/drawings/[a-f0-9]{64}-v[0-9]+-p[0-9]{4}\.webp$|^data/inspection/downloads/[a-f0-9]{64}\.(pdf|xlsx|xlsm)$') {
            # Generated previews and download copies have immutable content-hash names.
            try { $null = New-Item -ItemType HardLink -Path $target -Target $sourceFile -ErrorAction Stop }
            catch { Copy-Item -LiteralPath $sourceFile -Destination $target }
        } else { Copy-Item -LiteralPath $sourceFile -Destination $target }
    }
    $manifest = Get-PublicAssetManifest $assets
    $after = Get-PublicAssetManifest $source
    if ($before.snapshotId -ne $manifest.snapshotId -or $after.snapshotId -ne $manifest.snapshotId) { throw 'Source changed during snapshot copy; retry required.' }
    Write-PublishJson (Join-Path $assets 'data/version.json') $manifest
    Write-PublishJson (Join-Path $source 'data/version.json') $manifest
    [IO.File]::WriteAllText((Join-Path $assets '_headers'), "/*`n  Cache-Control: no-cache, max-age=0, must-revalidate`n", (New-Object Text.UTF8Encoding($false)))
    if ($BuildOnly) { Write-Output "Snapshot built: $($manifest.snapshotId)"; exit 0 }
    Write-PublishJson (Join-Path $work 'status.json') ([pscustomobject]@{ status = 'publishing'; snapshotId = $manifest.snapshotId; updatedAt = [DateTime]::UtcNow.ToString('o') })

    Set-PublishPhase 'Đang deploy lên Cloudflare (chỉ upload nội dung thay đổi)…'
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = 'cmd.exe'
    $info.WorkingDirectory = $ProjectRoot
    $info.Arguments = '/d /s /c "npx --yes wrangler@4.86.0 deploy --config wrangler.jsonc"'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $proc = [Diagnostics.Process]::Start($info)
    $stdout = $proc.StandardOutput.ReadToEndAsync()
    $stderr = $proc.StandardError.ReadToEndAsync()
    if (-not $proc.WaitForExit(1200000)) { & taskkill.exe /PID $proc.Id /T /F | Out-Null; throw 'Deploy timed out after 20 minutes.' }
    Add-Content -LiteralPath $log -Value ($stdout.Result + $stderr.Result)
    $code = $proc.ExitCode; $proc.Dispose()
    if ($code -ne 0) { throw "Wrangler exited with code $code. See publish.log." }
    if (Test-Path -LiteralPath $baseline) {
        Set-PublishPhase 'Web đã deploy. Đang xác minh các tệp thay đổi…'
    } else {
        Set-PublishPhase 'Web đã deploy. Đang xác minh đầy đủ vì chưa có bản đối chiếu…'
    }

    # Verify the entire manifest and all changed bytes. Unchanged bytes are reused
    # only when the cloud baseline matched the last successfully verified release.
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

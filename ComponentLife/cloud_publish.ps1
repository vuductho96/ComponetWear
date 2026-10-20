# Shared snapshot helpers. Only explicitly public files enter a deployment.
function Get-PublicAssetFiles([string]$SourceRoot) {
    $files = @('index.html', 'ComponentMaster.json', 'data/shoot-data.json', 'data/replacement-log.json', 'data/stock-data.json')
    $inspectionDir = Join-Path $SourceRoot 'data/inspection'
    if (Test-Path -LiteralPath $inspectionDir) {
        $summary = Get-Content -LiteralPath (Join-Path $inspectionDir 'summary.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($summary.drawingMode -ne 'images-only') { throw 'Inspection must use image-only drawings before publication.' }
        $files += 'data/inspection/summary.json'
        foreach ($record in $summary.records) {
            if ($record.detailFile -notmatch '^detail-[a-f0-9]{2}(?:-[a-f0-9]{12})?\.json$') { throw 'Invalid inspection detail file.' }
            $files += "data/inspection/$($record.detailFile)"
            foreach ($drawing in $record.drawings) {
                if ($drawing.url) { throw 'Original drawing URLs must not be published.' }
                if ($drawing.pointMap) {
                    if ($drawing.pointMap -notmatch '^data/inspection/drawings/points-[a-f0-9]{64}-[a-f0-9]{12}\.json$') { throw 'Invalid drawing point map.' }
                    $files += [string]$drawing.pointMap
                }
                foreach ($page in $drawing.pages) {
                    if ($page -notmatch '^data/inspection/drawings/[a-f0-9]{64}-v[0-9]+-p[0-9]{4}\.webp$') { throw 'Only image previews may be published.' }
                    $files += [string]$page
                }
            }
        }
    }
    $downloadsPath = Join-Path $inspectionDir 'downloads.json'
    if (Test-Path -LiteralPath $downloadsPath) {
        $downloads = Get-Content -LiteralPath $downloadsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($downloads.schemaVersion -ne 1 -or $downloads.PSObject.Properties.Name -contains 'pdfPassword') { throw 'Invalid inspection download index.' }
        $files += 'data/inspection/downloads.json'
        if ($downloads.reportTemplate) {
            if ($downloads.reportTemplate.schemaVersion -ne 1 -or $downloads.reportTemplate.url -notmatch '^data/inspection/downloads/[a-f0-9]{64}\.xlsx$') { throw 'Invalid inspection report template.' }
            $files += [string]$downloads.reportTemplate.url
        }
        foreach ($kind in @('excel','pdf')) {
            foreach ($entry in $downloads.$kind.PSObject.Properties) {
                $url = [string]$entry.Value.url
                $extension = if ($kind -eq 'excel') { 'xlsx|xlsm' } else { 'pdf' }
                if ($url -notmatch "^data/inspection/downloads/[a-f0-9]{64}\.($extension)$") { throw 'Invalid original download path.' }
                $files += $url
            }
        }
    }
    foreach ($dir in @('js', 'css')) {
        $files += @(Get-ChildItem -LiteralPath (Join-Path $SourceRoot $dir) -File -Recurse |
            Where-Object { $_.Extension -in @('.js', '.mjs', '.css', '.woff', '.woff2', '.png', '.svg', '.ico', '.bcmap', '.pfb', '.ttf') -or $_.Name -eq 'LICENSE' } |
            ForEach-Object { $_.FullName.Substring($SourceRoot.Length + 1).Replace('\', '/') })
    }
    $ocrRoot = Join-Path $SourceRoot 'dimension-ocr'
    if (Test-Path -LiteralPath $ocrRoot) {
        $assetList = Get-Content -LiteralPath (Join-Path $ocrRoot 'assets.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($assetList.schemaVersion -ne 1 -or -not $assetList.files.Count) { throw 'Missing Dimension OCR public asset list.' }
        $files += 'dimension-ocr/assets.json'
        foreach ($asset in $assetList.files) {
            if ($asset -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._/-]*$' -or $asset -match '(^|/)\.\.?(/|$)|//' -or [IO.Path]::GetExtension($asset) -notin @('.html','.js','.mjs','.css','.json','.wasm','.bin','.txt','.woff2','.svg','.zip','.rbz')) { throw 'Invalid Dimension OCR public asset.' }
            $files += "dimension-ocr/$asset"
        }
    }
    return @($files | Sort-Object -Unique)
}

function Get-TextHash([string]$Value) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Get-PublishFileHash([string]$Path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
}

function Get-PublicAssetManifest([string]$SourceRoot) {
    $files = @(Get-PublicAssetFiles $SourceRoot)
    return Get-CachedFileManifest $SourceRoot $files
}

function Get-CachedFileManifest([string]$SourceRoot, [string[]]$Files) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = 'node'
    $helper = Join-Path $PSScriptRoot 'publish-manifest.cjs'
    $info.Arguments = '"' + $helper + '"'
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
    $info.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
    $proc = [Diagnostics.Process]::Start($info)
    try {
        $output = $proc.StandardOutput.ReadToEndAsync(); $errors = $proc.StandardError.ReadToEndAsync()
        $cacheDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) '.cloud-publish/file-hashes'
        $payload = [Text.Encoding]::UTF8.GetBytes((@{ root = $SourceRoot; files = @($Files); cacheDirectory = $cacheDirectory } | ConvertTo-Json -Compress -Depth 3))
        $proc.StandardInput.BaseStream.Write($payload, 0, $payload.Length)
        $proc.StandardInput.Close()
        $proc.WaitForExit()
        if ($proc.ExitCode -ne 0) { throw "Public asset validation failed: $($errors.Result)" }
        $result = $output.Result | ConvertFrom-Json
        Write-Verbose ("Manifest: {0} cached, {1} hashed, {2} bytes read" -f $result.stats.cached, $result.stats.hashed, $result.stats.bytesRead)
        return $result.manifest
    } finally { $proc.Dispose() }
}

function Write-PublishJson([string]$Path, $Value) {
    $temp = "$Path.tmp"
    [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Initialize-CloudPublisher {
    $script:startupPublishComplete = $false
    $script:publishProcess = $null
    $script:publishFingerprint = ''
    $script:publishAttempt = 0
    $script:publishNextAttempt = [DateTime]::MinValue
    $script:publishChangedAt = [DateTime]::UtcNow
    $script:publishDir = Join-Path (Split-Path $Root -Parent) '.cloud-publish'
    $null = New-Item -ItemType Directory -Path $script:publishDir -Force
    $script:inspectionProcess = $null
    $script:inspectionRetryAt = [DateTime]::MinValue
    $script:inspectionReady = -not (Test-Path -LiteralPath (Join-Path (Split-Path $Root -Parent) 'inspection.config.json'))
}

function Update-InspectionStartup {
    if ($script:inspectionReady) { return $true }
    if ($script:inspectionProcess) {
        if (-not $script:inspectionProcess.HasExited) { return $false }
        $code = $script:inspectionProcess.ExitCode
        $script:inspectionProcess.Dispose(); $script:inspectionProcess = $null
        if ($code -eq 0) { $script:inspectionReady = $true; Log-Msg '[Inspection] Du lieu do va ban ve da san sang.' Green; return $true }
        $script:inspectionRetryAt = [DateTime]::UtcNow.AddSeconds(60)
        Log-Msg '[Inspection] Doc du lieu that bai; chua publish. Xem .cloud-publish/inspection-error.log' Red
    }
    if ([DateTime]::UtcNow -lt $script:inspectionRetryAt) { return $false }
    $exporter = Join-Path $Root 'export_inspection.ps1'
    $argsText = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $exporter
    $script:inspectionProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $argsText -WindowStyle Hidden -RedirectStandardOutput (Join-Path $script:publishDir 'inspection.log') -RedirectStandardError (Join-Path $script:publishDir 'inspection-error.log') -PassThru
    # Keep the process handle open so Windows PowerShell retains the exit code after exit.
    $null = $script:inspectionProcess.Handle
    Log-Msg '[Inspection] Dang doc ket qua do va ghep ban ve...' Cyan
    return $false
}

# Called from the server loop; deployment and remote verification run in a separate process.
function Update-CloudPublisher {
    if ($script:startupPublishComplete) { return }
    try {
        if ($script:publishProcess) {
            if (-not $script:publishProcess.HasExited) { return }
            $exitCode = $script:publishProcess.ExitCode
            $script:publishProcess.Dispose(); $script:publishProcess = $null
            if ($exitCode -eq 0) {
                $script:publishAttempt = 0
                Log-Msg '[Cloudflare] Deploy va kiem tra cloud THANH CONG.' Green
                $script:startupPublishComplete = $true
                return
            } else {
                $delay = [Math]::Min(300, 15 * [Math]::Pow(2, [Math]::Min($script:publishAttempt - 1, 5)))
                $script:publishNextAttempt = [DateTime]::UtcNow.AddSeconds($delay)
                Log-Msg "[Cloudflare] THAT BAI (exit $exitCode). Thu lai sau ${delay}s. Xem .cloud-publish/publish.log" Red
            }
        }
        if ($global:isSyncing -or -not $global:excelSyncHealthy) { return }
        if (-not (Update-InspectionStartup)) { return }
        $manifest = Get-PublicAssetManifest $Root
        if ($manifest.snapshotId -ne $script:publishFingerprint) {
            $script:publishFingerprint = $manifest.snapshotId
            $script:publishChangedAt = [DateTime]::UtcNow
            $script:publishAttempt = 0
            $script:publishNextAttempt = [DateTime]::MinValue
            Write-PublishJson (Join-Path $DataDir 'version.json') $manifest
        }
        $stateFile = Join-Path $script:publishDir 'success.json'
        if (Test-Path -LiteralPath $stateFile) {
            $state = $null
            try { $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json } catch { Log-Msg '[Cloudflare] Success state unreadable; will verify a fresh deployment.' Yellow }
            if ($state.snapshotId -eq $manifest.snapshotId) { $script:startupPublishComplete = $true; return }
        }
        if (([DateTime]::UtcNow - $script:publishChangedAt).TotalSeconds -lt 3 -or [DateTime]::UtcNow -lt $script:publishNextAttempt) { return }
        $script:publishAttempt++
        $publisher = Join-Path (Split-Path $Root -Parent) 'Publish-ComponentLife.ps1'
        $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $publisher
        $script:publishProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru
        $null = $script:publishProcess.Handle
        Log-Msg "[Cloudflare] Dang deploy (lan $script:publishAttempt). Log: .cloud-publish/publish.log" Cyan
    } catch {
        $script:publishNextAttempt = [DateTime]::UtcNow.AddSeconds(30)
        Log-Msg "[Cloudflare] Chua the publish: $_" Red
    }
}

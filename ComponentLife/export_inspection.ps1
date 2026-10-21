param([string]$ConfigPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'inspection.config.json'),[ValidateRange(1,4)][int]$ReaderWorkers=4)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'inspection_core.ps1')
. (Join-Path $PSScriptRoot 'cloud_publish.ps1')
. (Join-Path $PSScriptRoot 'inspection_read_pool.ps1')
$readJobs=@{};$readPool=$null
Import-Module ImportExcel -ErrorAction Stop
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$sourceRoot = [IO.Path]::GetFullPath($config.sourcePath).TrimEnd('\')
if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) { throw 'Inspection source folder not found.' }
$work = Join-Path (Split-Path $PSScriptRoot -Parent) '.cloud-publish'
$null = New-Item -ItemType Directory -Path $work -Force
$inspectionLock = [IO.File]::Open((Join-Path $work 'inspection.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try {
$cacheDir = Join-Path $work 'inspection-cache'
$null = New-Item -ItemType Directory -Path $cacheDir -Force
$pdfStore = Join-Path $work 'inspection-pdf-source'
$null = New-Item -ItemType Directory -Path $pdfStore -Force
function Get-InspectionSourceFingerprint {
    $parts = @((Get-PublishFileHash $PSCommandPath), (Get-PublishFileHash (Join-Path $PSScriptRoot 'inspection_core.ps1')), (Get-PublishFileHash $ConfigPath), $sourceRoot)
    $parts += @((Get-PublishFileHash (Join-Path $PSScriptRoot 'render_inspection_drawings.py')), (Get-PublishFileHash (Join-Path $PSScriptRoot 'prepare_inspection_drawings.ps1')))
    $parts += Get-PublishFileHash (Join-Path $PSScriptRoot 'inspection_points.py')
    $observed = @{}
    $parts += @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | Where-Object { $_.Extension -in @('.xlsx', '.xlsm', '.pdf') -and -not $_.Name.StartsWith('~$') } | Sort-Object FullName | ForEach-Object {
        $value = "$($_.LastWriteTimeUtc.Ticks)|$($_.Length)"
        $observed[$_.FullName] = $value
        "$($_.FullName)|$value"
    })
    if ($script:InspectionObservedFiles) {
        foreach ($path in $observed.Keys) {
            if ($script:InspectionObservedFiles[$path] -ne $observed[$path]) { Write-Host ("Source changed: {0}" -f $path.Substring($sourceRoot.Length + 1)) }
        }
        foreach ($path in $script:InspectionObservedFiles.Keys) {
            if (-not $observed.ContainsKey($path)) { Write-Host ("Source removed: {0}" -f $path.Substring($sourceRoot.Length + 1)) }
        }
    }
    $script:InspectionObservedFiles = $observed
    return Get-TextHash ($parts -join "`n")
}
$sourceFingerprint = Get-InspectionSourceFingerprint
$sourceStateFile = Join-Path $work 'inspection-source.json'
if (Test-Path -LiteralPath $sourceStateFile) {
    try {
        $sourceState = Get-Content -LiteralPath $sourceStateFile -Raw | ConvertFrom-Json
        $targetRoot = Join-Path $PSScriptRoot 'data/inspection'
        $missing = @($sourceState.outputFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $targetRoot $_) -PathType Leaf) })
        if ($sourceState.fingerprint -eq $sourceFingerprint -and $sourceState.outputFiles.Count -gt 0 -and $missing.Count -eq 0) { Write-Host 'Inspection unchanged; keeping existing results and drawings.'; return }
    } catch { Write-Host 'Inspection state unavailable; rebuilding.' }
}
$build = Join-Path $work ('inspection-build-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path (Join-Path $build 'drawings') -Force
$script:DimensionCache = @{}
$parserHash = Get-PublishFileHash (Join-Path $PSScriptRoot 'inspection_core.ps1')
$files = @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | Where-Object { Test-InspectionWorkbookFile $_ } | Sort-Object FullName)
$pdfByFolder = @{}
$allPdfs=@(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Filter '*.pdf')
foreach ($pdf in $allPdfs) {
    $key = $pdf.DirectoryName.ToLowerInvariant()
    if (-not $pdfByFolder.ContainsKey($key)) { $pdfByFolder[$key] = [Collections.Generic.List[object]]::new() }
    $pdfByFolder[$key].Add($pdf)
}
$drawingHashes = @{}; $copiedDrawings = @{}; $seenLot = @{}
$pdfWatch=[Diagnostics.Stopwatch]::StartNew()
if ($allPdfs.Count) {
    $pdfFiles=@($allPdfs | ForEach-Object { $_.FullName.Substring($sourceRoot.Length+1).Replace('\','/') } | Sort-Object)
    $pdfManifest=Get-CachedFileManifest $sourceRoot $pdfFiles
    foreach($entry in $pdfManifest.files){
        $separator=$entry.LastIndexOf('=')
        $drawingHashes[[IO.Path]::GetFullPath((Join-Path $sourceRoot $entry.Substring(0,$separator)))]=$entry.Substring($separator+1)
    }
}
Write-Host ("PDF hash cache ready: {0} files in {1:N2}s" -f $allPdfs.Count,$pdfWatch.Elapsed.TotalSeconds)
$readWatch=[Diagnostics.Stopwatch]::StartNew()
$records = [Collections.Generic.List[object]]::new()
$buckets = @{}; $skipped = 0; $hits = 0; $i = 0
# Prefetch only a bounded window, so warm-cache publishes do not load every workbook.
$readWindow=@{};$nextReadIndex=0
$fillReadWindow={
    while($nextReadIndex -lt $files.Count -and $readWindow.Count -lt $ReaderWorkers){
        $prefetchFile=$files[$nextReadIndex]
        $prefetchRelative=$prefetchFile.FullName.Substring($sourceRoot.Length+1).Replace('\','/')
        $prefetchId=(Get-TextHash $prefetchRelative.ToLowerInvariant()).Substring(0,24)
        $prefetchSignature="$parserHash|$($prefetchFile.LastWriteTimeUtc.Ticks)|$($prefetchFile.Length)"
        $prefetchPath=Join-Path $cacheDir "$prefetchId.json"
        $prefetchCached=$null
        if(Test-Path -LiteralPath $prefetchPath){try{$prefetchCached=Get-Content -LiteralPath $prefetchPath -Raw -Encoding UTF8 | ConvertFrom-Json}catch{}}
        $slot=[pscustomobject]@{Cached=$null;Job=$null}
        if($prefetchCached -and $prefetchCached.signature -eq $prefetchSignature){$slot.Cached=$prefetchCached}
        else{
            if(-not $readPool){$readPool=New-InspectionReadPool (Join-Path $PSScriptRoot 'inspection_core.ps1') $ReaderWorkers}
            $slot.Job=Start-InspectionRead $readPool $prefetchFile;$readJobs[$nextReadIndex]=$slot.Job
        }
        $readWindow[$nextReadIndex]=$slot;$nextReadIndex++
    }
}
Write-Host "Inspection readers: $ReaderWorkers workers; unchanged workbooks use cached results."
foreach ($file in $files) {
    . $fillReadWindow
    $slot=$readWindow[$i]
    $i++
    $relative = $file.FullName.Substring($sourceRoot.Length + 1).Replace('\', '/')
    $id = (Get-TextHash $relative.ToLowerInvariant()).Substring(0, 24)
    $signature = "$parserHash|$($file.LastWriteTimeUtc.Ticks)|$($file.Length)"
    $cacheFile = Join-Path $cacheDir "$id.json"
    $cached=$slot.Cached
    if ($cached) {
        $raw=$cached.record;$dims=@($cached.dimensions);$hits++
    } else {
        $readResult=Receive-InspectionRead $slot.Job
        $readJobs.Remove($i-1)
        $raw=$readResult.Record;$dims=@($readResult.Dimensions)
        Write-PublishJson $cacheFile ([pscustomobject]@{ signature = $signature; record = $raw; dimensions = @($dims) })
    }
    $readWindow.Remove($i-1)
    if (-not $raw.Part -or -not $raw.Mold) { $skipped++; continue }
    # Some measured templates leave tolerances blank. Show values without inventing OK/NG.
    if ($dims.Count -eq 0 -and $raw.Quality -eq 'OK') {
        $pkg = Open-ExcelPackage -Path $file.FullName
        try {
            $ws = Get-FirstUsedWorksheet $pkg
            $fallback = [Collections.Generic.List[object]]::new()
            for ($row = 14; $row -le [Math]::Min(250, $ws.Dimension.End.Row); $row++) {
                $point = Safe-Text $ws.Cells[$row, 1].Text
                $nominal = Convert-MeasureTextToNumber $ws.Cells[$row, 2].Text
                if ($point -notmatch '^\d+' -or $null -eq $nominal) { continue }
                for ($col = 6; $col -le 15; $col++) {
                    $value = Convert-MeasureTextToNumber $ws.Cells[$row, $col].Text
                    if ($null -ne $value) { $fallback.Add(@($point, $ws.Cells[$row, 2].Text, $ws.Cells[$row, 3].Text, $ws.Cells[$row, 4].Text, ($col - 5), $value, $null, $null, [Math]::Round(($value - $nominal), 6), 'NG')) }
                }
            }
            $dims = @($fallback.ToArray())
            Write-PublishJson $cacheFile ([pscustomobject]@{ signature = $signature; record = $raw; dimensions = @($dims) })
        } finally { $pkg.Dispose() }
    }
    $drawings = @(); $drawingNotice = ''
    # Prefer part-matching PDFs from this lot. Parent-folder candidates remain explicitly labelled.
    foreach ($folder in @($file.DirectoryName, (Split-Path $file.DirectoryName -Parent))) {
        $candidates = @($pdfByFolder[$folder.ToLowerInvariant()]) | Where-Object { $null -ne $_ }
        $partPattern = '(?i)(^|[^a-z0-9])' + [regex]::Escape([string]$raw.Part) + '([^a-z0-9]|$)'
        $matchesForPart = @($candidates | Where-Object { $_.BaseName -match $partPattern } | Sort-Object Name)
        $matchType = if ($folder -eq $file.DirectoryName) { 'same-folder' } else { 'parent-folder' }
        if ($matchesForPart.Count -eq 0 -and $folder -eq $file.DirectoryName -and $candidates.Count -eq 1) { $matchesForPart = $candidates; $matchType = 'folder-candidate' }
        foreach ($pdf in @($matchesForPart | Sort-Object Length, Name | Select-Object -First 1)) {
            if (-not $drawingHashes.ContainsKey($pdf.FullName)) { throw 'PDF changed during scan; retry required.' }
            $hash = $drawingHashes[$pdf.FullName]
            if (-not $copiedDrawings.ContainsKey($hash)) {
                $drawingTarget = Join-Path $pdfStore "$hash.pdf"
                if (-not (Test-Path -LiteralPath $drawingTarget)) { Copy-Item -LiteralPath $pdf.FullName -Destination $drawingTarget }
                $copiedDrawings[$hash] = $true
            }
            $drawings += [pscustomobject]@{ id = $hash; name = $pdf.Name; association = $matchType }
        }
        if ($drawings.Count -gt 0) { break }
    }
    $bucket = '{0:x2}' -f ([Convert]::ToInt32($id.Substring(0, 2), 16) % 32)
    if (-not $buckets.ContainsKey($bucket)) { $buckets[$bucket] = [ordered]@{} }
    $buckets[$bucket][$id] = @($dims)
    $lot = [string]$raw.LotKey
    $qty = if ($seenLot.ContainsKey($lot)) { 0 } else { $seenLot[$lot] = $true; [int]$raw.RawQty }
    $ng = @($dims | Where-Object { $_[9] -eq 'NG' }).Count
    $sourceLabel = Get-StockSourceLabel $file.FullName
    $sourceMapping = $config.sourceLabels.PSObject.Properties[$sourceLabel]
    if ($sourceMapping) { $sourceLabel = [string]$sourceMapping.Value }
    $records.Add([pscustomobject]@{
        id = $id; part = [string]$raw.Part; mold = [string]$raw.Mold; file = $file.Name
        lot = $(if($file.DirectoryName.Length -gt $sourceRoot.Length){$file.DirectoryName.Substring($sourceRoot.Length + 1).Replace('\', ' / ')}else{''})
        source = $sourceLabel
        month = [string]$raw.Month; receivedDate = [string]$raw.DateIn; measuredDate = [string]$raw.DateMeasure
        quantity = $qty; quality = $(if ($dims.Count -eq 0) { 'PENDING' } elseif ($ng -gt 0) { 'NG' } else { 'OK' })
        samples = $dims.Count; ngSamples = $ng; points = @($dims | ForEach-Object { $_[0] } | Sort-Object -Unique).Count
        detailFile = "detail-$bucket.json"; drawings = @($drawings); drawingNotice = $drawingNotice
    })
    if ($i % 50 -eq 0) { Write-Host "Inspection: $i/$($files.Count), cached=$hits, drawings=$($copiedDrawings.Count)" }
}
Stop-InspectionReadJobs $readJobs $readPool
$readPool=$null
Write-Host ("Inspection records prepared in {0:N2}s; cache hits={1}, parsed={2}, workers={3}" -f $readWatch.Elapsed.TotalSeconds,$hits,($files.Count-$hits),$ReaderWorkers)
if ((Get-InspectionSourceFingerprint) -ne $sourceFingerprint) {
    Write-Error 'Inspection files changed during scan. Waiting for edits to finish before retrying.' -ErrorAction Continue
    exit 75
}
foreach ($bucket in $buckets.Keys) {
    $detail = Join-Path $build "detail-$bucket.json"
    Write-PublishJson $detail $buckets[$bucket]
    $versionedName = "detail-$bucket-$((Get-PublishFileHash $detail).Substring(0, 12)).json"
    Move-Item -LiteralPath $detail -Destination (Join-Path $build $versionedName)
    foreach ($record in $records) { if ($record.detailFile -eq "detail-$bucket.json") { $record.detailFile = $versionedName } }
}
$summary = [pscustomobject]@{
    schemaVersion = 1; generatedAt = [DateTime]::UtcNow.ToString('o')
    dimensionFields = @('point', 'nominal', 'tolMinus', 'tolPlus', 'sample', 'value', 'lower', 'upper', 'deviation', 'result')
    records = @($records.ToArray()); skippedNonInspection = $skipped; drawingCount = $copiedDrawings.Count
}
$target = Join-Path $PSScriptRoot 'data/inspection'
Write-PublishJson (Join-Path $build 'summary.json') $summary
& (Join-Path $PSScriptRoot 'prepare_inspection_drawings.ps1') -SummaryPath (Join-Path $build 'summary.json') -PdfRoot $pdfStore -OutputDirectory (Join-Path $build 'drawings')
$summary = Get-Content -LiteralPath (Join-Path $build 'summary.json') -Raw -Encoding UTF8 | ConvertFrom-Json
# Reopening Start with unchanged files must not cause another deploy just for a new timestamp.
$previousSummary = Join-Path $target 'summary.json'
if (Test-Path -LiteralPath $previousSummary) {
    $previous = Get-Content -LiteralPath $previousSummary -Raw -Encoding UTF8 | ConvertFrom-Json
    $same = (($previous.records | ConvertTo-Json -Compress -Depth 8) -eq ($summary.records | ConvertTo-Json -Compress -Depth 8))
    foreach ($bucket in $buckets.Keys) {
        $name = @($records | Where-Object { $_.detailFile.StartsWith("detail-$bucket-") } | Select-Object -First 1)[0].detailFile
        if (-not (Test-Path -LiteralPath (Join-Path $target $name))) { $same = $false; break }
    }
    if ($same -and $previous.schemaVersion -eq $summary.schemaVersion) { $summary.generatedAt = $previous.generatedAt }
}
Write-PublishJson (Join-Path $build 'summary.json') $summary
if ((Get-InspectionSourceFingerprint) -ne $sourceFingerprint) {
    Write-Error 'Inspection files changed during scan. Waiting for edits to finish before retrying.' -ErrorAction Continue
    exit 75
}
$null = New-Item -ItemType Directory -Path $target -Force
$outputFiles = @(Get-ChildItem -LiteralPath $build -File -Recurse | ForEach-Object { $_.FullName.Substring($build.Length + 1) })
# Keep the directory in place: Windows viewers/indexers may hold a directory handle.
# Install immutable dependencies first; swap the summary last so readers see a complete version.
foreach ($relative in @($outputFiles | Where-Object { $_ -ne 'summary.json' }) + @('summary.json')) {
    $destination = Join-Path $target $relative
    $null = New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force
    if ($relative -ne 'summary.json' -and (Test-Path -LiteralPath $destination)) { continue }
    $temporary = "$destination.$([Guid]::NewGuid().ToString('N')).tmp"
    Copy-Item -LiteralPath (Join-Path $build $relative) -Destination $temporary
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        try { Move-Item -LiteralPath $temporary -Destination $destination -Force -ErrorAction Stop; break }
        catch { if ($attempt -eq 10) { throw }; Start-Sleep -Milliseconds 250 }
    }
}
Write-Host "Inspection ready: $($records.Count) records, $($copiedDrawings.Count) unique PDFs, $skipped skipped."
$previousFiles = if ($sourceState) { @($sourceState.outputFiles) } else { @() }
Write-PublishJson $sourceStateFile ([pscustomobject]@{ fingerprint = $sourceFingerprint; outputFiles = $outputFiles; previousOutputFiles = $previousFiles })
} finally { Stop-InspectionReadJobs $readJobs $readPool; $inspectionLock.Dispose() }

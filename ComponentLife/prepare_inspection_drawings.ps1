param(
    [Parameter(Mandatory=$true)][string]$SummaryPath,
    [Parameter(Mandatory=$true)][string]$PdfRoot,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cloud_publish.ps1')
$work = Join-Path (Split-Path $PSScriptRoot -Parent) '.cloud-publish'
$summary = Get-Content -LiteralPath $SummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
$hashes = @($summary.records | ForEach-Object { $_.drawings } | ForEach-Object {
    if ($_.id) { $_.id } elseif ($_.url -match '/([a-f0-9]{64})\.pdf$') { $matches[1] } else { throw 'Missing private drawing identity.' }
} | Sort-Object -Unique)
$hashFile = Join-Path $work 'inspection-preview-hashes.json'
$catalogPath = Join-Path $work 'inspection-preview-catalog.json'
Write-PublishJson $hashFile @($hashes)
$python = Join-Path $work 'python-runtime/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    throw 'Missing project drawing runtime: .cloud-publish/python-runtime/Scripts/python.exe. Restore the inspection Python environment before publishing.'
}
& $python (Join-Path $PSScriptRoot 'render_inspection_drawings.py') --pdf-root $PdfRoot --hashes $hashFile --cache (Join-Path $work 'inspection-preview-cache/v1') --output $OutputDirectory --catalog $catalogPath
if ($LASTEXITCODE -ne 0) { throw 'Drawing preview generation failed. Original PDFs will not be published.' }
$catalog = Get-Content -LiteralPath $catalogPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($record in $summary.records) {
    $record.drawings = @($record.drawings | ForEach-Object {
        $id = if ($_.id) { [string]$_.id } else { [regex]::Match($_.url, '([a-f0-9]{64})\.pdf$').Groups[1].Value }
        $entry = $catalog.PSObject.Properties[$id].Value
        $pages = @($entry.pages | ForEach-Object { "data/inspection/drawings/$_" })
        if ($pages.Count -eq 0) { throw "Missing preview for drawing $id" }
        [pscustomobject]@{ id = $id; name = $_.name; pages = $pages; pointMap = "data/inspection/drawings/$($entry.pointMap)"; association = $_.association }
    })
}
$summary | Add-Member -NotePropertyName drawingMode -NotePropertyValue 'images-only' -Force
Write-PublishJson $SummaryPath $summary

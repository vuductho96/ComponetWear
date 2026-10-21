$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
Import-Module ImportExcel
$root=Join-Path $env:TEMP ('inspection-export-pool-'+[guid]::NewGuid().ToString('N'))
$app=Join-Path $root 'ComponentLife';$source=Join-Path $root 'source';$work=Join-Path $root '.cloud-publish'
$lot=Join-Path $source 'lot'
$null=New-Item -ItemType Directory -Path $app,$source,$work,$lot -Force
function Assert($value,$message){if(-not $value){throw $message};Write-Output "PASS: $message"}
function Run-Export([int]$Workers){
    $ErrorActionPreference='Continue'
    $lines=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $app 'export_inspection.ps1') -ReaderWorkers $Workers 2>&1
    return [pscustomobject]@{Code=$LASTEXITCODE;Log=($lines -join "`n")}
}
try {
    foreach($name in @('export_inspection.ps1','inspection_core.ps1','inspection_read_pool.ps1','cloud_publish.ps1')){Copy-Item -LiteralPath (Join-Path $project "ComponentLife/$name") -Destination (Join-Path $app $name)}
    foreach($name in @('render_inspection_drawings.py','inspection_points.py')){Set-Content -LiteralPath (Join-Path $app $name) -Value '# fixture'}
    $renderer=@'
param($SummaryPath,$PdfRoot,$OutputDirectory)
. (Join-Path $PSScriptRoot 'cloud_publish.ps1')
$s=Get-Content -LiteralPath $SummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
$s | Add-Member -NotePropertyName drawingMode -NotePropertyValue 'images-only'
Write-PublishJson $SummaryPath $s
'@
    [IO.File]::WriteAllText((Join-Path $app 'prepare_inspection_drawings.ps1'),$renderer,[Text.UTF8Encoding]::new($true))
    @{sourcePath=$source;sourceLabels=@{}}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'inspection.config.json') -Encoding UTF8
    for($i=1;$i -le 8;$i++){
        $path=Join-Path $lot ("Inspection $i-MF001.xlsx")
        $p=Open-ExcelPackage $path -Create
        try{
            $w=$p.Workbook.Worksheets.Add('Inspection');$w.Cells['C5'].Value=[string]$i;$w.Cells['G5'].Value='MF001';$w.Cells['N6'].Value=2
            $w.Cells['A13'].Value='Point';$w.Cells['B13'].Value='Nominal';$w.Cells['F13'].Value=1
            $w.Cells['A14'].Value=1;$w.Cells['B14'].Value='4°25′12″';$w.Cells['C14'].Value=-0.01;$w.Cells['D14'].Value=0.01
            $w.Cells['F14'].Value=if($i -eq 8){'5°00′00″'}else{'4°25′11″'}
            Close-ExcelPackage $p;$p=$null
        }finally{if($p){$p.Dispose()}}
    }
    $first=Run-Export 1
    Assert ($first.Code -eq 0) ('Serial export succeeds: '+$first.Log)
    $summary=Join-Path $app 'data/inspection/summary.json';$original=(Get-FileHash -LiteralPath $summary).Hash
    $firstSummary=Get-Content -LiteralPath $summary -Raw -Encoding UTF8|ConvertFrom-Json
    Assert ($firstSummary.records.Count -eq 8 -and @($firstSummary.records|Where-Object quality -eq NG).Count -eq 1) 'All source files retain their DMS judgements'
    Remove-Item -LiteralPath (Join-Path $work 'inspection-source.json') -Force
    Get-ChildItem -LiteralPath (Join-Path $work 'inspection-cache') -File | ForEach-Object {Remove-Item -LiteralPath $_.FullName -Force}
    $parallel=Run-Export 4
    Assert ($parallel.Code -eq 0) ('Parallel export succeeds: '+$parallel.Log)
    Assert ((Get-FileHash -LiteralPath $summary).Hash -eq $original) 'Parallel cold export produces a byte-identical dataset'
    $warm=Run-Export 4
    Assert ($warm.Code -eq 0 -and $warm.Log -match 'Inspection unchanged') 'Unchanged publish skips workbook reads entirely'
    $p=Open-ExcelPackage (Join-Path $lot 'Inspection 1-MF001.xlsx')
    $p.Workbook.Worksheets[1].Cells['F14'].Value='5°00′00″';Close-ExcelPackage $p
    $incremental=Run-Export 4
    Assert ($incremental.Code -eq 0 -and $incremental.Log -match 'cache hits=7, parsed=1') 'A changed file reloads alone while seven cached workbooks are reused'
    Copy-Item -LiteralPath (Join-Path $lot 'Inspection 3-MF001.xlsx') -Destination (Join-Path $source 'Inspection root-MF001.xlsx')
    $newFile=Run-Export 4
    Assert ($newFile.Code -eq 0 -and $newFile.Log -match 'cache hits=8, parsed=1') 'Adding a workbook reads only the new file, including a file directly in the selected folder'
    $afterNew=Get-Content -LiteralPath $summary -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert ($afterNew.records.Count -eq 9 -and ($afterNew.records|Where-Object file -eq 'Inspection root-MF001.xlsx').lot -eq '') 'A root-level Excel file publishes without a relative-folder error'
    $last=(Get-FileHash -LiteralPath $summary).Hash
    [IO.File]::WriteAllText((Join-Path $lot 'Inspection 2-MF001.xlsx'),'corrupt input')
    $failure=Run-Export 4
    Assert ($failure.Code -ne 0 -and (Get-FileHash -LiteralPath $summary).Hash -eq $last) 'Worker failure preserves the last complete published dataset'
}finally{
    $resolved=[IO.Path]::GetFullPath($root)
    if(-not $resolved.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe fixture cleanup'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

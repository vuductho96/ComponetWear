$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
. (Join-Path $project 'ComponentLife/inspection_core.ps1')
Import-Module ImportExcel
$fixtureDir = Join-Path ([IO.Path]::GetTempPath()) ('inspection-core-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $fixtureDir
function Assert($condition, $message) { if (-not $condition) { throw "FAIL: $message" }; Write-Host "PASS: $message" }
try {
    $file = Join-Path $fixtureDir 'Inspection-test.xlsx'
    $pkg = Open-ExcelPackage -Path $file -Create
    $ws = $pkg.Workbook.Worksheets.Add('Inspection')
    $ws.Cells['C5'].Value = '101'
    $ws.Cells['G5'].Value = 'M1616'
    $ws.Cells['N4'].Value = [datetime]'2026-10-19'
    $ws.Cells['N6'].Value = 3
    $ws.Cells['A14'].Value = '1'
    $ws.Cells['B14'].Value = 10
    $ws.Cells['C14'].Value = -0.1
    $ws.Cells['D14'].Value = 0.1
    $ws.Cells['F14'].Value = 9.9
    $ws.Cells['G14'].Value = 10.1
    $ws.Cells['H14'].Value = 10.1001
    $pkg.Save(); $pkg.Dispose()
    $before = [IO.File]::ReadAllBytes($file)
    $script:DimensionCache = @{}
    $record = Read-InspectionFile (Get-Item -LiteralPath $file)
    $dims = @($script:DimensionCache[(Get-DimensionCacheKey $file)])
    Assert ($record.Part -eq '101' -and $record.Mold -eq 'M1616') 'Part and mold use original worksheet cells'
    Assert ($dims.Count -eq 3) 'All numeric samples are extracted'
    Assert ($dims[0].Result -eq 'OK' -and $dims[1].Result -eq 'OK') 'Both tolerance boundaries are accepted'
    Assert ($dims[2].Result -eq 'NG') 'Value above upper tolerance is NG'
    Assert ($record.NgCount -eq 1) 'Record summary matches detailed NG samples'
    Assert ([Convert]::ToBase64String($before) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes($file))) 'Import never writes to source workbook'
    Assert ((Convert-MeasureTextToNumber '10,25') -eq 10.25) 'Comma decimals are supported'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixtureDir)
    if ($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf).StartsWith('inspection-core-')) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

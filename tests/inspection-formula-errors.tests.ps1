param([string]$ToolPath='C:/Users/415/Desktop/File đo linh kiện/InspectionTool.ps1')
$ErrorActionPreference='Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'ComponentLife/inspection_core.ps1')
Import-Module ImportExcel
$webExtractor=${function:Extract-DimensionsFromWorksheet}
$ast=[Management.Automation.Language.Parser]::ParseFile($ToolPath,[ref]$null,[ref]$null)
$fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Extract-DimensionsFromWorksheet'},$true)
Invoke-Expression $fn.Extent.Text
$pkg=New-Object OfficeOpenXml.ExcelPackage
try {
 $ws=$pkg.Workbook.Worksheets.Add('Inspection')
 $ws.Cells[13,1].Value='Point';$ws.Cells[13,2].Value='Nominal'
 for($c=6;$c -le 7;$c++){$ws.Cells[13,$c].Value=$c-5}
 $ws.Cells[13,16].Value='Result'
 foreach($r in 14..16){
  $ws.Cells[$r,1].Value=$r-13;$ws.Cells[$r,2].Value='30°'
  $ws.Cells[$r,6].Value=30.0;$ws.Cells[$r,7].Value=30.0
 }
 $ws.Cells[14,16].Value='#VALUE!'
 $ws.Cells[15,16].Value='#REF!'
 $ws.Cells[16,16].Value='OK'
 $rows=@(Extract-DimensionsFromWorksheet $ws 'fixture.xlsx')
 if($rows.Count -ne 6){throw 'Samples lost'}
 if(@($rows|Where-Object Result -eq NG).Count -ne 4){throw 'Cached source formula errors must override valid Actual'}
 if($rows[0].FormulaError -ne '#VALUE!' -or $rows[2].FormulaError -ne '#REF!'){throw 'Error details lost'}
 if($rows[0].Value -ne '30°' -or $rows[0].NumericValue -ne 30 -or $ws.Cells[14,6].Value -ne 30){throw 'Actual magnitude changed or angle unit missing'}
 $summary=Extract-DimensionsFromWorksheet $ws 'fixture.xlsx' -SummaryOnly
 if($summary.NgCount -ne 4 -or $summary.SampleCount -ne 6){throw 'Fast scan disagrees with detail'}
 $web=@(& $webExtractor $ws 'fixture.xlsx')
 if(@($web|Where-Object Result -eq NG).Count){throw 'Desktop source-error policy leaked into web'}
 Write-Output 'PASS: desktop detects VALUE/REF errors despite valid Actual; summary/detail agree; web policy unchanged.'
}finally{$pkg.Dispose()}

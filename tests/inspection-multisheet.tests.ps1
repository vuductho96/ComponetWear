$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Import-Module ImportExcel
. (Join-Path $project 'ComponentLife/inspection_core.ps1')
. (Join-Path $project 'InspectionToolIntegration/MeasurementContract.ps1')
$tool='C:/Users/415/Desktop/File đo linh kiện/InspectionTool.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($tool,[ref]$null,[ref]$null)
foreach($name in @('Extract-DimensionsFromWorksheet','Read-InspectionFile')){
    $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    Invoke-Expression $fn.Extent.Text
}
. (Join-Path $project 'InspectionToolIntegration/InspectionTool.MultiSheet.ps1')
function Save-DimensionCache{}
function Assert($condition,$message){if(-not $condition){throw $message};Write-Output "PASS: $message"}
$root=Join-Path $env:TEMP ('inspection-multisheet-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $root
$file=Join-Path $root 'Inspection PART-MF001.xlsx'
$script:DimensionCache=@{};$script:InspectionQuickEditTestMode=$true
$form=New-Object Windows.Forms.Form;$grpPreview=New-Object Windows.Forms.GroupBox;$form.Controls.Add($grpPreview)
$gridDimensions=New-Object Windows.Forms.DataGridView;$gridDimensions.AllowUserToAddRows=$false;$gridDimensions.ColumnCount=9;$grpPreview.Controls.Add($gridDimensions)
$btnPreviewAll=New-Object Windows.Forms.Button;$btnPreviewNg=New-Object Windows.Forms.Button;$btnPreviewOpen=New-Object Windows.Forms.Button
$lblPreviewTitle=New-Object Windows.Forms.Label;$lblPreviewStats=New-Object Windows.Forms.Label
try{
    $pkg=Open-ExcelPackage $file -Create
    foreach($name in @('Inspection 1-40','Inspection 41-90')){
        $ws=$pkg.Workbook.Worksheets.Add($name)
        $ws.Cells['C5'].Value='PART';$ws.Cells['G5'].Value='MF001';$ws.Cells['N6'].Value=1
        $ws.Cells['A13'].Value='Point';$ws.Cells['B13'].Value='Nominal';$ws.Cells['F13'].Value=1
        $ws.Cells['A14'].Value=if($name -eq 'Inspection 1-40'){1}else{41}
        $ws.Cells['B14'].Value=10;$ws.Cells['C14'].Value=-0.1;$ws.Cells['D14'].Value=0.1
        $ws.Cells['F14'].Value=if($name -eq 'Inspection 1-40'){10.0}else{10.2}
    }
    $ws=$pkg.Workbook.Worksheets['Inspection 41-90']
    $ws.Cells['A15'].Value=81;$ws.Cells['B15'].Value='4°25′12″';$ws.Cells['C15'].Value=-0.01;$ws.Cells['D15'].Value=0.01;$ws.Cells['F15'].Value='5°00′00″'
    Close-ExcelPackage $pkg
    $record=Read-InspectionFile (Get-Item -LiteralPath $file)
    Assert ($record.Quality -eq 'NG (2)' -and $record.NgCount -eq 2) 'Fast scan detects two NG samples after point 40 on the second sheet'
    $dims=@(Get-DimensionsFromWorkbook $file)
    Assert ($dims.Count -eq 3 -and ($dims|Where-Object Point -eq 81).Result -eq 'NG') 'Quick preview includes points 41 and 81'
    Assert ($dims[0].SheetName -eq 'Inspection 1-40' -and $dims[1].SheetName -eq 'Inspection 41-90' -and $dims[0].ExcelRow -eq $dims[1].ExcelRow) 'Identical Excel row numbers retain separate sheet identities'
    foreach($dim in $dims){
        $index=$gridDimensions.Rows.Add($dim.Point,$dim.Nominal,$dim.TolMinus,$dim.TolPlus,'',$dim.SampleNo,$dim.Value,$dim.Deviation,$dim.Result)
        $gridDimensions.Rows[$index].Tag=$dim
    }
    $script:PreviewCurrentPath=$file
    . (Join-Path $project 'InspectionToolIntegration/InspectionTool.QuickEdit.ps1')
    Assert ((Invoke-InspectionQuickFill -Seed 42) -eq 2) 'Quick fill processes both NG points from the later sheet'
    $pkg=Open-ExcelPackage $file
    try{
        Assert ($pkg.Workbook.Worksheets['Inspection 1-40'].Cells['F14'].Value -eq 10) 'Saving point 41 never overwrites point 1 at the same cell address'
        $ws=$pkg.Workbook.Worksheets['Inspection 41-90']
        Assert ($ws.Cells['F14'].Value -ge 9.9 -and $ws.Cells['F14'].Value -le 10.1 -and $ws.Cells['F15'].Value -match '^4°') 'Corrected values persist on their own sheet, including DMS'
        Assert ($ws.Cells['P14'].Formula -and $ws.Cells['P15'].Formula) 'Judgement formulas are written on the later sheet'
    }finally{$pkg.Dispose()}
    $script:DimensionCache=@{}
    Assert (@(Get-DimensionsFromWorkbook $file|Where-Object Result -eq NG).Count -eq 0) 'Reopening the workbook checks all sheets and sees the corrected results'
}finally{
    $form.Dispose();$gridDimensions.Dispose()
    $resolved=[IO.Path]::GetFullPath($root)
    if(-not $resolved.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe fixture cleanup'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

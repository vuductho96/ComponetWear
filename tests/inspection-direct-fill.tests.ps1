$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Import-Module ImportExcel
$project=Split-Path $PSScriptRoot -Parent
. (Join-Path $project 'ComponentLife/inspection_core.ps1')
function Assert($ok,$message){if(-not $ok){throw $message};Write-Output "PASS: $message"}
function Save-DimensionCache {}
$form=New-Object Windows.Forms.Form
$grpPreview=New-Object Windows.Forms.GroupBox
$grpPreview.Size=New-Object Drawing.Size(945,350)
$form.Controls.Add($grpPreview)
$gridDimensions=New-Object Windows.Forms.DataGridView
$gridDimensions.AllowUserToAddRows=$false
$gridDimensions.ColumnCount=9
$grpPreview.Controls.Add($gridDimensions)
$btnPreviewAll=New-Object Windows.Forms.Button
$btnPreviewNg=New-Object Windows.Forms.Button
$btnPreviewOpen=New-Object Windows.Forms.Button
$lblPreviewTitle=New-Object Windows.Forms.Label
$lblPreviewStats=New-Object Windows.Forms.Label
. (Join-Path $project 'InspectionToolIntegration/InspectionTool.QuickEdit.ps1')
$fixture=Join-Path $env:TEMP ('inspection-fill-'+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($fixture)
$file=Join-Path $fixture 'inspection.xlsm'
try {
    [void]$gridDimensions.Rows.Add('16','25.92','-0.01','-0.005','','1','25.922','0.002','NG')
    [void]$gridDimensions.Rows.Add('17','32','+0.015','+0.012','','1','32.004','0.004','NG')
    [void]$gridDimensions.Rows.Add('20','30','-0.002','0','','1','30.001','0.001','NG')
    [void]$gridDimensions.Rows.Add('20','30','-0.002','0','','2','29.999','-0.001','OK')
    [void]$gridDimensions.Rows.Add('99','5','','','','1','5.2','','NG')
    $gridDimensions.CurrentCell=$gridDimensions.Rows[0].Cells[6]
    $pkg=Open-ExcelPackage $file -Create
    $pkg.Workbook.CreateVBAProject()
    $module=$pkg.Workbook.VbaProject.Modules.AddModule('FillSaveTest')
    $module.Code="Public Sub KeepThisMacro()`r`nEnd Sub"
    $ws=$pkg.Workbook.Worksheets.Add('Inspection')
    $dims=@()
    for($i=0;$i -lt $gridDimensions.Rows.Count;$i++) {
        $row=$gridDimensions.Rows[$i]
        $dim=[pscustomobject]@{ExcelRow=(14+$i);ExcelCol=6;NumericValue=(Convert-MeasureTextToNumber $row.Cells[6].Value);Value=$row.Cells[6].Value;Nominal=$row.Cells[1].Value;TolMinus=$row.Cells[2].Value;TolPlus=$row.Cells[3].Value;LowerLimit=0;UpperLimit=0;Deviation=0;AbsDeviation=0;Result=$row.Cells[8].Value;IsModified=$false}
        $dims+=$dim; $row.Tag=$dim
        $ws.Cells[(14+$i),6].Value=$dim.NumericValue
        $ws.Cells[(14+$i),2].Value=$dim.Nominal
    }
    $ws.Cells[14,6].AddComment('Existing note','Operator') | Out-Null
    Close-ExcelPackage $pkg
    $script:PreviewCurrentPath=$file
    $key=Get-DimensionCacheKey $file
    $script:DimensionCache=@{}; $script:DimensionCache[$key]=$dims
    $gridDimensions.Rows[2].Visible=$false
    Assert ((Invoke-InspectionQuickFill -Seed 42) -eq 2) 'Only visible NG rows with valid tolerances are saved'
    Assert ($gridDimensions.Rows[0].Cells[8].Value -eq 'OK' -and $gridDimensions.Rows[1].Cells[8].Value -eq 'OK') 'Actual and Result update in the original grid'
    Assert ($gridDimensions.Rows[2].Cells[6].Value -eq '30.001' -and $gridDimensions.Rows[2].Cells[8].Value -eq 'NG') 'Hidden NG samples remain unchanged'
    Assert ($gridDimensions.Rows[3].Cells[6].Value -eq '29.999') 'Existing OK measurements remain unchanged'
    Assert ($gridDimensions.Rows[4].Cells[6].Value -eq '5.2') 'Missing tolerance does not overwrite Actual'
    $pkg=Open-ExcelPackage $file
    try {
        $ws=$pkg.Workbook.Worksheets[1]
        Assert ($ws.Cells[14,6].Value -ge 25.91 -and $ws.Cells[14,6].Value -le 25.915) 'Original Excel Actual is overwritten within limits'
        Assert ($ws.Cells[15,6].Value -ge 32.012 -and $ws.Cells[15,6].Value -le 32.015) 'Positive asymmetric limits save correctly'
        Assert ($ws.Cells[14,6].Comment.Text -eq 'Existing note' -and $null -eq $ws.Cells[15,6].Comment) 'No notes are added and existing comments survive'
        Assert ($ws.Cells[14,2].Value -eq '25.92') 'Nominal remains unchanged'
        Assert ($pkg.Workbook.VbaProject.Modules['FillSaveTest'].Code -match 'KeepThisMacro') 'Macros survive saving an xlsm workbook'
    } finally {$pkg.Dispose()}
    $backups=@(Get-ChildItem -LiteralPath (Join-Path $fixture '.inspection-backups'))
    Assert ($backups.Count -eq 1) 'Recovery backup exists'
    $pkg=Open-ExcelPackage $backups[0].FullName
    try {Assert ($pkg.Workbook.Worksheets[1].Cells[14,6].Value -eq 25.922) 'Backup retains old NG Actual'} finally {$pkg.Dispose()}
    $gridDimensions.Rows[2].Visible=$true
    Assert ((Invoke-InspectionQuickFill -Seed 43) -eq 1) 'Second fill resolves row tags after cache-key changes'
    $gridDimensions.Rows[0].Cells[8].Value='NG'
    $savedFunction=${function:Save-DimensionsToWorkbook}
    function Save-DimensionsToWorkbook { return $false }
    $beforeValue=$gridDimensions.Rows[0].Cells[6].Value
    $key=Get-DimensionCacheKey $file; $beforeCache=$script:DimensionCache[$key]
    $failed=$false
    try {Invoke-InspectionQuickFill -Seed 44 | Out-Null} catch {$failed=$true}
    finally {Set-Item Function:Save-DimensionsToWorkbook $savedFunction}
    Assert ($failed -and $gridDimensions.Rows[0].Cells[6].Value -eq $beforeValue -and [object]::ReferenceEquals($beforeCache[0],$script:DimensionCache[$key][0])) 'Failed saves preserve grid and cache'
} finally {
    $form.Dispose()
    Get-ChildItem -LiteralPath $fixture -File | Remove-Item -Force
    $backupFolder=Join-Path $fixture '.inspection-backups'
    if(Test-Path -LiteralPath $backupFolder){
        Get-ChildItem -LiteralPath $backupFolder -File | Remove-Item -Force
        Remove-Item -LiteralPath $backupFolder -Force
    }
    Remove-Item -LiteralPath $fixture -Force
}

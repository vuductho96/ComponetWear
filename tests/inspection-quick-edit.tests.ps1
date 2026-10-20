$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$script:InspectionQuickEditTestMode=$true
$project=Split-Path $PSScriptRoot -Parent
function Assert($ok,$message){if(-not $ok){throw $message};Write-Output "PASS: $message"}
$form=New-Object System.Windows.Forms.Form
$grpPreview=New-Object System.Windows.Forms.GroupBox
$grpPreview.Size=New-Object System.Drawing.Size(945,350)
$form.Controls.Add($grpPreview)
$gridDimensions=New-Object System.Windows.Forms.DataGridView
$gridDimensions.AllowUserToAddRows=$false
$gridDimensions.ColumnCount=9
$grpPreview.Controls.Add($gridDimensions)
$btnPreviewAll=New-Object System.Windows.Forms.Button
$btnPreviewNg=New-Object System.Windows.Forms.Button
$btnPreviewOpen=New-Object System.Windows.Forms.Button
$lblPreviewTitle=New-Object System.Windows.Forms.Label
$lblPreviewStats=New-Object System.Windows.Forms.Label
try {
    . (Join-Path $project 'ComponentLife/inspection_core.ps1')
    . (Join-Path $project 'InspectionToolIntegration/MeasurementContract.ps1')
    . (Join-Path $project 'InspectionToolIntegration/InspectionTool.QuickEdit.ps1')
    [void]$gridDimensions.Rows.Add('16','25.92','-0.01','-0.005','25.91 ~ 25.915','1','25.922','0.002','NG')
    [void]$gridDimensions.Rows.Add('17','32','+0.015','+0.012','32.012 ~ 32.015','1','32.004','0.004','NG')
    [void]$gridDimensions.Rows.Add('20','30','-0.002','0','29.998 ~ 30','1','30.001','0.001','NG')
    [void]$gridDimensions.Rows.Add('20','30','-0.002','0','29.998 ~ 30','2','29.999','-0.001','OK')
    [void]$gridDimensions.Rows.Add('99','5','','','','1','5.2','','')
    $gridDimensions.CurrentCell=$gridDimensions.Rows[0].Cells[6]
    Assert ($script:InspectionQuickEditButton.Text -eq 'Sửa nhanh') 'Quick auto-fill button appears beside preview controls'
    Assert ($script:InspectionQuickEditButton.Right -le $btnPreviewAll.Left) 'Preview buttons do not overlap'
    $before=@($gridDimensions.Rows | ForEach-Object {$_.Cells[6].Value}) -join '|'
    $rows=@(New-InspectionTestRows -Seed 42)
    Assert ($rows.Count -eq 5) 'Auto fill includes every currently displayed sample'
    Assert (@($rows | Where-Object {$_.Point -eq '20'}).Count -eq 2) 'Repeated Point numbers retain separate samples'
    foreach($row in $rows | Where-Object {$_.Actual -ne ''}) {
        $value=[double]::Parse($row.Actual,[Globalization.CultureInfo]::InvariantCulture)
        Assert ($value -ge $row.Lower -and $value -le $row.Upper -and $row.IsTest) ('Generated value stays within tolerance for Point '+$row.Point+' Sample '+$row.Sample)
    }
    Assert ($rows[1].Lower -eq 32.012 -and $rows[1].Upper -eq 32.015) 'Positive asymmetric tolerances are interpreted correctly'
    Assert ($rows[4].Actual -eq '' -and $rows[4].Result -match 'Thiếu') 'Missing tolerance is reported rather than filled'
    $after=@($gridDimensions.Rows | ForEach-Object {$_.Cells[6].Value}) -join '|'
    Assert ($before -eq $after) 'Generating test values never changes real measurement grid cells'
    $gridDimensions.Rows[1].Visible=$false
    Assert (@(New-InspectionTestRows -Seed 42).Count -eq 4) 'Hidden rows are excluded from auto fill'
    $gridDimensions.Rows[1].Visible=$true
} finally {$form.Dispose()}

Import-Module ImportExcel
. (Join-Path $project 'ComponentLife/inspection_core.ps1')
. (Join-Path $project 'InspectionToolIntegration/InspectionTool.DimensionSave.ps1')
function Save-DimensionCache {}
$file=Join-Path $env:TEMP ('inspection-quick-save-'+[Guid]::NewGuid().ToString('N')+'.xlsx')
try {
    $pkg=Open-ExcelPackage -Path $file -Create
    $ws=$pkg.Workbook.Worksheets.Add('Inspection');$ws.Cells[14,6].Value=1.0;$ws.Cells[14,2].Value='C1.0'
    Close-ExcelPackage $pkg
    $key=Get-DimensionCacheKey $file
    $dim=[pscustomobject]@{ExcelRow=14;ExcelCol=6;NumericValue=1.05;Value='1.05';Nominal='1';TolMinus='-0.1';TolPlus='+0.1';IsModified=$true}
    $script:DimensionCache=@{};$script:DimensionCache[$key]=@($dim)
    $script:InspectionQuickEditActualOnly=$true
    Assert (Save-DimensionsToWorkbook $file) 'First quick edit saves to a real Excel workbook'
    $newKey=Get-DimensionCacheKey $file
    Assert ($script:DimensionCache.ContainsKey($newKey) -and -not $dim.IsModified) 'Successful save refreshes the cache key and clears pending edits'
    $dim.NumericValue=1.07;$dim.Value='1.07';$dim.IsModified=$true
    Assert (Save-DimensionsToWorkbook $file) 'Second consecutive quick edit also saves'
    $pkg=Open-ExcelPackage $file
    try {Assert ($pkg.Workbook.Worksheets[1].Cells[14,6].Value -eq 1.07) 'Excel contains the latest edited measurement';Assert ($pkg.Workbook.Worksheets[1].Cells[14,2].Value -eq 'C1.0') 'Quick edits preserve the original nominal dimension text'} finally {$pkg.Dispose()}
} finally {if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force}}

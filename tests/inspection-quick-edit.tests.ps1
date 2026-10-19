$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
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
    . (Join-Path $project 'InspectionToolIntegration/InspectionTool.QuickEdit.ps1')
    [void]$gridDimensions.Rows.Add('20','30','-0.002','0','29.998 ~ 30','2','29.999','-0.001','OK')
    $gridDimensions.CurrentCell=$gridDimensions.Rows[0].Cells[6]
    Assert ($script:InspectionQuickEditButton.Text -eq 'Sửa nhanh') 'Quick edit button appears beside preview controls'
    Assert ($script:InspectionQuickEditButton.Right -le $btnPreviewAll.Left) 'Preview buttons do not overlap'
    $script:writes=@()
    function Save-InspectionQuickValue([int]$RowIndex,[string]$Value){$script:writes+=@{row=$RowIndex;value=$Value};return $true}
    $dialog=New-InspectionQuickEditDialog 0
    Assert ($dialog.Controls[0].Text -match 'Point 20.*Mẫu 2') 'Dialog identifies the exact Point and Sample'
    $input=$dialog.Controls.Find('quickActual',$true)[0]
    $save=$dialog.Controls.Find('quickSave',$true)[0]
    $click=$save.GetType().GetMethod('OnClick',[Reflection.BindingFlags]'Instance,NonPublic')
    $input.Text='abc'
    [void]$click.Invoke($save,@([EventArgs]::Empty))
    Assert ($script:writes.Count -eq 0) 'Invalid input cannot write to Excel'
    Assert ($dialog.Controls.Find('quickError',$true)[0].Text -ne '') 'Invalid input shows a useful error'
    $input.Text='29,998'
    [void]$click.Invoke($save,@([EventArgs]::Empty))
    Assert ($script:writes.Count -eq 1 -and $script:writes[0].value -eq '29,998' -and $script:writes[0].row -eq 0) 'Save targets only the selected sample and accepts decimal comma'
    $dialog.Dispose()
    $cancelDialog=New-InspectionQuickEditDialog 0
    $cancelDialog.Controls.Find('quickActual',$true)[0].Text='12'
    $cancelDialog.Dispose()
    Assert ($script:writes.Count -eq 1) 'Closing or cancelling without Save leaves Excel unchanged'
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

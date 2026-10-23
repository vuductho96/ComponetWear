$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'ComponentLife/inspection_core.ps1')
Import-Module ImportExcel
$tool='C:/Users/415/Desktop/File đo linh kiện/InspectionTool.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($tool,[ref]$null,[ref]$null)
foreach($name in @('Extract-DimensionsFromWorksheet','Read-InspectionFile','Get-ItemQuality','Show-SelectedRowDimensions')){
    $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    Invoke-Expression $fn.Extent.Text
}
. (Join-Path $root 'InspectionToolIntegration/InspectionTool.MultiSheet.ps1')
function Save-DimensionCache{}
function Assert($condition,$message){if(-not $condition){throw $message};Write-Output ('PASS: '+$message)}
$script:DimensionCache=@{}
$dir=Join-Path $env:TEMP ('inspection-completeness-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $dir
$file=Join-Path $dir 'Inspection CF28-YG08031.xlsx'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form=New-Object Windows.Forms.Form
$table=New-Object Windows.Forms.DataGridView;$table.ColumnCount=17;$table.AllowUserToAddRows=$false;$form.Controls.Add($table)
$gridDimensions=New-Object Windows.Forms.DataGridView;$gridDimensions.ColumnCount=9;$gridDimensions.AllowUserToAddRows=$false;$form.Controls.Add($gridDimensions)
$lblPreviewTitle=New-Object Windows.Forms.Label;$lblPreviewStats=New-Object Windows.Forms.Label
$script:PreviewShowOnlyNg=$true
function Test-Preview($record){
    $table.Rows.Clear();$i=$table.Rows.Add()
    foreach($pair in @(@(0,$record.File),@(1,$record.Part),@(2,$record.Mold),@(7,$record.Status),@(8,$record.Path),@(16,$record.Quality))){$table.Rows[$i].Cells[$pair[0]].Value=$pair[1]}
    $table.CurrentCell=$table.Rows[$i].Cells[0];$script:AllData=@($record)
    Show-SelectedRowDimensions
}
try{
    $pkg=Open-ExcelPackage $file -Create
    foreach($name in @('Inspection 1-40','Inspection 41-80')){
        $ws=$pkg.Workbook.Worksheets.Add($name)
        $ws.Cells['C5'].Value='CF28';$ws.Cells['G5'].Value='YG08031';$ws.Cells['N6'].Value=2
        $ws.Cells['A13'].Value='Point';$ws.Cells['B13'].Value='Nominal';$ws.Cells['F13'].Value=1;$ws.Cells['G13'].Value=2;$ws.Cells['P13'].Value='Result'
    }
    $ws=$pkg.Workbook.Worksheets['Inspection 1-40']
    foreach($r in 14..19){$ws.Cells[$r,1].Value=$r-13;$ws.Cells[$r,2].Value=1;$ws.Cells[$r,3].Value=-0.1;$ws.Cells[$r,4].Value=0.1}
    $ws.Cells['F14'].Value=1;$ws.Cells['F15'].Value=1;$ws.Cells['G15'].Value=1
    $ws.Cells['A16'].Value=20;$ws.Cells['B16'].Value='DP0.003';$ws.Cells['C16'].Value=-0.002;$ws.Cells['D16'].Value=0.002
    $ws.Cells['A17'].Value=21;$ws.Cells['B17'].Value='DP0.004';$ws.Cells['C17'].Value=-0.002;$ws.Cells['D17'].Value=0.002
    $ws.Cells['A18'].Value=22
    $ws.Cells['A19'].Value=23;$ws.Cells['B19'].Value=$null;$ws.Cells['F19'].Value=1
    $ws=$pkg.Workbook.Worksheets['Inspection 41-80'];$ws.Cells['A14'].Value=41;$ws.Cells['B14'].Value=1;$ws.Cells['C14'].Value=-0.1;$ws.Cells['D14'].Value=0.1
    foreach($r in 300..301){$ws.Cells[$r,1].Value=$r;$ws.Cells[$r,2].Value=1;$ws.Cells[$r,3].Value=-0.1;$ws.Cells[$r,4].Value=0.1}
    $ws.Cells['F300'].Value=1
    $ws.Cells[1048576,1].Style.Font.Bold=$true
    $note=$pkg.Workbook.Worksheets.Add('Readme');$note.Cells['A1'].Value='Readme'
    $note=$pkg.Workbook.Worksheets.Add('Empty header');$note.Cells['A13'].Value='Point';$note.Cells['B13'].Value='Nominal';$note.Cells['F13'].Value=1
    Close-ExcelPackage $pkg
    $before=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    $record=Read-InspectionFile (Get-Item -LiteralPath $file)
    $dims=@(Get-DimensionsFromWorkbook $file)
    Assert ($record.Quality -eq 'NG (6)' -and $record.Status -eq 'ĐÃ ĐO') 'Fast scan catches unsupported blank Nominals and missing measured steps'
    Assert ($dims.Count -eq 10 -and @($dims|Where-Object Result -eq NG).Count -eq 6) 'Summary and Quick Preview agree without dropping blank steps'
    $dp=@($dims|Where-Object Point -in @('20','21'))
    Assert ($dp.Count -eq 2 -and @($dp|Where-Object {$_.ValidationError -match 'Nominal' -and $_.ValidationError -match 'Actual' -and $_.Value -eq '' -and $_.IsMissingMeasurement}).Count -eq 2) 'Both DP rows explain unsupported Nominal and missing Actual; no values invented'
    Assert (@($dims|Where-Object {$_.Point -eq '1' -and $_.Result -eq 'OK'}).Count -eq 1) 'Unused repeat-sample columns do not make single-sample steps NG'
    Assert (@($dims|Where-Object {$_.Point -eq '41' -and $_.SheetName -eq 'Inspection 41-80' -and $_.IsMissingMeasurement}).Count -eq 1) 'Entirely blank continuation sheets cannot bypass checking'
    Assert (@($dims|Where-Object {$_.Point -eq '300' -and $_.Result -eq 'OK'}).Count -eq 1 -and @($dims|Where-Object {$_.Point -eq '301' -and $_.IsMissingMeasurement}).Count -eq 1) 'Rows beyond 250 are also checked without scanning formatted blank tails'
    Assert (@($dims|Where-Object {$_.Point -eq '23' -and $_.ValidationError -match 'Thiếu Nominal'}).Count -eq 1) 'Actual with missing Nominal is also caught'
    Assert ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -eq $before) 'All checks are read-only'
    Test-Preview $record
    $visible=@($gridDimensions.Rows|Where-Object {$_.Cells[0].Value -eq '20'})
    Assert ($visible.Count -eq 1 -and $visible[0].Cells[6].Value -eq 'THIẾU KẾT QUẢ' -and $visible[0].Cells[8].ToolTipText -match 'Nominal' -and $lblPreviewStats.Text -match 'Thiếu kết quả: 5 step') 'Installed Quick Preview shows missing Actual, reason and separate missing-step counts'
    $pending=Join-Path $dir 'pending.xlsx';$pkg=Open-ExcelPackage $pending -Create;$ws=$pkg.Workbook.Worksheets.Add('Inspection')
    $ws.Cells['C5'].Value='P';$ws.Cells['G5'].Value='M';$ws.Cells['A13'].Value='Point';$ws.Cells['B13'].Value='Nominal';$ws.Cells['F13'].Value=1
    $ws.Cells['A14'].Value=1;$ws.Cells['B14'].Value=1;$ws.Cells['C14'].Value=-0.1;$ws.Cells['D14'].Value=0.1
    Close-ExcelPackage $pkg
    $record=Read-InspectionFile (Get-Item -LiteralPath $pending)
    Assert ($record.Status -eq 'CHƯA ĐO' -and $record.Quality -eq '') 'A fully unmeasured, configured report remains pending'
    $pkg=Open-ExcelPackage $pending;$pkg.Workbook.Worksheets[1].Cells['B14'].Value='DP0.003';Close-ExcelPackage $pkg
    $record=Read-InspectionFile (Get-Item -LiteralPath $pending)
    Assert ($record.Status -eq 'CHƯA ĐO' -and $record.Quality -eq 'NG (1)' -and (Get-ItemQuality $record) -eq 'NG (1)') 'Unconfigured blank reports expose NG without pretending measurements exist'
    Test-Preview $record
    Assert ($gridDimensions.Rows.Count -eq 1 -and $gridDimensions.Rows[0].Cells[6].Value -eq 'THIẾU KẾT QUẢ') 'Pending status cannot hide invalid-configuration diagnostics'
    $pkg=Open-ExcelPackage $pending;$ws=$pkg.Workbook.Worksheets[1];$ws.Cells['B14'].Value=1;$ws.Cells['F13'].Value=11;$ws.Cells['F14'].Value=1
    $ws.Cells['A15'].Value=2;$ws.Cells['B15'].Value=1;$ws.Cells['C15'].Value=-0.1;$ws.Cells['D15'].Value=0.1
    Close-ExcelPackage $pkg
    $record=Read-InspectionFile (Get-Item -LiteralPath $pending)
    Assert ($record.Status -eq 'ĐÃ ĐO' -and $record.Quality -eq 'OK') 'Later sample batches may measure only selected repeated steps'
}finally{
    $form.Dispose();$table.Dispose();$gridDimensions.Dispose()
    $resolved=[IO.Path]::GetFullPath($dir)
    if(-not $resolved.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe fixture cleanup'}
    Remove-Item -LiteralPath $dir -Recurse -Force
}

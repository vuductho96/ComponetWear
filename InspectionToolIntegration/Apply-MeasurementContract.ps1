param([Parameter(Mandatory=$true)][string]$RapidPath,[Parameter(Mandatory=$true)][string]$ToolPath)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$python=Join-Path $root '.cloud-publish/python-runtime/Scripts/python.exe'
& $python (Join-Path $PSScriptRoot 'build_measurement_contract.py')
if($LASTEXITCODE -ne 0){throw 'Could not refresh shared formulas; apps have not been modified.'}
$core=[IO.File]::ReadAllText((Join-Path $root 'ComponentLife/inspection_core.ps1'))
$contract=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'MeasurementContract.ps1'))
function Get-Functions([string]$text) {
    $ast=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$null,[ref]$null)
    return $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)
}
function Install-Functions([string]$path,$functions) {
    $text=[IO.File]::ReadAllText($path)
    foreach($function in $functions) {
        $existing=@(Get-Functions $text | Where-Object Name -eq $function.Name)
        if($existing.Count -gt 1){throw "Ambiguous function: $($function.Name)"}
        if($existing.Count){$text=$text.Remove($existing[0].Extent.StartOffset,$existing[0].Extent.Text.Length).Insert($existing[0].Extent.StartOffset,$function.Extent.Text)}
        else{$text=$function.Extent.Text+"`r`n"+$text}
    }
    # Force old desktop scan entries to be checked again after rule changes.
    $text=[regex]::Replace($text,'raw-cell-limits-v2\||measurement-contract-v(?:[3456789]|10|11)\|','measurement-contract-v12|')
    if ($path -eq $RapidPath) {
        $text=$text.Replace('$cell.NumberFormat = "0.###""°"""','$cell.NumberFormat = $numFmt + ''"°"''')
        $text=$text.Replace('Set-ExcelCellToleranceValue $ws $row 3 $lowerTol','Set-ExcelCellToleranceValue $ws $row 3 $rowData.TolMinus').Replace('Set-ExcelCellToleranceValue $ws $row 4 $upperTol','Set-ExcelCellToleranceValue $ws $row 4 $rowData.TolPlus')
    } else {
        # Iterate stored Point cells, so neither long forms nor formatted blank tails
        # cause silent truncation or a scan across a million empty Excel rows.
        $text=$text.Replace('for ($r = ($header + 1); $r -le $endRow; $r++) {','if($ws.Dimension.End.Row -le $header){if($SummaryOnly){return [pscustomobject]@{SampleCount=0;NgCount=0;UnratedCount=0}};return $result}'+"`r`n"+'    foreach ($pointCell in $ws.Cells[($header+1),1,$ws.Dimension.End.Row,1]) {'+"`r`n"+'        $r=$pointCell.Start.Row')
        # Replace the old first-sheet-only scan with a workbook-wide, allocation-light summary.
        $readFunction=@(Get-Functions $text | Where-Object Name -eq 'Read-InspectionFile')[0]
        $readText=$readFunction.Extent.Text
        $oldSummary='(?s)\$ngCount = 0.*?\$ngCount = \$stats\.NgCount; \$unratedCount = \$stats\.UnratedCount\s*\}'
        $newSummary='$stats=Get-InspectionWorkbookStats $pkg $file.FullName $part $mold $dateMeasure'+"`r`n"+'            $ngCount=$stats.NgCount; $unratedCount=$stats.UnratedCount'+"`r`n"+'            $status=if($stats.SampleCount -gt 0){"ĐÃ ĐO"}else{"CHƯA ĐO"}'
        $patched=[regex]::Replace($readText,$oldSummary,[Text.RegularExpressions.MatchEvaluator]{param($m) $newSummary})
        $patched=$patched.Replace('$quality = if ($status -ne "ĐÃ ĐO") { "" } elseif ($ngCount -gt 0) { "NG ($ngCount)" } else { "OK" }','$quality = if ($ngCount -gt 0) { "NG ($ngCount)" } elseif ($status -ne "ĐÃ ĐO") { "" } else { "OK" }')
        if($patched -notmatch 'Get-InspectionWorkbookStats'){throw 'Could not install all-sheet summary scan'}
        $text=$text.Remove($readFunction.Extent.StartOffset,$readFunction.Extent.Text.Length).Insert($readFunction.Extent.StartOffset,$patched)
        $previewFunction=@(Get-Functions $text | Where-Object Name -eq 'Show-SelectedRowDimensions')[0]
        $previewText=$previewFunction.Extent.Text
        $previewText=$previewText.Replace('if ($status -ne "ĐÃ ĐO") {','if ($status -ne "ĐÃ ĐO" -and (Safe-Text $table.CurrentRow.Cells[16].Value) -notmatch "^NG") {')
        $previewText=$previewText.Replace('$totalSamples = $allDims.Count','$totalSamples = @($allDims | Where-Object { -not $_.IsMissingMeasurement }).Count')
        $previewText=$previewText.Replace('if ($totalSamples -eq 0) {','if ($allDims.Count -eq 0) {')
        $previewText=$previewText.Replace('"Tổng: $pointCount điểm ($totalSamples mẫu) | ĐẠT: $okCount | LỖI (NG): $ngCount mẫu"','("Tổng: {0} điểm ({1} mẫu) | ĐẠT: {2} | NG: {3} mẫu | Thiếu kết quả: {4} step" -f $pointCount,$totalSamples,$okCount,(@($ngList | Where-Object {-not $_.IsMissingMeasurement}).Count),(@($ngList | Where-Object IsMissingMeasurement).Count))')
        $previewText=$previewText.Replace('$dRow.Cells[6].Value = $dim.Value','$dRow.Cells[6].Value = $(if($dim.IsMissingMeasurement){"THIẾU KẾT QUẢ"}else{$dim.Value})')
        if($previewText -notmatch 'ValidationError'){
            $previewText=$previewText.Replace('$dRow.Tag = $dim','$dRow.Tag = $dim'+"`r`n"+'            $reason=$(if($dim.ValidationError){$dim.ValidationError}elseif($dim.FormulaError){"Lỗi công thức: "+$dim.FormulaError}else{""})'+"`r`n"+'            $dRow.HeaderCell.ToolTipText=$reason; $dRow.Cells[6].ToolTipText=$reason; $dRow.Cells[8].ToolTipText=$reason')
        }
        $text=$text.Remove($previewFunction.Extent.StartOffset,$previewFunction.Extent.Text.Length).Insert($previewFunction.Extent.StartOffset,$previewText)
        # Lot quantity de-duplication must never hide additional sample workbooks.
        $scanFunction=@(Get-Functions $text | Where-Object Name -eq 'Scan')[0]
        $scanText=[regex]::Replace($scanFunction.Extent.Text,'if\s*\(\$d\.Qty -gt 0\)','if (Test-InspectionRecordForList $d)')
        if($scanText -notmatch 'Test-InspectionRecordForList'){throw 'Could not install complete workbook listing'}
        $text=$text.Remove($scanFunction.Extent.StartOffset,$scanFunction.Extent.Text.Length).Insert($scanFunction.Extent.StartOffset,$scanText)
        $kpiFunction=@(Get-Functions $text | Where-Object Name -eq 'Update-KpiChart')[0]
        $kpiText=$kpiFunction.Extent.Text
        $visibleGuard='if (-not $r.Visible) { continue }'
        if($kpiText -notmatch 'Skip quantity-only duplicates in KPI'){
            if(-not $kpiText.Contains($visibleGuard)){throw 'Could not preserve KPI lot counting'}
            $kpiText=$kpiText.Replace($visibleGuard,$visibleGuard+"`r`n"+'        # Skip quantity-only duplicates in KPI; keep their workbooks visible.'+"`r`n"+'        if ((Safe-Qty $r.Cells[6].Value) -le 0) { continue }')
            $text=$text.Remove($kpiFunction.Extent.StartOffset,$kpiFunction.Extent.Text.Length).Insert($kpiFunction.Extent.StartOffset,$kpiText)
        }
        $timeFunction=@(Get-Functions $text | Where-Object Name -eq 'Auto-FillMissingTimeOverrides')[0]
        $timeText=$timeFunction.Extent.Text.Replace('foreach ($item in @($script:AllData)) {','foreach ($item in @($script:AllData | Where-Object { (Safe-Qty $_.Qty) -gt 0 })) {')
        if($timeText -notmatch 'Where-Object \{ \(Safe-Qty \$_\.Qty\) -gt 0 \}') {throw 'Could not preserve automatic time allocation'}
        $text=$text.Remove($timeFunction.Extent.StartOffset,$timeFunction.Extent.Text.Length).Insert($timeFunction.Extent.StartOffset,$timeText)
        # Only the desktop reader checks cached source formula errors; web uses its own regenerated formula.
        $text=$text.Replace('[switch]$CheckFormulaErrors'+"`r`n",'[switch]$CheckFormulaErrors = $true'+"`r`n").Replace('[switch]$CheckFormulaErrors'+"`n",'[switch]$CheckFormulaErrors = $true'+"`n")
        $text=$text.Replace('$isNg = ($val -lt ($minL - $epsilon) -or $val -gt ($maxL + $epsilon))','$isNg = (Get-MeasurementResult $nomText $t1Text $t2Text $valText) -eq ''NG''')
        $text=$text.Replace('if ($null -ne $nom -and $null -ne $t1 -and $null -ne $t2 -and $null -ne $val) {','if ($null -ne $nom -and $null -ne $val) {')
        $limitsLine='$maxL = [Math]::Max($nom + $effT1, $nom + $effT2)'
        if ($text -notmatch 'Blank tolerance has no numeric bounds') {
            $text=$text.Replace($limitsLine,$limitsLine+"`r`n"+'        # Blank tolerance has no numeric bounds'+"`r`n"+'        if ($null -eq $t1 -or $null -eq $t2) { $minL=$null; $maxL=$null }')
            $text=$text.Replace('("{0} ~ {1}" -f [Math]::Round($minL, 6), [Math]::Round($maxL, 6))','$(if ($null -ne $minL -and $null -ne $maxL) { "{0} ~ {1}" -f [Math]::Round($minL, 6), [Math]::Round($maxL, 6) } else { "" })')
        }
        $deviationColumn='$gridDimensions.Columns[7].Name = "Deviation (Δ)"'
        if ($text -notmatch '\$gridDimensions\.Columns\[7\]\.DefaultCellStyle\.Format = ''0\.############''') {
            $text=$text.Replace($deviationColumn,$deviationColumn+"`r`n"+'$gridDimensions.Columns[7].DefaultCellStyle.Format = ''0.############'''+"`r`n"+'$gridDimensions.Columns[7].DefaultCellStyle.FormatProvider = [Globalization.CultureInfo]::InvariantCulture')
        }
        $text=[regex]::Replace($text,'\$ngCount = \$stats\.NgCount(?:; \$unratedCount = \$stats\.UnratedCount)*','$ngCount = $stats.NgCount; $unratedCount = $stats.UnratedCount')
        $text=$text.Replace(' elseif ($unratedCount -gt 0) { "UNRATED" }','')
    }
    $errors=$null
    $null=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$null,[ref]$errors)
    if($errors.Count){throw ($errors | Out-String)}
    if($text -ne [IO.File]::ReadAllText($path)) {
        Copy-Item -LiteralPath $path -Destination ($path+'.measurement-backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
        [IO.File]::WriteAllText($path,$text,[Text.UTF8Encoding]::new($true))
    }
}
$parser=@(Get-Functions $core | Where-Object Name -eq 'Convert-MeasureTextToNumber')
# The shared parser calls Safe-Text; Rapid does not need the inspection reader.
$safe=@(Get-Functions $core | Where-Object Name -eq 'Safe-Text')
$formulaTarget=Join-Path (Split-Path $RapidPath -Parent) 'MeasurementContract.formulas.json'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'MeasurementContract.formulas.json') -Destination $formulaTarget -Force
Install-Functions $RapidPath ($safe+$parser+@(Get-Functions $contract))
$toolFunctions=@(Get-Functions $contract | Where-Object Name -in @('Convert-MeasurementNumber','Get-MeasurementResult','Format-AutoSampleDms','Format-InspectionGeneratedSample'))
Install-Functions $ToolPath ($parser+@(Get-Functions $core | Where-Object Name -in @('Get-InspectionCellText','Extract-DimensionsFromWorksheet'))+$toolFunctions+@(Get-Functions ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'InspectionTool.MultiSheet.ps1')))))
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'MeasurementContract.formulas.json') -Destination (Join-Path (Split-Path $ToolPath -Parent) 'MeasurementContract.formulas.json') -Force
foreach($module in @('InspectionTool.QuickEdit.ps1','InspectionTool.DimensionSave.ps1','InspectionTool.Judge.ps1','InspectionTool.WebPublish.ps1','InspectionTool.PublishDetails.ps1')){
    $destination=Join-Path (Split-Path $ToolPath -Parent) $module
    $payload=[IO.File]::ReadAllText((Join-Path $PSScriptRoot $module))
    if((Test-Path -LiteralPath $destination) -and $payload -ne [IO.File]::ReadAllText($destination)){Copy-Item -LiteralPath $destination -Destination ($destination+'.measurement-backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))}
    [IO.File]::WriteAllText($destination,$payload,[Text.UTF8Encoding]::new($true))
}
Write-Output 'Measurement contract installed. Restart the apps to load it; workbooks have not been modified.'

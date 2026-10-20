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
    $text=$text.Replace('raw-cell-limits-v2|','measurement-contract-v3|')
    if ($path -eq $RapidPath) {
        $text=$text.Replace('Set-ExcelCellToleranceValue $ws $row 3 $lowerTol','Set-ExcelCellToleranceValue $ws $row 3 $rowData.TolMinus').Replace('Set-ExcelCellToleranceValue $ws $row 4 $upperTol','Set-ExcelCellToleranceValue $ws $row 4 $rowData.TolPlus')
    } else {
        $deviationColumn='$gridDimensions.Columns[7].Name = "Deviation (Δ)"'
        if ($text -notmatch '\$gridDimensions\.Columns\[7\]\.DefaultCellStyle\.Format = ''0\.############''') {
            $text=$text.Replace($deviationColumn,$deviationColumn+"`r`n"+'$gridDimensions.Columns[7].DefaultCellStyle.Format = ''0.############'''+"`r`n"+'$gridDimensions.Columns[7].DefaultCellStyle.FormatProvider = [Globalization.CultureInfo]::InvariantCulture')
        }
        $text=[regex]::Replace($text,'\$ngCount = \$stats\.NgCount(?:; \$unratedCount = \$stats\.UnratedCount)*','$ngCount = $stats.NgCount; $unratedCount = $stats.UnratedCount')
        $text=$text.Replace('elseif ($ngCount -gt 0) { "NG ($ngCount)" } else { "OK" }','elseif ($ngCount -gt 0) { "NG ($ngCount)" } elseif ($unratedCount -gt 0) { "UNRATED" } else { "OK" }')
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
Install-Functions $ToolPath ($parser+@(Get-Functions $core | Where-Object Name -in @('Get-InspectionCellText','Extract-DimensionsFromWorksheet')))
Write-Output 'Measurement contract installed. Restart the apps to load it; workbooks have not been modified.'

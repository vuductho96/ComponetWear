param([Parameter(Mandatory=$true)][string]$ToolPath)
$ErrorActionPreference='Stop'
$text=[IO.File]::ReadAllText($ToolPath,[Text.Encoding]::UTF8)
$updated=[regex]::Replace($text,'(?s)if \(\$tolA -gt 0 -and -not \(\$tolLowText\.Trim\(\)\.StartsWith\(''\+''\)\)\) \{\s*\$effTolLow = -\$tolA\s*\}', '# Preserve the signed tolerance stored in Excel.')
$updated=[regex]::Replace($updated,'(?s)if \(\$t1 -gt 0 -and -not \(\$t1Text\.Trim\(\)\.StartsWith\(''\+''\)\)\) \{\s*\$effT1 = -\$t1\s*\}', '# Preserve the signed tolerance stored in Excel.')
$updated=$updated.Replace('$epsilon = 0.0005001','$epsilon = 0.0000001')
$updated=$updated.Replace('return (''{0}|{1}'' -f $file.LastWriteTimeUtc.Ticks, $file.Length)','return (''strict-limits-v1|{0}|{1}'' -f $file.LastWriteTimeUtc.Ticks, $file.Length)')
$corePath=Join-Path (Split-Path $PSScriptRoot -Parent) 'ComponentLife/inspection_core.ps1'
$coreAst=[Management.Automation.Language.Parser]::ParseFile($corePath,[ref]$null,[ref]$null)
$appAst=[Management.Automation.Language.Parser]::ParseInput($updated,[ref]$null,[ref]$null)
foreach($name in @('Extract-DimensionsFromWorksheet','Get-InspectionCellText')) {
    $replacement=$coreAst.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true).Extent.Text
    $existing=$appAst.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    if($existing){$updated=$updated.Remove($existing.Extent.StartOffset,$existing.Extent.Text.Length).Insert($existing.Extent.StartOffset,$replacement)}
    else{$updated=$replacement+"`r`n"+$updated}
    $appAst=[Management.Automation.Language.Parser]::ParseInput($updated,[ref]$null,[ref]$null)
}
$updated=$updated.Replace('strict-limits-v1|','raw-cell-limits-v2|')
$appAst=[Management.Automation.Language.Parser]::ParseInput($updated,[ref]$null,[ref]$null)
$read=$appAst.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Read-InspectionFile'},$true)
$readText=$read.Extent.Text
$fastRead=[regex]::Replace($readText,'(?s)\$fullDims = @\(Extract-DimensionsFromWorksheet[^\r\n]+\).*?\$script:DimensionCache\[\$cKey\] = @\(\$fullDims\)\s*\}', '$stats = Extract-DimensionsFromWorksheet -ws $ws -path $file.FullName -part $part -mold $mold -dateMeasure $dateMeasure -SummaryOnly'+"`r`n"+'                $ngCount = $stats.NgCount')
$updated=$updated.Remove($read.Extent.StartOffset,$readText.Length).Insert($read.Extent.StartOffset,$fastRead)
if($updated -eq $text){Write-Output 'Strict limits already installed.';return}
$tokens=$null;$parseErrors=$null
$null=[Management.Automation.Language.Parser]::ParseInput($updated,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Patched script did not parse; original retained.'}
Copy-Item -LiteralPath $ToolPath -Destination ($ToolPath+'.strict-limits-backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
[IO.File]::WriteAllText($ToolPath,$updated,[Text.UTF8Encoding]::new($true))
Write-Output 'Strict limits installed. Reopen Inspection Tool to apply; workbooks are unchanged.'

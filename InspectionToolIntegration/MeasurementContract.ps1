# Numeric parsing is installed from ComponentLife/inspection_core.ps1 by the installer.
function Convert-MeasurementNumber($value) {
    return Convert-MeasureTextToNumber ([string]$value)
}
function Convert-MechanicalNumberToDouble($value,[ref]$number) {
    $parsed = Convert-MeasurementNumber $value
    $number.Value = 0.0
    if ($null -eq $parsed) { return $false }
    $number.Value = [double]$parsed
    return $true
}
function Convert-AngleDmsTextToDouble($text,[ref]$number) {
    $number.Value = 0.0
    if ([string]$text -notmatch '[°º]') { return $false }
    return Convert-MechanicalNumberToDouble $text $number
}
function Get-MeasurementResult($nominalText,$tolMinusText,$tolPlusText,$actualText) {
    if ([string]::IsNullOrWhiteSpace([string]$actualText)) { return '' }
    $n=Convert-MeasurementNumber $nominalText
    $a=Convert-MeasurementNumber $tolMinusText
    $b=Convert-MeasurementNumber $tolPlusText
    $v=Convert-MeasurementNumber $actualText
    if ($null -eq $n -or $null -eq $a -or $null -eq $b -or $null -eq $v) { return 'NG' }
    if ($v -lt ($n+[Math]::Min($a,$b)-0.0000001) -or $v -gt ($n+[Math]::Max($a,$b)+0.0000001)) { return 'NG' }
    return 'OK'
}
function Set-ExcelInspectionJudgeFormula($sheet,$row,$nominalText) {
    if (-not $script:MeasurementFormulaSpec) {
        $script:MeasurementFormulaSpec=Get-Content -LiteralPath (Join-Path $script:AppRoot 'MeasurementContract.formulas.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    # Same helpers and same judgement as the browser's current report template.
    for ($i=0;$i -lt 13;$i++) {
        $sheet.Cells.Item([int]$row,18+$i).Formula='='+$script:MeasurementFormulaSpec.clean[$i].Replace('@ROW@',[string]$row)
        $sheet.Cells.Item([int]$row,31+$i).Formula='='+$script:MeasurementFormulaSpec.number[$i].Replace('@ROW@',[string]$row)
    }
    $sheet.Cells.Item([int]$row,44).Formula="=IF(COUNT(AE${row}:AG${row})=3,AE${row}+MIN(AF${row}:AG${row}),`"`" )"
    $sheet.Cells.Item([int]$row,45).Formula="=IF(COUNT(AE${row}:AG${row})=3,AE${row}+MAX(AF${row}:AG${row}),`"`" )"
    $count="COLUMNS(F${row}:O${row})-COUNTBLANK(F${row}:O${row})"
    $sheet.Cells.Item([int]$row,16).Formula="=IF(($count)=0,`"`",IF(OR(COUNT(AE${row}:AG${row})<3,COUNT(AH${row}:AQ${row})<>($count)),`"NG`",IF(OR(MIN(AH${row}:AQ${row})<AR${row}-0.0000001,MAX(AH${row}:AQ${row})>AS${row}+0.0000001),`"NG`",`"OK`")))"
    $sheet.Range('R:AS').EntireColumn.Hidden=$true
}
function Set-ExcelCellToleranceValue($sheet,$row,$column,$tolValue) {
    $cell=$sheet.Cells.Item([int]$row,[int]$column)
    if ($null -eq $tolValue -or [string]::IsNullOrWhiteSpace([string]$tolValue)) { Set-ComCellValue $cell ''; return }
    $parsed=Convert-MeasurementNumber $tolValue
    if ($null -eq $parsed) { Set-ComCellValue $cell ([string]$tolValue); return }
    $digits=([string]$tolValue).Trim().Replace(',','.').Split('.')
    $pattern=if($digits.Length -gt 1){'0.'+('0'*$digits[1].Length)}else{'0'}
    $cell.NumberFormat="+$pattern;-$pattern;0"
    Set-ComCellValue $cell ([double]$parsed)
}
function Format-AutoSampleDms([double]$value,[int]$precision=0) {
    $sign=if($value -lt 0){'-'}else{''}
    $total=[Math]::Round([Math]::Abs($value)*3600,$precision,[MidpointRounding]::AwayFromZero)
    $degrees=[Math]::Floor($total/3600)
    $minutes=[Math]::Floor(($total-$degrees*3600)/60)
    $seconds=$total-$degrees*3600-$minutes*60
    $pattern='00'+$(if($precision -gt 0){'.'+('0'*$precision)}else{''})
    $secondText=$seconds.ToString($pattern,[Globalization.CultureInfo]::InvariantCulture)
    return ('{0}{1}°{2:00}{3}{4}{5}' -f $sign,$degrees,$minutes,([string][char]0x2032),$secondText,([string][char]0x2033))
}
function Get-ExportMeasurementText($rowData,$absoluteSampleIndex,$variantSeed = '') {
    $n=Convert-MeasurementNumber $rowData.Nominal
    $a=Convert-MeasurementNumber $rowData.TolMinus
    $b=Convert-MeasurementNumber $rowData.TolPlus
    if ($null -eq $n -or $null -eq $a -or $null -eq $b) { return '' }
    $lo=$n+[Math]::Min($a,$b);$hi=$n+[Math]::Max($a,$b)
    $candidate=$n+(Get-ExportMeasurementOffset $rowData $absoluteSampleIndex $variantSeed)
    $candidate=[Math]::Max($lo,[Math]::Min($hi,$candidate))
    # Preserve DMS only when Nominal includes minutes/seconds. Degree-only
    # and linear Nominal generate plain decimals with three decimal places.
    $useDms=([string]$rowData.Nominal -match '[°º]') -and ([string]$rowData.Nominal -match '[''"′″]')
    $formatted=if($useDms){Format-AutoSampleDms $candidate}else{$candidate.ToString('0.000',[Globalization.CultureInfo]::InvariantCulture)}
    # Validate the final text after formatting, not just the unrounded candidate.
    if ((Get-MeasurementResult $rowData.Nominal $rowData.TolMinus $rowData.TolPlus $formatted) -eq 'OK') { return $formatted }
    $mid=($lo+$hi)/2
    $start=if($useDms){1}else{3}
    $end=if($useDms){9}else{12}
    for ($precision=$start;$precision -le $end;$precision++) {
        $format='0.'+('0'*$precision)
        $formatted=if($useDms){Format-AutoSampleDms $mid $precision}else{$mid.ToString($format,[Globalization.CultureInfo]::InvariantCulture)}
        if ((Get-MeasurementResult $rowData.Nominal $rowData.TolMinus $rowData.TolPlus $formatted) -eq 'OK') { return $formatted }
    }
    throw "Cannot represent generated sample within tolerance: step $($rowData.Step), sample $absoluteSampleIndex"
}
function Get-AutoFillResultForRow($rowIndex) {
    if($rowIndex -lt 0 -or $rowIndex -ge $table.Rows.Count){ return $null }
    $rowData=[pscustomobject]@{
        Step=Get-TableCellText $rowIndex 0
        Nominal=Get-TableCellText $rowIndex 1
        TolMinus=Get-TableCellText $rowIndex 2
        TolPlus=Get-TableCellText $rowIndex 3
    }
    return Get-ExportMeasurementText $rowData 1 'auto-fill'
}
function Set-ExcelCellSampleMeasurement($sheet,$row,$column,$value) {
    $cell=$sheet.Cells.Item([int]$row,[int]$column)
    if ([string]::IsNullOrWhiteSpace([string]$value)) { Set-ComCellValue $cell ''; return }
    $text=([string]$value).Trim()
    $numeric=0.0
    if ($text -match '^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$' -and [double]::TryParse($text,[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$numeric)) {
        $cell.NumberFormat='0.000'
        Set-ComCellValue $cell $numeric
    } else {
        # DMS/degree text is kept exactly as generated, never truncated to degrees.
        Set-ComCellValue $cell $text
    }
    $expected=Convert-MeasurementNumber $text
    if ($null -ne $expected) {
        $stored=Convert-MeasurementNumber ([string]$cell.Value2)
        if ($null -eq $stored -or [Math]::Abs($stored-$expected) -gt 0.000000000001) {
            throw "Excel changed the generated value at row $row, column $column"
        }
    }
}

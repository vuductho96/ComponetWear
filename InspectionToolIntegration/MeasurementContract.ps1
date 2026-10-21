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
    if ([string]$nominalText -match '[°º]' -and ([string]$nominalText -match '[''"′″]' -or ([string]::IsNullOrWhiteSpace($tolMinusText) -and [string]::IsNullOrWhiteSpace($tolPlusText)))) {
        if ($null -eq $n -or $null -eq $v) { return 'NG' }
        return $(if([Math]::Truncate($n) -eq [Math]::Truncate($v)){'OK'}else{'NG'})
    }
    if ($null -eq $n -or $null -eq $a -or $null -eq $b -or $null -eq $v) { return 'NG' }
    if ($v -lt ($n+[Math]::Min($a,$b)-0.0000001) -or $v -gt ($n+[Math]::Max($a,$b)+0.0000001)) { return 'NG' }
    return 'OK'
}
function Set-ExcelInspectionJudgeFormula($sheet,$row,$nominalText) {
    if (-not $script:MeasurementFormulaSpec) {
        $script:MeasurementFormulaSpec=Get-Content -LiteralPath (Join-Path $script:AppRoot 'MeasurementContract.formulas.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    # Original forms can merge S:AB for a drawing. Keep helpers outside that area.
    $columnName={param([int]$index) $name='';while($index -gt 0){$name=([string][char](65+(($index-1)%26)))+$name;$index=[Math]::Floor(($index-1)/26)};return $name}
    $helper=46
    while($true){
        $occupied=$false
        for($i=0;$i -lt 28;$i++){
            $cell=$sheet.Cells.Item([int]$row,($helper+$i))
            if($cell.MergeCells -or (-not $cell.HasFormula -and -not [string]::IsNullOrWhiteSpace([string]$cell.Value2))){$occupied=$true;break}
        }
        if(-not $occupied){break};$helper+=28
        if($helper -gt 16356){throw 'No free helper columns'}
    }
    $refs=@(0..27 | ForEach-Object {(& $columnName ($helper+$_))+[string]$row})
    for ($i=0;$i -lt 13;$i++) {
        $sheet.Cells.Item([int]$row,($helper+$i)).Formula='='+$script:MeasurementFormulaSpec.clean[$i].Replace('@ROW@',[string]$row)
        $old=(& $columnName (18+$i))+[string]$row
        $sheet.Cells.Item([int]$row,($helper+13+$i)).Formula='='+$script:MeasurementFormulaSpec.number[$i].Replace('@ROW@',[string]$row).Replace($old,$refs[$i])
    }
    $n=$refs[13];$a=$refs[14];$b=$refs[15];$lo=$refs[26];$hi=$refs[27];$actuals=$refs[16]+':'+$refs[25]
    $sheet.Cells.Item([int]$row,($helper+26)).Formula="=IF(COUNT(${n}:${b})=3,${n}+MIN(${a}:${b}),`"`" )"
    $sheet.Cells.Item([int]$row,($helper+27)).Formula="=IF(COUNT(${n}:${b})=3,${n}+MAX(${a}:${b}),`"`" )"
    $count="COLUMNS(F${row}:O${row})-COUNTBLANK(F${row}:O${row})"
    $empty='AND('+$refs[1]+'="",'+$refs[2]+'="")'
    $formula=$script:MeasurementFormulaSpec.result.Replace('@IS_ANGLE@',$(if([string]$nominalText -match '[°º]'){'TRUE'}else{'FALSE'})).Replace('@EMPTY_TOL@',$empty).Replace('@COUNT@',$count).Replace('@CLEAN@',$refs[0]).Replace('@N@',$n).Replace('@B@',$b).Replace('@ACTUALS@',$actuals).Replace('@LO@',$lo).Replace('@HI@',$hi)
    $sheet.Cells.Item([int]$row,16).Formula='='+$formula
    $first=& $columnName $helper;$last=& $columnName ($helper+27)
    $sheet.Range("${first}:${last}").EntireColumn.Hidden=$true
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
function Format-InspectionGeneratedSample($nominalText,$tolMinusText,$tolPlusText,[double]$candidate) {
    $n=Convert-MeasurementNumber $nominalText
    $a=Convert-MeasurementNumber $tolMinusText
    $b=Convert-MeasurementNumber $tolPlusText
    if ($null -eq $n -or $null -eq $a -or $null -eq $b) { return '' }
    $lo=$n+[Math]::Min($a,$b);$hi=$n+[Math]::Max($a,$b)
    # Preserve DMS only when Nominal includes minutes/seconds. Degree-only
    # and linear Nominal generate plain decimals with three decimal places.
    $isAngle=[string]$nominalText -match '[°º]'
    $useDms=$isAngle -and ([string]$nominalText -match '[''"′″]')
    $whole=[Math]::Floor([Math]::Abs($n))
    if ($useDms) {
        # Keep the original signed degree component; vary only minutes/seconds.
        if ($n -lt 0) {$lo=[Math]::Max($lo,-$whole-1+0.0000000001);$hi=[Math]::Min($hi,-$whole)}
        else {$lo=[Math]::Max($lo,$whole);$hi=[Math]::Min($hi,$whole+1-0.0000000001)}
        if ($lo -gt $hi) {throw 'Không có mẫu DMS trong dung sai mà vẫn giữ nguyên phần độ.'}
        $candidate=$n+[Math]::Sign($candidate-$n)*[Math]::Min([Math]::Abs($candidate-$n),1.0/3600)
    } elseif ($isAngle) {
        # Prefer Nominal itself whenever its signed tolerances permit it.
        $candidate=$n
    }
    $candidate=[Math]::Max($lo,[Math]::Min($hi,$candidate))
    $accept={param($text)
        $parsed=Convert-MeasurementNumber $text
        return (Get-MeasurementResult $nominalText $tolMinusText $tolPlusText $text) -eq 'OK' -and (-not $useDms -or ($null -ne $parsed -and [Math]::Floor([Math]::Abs($parsed)) -eq $whole))
    }
    $formatted=if($useDms){Format-AutoSampleDms $candidate}else{$candidate.ToString('0.000',[Globalization.CultureInfo]::InvariantCulture)}
    # Validate the final text after formatting, not just the unrounded candidate.
    if (& $accept $formatted) { return $formatted }
    $mid=($lo+$hi)/2
    $start=if($useDms){1}else{3}
    $end=if($useDms){9}else{12}
    for ($precision=$start;$precision -le $end;$precision++) {
        $format='0.'+('0'*$precision)
        $formatted=if($useDms){Format-AutoSampleDms $mid $precision}else{$mid.ToString($format,[Globalization.CultureInfo]::InvariantCulture)}
        if (& $accept $formatted) { return $formatted }
    }
    throw 'Không biểu diễn được mẫu trong dung sai với định dạng đang yêu cầu.'
}
function Get-ExportMeasurementText($rowData,$absoluteSampleIndex,$variantSeed = '') {
    $n=Convert-MeasurementNumber $rowData.Nominal
    if($null -eq $n){return ''}
    $candidate=$n+(Get-ExportMeasurementOffset $rowData $absoluteSampleIndex $variantSeed)
    return Format-InspectionGeneratedSample $rowData.Nominal $rowData.TolMinus $rowData.TolPlus $candidate
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

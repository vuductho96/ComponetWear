function Set-InspectionWorksheetJudge($ws,[int]$row) {
    if (-not $script:InspectionSaveFormulaSpec) {
        $script:InspectionSaveFormulaSpec=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'MeasurementContract.formulas.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    $columnName={param([int]$index) $name='';while($index -gt 0){$name=([string][char](65+(($index-1)%26)))+$name;$index=[Math]::Floor(($index-1)/26)};return $name}
    $helper=46
    while($true){
        $occupied=$false
        for($i=0;$i -lt 28;$i++){
            $cell=$ws.Cells[$row,($helper+$i)]
            if($ws.MergedCells[$row,($helper+$i)] -or (-not $cell.Formula -and $null -ne $cell.Value -and [string]$cell.Value -ne '')){$occupied=$true;break}
        }
        if(-not $occupied){break};$helper+=28
        if($helper -gt 16356){throw 'No free helper columns'}
    }
    $refs=@(0..27 | ForEach-Object {(& $columnName ($helper+$_))+[string]$row})
    for($i=0;$i -lt 13;$i++) {
        $ws.Cells[$row,($helper+$i)].Formula=$script:InspectionSaveFormulaSpec.clean[$i].Replace('@ROW@',[string]$row)
        $old=(& $columnName (18+$i))+[string]$row
        $ws.Cells[$row,($helper+13+$i)].Formula=$script:InspectionSaveFormulaSpec.number[$i].Replace('@ROW@',[string]$row).Replace($old,$refs[$i])
    }
    $n=$refs[13];$a=$refs[14];$b=$refs[15];$lo=$refs[26];$hi=$refs[27];$actuals=$refs[16]+':'+$refs[25]
    $ws.Cells[$row,($helper+26)].Formula="IF(COUNT(${n}:${b})=3,${n}+MIN(${a}:${b}),`"`" )"
    $ws.Cells[$row,($helper+27)].Formula="IF(COUNT(${n}:${b})=3,${n}+MAX(${a}:${b}),`"`" )"
    $count="COLUMNS(F${row}:O${row})-COUNTBLANK(F${row}:O${row})"
    $empty='AND('+$refs[1]+'="",'+$refs[2]+'="")'
    $ws.Cells[$row,16].Formula=$script:InspectionSaveFormulaSpec.result.Replace('@IS_ANGLE@',$(if([string]$ws.Cells[$row,2].Text -match '[°º]'){'TRUE'}else{'FALSE'})).Replace('@EMPTY_TOL@',$empty).Replace('@COUNT@',$count).Replace('@CLEAN@',$refs[0]).Replace('@N@',$n).Replace('@B@',$b).Replace('@ACTUALS@',$actuals).Replace('@LO@',$lo).Replace('@HI@',$hi)
    for($col=$helper;$col -lt $helper+28;$col++){$ws.Column($col).Hidden=$true}
}

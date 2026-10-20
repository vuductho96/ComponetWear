function Set-InspectionWorksheetJudge($ws,[int]$row) {
    if (-not $script:InspectionSaveFormulaSpec) {
        $script:InspectionSaveFormulaSpec=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'MeasurementContract.formulas.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    for($i=0;$i -lt 13;$i++) {
        $ws.Cells[$row,(18+$i)].Formula=$script:InspectionSaveFormulaSpec.clean[$i].Replace('@ROW@',[string]$row)
        $ws.Cells[$row,(31+$i)].Formula=$script:InspectionSaveFormulaSpec.number[$i].Replace('@ROW@',[string]$row)
    }
    $ws.Cells[$row,44].Formula="IF(COUNT(AE${row}:AG${row})=3,AE${row}+MIN(AF${row}:AG${row}),`"`")"
    $ws.Cells[$row,45].Formula="IF(COUNT(AE${row}:AG${row})=3,AE${row}+MAX(AF${row}:AG${row}),`"`")"
    $count="COLUMNS(F${row}:O${row})-COUNTBLANK(F${row}:O${row})"
    $ws.Cells[$row,16].Formula=$script:InspectionSaveFormulaSpec.result.Replace('@COUNT@',$count).Replace('@CLEAN@',"R$row").Replace('@N@',"AE$row").Replace('@B@',"AG$row").Replace('@ACTUALS@',"AH${row}:AQ${row}").Replace('@LO@',"AR$row").Replace('@HI@',"AS$row")
    for($col=18;$col -le 45;$col++){$ws.Column($col).Hidden=$true}
}

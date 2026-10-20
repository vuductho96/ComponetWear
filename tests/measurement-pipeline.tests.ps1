param([switch]$VerifyBrowser)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'ComponentLife/inspection_core.ps1')
. (Join-Path $root 'InspectionToolIntegration/MeasurementContract.ps1')
$script:AppRoot=Join-Path $root 'InspectionToolIntegration'
$dir=Join-Path $root '.cloud-publish/measurement-pipeline'
$null=New-Item -ItemType Directory -Path $dir -Force
$rapid='C:/Users/415/Desktop/RapidOcrProUpdateBundle/RapidOcrProUpdate.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($rapid,[ref]$null,[ref]$null)
foreach($name in @('Set-ComCellValue','Get-InspectionResultDecimalPlaces','Set-ExcelCellNominalValue','Get-ExportMeasurementOffset','Get-DeterministicMeasurementUnitValue','Test-AutoFillMeasurementSensitiveNominal','Get-InspectionDisplayDecimalPlaces','Format-InvariantSignedTolerance','Format-InspectionResultValueWithDecimals','Format-AngleDmsInspectionResultValue','Try-ParseAngleDmsText','Convert-MarkStepToleranceCellToDouble')) {
    $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    Invoke-Expression $fn.Extent.Text
}
$cases=@(
    @('1°','-0.1','0.1','1°','OK'),
    @('0°30''','-0.01','0.01','0°31''','NG'),
    @('1°30''0"','-0.01','0.01','1°30''18"','OK'),
    @('-0°30''','-0.01','0.01','-0°31''','NG'),
    @('R0.400','+0.01','+0.02','0.410','OK'),
    @('C0.400','-0.01','-0.02','0.385','OK'),
    @('Ø0.400','-0.01','-0.02','0.400','NG'),
    @('0.400','+0.02','+0.01','0.420','OK'),
    @('0.400','-0.02','-0.01','0.390','OK'),
    @('1','0','0','1.001','NG'),
    @('1','','','1','UNRATED'),
    @('0°92''24"','-0.1','0.1','1°','UNRATED'),
    @('28°4''21''','-0.01','0.01','28°4''21"','UNRATED'),
    @('1°','-0.1','0.1','broken','UNRATED'),
    @('1,25','-0.01','+0.01','1.250','OK'),
    @('0.2','-0.05','+0.05','0.220','OK')
)
$excel=$null;$book=$null
foreach($generatorCase in @(@('0.4','+0.0011','+0.0012'),@('0.4','-0.0012','-0.0011'),@('0°30''','+0.00001','+0.00002'),@('1°','+0.01','+0.02'),@('Ø0.4','0','0'),@('-0°30''','-0.0002','-0.0001'))) {
    $data=[pscustomobject]@{Step='GEN';Nominal=$generatorCase[0];TolMinus=$generatorCase[1];TolPlus=$generatorCase[2]}
    for($sample=1;$sample -le 100;$sample++){
        $text=Get-ExportMeasurementText $data $sample
        if ((Get-MeasurementResult $data.Nominal $data.TolMinus $data.TolPlus $text) -ne 'OK') {throw "Generated sample failed: $text"}
    }
    $cases+=,@($data.Nominal,$data.TolMinus,$data.TolPlus,(Get-ExportMeasurementText $data 1),'OK')
}
try {
    $excel=New-Object -ComObject Excel.Application
    $excel.Visible=$false;$excel.DisplayAlerts=$false
    if($VerifyBrowser){
        $book=$excel.Workbooks.Open((Join-Path $dir 'browser.xlsx'),0,$true)
        $excel.CalculateFullRebuild()
        for($i=0;$i -lt $cases.Count;$i++){
            $actual=[string]$book.Worksheets.Item(1).Cells.Item(20+$i,16).Value2
            if($actual -ne $cases[$i][4]){throw "Browser/native Excel case $i expected $($cases[$i][4]), got $actual"}
        }
        Write-Output 'PASS browser report formulas recalculated in native Excel for all cases.'
        if($book.Worksheets.Item(1).Range('C35').Text -ne '-0.05' -or $book.Worksheets.Item(1).Range('D35').Text -ne '+0.05' -or $book.Worksheets.Item(1).Range('F35').Text -ne '0.22'){throw 'Browser report added trailing zeroes'}
    } else {
        $book=$excel.Workbooks.Add();$sheet=$book.Worksheets.Item(1)
        $sheet.Cells.Item(13,1).Value2='Point';$sheet.Cells.Item(13,2).Value2='Nominal'
        $sheet.Range('C5').Value2='PIPELINE';$sheet.Range('G5').Value2='TEST';$sheet.Range('N6').Value2=20
        for($c=6;$c -le 15;$c++){$sheet.Cells.Item(13,$c).Value2=[double]($c+5)}
        for($i=0;$i -lt $cases.Count;$i++){
            $r=14+$i;$case=$cases[$i]
            $sheet.Cells.Item($r,1).Value2=[double]($i+1)
            Set-ExcelCellNominalValue $sheet $r 2 $case[0]
            Set-ExcelCellToleranceValue $sheet $r 3 $case[1]
            Set-ExcelCellToleranceValue $sheet $r 4 $case[2]
            Set-ExcelCellSampleMeasurement $sheet $r 6 $case[3]
            Set-ExcelInspectionJudgeFormula $sheet $r $case[0]
            $result=Get-MeasurementResult $case[0] $case[1] $case[2] $case[3]
            if($result -ne $case[4]){throw "Rapid UI case $i expected $($case[4]), got $result"}
        }
        $excel.CalculateFullRebuild()
        if($sheet.Range('C29').Text -ne '-0.05' -or $sheet.Range('D29').Text -ne '+0.05' -or $sheet.Range('F29').Text -ne '0.22'){throw 'Rapid export added trailing zeroes'}
        for($i=0;$i -lt $cases.Count;$i++){
            $actual=[string]$sheet.Cells.Item(14+$i,16).Value2
            if($actual -ne $cases[$i][4]){throw "Rapid Excel case $i expected $($cases[$i][4]), got $actual"}
        }
        $source=Join-Path $dir 'source.xlsx';$book.SaveAs($source,51)
        $book.Close($false);$book=$null
        Import-Module ImportExcel
        $pkg=Open-ExcelPackage -Path $source
        try {
            $dims=@(Extract-DimensionsFromWorksheet $pkg.Workbook.Worksheets[1] $source 'PIPELINE' 'TEST' '')
            if($dims.Count -ne $cases.Count){throw "Dropped source rows: $($dims.Count)"}
            for($i=0;$i -lt $cases.Count;$i++){
                if($dims[$i].Result -ne $cases[$i][4]){throw "Inspection case $i mismatch"}
                if($dims[$i].SampleNo -ne 11){throw 'Original sample label was lost'}
            }
            if($dims[0].Nominal -ne '1°' -or $dims[4].Nominal -ne 'R0.4'){throw 'Formatted degree/prefix was lost'}
        } finally {$pkg.Dispose()}
        [IO.File]::WriteAllText((Join-Path $dir 'expected.json'),($cases | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
        Write-Output "PASS 600 generated samples, plus $($cases.Count) saved cases: Rapid UI, Rapid native Excel export and Inspection extraction agree; sample 11 preserved."
    }
} finally {
    if($book){$book.Close($false)}
    if($excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)}
}

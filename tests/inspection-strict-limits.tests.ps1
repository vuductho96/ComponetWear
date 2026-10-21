param([Parameter(Mandatory=$true)][string]$ToolPath)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
. (Join-Path $project 'ComponentLife/inspection_core.ps1')
Import-Module ImportExcel
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($ToolPath,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Inspection Tool parse failed'}
$function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Extract-DimensionsFromWorksheet'},$true)
$webExtractor=${function:Extract-DimensionsFromWorksheet}
$pkg=New-Object OfficeOpenXml.ExcelPackage
try {
    $ws=$pkg.Workbook.Worksheets.Add('Inspection')
    $cases=@(
        @(1,0.005,0.002,1.001,'NG'),
        @(0.110,0.003,0.001,0.110,'NG'),
        @(0.400,-0.002,-0.005,0.400,'NG'),
        @(1,0.002,0.005,1.002,'OK'),
        @(1,0.002,0.005,1.005,'OK'),
        @(1,-0.001,0.001,1.0014,'NG'),
        @(0.5,0,0.001,0.501,'OK'),
        @(4.6,-0.001,0.001,4.599,'OK')
    )
    for($i=0;$i -lt $cases.Count;$i++){
        $r=14+$i;$case=$cases[$i]
        $ws.Cells[$r,1].Value=[string]($i+1)
        $ws.Cells[$r,2].Value=$case[0];$ws.Cells[$r,3].Value=$case[1]
        $ws.Cells[$r,4].Value=$case[2];$ws.Cells[$r,6].Value=$case[3]
        $ws.Cells[$r,3].Style.Numberformat.Format='0.00'
        $ws.Cells[$r,4].Style.Numberformat.Format='0.00'
        $ws.Cells[$r,6].Style.Numberformat.Format='0.00'
    }
    $web=@(& $webExtractor -ws $ws -path 'fixture.xlsx')
    Invoke-Expression $function.Extent.Text
    $app=@(Extract-DimensionsFromWorksheet -ws $ws -path 'fixture.xlsx')
    $stats=Extract-DimensionsFromWorksheet -ws $ws -path 'fixture.xlsx' -SummaryOnly
    if($stats.SampleCount -ne $app.Count -or $stats.NgCount -ne @($app | Where-Object Result -eq 'NG').Count){throw 'Fast summary skipped NG measurements'}
    $read=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Read-InspectionFile'},$true)
    $summary=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-InspectionWorkbookStats'},$true)
    if($read.Extent.Text -notmatch 'Get-InspectionWorkbookStats' -or -not $summary -or $summary.Extent.Text -notmatch '-SummaryOnly' -or $read.Extent.Text -match '\$script:DimensionCache\['){throw 'Scan still allocates full dimension data'}
    Write-Output 'PASS: fast scan counts every sample and NG without allocating the detailed table.'
    if($app.Count -ne $cases.Count){throw 'Missing measurements'}
    for($i=0;$i -lt $cases.Count;$i++){
        if($app[$i].Result -ne $cases[$i][4] -or $app[$i].Result -ne $web[$i].Result -or $app[$i].LowerLimit -ne $web[$i].LowerLimit -or $app[$i].UpperLimit -ne $web[$i].UpperLimit){throw "App/web disagreement at case $i"}
    }
    Write-Output 'PASS: app and web agree on signed tolerances, both limits, and measurements outside by less than 0.0005.'
    if($ast.Extent.Text -match '\$epsilon = 0\.0005001|\$effTolLow = -\$tolA|\$effT1 = -\$t1'){throw 'Legacy relaxed validation remains'}
    if($ast.Extent.Text -notmatch 'raw-cell-limits-v2|measurement-contract-v[3456789]'){throw 'Old scan cache not invalidated'}
    Write-Output 'PASS: inline editor uses strict limits and old scan cache is invalidated.'
}finally{$pkg.Dispose()}

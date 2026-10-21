$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
. (Join-Path $project 'ComponentLife/inspection_core.ps1')
$tool='C:/Users/415/Desktop/File đo linh kiện/InspectionTool.ps1'
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($tool,[ref]$null,[ref]$errors)
if($errors.Count){throw 'Installed app does not parse'}
foreach($name in @('Finalize-InspectionRecordForScan','Test-InspectionRecordForList')){
    $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    Invoke-Expression $fn.Extent.Text
}
function Get-TimeOverride {return $null}
function Get-DurationMinutes {return $null}
$script:SeenLot=@{}
$scan=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Scan'},$true)
$gate=$scan.Find({param($n)$n -is [Management.Automation.Language.IfStatementAst] -and $n.Clauses[0].Item1.Extent.Text -match '^Test-InspectionRecordForList'},$true)
if(-not $gate){throw 'Installed scan still hides additional sample files'}
$allDataList=[Collections.Generic.List[object]]::new()
foreach($folder in @('CAM','DONGNHUAN')){
    foreach($sample in @('11-14','1-10')){
        $d=[pscustomobject]@{Part='222';Mold='MF00307';File="Inspection 222-MF00307 Sample $sample.xlsx";Path="C:\fixture\LK MOI VE\$folder\$sample.xlsx";DateIn='12/03/2026';DateMeasure='12/03/2026';LotKey="222|MF00307|$folder";RawQty=14;Qty=0;TimeStart='';TimeEnd='';Note='';DurationMin=$null;MinPerPiece=$null}
        $d=Finalize-InspectionRecordForScan $d
        Invoke-Expression $gate.Extent.Text
    }
}
if($allDataList.Count -ne 4){throw 'Lost sample files or merged distinct folders'}
if(@($allDataList|Where-Object File -like '*1-10*').Count -ne 2){throw 'Sample 1-10 is missing'}
if(($allDataList|Measure-Object Qty -Sum).Sum -ne 28){throw 'Lot quantities counted more than once'}
if(@($allDataList|Where-Object Qty -eq 0).Count -ne 2){throw 'Additional sample files changed lot quantity handling'}
if(Test-InspectionRecordForList ([pscustomobject]@{Part='';Mold=''})){throw 'Non-inspection workbooks leaked into the list'}
$kpi=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Update-KpiChart'},$true)
if($kpi.Extent.Text -notmatch 'if \(\(Safe-Qty \$r.Cells\[6\].Value\) -le 0\) \{ continue \}') {throw 'KPI would double-count sample files as lots'}
$time=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Auto-FillMissingTimeOverrides'},$true)
if($time.Extent.Text -notmatch 'Where-Object \{ \(Safe-Qty \$_\.Qty\) -gt 0 \}') {throw 'Additional sample files would change automatic time allocation'}
Write-Output 'PASS: actual installed scan retains Sample 1-10 and 11-14 in both folders, including zero-quantity records; quantities and KPI lot counting stay deduplicated.'

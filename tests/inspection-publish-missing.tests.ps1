$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$file=Join-Path $project 'ComponentLife/export_inspection.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$null,[ref]$null)
$definition=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Select-InspectionPublishedDimensions'},$true)
. ([scriptblock]::Create($definition.Extent.Text))
$missing=@('20','DP0.003','-0.002','0.002',1,'',$null,$null,$null,'NG')
$whitespace=@('21','0.3','-0.01','0.01',1,'  ',$null,$null,$null,'NG')
$zero=@('22','0','-0.01','0.01',1,0,-0.01,0.01,0,'OK')
$actualNg=@('23','1','-0.01','0.01',1,1.2,0.99,1.01,0.2,'NG')
$invalid=@('24','90°','-0.5','0.5',1,'bad-angle',89.5,90.5,$null,'NG')
$before=@($missing,$whitespace,$zero,$actualNg,$invalid)|ConvertTo-Json -Compress
$published=@(Select-InspectionPublishedDimensions -Dimensions @($missing,$whitespace,$zero,$actualNg,$invalid))
if($published.Count -ne 3){throw 'Only missing results should be excluded.'}
if($published[0][5] -ne 0 -or $published[0][9] -ne 'OK'){throw 'Zero is a real result.'}
if($published[1][9] -ne 'NG' -or $published[2][9] -ne 'NG'){throw 'Actual NG and invalid measured values must remain NG.'}
if((@($missing,$whitespace,$zero,$actualNg,$invalid)|ConvertTo-Json -Compress) -cne $before){throw 'Desktop input diagnostics were mutated.'}
if(@(Select-InspectionPublishedDimensions -Dimensions @($missing,$whitespace)).Count -ne 0){throw 'All missing means no web measurements, not fabricated OK samples.'}
if(@(Select-InspectionPublishedDimensions -Dimensions @()).Count -ne 0){throw 'Pending empty records must remain empty.'}
Write-Output 'PASS: missing-result diagnostics stay desktop-only; zero and real measured NG are preserved; no input mutation.'

param([ValidateRange(1,256)][int]$Count=16)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
. (Join-Path $project 'ComponentLife/inspection_core.ps1')
. (Join-Path $project 'ComponentLife/inspection_read_pool.ps1')
Import-Module ImportExcel
$files=@(Get-ChildItem -LiteralPath 'C:/Users/415/Desktop/File đo linh kiện' -File -Recurse | Where-Object {Test-InspectionWorkbookFile $_} | Select-Object -First $Count)
$expected=@{};$watch=[Diagnostics.Stopwatch]::StartNew()
foreach($file in $files){
 $script:DimensionCache=@{};$record=Read-InspectionFile $file
 $key=Get-DimensionCacheKey $file.FullName
 $dims=@();if($script:DimensionCache.ContainsKey($key)){$dims=@($script:DimensionCache[$key]|ForEach-Object {,@($_.Point,$_.Nominal,$_.TolMinus,$_.TolPlus,$_.SampleNo,$(if($_.Value -match '[°ºRCØΦ⌀]' -or $null -eq $_.NumericValue){$_.Value}else{$_.NumericValue}),$_.LowerLimit,$_.UpperLimit,$_.Deviation,$_.Result)})}
 $expected[$file.FullName]=([pscustomobject]@{Record=$record;Dimensions=$dims}|ConvertTo-Json -Depth 8 -Compress)
}
$serial=$watch.Elapsed.TotalSeconds;$watch.Restart()
$pool=New-InspectionReadPool (Join-Path $project 'ComponentLife/inspection_core.ps1') 4
$jobs=@{}
try {
 foreach($file in $files){$jobs[$file.FullName]=Start-InspectionRead $pool $file}
 foreach($file in $files){
  $value=Receive-InspectionRead $jobs[$file.FullName];$jobs.Remove($file.FullName)
  $actual=[pscustomobject]@{Record=$value.Record;Dimensions=@($value.Dimensions)}|ConvertTo-Json -Depth 8 -Compress
  if($actual -cne $expected[$file.FullName]){throw ('Parallel reader disagrees: '+$file.Name)}
 }
 Write-Output ('PASS: '+$files.Count+' workbooks match metadata, sample values, tolerances, NG and DMS exactly.')
 Write-Output ('Reader benchmark: serial {0:N2}s, parallel including startup {1:N2}s' -f $serial,$watch.Elapsed.TotalSeconds)
}finally{Stop-InspectionReadJobs $jobs $pool}

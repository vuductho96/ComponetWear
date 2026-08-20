# Test script for calculate_engine.ps1
Set-Location $PSScriptRoot
. .\calculate_engine.ps1
Write-Host "calculate_engine.ps1 loaded OK" -ForegroundColor Green

$engineResult = Invoke-CalculationEngine
Write-Host "Component State count: $($engineResult.componentState.Count)"
Write-Host "Cycles count: $($engineResult.cycles.Count)"
Write-Host "Milestones: $($engineResult.milestones -join ', ')"
Write-Host "Success: $($engineResult.success)"
Write-Host "Message: $($engineResult.message)"

if ($engineResult.componentState.Count -gt 0) {
    $first = $engineResult.componentState[0]
    Write-Host "`nFirst component:"
    Write-Host "  Component: $($first.Component)"
    Write-Host "  Part: $($first.Part)"
    Write-Host "  CycleCount: $($first.CycleCount)"
    Write-Host "  AverageLife: $($first.AverageLife)"
    Write-Host "  MinLife: $($first.MinLife)"
    Write-Host "  MaxLife: $($first.MaxLife)"
    Write-Host "  MedianLife: $($first.MedianLife)"
    Write-Host "  CurrentLife: $($first.CurrentLife)"
    Write-Host "  Status: $($first.Status)"
    Write-Host "  ReplacementFrequency: $($first.ReplacementFrequency)"
}

Write-Host "`n--- Top 5 by TotalReplacements ---"
$top5 = $engineResult.componentState | Sort-Object -Property TotalReplacements -Descending | Select-Object -First 5
$top5 | ForEach-Object {
    Write-Host "  $($_.Part)/$($_.Series)/$($_.Mold) - $($_.TotalReplacements) replacements, Avg: $($_.AverageLife) shots"
}

$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form=New-Object System.Windows.Forms.Form
$form.Size=New-Object System.Drawing.Size(1420,200)
$table=New-Object System.Windows.Forms.DataGridView
$gridDimensions=New-Object System.Windows.Forms.DataGridView
$script:IsScanning=$false; $script:IsPersistingGridEdit=$false
$script:startCount=0; $script:InspectionPublishUiTestMode=$true
$timer=New-Object Windows.Forms.Timer;$timer.Start()
$btnFolder=New-Object Windows.Forms.Button
function Start-Process {
    param($FilePath,$ArgumentList,$WindowStyle,$WorkingDirectory,$RedirectStandardOutput,$RedirectStandardError,[switch]$PassThru)
    $script:startCount++
    if($WindowStyle -ne 'Hidden'){throw 'Publisher must be hidden'}
    return ([pscustomobject]@{HasExited=$false;ExitCode=0;Handle=123} | Add-Member -MemberType ScriptMethod -Name Dispose -Value {} -PassThru)
}
function Assert($condition,$message){if(-not $condition){throw $message};Write-Output "PASS: $message"}
$uiRoot=Join-Path $env:TEMP ('publish-ui-'+[Guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path (Join-Path $uiRoot '.cloud-publish') -Force
Set-Content -LiteralPath (Join-Path $uiRoot 'Publish-Inspection-Web.ps1') -Value '# mock publisher'
$status=Join-Path $env:TEMP ('publish-ui-'+[Guid]::NewGuid().ToString('N')+'.json')
try {
    $project=Split-Path $PSScriptRoot -Parent
    . (Join-Path $project 'InspectionToolIntegration/InspectionTool.WebPublish.ps1')
    $script:InspectionWebPublishProjectRoot=$uiRoot
    $script:InspectionWebPublishStatusFile=$status
    Assert ($script:InspectionWebPublishButton.Text -eq 'Publish lên web') 'Publish button has the correct label'
    Show-InspectionPublishDetails
    Assert ($script:InspectionPublishHealth.ForeColor -eq [Drawing.Color]::DimGray -and $script:startCount -eq 0) 'Opening idle details does not report a false error or start a publisher'
    & $script:InspectionWebPublishClick
    Assert ($null -ne $script:InspectionPublishView -and $script:InspectionPublishSteps.Items.Count -eq 6) 'Publish opens a dedicated view with six real processing stages'
    Assert (-not $timer.Enabled -and -not $btnFolder.Enabled) 'Publish yields the app background scan timer and folder scan control'
    Assert (-not $script:InspectionWebPublishButton.Enabled -and $script:startCount -eq 1) 'Click starts background publisher and disables duplicate clicks'
    & $script:InspectionWebPublishClick
    Assert ($script:startCount -eq 1) 'Second click cannot start a second publisher'
    [pscustomobject]@{startedAt=[DateTime]::UtcNow.ToString('o');status='running';message='Đang đọc dữ liệu'} | ConvertTo-Json | Set-Content -LiteralPath $status -Encoding UTF8
    & $script:InspectionWebPublishTick
    Assert ($script:InspectionWebPublishLabel.Text -eq 'Đang đọc dữ liệu') 'UI displays local publish progress'
    $old=[DateTime]::UtcNow.AddSeconds(-120).ToString('o')
    [pscustomobject]@{startedAt=[DateTime]::UtcNow.ToString('o');updatedAt=$old;status='running';stage='reading';message='Đang đọc dữ liệu';detail='Inspection: 100/1709'} | ConvertTo-Json | Set-Content -LiteralPath $status -Encoding UTF8
    & $script:InspectionWebPublishTick
    Assert ($script:InspectionPublishHealth.ForeColor -eq [Drawing.Color]::DarkOrange -and $script:InspectionPublishHealth.Text -match 'chưa thể kết luận lỗi') 'Quiet running stage is amber rather than a false failure'
    Assert ($script:InspectionPublishDetail.Text -eq 'Inspection: 100/1709') 'Real file counters appear in the detail view'
    Set-Content -LiteralPath (Join-Path $uiRoot '.cloud-publish/manual-inspection.log') -Value 'Inspection: 150/1709' -Encoding UTF8
    [pscustomobject]@{startedAt=[DateTime]::UtcNow.ToString('o');updatedAt=[DateTime]::UtcNow.ToString('o');status='running';stage='verifying';message='Đang xác minh cloud'} | ConvertTo-Json | Set-Content -LiteralPath $status -Encoding UTF8
    & $script:InspectionWebPublishTick
    Assert ($script:InspectionPublishSteps.Items[5].SubItems[1].Text -eq 'Đang chạy' -and $script:InspectionPublishBar.Value -eq 5) 'Deployment still waits for real verification before success'
    Assert ($script:InspectionPublishLogBox.Text -match 'Inspection: 150/1709') 'Live log output appears without cloud polling'
    $script:InspectionPublishView.Hide()
    Show-InspectionPublishDetails
    Assert ($script:startCount -eq 1) 'Reopening details never starts another publish'
    $script:InspectionWebPublishProcess.HasExited=$true
    [pscustomobject]@{startedAt=[DateTime]::UtcNow.ToString('o');status='success';timings=@(@{stage='reading';seconds=12.3});timingSummary='reading: 12.3s';message='Đã cập nhật thành công'} | ConvertTo-Json | Set-Content -LiteralPath $status -Encoding UTF8
    & $script:InspectionWebPublishTick
    Assert ($script:InspectionWebPublishButton.Enabled -and -not $script:InspectionWebPublishTimer.Enabled) 'Finished publish re-enables button and stops status polling'
    Assert ($script:InspectionPublishSteps.Items[0].SubItems[2].Text -match '12' -and $script:InspectionPublishDetail.Text -eq 'reading: 12.3s') 'Completion preserves measured stage durations'
    Assert ($timer.Enabled -and $btnFolder.Enabled) 'A finished publish restores the previously enabled background scanner'
    Assert ($script:InspectionWebPublishLabel.ForeColor -eq [Drawing.Color]::DarkGreen) 'Verified success appears in green'
    $timer.Stop()
    & $script:InspectionWebPublishClick
    $script:InspectionWebPublishProcess.HasExited=$true; $script:InspectionWebPublishProcess.ExitCode=1
    [pscustomobject]@{startedAt=[DateTime]::UtcNow.ToString('o');status='failed';stage='failed';failedStage='downloads';message='Lỗi kiểm tra cloud'} | ConvertTo-Json | Set-Content -LiteralPath $status -Encoding UTF8
    & $script:InspectionWebPublishTick
    Assert ($script:InspectionWebPublishLabel.Text -eq 'Lỗi kiểm tra cloud' -and $script:InspectionWebPublishLabel.ForeColor -eq [Drawing.Color]::DarkRed) 'Failure is shown clearly and can be retried'
    Assert ($script:InspectionPublishRetry.Enabled) 'A failed publish enables safe retry from the details window'
    Assert (-not $timer.Enabled) 'An intentionally disabled scanner stays disabled after publish failure'
    Assert ($script:InspectionPublishSteps.Items[1].SubItems[1].Text -eq 'Lỗi') 'Backend failure metadata identifies the exact failed step'
    Assert ($script:InspectionPublishHealth.ForeColor -eq [Drawing.Color]::DarkRed -and $script:InspectionPublishHealth.Text -match 'mã thoát 1') 'Failure details display the exit code in red'
    & $script:InspectionWebPublishClick
    Remove-Item -LiteralPath $status -Force
    $script:InspectionWebPublishProcess.HasExited=$true;$script:InspectionWebPublishProcess.ExitCode=0
    & $script:InspectionWebPublishTick
    Assert ($script:InspectionPublishHealth.ForeColor -eq [Drawing.Color]::DarkRed) 'Exit zero without a verified success state is never shown as successful'
    Assert (-not $form.IsDisposed) 'Publishing never closes the measurement app'
} finally {
    $script:InspectionWebPublishTimer.Dispose();$script:InspectionWebPublishTip.Dispose();if($script:InspectionPublishView){$script:InspectionPublishView.Dispose()}
    $form.Dispose();$table.Dispose();$gridDimensions.Dispose();$timer.Dispose();$btnFolder.Dispose()
    if(Test-Path -LiteralPath $status){Remove-Item -LiteralPath $status -Force}
    $resolved=[IO.Path]::GetFullPath($uiRoot)
    if(-not $resolved.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe fixture cleanup'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form=New-Object System.Windows.Forms.Form
$form.Size=New-Object System.Drawing.Size(1420,200)
$table=New-Object System.Windows.Forms.DataGridView
$gridDimensions=New-Object System.Windows.Forms.DataGridView
$script:IsScanning=$false; $script:IsPersistingGridEdit=$false
$script:startCount=0
function Start-Process {
    param($FilePath,$ArgumentList,$WindowStyle,$WorkingDirectory,$RedirectStandardOutput,$RedirectStandardError,[switch]$PassThru)
    $script:startCount++
    if($WindowStyle -ne 'Hidden'){throw 'Publisher must be hidden'}
    return ([pscustomobject]@{HasExited=$false;ExitCode=0;Handle=123} | Add-Member -MemberType ScriptMethod -Name Dispose -Value {} -PassThru)
}
function Assert($condition,$message){if(-not $condition){throw $message};Write-Output "PASS: $message"}
$status=Join-Path $env:TEMP ('publish-ui-'+[Guid]::NewGuid().ToString('N')+'.json')
try {
    $project=Split-Path $PSScriptRoot -Parent
    . (Join-Path $project 'InspectionToolIntegration/InspectionTool.WebPublish.ps1')
    $script:InspectionWebPublishProjectRoot=$project
    $script:InspectionWebPublishStatusFile=$status
    Assert ($script:InspectionWebPublishButton.Text -eq 'Publish lên web') 'Publish button has the correct label'
    & $script:InspectionWebPublishClick
    Assert (-not $script:InspectionWebPublishButton.Enabled -and $script:startCount -eq 1) 'Click starts background publisher and disables duplicate clicks'
    & $script:InspectionWebPublishClick
    Assert ($script:startCount -eq 1) 'Second click cannot start a second publisher'
    [pscustomobject]@{startedAt=[DateTime]::UtcNow.ToString('o');status='running';message='Đang đọc dữ liệu'} | ConvertTo-Json | Set-Content -LiteralPath $status -Encoding UTF8
    & $script:InspectionWebPublishTick
    Assert ($script:InspectionWebPublishLabel.Text -eq 'Đang đọc dữ liệu') 'UI displays local publish progress'
    $script:InspectionWebPublishProcess.HasExited=$true
    [pscustomobject]@{startedAt=[DateTime]::UtcNow.ToString('o');status='success';message='Đã cập nhật thành công'} | ConvertTo-Json | Set-Content -LiteralPath $status -Encoding UTF8
    & $script:InspectionWebPublishTick
    Assert ($script:InspectionWebPublishButton.Enabled -and -not $script:InspectionWebPublishTimer.Enabled) 'Finished publish re-enables button and stops status polling'
    Assert ($script:InspectionWebPublishLabel.ForeColor -eq [Drawing.Color]::DarkGreen) 'Verified success appears in green'
    & $script:InspectionWebPublishClick
    $script:InspectionWebPublishProcess.HasExited=$true; $script:InspectionWebPublishProcess.ExitCode=1
    [pscustomobject]@{startedAt=[DateTime]::UtcNow.ToString('o');status='failed';message='Lỗi kiểm tra cloud'} | ConvertTo-Json | Set-Content -LiteralPath $status -Encoding UTF8
    & $script:InspectionWebPublishTick
    Assert ($script:InspectionWebPublishLabel.Text -eq 'Lỗi kiểm tra cloud' -and $script:InspectionWebPublishLabel.ForeColor -eq [Drawing.Color]::DarkRed) 'Failure is shown clearly and can be retried'
    Assert (-not $form.IsDisposed) 'Publishing never closes the measurement app'
} finally {
    $script:InspectionWebPublishTimer.Dispose();$script:InspectionWebPublishTip.Dispose()
    $form.Dispose();$table.Dispose();$gridDimensions.Dispose()
    if(Test-Path -LiteralPath $status){Remove-Item -LiteralPath $status -Force}
}

# Loaded by InspectionTool.ps1 after its controls and save handlers are ready.
$script:InspectionWebPublishProcess = $null
$script:InspectionWebPublishStartedAt = [DateTime]::MinValue
. (Join-Path $PSScriptRoot 'InspectionTool.PublishDetails.ps1')
$configFile = Join-Path $PSScriptRoot 'InspectionWebPublish.config.json'
$script:InspectionWebPublishProjectRoot = ''
try {
    $config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json
    $script:InspectionWebPublishProjectRoot = [string]$config.projectRoot
} catch { }
$script:InspectionWebPublishStatusFile = if ($script:InspectionWebPublishProjectRoot) { Join-Path $script:InspectionWebPublishProjectRoot '.cloud-publish/manual-inspection-status.json' } else { '' }
$script:InspectionWebPublishButton = New-Object System.Windows.Forms.Button
$script:InspectionWebPublishButton.Name = 'btnPublishWeb'
$script:InspectionWebPublishButton.Text = 'Publish lên web'
$script:InspectionWebPublishButton.Location = New-Object System.Drawing.Point(730,44)
$script:InspectionWebPublishButton.Size = New-Object System.Drawing.Size(140,27)
$script:InspectionWebPublishButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$script:InspectionWebPublishButton.BackColor = [System.Drawing.Color]::FromArgb(232,241,255)
$script:InspectionWebPublishButton.ForeColor = [System.Drawing.Color]::FromArgb(25,70,140)
$form.Controls.Add($script:InspectionWebPublishButton)
$script:InspectionWebPublishLabel = New-Object System.Windows.Forms.Label
$script:InspectionWebPublishLabel.Name = 'lblPublishWeb'
$script:InspectionWebPublishLabel.Text = 'Cập nhật cloud khi cần, không phải đóng app.'
$script:InspectionWebPublishLabel.Location = New-Object System.Drawing.Point(965,49)
$script:InspectionWebPublishLabel.Size = New-Object System.Drawing.Size([Math]::Max(100,$form.ClientSize.Width-975),20)
$script:InspectionWebPublishLabel.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$script:InspectionWebPublishLabel.AutoEllipsis = $true
$script:InspectionWebPublishLabel.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($script:InspectionWebPublishLabel)
$script:InspectionWebPublishDetailsButton=New-Object Windows.Forms.Button
$script:InspectionWebPublishDetailsButton.Text='Chi tiết…'
$script:InspectionWebPublishDetailsButton.Location=New-Object Drawing.Point(880,44)
$script:InspectionWebPublishDetailsButton.Size=New-Object Drawing.Size(76,27)
$script:InspectionWebPublishDetailsButton.Add_Click({Show-InspectionPublishDetails})
$form.Controls.Add($script:InspectionWebPublishDetailsButton)
$script:InspectionWebPublishTip = New-Object System.Windows.Forms.ToolTip
$script:InspectionWebPublishTip.SetToolTip($script:InspectionWebPublishButton,'Lưu ô đang sửa, đọc lại nguồn đo đã cấu hình và cập nhật Cloudflare. Không đóng Inspection Tool.')
function Set-InspectionWebPublishLabel([string]$Text, [System.Drawing.Color]$Color) {
    $script:InspectionWebPublishLabel.Text = $Text
    $script:InspectionWebPublishLabel.ForeColor = $Color
    $script:InspectionWebPublishTip.SetToolTip($script:InspectionWebPublishLabel,$Text)
}
function Suspend-InspectionPublishAutoScan {
    $script:InspectionPublishScanTimer=$null
    $script:InspectionPublishScanWasEnabled=$false
    if($timer -is [Windows.Forms.Timer]){
        $script:InspectionPublishScanTimer=$timer
        $script:InspectionPublishScanWasEnabled=$timer.Enabled
        $timer.Stop()
    }
    $script:InspectionPublishFolderWasEnabled=$false
    if($btnFolder){$script:InspectionPublishFolderWasEnabled=$btnFolder.Enabled;$btnFolder.Enabled=$false}
}
function Resume-InspectionPublishAutoScan {
    if($script:InspectionPublishScanTimer -and $script:InspectionPublishScanWasEnabled){$script:InspectionPublishScanTimer.Start()}
    if($btnFolder -and $script:InspectionPublishFolderWasEnabled){$btnFolder.Enabled=$true}
    $script:InspectionPublishScanWasEnabled=$false
    $script:InspectionPublishFolderWasEnabled=$false
}
$script:InspectionWebPublishTimer = New-Object System.Windows.Forms.Timer
# Reads a local status file only while a manually requested publish is running; no cloud polling.
$script:InspectionWebPublishTimer.Interval = 750
$script:InspectionWebPublishTick = {
    $process = $script:InspectionWebPublishProcess
    if (-not $process) { $script:InspectionWebPublishTimer.Stop(); return }
    $state = $null
    try {
        $candidate = Get-Content -LiteralPath $script:InspectionWebPublishStatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $candidateStart=if($candidate.startedAt -is [DateTime]){$candidate.startedAt}else{[DateTime]::Parse($candidate.startedAt)}
        if ($candidateStart.ToUniversalTime() -ge $script:InspectionWebPublishStartedAt) { $state = $candidate }
    } catch { }
    if ($state) { Set-InspectionWebPublishLabel ([string]$state.message) ([System.Drawing.Color]::DarkSlateBlue) }
    if (-not $process.HasExited) { Update-InspectionPublishDetails $state $true; return }
    $code = $process.ExitCode
    $process.Dispose(); $script:InspectionWebPublishProcess = $null
    $script:InspectionWebPublishTimer.Stop()
    $script:InspectionWebPublishButton.Enabled = $true
    $script:InspectionWebPublishButton.Text = 'Publish lên web'
    Resume-InspectionPublishAutoScan
    if ($code -eq 0 -and $state.status -eq 'success') {
        Set-InspectionWebPublishLabel ([string]$state.message) ([System.Drawing.Color]::DarkGreen)
    } else {
        $message = if ($state.status -eq 'failed') { [string]$state.message } elseif ($code -eq 2) { 'Một phiên Publish đang chạy. Đợi hoàn tất rồi bấm lại.' } else { 'Publish chưa thành công. Xem .cloud-publish/manual-inspection-error.log rồi thử lại.' }
        Set-InspectionWebPublishLabel $message ([System.Drawing.Color]::DarkRed)
        if(-not $state -or $state.status -ne 'failed'){$state=[pscustomobject]@{status='failed';stage='failed';message=$message;updatedAt=[DateTime]::UtcNow.ToString('o')}}
    }
    Update-InspectionPublishDetails $state $false $code
}
$script:InspectionWebPublishTimer.Add_Tick($script:InspectionWebPublishTick)
$script:InspectionWebPublishClick = {
    if ($script:InspectionWebPublishProcess) { return }
    if ($script:IsScanning -or $script:IsPersistingGridEdit) { Set-InspectionWebPublishLabel 'App đang đọc/lưu dữ liệu. Đợi xong rồi bấm Publish.' ([System.Drawing.Color]::DarkOrange); return }
    try {
        if ($gridDimensions.IsCurrentCellInEditMode) { [void]$gridDimensions.EndEdit() }
        if (($table.IsCurrentCellDirty -or $table.IsCurrentCellInEditMode) -and -not (Commit-CurrentGridEdit)) { throw 'Chưa lưu được ô đang sửa. Lưu xong rồi Publish.' }
        $publisher = Join-Path $script:InspectionWebPublishProjectRoot 'Publish-Inspection-Web.ps1'
        if (-not (Test-Path -LiteralPath $publisher)) { throw 'Không tìm thấy bộ publish. Kiểm tra InspectionWebPublish.config.json.' }
        $work = Join-Path $script:InspectionWebPublishProjectRoot '.cloud-publish'
        $null = New-Item -ItemType Directory -Path $work -Force
        $script:InspectionWebPublishStartedAt = [DateTime]::UtcNow
        $script:InspectionPublishLastState=$null
        $script:InspectionPublishLastExitCode=0
        $script:InspectionPublishStage=''
        $script:InspectionPublishLastActivity=$script:InspectionWebPublishStartedAt
        $script:InspectionPublishLogText=''
        $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -ProjectRoot "{1}"' -f $publisher,$script:InspectionWebPublishProjectRoot
        Suspend-InspectionPublishAutoScan
        $script:InspectionWebPublishProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -WorkingDirectory $script:InspectionWebPublishProjectRoot -RedirectStandardOutput (Join-Path $work 'manual-inspection-output.log') -RedirectStandardError (Join-Path $work 'manual-inspection-error.log') -PassThru
        $null = $script:InspectionWebPublishProcess.Handle
        $script:InspectionWebPublishButton.Enabled = $false
        $script:InspectionWebPublishButton.Text = 'Đang publish…'
        Set-InspectionWebPublishLabel 'Đang chuẩn bị đọc dữ liệu…' ([System.Drawing.Color]::DarkSlateBlue)
        Show-InspectionPublishDetails
        $script:InspectionWebPublishTimer.Start()
    } catch {
        if(-not $script:InspectionWebPublishProcess){Resume-InspectionPublishAutoScan}
        Set-InspectionWebPublishLabel ([string]$_) ([System.Drawing.Color]::DarkRed)
        $script:InspectionPublishLastState=[pscustomobject]@{status='failed';stage='failed';message=[string]$_;updatedAt=[DateTime]::UtcNow.ToString('o')}
        $script:InspectionPublishLastExitCode=1
        Show-InspectionPublishDetails
    }
}
$script:InspectionWebPublishButton.Add_Click($script:InspectionWebPublishClick)
$form.Add_FormClosed({
    $script:InspectionWebPublishTimer.Stop(); $script:InspectionWebPublishTimer.Dispose()
    if ($script:InspectionWebPublishProcess) { $script:InspectionWebPublishProcess.Dispose() }
    $script:InspectionWebPublishTip.Dispose()
    $script:InspectionPublishAppClosing=$true
    if($script:InspectionPublishView){$script:InspectionPublishView.Dispose()}
})

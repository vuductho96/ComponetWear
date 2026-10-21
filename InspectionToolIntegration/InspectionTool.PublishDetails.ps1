# Local progress viewer. Closing this window never stops the publisher.
$script:InspectionPublishView=$null
$script:InspectionPublishLastState=$null
$script:InspectionPublishStage=''
$script:InspectionPublishStageAt=[DateTime]::UtcNow
$script:InspectionPublishLastActivity=[DateTime]::UtcNow
$script:InspectionPublishLogText=''
$script:InspectionPublishLastExitCode=0
$script:InspectionPublishLastActiveStage='reading'
$script:InspectionPublishFinishedAt=[DateTime]::MinValue
$script:InspectionPublishStageKeys=@('reading','downloads','checking','staging','publishing','verifying')
$script:InspectionPublishStageNames=@('Đọc kết quả đo và vị trí trên bản vẽ','Chuẩn bị Excel gốc, template và PDF','So sánh nội dung cần cập nhật','Chuẩn bị bộ tệp lên web','Tải nội dung thay đổi lên Cloudflare','Xác minh dữ liệu thực tế trên web')

function Read-InspectionPublishLogTail([string]$Path) {
    $stream=$null;$reader=$null
    try {
        if(-not (Test-Path -LiteralPath $Path)){return ''}
        $stream=[IO.File]::Open($Path,'Open','Read',([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        $offset=[Math]::Max(0,$stream.Length-49152)
        [void]$stream.Seek($offset,[IO.SeekOrigin]::Begin)
        $reader=New-Object IO.StreamReader($stream,[Text.Encoding]::UTF8,$true)
        if($offset -gt 0){[void]$reader.ReadLine()}
        return ($reader.ReadToEnd() -replace '\x1b\[[0-9;]*[A-Za-z]','')
    }catch{return ''}finally{if($reader){$reader.Dispose()}elseif($stream){$stream.Dispose()}}
}

function Update-InspectionPublishDetails($State,[bool]$Running,[int]$ExitCode=0) {
    if(-not $Running){$script:InspectionPublishLastExitCode=$ExitCode}
    if($State){$script:InspectionPublishLastState=$State}else{$State=$script:InspectionPublishLastState}
    $idle=(-not $State -and -not $Running -and $script:InspectionWebPublishStartedAt -eq [DateTime]::MinValue)
    $now=[DateTime]::UtcNow
    if($Running){$script:InspectionPublishFinishedAt=[DateTime]::MinValue}
    elseif(-not $idle -and $script:InspectionPublishFinishedAt -eq [DateTime]::MinValue){$script:InspectionPublishFinishedAt=$now}
    $stage=if($State){[string]$State.stage}else{'reading'}
    if($stage -eq 'waiting'){$stage='reading'}
    if($stage -in $script:InspectionPublishStageKeys){$script:InspectionPublishLastActiveStage=$stage}
    elseif($stage -eq 'failed'){$stage=if($State.failedStage -in $script:InspectionPublishStageKeys){[string]$State.failedStage}else{$script:InspectionPublishLastActiveStage}}
    if($stage -ne $script:InspectionPublishStage){$script:InspectionPublishStage=$stage;$script:InspectionPublishStageAt=$now}
    if($State -and $State.updatedAt){try{$script:InspectionPublishLastActivity=[DateTime]::Parse($State.updatedAt).ToUniversalTime()}catch{}}
    $work=Join-Path $script:InspectionWebPublishProjectRoot '.cloud-publish'
    $logs=@()
    foreach($name in @('manual-inspection.log','manual-inspection-error.log','publish.log')){
        $path=Join-Path $work $name
        if(-not (Test-Path -LiteralPath $path)){continue}
        $file=Get-Item -LiteralPath $path
        if($file.LastWriteTimeUtc -lt $script:InspectionWebPublishStartedAt){continue}
        if($file.LastWriteTimeUtc -gt $script:InspectionPublishLastActivity){$script:InspectionPublishLastActivity=$file.LastWriteTimeUtc}
        $tail=Read-InspectionPublishLogTail $path
        if($name -eq 'publish.log' -and $tail){
            $markers=[regex]::Matches($tail,'(?m)^\[[^\r\n]+\] Building snapshot')
            if($markers.Count){$tail=$tail.Substring($markers[$markers.Count-1].Index)}
        }
        if($tail){$logs+=('--- '+$name+" ---`r`n"+$tail)}
    }
    $logText=$logs -join "`r`n`r`n"
    $view=$script:InspectionPublishView
    if(-not $view -or $view.IsDisposed){return}
    $clockNow=if($script:InspectionPublishFinishedAt -eq [DateTime]::MinValue){$now}else{$script:InspectionPublishFinishedAt}
    $elapsed=if($script:InspectionWebPublishStartedAt -eq [DateTime]::MinValue){[TimeSpan]::Zero}else{$clockNow-$script:InspectionWebPublishStartedAt}
    $quiet=[Math]::Max(0,[int]($now-$script:InspectionPublishLastActivity).TotalSeconds)
    $phaseElapsed=$clockNow-$script:InspectionPublishStageAt
    $script:InspectionPublishClock.Text=('Tổng: {0:hh\:mm\:ss}   |   Bước hiện tại: {1:hh\:mm\:ss}   |   Cập nhật gần nhất: {2}s trước' -f $elapsed,$phaseElapsed,$quiet)
    $script:InspectionPublishHeading.Text=if($idle){'Chưa có lượt Publish trong phiên này'}elseif($State){[string]$State.message}else{'Đang khởi động bộ Publish…'}
    $script:InspectionPublishDetail.Text=if($State.timingSummary -and $State.status -in @('success','failed')){[string]$State.timingSummary}elseif($State -and $State.detail){[string]$State.detail}else{'Tiến trình và log sẽ tự cập nhật tại đây.'}
    $index=[Array]::IndexOf($script:InspectionPublishStageKeys,$stage)
    if($idle){$index=-1}
    $success=(-not $Running -and $ExitCode -eq 0 -and $State.status -eq 'success')
    $failed=(-not $idle) -and ((-not $Running -and -not $success) -or ($State.status -eq 'failed'))
    $script:InspectionPublishBar.Style=if($Running -and -not $failed){'Marquee'}else{'Continuous'}
    $script:InspectionPublishBar.MarqueeAnimationSpeed=30
    $script:InspectionPublishBar.Value=if($success){6}elseif($index -ge 0){$index}else{0}
    for($i=0;$i -lt 6;$i++){
        $item=$script:InspectionPublishSteps.Items[$i]
        $text='Chờ';$color=[Drawing.Color]::DimGray
        if($success){$text=if($State.stage -eq 'unchanged' -and $i -ge 3){'Không cần'}else{'Hoàn tất'};$color=[Drawing.Color]::DarkGreen}
        elseif($index -ge 0 -and $i -lt $index){$text='Hoàn tất';$color=[Drawing.Color]::DarkGreen}
        elseif($i -eq $index){$text=if($failed){'Lỗi'}else{'Đang chạy'};$color=if($failed){[Drawing.Color]::DarkRed}else{[Drawing.Color]::RoyalBlue}}
        $item.SubItems[1].Text=$text;$item.ForeColor=$color
        $timing=@($State.timings | Where-Object {$_.stage -eq $script:InspectionPublishStageKeys[$i]} | Select-Object -Last 1)
        $item.SubItems[2].Text=if($timing.Count){'{0:N1}s' -f $timing[0].seconds}elseif($Running -and $i -eq $index){'{0:N0}s' -f $phaseElapsed.TotalSeconds}else{'—'}
    }
    $script:InspectionPublishRetry.Enabled=$failed -and -not $Running
    if($idle){
        $script:InspectionPublishHealth.Text='Nhấn Publish lên web để bắt đầu. Cửa sổ này chỉ hiển thị tiến trình và nhật ký.'
        $script:InspectionPublishHealth.ForeColor=[Drawing.Color]::DimGray
    }elseif($failed){
        $script:InspectionPublishHealth.Text="PUBLISH CHƯA THÀNH CÔNG (mã thoát $ExitCode). Xem lý do và log bên dưới."
        $script:InspectionPublishHealth.ForeColor=[Drawing.Color]::DarkRed
        $script:InspectionPublishHeading.ForeColor=[Drawing.Color]::DarkRed
    }elseif($success){
        $script:InspectionPublishHealth.Text=if($State.stage -eq 'unchanged'){'Web đã là bản mới nhất; không phát sinh lần deploy mới.'}else{'THÀNH CÔNG — đã xác minh dữ liệu trên web.'}
        $script:InspectionPublishHealth.ForeColor=[Drawing.Color]::DarkGreen
        $script:InspectionPublishHeading.ForeColor=[Drawing.Color]::DarkGreen
    }elseif($quiet -ge 90){
        $script:InspectionPublishHealth.Text="Đã $quiet giây chưa có thông tin mới. Tiến trình vẫn còn chạy; chưa thể kết luận lỗi. Có thể đang xử lý file lớn."
        $script:InspectionPublishHealth.ForeColor=[Drawing.Color]::DarkOrange
    }else{
        $script:InspectionPublishHealth.Text='ĐANG CHẠY — tiếp tục chờ. Đóng cửa sổ này vẫn tiếp tục Publish.'
        $script:InspectionPublishHealth.ForeColor=[Drawing.Color]::DarkSlateBlue
        $script:InspectionPublishHeading.ForeColor=[Drawing.Color]::DarkSlateBlue
    }
    if($logText -cne $script:InspectionPublishLogText){
        $script:InspectionPublishLogText=$logText
        $script:InspectionPublishLogBox.Text=$logText
        $script:InspectionPublishLogBox.SelectionStart=$script:InspectionPublishLogBox.TextLength
        $script:InspectionPublishLogBox.ScrollToCaret()
    }
}

function Show-InspectionPublishDetails {
    if(-not $script:InspectionPublishView -or $script:InspectionPublishView.IsDisposed){
        $view=New-Object Windows.Forms.Form
        $view.Text='Publish lên web — Tiến trình và nhật ký'
        $view.Size=New-Object Drawing.Size(920,720);$view.MinimumSize=New-Object Drawing.Size(820,650)
        $view.StartPosition='CenterParent';$view.Font=New-Object Drawing.Font('Segoe UI',9)
        $view.BackColor=[Drawing.Color]::White
        $layout=New-Object Windows.Forms.TableLayoutPanel
        $layout.Dock='Fill';$layout.Padding=New-Object Windows.Forms.Padding(16);$layout.ColumnCount=1;$layout.RowCount=8
        foreach($height in @(34,26,40,22,178,34)){[void]$layout.RowStyles.Add((New-Object Windows.Forms.RowStyle('Absolute',$height)))}
        [void]$layout.RowStyles.Add((New-Object Windows.Forms.RowStyle('Percent',100)))
        [void]$layout.RowStyles.Add((New-Object Windows.Forms.RowStyle('Absolute',42)))
        $view.Controls.Add($layout)
        $script:InspectionPublishHeading=New-Object Windows.Forms.Label
        $script:InspectionPublishHeading.Font=New-Object Drawing.Font('Segoe UI',11,[Drawing.FontStyle]::Bold)
        $script:InspectionPublishClock=New-Object Windows.Forms.Label
        $script:InspectionPublishHealth=New-Object Windows.Forms.Label
        $script:InspectionPublishBar=New-Object Windows.Forms.ProgressBar
        $script:InspectionPublishBar.Maximum=6;$script:InspectionPublishBar.Style='Continuous'
        $script:InspectionPublishSteps=New-Object Windows.Forms.ListView
        $script:InspectionPublishSteps.View='Details';$script:InspectionPublishSteps.HeaderStyle='Nonclickable';$script:InspectionPublishSteps.FullRowSelect=$true
        [void]$script:InspectionPublishSteps.Columns.Add('Bước xử lý',500)
        [void]$script:InspectionPublishSteps.Columns.Add('Trạng thái',150)
        [void]$script:InspectionPublishSteps.Columns.Add('Thời gian',100)
        foreach($name in $script:InspectionPublishStageNames){$item=New-Object Windows.Forms.ListViewItem($name);[void]$item.SubItems.Add('Chờ');[void]$item.SubItems.Add('—');[void]$script:InspectionPublishSteps.Items.Add($item)}
        $script:InspectionPublishDetail=New-Object Windows.Forms.Label
        $script:InspectionPublishDetail.AutoEllipsis=$true
        $script:InspectionPublishLogBox=New-Object Windows.Forms.TextBox
        $script:InspectionPublishLogBox.Multiline=$true;$script:InspectionPublishLogBox.ScrollBars='Both';$script:InspectionPublishLogBox.MaxLength=180000
        $script:InspectionPublishLogBox.ReadOnly=$true;$script:InspectionPublishLogBox.WordWrap=$false
        $script:InspectionPublishLogBox.Font=New-Object Drawing.Font('Consolas',9)
        $script:InspectionPublishLogBox.BackColor=[Drawing.Color]::FromArgb(245,247,250)
        $controls=@($script:InspectionPublishHeading,$script:InspectionPublishClock,$script:InspectionPublishHealth,$script:InspectionPublishBar,$script:InspectionPublishSteps,$script:InspectionPublishDetail,$script:InspectionPublishLogBox)
        for($i=0;$i -lt $controls.Count;$i++){$controls[$i].Dock='Fill';$layout.Controls.Add($controls[$i],0,$i)}
        $buttons=New-Object Windows.Forms.FlowLayoutPanel;$buttons.Dock='Fill';$layout.Controls.Add($buttons,0,7)
        foreach($text in @('Mở thư mục log','Sao chép log','Thử lại Publish','Ẩn cửa sổ')){
            $button=New-Object Windows.Forms.Button;$button.Text=$text;$button.AutoSize=$true;$button.Height=30
            switch($text){
                'Mở thư mục log' {$button.Add_Click({Start-Process -FilePath 'explorer.exe' -ArgumentList ('"'+(Join-Path $script:InspectionWebPublishProjectRoot '.cloud-publish')+'"')})}
                'Sao chép log' {$button.Add_Click({try{[Windows.Forms.Clipboard]::SetText($script:InspectionPublishHeading.Text+"`r`n"+$script:InspectionPublishLogBox.Text)}catch{}})}
                'Thử lại Publish' {$script:InspectionPublishRetry=$button;$button.Enabled=$false;$button.Add_Click({& $script:InspectionWebPublishClick})}
                'Ẩn cửa sổ' {$button.Add_Click({$script:InspectionPublishView.Hide()})}
            }
            $buttons.Controls.Add($button)
        }
        $view.Add_FormClosing({param($sender,$eventArgs) if(-not $script:InspectionPublishAppClosing){$eventArgs.Cancel=$true;$sender.Hide()}})
        $script:InspectionPublishView=$view
    }
    if(-not $script:InspectionPublishUiTestMode){
        if(-not $script:InspectionPublishView.Visible){$script:InspectionPublishView.Show($form)}
        $script:InspectionPublishView.Activate()
    }
    Update-InspectionPublishDetails $script:InspectionPublishLastState ([bool]$script:InspectionWebPublishProcess) $script:InspectionPublishLastExitCode
}

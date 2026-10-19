# Fill visible NG actual values in one workbook save.
$saveModule = Join-Path $PSScriptRoot 'InspectionTool.DimensionSave.ps1'
if (Test-Path -LiteralPath $saveModule) { . $saveModule }

function New-InspectionTestRows([int]$Seed = -1) {
    $random = if ($Seed -ge 0) { New-Object Random($Seed) } else { New-Object Random }
    $items = [Collections.Generic.List[object]]::new()
    foreach ($row in $gridDimensions.Rows) {
        if ($row.IsNewRow -or -not $row.Visible) { continue }
        $nominal = Convert-MeasureTextToNumber ([string]$row.Cells[1].Value)
        $minus = Convert-MeasureTextToNumber ([string]$row.Cells[2].Value)
        $plus = Convert-MeasureTextToNumber ([string]$row.Cells[3].Value)
        $value = ''; $result = 'TEST · Thiếu dung sai'; $lower = $null; $upper = $null
        if ($null -ne $nominal -and $null -ne $minus -and $null -ne $plus) {
            if ($minus -gt 0 -and -not ([string]$row.Cells[2].Value).Trim().StartsWith('+')) { $minus = -$minus }
            $lower = [Math]::Min($nominal+$minus,$nominal+$plus)
            $upper = [Math]::Max($nominal+$minus,$nominal+$plus)
            $digits = 3
            foreach ($column in @(1,2,3)) {
                $text = ([string]$row.Cells[$column].Value).Replace(',','.')
                if ($text -match '\.(\d+)') { $digits = [Math]::Max($digits,[Math]::Min(8,$matches[1].Length)) }
            }
            $scale = [Math]::Pow(10,$digits)
            $first = [Math]::Ceiling([Math]::Round($lower*$scale,6))
            $last = [Math]::Floor([Math]::Round($upper*$scale,6))
            if ($first -le $last -and [Math]::Abs($first) -lt 9e15 -and [Math]::Abs($last) -lt 9e15) {
                $sample = $first + [Math]::Floor($random.NextDouble()*($last-$first+1))
                $number = [Math]::Min($last,$sample)/$scale
                $value = $number.ToString(('F'+$digits),[Globalization.CultureInfo]::InvariantCulture)
                $result = 'TEST · Trong giới hạn'
            }
        }
        $items.Add([pscustomobject]@{ RowIndex=$row.Index; Point=[string]$row.Cells[0].Value; Sample=[string]$row.Cells[5].Value; Nominal=[string]$row.Cells[1].Value; TolMinus=[string]$row.Cells[2].Value; TolPlus=[string]$row.Cells[3].Value; Lower=$lower; Upper=$upper; Actual=$value; Result=$result; IsTest=$true })
    }
    return $items.ToArray()
}

function Invoke-InspectionQuickFill {
    param([int]$Seed = -1)
    $path=$script:PreviewCurrentPath
    $key=Get-DimensionCacheKey $path
    if (-not $key -or -not $script:DimensionCache.ContainsKey($key)) { throw 'Không có dữ liệu Excel đang xem.' }
    $original=@($script:DimensionCache[$key])
    $changes=@(New-InspectionTestRows -Seed $Seed | Where-Object {
        $_.Actual -ne '' -and [string]$gridDimensions.Rows[$_.RowIndex].Cells[8].Value -eq 'NG'
    })
    if (-not $changes.Count) { return 0 }
    $updated=@($original | ForEach-Object { $_.PSObject.Copy() })
    $applied=[Collections.Generic.List[object]]::new()
    foreach ($item in $changes) {
        $row=$gridDimensions.Rows[$item.RowIndex]; $index=-1
        for ($i=0; $i -lt $original.Count; $i++) {
            if ([object]::ReferenceEquals($original[$i],$row.Tag)) { $index=$i; break }
        }
        if ($index -lt 0) { throw 'Dòng xem nhanh không khớp với Excel. Hãy chọn lại file.' }
        $dim=$updated[$index]
        if ([int]$dim.ExcelRow -le 0 -or [int]$dim.ExcelCol -le 0) { throw 'Không xác định được ô Actual trong Excel.' }
        $value=[double]::Parse($item.Actual,[Globalization.CultureInfo]::InvariantCulture)
        $nominal=Convert-MeasureTextToNumber $item.Nominal
        $dim.Value=$item.Actual; $dim.NumericValue=$value
        $dim.LowerLimit=$item.Lower; $dim.UpperLimit=$item.Upper
        $dim.Deviation=[Math]::Round($value-$nominal,8); $dim.AbsDeviation=[Math]::Abs($dim.Deviation)
        $dim.Result='OK'; $dim.IsModified=$true
        $applied.Add([pscustomobject]@{Row=$row;Dimension=$dim})
    }
    $folder=Join-Path (Split-Path -Parent $path) '.inspection-backups'
    [void][IO.Directory]::CreateDirectory($folder)
    $backup=Join-Path $folder (([IO.Path]::GetFileName($path))+'.'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'.'+[Guid]::NewGuid().ToString('N')+'.bak')
    Copy-Item -LiteralPath $path -Destination $backup -ErrorAction Stop
    $script:DimensionCache[$key]=$updated
    $previousActualOnly=$script:InspectionQuickEditActualOnly
    $script:InspectionQuickEditActualOnly=$true
    try {
        if (-not (Save-DimensionsToWorkbook -path $path)) { throw 'Chưa lưu được Excel. Các giá trị trong bảng được giữ nguyên.' }
    } catch {
        $script:DimensionCache[$key]=$original
        throw
    } finally { $script:InspectionQuickEditActualOnly=$previousActualOnly }
    foreach ($change in $applied) {
        $row=$change.Row; $dim=$change.Dimension
        $row.Tag=$dim; $row.Cells[6].Value=$dim.Value; $row.Cells[7].Value=$dim.Deviation; $row.Cells[8].Value='OK'
        $row.Cells[6].Style.ForeColor=[Drawing.Color]::Black; $row.Cells[7].Style.ForeColor=[Drawing.Color]::Black
        $row.Cells[8].Style.ForeColor=[Drawing.Color]::DarkGreen
        $row.Cells[8].Style.BackColor=[Drawing.Color]::FromArgb(215,248,215)
    }
    foreach ($row in $gridDimensions.Rows) {
        for ($i=0; $i -lt $original.Count; $i++) {
            if ([object]::ReferenceEquals($row.Tag,$original[$i])) { $row.Tag=$updated[$i]; break }
        }
    }
    return $applied.Count
}

$script:InspectionQuickEditButton=New-Object System.Windows.Forms.Button
$script:InspectionQuickEditButton.Name='btnPreviewQuickEdit';$script:InspectionQuickEditButton.Text='Sửa nhanh'
$script:InspectionQuickEditButton.Size=New-Object Drawing.Size(95,28)
$script:InspectionQuickEditButton.BackColor=[Drawing.Color]::FromArgb(255,245,220)
$script:InspectionQuickFillTooltip=New-Object Windows.Forms.ToolTip
$script:InspectionQuickFillTooltip.AutoPopDelay=30000
$script:InspectionQuickEditButton.Enabled=$false;$grpPreview.Controls.Add($script:InspectionQuickEditButton)
$gridDimensions.Add_SelectionChanged({$script:InspectionQuickEditButton.Enabled=$gridDimensions.Rows.Count -gt 0})
$script:InspectionQuickEditLayout={
    $left=[Math]::Max(10,$grpPreview.ClientSize.Width-420)
    $script:InspectionQuickEditButton.Location=New-Object Drawing.Point($left,18)
    $btnPreviewAll.Location=New-Object Drawing.Point(($left+100),18)
    $btnPreviewNg.Location=New-Object Drawing.Point(($left+200),18)
    $btnPreviewOpen.Location=New-Object Drawing.Point(($left+315),18)
    $lblPreviewTitle.Width=[Math]::Max(100,$left-22);$lblPreviewStats.Width=[Math]::Max(100,$left-22)
}
$grpPreview.Add_SizeChanged($script:InspectionQuickEditLayout);& $script:InspectionQuickEditLayout
$script:InspectionQuickEditButton.Add_Click({
    if(-not $gridDimensions.Rows.Count){return}
    if(-not $gridDimensions.EndEdit()){return}
    $script:InspectionQuickEditButton.Enabled=$false
    try {
        $count=Invoke-InspectionQuickFill
        if ($count -gt 0) {
            Show-SelectedRowDimensions
            $lblStatus.Text="Đã đọc lại Excel và xác nhận lưu $count mẫu: $script:PreviewCurrentPath"
            $script:InspectionQuickFillTooltip.SetToolTip($lblStatus,$script:PreviewCurrentPath)
            $script:InspectionQuickFillTooltip.SetToolTip($btnPreviewOpen,$script:PreviewCurrentPath)
        } else { $lblStatus.Text='Không có mẫu NG đủ dung sai trong các dòng đang hiển thị.' }
    } catch {
        [void][Windows.Forms.MessageBox]::Show($form,$_.Exception.Message,'Sửa nhanh','OK','Warning')
    } finally { $script:InspectionQuickEditButton.Enabled=$gridDimensions.Rows.Count -gt 0 }
})

# Simulation-only auto fill for the rows currently visible in measurement preview.
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
        $items.Add([pscustomobject]@{ Point=[string]$row.Cells[0].Value; Sample=[string]$row.Cells[5].Value; Nominal=[string]$row.Cells[1].Value; TolMinus=[string]$row.Cells[2].Value; TolPlus=[string]$row.Cells[3].Value; Lower=$lower; Upper=$upper; Actual=$value; Result=$result; IsTest=$true })
    }
    return $items.ToArray()
}

function Set-InspectionTestPreview($Dialog) {
    $data = @(New-InspectionTestRows)
    $Dialog.Tag.Rows = $data
    $Dialog.Tag.Grid.Rows.Clear()
    foreach ($item in $data) { [void]$Dialog.Tag.Grid.Rows.Add($item.Point,$item.Sample,$item.Nominal,$item.TolMinus,$item.TolPlus,$item.Actual,$item.Result) }
    $Dialog.Tag.Summary.Text = "DỮ LIỆU TEST · $($data.Count) mẫu từ các dòng đang hiển thị"
}

function New-InspectionQuickEditDialog {
    $dialog=New-Object System.Windows.Forms.Form
    $dialog.Text='Auto fill kết quả — DỮ LIỆU TEST'
    $dialog.ClientSize=New-Object System.Drawing.Size(900,510)
    $dialog.StartPosition=[System.Windows.Forms.FormStartPosition]::CenterParent
    $dialog.MinimumSize=New-Object System.Drawing.Size(720,420)
    $dialog.Font=New-Object System.Drawing.Font('Segoe UI',9)
    $summary=New-Object System.Windows.Forms.Label
    $summary.SetBounds(16,15,850,24)
    $summary.Font=New-Object System.Drawing.Font('Segoe UI',10,[Drawing.FontStyle]::Bold)
    $summary.ForeColor=[Drawing.Color]::FromArgb(150,88,0)
    $dialog.Controls.Add($summary)
    $hint=New-Object System.Windows.Forms.Label
    $hint.SetBounds(16,43,850,28)
    $hint.Text='Giá trị mô phỏng theo Nominal và dung sai · Xem trước / xuất CSV riêng cho mục đích test.'
    $dialog.Controls.Add($hint)
    $preview=New-Object System.Windows.Forms.DataGridView
    $preview.Name='testPreview';$preview.SetBounds(16,78,868,365)
    $preview.Anchor=[Windows.Forms.AnchorStyles]'Top,Bottom,Left,Right'
    $preview.AllowUserToAddRows=$false;$preview.AllowUserToDeleteRows=$false;$preview.ReadOnly=$true
    $preview.RowHeadersVisible=$false;$preview.AutoSizeColumnsMode='Fill';$preview.BackgroundColor=[Drawing.Color]::White
    $preview.ColumnCount=7
    $names=@('Point','Sample','Nominal','Tol (-)','Tol (+)','Actual (TEST)','Kết quả mẫu')
    for($i=0;$i -lt $names.Count;$i++){$preview.Columns[$i].Name=$names[$i]}
    $preview.Columns[6].FillWeight=160
    $dialog.Controls.Add($preview)
    $again=New-Object System.Windows.Forms.Button
    $again.Name='testRegenerate';$again.Text='Tạo lại';$again.SetBounds(16,460,100,32)
    $again.Anchor=[Windows.Forms.AnchorStyles]'Bottom,Left';$dialog.Controls.Add($again)
    $export=New-Object System.Windows.Forms.Button
    $export.Name='testExport';$export.Text='Xuất CSV TEST';$export.SetBounds(634,460,130,32)
    $export.Anchor=[Windows.Forms.AnchorStyles]'Bottom,Right';$dialog.Controls.Add($export)
    $close=New-Object System.Windows.Forms.Button
    $close.Text='Đóng';$close.SetBounds(774,460,110,32)
    $close.Anchor=[Windows.Forms.AnchorStyles]'Bottom,Right';$close.DialogResult='Cancel';$dialog.Controls.Add($close)
    $dialog.CancelButton=$close
    $dialog.Tag=[pscustomobject]@{Rows=@();Grid=$preview;Summary=$summary}
    $again.Add_Click({Set-InspectionTestPreview $this.FindForm()})
    $export.Add_Click({
        $owner=$this.FindForm()
        $picker=New-Object System.Windows.Forms.SaveFileDialog
        $picker.Filter='CSV TEST (*.csv)|*.csv';$picker.FileName='TEST-Autofill-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.csv'
        try {
            if($picker.ShowDialog($owner) -eq [Windows.Forms.DialogResult]::OK){
                $owner.Tag.Rows | Select-Object IsTest,Point,Sample,Nominal,TolMinus,TolPlus,Lower,Upper,Actual,Result | Export-Csv -LiteralPath $picker.FileName -NoTypeInformation -Encoding UTF8
                $owner.Tag.Summary.Text='Đã xuất CSV TEST · Excel gốc giữ nguyên'
            }
        } finally {$picker.Dispose()}
    })
    Set-InspectionTestPreview $dialog
    return $dialog
}

$script:InspectionQuickEditButton=New-Object System.Windows.Forms.Button
$script:InspectionQuickEditButton.Name='btnPreviewQuickEdit';$script:InspectionQuickEditButton.Text='Sửa nhanh'
$script:InspectionQuickEditButton.Size=New-Object Drawing.Size(95,28)
$script:InspectionQuickEditButton.BackColor=[Drawing.Color]::FromArgb(255,245,220)
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
    $dialog=New-InspectionQuickEditDialog
    try{[void]$dialog.ShowDialog($form)}finally{$dialog.Dispose()}
})

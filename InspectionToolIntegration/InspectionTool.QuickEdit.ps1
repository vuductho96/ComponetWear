$saveModule = Join-Path $PSScriptRoot 'InspectionTool.DimensionSave.ps1'
if (Test-Path -LiteralPath $saveModule) { . $saveModule }
# Loaded after the preview grid and its existing CellEndEdit save handler.
function Save-InspectionQuickValue([int]$RowIndex, [string]$Value) {
    if (-not $gridDimensions.EndEdit()) { return $false }
    $gridDimensions.CurrentCell = $gridDimensions.Rows[$RowIndex].Cells[6]
    $script:InspectionQuickEditSaveSucceeded = $false
    $script:InspectionQuickEditActualOnly = $true
    try {
        if (-not $gridDimensions.BeginEdit($true)) { return $false }
        $gridDimensions.EditingControl.Text = $Value
        if (-not $gridDimensions.EndEdit()) { return $false }
        return [bool]$script:InspectionQuickEditSaveSucceeded
    } finally { $script:InspectionQuickEditActualOnly = $false }
}

function New-InspectionQuickEditDialog([int]$RowIndex) {
    $row = $gridDimensions.Rows[$RowIndex]
    $dialog = New-Object System.Windows.Forms.Form
    $dialog.Text = 'Sửa nhanh kết quả đo'
    $dialog.ClientSize = New-Object System.Drawing.Size(420,260)
    $dialog.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $dialog.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterParent
    $dialog.MaximizeBox = $false; $dialog.MinimizeBox = $false
    $dialog.Font = New-Object System.Drawing.Font('Segoe UI',10)
    $summary = New-Object System.Windows.Forms.Label
    $summary.SetBounds(20,16,380,52)
    $summary.Text = "Point $($row.Cells[0].Value)  |  Mẫu $($row.Cells[5].Value)`r`nNominal: $($row.Cells[1].Value)  |  Giới hạn: $($row.Cells[4].Value)"
    $dialog.Controls.Add($summary)
    $label = New-Object System.Windows.Forms.Label
    $label.SetBounds(20,82,150,24); $label.Text = 'Giá trị đo thực tế'
    $dialog.Controls.Add($label)
    $valueBox = New-Object System.Windows.Forms.TextBox
    $valueBox.Name = 'quickActual'; $valueBox.SetBounds(185,78,215,32)
    $valueBox.Font = New-Object System.Drawing.Font('Segoe UI',13)
    $valueBox.Text = [string]$row.Cells[6].Value
    $dialog.Controls.Add($valueBox)
    $errorLabel = New-Object System.Windows.Forms.Label
    $errorLabel.Name = 'quickError'; $errorLabel.SetBounds(20,124,380,38)
    $errorLabel.ForeColor = [System.Drawing.Color]::Firebrick
    $dialog.Controls.Add($errorLabel)
    $hint = New-Object System.Windows.Forms.Label
    $hint.SetBounds(20,166,380,32); $hint.Text = 'Lưu vào Excel gốc và tính lại OK / NG cho mẫu đang chọn.'
    $hint.Font = New-Object System.Drawing.Font('Segoe UI',9)
    $hint.ForeColor = [System.Drawing.Color]::DimGray; $dialog.Controls.Add($hint)
    $save = New-Object System.Windows.Forms.Button
    $save.Name = 'quickSave'; $save.Text = 'Lưu kết quả'; $save.SetBounds(175,210,110,32)
    $save.BackColor = [System.Drawing.Color]::FromArgb(232,241,255)
    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Name = 'quickCancel'; $cancel.Text = 'Hủy'; $cancel.SetBounds(295,210,105,32)
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $dialog.Controls.AddRange(@($save,$cancel)); $dialog.AcceptButton = $save; $dialog.CancelButton = $cancel
    $dialog.Tag = [pscustomobject]@{ RowIndex=$RowIndex; ValueBox=$valueBox; ErrorLabel=$errorLabel }
    $save.Add_Click({
        $owner = $this.FindForm(); $state = $owner.Tag
        $value = $state.ValueBox.Text.Trim()
        $number = 0.0
        if ($value -notmatch '^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$' -or -not [double]::TryParse($value.Replace(',','.'),[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$number) -or [double]::IsInfinity($number)) {
            $state.ErrorLabel.Text = 'Nhập số hợp lệ, ví dụ 17.69 hoặc 17,69.'
            $state.ValueBox.Focus(); return
        }
        if (Save-InspectionQuickValue -RowIndex $state.RowIndex -Value $value) {
            $owner.DialogResult = [System.Windows.Forms.DialogResult]::OK; $owner.Close()
        } else { $state.ErrorLabel.Text = 'Chưa lưu được vào Excel. Kiểm tra file đang mở rồi thử lại.' }
    })
    $dialog.Add_Shown({ $this.Tag.ValueBox.Focus(); $this.Tag.ValueBox.SelectAll() })
    return $dialog
}

$script:InspectionQuickEditButton = New-Object System.Windows.Forms.Button
$script:InspectionQuickEditButton.Name = 'btnPreviewQuickEdit'
$script:InspectionQuickEditButton.Text = 'Sửa nhanh'
$script:InspectionQuickEditButton.Size = New-Object System.Drawing.Size(95,28)
$script:InspectionQuickEditButton.BackColor = [System.Drawing.Color]::FromArgb(232,241,255)
$script:InspectionQuickEditButton.Enabled = $false
$grpPreview.Controls.Add($script:InspectionQuickEditButton)
$gridDimensions.Add_SelectionChanged({ $script:InspectionQuickEditButton.Enabled = $null -ne $gridDimensions.CurrentRow })
$script:InspectionQuickEditLayout = {
    $left = [Math]::Max(10,$grpPreview.ClientSize.Width-420)
    $script:InspectionQuickEditButton.Location = New-Object System.Drawing.Point($left,18)
    $btnPreviewAll.Location = New-Object System.Drawing.Point(($left+100),18)
    $btnPreviewNg.Location = New-Object System.Drawing.Point(($left+200),18)
    $btnPreviewOpen.Location = New-Object System.Drawing.Point(($left+315),18)
    $lblPreviewTitle.Width = [Math]::Max(100,$left-22)
    $lblPreviewStats.Width = [Math]::Max(100,$left-22)
}
$grpPreview.Add_SizeChanged($script:InspectionQuickEditLayout)
& $script:InspectionQuickEditLayout
$script:InspectionQuickEditButton.Add_Click({
    if ($null -eq $gridDimensions.CurrentRow) { return }
    if (-not $gridDimensions.EndEdit()) { return }
    $dialog = New-InspectionQuickEditDialog -RowIndex $gridDimensions.CurrentRow.Index
    try { [void]$dialog.ShowDialog($form) } finally { $dialog.Dispose() }
})

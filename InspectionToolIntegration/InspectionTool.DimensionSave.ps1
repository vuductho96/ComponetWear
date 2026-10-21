function Resolve-InspectionDimensionSheet($Package,$Dimension) {
    if($Dimension.SheetName){
        $sheet=$Package.Workbook.Worksheets[[string]$Dimension.SheetName]
        if(-not $sheet){throw ('Không tìm thấy sheet: '+$Dimension.SheetName)}
        return $sheet
    }
    if($Package.Workbook.Worksheets.Count -ne 1){throw 'Dữ liệu xem nhanh thiếu tên sheet. Hãy chọn lại file trước khi lưu.'}
    return Get-FirstUsedWorksheet -pkg $Package
}

function Save-DimensionsToWorkbook {

    param([string]$path)
    . (Join-Path $PSScriptRoot 'InspectionTool.Judge.ps1')

    # ImportExcel writes non-terminating errors by default; never report those as success.
    $ErrorActionPreference = 'Stop'



    if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path)) { return $false }

    $script:InspectionQuickEditSaveSucceeded = $false
    $cKey = Get-DimensionCacheKey $path

    if (-not $cKey -or -not $script:DimensionCache.ContainsKey($cKey)) { return $false }



    $dims = @($script:DimensionCache[$cKey])

    $modifiedDims = @($dims | Where-Object { $_.IsModified -eq $true })

    if ($modifiedDims.Count -eq 0) { $script:InspectionQuickEditSaveSucceeded = $true; return $true }



    $pkg = $null

    try {

        $pkg = Open-ExcelPackage -Path $path

        $ws = Get-FirstUsedWorksheet -pkg $pkg

        if (-not $ws) { throw "Không đọc được worksheet trong file Excel." }

        foreach ($m in $modifiedDims) {
            $ws=Resolve-InspectionDimensionSheet $pkg $m

            $r = [int]$m.ExcelRow

            $c = [int]$m.ExcelCol

            if ($r -gt 0 -and $c -gt 0) {

                if ([string]$m.Value -match '[°º]') {
                    $ws.Cells[$r, $c].Value = [string]$m.Value
                    $ws.Cells[$r, $c].Style.Numberformat.Format = 'General'
                } elseif ($null -ne $m.NumericValue) {

                    $ws.Cells[$r, $c].Value = [double]$m.NumericValue
                    $ws.Cells[$r, $c].Style.Numberformat.Format = '0.000'

                } else {

                    $ws.Cells[$r, $c].Value = $m.Value

                }

            }

            if ($r -gt 0 -and -not $script:InspectionQuickEditActualOnly) {

                if (-not [string]::IsNullOrWhiteSpace((Safe-Text $m.Nominal))) {

                    $numNom = Convert-MeasureTextToNumber $m.Nominal

                    $ws.Cells[$r, 2].Value = if ($null -ne $numNom) { [double]$numNom } else { $m.Nominal }

                }

                if (-not [string]::IsNullOrWhiteSpace((Safe-Text $m.TolMinus))) {

                    $numTolM = Convert-MeasureTextToNumber $m.TolMinus

                    $ws.Cells[$r, 3].Value = if ($null -ne $numTolM) { [double]$numTolM } else { $m.TolMinus }

                }

                if (-not [string]::IsNullOrWhiteSpace((Safe-Text $m.TolPlus))) {

                    $numTolP = Convert-MeasureTextToNumber $m.TolPlus

                    $ws.Cells[$r, 4].Value = if ($null -ne $numTolP) { [double]$numTolP } else { $m.TolPlus }

                }

            }

            # Keep pending edits until the workbook save succeeds.
            Set-InspectionWorksheetJudge $ws $r

        }



        $pkg.Workbook.CalcMode=[OfficeOpenXml.ExcelCalcMode]::Automatic
        $pkg.Workbook.FullCalcOnLoad=$true
        Close-ExcelPackage $pkg

        $pkg = $null

        # Verify persisted cells using a new package, independently of the preview/cache.
        $verifyPackage = Open-ExcelPackage -Path $path -ErrorAction Stop
        try {
            foreach ($m in $modifiedDims) {
                $verifySheet=Resolve-InspectionDimensionSheet $verifyPackage $m
                $saved = $verifySheet.Cells[[int]$m.ExcelRow, [int]$m.ExcelCol].Value
                if ([string]$m.Value -match '[°º]' -and [string]$saved -cne [string]$m.Value) {throw 'Excel chưa giữ nguyên dạng DMS của Actual.'}
                if ($null -ne $m.NumericValue) {
                    $number = Convert-MeasureTextToNumber $saved
                    if ($null -eq $number -or [Math]::Abs($number - [double]$m.NumericValue) -gt 0.000000001) {
                        throw "Excel chưa lưu đúng ô Actual tại dòng $($m.ExcelRow), cột $($m.ExcelCol)."
                    }
                } elseif ([string]$saved -cne [string]$m.Value) {
                    throw "Excel chưa lưu đúng ô Actual tại dòng $($m.ExcelRow), cột $($m.ExcelCol)."
                }
                $savedRow=[int]$m.ExcelRow
                $verifiedResult=Get-MeasurementResult (Get-InspectionCellText $verifySheet.Cells[$savedRow,2]) (Get-InspectionCellText $verifySheet.Cells[$savedRow,3]) (Get-InspectionCellText $verifySheet.Cells[$savedRow,4]) (Get-InspectionCellText $verifySheet.Cells[$savedRow,[int]$m.ExcelCol])
                if ($m.Result -eq 'OK' -and $verifiedResult -ne 'OK') {throw 'Đọc lại Excel: Actual không nằm trong dung sai.'}
            }
        } finally { if ($verifyPackage) { $verifyPackage.Dispose() } }



        foreach ($m in $modifiedDims) { $m.IsModified = $false }
        $newKey = Get-DimensionCacheKey $path
        if ($newKey -and $newKey -ne $cKey) {
            $script:DimensionCache[$newKey] = $dims
            $script:DimensionCache.Remove($cKey)
        }

        Save-DimensionCache

        $script:InspectionQuickEditSaveSucceeded = $true; return $true

    }

    catch {

        if ($pkg) { try { Close-ExcelPackage $pkg -NoSave } catch { } }

        $errMsg = $_.Exception.Message
        $script:InspectionQuickEditSaveError=$errMsg
        if($script:InspectionQuickEditTestMode){throw}

        if ($errMsg -match "being used by another process|cannot access the file|đang được sử dụng") {

            $errMsg = "File đang được mở bởi Microsoft Excel.`nVui lòng đóng file Excel để ứng dụng tự động cập nhật.`n`nChi tiết: $errMsg"

        }

        [void][System.Windows.Forms.MessageBox]::Show(

            "Tự động lưu vào Excel thất bại:`n$errMsg",

            "Cảnh Báo Lưu Excel",

            [System.Windows.Forms.MessageBoxButtons]::OK,

            [System.Windows.Forms.MessageBoxIcon]::Warning

        )

        return $false

    }

}



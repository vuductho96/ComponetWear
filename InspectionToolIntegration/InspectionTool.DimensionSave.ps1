function Save-DimensionsToWorkbook {

    param([string]$path)



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

            $r = [int]$m.ExcelRow

            $c = [int]$m.ExcelCol

            if ($r -gt 0 -and $c -gt 0) {

                if ($null -ne $m.NumericValue) {

                    $ws.Cells[$r, $c].Value = [double]$m.NumericValue

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

        }



        Close-ExcelPackage $pkg

        $pkg = $null



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



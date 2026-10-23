function Get-InspectionWorkbookStats($Package,[string]$Path,[string]$Part,[string]$Mold,[string]$DateMeasure) {
    $samples=0;$ng=0;$unrated=0
    foreach($sheet in $Package.Workbook.Worksheets){
        if(-not $sheet.Dimension){continue}
        $stats=Extract-DimensionsFromWorksheet -ws $sheet -path $Path -part $Part -mold $Mold -dateMeasure $DateMeasure -SummaryOnly
        $samples+=$stats.SampleCount;$ng+=$stats.NgCount;$unrated+=$stats.UnratedCount
    }
    foreach($sheet in $Package.Workbook.Worksheets){
        $ng+=@(Get-InspectionMissingSteps $sheet $Path $Part $Mold $DateMeasure ($samples -gt 0)).Count
    }
    return [pscustomobject]@{SampleCount=$samples;NgCount=$ng;UnratedCount=$unrated}
}

function Get-InspectionMissingSteps($Sheet,[string]$Path,[string]$Part,[string]$Mold,[string]$DateMeasure,[bool]$HasMeasurements){
    if(-not $Sheet -or -not $Sheet.Dimension){return @()}
    $header=0
    for($h=1;$h -le [Math]::Min(60,$Sheet.Dimension.End.Row);$h++){
        if($Sheet.Cells[$h,1].Text -match '(?i)point' -and $Sheet.Cells[$h,2].Text -match '(?i)nominal'){$header=$h;break}
    }
    if(-not $header -or $Sheet.Dimension.End.Row -le $header){return @()}
    $columns=@();$judgement=16
    for($c=6;$c -le [Math]::Min(100,$Sheet.Dimension.End.Column);$c++){
        $label=(Get-InspectionCellText $Sheet.Cells[$header,$c]) -replace '^#',''
        if($label -match '^\d+$'){$columns+=,$c}
        elseif(-not [string]::IsNullOrWhiteSpace($label)){break}
    }
    if(-not $columns.Count){$columns=@(6..15)}
    # Later sample batches can intentionally contain only repeated/important steps.
    $baseBatch=@($columns|Where-Object {((Get-InspectionCellText $Sheet.Cells[$header,$_]) -replace '^#','') -eq '1'}).Count -gt 0
    if(-not $baseBatch){$baseBatch=[string]::IsNullOrWhiteSpace((Get-InspectionCellText $Sheet.Cells[$header,$columns[0]]))}
    for($c=6;$c -le [Math]::Min(100,$Sheet.Dimension.End.Column);$c++){
        if($Sheet.Cells[$header,$c].Text -match '(?i)remark|result|judg|ghi ch[uú]|k[eế]t qu[aả]'){$judgement=$c;break}
    }
    foreach($pointCell in $Sheet.Cells[($header+1),1,$Sheet.Dimension.End.Row,1]){
        $r=$pointCell.Start.Row
        $point=Safe-Text $Sheet.Cells[$r,1].Text
        if($point -notmatch '^\d+'){continue}
        $nominal=Get-InspectionCellText $Sheet.Cells[$r,2]
        $filled=@($columns|Where-Object {-not [string]::IsNullOrWhiteSpace((Get-InspectionCellText $Sheet.Cells[$r,$_]))})
        # Existing detail extraction already validates rows with a Nominal and Actual.
        if($filled.Count -and -not [string]::IsNullOrWhiteSpace($nominal)){continue}
        $formulaError=Get-InspectionCellText $Sheet.Cells[$r,$judgement]
        if($formulaError -notmatch '^#(?:VALUE!|REF!|DIV/0!|N/A|NAME\?|NUM!|NULL!|SPILL!|CALC!)$'){$formulaError=''}
        $reasons=@()
        if($null -eq (Convert-MeasureTextToNumber $nominal)){
            $reasons+= $(if([string]::IsNullOrWhiteSpace($nominal)){'Thiếu Nominal'}else{'Nominal chưa hỗ trợ/không hợp lệ: '+$nominal})
        }
        $tolMinus=Get-InspectionCellText $Sheet.Cells[$r,3];$tolPlus=Get-InspectionCellText $Sheet.Cells[$r,4]
        $degreeComparison=$nominal -match '[°º]' -and ($nominal -match '[''"′″ʹʺ]' -or ([string]::IsNullOrWhiteSpace($tolMinus) -and [string]::IsNullOrWhiteSpace($tolPlus)))
        if(-not $degreeComparison -and ($null -eq (Convert-MeasureTextToNumber $tolMinus) -or $null -eq (Convert-MeasureTextToNumber $tolPlus))){$reasons+='Thiếu dung sai hoặc dung sai không hợp lệ'}
        if($formulaError){$reasons+=('Lỗi công thức Excel: '+$formulaError)}
        if(-not $filled.Count -and (($HasMeasurements -and $baseBatch) -or $reasons.Count)){$reasons+='Thiếu kết quả đo: Actual trống toàn bộ step'}
        if(-not $reasons.Count){continue}
        $column=if($filled.Count){$filled[0]}else{$columns[0]}
        $sample=(Get-InspectionCellText $Sheet.Cells[$header,$column]) -replace '^#',''
        [pscustomobject]@{
            File=[IO.Path]::GetFileName($Path);Part=$Part;Mold=$Mold;DateMeasure=$DateMeasure
            Point=$point;Nominal=$nominal;TolMinus=(Get-InspectionCellText $Sheet.Cells[$r,3]);TolPlus=(Get-InspectionCellText $Sheet.Cells[$r,4])
            SampleNo=$(if($sample -match '^\d+$'){[int]$sample}else{1})
            Value=(Get-InspectionCellText $Sheet.Cells[$r,$column]);NumericValue=$null;LowerLimit=$null;UpperLimit=$null
            Deviation=$null;AbsDeviation=$null;NearestMargin=$null;Result='NG';Path=$Path;FormulaError=$formulaError
            ValidationError=($reasons -join '; ');IsMissingMeasurement=(-not $filled.Count)
            ExcelRow=$r;ExcelCol=$column;SheetName=$Sheet.Name;IsModified=$false
        }
    }
}

function Test-InspectionRecordForList($Record) {
    return $null -ne $Record -and -not [string]::IsNullOrWhiteSpace([string]$Record.Part) -and -not [string]::IsNullOrWhiteSpace([string]$Record.Mold)
}

function Get-ItemQuality($item){
    if($null -eq $item){return ''}
    $quality=Safe-Text $item.Quality
    if($quality -match '^NG'){return $quality}
    if($item.Status -ne 'ĐÃ ĐO'){return ''}
    return $quality
}

function Get-DimensionsFromWorkbook {
    param([string]$path)
    if([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path)){return @()}
    $cacheKey=Get-DimensionCacheKey $path
    if($cacheKey -and $script:DimensionCache.ContainsKey($cacheKey)){return @($script:DimensionCache[$cacheKey])}
    $package=$null
    try {
        $package=Open-ExcelPackage -Path $path -ErrorAction Stop
        $first=Get-FirstUsedWorksheet -pkg $package
        if(-not $first){return @()}
        $part=Safe-Text $first.Cells['C5'].Value;$mold=Safe-Text $first.Cells['G5'].Value
        $date=Normalize-MeasureDate $first.Cells['N4'].Value
        $rows=[Collections.Generic.List[object]]::new()
        foreach($sheet in $package.Workbook.Worksheets){
            if(-not $sheet.Dimension){continue}
            foreach($dimension in @(Extract-DimensionsFromWorksheet -ws $sheet -path $path -part $part -mold $mold -dateMeasure $date)){$dimension | Add-Member -NotePropertyName SheetName -NotePropertyValue $sheet.Name -Force;$rows.Add($dimension)}
        }
        $hasMeasurements=$rows.Count -gt 0
        foreach($sheet in $package.Workbook.Worksheets){
            foreach($missing in @(Get-InspectionMissingSteps $sheet $path $part $mold $date $hasMeasurements)){$rows.Add($missing)}
        }
        $result=@(foreach($sheet in $package.Workbook.Worksheets){$rows | Where-Object SheetName -eq $sheet.Name | Sort-Object ExcelRow,ExcelCol})
    }finally{if($package){$package.Dispose()}}
    if($cacheKey){$script:DimensionCache[$cacheKey]=$result;Save-DimensionCache}
    return $result
}

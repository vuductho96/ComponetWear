function Get-InspectionWorkbookStats($Package,[string]$Path,[string]$Part,[string]$Mold,[string]$DateMeasure) {
    $samples=0;$ng=0;$unrated=0
    foreach($sheet in $Package.Workbook.Worksheets){
        if(-not $sheet.Dimension){continue}
        $stats=Extract-DimensionsFromWorksheet -ws $sheet -path $Path -part $Part -mold $Mold -dateMeasure $DateMeasure -SummaryOnly
        $samples+=$stats.SampleCount;$ng+=$stats.NgCount;$unrated+=$stats.UnratedCount
    }
    return [pscustomobject]@{SampleCount=$samples;NgCount=$ng;UnratedCount=$unrated}
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
        $result=@($rows.ToArray())
    }finally{if($package){$package.Dispose()}}
    if($cacheKey){$script:DimensionCache[$cacheKey]=$result;Save-DimensionCache}
    return $result
}

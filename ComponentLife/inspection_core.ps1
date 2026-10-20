# Read-only inspection rules extracted from InspectionTool.ps1. No GUI, KPI, time tracking or workbook writes.
function Safe-Text {
    param([object]$v)
    if ($null -eq $v) { return "" }
    return [string]$v.ToString().Trim()
}

function Safe-Qty {
    param([object]$v)
    $s = Safe-Text $v
    if ([string]::IsNullOrWhiteSpace($s)) { return 0 }
    $clean = $s -replace '[^\d\-]', ''
    if ([string]::IsNullOrWhiteSpace($clean)) { return 0 }

    $n = 0
    if ([int]::TryParse($clean, [ref]$n)) {
        return $n
    }
    return 0
}

function Normalize-MeasureDate {
    param([object]$v)

    if ($null -eq $v) { return "" }

    if ($v -is [datetime]) {
        return $v.ToString("dd/MM/yyyy")
    }

    if ($v -is [double] -or $v -is [int]) {
        try {
            return [datetime]::FromOADate([double]$v).ToString("dd/MM/yyyy")
        }
        catch {
            return ""
        }
    }

    $s = Safe-Text $v
    if ([string]::IsNullOrWhiteSpace($s)) { return "" }

    $dt = [datetime]::MinValue
    if ([datetime]::TryParse($s, [ref]$dt)) {
        return $dt.ToString("dd/MM/yyyy")
    }

    return $s
}

function Get-TimeMapKey {
    param([string]$path)
    $p = Safe-Text $path
    if ([string]::IsNullOrWhiteSpace($p)) { return "" }
    try {
        $full = [System.IO.Path]::GetFullPath($p)
        return $full.Normalize([System.Text.NormalizationForm]::FormC).ToLowerInvariant()
    }
    catch {
        return $p.Normalize([System.Text.NormalizationForm]::FormC).ToLowerInvariant()
    }
}

function Get-DateFromPath {
    param([string]$path)

    $month = ""
    $dateIn = ""
    $isLeftoverStock = $false

    foreach ($p in ($path -split "\\")) {
        if ($p -match '^đo tủ link kiên$') {
            $isLeftoverStock = $true
        }

        if ($p -match "THÁNG\s*(\d+)") {
            $month = "2026-" + ("{0:D2}" -f [int]$matches[1])
        }

        if (-not $isLeftoverStock -and $p -match "(\d{1,2})-(\d{1,2})-(\d{2})") {
            $d = [int]$matches[1]
            $m = [int]$matches[2]
            $y = 2000 + [int]$matches[3]
            $dateIn = "{0:D2}/{1:D2}/{2}" -f $d, $m, $y
        }
    }

    return @{
        Month  = $month
        DateIn = $dateIn
    }
}

function Get-StockSourceLabel {
    param([string]$path)

    $normalizedPath = Get-TimeMapKey $path
    if ([string]::IsNullOrWhiteSpace($normalizedPath)) { return "" }
    if ($normalizedPath -match '\\đo tủ link kiên(\\|$)') { return 'ĐO TỦ LK' }
    if ($normalizedPath -match '\\lk mới về(\\|$)') { return 'LK MỚI VỀ' }
    return ''
}

function Normalize-DateInForPath {
    param(
        [string]$path,
        [string]$dateIn
    )

    if ((Get-StockSourceLabel $path) -eq 'ĐO TỦ LK') { return '' }
    return Safe-Text $dateIn
}

function Get-FirstUsedWorksheet {
    param($pkg)
    return $pkg.Workbook.Worksheets |
        Where-Object { $_.Dimension } |
        Select-Object -First 1
}

function Test-InspectionWorkbookFile {
    param([System.IO.FileInfo]$f)
    if ($null -eq $f) { return $false }
    $ext = $f.Extension
    if ($ext -ne ".xlsx" -and $ext -ne ".xlsm") { return $false }
    # File khóa tạm của Excel (~$...) làm số file / mtime nhảy → rescan liên tục nếu không loại
    if ($f.Name.StartsWith("~`$", [System.StringComparison]::Ordinal)) { return $false }
    return $true
}

function Read-InspectionFile {
    param([System.IO.FileInfo]$file)

    $part = ""
    $mold = ""
    $rawQty = 0
    $status = "CHƯA ĐO"
    $dateMeasure = ""
    $pkg = $null

    try {
        $pkg = Open-ExcelPackage -Path $file.FullName
        $ws = Get-FirstUsedWorksheet -pkg $pkg

        if ($ws) {
            $part = Safe-Text $ws.Cells["C5"].Value
            $mold = Safe-Text $ws.Cells["G5"].Value
            $dateMeasure = Normalize-MeasureDate $ws.Cells["N4"].Value
            $rawQty = Safe-Qty $ws.Cells["N6"].Value

            $ngCount = 0
            $fullDims = @()
            for ($r = 14; $r -le 54; $r++) {
                for ($c = 6; $c -le 15; $c++) {
                    if (-not [string]::IsNullOrWhiteSpace((Safe-Text $ws.Cells[$r,$c].Value))) {
                        $status = "ĐÃ ĐO"
                        break
                    }
                }
                if ($status -eq "ĐÃ ĐO") { break }
            }

            $fullDims = @($pkg.Workbook.Worksheets | Where-Object { $_.Dimension } | ForEach-Object { Extract-DimensionsFromWorksheet -ws $_ -path $file.FullName -part $part -mold $mold -dateMeasure $dateMeasure })
            if ($fullDims.Count -gt 0) {
                $status = 'ĐÃ ĐO'
                $ngCount = @($fullDims | Where-Object { $_.Result -eq "NG" }).Count
                $cKey = Get-DimensionCacheKey $file.FullName
                if (-not [string]::IsNullOrWhiteSpace($cKey)) {
                    $script:DimensionCache[$cKey] = @($fullDims)
                }
            }
        }

    }
    catch {
        return $null
    }
    finally {
        if ($pkg) { $pkg.Dispose() }
    }

    $quality = if ($status -ne "ĐÃ ĐO") { "" } elseif ($ngCount -gt 0) { "NG ($ngCount)" } else { "OK" }
    $info = Get-DateFromPath $file.FullName
    $lotKey = "$part|$mold|$($file.DirectoryName)"

    return [PSCustomObject]@{
        File        = $file.Name
        Part        = $part
        Mold        = $mold
        Month       = $info.Month
        DateIn      = $info.DateIn
        DateMeasure = $dateMeasure
        TimeStart   = ""
        TimeEnd     = ""
        DurationMin = $null
        MinPerPiece = $null
        Note        = ''
        Qty         = 0
        RawQty      = $rawQty
        Status      = $status
        Quality     = $quality
        NgCount     = $ngCount
        Path        = $file.FullName
        Folder      = $file.DirectoryName
        LotKey      = $lotKey
    }
}

function Convert-MeasureTextToNumber {
    param([string]$text)

    $t = Safe-Text $text
    if ([string]::IsNullOrWhiteSpace($t)) { return $null }
    $t = $t.Trim().ToUpperInvariant().Replace(',', '.').Replace('º','°').Replace('−','-').Replace([string][char]0x2032,"'").Replace([string][char]0x2019,"'").Replace([string][char]0x2033,'"').Replace([string][char]0x201D,'"').Replace("''",'"')
    $t = $t -replace 'PHI|[RCØΦϕ⌀\s]', ''
    # Legacy workbooks use a single closing apostrophe for seconds: 28°4'21'.
    if ($t -match '^([+-]?\d+(?:\.\d+)?)°(\d+(?:\.\d+)?)''(\d+(?:\.\d+)?)''$') { $t=$t.Substring(0,$t.Length-1)+'"' }
    if ($t.Contains('°')) {
        $angle = [regex]::Match($t, '^([+-]?\d+(?:\.\d+)?)°(?:(\d+(?:\.\d+)?)''(?:(\d+(?:\.\d+)?)")?)?$')
        if (-not $angle.Success) { return $null }
        $culture = [Globalization.CultureInfo]::InvariantCulture
        $degree = [double]::Parse($angle.Groups[1].Value,$culture)
        $minute = 0.0; $second = 0.0
        if ($angle.Groups[2].Success) { $minute = [double]::Parse($angle.Groups[2].Value,$culture) }
        if ($angle.Groups[3].Success) { $second = [double]::Parse($angle.Groups[3].Value,$culture) }
        if ($minute -ge 60 -or $second -ge 60) { return $null }
        $sign = if ($t.StartsWith('-')) { -1 } else { 1 }
        return $sign * ([Math]::Abs($degree) + $minute / 60 + $second / 3600)
    }
    if ($t -notmatch '^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?$') { return $null }
    $value = 0.0
    if ([double]::TryParse($t, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$value) -and -not [double]::IsInfinity($value) -and -not [double]::IsNaN($value)) {
        return $value
    }
    return $null
}

function Get-DimensionCacheKey {
    param([string]$path)

    if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path)) { return "" }
    try {
        $f = Get-Item -LiteralPath $path -ErrorAction Stop
        return "$($f.FullName)|$($f.LastWriteTimeUtc.Ticks)|$($f.Length)"
    }
    catch {
        return ""
    }
}

function Get-InspectionCellText {
    param($Cell)
    $value = $Cell.Value
    if ($null -eq $value) { return '' }
    if ($value -is [double] -or $value -is [decimal] -or $value -is [float] -or $value -is [int] -or $value -is [long]) {
        $numericText = ([double]$value).ToString('0.###############', [Globalization.CultureInfo]::InvariantCulture)
        if ($Cell.Style.Numberformat.Format -match '[°º]') { return $numericText + '°' }
        if ($Cell.Style.Numberformat.Format -match '^"([RCØΦ⌀])"') { return $Matches[1] + $numericText }
        return $numericText
    }
    return (Safe-Text $Cell.Text)
}

function Extract-DimensionsFromWorksheet {
    param(
        $ws,
        [string]$path,
        [string]$part,
        [string]$mold,
        [string]$dateMeasure,
        [switch]$SummaryOnly,
        [switch]$CheckFormulaErrors
    )

    $result = New-Object 'System.Collections.Generic.List[object]'
    $sampleCount = 0; $ngTotal = 0; $unratedTotal = 0
    if (-not $ws -or -not $ws.Dimension) { return $result }

    $endRow = [Math]::Min($ws.Dimension.End.Row, 250)
    $endCol = [Math]::Min($ws.Dimension.End.Column, 100)
    $header = 0
    for ($h = 1; $h -le [Math]::Min(60,$endRow); $h++) {
        if ($ws.Cells[$h,1].Text -match '(?i)point' -and $ws.Cells[$h,2].Text -match '(?i)nominal') { $header = $h; break }
    }
    if (-not $header) { $header = 13 }
    $sampleColumns = @()
    for ($col = 6; $col -le $endCol; $col++) {
        $label = (Get-InspectionCellText $ws.Cells[$header,$col]) -replace '^#',''
        if ($label -match '^\d+$') { $sampleColumns += [pscustomobject]@{ Column=$col; Label=[int]$label } }
        elseif (-not [string]::IsNullOrWhiteSpace($label)) { break }
    }
    if (-not $sampleColumns.Count) { $sampleColumns = @(6..15 | ForEach-Object { [pscustomobject]@{Column=$_;Label=$_-5} }) }

    $judgementColumn = 16
    for ($col = 6; $col -le $endCol; $col++) {
        if ($ws.Cells[$header,$col].Text -match '(?i)remark|result|judg|ghi ch[uú]|k[eế]t qu[aả]') { $judgementColumn=$col; break }
    }
    for ($r = ($header + 1); $r -le $endRow; $r++) {
        $point = Safe-Text $ws.Cells[$r,1].Text
        $nominalText = Get-InspectionCellText $ws.Cells[$r,2]
        $tolLowText = Get-InspectionCellText $ws.Cells[$r,3]
        $tolHighText = Get-InspectionCellText $ws.Cells[$r,4]

        if ([string]::IsNullOrWhiteSpace($point) -or [string]::IsNullOrWhiteSpace($nominalText)) { continue }
        if (-not ($point -match '^\d+')) { continue }

        $formulaError = ''
        if ($CheckFormulaErrors) {
            $judgementText = Get-InspectionCellText $ws.Cells[$r,$judgementColumn]
            if ($judgementText -match '^#(?:VALUE!|REF!|DIV/0!|N/A|NAME\?|NUM!|NULL!|SPILL!|CALC!)$') { $formulaError=$judgementText }
        }
        $nominal = Convert-MeasureTextToNumber $nominalText
        $tolA = Convert-MeasureTextToNumber $tolLowText
        $tolB = Convert-MeasureTextToNumber $tolHighText
        $validLimits = $null -ne $nominal -and $null -ne $tolA -and $null -ne $tolB
        $degreeComparison = $nominalText -match '[°º]' -and ($nominalText -match '[''"′″]' -or ([string]::IsNullOrWhiteSpace($tolLowText) -and [string]::IsNullOrWhiteSpace($tolHighText)))

        $limitA = [double]$nominal + [double]$tolA
        $limitB = [double]$nominal + [double]$tolB
        $min = [Math]::Min($limitA, $limitB)
        $max = [Math]::Max($limitA, $limitB)

        foreach ($sampleColumn in $sampleColumns) {
            $c = $sampleColumn.Column
            $sampleText = Get-InspectionCellText $ws.Cells[$r,$c]
            if ([string]::IsNullOrWhiteSpace($sampleText)) { continue }
            $sample = Convert-MeasureTextToNumber $sampleText
            $valid = $validLimits -and $null -ne $sample

            $sampleValue = [double]$sample
            $epsilon = 0.0000001
            $isNg = (-not $valid) -or ($sampleValue -lt ($min - $epsilon) -or $sampleValue -gt ($max + $epsilon))
            if ($degreeComparison) { $isNg = $null -eq $nominal -or $null -eq $sample -or [Math]::Truncate($sampleValue) -ne [Math]::Truncate([double]$nominal) }
            if ($formulaError) { $isNg = $true }
            if ($SummaryOnly) {
                $sampleCount++
                if ($isNg) { $ngTotal++ }
                continue
            }
            $deviation = $sampleValue - [double]$nominal
            $marginLow = $sampleValue - $min
            $marginHigh = $max - $sampleValue
            $nearestMargin = [Math]::Min($marginLow, $marginHigh)

            $result.Add([PSCustomObject]@{
                File          = [System.IO.Path]::GetFileName($path)
                Part          = $part
                Mold          = $mold
                DateMeasure   = $dateMeasure
                Point         = $point
                Nominal       = $nominalText
                TolMinus      = $tolLowText
                TolPlus       = $tolHighText
                SampleNo      = $sampleColumn.Label
                Value         = $sampleText
                NumericValue  = if ($null -ne $sample) { [double]$sample } else { $null }
                LowerLimit    = if ($validLimits) { $min } else { $null }
                UpperLimit    = if ($validLimits) { $max } else { $null }
                Deviation     = if ($valid) { $deviation } else { $null }
                AbsDeviation  = [Math]::Round([Math]::Abs($deviation), 6)
                NearestMargin = [Math]::Round($nearestMargin, 6)
                Result        = if ($isNg) { "NG" } else { "OK" }
                Path          = $path
                FormulaError  = $formulaError
                ExcelRow      = $r
                ExcelCol      = $c
                IsModified    = $false
            })
        }
    }
    if ($SummaryOnly) { return [PSCustomObject]@{ SampleCount = $sampleCount; NgCount = $ngTotal; UnratedCount = $unratedTotal } }
    return $result
}

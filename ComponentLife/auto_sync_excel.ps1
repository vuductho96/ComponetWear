# auto_sync_excel.ps1 - Fast Pure PowerShell 100% Zero-Dependency Excel Auto-Sync Engine
param()

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $Root 'data'
if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }

$MasterFile = Join-Path $Root 'ComponentMaster.json'
$ShootFile = Join-Path $DataDir 'shoot-data.json'
$ReplacementFile = Join-Path $DataDir 'replacement-log.json'
$StockFile = Join-Path $DataDir 'stock-data.json'
$CacheFile = Join-Path $DataDir '.sync_cache.json'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Xml

if (-not ([System.Management.Automation.PSTypeName]'FastExcelReader').Type) {
    $csharpCode = @"
using System;
using System.IO;
using System.IO.Compression;
using System.Xml;
using System.Collections.Generic;

public class FastExcelReader {
    public class RowData {
        public int RowIdx;
        public Dictionary<int, string> Cells = new Dictionary<int, string>();
    }

    public static List<string> ReadSharedStrings(ZipArchiveEntry entry) {
        var list = new List<string>(5000);
        if (entry == null) return list;
        using (var stream = entry.Open())
        using (var xr = XmlReader.Create(stream, new XmlReaderSettings { IgnoreWhitespace = true })) {
            var sb = new System.Text.StringBuilder();
            bool inT = false;
            while (xr.Read()) {
                if (xr.NodeType == XmlNodeType.Element) {
                    if (xr.Name == "si") sb.Length = 0;
                    else if (xr.Name == "t") inT = true;
                } else if (xr.NodeType == XmlNodeType.Text) {
                    if (inT) sb.Append(xr.Value);
                } else if (xr.NodeType == XmlNodeType.EndElement) {
                    if (xr.Name == "t") inT = false;
                    else if (xr.Name == "si") list.Add(sb.ToString());
                }
            }
        }
        return list;
    }

    public static List<RowData> ReadSheet(ZipArchiveEntry entry, List<string> sharedStrings) {
        var list = new List<RowData>(50000);
        if (entry == null) return list;
        using (var stream = entry.Open())
        using (var xr = XmlReader.Create(stream, new XmlReaderSettings { IgnoreWhitespace = true })) {
            RowData currentRow = null;
            string currentRef = null;
            string currentT = null;
            string currentVal = "";
            string inlineVal = "";
            bool inVal = false;
            bool inT = false;
            bool inIs = false;

            while (xr.Read()) {
                if (xr.NodeType == XmlNodeType.Element) {
                    string name = xr.Name;
                    if (name == "row") {
                        int r = 0;
                        string rStr = xr.GetAttribute("r");
                        if (rStr != null) int.TryParse(rStr, out r);
                        currentRow = new RowData { RowIdx = r };
                    } else if (name == "c") {
                        currentRef = xr.GetAttribute("r");
                        currentT = xr.GetAttribute("t");
                        currentVal = "";
                        inlineVal = "";
                        inIs = false;
                    } else if (name == "v") {
                        inVal = true;
                    } else if (name == "t") {
                        inT = true;
                    } else if (name == "is") {
                        inIs = true;
                        inlineVal = "";
                    }
                } else if (xr.NodeType == XmlNodeType.Text) {
                    if (inIs || inT) {
                        inlineVal += xr.Value;
                    } else if (inVal) {
                        currentVal += xr.Value;
                    }
                } else if (xr.NodeType == XmlNodeType.EndElement) {
                    string name = xr.Name;
                    if (name == "v") {
                        inVal = false;
                    } else if (name == "t") {
                        inT = false;
                    } else if (name == "is") {
                        inIs = false;
                    } else if (name == "c") {
                        if (!string.IsNullOrEmpty(inlineVal)) {
                            currentVal = inlineVal;
                        } else if (currentT == "s" && sharedStrings != null) {
                            int idx;
                            if (int.TryParse(currentVal, out idx) && idx >= 0 && idx < sharedStrings.Count) {
                                currentVal = sharedStrings[idx];
                            }
                        }
                        if (currentRow != null && currentRef != null && !string.IsNullOrEmpty(currentVal)) {
                            int col = 0;
                            for (int i = 0; i < currentRef.Length; i++) {
                                char c = currentRef[i];
                                if (c >= 'A' && c <= 'Z') col = col * 26 + (c - 'A' + 1);
                                else if (c >= 'a' && c <= 'z') col = col * 26 + (c - 'a' + 1);
                                else break;
                            }
                            if (col == 0) col = 1;
                            currentRow.Cells[col] = currentVal;
                        }
                    } else if (name == "row") {
                        if (currentRow != null && currentRow.Cells.Count > 0) {
                            list.Add(currentRow);
                        }
                        currentRow = null;
                    }
                }
            }
        }
        return list;
    }
}
"@
    Add-Type -TypeDefinition $csharpCode -ReferencedAssemblies System.Xml, System.IO.Compression, System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
}

function Safe-WriteAllText($targetPath, $textContent) {
    $lastError = $null
    for ($retry = 0; $retry -lt 5; $retry++) {
        try {
            [System.IO.File]::WriteAllText($targetPath, $textContent, (New-Object System.Text.UTF8Encoding($false)))
            return
        } catch {
            $lastError = $_
            Start-Sleep -Milliseconds 150
        }
    }
    throw "Safe-WriteAllText failed for path '$targetPath': $lastError"
}

if (-not (Get-Command Log-Msg -ErrorAction SilentlyContinue)) {
    function Log-Msg($msg, $color = $null) {
        $timeStr = [DateTime]::Now.ToString("HH:mm:ss")
        $formatted = "[$timeStr] $msg"
        if ($color) {
            Write-Host $formatted -ForegroundColor $color
        } else {
            [Console]::WriteLine($formatted)
        }
    }
}

function Save-JsonFileWithBackupAndValidation($targetPath, $contentStr, $isObject = $false) {
    if (-not $contentStr -or [string]::IsNullOrWhiteSpace($contentStr)) {
        $contentStr = if ($isObject) { "{}" } else { "[]" }
    }
    
    # Pre-write JSON validation check
    try {
        $testObj = $contentStr | ConvertFrom-Json
    } catch {
        throw "Validation Error: Target content for '$targetPath' is invalid JSON! Error: $_"
    }

    # Transactional write via .tmp file and .bak backup
    $tmpPath = "$targetPath.tmp"
    $bakPath = "$targetPath.bak"

    Safe-WriteAllText $tmpPath $contentStr

    if (Test-Path $targetPath) {
        try { Copy-Item -Path $targetPath -Destination $bakPath -Force -ErrorAction SilentlyContinue } catch {}
    }

    if (Test-Path $tmpPath) {
        [System.IO.File]::Copy($tmpPath, $targetPath, $true)
        Remove-Item -Path $tmpPath -Force -ErrorAction SilentlyContinue
    }
}

function Parse-CellColNum($ref) {
    if (-not $ref) { return 1 }
    $num = 0
    for ($i = 0; $i -lt $ref.Length; $i++) {
        $c = [int][char]$ref[$i]
        if ($c -ge 65 -and $c -le 90) {
            $num = $num * 26 + ($c - 64)
        } elseif ($c -ge 97 -and $c -le 122) {
            $num = $num * 26 + ($c - 96)
        } else {
            break
        }
    }
    if ($num -gt 0) { return $num }
    return 1
}

function Parse-ExcelDate($raw) {
    if (-not $raw) { return "" }
    $rawStr = [string]$raw.Trim()
    if (-not $rawStr) { return "" }

    # 1. YYYY-MM-DD or YYYY/MM/DD
    if ($rawStr -match '^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$') {
        $yNum = [int]$Matches[1]; $mNum = [int]$Matches[2]; $dNum = [int]$Matches[3]
        if ($mNum -ge 1 -and $mNum -le 12 -and $dNum -ge 1 -and $dNum -le [DateTime]::DaysInMonth($yNum, $mNum)) {
            return ("{0:D4}-{1:D2}-{2:D2}" -f $yNum, $mNum, $dNum)
        }
    }

    # 2. Excel Serial Date Number (e.g. 46203)
    $d = 0.0
    if ([double]::TryParse($rawStr, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$d)) {
        if ($d -gt 30000 -and $d -lt 60000) {
            $base = [DateTime]::new(1899, 12, 30)
            return $base.AddDays($d).ToString("yyyy-MM-dd")
        }
    }

    # 3. Two-number date with 4-digit year (M/D/YYYY, D/M/YYYY, etc.)
    if ($rawStr -match '^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$') {
        $n1 = [int]$Matches[1]
        $n2 = [int]$Matches[2]
        $yNum = [int]$Matches[3]
        
        # Case A: n2 > 12 -> n1 is Month, n2 is Day (e.g. 8/15/2026 -> Month 8, Day 15)
        if ($n1 -ge 1 -and $n1 -le 12 -and $n2 -gt 12 -and $n2 -le [DateTime]::DaysInMonth($yNum, $n1)) {
            return ("{0:D4}-{1:D2}-{2:D2}" -f $yNum, $n1, $n2)
        }
        # Case B: n1 > 12 -> n1 is Day, n2 is Month (e.g. 15/8/2026 -> Day 15, Month 8)
        if ($n2 -ge 1 -and $n2 -le 12 -and $n1 -gt 12 -and $n1 -le [DateTime]::DaysInMonth($yNum, $n2)) {
            return ("{0:D4}-{1:D2}-{2:D2}" -f $yNum, $n2, $n1)
        }
        # Case C: Both <= 12 -> Check standard D/M/YYYY or M/D/YYYY
        if ($n2 -ge 1 -and $n2 -le 12 -and $n1 -ge 1 -and $n1 -le [DateTime]::DaysInMonth($yNum, $n2)) {
            return ("{0:D4}-{1:D2}-{2:D2}" -f $yNum, $n2, $n1)
        }
        if ($n1 -ge 1 -and $n1 -le 12 -and $n2 -ge 1 -and $n2 -le [DateTime]::DaysInMonth($yNum, $n1)) {
            return ("{0:D4}-{1:D2}-{2:D2}" -f $yNum, $n1, $n2)
        }
    }

    # 4. Fallback .NET DateTime.TryParse
    $parsedDt = [DateTime]::MinValue
    if ([DateTime]::TryParse($rawStr, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$parsedDt) -or
        [DateTime]::TryParse($rawStr, [ref]$parsedDt)) {
        if ($parsedDt.Year -ge 2000 -and $parsedDt.Year -le 2100) {
            return $parsedDt.ToString("yyyy-MM-dd")
        }
    }

    return ""
}

# Find candidate .xlsx files (Fix P0-6: filter valid candidate files)
$parentDir = Split-Path $Root -Parent
$candidateFiles = @()
foreach ($dir in @($parentDir, $Root)) {
    if (Test-Path $dir) {
        Get-ChildItem -Path $dir -Filter "*.xlsx" -ErrorAction SilentlyContinue | ForEach-Object {
            $fName = $_.Name
            # Exclude temp files, lock files, and report export files
            if (-not $fName.StartsWith("~$") -and -not $fName.StartsWith("BAO_CAO_") -and -not $fName.StartsWith("REPORT_")) {
                $candidateFiles += $_.FullName
            }
        }
    }
}

# Smart Cache & Deletion detection (Fix P0-4 & P1-10)
$needSync = $false

# Check if target JSON files are missing or empty
foreach ($tf in @($MasterFile, $ShootFile, $ReplacementFile, $StockFile)) {
    if ((-not (Test-Path $tf)) -or ((Get-Item $tf).Length -eq 0)) {
        $needSync = $true
    }
}

$currentCache = @{}
if (Test-Path $CacheFile) {
    try {
        $oldCache = Get-Content $CacheFile -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($prop in $oldCache.PSObject.Properties) {
            $currentCache[$prop.Name] = [int64]$prop.Value
        }
    } catch {
        $needSync = $true
    }
}

$newCache = [ordered]@{}
foreach ($cFile in $candidateFiles) {
    if (Test-Path $cFile) {
        $fInfo = Get-Item $cFile
        $ticks = $fInfo.LastWriteTime.Ticks
        $newCache[$cFile] = $ticks
        if ((-not $currentCache.Contains($cFile)) -or ($currentCache[$cFile] -ne $ticks)) {
            $needSync = $true
        }
    }
}

# Detect deleted Excel files (Fix P0-4)
if ($currentCache.Count -ne $newCache.Count) {
    $needSync = $true
} else {
    foreach ($k in $currentCache.Keys) {
        if (-not $newCache.Contains($k)) {
            $needSync = $true
            break
        }
    }
}

if (-not $needSync) {
    Log-Msg "[3/5] Sync Excel -> JSON -> OK (Fast Cache 5ms)" Green
    return
}

# If candidate files count is 0 (all Excel files deleted), reset JSON files to clean state (Fix P0-4)
if ($candidateFiles.Count -eq 0) {
    Write-Host "⚠️ [auto_sync_excel] Khong tim thay file Excel nao. Dang xoa/reset du lieu JSON ve trang thai sach..." -ForegroundColor Yellow
    Save-JsonFileWithBackupAndValidation $MasterFile "[]" $false
    Save-JsonFileWithBackupAndValidation $ShootFile "[]" $false
    Save-JsonFileWithBackupAndValidation $ReplacementFile "[]" $false
    Save-JsonFileWithBackupAndValidation $StockFile "{}" $true
    Save-JsonFileWithBackupAndValidation $CacheFile "{}" $true
    return
}

# Initialize clean data structures
$masterMap = [ordered]@{}
$replacements = [System.Collections.ArrayList]::new()
$stockData = [ordered]@{}
$shootMap = [ordered]@{}
$seenRequests = [System.Collections.Generic.HashSet[string]]::new()

$syncedMonthSheets = 0
$syncedPartSheets = 0
$syncedShootSheets = 0

class FastRow {
    [int]$RowIdx
    [hashtable]$Cells
}

function Read-SheetRowsFast($entry, $sharedStrings) {
    return [FastExcelReader]::ReadSheet($entry, $sharedStrings)
}

foreach ($excelPath in $candidateFiles) {
    $fs = $null
    $zip = $null
    
    # Fix P2-4: Retry opening locked files
    for ($retry = 0; $retry -lt 3; $retry++) {
        try {
            $fs = [System.IO.File]::Open($excelPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Read)
            break
        } catch {
            if ($fs) { try { $fs.Close() } catch {} }
            Start-Sleep -Milliseconds 200
        }
    }

    if (-not $zip) {
        Write-Warning "⚠️ Khong the mo file Excel: $excelPath (dang bi khoa hoac loi truy cap)"
        continue
    }

    try {
        # Fix P2-2: Fast O(1) ZipEntry hashtable lookup
        $entryMap = @{}
        foreach ($entry in $zip.Entries) {
            $entryMap[$entry.FullName] = $entry
        }

        $wbEntry = $entryMap['xl/workbook.xml']
        $wbRelsEntry = $entryMap['xl/_rels/workbook.xml.rels']
        if (-not $wbEntry -or -not $wbRelsEntry) {
            if ($zip) { $zip.Dispose() }; if ($fs) { $fs.Close() }; continue
        }

        # Read workbook.xml & rels
        $stream = $wbEntry.Open()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        $wbXml = [xml]$reader.ReadToEnd()
        $reader.Close(); $stream.Close()

        $stream = $wbRelsEntry.Open()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        $relsXml = [xml]$reader.ReadToEnd()
        $reader.Close(); $stream.Close()

        $relMap = @{}
        foreach ($rel in $relsXml.Relationships.Relationship) {
            $t = $rel.Target
            if (-not $t.StartsWith("xl/")) { $t = "xl/" + $t }
            $relMap[$rel.Id] = $t
        }

        # Shared Strings (Compiled Native Reader)
        $ssEntry = if ($entryMap.ContainsKey('xl/sharedStrings.xml')) { $entryMap['xl/sharedStrings.xml'] } else { $null }
        $sharedStrings = [FastExcelReader]::ReadSharedStrings($ssEntry)

        # Fix P2-1: Process all sheets in a single pass
        foreach ($sheet in $wbXml.workbook.sheets.sheet) {
            $sName = [string]$sheet.name
            $rId = [string]$sheet.id
            $targetPath = $relMap[$rId]
            $sEntry = if ($targetPath) { $entryMap[$targetPath] } else { $null }
            if (-not $sEntry) { continue }

            $sNameLower = $sName.ToLower().Trim()

            # --- A. PartList Sheet ---
            if ($sNameLower.Contains("part")) {
                $syncedPartSheets++
                $rowsList = Read-SheetRowsFast $sEntry $sharedStrings
                foreach ($rowObj in $rowsList) {
                    $rDict = $rowObj.Cells
                    $pName = if ($rDict.ContainsKey(1)) { $rDict[1].Trim() } else { "" }
                    $pSeries = if ($rDict.ContainsKey(2)) { $rDict[2].Trim() } else { "" }
                    $pOld = if ($rDict.ContainsKey(3)) { $rDict[3].Trim() } else { "" }
                    $pNew = if ($rDict.ContainsKey(4)) { $rDict[4].Trim() } else { "" }
                    $pStd = 1
                    if ($rDict.ContainsKey(5)) { [int]::TryParse($rDict[5], [ref]$pStd) | Out-Null }
                    $pLeft = 0
                    if ($rDict.ContainsKey(6)) { [int]::TryParse($rDict[6], [ref]$pLeft) | Out-Null }

                    if ($pName -and $pName.ToLower() -ne "partname" -and $pName.Length -ge 2) {
                        # Fix P1-4: Prevent auto-guessing Old/New DieSet = PartName
                        $oldDie = if ($pOld) { $pOld } else { $pNew }
                        $newDie = if ($pNew) { $pNew } else { $pOld }
                        $mKey = if ($newDie) { "$pName|$newDie" } else { $pName }

                        # Fix P1-3: Safe Master Schema Merge
                        if (-not $masterMap.Contains($mKey)) {
                            $masterMap[$mKey] = [ordered]@{
                                PartName = $pName
                                Series = $pSeries
                                OldDieSet = $oldDie
                                NewDieSet = $newDie
                                StandardStock = $pStd
                                StockLeft = $pLeft
                            }
                        } else {
                            if ($pSeries) { $masterMap[$mKey].Series = $pSeries }
                            if ($oldDie) { $masterMap[$mKey].OldDieSet = $oldDie }
                            if ($newDie) { $masterMap[$mKey].NewDieSet = $newDie }
                            if ($pStd -gt 0) { $masterMap[$mKey].StandardStock = $pStd }
                            if ($pLeft -ge 0) { $masterMap[$mKey].StockLeft = $pLeft }
                        }
                    }
                }
            }
            # --- B. Shoot Sheet ---
            elseif ($sNameLower.Contains("shoot")) {
                $syncedShootSheets++
                $rowsList = Read-SheetRowsFast $sEntry $sharedStrings
                if ($rowsList.Count -eq 0) { continue }

                # Dynamic column mapping by detecting headers in first 5 rows
                $colDate = 1
                $colMold = 2
                $colOutput = 3
                $colMachine = 0
                $colPart = 0
                $dataStartRow = 2

                for ($i = 0; $i -lt [Math]::Min(5, $rowsList.Count); $i++) {
                    $rHeader = $rowsList[$i].Cells
                    $foundHeader = $false
                    foreach ($cIdx in $rHeader.Keys) {
                        $hVal = $rHeader[$cIdx].ToLower().Trim()
                        if ($hVal -eq "date" -or $hVal -eq "ngay") { $colDate = $cIdx; $foundHeader = $true }
                        elseif ($hVal -like "*mold*" -or $hVal -like "*die*" -or $hVal -like "*khuon*") { $colMold = $cIdx; $foundHeader = $true }
                        elseif ($hVal -eq "output" -or $hVal -like "*shoot*" -or $hVal -like "*shot*" -or $hVal -like "*san luong*") { $colOutput = $cIdx; $foundHeader = $true }
                        elseif ($hVal -like "*machine*" -or $hVal -eq "mc" -or $hVal -like "*may*") { $colMachine = $cIdx; $foundHeader = $true }
                        elseif ($hVal -like "*part*" -or $hVal -like "*linh kien*") { $colPart = $cIdx; $foundHeader = $true }
                    }
                    if ($foundHeader) {
                        $dataStartRow = $rowsList[$i].RowIdx + 1
                        break
                    }
                }

                foreach ($rowObj in $rowsList) {
                    if ($rowObj.RowIdx -lt $dataStartRow) { continue }
                    $rDict = $rowObj.Cells

                    $dtRaw = if ($colDate -and $rDict.ContainsKey($colDate)) { $rDict[$colDate].Trim() } else { "" }
                    $moldRaw = if ($colMold -and $rDict.ContainsKey($colMold)) { $rDict[$colMold].Trim() } else { "" }
                    $outRaw = if ($colOutput -and $rDict.ContainsKey($colOutput)) { $rDict[$colOutput].Trim() } else { "" }
                    $machineRaw = if ($colMachine -and $rDict.ContainsKey($colMachine)) { $rDict[$colMachine].Trim() } else { "" }
                    $partRaw = if ($colPart -and $rDict.ContainsKey($colPart)) { $rDict[$colPart].Trim() } else { "" }

                    if ($dtRaw -and $moldRaw -and $outRaw) {
                        $dtStr = Parse-ExcelDate $dtRaw
                        $numOut = 0.0
                        if ([double]::TryParse($outRaw, [ref]$numOut) -and $dtStr -and $numOut -gt 0) {
                            # Fix P1-2 & P0-2: Composite key with Machine and Part
                            $sKey = "$dtStr|$machineRaw|$moldRaw|$partRaw"
                            if ($shootMap.Contains($sKey)) {
                                $shootMap[$sKey].Output += $numOut
                            } else {
                                $shootMap[$sKey] = [ordered]@{
                                    Date = $dtStr
                                    Machine = $machineRaw
                                    Part = $partRaw
                                    DieSet = $moldRaw
                                    Output = $numOut
                                }
                            }
                        }
                    }
                }
            }
            # --- C. Month Sheets (e.g. 07-2026, 7-2026, 6_2026, T6-2026, Tháng 6-2027, etc.) ---
            elseif ($sName -match '(?:th[aá]ng\s*|t\s*)?(\d{1,2})[\s\-_/]+(\d{4})' -and [int]$Matches[1] -ge 1 -and [int]$Matches[1] -le 12 -and [int]$Matches[2] -ge 2000 -and [int]$Matches[2] -le 2100) {
                $syncedMonthSheets++
                $mNum = [int]$Matches[1]
                $yNum = [int]$Matches[2]
                $ym = ("{0:D4}-{1:D2}" -f $yNum, $mNum)
                $maxDaysInMonth = [DateTime]::DaysInMonth($yNum, $mNum)

                $rowsList = Read-SheetRowsFast $sEntry $sharedStrings
                foreach ($rowObj in $rowsList) {
                    if ($rowObj.RowIdx -lt 8) { continue }
                    $rDict = $rowObj.Cells

                    $partFull = if ($rDict.ContainsKey(1)) { $rDict[1].Trim() } else { "" }
                    if (-not $partFull -or $partFull.ToLower() -eq 'part' -or $partFull.ToLower() -eq 'total' -or $partFull.ToLower() -eq 'stt') { continue }

                    $tokens = $partFull.Split('/') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
                    $partName = $tokens[0]
                    $series = if ($tokens.Count -ge 2) { $tokens[1] } else { "" }
                    $mold = if ($tokens.Count -ge 3) { $tokens[2] } else { if ($tokens.Count -ge 2) { $tokens[1] } else { $tokens[0] } }

                    if ($partName -and $partName.Length -ge 2) {
                        $minStock = 1
                        if ($rDict.ContainsKey(5)) { [int]::TryParse($rDict[5], [ref]$minStock) | Out-Null }
                        $oldStock = 0
                        if ($rDict.ContainsKey(6)) { [int]::TryParse($rDict[6], [ref]$oldStock) | Out-Null }

                        # Fix P0-3: Populate stockData
                        $mKey = "$partName|$mold"
                        $stockData[$mKey] = [ordered]@{
                            PartName = $partName
                            Series = $series
                            DieSet = $mold
                            StandardStock = $minStock
                            StockLeft = $oldStock
                        }

                        if (-not $masterMap.Contains($mKey)) {
                            $masterMap[$mKey] = [ordered]@{
                                PartName = $partName
                                Series = $series
                                OldDieSet = $mold
                                NewDieSet = $mold
                                StandardStock = $minStock
                                StockLeft = $oldStock
                            }
                        } else {
                            if ($minStock -gt 1 -and -not $masterMap[$mKey].StandardStock) { $masterMap[$mKey].StandardStock = $minStock }
                            if ($oldStock -gt 0 -and -not $masterMap[$mKey].StockLeft) { $masterMap[$mKey].StockLeft = $oldStock }
                        }

                        # Dynamic unlimited replacement blocks: Lần 1 (7), Lần 2 (11), Lần 3 (15), Lần 4 (19), Lần 5 (23), Lần 6 (27)... unlimited
                        for ($cStart = 7; $cStart -le 300; $cStart += 4) {
                            $cQty = $cStart
                            $cId = $cStart + 1
                            $cDate = $cStart + 2

                            if (-not $rDict.ContainsKey($cQty) -and -not $rDict.ContainsKey($cId) -and -not $rDict.ContainsKey($cDate)) {
                                if ($cStart -gt 40) { break }
                                continue
                            }

                            $qtyRaw = if ($rDict.ContainsKey($cQty)) { $rDict[$cQty].Trim() } else { "" }
                            $idRaw = if ($rDict.ContainsKey($cId)) { $rDict[$cId].Trim() } else { "" }
                            $dateRaw = if ($rDict.ContainsKey($cDate)) { $rDict[$cDate].Trim() } else { "" }

                            if ($qtyRaw -or $idRaw -or $dateRaw) {
                                # Fix P1-7: Validate quantity (must be valid numeric > 0)
                                $qtyVal = 0
                                if ($qtyRaw -and -not [int]::TryParse($qtyRaw, [ref]$qtyVal)) {
                                    continue
                                }
                                if ($qtyVal -le 0) { $qtyVal = 1 }

                                # Fix P1-5 & P1-6: Validate day numbers against maxDaysInMonth
                                $dayVal = 0
                                if ($dateRaw -and [int]::TryParse($dateRaw, [ref]$dayVal)) {
                                    if ($dayVal -lt 1 -or $dayVal -gt $maxDaysInMonth) {
                                        # Invalid day number for this month (e.g. 31/02 or >31) -> Skip invalid date
                                        continue
                                    }
                                } else {
                                    # Day is empty or non-numeric
                                    continue
                                }

                                $fullDate = ("{0}-{1:D2}" -f $ym, $dayVal)

                                # Fix P1-8: Deduplicate replacements by RequestId & composite key
                                $dedupKey = "$partName|$mold|$fullDate|$idRaw"
                                if ($seenRequests.Add($dedupKey)) {
                                    [void]$replacements.Add([ordered]@{
                                        Part = $partName
                                        Series = $series
                                        DieSet = $mold
                                        NewDieSet = $mold
                                        OldDieSet = $mold
                                        ReplaceDate = $fullDate
                                        Label = [string]$qtyVal
                                        RequestId = $idRaw
                                    })
                                }
                            }
                        }
                    }
                }
            }
        }

        if ($zip) { $zip.Dispose() }
        if ($fs) { $fs.Close() }
    } catch {
        if ($zip) { try { $zip.Dispose() } catch {} }
        if ($fs) { try { $fs.Close() } catch {} }
        # Fix P0-5: Explicit error warning
        Write-Warning "⚠️ Loi khi dang xu ly file Excel $excelPath : $_"
    }
}

# Transactional Save Master Data (Fix P2-5, P2-7, P2-8)
if ($masterMap.Count -gt 0) {
    $masterList = @($masterMap.Values)
    $masterJson = $masterList | ConvertTo-Json -Depth 8
    Save-JsonFileWithBackupAndValidation $MasterFile $masterJson $false
}

# Transactional Save Shoot Data
if ($shootMap.Count -gt 0) {
    $shootList = @($shootMap.Values)
    $shootJson = $shootList | ConvertTo-Json -Depth 8
    Save-JsonFileWithBackupAndValidation $ShootFile $shootJson $false
}

# Transactional Save Replacement Data
if ($replacements.Count -gt 0) {
    $repJson = @($replacements) | ConvertTo-Json -Depth 8
    Save-JsonFileWithBackupAndValidation $ReplacementFile $repJson $false
}

# Transactional Save Stock Data (Fix P0-3)
if ($stockData.Count -gt 0) {
    $stockJson = $stockData | ConvertTo-Json -Depth 8
    Save-JsonFileWithBackupAndValidation $StockFile $stockJson $true
}

# Update Cache ONLY after successful writes (Fix P2-6)
if ($newCache.Count -gt 0) {
    $cacheJson = $newCache | ConvertTo-Json -Depth 4
    Save-JsonFileWithBackupAndValidation $CacheFile $cacheJson $true
}

$repCount = $replacements.Count
$masterCount = $masterMap.Count
$totalSheets = $syncedMonthSheets + $syncedPartSheets + $syncedShootSheets
Log-Msg "[3/5] Sync Excel -> JSON -> OK ($totalSheets sheets | $repCount luot thay | $masterCount master)" Green

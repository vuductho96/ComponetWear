# auto_sync_excel.ps1 - Fast Pure PowerShell 100% Zero-Dependency Excel Auto-Sync Engine
param()

$ErrorActionPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $Root 'data'
if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }

$MasterFile = Join-Path $Root 'ComponentMaster.json'
$ShootFile = Join-Path $DataDir 'shoot-data.json'
$ReplacementFile = Join-Path $DataDir 'replacement-log.json'
$StockFile = Join-Path $DataDir 'stock-data.json'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Parse-CellColNum($ref) {
    if (-not $ref) { return 1 }
    $colStr = $ref -replace '[0-9]', ''
    $num = 0
    foreach ($char in [char[]]$colStr) {
        $num = $num * 26 + ([byte][char]$char - 64)
    }
    return $num
}

function Parse-ExcelDate($raw) {
    if (-not $raw) { return "" }
    $rawStr = [string]$raw
    if ($rawStr -match '^\d{4}-\d{2}-\d{2}$') { return $rawStr }
    if ($rawStr -match '^\d{1,2}/\d{1,2}/\d{4}$') {
        $parts = $rawStr.Split('/')
        return ("{0:D4}-{1:D2}-{2:D2}" -f [int]$parts[2], [int]$parts[0], [int]$parts[1])
    }
    $d = 0.0
    if ([double]::TryParse($rawStr, [ref]$d)) {
        if ($d -gt 30000 -and $d -lt 60000) {
            $base = Get-Date "1899-12-30"
            return $base.AddDays($d).ToString("yyyy-MM-dd")
        }
    }
    return ""
}

# Find candidate .xlsx files
$parentDir = Split-Path $Root -Parent
$candidateFiles = @()
foreach ($dir in @($parentDir, $Root)) {
    if (Test-Path $dir) {
        Get-ChildItem -Path $dir -Filter "*.xlsx" -ErrorAction SilentlyContinue | ForEach-Object {
            if (-not $_.Name.StartsWith("~$")) {
                $candidateFiles += $_.FullName
            }
        }
    }
}

if ($candidateFiles.Count -eq 0) {
    exit 0
}

# Load existing Master Map if available
$masterMap = [ordered]@{}
if (Test-Path $MasterFile) {
    try {
        $existing = Get-Content $MasterFile -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($m in $existing) {
            if ($m.PartName) {
                $die = if ($m.NewDieSet) { $m.NewDieSet } else { $m.OldDieSet }
                $key = "$($m.PartName)|$die"
                $masterMap[$key] = [ordered]@{
                    PartName = [string]$m.PartName
                    Series = [string]$m.Series
                    OldDieSet = [string]$m.OldDieSet
                    NewDieSet = [string]$m.NewDieSet
                    StandardStock = [int]($m.StandardStock)
                    StockLeft = [int]($m.StockLeft)
                }
            }
        }
    } catch {}
}

$replacements = [System.Collections.ArrayList]::new()
$stockData = [ordered]@{}
$shootMap = [ordered]@{}
$syncedSheetsCount = 0

function Read-SheetRowsFast($entry, $sharedStrings) {
    $rowsList = [System.Collections.ArrayList]::new()
    $stream = $entry.Open()
    $xr = [System.Xml.XmlReader]::Create($stream)
    
    $currentRowIdx = 0
    $currentRowDict = $null
    $currentRef = ""
    $currentT = ""
    $currentVal = ""
    $inValue = $false
    $inT = $false

    while ($xr.Read()) {
        if ($xr.NodeType -eq [System.Xml.XmlNodeType]::Element) {
            $name = $xr.Name
            if ($name -eq "row") {
                $rStr = $xr.GetAttribute("r")
                $currentRowIdx = if ($rStr) { [int]$rStr } else { 0 }
                $currentRowDict = @{}
            } elseif ($name -eq "c") {
                $currentRef = $xr.GetAttribute("r")
                $currentT = $xr.GetAttribute("t")
                $currentVal = ""
            } elseif ($name -eq "v") {
                $inValue = $true
            } elseif ($name -eq "t") {
                $inT = $true
            }
        } elseif ($xr.NodeType -eq [System.Xml.XmlNodeType]::Text) {
            if ($inValue -or $inT) {
                $currentVal += $xr.Value
            }
        } elseif ($xr.NodeType -eq [System.Xml.XmlNodeType]::EndElement) {
            $name = $xr.Name
            if ($name -eq "v") {
                $inValue = $false
            } elseif ($name -eq "t") {
                $inT = $false
            } elseif ($name -eq "c") {
                if ($currentT -eq "s" -and $currentVal -match '^\d+$') {
                    $idx = [int]$currentVal
                    if ($idx -lt $sharedStrings.Count) { $currentVal = $sharedStrings[$idx] }
                }
                if ($currentRef -and $currentRowDict -ne $null) {
                    $colNum = Parse-CellColNum $currentRef
                    if ($currentVal) { $currentRowDict[$colNum] = [string]$currentVal }
                }
            } elseif ($name -eq "row") {
                if ($currentRowDict -ne $null -and $currentRowDict.Count -gt 0) {
                    $rowsList.Add([pscustomobject]@{ RowIdx = $currentRowIdx; Cells = $currentRowDict }) | Out-Null
                }
                $currentRowDict = $null
            }
        }
    }
    $xr.Close()
    $stream.Close()
    return $rowsList
}

foreach ($excelPath in $candidateFiles) {
    $fs = $null
    $zip = $null
    try {
        $fs = [System.IO.File]::Open($excelPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Read)
        
        $wbEntry = $zip.Entries | Where-Object { $_.FullName -eq 'xl/workbook.xml' }
        $wbRelsEntry = $zip.Entries | Where-Object { $_.FullName -eq 'xl/_rels/workbook.xml.rels' }
        if (-not $wbEntry -or -not $wbRelsEntry) { if ($zip) { $zip.Dispose() }; if ($fs) { $fs.Close() }; continue }

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

        # Shared Strings
        $sharedStrings = @()
        $ssEntry = $zip.Entries | Where-Object { $_.FullName -eq 'xl/sharedStrings.xml' }
        if ($ssEntry) {
            $stream = $ssEntry.Open()
            $xr = [System.Xml.XmlReader]::Create($stream)
            $ssTxt = ""
            $inT = $false
            while ($xr.Read()) {
                if ($xr.NodeType -eq [System.Xml.XmlNodeType]::Element) {
                    if ($xr.Name -eq "si") { $ssTxt = "" }
                    elseif ($xr.Name -eq "t") { $inT = $true }
                } elseif ($xr.NodeType -eq [System.Xml.XmlNodeType]::Text) {
                    if ($inT) { $ssTxt += $xr.Value }
                } elseif ($xr.NodeType -eq [System.Xml.XmlNodeType]::EndElement) {
                    if ($xr.Name -eq "t") { $inT = $false }
                    elseif ($xr.Name -eq "si") { $sharedStrings += $ssTxt }
                }
            }
            $xr.Close(); $stream.Close()
        }

        # 1. Parse PartList sheets
        foreach ($sheet in $wbXml.workbook.sheets.sheet) {
            $sName = [string]$sheet.name
            $rId = [string]$sheet.id
            $targetPath = $relMap[$rId]

            if ($sName.ToLower().Contains("part") -and $targetPath) {
                $sEntry = $zip.Entries | Where-Object { $_.FullName -eq $targetPath }
                if ($sEntry) {
                    $rowsList = Read-SheetRowsFast $sEntry $sharedStrings
                    foreach ($rowObj in $rowsList) {
                        $rDict = $rowObj.Cells
                        $pName = if ($rDict.ContainsKey(1)) { $rDict[1].Trim() } else { "" }
                        $pSeries = if ($rDict.ContainsKey(2)) { $rDict[2].Trim() } else { "" }
                        $pOld = if ($rDict.ContainsKey(3)) { $rDict[3].Trim() } else { "" }
                        $pNew = if ($rDict.ContainsKey(4)) { $rDict[4].Trim() } else { "" }

                        if ($pName -and $pName.ToLower() -ne "partname" -and $pName.Length -ge 2) {
                            $oldDie = if ($pOld) { $pOld } else { if ($pNew) { $pNew } else { $pName } }
                            $newDie = if ($pNew) { $pNew } else { if ($pOld) { $pOld } else { $pName } }
                            $mKey = "$pName|$newDie"
                            if (-not $masterMap.ContainsKey($mKey)) {
                                $masterMap[$mKey] = [ordered]@{
                                    PartName = $pName
                                    Series = $pSeries
                                    OldDieSet = $oldDie
                                    NewDieSet = $newDie
                                    StandardStock = 1
                                    StockLeft = 0
                                }
                            }
                        }
                    }
                }
            }
        }

        # 2. Parse Shoot Number sheet
        foreach ($sheet in $wbXml.workbook.sheets.sheet) {
            $sName = [string]$sheet.name
            $rId = [string]$sheet.id
            $targetPath = $relMap[$rId]

            if ($sName.ToLower().Contains("shoot") -and $targetPath) {
                $sEntry = $zip.Entries | Where-Object { $_.FullName -eq $targetPath }
                if ($sEntry) {
                    $rowsList = Read-SheetRowsFast $sEntry $sharedStrings
                    foreach ($rowObj in $rowsList) {
                        $rDict = $rowObj.Cells
                        $dtRaw = if ($rDict.ContainsKey(1)) { $rDict[1].Trim() } else { "" }
                        $moldRaw = if ($rDict.ContainsKey(2)) { $rDict[2].Trim() } else { "" }
                        $outRaw = if ($rDict.ContainsKey(3)) { $rDict[3].Trim() } else { "" }

                        if ($dtRaw -and $moldRaw -and $outRaw) {
                            $dtStr = Parse-ExcelDate $dtRaw
                            $numOut = 0.0
                            if ([double]::TryParse($outRaw, [ref]$numOut) -and $dtStr -and $numOut -gt 0) {
                                $sKey = "$dtStr|$moldRaw"
                                if ($shootMap.ContainsKey($sKey)) {
                                    $shootMap[$sKey] += $numOut
                                } else {
                                    $shootMap[$sKey] = $numOut
                                }
                            }
                        }
                    }
                }
            }
        }

        # 3. Parse Month Sheets (e.g. 07-2026 or 7-2026)
        foreach ($sheet in $wbXml.workbook.sheets.sheet) {
            $sName = [string]$sheet.name
            $rId = [string]$sheet.id
            $targetPath = $relMap[$rId]

            if ($sName -match '^(\d{1,2})[-/](\d{4})$') {
                $mNum = [int]$Matches[1]
                $yNum = [int]$Matches[2]
                $ym = ("{0:D4}-{1:D2}" -f $yNum, $mNum)

                $sEntry = $zip.Entries | Where-Object { $_.FullName -eq $targetPath }
                if ($sEntry) {
                    $syncedSheetsCount++
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

                            $mKey = "$partName|$mold"
                            if (-not $masterMap.ContainsKey($mKey)) {
                                $masterMap[$mKey] = [ordered]@{
                                    PartName = $partName
                                    Series = $series
                                    OldDieSet = $mold
                                    NewDieSet = $mold
                                    StandardStock = $minStock
                                    StockLeft = $oldStock
                                }
                            }

                            $outCols = @((7,8,9), (11,12,13), (15,16,17), (19,20,21), (23,24,25))
                            foreach ($g in $outCols) {
                                $qtyRaw = if ($rDict.ContainsKey($g[0])) { $rDict[$g[0]].Trim() } else { "" }
                                $idRaw = if ($rDict.ContainsKey($g[1])) { $rDict[$g[1]].Trim() } else { "" }
                                $dateRaw = if ($rDict.ContainsKey($g[2])) { $rDict[$g[2]].Trim() } else { "" }

                                if ($qtyRaw -or $idRaw -or $dateRaw) {
                                    $qtyVal = 1
                                    if ($qtyRaw) { [int]::TryParse($qtyRaw, [ref]$qtyVal) | Out-Null }
                                    $dayVal = 1
                                    if ($dateRaw) { [int]::TryParse($dateRaw, [ref]$dayVal) | Out-Null }
                                    $dayClamped = [Math]::Max(1, [Math]::Min(31, $dayVal))
                                    $fullDate = ("{0}-{1:D2}" -f $ym, $dayClamped)

                                    $replacements.Add([ordered]@{
                                        Part = $partName
                                        Series = $series
                                        DieSet = $mold
                                        NewDieSet = $mold
                                        OldDieSet = $mold
                                        ReplaceDate = $fullDate
                                        Label = [string]$qtyVal
                                        RequestId = $idRaw
                                    }) | Out-Null
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
    }
}

# Save Master Data
if ($masterMap.Count -gt 0) {
    $masterList = @($masterMap.Values)
    $masterJson = $masterList | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($MasterFile, $masterJson, (New-Object System.Text.UTF8Encoding($false)))
}

# Save Shoot Data
if ($shootMap.Count -gt 0) {
    $shootList = [System.Collections.ArrayList]::new()
    foreach ($k in $shootMap.Keys) {
        $p = $k.Split('|')
        $shootList.Add([ordered]@{
            Date = $p[0]
            Part = ""
            DieSet = $p[1]
            Output = $shootMap[$k]
        }) | Out-Null
    }
    $shootJson = @($shootList) | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($ShootFile, $shootJson, (New-Object System.Text.UTF8Encoding($false)))
}

# Save Replacement Data
if ($replacements.Count -gt 0) {
    $repJson = @($replacements) | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($ReplacementFile, $repJson, (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host "⚡ Auto-sync powershell complete! ($syncedSheetsCount sheets, $($replacements.Count) replacements, $($masterMap.Count) master items)" -ForegroundColor Green

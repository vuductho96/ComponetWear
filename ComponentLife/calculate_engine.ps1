# calculate_engine.ps1 - Core Calculation Engine (Plan S5)
# Debug logging at every stage for full traceability
# Final report format: Theo_doi_tuoi_tho_linh_kien_khuon_theo_shot

param()

$ErrorActionPreference = 'Stop'

# Resolve paths relative to this script's location
$EngineRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $EngineRoot 'data'
$MasterFile = Join-Path $EngineRoot 'ComponentMaster.json'
$ShootFile = Join-Path $DataDir 'shoot-data.json'
$ReplacementFile = Join-Path $DataDir 'replacement-log.json'

# ===== DEBUG LOGGER =====
function Write-EngineDebug {
    param([string]$Stage, [string]$Message, [string]$Color = 'Cyan')
    $ts = Get-Date -Format 'HH:mm:ss.fff'
    Write-Host "[$ts] [ENGINE:$Stage] $Message" -ForegroundColor $Color
}

function Invoke-CalculationEngine {
    param(
        [array]$RawShootData = $null,
        [array]$ReplacementData = $null,
        [array]$MasterData = $null
    )

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Write-EngineDebug 'INIT' '========== CALCULATION ENGINE START ==========' 'Green'
    Write-EngineDebug 'INIT' "EngineRoot: $EngineRoot"
    Write-EngineDebug 'INIT' "DataDir: $DataDir"

    # Helper: safe decimal extraction (JSON may produce arrays)
    function SafeDecimal($val) {
        if ($null -eq $val) { return [decimal]0 }
        if ($val -is [array]) { $val = $val[0] }
        try { return [decimal]([string]$val) } catch { return [decimal]0 }
    }

    # ===== STAGE 1: LOAD RAW DATA =====
    Write-EngineDebug 'LOAD' '--- STAGE 1: Loading raw data ---' 'Yellow'

    if ($null -eq $RawShootData) {
        if (Test-Path $ShootFile) {
            Write-EngineDebug 'LOAD' "Reading shoot data from: $ShootFile"
            $raw = Get-Content $ShootFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($raw -is [array]) { $RawShootData = $raw } else { $RawShootData = @($raw) }
            Write-EngineDebug 'LOAD' "Shoot data loaded: $($RawShootData.Count) records" 'Green'
        } else {
            $RawShootData = @()
            Write-EngineDebug 'LOAD' "WARN: ShootFile not found: $ShootFile" 'Red'
        }
    } else {
        Write-EngineDebug 'LOAD' "Shoot data provided in-memory: $($RawShootData.Count) records"
    }

    if ($null -eq $ReplacementData) {
        if (Test-Path $ReplacementFile) {
            Write-EngineDebug 'LOAD' "Reading replacement data from: $ReplacementFile"
            $raw = Get-Content $ReplacementFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($raw -is [array]) { $ReplacementData = $raw } else { $ReplacementData = @($raw) }
            Write-EngineDebug 'LOAD' "Replacement data loaded: $($ReplacementData.Count) records" 'Green'
        } else {
            $ReplacementData = @()
            Write-EngineDebug 'LOAD' "WARN: ReplacementFile not found: $ReplacementFile" 'Red'
        }
    } else {
        Write-EngineDebug 'LOAD' "Replacement data provided in-memory: $($ReplacementData.Count) records"
    }

    if ($null -eq $MasterData) {
        if (Test-Path $MasterFile) {
            Write-EngineDebug 'LOAD' "Reading master data from: $MasterFile"
            $raw = Get-Content $MasterFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($raw -is [array]) { $MasterData = $raw } else { $MasterData = @($raw) }
            Write-EngineDebug 'LOAD' "Master data loaded: $($MasterData.Count) records" 'Green'
        } else {
            $MasterData = @()
            Write-EngineDebug 'LOAD' "WARN: MasterFile not found: $MasterFile" 'Red'
        }
    } else {
        Write-EngineDebug 'LOAD' "Master data provided in-memory: $($MasterData.Count) records"
    }

    # Show sample data
    if ($RawShootData.Count -gt 0) {
        $s0 = $RawShootData[0]
        Write-EngineDebug 'LOAD' "  Sample shoot: Date=$($s0.Date) Part=$($s0.Part) DieSet=$($s0.DieSet) Output=$($s0.Output)"
    }
    if ($ReplacementData.Count -gt 0) {
        $r0 = $ReplacementData[0]
        Write-EngineDebug 'LOAD' "  Sample replacement: Part=$($r0.Part) Series=$($r0.Series) DieSet=$($r0.DieSet) Date=$($r0.ReplaceDate) Label=$($r0.Label)"
    }
    if ($MasterData.Count -gt 0) {
        $m0 = $MasterData[0]
        Write-EngineDebug 'LOAD' "  Sample master: PartName=$($m0.PartName) Series=$($m0.Series) OldDieSet=$($m0.OldDieSet) NewDieSet=$($m0.NewDieSet)"
    }

    # ===== STAGE 2: CLEAN & DEDUPLICATE SHOOT DATA =====
    Write-EngineDebug 'CLEAN' '--- STAGE 2: Clean & deduplicate shoot data ---' 'Yellow'
    $shootMap = [ordered]@{}
    $skippedShoot = 0
    foreach ($s in $RawShootData) {
        if ($null -eq $s.Output -or [string]$s.Output -eq "") { $skippedShoot++; continue }
        $rawOut = $s.Output
        if ($rawOut -is [array]) { $rawOut = $rawOut[0] }
        $outVal = SafeDecimal $rawOut
        if ($outVal -le 0) { $skippedShoot++; continue }
        $partStr = if ($s.Part) { [string]$s.Part } else { "" }
        $machStr = if ($s.Machine) { [string]$s.Machine } else { "" }
        $dieStr = if ($s.DieSet) { [string]$s.DieSet } else { "" }
        $key = "$($s.Date)|$machStr|$dieStr|$partStr"
        if ($shootMap.Contains($key)) {
            $shootMap[$key].Output += $outVal
        } else {
            $shootMap[$key] = [pscustomobject]@{
                Date = [string]$s.Date
                Machine = $machStr
                Part = $partStr
                DieSet = $dieStr
                Output = $outVal
            }
        }
    }
    $cleanShoot = @($shootMap.Values | Sort-Object Date, Part, DieSet)
    Write-EngineDebug 'CLEAN' "Clean shoot: $($cleanShoot.Count) unique records (skipped $skippedShoot invalid)" 'Green'

    # ===== STAGE 3: CLEAN REPLACEMENTS =====
    Write-EngineDebug 'CLEAN' '--- STAGE 3: Clean replacements ---' 'Yellow'
    $cleanRep = @($ReplacementData | Where-Object {
        $lbl = if ($_.Label) { [string]$_.Label.Trim() } else { "" }
        $lbl -ne "" -and $lbl -ne "0" -and $lbl -ne "-" -and [string]::IsNullOrWhiteSpace($lbl) -eq $false
    } | Sort-Object ReplaceDate)
    Write-EngineDebug 'CLEAN' "Clean replacements: $($cleanRep.Count) valid records" 'Green'

    # ===== STAGE 4: GROUP REPLACEMENTS BY Part|DieSet =====
    Write-EngineDebug 'GROUP' '--- STAGE 4: Group replacements by Part|DieSet ---' 'Yellow'
    $groups = @{}
    foreach ($r in $cleanRep) {
        $pName = [string]$r.Part
        $dSet = [string]$r.DieSet
        $gKey = if ($pName) { "$pName|$dSet" } else { $dSet }
        if (-not $groups.ContainsKey($gKey)) { $groups[$gKey] = @() }
        $groups[$gKey] += $r
    }
    Write-EngineDebug 'GROUP' "Groups created: $($groups.Count) unique Part|DieSet combinations" 'Green'
    $topGroups = $groups.GetEnumerator() | Sort-Object { $_.Value.Count } -Descending | Select-Object -First 5
    foreach ($g in $topGroups) {
        Write-EngineDebug 'GROUP' "  Top group: $($g.Key) = $($g.Value.Count) replacements"
    }

    # ===== STAGE 5: BUILD MASTER LOOKUP =====
    Write-EngineDebug 'MASTER' '--- STAGE 5: Build master lookup ---' 'Yellow'
    $masterLookup = @{}
    foreach ($m in $MasterData) {
        if (-not $m.PartName) { continue }
        $p = [string]$m.PartName.Trim().ToLower()
        if ($m.NewDieSet) { $masterLookup["$p|$([string]$m.NewDieSet.Trim().ToLower())"] = $m }
        if ($m.OldDieSet) { $masterLookup["$p|$([string]$m.OldDieSet.Trim().ToLower())"] = $m }
        if (-not $masterLookup.ContainsKey($p)) { $masterLookup[$p] = $m }
    }
    Write-EngineDebug 'MASTER' "Master lookup entries: $($masterLookup.Count)" 'Green'

    # ===== STAGE 6: CALCULATE CYCLES (Plan S5.2) =====
    Write-EngineDebug 'CYCLES' '--- STAGE 6: Calculate cycles ---' 'Yellow'
    $allCycles = @()
    $partStats = @{}
    $maxCumulativeShot = 0
    $processedGroups = 0

    foreach ($gKey in $groups.Keys) {
        $processedGroups++
        $events = @($groups[$gKey] | Sort-Object ReplaceDate)
        $pParts = $gKey.Split('|')
        $part = if ($pParts.Count -gt 1) { $pParts[0] } else { [string]$events[0].Part }
        $dieSet = if ($pParts.Count -gt 1) { $pParts[1] } else { $pParts[0] }

        # Find best series
        $bestSeries = ""
        foreach ($e in $events) {
            if ($e.Series -and [string]$e.Series.Trim().Length -gt $bestSeries.Length) {
                $bestSeries = [string]$e.Series.Trim()
            }
        }

        # Match shoot records - try Part match first, then DieSet match
        $shots = @($cleanShoot | Where-Object {
            $rPart = [string]($_.Part).Trim().ToLower()
            $rDie = [string]($_.DieSet).Trim().ToLower()
            $pLower = $part.Trim().ToLower()
            $dLower = $dieSet.Trim().ToLower()
            ($rPart -and $pLower -and $rPart -eq $pLower) -or
            ($rDie -and $dLower -and $rDie -eq $dLower) -or
            ($rDie -and $pLower -and $rDie -eq $pLower)
        } | Sort-Object Date)

        # Total shots
        $totalShotsForPart = 0
        foreach ($s in $shots) { $totalShotsForPart += SafeDecimal $s.Output }
        if ($totalShotsForPart -gt $maxCumulativeShot) { $maxCumulativeShot = $totalShotsForPart }

        # Cumulative shots at each replacement
        $repCumulativeShots = @()
        foreach ($e in $events) {
            $eDate = $e.ReplaceDate
            $cumBefore = 0
            foreach ($s in $shots) {
                if ($s.Date -lt $eDate) { $cumBefore += SafeDecimal $s.Output }
            }
            $repCumulativeShots += $cumBefore
        }

        # Build completed cycles
        if ($shots.Count -gt 0 -and $events.Count -gt 0) {
            $firstRepDate = $events[0].ReplaceDate
            $beforeShots = @($shots | Where-Object { $_.Date -lt $firstRepDate })
            $totalBefore = 0
            foreach ($bs in $beforeShots) { $totalBefore += SafeDecimal $bs.Output }

            if ($totalBefore -gt 0) {
                $allCycles += [pscustomobject]@{
                    Part = $part; Series = $bestSeries; DieSet = $dieSet
                    StartDate = $shots[0].Date; EndDate = $firstRepDate
                    CycleShots = $totalBefore
                }
            }

            for ($i = 0; $i -lt $events.Count - 1; $i++) {
                $st = $events[$i].ReplaceDate
                $en = $events[$i + 1].ReplaceDate
                if ($en -le $st) { continue }
                $betweenShots = @($shots | Where-Object { $_.Date -ge $st -and $_.Date -lt $en })
                $totalBetween = 0
                foreach ($bts in $betweenShots) { $totalBetween += SafeDecimal $bts.Output }
                if ($totalBetween -gt 0) {
                    $allCycles += [pscustomobject]@{
                        Part = $part; Series = $bestSeries; DieSet = $dieSet
                        StartDate = $st; EndDate = $en
                        CycleShots = $totalBetween
                    }
                }
            }
        }

        # Current Life
        $currentLife = 0
        if ($events.Count -gt 0) {
            $lastRepDate = $events[$events.Count - 1].ReplaceDate
            $afterShots = @($shots | Where-Object { $_.Date -ge $lastRepDate })
            foreach ($as in $afterShots) { $currentLife += SafeDecimal $as.Output }
        } else {
            $currentLife = $totalShotsForPart
        }

        $firstInstallDate = ""
        if ($shots.Count -gt 0) { $firstInstallDate = $shots[0].Date }
        $lastRepDateStr = ""
        if ($events.Count -gt 0) { $lastRepDateStr = $events[$events.Count - 1].ReplaceDate }

        $partStats[$gKey] = [pscustomobject]@{
            Part = $part; Series = $bestSeries; DieSet = $dieSet
            TotalShots = $totalShotsForPart; TotalReplacements = $events.Count
            RepCumulativeShots = $repCumulativeShots; CurrentLife = $currentLife
            FirstInstallDate = $firstInstallDate; LastReplacementDate = $lastRepDateStr
            MatchedShootRecords = $shots.Count
        }

        if ($processedGroups -le 5) {
            Write-EngineDebug 'CYCLES' "  [$processedGroups] $part|$dieSet : $($events.Count) reps, $($shots.Count) shoot matches, total=$totalShotsForPart, currentLife=$currentLife"
        }
    }
    Write-EngineDebug 'CYCLES' "Processed $processedGroups groups, found $($allCycles.Count) completed cycles" 'Green'

    # ===== STAGE 7: BUILD COMPONENT STATE (Plan S5.1) =====
    Write-EngineDebug 'STATE' '--- STAGE 7: Build Component State ---' 'Yellow'
    $summaryMap = @{}
    foreach ($c in $allCycles) {
        $sKey = if ($c.Part) { "$($c.Part)|$($c.DieSet)" } else { $c.DieSet }
        if (-not $summaryMap.ContainsKey($sKey)) { $summaryMap[$sKey] = @() }
        $summaryMap[$sKey] += $c
    }

    # Dynamic milestones
    $milestoneStep = 50000
    $maxMilestone = [math]::Max(250000, [math]::Ceiling($maxCumulativeShot / $milestoneStep) * $milestoneStep)
    $milestones = @()
    for ($m = $milestoneStep; $m -le $maxMilestone; $m += $milestoneStep) { $milestones += $m }
    Write-EngineDebug 'STATE' "Milestones: $($milestones -join ', ')"

    $componentStateList = @()
    $wearMatrix = @()

    foreach ($sKey in $partStats.Keys) {
        $stat = $partStats[$sKey]
        $cList = if ($summaryMap.ContainsKey($sKey)) { @($summaryMap[$sKey]) } else { @() }
        $compCount = $cList.Count
        $vals = @($cList | ForEach-Object { [double]$_.CycleShots })
        $sumVal = 0; foreach ($v in $vals) { $sumVal += $v }

        # Historical metrics (completed cycles only)
        $minVal = if ($vals.Count -gt 0) { ($vals | Measure-Object -Minimum).Minimum } else { 0 }
        $maxVal = if ($vals.Count -gt 0) { ($vals | Measure-Object -Maximum).Maximum } else { 0 }
        $avgVal = if ($vals.Count -gt 0) { [math]::Round($sumVal / $vals.Count) } else { 0 }

        $medianVal = 0
        if ($vals.Count -gt 0) {
            $sortedVals = @($vals | Sort-Object)
            $mid = [math]::Floor($sortedVals.Count / 2)
            if ($sortedVals.Count % 2 -ne 0) { $medianVal = $sortedVals[$mid] }
            else { $medianVal = [math]::Round(($sortedVals[$mid - 1] + $sortedVals[$mid]) / 2) }
        }

        # Status
        $status = "ACTIVE"
        if ($stat.TotalShots -eq 0 -and $stat.MatchedShootRecords -eq 0) { $status = "NO_DATA" }

        # Canonical Code
        $canonicalCode = $stat.Part
        if ($stat.Series) { $canonicalCode += "/$($stat.Series)" }
        if ($stat.DieSet) { $canonicalCode += "/$($stat.DieSet)" }

        # Milestones
        $milestoneCounts = [ordered]@{}
        foreach ($mVal in $milestones) {
            $cnt = 0
            foreach ($rcs in $stat.RepCumulativeShots) { if ($rcs -le $mVal) { $cnt++ } }
            $milestoneCounts["$($mVal / 1000)k"] = $cnt
        }

        # Wear % and remaining (for report format)
        $wearPercent = 0
        $remainingShots = 0
        $shotUsed = $stat.CurrentLife
        if ($avgVal -gt 0) {
            $wearPercent = [math]::Round(($shotUsed / $avgVal) * 100)
            $remainingShots = [math]::Max(0, $avgVal - $shotUsed)
        }

        # Tinh trang (Status per sample report format)
        $tinhTrang = "GOOD"
        if ($wearPercent -ge 95) { $tinhTrang = "CAN THAY THE" }
        elseif ($wearPercent -ge 80) { $tinhTrang = "SAP DEN HAN" }

        $componentStateList += [pscustomobject]@{
            Component = $canonicalCode
            Mold = $stat.DieSet
            Part = $stat.Part
            Series = $stat.Series
            # Report format fields (matching sample Theo_doi_tuoi_tho)
            MaKhuon = $stat.DieSet
            TenLinhKien = $stat.Part
            MaLinhKien = $canonicalCode
            NgayLap = $stat.FirstInstallDate
            ShotTaiThoiDiemLap = if ($stat.TotalShots -gt 0 -and $stat.TotalReplacements -gt 0) { [math]::Max(0, $stat.TotalShots - $shotUsed) } else { 0 }
            ShotHienTai = $stat.TotalShots
            ShotDaSuDung = $shotUsed
            ShotConLai = $remainingShots
            PhanTramSuDung = $wearPercent
            NgayKiemTraGanNhat = $stat.LastReplacementDate
            TinhTrang = $tinhTrang
            NgayThayThe = $stat.LastReplacementDate
            # Engine fields
            CurrentShot = $stat.TotalShots
            TotalShot = $stat.TotalShots
            ReplacementCount = $stat.TotalReplacements
            FirstInstallDate = $stat.FirstInstallDate
            LastReplacementDate = $stat.LastReplacementDate
            CurrentLife = $stat.CurrentLife
            CycleCount = $compCount
            MinLife = $minVal
            MaxLife = $maxVal
            AverageLife = $avgVal
            MedianLife = $medianVal
            Status = $status
            WearPercent = $wearPercent
            RemainingShots = $remainingShots
            CompletedCycles = $compCount
            TotalShots = $stat.TotalShots
            TotalReplacements = $stat.TotalReplacements
            MinShots = $minVal
            MaxShots = $maxVal
            AverageShots = $avgVal
            MatchedShootRecords = $stat.MatchedShootRecords
        }

        $wearMatrix += [pscustomobject]@{
            Part = $stat.Part; Series = $stat.Series; DieSet = $stat.DieSet
            Milestones = $milestoneCounts; TotalReplacements = $stat.TotalReplacements
        }
    }

    Write-EngineDebug 'STATE' "Component State built: $($componentStateList.Count) components" 'Green'

    # ===== STAGE 8: DEBUG SUMMARY =====
    Write-EngineDebug 'SUMMARY' '--- STAGE 8: Debug Summary ---' 'Yellow'
    $activeCount = @($componentStateList | Where-Object { $_.Status -eq 'ACTIVE' }).Count
    $noDataCount = @($componentStateList | Where-Object { $_.Status -eq 'NO_DATA' }).Count
    $withCycles = @($componentStateList | Where-Object { $_.CycleCount -gt 0 }).Count
    $needReplace = @($componentStateList | Where-Object { $_.WearPercent -ge 95 }).Count
    $nearLimit = @($componentStateList | Where-Object { $_.WearPercent -ge 80 -and $_.WearPercent -lt 95 }).Count
    $goodCount = @($componentStateList | Where-Object { $_.WearPercent -lt 80 }).Count

    Write-EngineDebug 'SUMMARY' "  Total components: $($componentStateList.Count)"
    Write-EngineDebug 'SUMMARY' "  ACTIVE (has shoot data): $activeCount"
    Write-EngineDebug 'SUMMARY' "  NO_DATA (no shoot matches): $noDataCount"
    Write-EngineDebug 'SUMMARY' "  With completed cycles: $withCycles"
    Write-EngineDebug 'SUMMARY' "  Total completed cycles: $($allCycles.Count)"
    Write-EngineDebug 'SUMMARY' "  ---"
    Write-EngineDebug 'SUMMARY' "  GOOD (< 80%%): $goodCount" 'Green'
    Write-EngineDebug 'SUMMARY' "  SAP DEN HAN (80-95%%): $nearLimit" 'Yellow'
    Write-EngineDebug 'SUMMARY' "  CAN THAY THE (>= 95%%): $needReplace" 'Red'

    # Top 5 most replaced
    $top5 = @($componentStateList | Sort-Object TotalReplacements -Descending | Select-Object -First 5)
    Write-EngineDebug 'SUMMARY' "  --- Top 5 Most Replaced ---"
    foreach ($t in $top5) {
        Write-EngineDebug 'SUMMARY' "    $($t.Part)/$($t.Series)/$($t.Mold) : $($t.TotalReplacements) reps, AvgLife=$($t.AverageLife), CurrentLife=$($t.CurrentLife), Wear=$($t.WearPercent)%%, Shoots=$($t.MatchedShootRecords)"
    }

    $sw.Stop()
    Write-EngineDebug 'DONE' "========== ENGINE COMPLETE in $($sw.ElapsedMilliseconds)ms ==========" 'Green'

    # ===== RETURN =====
    return @{
        success = $true
        message = "Calculation Engine hoan tat! $($componentStateList.Count) components, $($allCycles.Count) cycles"
        shoot = $cleanShoot
        replacements = $cleanRep
        cycles = $allCycles
        milestones = $milestones
        wearMatrix = $wearMatrix
        summary = $componentStateList
        componentState = $componentStateList
        debug = @{
            totalComponents = $componentStateList.Count
            activeCount = $activeCount
            noDataCount = $noDataCount
            withCyclesCount = $withCycles
            totalCycles = $allCycles.Count
            goodCount = $goodCount
            nearLimitCount = $nearLimit
            needReplaceCount = $needReplace
            elapsedMs = $sw.ElapsedMilliseconds
        }
    }
}

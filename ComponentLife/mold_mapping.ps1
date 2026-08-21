<#
.SYNOPSIS
    mold_mapping.ps1 - Module Logic Ghep & Anh Xa Ten Khuon Cu <-> Khuon Moi (OldDieSet <-> NewDieSet)
.DESCRIPTION
    Cung cap cac ham chuan hoa, phan loai, ghep noi va tu dong anh xa 2 chieu:
    - Nhan dien dinh dang khuon cu (FA*, IR*, IRSV*, M*, MF*, YG*, YW*) va khuon moi (H*).
    - Xay dung ban do anh xa 2 chieu (Old -> New, New -> Old, Series + Old -> New).
    - Tu dong dien cheo ma khuon cho toan bo Master Data, Replacement Log va Shoot Data.
    - Dinh dang hien thi chuoi ket hop khuon va series (vd: M1058/H10106B03 hoac 10106B-E1C/M1058/H10106B03).
    - Co the chay doc lap de kiem tra va thong ke danh sach khuon da ghep / chua ghep.
#>

param (
    [string]$MasterPath = "$PSScriptRoot\ComponentMaster.json",
    [string]$ReplacementPath = "$PSScriptRoot\data\replacement-log.json",
    [string]$ShootPath = "$PSScriptRoot\data\shoot-data.json",
    [switch]$ReportOnly
)

# ===== 1. CAC HAM TIEN ICH PHAN LOAI VA DINH DANG MA KHUON =====

function Get-MoldType {
    param ([string]$MoldCode)
    if ([string]::IsNullOrWhiteSpace($MoldCode)) { return "EMPTY" }
    $code = $MoldCode.Trim().ToUpper()

    if ($code -match '^H\d+') { return "NEW" }
    if ($code -match '^(FA|IR|IRSV|M\d|MF|YG|YW)') { return "OLD" }
    return "UNKNOWN"
}

function Format-MoldDisplay {
    param (
        [string]$MoldOld,
        [string]$MoldNew
    )
    $o = if ($MoldOld) { $MoldOld.Trim() } else { "" }
    $n = if ($MoldNew) { $MoldNew.Trim() } else { "" }

    if ($o -and $n -and ($o.ToLower() -ne $n.ToLower())) {
        return "$o/$n"
    }
    if ($n) { return $n }
    if ($o) { return $o }
    return "-"
}

function Format-MoldSeriesDisplay {
    param (
        [string]$Series,
        [string]$MoldOld,
        [string]$MoldNew,
        [switch]$AsHtml
    )
    $s = if ($Series) { $Series.Trim() } else { "-" }
    $o = if ($MoldOld) { $MoldOld.Trim() } else { "" }
    $n = if ($MoldNew) { $MoldNew.Trim() } else { "" }

    if ($o -and $n -and ($o.ToLower() -ne $n.ToLower())) {
        return "$s/$o/$n"
    }

    if ($n -and (-not $o -or ($n.ToLower() -eq $o.ToLower())) -and (Get-MoldType $n -eq "NEW")) {
        return "$s/$n"
    }

    $moldToCheck = if ($o) { $o } else { $n }
    if ($moldToCheck) {
        if ($AsHtml) {
            $badge = '<span class="badge-unmapped" style="color:#dc2626;background:#fee2e2;border:1px solid #fca5a5;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:700;">[Chua Map]</span>'
            return "$s/$moldToCheck/$badge"
        }
        return "$s/$moldToCheck/[Chua Map]"
    }

    return $s
}

# ===== 2. HAM XAY DUNG BAN DO ANH XA MA KHUON (MOLD MAPPING TABLE) =====

function Build-MoldMappingTable {
    param (
        $MasterList,
        $ReplacementList
    )

    $knownNewByOld = @{}
    $knownOldByNew = @{}
    $seriesOldToNew = @{}
    $partOldToNew = @{}

    $mList = @($MasterList)
    if ($mList.Count -eq 1 -and ($mList[0] -is [System.Collections.IList] -or $mList[0] -is [Array])) {
        $mList = @($mList[0])
    }

    foreach ($item in $mList) {
        $o = if ($item.OldDieSet) { [string]$item.OldDieSet.Trim() } else { "" }
        $n = if ($item.NewDieSet) { [string]$item.NewDieSet.Trim() } else { "" }
        $s = if ($item.Series) { [string]$item.Series.Trim() } else { "" }
        $p = if ($item.PartName) { [string]$item.PartName.Trim() } else { "" }

        $oLower = $o.ToLower()
        $nLower = $n.ToLower()

        if ($o -and $n -and ($oLower -ne $nLower)) {
            $knownNewByOld[$oLower] = $n
            $knownOldByNew[$nLower] = $o
            if ($s) { $seriesOldToNew["$($s.ToLower())|$oLower"] = $n }
            if ($p) { $partOldToNew["$($p.ToLower())|$oLower"] = $n }
        } elseif ($o -and -not $n) {
            if (Get-MoldType $o -eq "NEW") {
                $knownOldByNew[$oLower] = $o
            }
        }
    }

    $rList = @($ReplacementList)
    if ($rList.Count -eq 1 -and ($rList[0] -is [System.Collections.IList] -or $rList[0] -is [Array])) {
        $rList = @($rList[0])
    }

    foreach ($r in $rList) {
        $o = if ($r.OldDieSet) { [string]$r.OldDieSet.Trim() } else { "" }
        $n = if ($r.NewDieSet) { [string]$r.NewDieSet.Trim() } else { "" }

        $oLower = $o.ToLower()
        $nLower = $n.ToLower()

        if ($o -and $n -and ($oLower -ne $nLower)) {
            if (-not $knownNewByOld.ContainsKey($oLower)) { $knownNewByOld[$oLower] = $n }
            if (-not $knownOldByNew.ContainsKey($nLower)) { $knownOldByNew[$nLower] = $o }
        }
    }

    return [pscustomobject]@{
        KnownNewByOld  = $knownNewByOld
        KnownOldByNew  = $knownOldByNew
        SeriesOldToNew = $seriesOldToNew
        PartOldToNew   = $partOldToNew
    }
}

# ===== 3. HAM TU DONG DIEN VA GHEP KHUON (RESOLVE & APPLY) =====

function Resolve-MoldItem {
    param (
        [string]$Part,
        [string]$RawMold,
        [string]$Series,
        [object]$MappingContext
    )
    $pLower = if ($Part) { $Part.Trim().ToLower() } else { "" }
    $mLower = if ($RawMold) { $RawMold.Trim().ToLower() } else { "" }
    $sLower = if ($Series) { $Series.Trim().ToLower() } else { "" }

    $moldOld = ""
    $moldNew = ""

    if ($mLower -and $MappingContext) {
        if ($MappingContext.KnownNewByOld.ContainsKey($mLower)) {
            $moldOld = $RawMold.Trim().ToUpper()
            $moldNew = $MappingContext.KnownNewByOld[$mLower]
        } elseif ($MappingContext.KnownOldByNew.ContainsKey($mLower)) {
            $moldNew = $RawMold.Trim().ToUpper()
            $moldOld = $MappingContext.KnownOldByNew[$mLower]
        } else {
            if (Get-MoldType $RawMold -eq "NEW") {
                $moldNew = $RawMold.Trim().ToUpper()
            } else {
                $moldOld = $RawMold.Trim().ToUpper()
            }
        }
    }

    if (-not $moldNew -and $sLower -and $mLower -and $MappingContext -and $MappingContext.SeriesOldToNew.ContainsKey("$sLower|$mLower")) {
        $moldNew = $MappingContext.SeriesOldToNew["$sLower|$mLower"]
    }
    if (-not $moldNew -and $pLower -and $mLower -and $MappingContext -and $MappingContext.PartOldToNew.ContainsKey("$pLower|$mLower")) {
        $moldNew = $MappingContext.PartOldToNew["$pLower|$mLower"]
    }

    return [pscustomobject]@{
        PartName     = $Part
        Series       = $Series
        OldDieSet    = $moldOld
        NewDieSet    = $moldNew
        CombinedMold = Format-MoldDisplay $moldOld $moldNew
        CombinedFull = Format-MoldSeriesDisplay $Series $moldOld $moldNew
    }
}

function Apply-MoldCrossResolution {
    param (
        $MasterList,
        $ReplacementList,
        $ShootList
    )

    $mapping = Build-MoldMappingTable -MasterList $MasterList -ReplacementList $ReplacementList

    $mList = @($MasterList)
    if ($mList.Count -eq 1 -and ($mList[0] -is [System.Collections.IList] -or $mList[0] -is [Array])) {
        $mList = @($mList[0])
    }

    foreach ($item in $mList) {
        $o = if ($item.OldDieSet) { [string]$item.OldDieSet.Trim() } else { "" }
        $n = if ($item.NewDieSet) { [string]$item.NewDieSet.Trim() } else { "" }
        $oLower = $o.ToLower()
        $nLower = $n.ToLower()

        if (($o -eq $n -or -not $n) -and $mapping.KnownNewByOld.ContainsKey($oLower)) {
            $item.NewDieSet = $mapping.KnownNewByOld[$oLower]
        } elseif (($o -eq $n -or -not $o) -and $mapping.KnownOldByNew.ContainsKey($nLower)) {
            $item.OldDieSet = $mapping.KnownOldByNew[$nLower]
        }
    }

    $rList = @($ReplacementList)
    if ($rList.Count -eq 1 -and ($rList[0] -is [System.Collections.IList] -or $rList[0] -is [Array])) {
        $rList = @($rList[0])
    }

    foreach ($r in $rList) {
        $d = if ($r.DieSet) { [string]$r.DieSet.Trim() } else { "" }
        $o = if ($r.OldDieSet) { [string]$r.OldDieSet.Trim() } else { "" }
        $n = if ($r.NewDieSet) { [string]$r.NewDieSet.Trim() } else { "" }

        $lookupKey = if ($o) { $o.ToLower() } else { $d.ToLower() }
        if ($mapping.KnownNewByOld.ContainsKey($lookupKey)) {
            $r.NewDieSet = $mapping.KnownNewByOld[$lookupKey]
            if (-not $r.OldDieSet -or $r.OldDieSet -eq $r.NewDieSet) {
                $r.OldDieSet = $lookupKey.ToUpper()
            }
        } elseif ($mapping.KnownOldByNew.ContainsKey($lookupKey)) {
            $r.OldDieSet = $mapping.KnownOldByNew[$lookupKey]
        }
    }

    return $mapping
}

# ===== 4. STANDALONE CLI EXECUTION & REPORTING =====

if ($MyInvocation.InvocationName -ne '.') {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "   MOLD MAPPING ENGINE - BAO CAO ANH XA KHUON CU <-> MOI   " -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Cyan

    $masterItems = @()
    if (Test-Path $MasterPath) {
        $masterItems = @(Get-Content $MasterPath -Raw -Encoding UTF8 | ConvertFrom-Json)
        Write-Host " [+] Master Data: $($masterItems.Count) linh kien ($MasterPath)" -ForegroundColor Green
    } else {
        Write-Warning " [!] Khong tim thay Master Data tai $MasterPath"
    }

    $repItems = @()
    if (Test-Path $ReplacementPath) {
        $repItems = @(Get-Content $ReplacementPath -Raw -Encoding UTF8 | ConvertFrom-Json)
        Write-Host " [+] Replacement Data: $($repItems.Count) luot thay ($ReplacementPath)" -ForegroundColor Green
    }

    $mappingContext = Build-MoldMappingTable -MasterList $masterItems -ReplacementList $repItems
    $mappedCount = $mappingContext.KnownNewByOld.Count

    Write-Host ""
    Write-Host " [★] Tong so cap khuon Cu <-> Moi da ghep thanh cong: $mappedCount cap" -ForegroundColor Yellow
    Write-Host "----------------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ("{0,-16} | {1,-16} | {2,-30}" -f "KHUON CU (Old)", "KHUON MOI (New)", "CHUOI GHEP HIEN THI") -ForegroundColor White
    Write-Host "----------------------------------------------------------------------" -ForegroundColor DarkGray

    $allKeys = @($mappingContext.KnownNewByOld.Keys | Sort-Object)
    foreach ($oldKey in $allKeys) {
        $oldName = $oldKey.ToUpper()
        $newName = $mappingContext.KnownNewByOld[$oldKey]
        $display = Format-MoldDisplay $oldName $newName
        Write-Host ("{0,-16} | {1,-16} | {2,-30}" -f $oldName, $newName, $display) -ForegroundColor Cyan
    }

    Write-Host "----------------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host " [OK] Hoan tat bao cao Mold Mapping." -ForegroundColor Green
    Write-Host ""
}

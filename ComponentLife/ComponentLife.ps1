param(
    [int]$Port = 8787,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

# ===== SINGLE INSTANCE CHECK =====
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "Global\ComponentLife_SingleInstance_Mutex_v2", [ref]$createdNew)
if (-not $createdNew) {
    $url = "http://127.0.0.1:$Port/"
    if (-not $NoBrowser) { Start-Process $url }
    exit 0
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $Root 'data'
$ReportDir = Join-Path $Root 'reports'
$ShootFile = Join-Path $DataDir 'shoot-data.json'
$ReplacementFile = Join-Path $DataDir 'replacement-log.json'

foreach ($folder in @($DataDir, $ReportDir)) { if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null } }

$listener = $null
$boundPort = $Port
for ($p = $Port; $p -le $Port + 50; $p++) {
    try {
        $l = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback, $p)
        $l.Start()
        $listener = $l
        $boundPort = $p
        break
    } catch {
        continue
    }
}

if (-not $listener) {
    if ($mutex) { try { $mutex.ReleaseMutex() } catch {}; try { $mutex.Dispose() } catch {} }
    throw "Khong the khoi dong local server."
}

$url = "http://127.0.0.1:$boundPort/"
Write-Host "Component Life đang chay tai $url (nhan Ctrl+C de dung)" -ForegroundColor Green
if (-not $NoBrowser) { Start-Process $url }

$global:lastHeartbeat = [DateTime]::Now
$global:hasReceivedHeartbeat = $false
$global:shouldShutdown = $false

try {
    while ($true) {
        if ($global:shouldShutdown) {
            Write-Host "Shutting down ComponentLife server..." -ForegroundColor Yellow
            break
        }
        if ($global:hasReceivedHeartbeat -and ([DateTime]::Now - $global:lastHeartbeat).TotalSeconds -gt 5) {
            Write-Host "Browser closed (heartbeat timeout). Stopping ComponentLife server..." -ForegroundColor Yellow
            break
        }

        if (-not $listener.Pending()) {
            Start-Sleep -Milliseconds 100
            continue
        }

        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        
        $requestLine = $reader.ReadLine()
        if ([string]::IsNullOrEmpty($requestLine)) { $client.Close(); continue }
        
        $parts = $requestLine.Split(' ')
        $method = $parts[0]
        $rawPath = if ($parts.Length -gt 1) { $parts[1] } else { '/' }
        $path = $rawPath.Split('?')[0]

        $contentLength = 0
        while ($true) {
            $line = $reader.ReadLine()
            if ([string]::IsNullOrEmpty($line)) { break }
            if ($line.ToLower().StartsWith("content-length:")) {
                $contentLength = [int]($line.Split(':')[1].Trim())
            }
        }

        $bodyText = ""
        if ($contentLength -gt 0) {
            $charBuffer = New-Object char[] $contentLength
            $readCount = 0
            while ($readCount -lt $contentLength) {
                $n = $reader.Read($charBuffer, $readCount, $contentLength - $readCount)
                if ($n -le 0) { break }
                $readCount += $n
            }
            $bodyText = New-Object string($charBuffer, 0, $readCount)
        }

        $responseBytes = [byte[]]@()
        $statusLine = "HTTP/1.1 200 OK`r`n"
        $contentType = "text/html; charset=utf-8"

        try {
            if ($path -eq '/index.html' -or $path -eq '/ComponentLife.html') {
                $htmlFile = Join-Path $Root 'ComponentLife.html'
                if (-not (Test-Path $htmlFile)) { $htmlFile = Join-Path $Root 'index.html' }
                $responseBytes = [System.IO.File]::ReadAllBytes($htmlFile)
                $contentType = "text/html; charset=utf-8"
            }
            elseif ($path -eq '/' -or $path -eq '/api/heartbeat') {
                if ($path -eq '/') {
                    $htmlFile = Join-Path $Root 'ComponentLife.html'
                    if (-not (Test-Path $htmlFile)) { $htmlFile = Join-Path $Root 'index.html' }
                    $responseBytes = [System.IO.File]::ReadAllBytes($htmlFile)
                    $contentType = "text/html; charset=utf-8"
                } else {
                    $global:lastHeartbeat = [DateTime]::Now
                    $global:hasReceivedHeartbeat = $true
                    $resObj = [pscustomobject]@{ status = "ok"; time = $global:lastHeartbeat.ToString("o") }
                    $responseBytes = [System.Text.Encoding]::UTF8.GetBytes(($resObj | ConvertTo-Json))
                    $contentType = "application/json; charset=utf-8"
                }
            }
            elseif ($path -eq '/api/shutdown') {
                $global:shouldShutdown = $true
                $resObj = [pscustomobject]@{ status = "shutdown_initiated" }
                $responseBytes = [System.Text.Encoding]::UTF8.GetBytes(($resObj | ConvertTo-Json))
                $contentType = "application/json; charset=utf-8"
            }
            elseif ($path.StartsWith("/data/") -or $path.EndsWith(".json") -or $path.EndsWith(".js") -or $path.EndsWith(".css")) {
                $rel = $path.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
                $targetFile = Join-Path $Root $rel
                if (Test-Path $targetFile -PathType Leaf) {
                    $responseBytes = [System.IO.File]::ReadAllBytes($targetFile)
                    $ext = [System.IO.Path]::GetExtension($targetFile).ToLower()
                    if ($ext -eq '.json') { $contentType = "application/json; charset=utf-8" }
                    elseif ($ext -eq '.js') { $contentType = "application/javascript; charset=utf-8" }
                    elseif ($ext -eq '.css') { $contentType = "text/css; charset=utf-8" }
                } else {
                    $statusLine = "HTTP/1.1 404 Not Found`r`n"
                    $responseBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"File not found"}')
                    $contentType = "application/json; charset=utf-8"
                }
            }
            elseif ($path -eq '/api/import/shoot' -and $method -eq 'POST') {
                $body = $bodyText | ConvertFrom-Json
                $map = [ordered]@{}
                foreach ($row in @($body.rows)) {
                    if ($null -eq $row.Output -or [string]$row.Output -eq "") { continue }
                    $outVal = [decimal]$row.Output
                    if ($outVal -le 0) { continue }
                    $partStr = if ($row.Part) { [string]$row.Part } else { "" }
                    $dieStr = if ($row.DieSet) { [string]$row.DieSet } else { "" }
                    $key = "$($row.Date)|$partStr|$dieStr"
                    if ($map.Contains($key)) {
                        $map[$key].Output += $outVal
                    } else {
                        $map[$key] = [pscustomobject]@{ Date=[string]$row.Date; Part=$partStr; DieSet=$dieStr; Output=$outVal }
                    }
                }
                $cleanList = @($map.Values | Sort-Object Date, Part, DieSet)
                $jsonStr = $cleanList | ConvertTo-Json -Depth 8
                if ($cleanList.Count -eq 0) { $jsonStr = "[]" }
                elseif ($cleanList.Count -eq 1 -and -not $jsonStr.Trim().StartsWith("[")) { $jsonStr = "[$jsonStr]" }
                [System.IO.File]::WriteAllText($ShootFile, $jsonStr, (New-Object System.Text.UTF8Encoding($false)))
                $resObj = [pscustomobject]@{ success=$true; count=$cleanList.Count }
                $responseBytes = [System.Text.Encoding]::UTF8.GetBytes(($resObj | ConvertTo-Json))
                $contentType = "application/json; charset=utf-8"
            }
            elseif ($path -eq '/api/import/replacements' -and $method -eq 'POST') {
                $body = $bodyText | ConvertFrom-Json
                $items = @($body.rows | ForEach-Object { [pscustomobject]@{ Part=[string]$_.Part; Series=[string]$_.Series; DieSet=[string]$_.DieSet; ReplaceDate=[string]$_.ReplaceDate; Label=[string]$_.Label } })
                $jsonStr = $items | ConvertTo-Json -Depth 8
                if ($items.Count -eq 0) { $jsonStr = "[]" }
                elseif ($items.Count -eq 1 -and -not $jsonStr.Trim().StartsWith("[")) { $jsonStr = "[$jsonStr]" }
                [System.IO.File]::WriteAllText($ReplacementFile, $jsonStr, (New-Object System.Text.UTF8Encoding($false)))
                $resObj = [pscustomobject]@{ count=$items.Count }
                $responseBytes = [System.Text.Encoding]::UTF8.GetBytes(($resObj | ConvertTo-Json))
                $contentType = "application/json; charset=utf-8"
            }
            elseif ($path -eq '/api/update' -and $method -eq 'POST') {
                $body = if ($bodyText) { $bodyText | ConvertFrom-Json } else { $null }

                # Use rawShoot from request if provided by client, otherwise load from ShootFile on disk
                if ($body -and ($null -ne $body.rawShoot)) {
                    $map = [ordered]@{}
                    foreach ($row in @($body.rawShoot)) {
                        if ($null -eq $row.Output -or [string]$row.Output -eq "") { continue }
                        $outVal = [decimal]$row.Output
                        if ($outVal -le 0) { continue }
                        $partStr = if ($row.Part) { [string]$row.Part } else { "" }
                        $dieStr = if ($row.DieSet) { [string]$row.DieSet } else { "" }
                        $key = "$($row.Date)|$partStr|$dieStr"
                        if ($map.Contains($key)) {
                            $map[$key].Output += $outVal
                        } else {
                            $map[$key] = [pscustomobject]@{ Date=[string]$row.Date; Part=$partStr; DieSet=$dieStr; Output=$outVal }
                        }
                    }
                    $rawShootList = @($map.Values | Sort-Object Date, Part, DieSet)
                    $jsonStr = $rawShootList | ConvertTo-Json -Depth 8
                    if ($rawShootList.Count -eq 0) { $jsonStr = "[]" }
                    elseif ($rawShootList.Count -eq 1 -and -not $jsonStr.Trim().StartsWith("[")) { $jsonStr = "[$jsonStr]" }
                    [System.IO.File]::WriteAllText($ShootFile, $jsonStr, (New-Object System.Text.UTF8Encoding($false)))
                } elseif (Test-Path $ShootFile) {
                    $rawShootList = @(Get-Content $ShootFile -Raw -Encoding UTF8 | ConvertFrom-Json)
                } else {
                    $rawShootList = @()
                }
                $repList = if ($body -and ($null -ne $body.replacements)) { @($body.replacements) } elseif (Test-Path $ReplacementFile) { @(Get-Content $ReplacementFile -Raw -Encoding UTF8 | ConvertFrom-Json) } else { @() }

                # Build in-memory shoot map for calculations & display
                $shootMap = [ordered]@{}
                foreach ($s in $rawShootList) {
                    $partStr = if ($s.Part) { [string]$s.Part } else { "" }
                    $dieStr = if ($s.DieSet) { [string]$s.DieSet } else { "" }
                    $key = "$($s.Date)|$partStr|$dieStr"
                    $outVal = [decimal]($s.Output)
                    if ($outVal -gt 0) {
                        if ($shootMap.Contains($key)) {
                            $shootMap[$key].Output += $outVal
                        } else {
                            $shootMap[$key] = [pscustomobject]@{ Date = [string]$s.Date; Part = $partStr; DieSet = $dieStr; Output = $outVal }
                        }
                    }
                }

                $cleanShoot = @($shootMap.Values | Sort-Object Date, Part, DieSet)
                $cleanRep = @($repList | Where-Object {
                    $lbl = if ($_.Label) { [string]$_.Label.Trim() } else { "" }
                    $lbl -ne "" -and $lbl -ne "0" -and $lbl -ne "-" -and $lbl -ne "·"
                } | Sort-Object ReplaceDate)

                $repJson = $cleanRep | ConvertTo-Json -Depth 8
                if ($cleanRep.Count -eq 0) { $repJson = "[]" }
                elseif ($cleanRep.Count -eq 1 -and -not $repJson.Trim().StartsWith("[")) { $repJson = "[$repJson]" }
                [System.IO.File]::WriteAllText($ReplacementFile, $repJson, (New-Object System.Text.UTF8Encoding($false)))

                # Calculate Cycles, Total Shots, Wear Milestones & Replacement Frequency in PowerShell
                $cycles = @()
                $groups = @{}
                foreach ($r in $cleanRep) {
                    $pName = [string]$r.Part
                    $dSet = [string]$r.DieSet
                    $gKey = if ($pName) { "$pName|$dSet" } else { $dSet }
                    if (-not $groups.ContainsKey($gKey)) { $groups[$gKey] = @() }
                    $groups[$gKey] += $r
                }

                $partStats = @{}
                $maxCumulativeShot = 0

                foreach ($gKey in $groups.Keys) {
                    $events = @($groups[$gKey] | Sort-Object ReplaceDate)
                    $pParts = $gKey.Split('|')
                    $part = if ($pParts.Count -gt 1) { $pParts[0] } else { [string]$events[0].Part }
                    $dieSet = if ($pParts.Count -gt 1) { $pParts[1] } else { $pParts[0] }

                    $bestSeries = ""
                    foreach ($e in $events) {
                        if ($e.Series -and [string]$e.Series.Trim().Length -gt $bestSeries.Length) {
                            $bestSeries = [string]$e.Series.Trim()
                        }
                    }

                    $shots = @($cleanShoot | Where-Object {
                        $_.Output -gt 0 -and (
                            ($part -and $_.Part -and [string]$_.Part.Trim().ToLower() -eq $part.ToLower()) -or
                            (-not $_.Part -and (($dieSet -and [string]$_.DieSet.Trim().ToLower() -eq $dieSet.ToLower()) -or ($part -and [string]$_.DieSet.Trim().ToLower() -eq $part.ToLower())))
                        )
                    } | Sort-Object Date)

                    $totalShotsForPart = 0
                    foreach ($s in $shots) { $totalShotsForPart += [decimal]$s.Output }
                    if ($totalShotsForPart -gt $maxCumulativeShot) { $maxCumulativeShot = $totalShotsForPart }

                    $repCumulativeShots = @()
                    foreach ($e in $events) {
                        $eDate = $e.ReplaceDate
                        $cumBefore = 0
                        foreach ($s in $shots) {
                            if ($s.Date -lt $eDate) { $cumBefore += [decimal]$s.Output }
                        }
                        $repCumulativeShots += $cumBefore
                    }

                    if ($shots.Count -gt 0 -and $events.Count -gt 0) {
                        $firstRepDate = $events[0].ReplaceDate
                        $beforeShots = @($shots | Where-Object { $_.Date -lt $firstRepDate })
                        $totalBefore = 0
                        foreach ($bs in $beforeShots) { $totalBefore += [decimal]$bs.Output }

                        if ($totalBefore -gt 0) {
                            $cycles += [pscustomobject]@{
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
                            foreach ($bts in $betweenShots) { $totalBetween += [decimal]$bts.Output }

                            if ($totalBetween -gt 0) {
                                $cycles += [pscustomobject]@{
                                    Part = $part; Series = $bestSeries; DieSet = $dieSet
                                    StartDate = $st; EndDate = $en
                                    CycleShots = $totalBetween
                                }
                            }
                        }
                    }

                    $partStats[$gKey] = [pscustomobject]@{
                        Part = $part
                        Series = $bestSeries
                        DieSet = $dieSet
                        TotalShots = $totalShotsForPart
                        TotalReplacements = $events.Count
                        RepCumulativeShots = $repCumulativeShots
                    }
                }

                # Determine dynamic 50k milestones
                $milestoneStep = 50000
                $maxMilestone = [math]::Max(250000, [math]::Ceiling($maxCumulativeShot / $milestoneStep) * $milestoneStep)
                $milestones = @()
                for ($m = $milestoneStep; $m -le $maxMilestone; $m += $milestoneStep) {
                    $milestones += $m
                }

                $summaryMap = @{}
                foreach ($c in $cycles) {
                    $pName = [string]$c.Part
                    $dSet = [string]$c.DieSet
                    $sKey = if ($pName) { "$pName|$dSet" } else { $dSet }
                    if (-not $summaryMap.ContainsKey($sKey)) { $summaryMap[$sKey] = @() }
                    $summaryMap[$sKey] += $c
                }

                $allAvgLives = @()
                foreach ($sKey in $partStats.Keys) {
                    $stat = $partStats[$sKey]
                    $cList = if ($summaryMap.ContainsKey($sKey)) { @($summaryMap[$sKey]) } else { @() }
                    if ($cList.Count -gt 0) {
                        $sumVal = 0
                        foreach ($c in $cList) { $sumVal += [double]$c.CycleShots }
                        $avg = [math]::Round($sumVal / $cList.Count)
                        if ($avg -gt 0) { $allAvgLives += $avg }
                    }
                }

                # Percentiles for Replacement Frequency
                $sortedAvgLives = @($allAvgLives | Sort-Object)
                $p33 = 70000
                $p67 = 150000
                if ($sortedAvgLives.Count -ge 3) {
                    $idx33 = [math]::Floor($sortedAvgLives.Count * 0.33)
                    $idx67 = [math]::Floor($sortedAvgLives.Count * 0.67)
                    $p33 = $sortedAvgLives[$idx33]
                    $p67 = $sortedAvgLives[$idx67]
                }

                $summaryList = @()
                $wearMatrix = @()

                foreach ($sKey in $partStats.Keys) {
                    $stat = $partStats[$sKey]
                    $cList = if ($summaryMap.ContainsKey($sKey)) { @($summaryMap[$sKey]) } else { @() }
                    $compCount = $cList.Count
                    $vals = @($cList | ForEach-Object { [double]$_.CycleShots })
                    $sumVal = 0
                    foreach ($v in $vals) { $sumVal += $v }
                    $minVal = if ($vals.Count -gt 0) { ($vals | Measure-Object -Minimum).Minimum } else { $stat.TotalShots }
                    $maxVal = if ($vals.Count -gt 0) { ($vals | Measure-Object -Maximum).Maximum } else { $stat.TotalShots }
                    $avgVal = if ($vals.Count -gt 0) { [math]::Round($sumVal / $vals.Count) } else { $stat.TotalShots }

                    # Replacement frequency rating
                    $freq = "LOW"
                    if ($stat.TotalReplacements -ge 5 -or ($avgVal -gt 0 -and $avgVal -le $p33)) {
                        $freq = "HIGH"
                    } elseif ($stat.TotalReplacements -ge 2 -or ($avgVal -gt 0 -and $avgVal -le $p67)) {
                        $freq = "MEDIUM"
                    }

                    # Milestone breakdown: cumulative replacements at <= milestone
                    $milestoneCounts = [ordered]@{}
                    $firstMilestone = $null
                    foreach ($mVal in $milestones) {
                        $cnt = 0
                        foreach ($rcs in $stat.RepCumulativeShots) {
                            if ($rcs -le $mVal) { $cnt++ }
                        }
                        $milestoneCounts["$($mVal / 1000)k"] = $cnt
                        if ($cnt -gt 0 -and $null -eq $firstMilestone) {
                            $firstMilestone = "$($mVal / 1000)k"
                        }
                    }

                    $summaryList += [pscustomobject]@{
                        Part = $stat.Part
                        Series = $stat.Series
                        DieSet = $stat.DieSet
                        CompletedCycles = $compCount
                        TotalShots = $stat.TotalShots
                        TotalReplacements = $stat.TotalReplacements
                        MinShots = $minVal
                        MaxShots = $maxVal
                        AverageShots = $avgVal
                        ReplacementFrequency = $freq
                        FirstReplaceMilestone = if ($firstMilestone) { $firstMilestone } else { "-" }
                    }

                    $wearMatrix += [pscustomobject]@{
                        Part = $stat.Part
                        Series = $stat.Series
                        DieSet = $stat.DieSet
                        Milestones = $milestoneCounts
                        TotalReplacements = $stat.TotalReplacements
                    }
                }

                $shiftList = if ($body -and $body.shifts) { @($body.shifts) } else { @() }

                $resObj = [pscustomobject]@{
                    success = $true
                    message = "Backend đã tính toán Wear Analysis & Replacement Frequency thành công!"
                    shoot = $cleanShoot
                    replacements = $cleanRep
                    shifts = $shiftList
                    cycles = $cycles
                    milestones = $milestones
                    wearMatrix = $wearMatrix
                    summary = $summaryList
                }

                $responseBytes = [System.Text.Encoding]::UTF8.GetBytes(($resObj | ConvertTo-Json -Depth 8))
                $contentType = "application/json; charset=utf-8"
            }
            else {
                $statusLine = "HTTP/1.1 404 Not Found`r`n"
                $responseBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Not Found"}')
                $contentType = "application/json; charset=utf-8"
            }
        } catch {
            $statusLine = "HTTP/1.1 500 Internal Server Error`r`n"
            $responseBytes = [System.Text.Encoding]::UTF8.GetBytes(('{"error":"' + $_.Exception.Message + '"}'))
            $contentType = "application/json; charset=utf-8"
        }

        $headerStr = "${statusLine}Content-Type: ${contentType}`r`nContent-Length: $($responseBytes.Length)`r`nAccess-Control-Allow-Origin: *`r`nConnection: close`r`n`r`n"
        $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($headerStr)

        $stream.Write($headerBytes, 0, $headerBytes.Length)
        if ($responseBytes.Length -gt 0) {
            $stream.Write($responseBytes, 0, $responseBytes.Length)
        }
        $stream.Flush()
        $client.Close()
    }
} finally {
    if ($listener) { try { $listener.Stop() } catch {} }
    if ($mutex) {
        try { $mutex.ReleaseMutex() } catch {}
        try { $mutex.Dispose() } catch {}
    }
}

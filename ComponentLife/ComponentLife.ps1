param(
    [int]$Port = 8787,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
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
    throw "Khong the khoi dong local server."
}

$url = "http://127.0.0.1:$boundPort/"
Write-Host "Component Life đang chay tai $url (nhan Ctrl+C de dung)" -ForegroundColor Green
if (-not $NoBrowser) { Start-Process $url }

try {
    while ($true) {
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
            if ($path -eq '/' -or $path -eq '/index.html' -or $path -eq '/ComponentLife.html') {
                $htmlFile = Join-Path $Root 'ComponentLife.html'
                if (-not (Test-Path $htmlFile)) { $htmlFile = Join-Path $Root 'index.html' }
                $responseBytes = [System.IO.File]::ReadAllBytes($htmlFile)
                $contentType = "text/html; charset=utf-8"
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

                # Calculate Cycles & Summary in PowerShell
                $cycles = @()
                $groups = @{}
                foreach ($r in $cleanRep) {
                    $gKey = "$($r.Part)|$($r.Series)|$($r.DieSet)"
                    if (-not $groups.ContainsKey($gKey)) { $groups[$gKey] = @() }
                    $groups[$gKey] += $r
                }

                foreach ($gKey in $groups.Keys) {
                    $events = @($groups[$gKey] | Sort-Object ReplaceDate)
                    $pParts = $gKey.Split('|')
                    $part = $pParts[0]; $series = $pParts[1]; $dieSet = $pParts[2]

                    $shots = @($cleanShoot | Where-Object {
                        $_.Output -gt 0 -and (($dieSet -and $_.DieSet -eq $dieSet) -or ($part -and $_.DieSet -eq $part))
                    } | Sort-Object Date)

                    if ($shots.Count -gt 0 -and $events.Count -gt 0) {
                        $firstRepDate = $events[0].ReplaceDate
                        $beforeShots = @($shots | Where-Object { $_.Date -lt $firstRepDate })
                        $totalBefore = 0
                        foreach ($bs in $beforeShots) { $totalBefore += $bs.Output }

                        if ($totalBefore -gt 0) {
                            $cycles += [pscustomobject]@{
                                Part = $part; Series = $series; DieSet = $dieSet
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
                            foreach ($bts in $betweenShots) { $totalBetween += $bts.Output }

                            if ($totalBetween -gt 0) {
                                $cycles += [pscustomobject]@{
                                    Part = $part; Series = $series; DieSet = $dieSet
                                    StartDate = $st; EndDate = $en
                                    CycleShots = $totalBetween
                                }
                            }
                        }
                    }
                }

                $summaryMap = @{}
                foreach ($c in $cycles) {
                    $sKey = "$($c.Part)|$($c.Series)|$($c.DieSet)"
                    if (-not $summaryMap.ContainsKey($sKey)) { $summaryMap[$sKey] = @() }
                    $summaryMap[$sKey] += $c
                }

                $summaryList = @()
                foreach ($sKey in $summaryMap.Keys) {
                    $cList = @($summaryMap[$sKey])
                    $vals = @($cList | ForEach-Object { [double]$_.CycleShots })
                    $sumVal = 0
                    foreach ($v in $vals) { $sumVal += $v }
                    $minVal = ($vals | Measure-Object -Minimum).Minimum
                    $maxVal = ($vals | Measure-Object -Maximum).Maximum
                    $avgVal = [math]::Round($sumVal / $vals.Count)

                    $firstItem = $cList[0]
                    $summaryList += [pscustomobject]@{
                        Part = $firstItem.Part
                        Series = $firstItem.Series
                        DieSet = $firstItem.DieSet
                        CompletedCycles = $cList.Count
                        MinShots = $minVal
                        MaxShots = $maxVal
                        AverageShots = $avgVal
                    }
                }

                $shiftList = if ($body -and $body.shifts) { @($body.shifts) } else { @() }

                $resObj = [pscustomobject]@{
                    success = $true
                    message = "Backend đã tính toán và cập nhật thành công!"
                    shoot = $cleanShoot
                    replacements = $cleanRep
                    shifts = $shiftList
                    cycles = $cycles
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
    if ($listener) { $listener.Stop() }
}

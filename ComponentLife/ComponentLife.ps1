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
                $existing = @(if (Test-Path $ShootFile) { Get-Content $ShootFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { @() })
                $map = @{}
                foreach ($row in $existing) { $map["$($row.Date)|$($row.DieSet)"] = $row }
                $added = 0; $updated = 0
                foreach ($row in @($body.rows)) {
                    $key = "$($row.Date)|$($row.DieSet)"
                    if ($map.ContainsKey($key)) { $updated++ } else { $added++ }
                    $map[$key] = [pscustomobject]@{ Date=$row.Date; DieSet=$row.DieSet; Output=[decimal]$row.Output }
                }
                $cleanList = @($map.Values | Sort-Object Date, DieSet)
                $jsonStr = $cleanList | ConvertTo-Json -Depth 8
                if ($cleanList.Count -eq 0) { $jsonStr = "[]" }
                elseif ($cleanList.Count -eq 1 -and -not $jsonStr.Trim().StartsWith("[")) { $jsonStr = "[$jsonStr]" }
                [System.IO.File]::WriteAllText($ShootFile, $jsonStr, (New-Object System.Text.UTF8Encoding($false)))
                $resObj = [pscustomobject]@{ added=$added; updated=$updated }
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

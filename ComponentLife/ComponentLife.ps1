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
$CycleFile = Join-Path $DataDir 'cycle-summary.json'
$SummaryFile = Join-Path $DataDir 'part-minmax.json'

foreach ($folder in @($DataDir, $ReportDir)) { if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null } }

function Read-Store([string]$Path) {
    if (-not (Test-Path $Path)) { return @() }
    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
    return @($raw | ConvertFrom-Json)
}
function Write-Store([string]$Path, [object[]]$Data) {
    @($Data) | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding UTF8
}
function Send-Json($Context, $Value, [int]$Status = 200) {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 10 -Compress))
    $Context.Response.StatusCode = $Status
    $Context.Response.ContentType = 'application/json; charset=utf-8'
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.Close()
}
function Read-Body($Request) {
    $reader = [IO.StreamReader]::new($Request.InputStream, $Request.ContentEncoding)
    try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() }
}
function Get-Key($row) { return "$($row.Date)|$($row.DieSet)" }
function Normalize-Date($value) {
    $text = [string]$value
    $formats = @('yyyy-MM-dd','dd/MM/yyyy','d/M/yyyy','MM/dd/yyyy','M/d/yyyy','yyyy/MM/dd')
    $date = [datetime]::MinValue
    foreach ($format in $formats) { if ([datetime]::TryParseExact($text, $format, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$date)) { return $date.ToString('yyyy-MM-dd') } }
    if ([datetime]::TryParse($text, [ref]$date)) { return $date.ToString('yyyy-MM-dd') }
    throw "Ngày không hợp lệ: $text"
}
function Build-Calculations {
    $shoot = @(Read-Store $ShootFile)
    $replacements = @(Read-Store $ReplacementFile)
    $cycles = New-Object System.Collections.Generic.List[object]
    $errors = New-Object System.Collections.Generic.List[object]
    $groups = @($replacements | Group-Object { "$($_.Part)|$($_.Series)|$($_.DieSet)" })
    foreach ($group in $groups) {
        $parts = $group.Name -split '\|', 3
        $events = @($group.Group | Sort-Object ReplaceDate)
        if ($events.Count -lt 2) { continue }
        $die = $events[0].DieSet
        $shoots = @($shoot | Where-Object { $_.DieSet -eq $die } | Sort-Object Date)
        if ($shoots.Count -eq 0) {
            $errors.Add([pscustomobject]@{ Type='Không có ShootData'; Part=$parts[0]; Series=$parts[1]; DieSet=$die; Detail='Không tìm thấy output cho Die Set này.' })
            continue
        }
        for ($i = 0; $i -lt $events.Count - 1; $i++) {
            $start = [datetime]$events[$i].ReplaceDate
            $end = [datetime]$events[$i + 1].ReplaceDate
            if ($end -le $start) {
                $errors.Add([pscustomobject]@{ Type='Ngày thay không hợp lệ'; Part=$parts[0]; Series=$parts[1]; DieSet=$die; Detail="$($events[$i].ReplaceDate) → $($events[$i+1].ReplaceDate)" })
                continue
            }
            # Ngày thay kết thúc cycle trước; output của ngày đó được tính cho cycle kế tiếp.
            $total = [decimal]0
            foreach ($shot in $shoots) {
                $day = [datetime]$shot.Date
                if ($day -ge $start -and $day -lt $end) { $total += [decimal]$shot.Output }
            }
            $cycles.Add([pscustomobject]@{
                Part=$parts[0]; Series=$parts[1]; DieSet=$die
                StartDate=$start.ToString('yyyy-MM-dd'); EndDate=$end.ToString('yyyy-MM-dd')
                CycleShots=[decimal]$total; Status='Completed'
            })
        }
    }
    $summary = @($cycles | Group-Object { "$($_.Part)|$($_.Series)|$($_.DieSet)" } | ForEach-Object {
        $items = @($_.Group)
        [pscustomobject]@{
            Part=$items[0].Part; Series=$items[0].Series; DieSet=$items[0].DieSet
            CompletedCycles=$items.Count
            MinShots=($items | Measure-Object CycleShots -Minimum).Minimum
            MaxShots=($items | Measure-Object CycleShots -Maximum).Maximum
            AverageShots=[math]::Round((($items | Measure-Object CycleShots -Average).Average),0)
        }
    })
    Write-Store $CycleFile $cycles.ToArray(); Write-Store $SummaryFile $summary
    return [pscustomobject]@{ cycles=@($cycles.ToArray()); summary=@($summary); errors=@($errors.ToArray()) }
}
function Export-Report {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $csv = Join-Path $ReportDir "ComponentLife-$stamp.csv"
    $xlsx = Join-Path $ReportDir "ComponentLife-$stamp.xlsx"
    $rows = @(Read-Store $SummaryFile)
    if ($rows.Count -eq 0) { throw 'Chưa có dữ liệu tổng hợp để xuất report.' }
    $rows | Export-Csv -LiteralPath $csv -NoTypeInformation -Encoding UTF8
    $excel = $null; $workbook = $null
    try {
        $excel = New-Object -ComObject Excel.Application
        $excel.DisplayAlerts = $false
        $workbook = $excel.Workbooks.Open($csv)
        $workbook.SaveAs($xlsx, 51) # Excel Open XML Workbook (.xlsx)
        $workbook.Close($false); $excel.Quit()
        Remove-Item -LiteralPath $csv -Force
        return $xlsx
    } catch {
        if ($workbook) { $workbook.Close($false) }
        if ($excel) { $excel.Quit() }
        return $csv # CSV fallback when Office COM is unavailable.
    }
}

$listener = [Net.HttpListener]::new()
while ($true) {
    try { $listener.Prefixes.Clear(); $listener.Prefixes.Add("http://127.0.0.1:$Port/"); $listener.Start(); break }
    catch { $Port++; if ($Port -gt 8797) { throw 'Không mở được local port 8787-8797.' } }
}
$url = "http://127.0.0.1:$Port/"
Write-Host "Component Life đang chạy tại $url  (nhấn Ctrl+C để dừng)" -ForegroundColor Green
if (-not $NoBrowser) { Start-Process $url }
try {
    while ($listener.IsListening) {
        $context = $listener.GetContext(); $path = $context.Request.Url.AbsolutePath
        try {
            if ($path -eq '/' -or $path -eq '/index.html') {
                $bytes = [IO.File]::ReadAllBytes((Join-Path $Root 'index.html'))
                $context.Response.ContentType = 'text/html; charset=utf-8'; $context.Response.ContentLength64=$bytes.Length
                $context.Response.OutputStream.Write($bytes,0,$bytes.Length); $context.Response.Close(); continue
            }
            if ($path -eq '/api/state' -and $context.Request.HttpMethod -eq 'GET') {
                Send-Json $context ([pscustomobject]@{ shoot=@(Read-Store $ShootFile); replacements=@(Read-Store $ReplacementFile); cycles=@(Read-Store $CycleFile); summary=@(Read-Store $SummaryFile) }); continue
            }
            if ($path -eq '/api/import/shoot' -and $context.Request.HttpMethod -eq 'POST') {
                $body=Read-Body $context.Request; $existing=@(Read-Store $ShootFile); $map=@{}; foreach($row in $existing){$map[(Get-Key $row)]=$row}; $added=0; $updated=0
                foreach($row in @($body.rows)) { $clean=[pscustomobject]@{Date=(Normalize-Date $row.Date);DieSet=([string]$row.DieSet).Trim();Output=[decimal]$row.Output}; if([string]::IsNullOrWhiteSpace($clean.DieSet)){throw 'Die Set/Mold Name không được để trống.'}; $key=Get-Key $clean; if($map.ContainsKey($key)){$updated++}else{$added++};$map[$key]=$clean }
                Write-Store $ShootFile @($map.Values | Sort-Object Date,DieSet); Send-Json $context @{added=$added;updated=$updated}; continue
            }
            if ($path -eq '/api/import/replacements' -and $context.Request.HttpMethod -eq 'POST') {
                $body=Read-Body $context.Request; $items=New-Object System.Collections.Generic.List[object]
                foreach($row in @($body.rows)) { $item=[pscustomobject]@{Part=([string]$row.Part).Trim();Series=([string]$row.Series).Trim();DieSet=([string]$row.DieSet).Trim();ReplaceDate=(Normalize-Date $row.ReplaceDate)}; if([string]::IsNullOrWhiteSpace($item.Part) -or [string]::IsNullOrWhiteSpace($item.DieSet)){throw 'Part và Die Set không được để trống.'};$items.Add($item) }
                Write-Store $ReplacementFile $items.ToArray(); Send-Json $context @{count=$items.Count}; continue
            }
            if ($path -eq '/api/rebuild' -and $context.Request.HttpMethod -eq 'POST') { Send-Json $context (Build-Calculations); continue }
            if ($path -eq '/api/export' -and $context.Request.HttpMethod -eq 'POST') { $file=Export-Report; Send-Json $context @{file=$file}; continue }
            Send-Json $context @{error='Không tìm thấy endpoint.'} 404
        } catch { Send-Json $context @{error="$($_.Exception.Message) [$($_.ScriptStackTrace)]"} 400 }
    }
} finally { $listener.Stop(); $listener.Close() }

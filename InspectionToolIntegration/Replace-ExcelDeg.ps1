[CmdletBinding()]
param(
    [string]$Path = 'C:\Users\415\Desktop\File đo linh kiện',
    [switch]$Apply,
    [string]$BackupDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$utf8 = New-Object Text.UTF8Encoding($false)
$root = (Get-Item -LiteralPath $Path).FullName
if (-not $BackupDirectory) {
    $BackupDirectory = Join-Path (Split-Path $root -Parent) ('Excel-deg-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
$backupRoot = [IO.Path]::GetFullPath($BackupDirectory)
$pattern = '(?i)deg(?![a-z])'
$degree = [string][char]0x00B0

function Get-SourceFiles {
    param([string]$Target)
    $item = Get-Item -LiteralPath $Target
    if (-not $item.PSIsContainer) { return $item }
    $pending = New-Object 'Collections.Generic.Stack[string]'
    $pending.Push($item.FullName)
    while ($pending.Count) {
        $dir = $pending.Pop()
        foreach ($child in (Get-ChildItem -LiteralPath $dir -Force)) {
            if ($child.PSIsContainer) {
                if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
                if ($child.Name -match '(?i)backup|^\.inspection|^\.git$|^node_modules$') { continue }
                if ($child.FullName.TrimEnd('\') -eq $backupRoot.TrimEnd('\')) { continue }
                $pending.Push($child.FullName)
            } elseif ($child.Extension -in @('.xlsx','.xlsm') -and $child.Name -notlike '~$*') {
                $child
            }
        }
    }
}

function Convert-CellText([string]$Xml) {
    # Touch text nodes only. Never rebuild styles, drawings, images, relationships or VBA.
    $evaluator = [Text.RegularExpressions.MatchEvaluator]{ param($m)
        $inner = [regex]::Replace($m.Groups[2].Value, $pattern, $degree)
        $m.Groups[1].Value + $inner + $m.Groups[3].Value
    }
    return [regex]::Replace($Xml, '(<(?:\w+:)?t\b[^>]*>)([\s\S]*?)(</(?:\w+:)?t>)', $evaluator)
}

$changed = 0; $replaced = 0; $failed = 0; $scanned = 0
foreach ($file in (Get-SourceFiles $root)) {
    $scanned++
    $zip = $null; $temp = $null
    try {
        $initialHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        $zip = [IO.Compression.ZipFile]::OpenRead($file.FullName)
        $updates = @{}; $originals = @{}; $count = 0
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -ne 'xl/sharedStrings.xml' -and $entry.FullName -notmatch '^xl/worksheets/sheet\d+\.xml$') { continue }
            $reader = New-Object IO.StreamReader($entry.Open(), $utf8, $true)
            try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
            if ($text -notmatch $pattern) { continue }
            $updated = Convert-CellText $text
            if ($updated -ne $text) {
                $updates[$entry.FullName] = $updated
                $originals[$entry.FullName] = $text
                $count += [regex]::Matches($text,$pattern).Count - [regex]::Matches($updated,$pattern).Count
            }
        }
        $zip.Dispose(); $zip = $null
        if (-not $updates.Count) { continue }
        Write-Output ("{0}: {1} replacement(s) | {2}" -f $(if($Apply){'APPLY'}else{'PREVIEW'}),$count,$file.FullName)
        if ($Apply) {
            $relative = if ((Get-Item -LiteralPath $root).PSIsContainer) { $file.FullName.Substring($root.TrimEnd('\').Length).TrimStart('\') } else { $file.Name }
            $backup = Join-Path $backupRoot $relative
            $null = New-Item -ItemType Directory -Path (Split-Path $backup -Parent) -Force
            if (Test-Path -LiteralPath $backup) { throw "Backup already exists: $backup" }
            [IO.File]::Copy($file.FullName,$backup,$false)
            $temp = Join-Path $file.DirectoryName ('.deg-' + [guid]::NewGuid().ToString('N') + $file.Extension)
            [IO.File]::Copy($backup,$temp,$false)
            $zip = [IO.Compression.ZipFile]::Open($temp,[IO.Compression.ZipArchiveMode]::Update)
            foreach ($name in $updates.Keys) {
                $stream = $zip.GetEntry($name).Open()
                try { $bytes=$utf8.GetBytes($updates[$name]); $stream.SetLength(0); $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
            }
            $zip.Dispose(); $zip=$null
            # Compare EVERY package part, including PNG, signatures and macros, before replacing.
            $before=[IO.Compression.ZipFile]::OpenRead($backup)
            $after=[IO.Compression.ZipFile]::OpenRead($temp)
            try {
                if ($before.Entries.Count -ne $after.Entries.Count) { throw 'Package part count changed' }
                foreach($entry in $before.Entries) {
                    $other=$after.GetEntry($entry.FullName)
                    if ($null -eq $other) { throw "Missing package part: $($entry.FullName)" }
                    if ($updates.ContainsKey($entry.FullName)) {
                        $reader=New-Object IO.StreamReader($other.Open(),$utf8,$true)
                        try { $actual=$reader.ReadToEnd() } finally { $reader.Dispose() }
                        if ($actual -cne $updates[$entry.FullName]) { throw 'Text verification failed' }
                        $doc=New-Object Xml.XmlDocument; $doc.LoadXml($actual)
                    } else {
                        $sha=[Security.Cryptography.SHA256]::Create()
                        $s1=$entry.Open(); $s2=$other.Open()
                        try {
                            $h1=[Convert]::ToBase64String($sha.ComputeHash($s1)); $h2=[Convert]::ToBase64String($sha.ComputeHash($s2))
                            if($h1 -cne $h2){throw "Unrelated package part changed: $($entry.FullName)"}
                        } finally { $s1.Dispose(); $s2.Dispose(); $sha.Dispose() }
                    }
                }
            } finally { $before.Dispose(); $after.Dispose() }
            if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne $initialHash) { throw 'Source changed during scan; original was left untouched' }
            $rollback=$temp+'.original'
            [IO.File]::Replace($temp,$file.FullName,$rollback)
            Remove-Item -LiteralPath $rollback -Force
            $temp=$null
        }
        $changed++; $replaced += $count
    } catch {
        $failed++
        Write-Warning ("Skipped {0}: {1}" -f $file.FullName,$_.Exception.Message)
    } finally {
        if($zip){$zip.Dispose()}
        if($temp -and (Test-Path -LiteralPath $temp)){Remove-Item -LiteralPath $temp -Force}
    }
}
Write-Output ("Scanned {0}; matched {1} files; replaced/matched {2} text occurrences; failed {3}." -f $scanned,$changed,$replaced,$failed)
if ($Apply -and $changed) { Write-Output ("Backup: " + $backupRoot) }
if($failed){exit 1}

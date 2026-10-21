[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PlanPath,
    [switch]$Apply,
    [string]$BackupDirectory,
    [string]$SourceDirectory = 'C:\Users\415\Desktop\File đo linh kiện'
)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
. (Join-Path $project 'ComponentLife/inspection_core.ps1')
. (Join-Path $PSScriptRoot 'MeasurementContract.ps1')
$script:AppRoot=$PSScriptRoot
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceRoot=[IO.Path]::GetFullPath($SourceDirectory).TrimEnd('\')+'\'
if(-not $BackupDirectory){$BackupDirectory=Join-Path (Split-Path $sourceRoot.TrimEnd('\') -Parent) ('Excel-DMS-backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))}
$plan=@(Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json)
$excel=$null; $book=$null; $changed=0; $files=0; $failed=0

function Get-ProtectedParts([string]$FilePath) {
    $hashes=@{}; $zip=[IO.Compression.ZipFile]::OpenRead($FilePath)
    try {
        foreach($entry in $zip.Entries){
            if($entry.FullName -notmatch '^xl/media/|^xl/vbaProject'){continue}
            $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
            try{$hashes[$entry.FullName]=[Convert]::ToBase64String($sha.ComputeHash($stream))}finally{$sha.Dispose();$stream.Dispose()}
        }
    }finally{$zip.Dispose()}
    return $hashes
}

function Get-WorksheetNames([string]$FilePath) {
    $zip=[IO.Compression.ZipFile]::OpenRead($FilePath)
    try {
        $reader=New-Object IO.StreamReader($zip.GetEntry('xl/workbook.xml').Open())
        try{[xml]$workbook=$reader.ReadToEnd()}finally{$reader.Dispose()}
        $reader=New-Object IO.StreamReader($zip.GetEntry('xl/_rels/workbook.xml.rels').Open())
        try{[xml]$relationships=$reader.ReadToEnd()}finally{$reader.Dispose()}
        $targets=@{}
        foreach($rel in $relationships.Relationships.Relationship){$targets[$rel.Id]=$rel.Target}
        $names=@{}
        foreach($sheet in $workbook.workbook.sheets.sheet){
            $id=$sheet.GetAttribute('id','http://schemas.openxmlformats.org/officeDocument/2006/relationships')
            $uri=New-Object Uri ([Uri]'http://xlsx/xl/workbook.xml'),([string]$targets[$id])
            $names[$uri.AbsolutePath.TrimStart('/')]=[string]$sheet.name
        }
        return $names
    }finally{$zip.Dispose()}
}

try {
    if($Apply){
        $excel=New-Object -ComObject Excel.Application
        $excel.Visible=$false;$excel.DisplayAlerts=$false;$excel.EnableEvents=$false
        $excel.AutomationSecurity=3;$excel.AskToUpdateLinks=$false
    }
    foreach($group in ($plan | Group-Object file)){
        $path=[IO.Path]::GetFullPath($group.Name);$temp=$null
        try {
            if(-not $path.StartsWith($sourceRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Source outside inspection folder'}
            $changes=@()
            foreach($item in $group.Group){
                $n=Convert-MeasurementNumber $item.nominal;$a=Convert-MeasurementNumber $item.actual
                # Never guess packed digits/radians or regenerate measurements.
                if($null -eq $n -or $null -eq $a -or [Math]::Abs($a-$n) -gt 1 -or $item.nominal -notmatch '[°º]' -or $item.nominal -notmatch '[''"′″]'){throw 'Plan contains an ambiguous angle'}
                $text=$null
                for($precision=0;$precision -le 9;$precision++){
                    $candidate=Format-AutoSampleDms $a $precision
                    if([Math]::Abs((Convert-MeasurementNumber $candidate)-$a) -le 0.00000000001){$text=$candidate;break}
                }
                if(-not $text){throw 'Cannot preserve angle magnitude'}
                $changes+= [pscustomobject]@{Item=$item;Text=$text;Value=$a}
                Write-Output ("{0}: {1} {2} -> {3}" -f [IO.Path]::GetFileName($path),$item.cell,$item.actual,$text)
            }
            if(-not $Apply){continue}
            $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
            $relative=$path.Substring($sourceRoot.Length)
            $backup=Join-Path $BackupDirectory $relative
            $null=New-Item -ItemType Directory -Path (Split-Path $backup -Parent) -Force
            if(Test-Path -LiteralPath $backup){throw 'Backup already exists'}
            [IO.File]::Copy($path,$backup,$false)
            $temp=Join-Path (Split-Path $backup -Parent) ('.dms-'+[guid]::NewGuid().ToString('N')+[IO.Path]::GetExtension($path))
            [IO.File]::Copy($backup,$temp,$false)
            $protected=Get-ProtectedParts $backup
            $sheetNames=Get-WorksheetNames $backup
            $book=$excel.Workbooks.Open($temp,0,$false)
            if($book.ReadOnly){throw 'Temporary workbook opened read-only'}
            $rows=@{}
            foreach($change in $changes){
                $item=$change.Item
                $index=[string]$sheetNames[$item.part]
                if(-not $index){throw 'Worksheet missing from workbook relationships'}
                $sheet=$book.Worksheets.Item($index)
                $r=[int]([regex]::Match($item.cell,'\d+$').Value)
                $cell=$sheet.Range($item.cell)
                if($cell.HasFormula){throw 'Actual contains a formula; left untouched'}
                $current=Convert-MeasurementNumber ([string]$cell.Value2)
                if($null -eq $current -or [Math]::Abs($current-$change.Value) -gt 0.00000000001){throw 'Actual changed since audit'}
                $nominal=[string]$sheet.Cells.Item($r,2).Text
                if((Convert-MeasurementNumber $nominal) -ne (Convert-MeasurementNumber $item.nominal)){throw 'Nominal changed since audit'}
                $cell.NumberFormat='@';$cell.Value2=$change.Text
                Set-ExcelInspectionJudgeFormula $sheet $r $nominal
                $rows["$index/$r"]=@($index,$r)
            }
            $excel.CalculateFullRebuild()
            foreach($pair in $rows.Values){
                $sheet=$book.Worksheets.Item($pair[0]);$r=$pair[1]
                $n=[string]$sheet.Cells.Item($r,2).Text;$a=[string]$sheet.Cells.Item($r,3).Text;$b=[string]$sheet.Cells.Item($r,4).Text
                $expected='';for($col=6;$col -le 15;$col++){
                    $v=[string]$sheet.Cells.Item($r,$col).Value2
                    if([string]::IsNullOrWhiteSpace($v)){continue}
                    if((Get-MeasurementResult $n $a $b $v) -eq 'NG'){$expected='NG';break};$expected='OK'
                }
                if([string]$sheet.Cells.Item($r,16).Value2 -ne $expected){throw ("Excel and Inspection judgement disagree at row {0}: Excel={1}, expected={2}; nominal={3}; clean={4}; parsed={5}; Actual={6}; cleanActual={7}; parsedActual={8}" -f $r,$sheet.Cells.Item($r,16).Text,$expected,$n,$sheet.Cells.Item($r,18).Value2,$sheet.Cells.Item($r,31).Value2,$sheet.Cells.Item($r,6).Text,$sheet.Cells.Item($r,21).Value2,$sheet.Cells.Item($r,34).Value2)}
            }
            $book.Save()
            foreach($change in $changes){
                $index=[string]$sheetNames[$change.Item.part]
                $stored=[string]$book.Worksheets.Item($index).Range($change.Item.cell).Value2
                if($stored -cne $change.Text){throw ('Actual was not preserved after calculation/save: '+$change.Item.cell+' = '+$stored)}
            }
            $book.Close($false);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book);$book=$null
            # Excel may update VBA project metadata while saving. Restore its original binary.
            $originalZip=[IO.Compression.ZipFile]::OpenRead($backup)
            $savedZip=[IO.Compression.ZipFile]::Open($temp,[IO.Compression.ZipArchiveMode]::Update)
            try {
                foreach($entry in $originalZip.Entries){
                    if($entry.FullName -notmatch '^xl/vbaProject'){continue}
                    $target=$savedZip.GetEntry($entry.FullName)
                    if($null -eq $target){throw 'Excel removed a VBA project part'}
                    $input=$entry.Open();$output=$target.Open()
                    try{$output.SetLength(0);$input.CopyTo($output)}finally{$input.Dispose();$output.Dispose()}
                }
            }finally{$originalZip.Dispose();$savedZip.Dispose()}
            $after=Get-ProtectedParts $temp
            if($after.Count -ne $protected.Count){throw 'Image or macro part count changed'}
            foreach($key in $protected.Keys){if($after[$key] -cne $protected[$key]){throw "Image or macro bytes changed: $key"}}
            if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $hash){throw 'Original changed during conversion'}
            $rollback=$temp+'.original';[IO.File]::Replace($temp,$path,$rollback);Remove-Item -LiteralPath $rollback -Force;$temp=$null
            $files++;$changed+=$changes.Count
        }catch{
            $failed++;Write-Warning ("Skipped {0}: {1}" -f $path,$_.Exception.Message)
        }finally{
            if($book){$book.Close($false);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book);$book=$null}
            if($temp -and (Test-Path -LiteralPath $temp)){Remove-Item -LiteralPath $temp -Force}
        }
    }
}finally{
    if($excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)}
}
Write-Output "Converted $changed cells in $files files; failed $failed. Backup: $BackupDirectory"
if($failed){exit 1}

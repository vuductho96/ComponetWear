[CmdletBinding()]
param([Parameter(Mandatory=$true)][string[]]$Path,[switch]$Apply,[string]$BackupDirectory)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
. (Join-Path $project 'ComponentLife/inspection_core.ps1')
. (Join-Path $PSScriptRoot 'MeasurementContract.ps1')
$script:AppRoot=$PSScriptRoot
Import-Module ImportExcel
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Get-AngleProtectedParts($File){
    $zip=[IO.Compression.ZipFile]::OpenRead($File);$hashes=@{}
    try{foreach($entry in $zip.Entries){
        if($entry.FullName -notmatch '^xl/media/|^xl/vbaProject'){continue}
        $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
        try{$hashes[$entry.FullName]=[Convert]::ToBase64String($sha.ComputeHash($stream))}finally{$sha.Dispose();$stream.Dispose()}
    }}finally{$zip.Dispose()}
    return $hashes
}
function Get-AngleInputSnapshot($File){
    $pkg=Open-ExcelPackage $File;$inputs=@{}
    try{foreach($sheet in $pkg.Workbook.Worksheets){
        if(-not $sheet.Dimension){continue}
        for($r=1;$r -le $sheet.Dimension.End.Row;$r++){for($c=1;$c -le 15;$c++){
            $cell=$sheet.Cells[$r,$c]
            if($null -eq $cell.Value -and -not $cell.Formula){continue}
            $inputs[$sheet.Name+'!'+$cell.Address]=@([string]$cell.Value,[string]$cell.Formula,$(if($c -in 2,3,4){[string]$cell.Style.Numberformat.Format}else{''}))
        }}
    }}finally{$pkg.Dispose()}
    return $inputs
}
$excel=$null;$book=$null
try{
    foreach($item in $Path){
        $file=(Get-Item -LiteralPath $item).FullName
        $pkg=Open-ExcelPackage $file;$rows=@()
        try{foreach($sheet in $pkg.Workbook.Worksheets){
            if(-not $sheet.Dimension){continue}
            for($r=14;$r -le $sheet.Dimension.End.Row;$r++){
                $nominal=Get-InspectionCellText $sheet.Cells[$r,2]
                if($sheet.Cells[$r,1].Text -notmatch '^\d+' -or $nominal -notmatch '[°º]'){continue}
                $rows+=,[pscustomobject]@{Sheet=$sheet.Name;Row=$r;Nominal=$nominal}
            }
        }}finally{$pkg.Dispose()}
        Write-Output ([IO.Path]::GetFileName($file)+': '+$rows.Count+' angle rows')
        if(-not $Apply -or -not $rows.Count){continue}
        if(-not $BackupDirectory){$BackupDirectory=Join-Path (Split-Path $project -Parent) ('Excel-angle-formula-backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))}
        $BackupDirectory=[IO.Path]::GetFullPath($BackupDirectory)
        $null=New-Item -ItemType Directory -Path $BackupDirectory -Force
        $backup=Join-Path $BackupDirectory ([guid]::NewGuid().ToString('N')+'-'+[IO.Path]::GetFileName($file))
        [IO.File]::Copy($file,$backup,$false)
        $originalHash=(Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash
        $inputs=Get-AngleInputSnapshot $backup;$protected=Get-AngleProtectedParts $backup
        $temp=Join-Path $BackupDirectory ([guid]::NewGuid().ToString('N')+[IO.Path]::GetExtension($file))
        [IO.File]::Copy($backup,$temp,$false)
        if(-not $excel){$excel=New-Object -ComObject Excel.Application;$excel.Visible=$false;$excel.DisplayAlerts=$false;$excel.EnableEvents=$false;$excel.AutomationSecurity=3;$excel.AskToUpdateLinks=$false}
        $book=$excel.Workbooks.Open($temp,0,$false)
        if($book.ReadOnly){throw 'Repair copy opened read-only'}
        foreach($row in $rows){
            $sheet=$book.Worksheets.Item($row.Sheet);$r=$row.Row
            foreach($c in 6..15){
                $cell=$sheet.Cells.Item($r,$c)
                # Change display only. Measurements and DMS text stay untouched.
                if($cell.Value2 -is [double] -or $cell.Value2 -is [int]){$cell.NumberFormat=$(if([Math]::Truncate([double]$cell.Value2) -eq [double]$cell.Value2){'0"°"'}else{'0.###############"°"'})}
            }
            Set-ExcelInspectionJudgeFormula $sheet $r $row.Nominal
        }
        $excel.CalculateFullRebuild()
        foreach($row in $rows){
            $sheet=$book.Worksheets.Item($row.Sheet);$r=$row.Row;$expected=''
            foreach($c in 6..15){
                $actual=[string]$sheet.Cells.Item($r,$c).Value2
                if([string]::IsNullOrWhiteSpace($actual)){continue}
                $result=Get-MeasurementResult $row.Nominal ([string]$sheet.Cells.Item($r,3).Value2) ([string]$sheet.Cells.Item($r,4).Value2) $actual
                if($result -eq 'NG'){$expected='NG';break};$expected='OK'
            }
            if([string]$sheet.Cells.Item($r,16).Value2 -ne $expected){throw ('Excel formula mismatch: '+$row.Sheet+'!P'+$r)}
        }
        $book.Save();$book.Close($false);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book);$book=$null
        # Native Excel may update VBA metadata. Restore the original binary parts.
        $original=[IO.Compression.ZipFile]::OpenRead($backup);$saved=[IO.Compression.ZipFile]::Open($temp,[IO.Compression.ZipArchiveMode]::Update)
        try{foreach($entry in $original.Entries){
            if($entry.FullName -notmatch '^xl/vbaProject'){continue}
            $target=$saved.GetEntry($entry.FullName);if(-not $target){throw 'Missing VBA part'}
            $input=$entry.Open();$output=$target.Open()
            try{$output.SetLength(0);$input.CopyTo($output)}finally{$input.Dispose();$output.Dispose()}
        }}finally{$saved.Dispose();$original.Dispose()}
        $after=Get-AngleProtectedParts $temp
        if($after.Count -ne $protected.Count){throw 'Image/macro count changed; source left untouched'}
        foreach($key in $protected.Keys){if($protected[$key] -cne $after[$key]){throw 'Image/macro bytes changed; source left untouched'}}
        $afterInputs=Get-AngleInputSnapshot $temp
        if($afterInputs.Count -ne $inputs.Count){throw 'Source input count changed'}
        foreach($key in $inputs.Keys){if(($inputs[$key] -join [char]0) -cne ($afterInputs[$key] -join [char]0)){throw ('Source measurement/format changed: '+$key)}}
        if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $originalHash){throw 'Source changed during repair'}
        [IO.File]::Replace($temp,$file,($temp+'.original'))
        Write-Output ('VERIFIED: formulas recalculated; all input values, nominal/tolerance formats and '+$protected.Count+' image/macro parts preserved. Backup: '+$backup)
    }
}finally{if($book){$book.Close($false)};if($excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)}}

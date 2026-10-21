$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Import-Module ImportExcel
Add-Type -AssemblyName System.Drawing
$dir=Join-Path $env:TEMP ('inspection-angle-repair-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $dir
$file=Join-Path $dir 'fixture.xlsm'
$pkg=Open-ExcelPackage $file -Create
try{
    $pkg.Workbook.CreateVBAProject();$macro=$pkg.Workbook.VbaProject.Modules.AddModule('KeepMacro');$macro.Code='Sub KeepMe(): End Sub'
    foreach($name in @('Inspection 1-40','Inspection 41-80')){
        $ws=$pkg.Workbook.Worksheets.Add($name)
        $ws.Cells['S3:AB50'].Merge=$true;$ws.Cells['S3'].Value='Drawing area'
        $ws.Cells['A13'].Value='Point';$ws.Cells['B13'].Value='Nominal';$ws.Cells['F13'].Value=1
        $ws.Cells['A14'].Value=1;$ws.Cells['B14'].Value='90°';$ws.Cells['C14'].Value=-0.5;$ws.Cells['D14'].Value=0.5;$ws.Cells['F14'].Value=90.0;$ws.Cells['F14'].Style.Numberformat.Format='0.000'
        $ws.Cells['A15'].Value=20;$ws.Cells['B15'].Value='34°59′31″';$ws.Cells['C15'].Value=-0.01;$ws.Cells['D15'].Value=0.01;$ws.Cells['F15'].Value='34°59′26″'
        $ws.Cells['A16'].Value=26;$ws.Cells['B16'].Value='28°4′21″';$ws.Cells['C16'].Value=-0.01;$ws.Cells['D16'].Value=0.01;$ws.Cells['F16'].Value='28°04′20″'
        foreach($r in 14..16){$ws.Cells[$r,16].Formula='IF(COUNT(U'+$r+')=1,"OK","NG")'}
        $bitmap=New-Object Drawing.Bitmap(8,8)
        try{$bitmap.SetPixel(1,1,[Drawing.Color]::Blue);$null=$ws.Drawings.AddPicture('KeepPng',$bitmap)}finally{$bitmap.Dispose()}
    }
    Close-ExcelPackage $pkg;$pkg=$null
    & (Join-Path $root 'InspectionToolIntegration/Repair-InspectionAngleFormulas.ps1') -Path $file -Apply -BackupDirectory (Join-Path $dir 'backup')
    $excel=$null;$book=$null
    try{
        $excel=New-Object -ComObject Excel.Application;$excel.Visible=$false;$excel.DisplayAlerts=$false;$excel.AutomationSecurity=3
        $book=$excel.Workbooks.Open($file,0,$true);$excel.CalculateFullRebuild()
        foreach($ws in $book.Worksheets){
            if($ws.Range('F14').Text -cne '90°'){throw ('Degree format wrong: '+$ws.Range('F14').Text)}
            foreach($r in 14..16){if($ws.Cells.Item($r,16).Value2 -ne 'OK'){throw 'Repaired Excel judgement mismatch'}}
            if($ws.Range('P15').Formula -notmatch 'TRUNC' -or $ws.Range('P15').Formula -notmatch 'BJ15:BS15'){throw 'Formula rule or safe helper region missing'}
        }
    }finally{if($book){$book.Close($false)};if($excel){$excel.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)}}
    Write-Output 'PASS: original numeric 90 displays 90°; both DMS examples recalculate OK on both sheets; repair verifies all source inputs, formats, PNG and VBA bytes.'
}finally{
    if($pkg){$pkg.Dispose()}
    if(-not [IO.Path]::GetFullPath($dir).StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe fixture cleanup'}
    Remove-Item -LiteralPath $dir -Recurse -Force
}

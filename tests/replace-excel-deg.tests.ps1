$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=Join-Path (Split-Path $PSScriptRoot -Parent) '.cloud-publish/deg-script-test'
$null=New-Item -ItemType Directory -Path $root -Force
$fixture=Join-Path $root ('fixture-'+[guid]::NewGuid().ToString('N')+'.xlsm')
$zip=[IO.Compression.ZipFile]::Open($fixture,[IO.Compression.ZipArchiveMode]::Create)
try {
 $parts=@{
  'xl/sharedStrings.xml'='<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>1deg15''37''''</t></si><si><t>degree</t></si></sst>'
  'xl/worksheets/sheet1.xml'='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="14"><c r="B14" t="inlineStr"><is><t>30DEG</t></is></c><c r="P14"><f>IF(B14=1,"NG","OK")</f><v>OK</v></c></row></sheetData></worksheet>'
  'xl/media/image1.png'='PNG-PRESERVE-ALL-BYTES'
  'xl/vbaProject.bin'='VBA-PRESERVE-ALL-BYTES'
 }
 foreach($name in $parts.Keys){$writer=New-Object IO.StreamWriter($zip.CreateEntry($name).Open());try{$writer.Write($parts[$name])}finally{$writer.Dispose()}}
}finally{$zip.Dispose()}
$scriptPath=Join-Path (Split-Path $PSScriptRoot -Parent) 'InspectionToolIntegration/Replace-ExcelDeg.ps1'
& $scriptPath -Path $fixture
& $scriptPath -Path $fixture -Apply -BackupDirectory (Join-Path $root ([guid]::NewGuid().ToString('N')))
$zip=[IO.Compression.ZipFile]::OpenRead($fixture)
try {
 foreach($entry in $zip.Entries){$reader=New-Object IO.StreamReader($entry.Open());try{$text=$reader.ReadToEnd()}finally{$reader.Dispose()}
  if($entry.FullName -eq 'xl/sharedStrings.xml' -and ($text -notlike '*1°15*' -or $text -notlike '*degree*')){throw 'Shared text replacement failed'}
  if($entry.FullName -eq 'xl/worksheets/sheet1.xml' -and $text -notlike '*30°*'){throw 'Inline replacement failed'}
  if($entry.FullName -in @('xl/media/image1.png','xl/vbaProject.bin') -and $text -cne $parts[$entry.FullName]){throw 'Image or macro changed'}
 }
}finally{$zip.Dispose()}
Write-Output 'PASS: preview/apply; shared and inline deg; degree word preserved; PNG and VBA byte-identical.'

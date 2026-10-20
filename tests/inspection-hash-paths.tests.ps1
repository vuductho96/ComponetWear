param([string]$ProjectRoot=(Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference='Stop'
. (Join-Path $ProjectRoot 'ComponentLife/cloud_publish.ps1')
$root=Join-Path ([IO.Path]::GetTempPath()) ('inspection-unicode-'+[Guid]::NewGuid().ToString('N'))
$relative='đo tủ LK/MarkStep 215.pdf'
$path=Join-Path $root $relative
[void][IO.Directory]::CreateDirectory((Split-Path $path -Parent))
[IO.File]::WriteAllText($path,'hash fixture',[Text.UTF8Encoding]::new($false))
$encoding=[Console]::OutputEncoding
try {
    [Console]::OutputEncoding=[Text.Encoding]::GetEncoding(437)
    $manifest=Get-CachedFileManifest $root @($relative)
    if($manifest.files.Count -ne 1 -or $manifest.files[0].Substring(0,$manifest.files[0].LastIndexOf('=')) -cne $relative){throw 'UTF-8 PDF paths were corrupted by the legacy console encoding.'}
    Write-Output 'PASS: PDF cache preserves Unicode paths under the Windows PowerShell legacy console encoding.'
} finally {
    [Console]::OutputEncoding=$encoding
    $resolved=[IO.Path]::GetFullPath($root)
    if($resolved.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
if($env:COMPONENTLIFE_CHECK_PDF_SOURCE -eq '1'){
    $realRoot=[IO.Path]::GetFullPath((Get-Content (Join-Path $ProjectRoot 'inspection.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json).sourcePath).TrimEnd('\')
    $pdfs=@(Get-ChildItem -LiteralPath $realRoot -Recurse -File -Filter '*.pdf')
    $paths=@($pdfs | ForEach-Object {$_.FullName.Substring($realRoot.Length+1).Replace('\','/')} | Sort-Object)
    $manifest=Get-CachedFileManifest $realRoot $paths
    $hashes=@{}
    foreach($entry in $manifest.files){$separator=$entry.LastIndexOf('=');$hashes[[IO.Path]::GetFullPath((Join-Path $realRoot $entry.Substring(0,$separator)))]=$entry.Substring($separator+1)}
    $missing=@($pdfs | Where-Object {-not $hashes.ContainsKey($_.FullName)})
    if($missing.Count){throw "PDF cache path mismatch: $($missing.Count) files"}
    Write-Output ('PASS: actual PDF cache paths match all '+$pdfs.Count+' source files without publishing.')
}

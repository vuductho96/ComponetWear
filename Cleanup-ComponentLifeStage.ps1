param([string]$ProjectRoot=$PSScriptRoot)
$ErrorActionPreference='Stop'
$work=[IO.Path]::GetFullPath((Join-Path $ProjectRoot '.cloud-publish')).TrimEnd('\')
if(-not(Test-Path -LiteralPath $work -PathType Container)){exit 0}
$lock=$null
try{$lock=[IO.File]::Open((Join-Path $work 'stage-cleanup.lock'),'OpenOrCreate','ReadWrite','None')}catch{exit 0}
try{
    foreach($directory in (Get-ChildItem -LiteralPath $work -Directory -Filter 'previous-*')){
        $target=[IO.Path]::GetFullPath($directory.FullName)
        if(-not $target.StartsWith($work+'\',[StringComparison]::OrdinalIgnoreCase)){continue}
        if($directory.Name -notmatch '^previous-[a-f0-9]{32}$'){continue}
        if($directory.Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
        try{Remove-Item -LiteralPath $target -Recurse -Force}catch{ }
    }
}finally{$lock.Dispose()}

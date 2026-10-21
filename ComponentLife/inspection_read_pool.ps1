# Bounded background readers: each workbook has its own EPPlus package and cache.
function New-InspectionReadPool([string]$CorePath,[int]$Workers=4) {
    $workers=[Math]::Max(1,[Math]::Min(4,$Workers))
    $initial=[Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
    $initial.ImportPSModule(@('ImportExcel'))
    $core=[IO.File]::ReadAllText($CorePath)
    $ast=[Management.Automation.Language.Parser]::ParseInput($core,[ref]$null,[ref]$null)
    foreach($function in $ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)){
        $body=$function.Body.Extent.Text
        $initial.Commands.Add((New-Object Management.Automation.Runspaces.SessionStateFunctionEntry($function.Name,$body.Substring(1,$body.Length-2))))
    }
    $pool=[RunspaceFactory]::CreateRunspacePool(1,$workers,$initial,$Host)
    $pool.Open()
    return $pool
}

function Start-InspectionRead($Pool,[IO.FileInfo]$File) {
    $shell=[PowerShell]::Create();$shell.RunspacePool=$Pool
    [void]$shell.AddScript({param($Path)
        $ErrorActionPreference='Stop'
        $script:DimensionCache=@{}
        try{
            $file=Get-Item -LiteralPath $Path
            $record=Read-InspectionFile $file
            if($null -eq $record){throw 'Cannot read inspection workbook'}
            $key=Get-DimensionCacheKey $Path
            $dimensions=@()
            if($script:DimensionCache.ContainsKey($key)){
                $dimensions=@($script:DimensionCache[$key] | ForEach-Object {
                    ,@($_.Point,$_.Nominal,$_.TolMinus,$_.TolPlus,$_.SampleNo,$(if($_.Value -match '[°ºRCØΦ⌀]' -or $null -eq $_.NumericValue){$_.Value}else{$_.NumericValue}),$_.LowerLimit,$_.UpperLimit,$_.Deviation,$_.Result)
                })
            }
            [pscustomobject]@{Record=$record;Dimensions=$dimensions}
        }finally{$script:DimensionCache.Clear()}
    }).AddArgument($File.FullName)
    return [pscustomobject]@{Shell=$shell;Handle=$shell.BeginInvoke();Path=$File.FullName}
}

function Receive-InspectionRead($Job) {
    try {
        $values=@($Job.Shell.EndInvoke($Job.Handle))
        if($Job.Shell.HadErrors -or $values.Count -ne 1){throw ('Workbook reader failed: '+$Job.Path+' '+($Job.Shell.Streams.Error -join '; '))}
        return $values[0]
    }finally{$Job.Shell.Dispose()}
}

function Stop-InspectionReadJobs($Jobs,$Pool) {
    foreach($job in @($Jobs.Values)){
        try{$job.Shell.Stop()}catch{}
        try{$job.Shell.Dispose()}catch{}
    }
    if($Pool){$Pool.Dispose()}
}

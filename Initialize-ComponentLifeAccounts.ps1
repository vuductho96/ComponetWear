param([string]$ProjectRoot=$PSScriptRoot,[Security.SecureString]$AdminPassword=$null)
$ErrorActionPreference='Stop'
$config=Get-Content -LiteralPath (Join-Path $ProjectRoot 'wrangler.jsonc') -Raw | ConvertFrom-Json
if(-not $config.d1_databases[0].database_id){throw 'Missing D1 database binding.'}
$work=Join-Path $ProjectRoot '.cloud-publish'
$null=New-Item -ItemType Directory -Path $work -Force
Write-Host 'Initial admin: vuductho.th@gmail.com. Password is masked and is never saved as plain text.'
if($AdminPassword){$password=$AdminPassword.Copy();$confirm=$AdminPassword.Copy()}else{
$password=Read-Host 'Admin password (at least 10 characters)' -AsSecureString
$confirm=Read-Host 'Confirm password' -AsSecureString
}
$plain=$null;$confirmPlain=$null
try {
    $plain=[Net.NetworkCredential]::new('',$password).Password
    $confirmPlain=[Net.NetworkCredential]::new('',$confirm).Password
    if($plain -cne $confirmPlain){throw 'Passwords do not match.'}
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName='node.exe';$start.Arguments='"'+(Join-Path $ProjectRoot 'cloud/admin-setup.mjs')+'"'
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true
    $process=[Diagnostics.Process]::Start($start)
    $process.StandardInput.WriteLine((@{password=$plain}|ConvertTo-Json -Compress));$process.StandardInput.Close()
    $result=$process.StandardOutput.ReadToEnd();$process.WaitForExit()
    if($process.ExitCode -ne 0){throw 'Password validation/hash failed.'}
    $credentials=$result|ConvertFrom-Json
} finally {$plain=$null;$confirmPlain=$null;$password.Dispose();$confirm.Dispose();if($process){$process.Dispose()}}
$sqlFile=Join-Path $work 'initial-admin.sql'
$tokenFile=Join-Path $work 'auth-verifier.json'
$location=Get-Location
try {
    Set-Location -LiteralPath $ProjectRoot
    & npx.cmd --yes wrangler@4.86.0 d1 migrations apply componetlife-db --remote
    if($LASTEXITCODE -ne 0){throw 'D1 migration failed.'}
    # Never reset an existing admin implicitly. Password changes happen in the authenticated UI.
    $adminId=[Guid]::NewGuid().ToString();$created=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    [IO.File]::WriteAllText($sqlFile,"INSERT OR IGNORE INTO auth_users(id,username,password_hash,role,disabled,created_at) VALUES('$adminId','vuductho.th@gmail.com','$($credentials.hash)','admin',0,$created);",[Text.UTF8Encoding]::new($false))
    & npx.cmd --yes wrangler@4.86.0 d1 execute componetlife-db --remote --file $sqlFile
    if($LASTEXITCODE -ne 0){throw 'Admin creation failed.'}
    # Keep an existing verifier on repeated setup so deployment verification stays consistent.
    if(Test-Path -LiteralPath $tokenFile){$credentials.verifyToken=(Get-Content -LiteralPath $tokenFile -Raw|ConvertFrom-Json).token}
    $credentials.verifyToken | & npx.cmd --yes wrangler@4.86.0 secret put PUBLISH_VERIFY_TOKEN
    if($LASTEXITCODE -ne 0){throw 'Verifier secret setup failed.'}
    [IO.File]::WriteAllText($tokenFile,(@{url='https://componetlife.vuductho-th.workers.dev';token=$credentials.verifyToken}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $tokenFile /inheritance:r /grant:r ($identity+':(F)') 'SYSTEM:(F)' | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Could not restrict verifier file permissions.'}
    [IO.File]::WriteAllText((Join-Path $work 'accounts-ready.json'),(@{databaseId=$config.d1_databases[0].database_id;admin='vuductho.th@gmail.com';configuredAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress))
    Write-Host 'Accounts configured in Cloudflare D1. Publish the app from Inspection Tool when ready.'
} finally {
    Set-Location -LiteralPath $location
    if(Test-Path -LiteralPath $sqlFile){Remove-Item -LiteralPath $sqlFile -Force}
    $credentials=$null;$result=$null
}

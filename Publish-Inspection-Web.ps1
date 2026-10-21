param([string]$ProjectRoot = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$work = Join-Path $ProjectRoot '.cloud-publish'
$null = New-Item -ItemType Directory -Path $work -Force
. (Join-Path $ProjectRoot 'ComponentLife/cloud_publish.ps1')
$lock = $null
$startedAt = [DateTime]::UtcNow.ToString('o')
$statusFile = Join-Path $work 'manual-inspection-status.json'
$logFile = Join-Path $work 'manual-inspection.log'
function Set-ManualPublishState([string]$Status, [string]$Stage, [string]$Message) {
    $failedStage=''
    if($Status -eq 'failed'){
        try{$previous=Get-Content -LiteralPath $statusFile -Raw -Encoding UTF8 | ConvertFrom-Json;if([string]$previous.startedAt -eq $startedAt){$failedStage=[string]$previous.stage}}catch{}
    }
    Add-Content -LiteralPath $logFile -Value ("[{0}] {1}: {2}" -f [DateTime]::UtcNow.ToString('o'), $Stage, $Message) -Encoding UTF8
    Write-PublishJson $statusFile ([pscustomobject]@{
        status = $Status; stage = $Stage; message = $Message; failedStage = $failedStage
        startedAt = $startedAt; updatedAt = [DateTime]::UtcNow.ToString('o')
    })
}
function Invoke-ManualPublishStep([string]$Script, [string[]]$Arguments = @()) {
    # Record native stderr, then let the caller report a short, useful failure message.
    $ErrorActionPreference = 'Continue'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Script @Arguments 2>&1 | ForEach-Object {
        $line=[string]$_
        Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
        # Publish progress from the real child output (file counts, PDF cache, retries).
        # Preserve phase changes made by Publish-ComponentLife in the shared status file.
        if(-not [string]::IsNullOrWhiteSpace($line)){
            try{
                $state=Get-Content -LiteralPath $statusFile -Raw -Encoding UTF8 | ConvertFrom-Json
                $state | Add-Member -NotePropertyName detail -NotePropertyValue $line -Force
                $state.updatedAt=[DateTime]::UtcNow.ToString('o')
                Write-PublishJson $statusFile $state
            }catch{}
        }
    }
    return [int]$LASTEXITCODE
}
try {
    $lock = [IO.File]::Open((Join-Path $work 'manual-inspection.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
} catch { Write-Error 'Một lần Publish từ Inspection Tool đang chạy.' -ErrorAction Continue; exit 2 }
try {
    # Do not change exported data underneath an active publisher.
    try { $probe = [IO.File]::Open((Join-Path $work 'publish.lock'), 'OpenOrCreate', 'ReadWrite', 'None'); $probe.Dispose() }
    catch { throw 'Đang có phiên publish khác. Đợi hoàn tất rồi bấm lại.' }
    Set-Content -LiteralPath $logFile -Value "Started: $startedAt" -Encoding UTF8
    Set-ManualPublishState 'running' 'reading' 'Đang đọc kết quả đo và vị trí bước trên bản vẽ…'
    if (Test-Path -LiteralPath (Join-Path $ProjectRoot 'ComponentLife/inspection-runtime-requirements.txt')) {
        $runtime = Join-Path $work 'python-runtime/Scripts/python.exe'
        if (-not (Test-Path -LiteralPath $runtime)) { throw 'Thiếu môi trường xử lý bản vẽ riêng của dự án. Cần khôi phục .cloud-publish/python-runtime.' }
        & $runtime -c 'import pymupdf, PIL, cv2, numpy, onnxruntime' 2>&1 | ForEach-Object { Add-Content -LiteralPath $logFile -Value $_ -Encoding UTF8 }
        if ($LASTEXITCODE -ne 0) { throw 'Môi trường dựng bản vẽ thiếu thư viện. Cần khôi phục theo inspection-runtime-requirements.txt; chưa deploy lên cloud.' }
    }

    for ($readAttempt = 1; $readAttempt -le 3; $readAttempt++) {
        $readCode = Invoke-ManualPublishStep (Join-Path $ProjectRoot 'ComponentLife/export_inspection.ps1')
        if ($readCode -eq 0) { break }
        if ($readCode -ne 75) { throw 'Đọc dữ liệu đo thất bại. Xem manual-inspection.log.' }
        if ($readAttempt -eq 3) { throw 'File đo vẫn đang thay đổi sau 3 lần đọc. Hoàn tất lưu kết quả đo rồi bấm Publish lại; web vẫn giữ bản thành công trước.' }
        Set-ManualPublishState 'running' 'waiting' ("File đo vừa thay đổi khi đọc. Đang chờ lưu xong và tự đọc lại ({0}/3)…" -f ($readAttempt + 1))
        Start-Sleep -Seconds 3
        Set-ManualPublishState 'running' 'reading' ("Đang đọc lại dữ liệu mới nhất ({0}/3)…" -f ($readAttempt + 1))
    }
    $downloadBuilder = Join-Path $ProjectRoot 'ComponentLife/prepare_inspection_downloads.ps1'
    if (Test-Path -LiteralPath $downloadBuilder) {
        Set-ManualPublishState 'running' 'downloads' 'Đang đồng bộ Excel gốc, template và PDF…'
        if ((Invoke-ManualPublishStep $downloadBuilder) -ne 0) { throw 'Chuẩn bị file gốc để tải về thất bại.' }
    }
    Set-ManualPublishState 'running' 'checking' 'Đang kiểm tra nội dung cần cập nhật…'
    $manifest = Get-PublicAssetManifest (Join-Path $ProjectRoot 'ComponentLife')
    $successFile = Join-Path $work 'success.json'
    $success = $null
    if (Test-Path -LiteralPath $successFile) {
        try { $success = Get-Content -LiteralPath $successFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
    }
    if ($success.snapshotId -eq $manifest.snapshotId) {
        Set-ManualPublishState 'success' 'unchanged' 'Web đã là bản mới nhất — không cần deploy lại.'
    } else {
        Set-ManualPublishState 'running' 'staging' 'Đang chuẩn bị bộ tệp và đối chiếu phiên bản trên web…'
        if ((Invoke-ManualPublishStep (Join-Path $ProjectRoot 'Publish-ComponentLife.ps1') @('-ProjectRoot', $ProjectRoot, '-ManualStatusFile', $statusFile)) -ne 0) { throw 'Publish hoặc kiểm tra cloud thất bại. Xem publish.log.' }
        Set-ManualPublishState 'success' 'complete' 'Đã cập nhật web thành công. Nhấn F5 trên web để xem.'
    }
} catch {
    Set-ManualPublishState 'failed' 'failed' ([string]$_)
    Add-Content -LiteralPath $logFile -Value "FAILED: $_" -Encoding UTF8
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally { $lock.Dispose() }

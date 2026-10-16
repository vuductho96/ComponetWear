@echo off
title ComponetWear V3 - Server & Cloudflare Tunnel
cd /d "%~dp0"
chcp 65001 >nul

echo ============================================================
echo   ComponetWear V3 - Manufacturing Intelligence Dashboard
echo ============================================================
echo.
echo [1/3] Khởi động PowerShell Backend Server (Port 8787)...
start /b "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ComponentLife\ComponentLife.ps1" -NoBrowser

timeout /t 2 /nobreak >nul

echo [2/3] Khởi động Cloudflare Tunnel...
if not exist "%~dp0cloudflared.exe" (
    echo [LỖI] Không tìm thấy file cloudflared.exe tại thư mục hiện tại!
    pause
    exit /b 1
)

start /b "" powershell -NoProfile -Command ".\cloudflared.exe tunnel --url http://127.0.0.1:8787 2>&1 | Tee-Object -FilePath '%~dp0tunnel.log'"

echo [3/3] Đang kết nối mạng và lấy link Cloudflare Public URL...
timeout /t 6 /nobreak >nul

powershell -NoProfile -Command "$match = (Get-Content '%~dp0tunnel.log' -ErrorAction SilentlyContinue | Select-String 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' | Select-Object -First 1); if ($match) { $url = $match.Matches[0].Value; Write-Host ''; Write-Host '============================================================' -ForegroundColor Green; Write-Host '  🔗 ĐƯỜNG LINK TRUY CẬP TRỰC TUYẾN CLOUDFLARE:' -ForegroundColor Yellow; Write-Host \"  $url\" -ForegroundColor Cyan; Write-Host '============================================================' -ForegroundColor Green; Write-Host '  (Đã tự động copy link vào Clipboard của bạn)' -ForegroundColor Gray; Write-Host ''; Set-Clipboard -Value $url; Start-Process $url } else { Write-Host 'Đang khởi tạo kết nối Cloudflare, vui lòng kiểm tra file tunnel.log' -ForegroundColor Yellow }"

echo.
echo 💡 Server và Cloudflare Tunnel đang chạy ngầm liên tục.
echo    Mọi thay đổi từ file Excel sẽ tự động đồng bộ ngay lập tức.
echo    Nhấn phím bất kỳ trong cửa sổ này nếu muốn dừng server...
pause >nul

echo Đang dừng hệ thống...
taskkill /f /im cloudflared.exe >nul 2>&1
echo Đã dừng Cloudflare Tunnel.

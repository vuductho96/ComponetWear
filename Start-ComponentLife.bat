@echo off
title ComponetWear V3 - Manufacturing Intelligence Dashboard
cd /d "%~dp0"
chcp 65001 >nul

if not exist "%~dp0ComponentLife\ComponentLife.ps1" (
  echo ❌ LỖI: Không tìm thấy ComponentLife\ComponentLife.ps1!
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   ComponetWear V3 - Auto-Sync Server ^& Cloudflare Launcher
echo ============================================================
echo.

REM 1. Dọn dẹp tiến trình cũ nếu có
taskkill /f /im cloudflared.exe >nul 2>&1

REM 2. Khởi động PowerShell Backend Server trên cổng 8787
echo [1/3] Khởi động PowerShell Backend Server (Port 8787)...
start /b "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ComponentLife\ComponentLife.ps1" -NoBrowser

REM Đợi 2 giây để server hoàn tất bind port
timeout /t 2 /nobreak >nul

REM 3. Kiểm tra và khởi động Cloudflare Tunnel nếu có file cloudflared.exe
if exist "%~dp0cloudflared.exe" (
    echo [2/3] Khởi động Cloudflare Tunnel...
    if exist "%~dp0tunnel.log" del /f /q "%~dp0tunnel.log" >nul 2>&1
    start /b "" powershell -NoProfile -Command ".\cloudflared.exe tunnel --url http://127.0.0.1:8787 2>&1 | Tee-Object -FilePath '%~dp0tunnel.log'"
    
    echo [3/3] Đang kết nối Cloudflare và trích xuất đường link...
    timeout /t 6 /nobreak >nul
    
    powershell -NoProfile -Command "$match = (Get-Content '%~dp0tunnel.log' -ErrorAction SilentlyContinue | Select-String 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' | Select-Object -First 1); if ($match) { $url = $match.Matches[0].Value; Write-Host ''; Write-Host '============================================================' -ForegroundColor Green; Write-Host '  🌐 LOCAL URL:        http://127.0.0.1:8787/' -ForegroundColor Cyan; Write-Host '  🔗 CLOUDFLARE URL:   ' -NoNewline -ForegroundColor Yellow; Write-Host $url -ForegroundColor Green; Write-Host '============================================================' -ForegroundColor Green; Write-Host '  (Đã tự động copy link Cloudflare vào Clipboard của bạn)' -ForegroundColor Gray; Write-Host ''; Set-Clipboard -Value $url; Start-Process 'http://127.0.0.1:8787/' } else { Write-Host '  🌐 LOCAL URL: http://127.0.0.1:8787/' -ForegroundColor Cyan; Start-Process 'http://127.0.0.1:8787/' }"
) else (
    echo [2/3] Bỏ qua Cloudflare (chưa có cloudflared.exe)
    echo [3/3] Mở giao diện Dashboard cục bộ...
    powershell -NoProfile -Command "Start-Process 'http://127.0.0.1:8787/'"
)

echo.
echo 💡 HỆ THỐNG ĐANG HOẠT ĐỘNG LIÊN TỤC:
echo    - Tự động quét và nạp dữ liệu Excel khi có tháng mới / file lưu mới.
echo    - Truy cập cục bộ: http://127.0.0.1:8787/
echo    - Khóa tính năng Import Excel khi truy cập qua link Cloudflare.
echo.
echo    [Nhấn phím bất kỳ trong cửa sổ này để DỪNG Server và Cloudflare]
echo ============================================================
pause >nul

echo.
echo Đang tắt hệ thống...
taskkill /f /im cloudflared.exe >nul 2>&1
powershell -NoProfile -Command "Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/shutdown' -TimeoutSec 1 -ErrorAction SilentlyContinue | Out-Null" >nul 2>&1
echo [ComponetWear] Hệ thống đã dừng an toàn.
timeout /t 2 /nobreak >nul

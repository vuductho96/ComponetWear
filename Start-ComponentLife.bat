@echo off
title ComponetLife V3 - Manufacturing Intelligence Dashboard
cd /d "%~dp0"
chcp 65001 >nul

if not exist "%~dp0ComponentLife\ComponentLife.ps1" (
  echo ❌ LỖI: Không tìm thấy ComponentLife\ComponentLife.ps1!
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   ComponetLife V3 - Auto-Sync Server & Cloudflare Launcher
echo ============================================================
echo.

REM 1. Dọn dẹp tiến trình cũ nếu có
taskkill /f /im cloudflared.exe >nul 2>&1

REM 2. Khởi động PowerShell Backend Server trên cổng 8787
echo [1/2] Khởi động PowerShell Backend Server (Port 8787)...
start /b "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ComponentLife\ComponentLife.ps1" -NoBrowser

REM Đợi 2 giây để server hoàn tất khởi động
timeout /t 2 /nobreak >nul

REM 3. Hiển thị thông tin truy cập và tự động copy link Cloudflare vào Clipboard
set "PERMANENT_URL=https://componetlife.vuductho-th.workers.dev"
powershell -NoProfile -Command "Set-Clipboard -Value '%PERMANENT_URL%'"

echo.
echo ============================================================
echo   🌐 MÁY CHỦ CỤC BỘ (LOCAL):
echo      http://127.0.0.1:8787/
echo.
echo   🔗 WEB VĨNH VIỄN 24/7 (CLOUDFLARE):
echo      %PERMANENT_URL%
echo ============================================================
echo   (Đã tự động copy link Cloudflare vào Clipboard của bạn!)
echo.

REM 4. Tự động mở Dashboard trên trình duyệt
echo [2/2] Mở giao diện Dashboard...
powershell -NoProfile -Command "Start-Process 'http://127.0.0.1:8787/'"

echo.
echo 💡 HỆ THỐNG ĐANG HOẠT ĐỘNG LIÊN TỤC:
echo    - Tự động quét và nạp dữ liệu Excel khi có tháng mới / file lưu mới.
echo    - Tự động đồng bộ và đẩy dữ liệu mới lên https://componetlife.vuductho-th.workers.dev
echo    - Khóa tính năng Import Excel khi truy cập từ xa qua Cloudflare.
echo.
echo    [Nhấn phím bất kỳ trong cửa sổ này để DỪNG Server cục bộ]
echo ============================================================
pause >nul

echo.
echo Đang tắt hệ thống...
powershell -NoProfile -Command "Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/shutdown' -TimeoutSec 1 -ErrorAction SilentlyContinue | Out-Null" >nul 2>&1
echo [ComponetLife] Hệ thống đã dừng an toàn.
timeout /t 2 /nobreak >nul

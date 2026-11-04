@echo off
chcp 65001 >nul
title CÀO DỮ LIỆU TMS SMART - SỐ SHOT 44 MÁY ÉP
color 0b
echo ======================================================================
echo             CÀO DỮ LIỆU SỐ SHOT VÀ KẾ HOẠCH TỪ TMS SMART
echo ======================================================================
echo Đang kết nối máy chủ TMS (iriso.tmssmart.vn)...
echo.

node "C:\Users\415\Desktop\cào dữ liệu\sync_tms_live.js"

echo.
echo ======================================================================
echo Nhấn phím bất kỳ để đóng cửa sổ...
pause >nul

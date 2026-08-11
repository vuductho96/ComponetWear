# Component Life

Ứng dụng local-only, không cần cài đặt và không dùng EXE.

## Chạy

1. Nhấp đúp `Start-ComponentLife.bat` để chạy app.
2. Nếu PowerShell hỏi execution policy, chạy trong PowerShell:
   `powershell -ExecutionPolicy Bypass -File .\ComponentLife.ps1`
3. Trình duyệt sẽ mở tự động. Đóng cửa sổ PowerShell để dừng app.

## Dữ liệu đầu vào

Shoot Data: `Date | Mold Name/Die Set | Output`.

Replacement Log: `Part | Series | Die Set | Replace Date`.

Khi thay linh kiện, mốc đó là `0`. Cycle chỉ tính giữa hai mốc thay liên tiếp. Output của ngày thay thuộc cycle mới (được đẩy sang ngày kế tiếp về mặt logic), nên cycle trước cộng các output có ngày `>= StartDate` và `< EndDate`.

Dữ liệu được lưu ở thư mục `data`; báo cáo `.xlsx` được tạo ở `reports`. Nếu Excel COM bị IT chặn, app tự tạo CSV (vẫn mở được bằng Excel) thay thế.

# ComponentLife - Hệ Thống Theo Dõi Độ Mòn & Quản Lý Tồn Kho Linh Kiện (SPP Control)

Ứng dụng web local-only hoàn toàn tự động, chạy trực tiếp trên PowerShell, **100% Độc Lập — Không Cần Cài Đặt Python hay Thư Viện Bên Ngoài**.

---

## 🚀 Tổng Quan Kiến Trúc Hệ Thống

Ứng dụng được thiết kế theo mô hình **Zero-Dependency Portable Architecture**, cho phép sao chép và khởi chạy lập tức trên bất kỳ máy tính Windows nào (Windows 10/11) mà không phụ thuộc vào Python, Node.js hay Microsoft Excel COM.

```
ComponentLife/
├── ComponentLife.html       # Giao diện Web App chính (Month Sheet & Stock Inventory)
├── ComponentLife.ps1        # Server HTTP Local + Bộ theo dõi file Excel thời gian thực
├── auto_sync_excel.ps1     # Engine đọc file Excel 100% Thuần PowerShell (ZipArchive + XmlReader)
├── auto_sync_excel.py      # Engine đọc Excel bằng Python (Fallback khi có Python)
├── ComponentMaster.json     # Danh mục Master 1,424 Linh kiện khuôn
└── data/
    ├── shoot-data.json      # Lịch sử 1,774 bản ghi số dập (Shoot output daily)
    ├── replacement-log.json # 187 bản ghi lịch sử thay thế linh kiện
    └── stock-data.json      # Mức tồn kho và định mức an toàn (Safety Stock)
```

---

## 🛠️ Tính Năng & Chi Tiết Các Tệp

### 1. [`ComponentLife.html`](file:///c:/Users/IRS03-415/Desktop/ComponetlifeApp/ComponentLife/ComponentLife.html) (Giao Diện Web App)
- **Tab 1: Month Sheet (Lưới Theo Dõi Ngày)**:
  - Hiển thị theo lưới 31 ngày trong tháng.
  - Tự động nạp số dập daily (`Shoot Number`) và lượt thay (`Replacement Time`).
  - **Chế độ Read-Only**: Các ô dữ liệu được bảo mật chỉ đọc (`contenteditable="false"`), tránh vô tình sửa đổi.
- **Tab 2: Quản Lý Tồn Kho (Stock Inventory)**:
  - Hiển thị tồn kho thực tế, mức min dự phòng, số lượng đã thay, số lần thay, ngày thay và Request ID.
  - **Bộ Lọc Đa Năng Tick Box (Checkbox)**: Cho phép tích chọn đồng thời nhiều trạng thái (`🔴 URGENT`, `🟡 NEED ORDER`, `🟢 NO NEED`, `🔧 ĐÃ THAY`, `Tất cả`).
  - **Tồn kho & Mức Min Chỉ Đọc**: Hiển thị dạng chữ đậm chỉ đọc.
- **Xuất Báo Cáo Excel Tối Ưu**:
  - Khi đang ở Tab Stock: Tự động xuất **duy nhất 1 Sheet Tồn Kho gọn nhẹ**.
  - **Gộp cột thông tin linh kiện**: Gộp `PART`, `SERIES`, `MOLD (OLD)`, `MOLD (NEW)` thành 1 cột duy nhất **`PART/SERIES/MOLD`** (Ví dụ: `201/10106S/MF00805/H10106S03`).
  - Gồm 7 cột chuẩn: `PART/SERIES/MOLD`, `MỨC MIN`, `TỒN KHO`, `ĐÃ THAY`, `SỐ LẦN`, `NGÀY THAY`, `ID REQUEST`.
- **Real-Time Live Preload**: Tự động kiểm tra phiên bản dữ liệu từ server (`/api/version`) mỗi 1.5s và tự động cập nhật lại giao diện ngay khi file Excel được lưu.

### 2. [`ComponentLife.ps1`](file:///c:/Users/IRS03-415/Desktop/ComponetlifeApp/ComponentLife/ComponentLife.ps1) (Server Backend & Monitor)
- **HTTP Server**: Chạy server TCP Listener trên cổng 8787.
- **File Modification Watcher (`Check-ExcelFileChanges`)**: Tự động theo dõi dấu mốc thời gian lưu (`LastWriteTime`) của tất cả file `.xlsx` trong thư mục workspace mỗi 1 giây.
- **Tự Động Kích Hoạt Đồng Bộ**: Khi người dùng chỉnh sửa và lưu file Excel (Ctrl+S), PowerShell lập tức kích hoạt sync và tăng phiên bản `$global:excelDataVersion++`.
- **API Endpoints**:
  - GET `/api/version`: Trả về phiên bản dữ liệu hiện tại phục vụ Live Preload.
  - GET `/api/heartbeat`: Duy trì trạng thái sống của app khi trình duyệt đang mở.
  - GET `/data/*.json`: Phục vụ dữ liệu JSON cho frontend.

### 3. [`auto_sync_excel.ps1`](file:///c:/Users/IRS03-415/Desktop/ComponetlifeApp/ComponentLife/auto_sync_excel.ps1) (Engine Đọc Excel Thuần PowerShell 100%)
- **Không Cần Python hay Excel**: Đọc trực tiếp các tệp `.xlsx` bằng .NET `ZipArchive` và `XmlReader` có sẵn trên Windows.
- **Chế Độ Khóa File Chia Sẻ (`FileShare.ReadWrite`)**: Cho phép đọc và đồng bộ dữ liệu file Excel **ngay cả khi file Excel đó đang mở và được chỉnh sửa trên màn hình**.
- **Đọc Đa Sheet Tự Động**:
  - Sheet `PartList`: Đọc và cập nhật linh kiện mới vào `ComponentMaster.json`.
  - Sheet `ShootNumber` / `ShootMonth`: Đọc số dập daily vào `shoot-data.json`.
  - Sheet Tháng (`07-2026`, `08-2026`...): Đọc lịch sử thay và tồn kho vào `replacement-log.json` & `stock-data.json`.

### 4. [`auto_sync_excel.py`](file:///c:/Users/IRS03-415/Desktop/ComponetlifeApp/ComponentLife/auto_sync_excel.py) (Engine Python Fallback)
- Phụ trợ đọc Excel bằng Python khi máy tính có sẵn môi trường Python.

---

## ⚡ Hướng Dẫn Sử Dụng & Sao Chép Sang Máy Khác

### Chạy tại máy hiện tại hoặc máy mới:
1. Mở cửa sổ PowerShell tại thư mục dự án và chạy:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\ComponentLife.ps1
   ```
2. Ứng dụng sẽ tự động mở trình duyệt web tại địa chỉ `http://127.0.0.1:8787/`.

### Quy trình cập nhật dữ liệu từ Excel:
1. Mở bất kỳ file Excel nào (`ShootMonth_ComponentMaster.xlsx` hoặc file SPP Control).
2. Thêm tên Part mới vào sheet `PartList` hoặc nhập số dập daily vào sheet `ShootNumber`.
3. Bấm **Ctrl+S** để lưu file Excel.
4. App sẽ tự động phát hiện, đồng bộ và làm mới dữ liệu trên màn hình trình duyệt trong vòng 2 giây!

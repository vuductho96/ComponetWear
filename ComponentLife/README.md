# ComponentLife - Hệ Thống Theo Dõi Độ Mòn & Quản Lý Tồn Kho Linh Kiện (SPP Control)

## Thay mẫu Excel báo cáo kiểm tra

Thay file đang khai báo ở `inspection-report.config.json`, lưu rồi Publish lại. Nếu đổi tên file, chỉ cập nhật đường dẫn `template`; không cần khai báo lại tọa độ ô hoặc vùng dữ liệu.

Bộ xuất tự nhận diện Point/Điểm, Nominal, hai cột Tol -/+, Tool, 10 cột Sample, Remark/Ghi chú và Judgement/Kết luận từ tiêu đề và ô gộp. Thông tin linh kiện, khuôn, ngày kiểm tra, bộ phận, vật liệu, HRC, số lượng được tìm theo nhãn; có thể dời hàng/cột hoặc đảo vị trí hai cột dung sai. Không bắt buộc giữ công thức cũ của mẫu. Mẫu cần đúng một biểu mẫu, giữ các tiêu đề nhận diện và 10 cột mẫu liên tiếp giữa Tool và Remark. Không nhận diện được hoặc gặp vùng trùng nghĩa thì báo lỗi, không tự điền phỏng đoán.

Báo cáo tiếp tục chia tối đa 40 point mỗi sheet, đặt tên theo point thực tế. Mẫu thiếu dòng đo được bổ sung đến 40; phần ngoại quan, ghi chú, chữ ký và vùng in dịch chuyển tương ứng. Nominal/Tol giữ định dạng nguồn; kết quả dạng số hiển thị 3 chữ số thập phân. Dòng có mẫu đo lặp chỉ in đậm Point/Nominal/Tol.

## Dimension OCR · Beta

Tab **Dimension OCR · Beta** phục vụ trực tiếp từ `dimension-ocr/` trên cùng Cloudflare Worker, không nhúng hoặc gọi Sites. Mã JavaScript, model YOLO/PP-OCR, thư viện PDF, WASM và font đều được lưu trong dự án; OCR chạy ở trình duyệt, không cần ChatGPT Premium, tài khoản OpenAI hoặc API key. Mở nhanh bằng `?tab=dimensionocr`. Công cụ chỉ khởi động khi mở tab, giữ bản vẽ khi chuyển tab, có toàn màn hình và mở riêng.

Người dùng chọn PDF/ảnh của mình để đọc, crop OCR và xuất CSV. Dữ liệu xử lý không được ghi vào thư mục đo hoặc Excel nguồn. Tab Đo linh kiện vẫn chỉ xem và không cung cấp PDF gốc. OCR Beta cần đối chiếu kết quả; các chức năng CAD/AI tùy chọn trong công cụ vẫn có yêu cầu riêng (ví dụ API key Gemini hoặc cầu nối CAD cục bộ), độc lập với OCR.

`dimension-ocr/assets.json` là danh sách công khai cố định cho bộ publish. Chỉ những tệp được kê trong đó mới được đưa lên cloud; không đưa checkout nguồn, `.git`, `.openai`, cấu hình riêng hoặc model OCR nội bộ của bộ đọc Inspection lên web. Giữ các thông báo giấy phép thư viện đi kèm. Tất cả tệp model/WASM đã chia nhỏ dưới giới hạn 25 MiB mỗi tệp.

## Đồng bộ website Cloudflare

Tab **Đo linh kiện** chỉ xem kết quả và bản vẽ, cho tải kết quả Excel. Bản vẽ chỉ xem bằng ảnh từng trang, có phóng to/thu nhỏ/chuyển trang; không cung cấp PDF gốc hoặc nút tải bản vẽ. Không có nhập, sửa, xóa trên tab này; không có KPI hay giờ đo. Trình duyệt vẫn cho phép chụp màn hình/lưu hình ảnh hiển thị.

Bấm một dòng Point để tìm số khoanh đỏ trên bản vẽ, chuyển đúng trang, zoom và đánh dấu vị trí. Số lặp có nút chuyển vị trí. Chỉ nhận các số khoanh đỏ có kết quả OCR đủ tin cậy và thống nhất qua hai cách cắt; không đảm bảo nhận được mọi bước trên bản scan. Nếu không thấy số, giao diện báo rõ, không suy đoán từ thứ tự điểm. Vẫn có thể kéo pan, cuộn chuột hoặc double-click để zoom.

Bảng điểm đo giữ riêng từng mẫu, không gộp các dòng cùng Point. Tam giác cạnh mỗi tiêu đề mở bộ lọc giá trị và sắp xếp thấp/cao. Ví dụ Sample → 1 chỉ hiện mẫu 1; có thể kết hợp nhiều bộ lọc cột, bỏ lọc từng cột hoặc tất cả. Lọc/sắp xếp cột reset khi đổi hồ sơ. Chọn một mẫu chỉ tô xanh mẫu đó, vẫn tìm theo số Point trên bản vẽ.

`inspection_points.py` tạo các tệp JSON tọa độ nhỏ từ ảnh xem, dùng OpenCV, NumPy và ONNX Runtime trong runtime Python hiện tại. Mô hình nhận dạng và bảng ký tự nằm riêng tại `.cloud-publish/inspection-ocr/recognizer.onnx` và `characters.txt` (sao chép từ mô hình Latin của RapidOcrProUpdateBundle trên máy). Không đưa mô hình hoặc PDF lên web. Kết quả nhận diện được cache theo nội dung bản vẽ, mã bộ nhận diện và mô hình; không chạy OCR trong trình duyệt hoặc lặp định kỳ.

Đường dẫn nguồn được cấu hình trong `inspection.config.json` ở thư mục dự án. Hai nguồn hiển thị là **LK mới về** và **Đo tủ LK thay thế**. Mỗi lần mở Start, bộ đọc `export_inspection.ps1` chạy một lần trước publish; chỉ đọc Excel/PDF, không chỉnh file nguồn. PDF được ghép theo tên linh kiện trong thư mục hồ sơ hoặc thư mục cha, ưu tiên bản dung lượng nhỏ; hồ sơ không có bản vẽ được ghi rõ. PDF gốc chỉ nằm trong thư mục nguồn/cache riêng trên máy. PyMuPDF và Pillow (runtime Python đi kèm Codex trên máy hiện tại) tạo ảnh WebP từng trang; web chỉ nhận ảnh khi mở phần Bản vẽ. Dữ liệu không đổi sẽ dùng lại kết quả đã tạo.

Mỗi lần mở `Start-ComponentLife.bat`, server đồng bộ Excel và cập nhật cloud một lần nếu nội dung khác bản publish thành công gần nhất. Sau khi thành công, không tự deploy tiếp trong phiên đó. Muốn đưa thay đổi tiếp theo lên cloud, mở lại Start hoặc chạy lệnh publish thủ công.

Inspection Tool có nút **Publish lên web** (module `InspectionTool.WebPublish.ps1` và `InspectionWebPublish.config.json` trong thư mục app đo). Nút chạy `Publish-Inspection-Web.ps1` ở tiến trình riêng, đọc lại kết quả/bản vẽ trước khi publish, bỏ qua deploy nếu dữ liệu không đổi. Nút tạm khóa trong lúc chạy, báo trạng thái qua tệp local, không polling cloud. Không cần đóng app đo hoặc mở lại Start. Nếu app đo đang mở từ trước khi cài nút, có thể chạy `Publish-Web.bat` trong thư mục app ngay; nút xuất hiện ở lần mở app tiếp theo.

- Chỉ có một publisher được chạy cùng lúc. Chỉ thử lại khi lần cập nhật đầu phiên thất bại.
- Mỗi lần deploy dùng bản sao riêng, chỉ gồm giao diện và dữ liệu công khai. Không upload script PowerShell, cache, backup hay báo cáo.
- Chỉ ghi thành công sau khi Wrangler thoát với mã 0 và SHA-256 của tất cả file trên website khớp bản sao đã deploy.
- Nếu lỗi, tự thử lại sau 15, 30, 60, 120, 240 giây rồi tối đa mỗi 300 giây. Đọc Excel lỗi sẽ tạm dừng publish và thử đọc lại mỗi lượt kiểm tra.
- Cần máy nguồn bật, server đang chạy, mạng, Node/npx và quyền deploy Cloudflare còn hiệu lực. Website vẫn phục vụ bản đã publish khi máy nguồn tắt.
- Trang cloud chỉ tải dữ liệu khi mở trang hoặc nhấn F5; không polling hay tự tải lại định kỳ. Các trang mở từ trước bản sửa này cần tải lại một lần để dừng bộ kiểm tra cũ.

Xem `.cloud-publish/publish.log`, `.cloud-publish/status.json` và `.cloud-publish/success.json` ở thư mục dự án. Khi server chạy, có thể đọc trạng thái qua `http://127.0.0.1:8787/api/publish-status`.

Publish thủ công từ thư mục dự án:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Publish-ComponentLife.ps1
```

Chỉ dựng và kiểm tra bản sao local: thêm `-BuildOnly`. Lệnh này không đồng bộ lại Excel; cần chạy server trước để tạo JSON mới nhất. Không gọi trực tiếp `wrangler deploy` để tránh bỏ qua kiểm tra và khóa chống deploy chồng.

Kiểm thử không truy cập Cloudflare:

```powershell
node --test tests/cloud-poll.test.cjs tests/publish.test.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File tests/publish-scheduler.tests.ps1
```

Ứng dụng chạy local bằng PowerShell và xuất bản bản xem trên Cloudflare. Phần ComponentLife đọc Excel bằng .NET; tab Đo linh kiện dùng ImportExcel, PyMuPDF và Pillow. Deploy cloud cần Node/npx và quyền Cloudflare.

---

## 🚀 Tổng Quan Kiến Trúc Hệ Thống

Phần ComponentLife cốt lõi dùng các thư viện .NET có sẵn trên Windows 10/11, không cần Microsoft Excel COM. Khi chuyển cả tính năng Đo linh kiện và deploy cloud sang máy khác, cần cấu hình lại đường dẫn nguồn và các runtime nêu trên.

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
- **Cập nhật dữ liệu**: Bản local kiểm tra phiên bản trên máy; bản cloud không polling. Mở lại Start để cập nhật cloud rồi F5 trang web để xem bản mới.

### 2. [`ComponentLife.ps1`](file:///c:/Users/IRS03-415/Desktop/ComponetlifeApp/ComponentLife/ComponentLife.ps1) (Server Backend & Monitor)
- **HTTP Server**: Chạy server TCP Listener trên cổng 8787.
- **File Modification Watcher (`Check-ExcelFileChanges`)**: Theo dõi dấu mốc thời gian lưu (`LastWriteTime`) của file `.xlsx` trong workspace mỗi 5 giây để đồng bộ bản local.
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

Dimension OCR Beta: drawings and result rows remain only in browser memory. Opening a file does not upload it. CSV results and current-page PNG drawings download locally without clearing the session; refreshing or closing the page clears it. Downloaded files remain on the user device.

Publish performance: JSON validation and SHA-256 hashing run in one Node process. Before deployment the publisher checks whether the cloud version matches the last verified success; only that verified baseline can reuse unchanged file hashes. It verifies the complete deployed manifest and downloads/hashes every changed or new asset. Missing or mismatched baselines fall back to full verification. Unchanged snapshots still skip deployment entirely.

Local publish hash cache: `.cloud-publish/file-hashes/` stores SHA-256 digests outside the public allowlist. Cache entries use file identity, byte size, modification time, change time and birth time at nanosecond precision. Changed files are read and JSON is validated; missing/corrupt/incompatible caches rebuild automatically. A before/after stat check rejects files that change during hashing. No content is uploaded by this check.

Inspection publishing uses the project-owned Python environment `.cloud-publish/python-runtime/Scripts/python.exe`, with pinned packages in `inspection-runtime-requirements.txt`. Create it with `python -m venv --copies .cloud-publish/python-runtime`, then run its Python with `-m pip install -r ComponentLife/inspection-runtime-requirements.txt`. This environment and all packages remain outside the public asset allowlist. Manual Publish checks dependencies before scanning. Cached drawing previews no longer import the PDF renderer unnecessarily.

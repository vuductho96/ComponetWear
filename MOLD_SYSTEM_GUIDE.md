# HỆ THỐNG GIÁM SÁT SỐ SHOT & BẢO DƯỠNG KHUÔN (MMFD & TMS REAL-TIME)
> **Tài liệu tham chiếu nhanh (Quick-Scan Architecture & Runbook)**  
> *Mục đích:* Cung cấp bức tranh toàn cảnh, bản đồ mã nguồn, logic nghiệp vụ, quy tắc bóc tách dữ liệu và cách xử lý sự cố để bất kỳ phiên làm việc nào cũng có thể nắm bắt ngay trong 30 giây mà không cần đọc lại toàn bộ dự án.

---

## 1. THÔNG TIN HỆ THỐNG & ĐƯỜNG DẪN TRỌNG YẾU

| Hạng mục | Giá trị / Đường dẫn |
| :--- | :--- |
| **Production URL** | `https://componetlife.vuductho-th.workers.dev/` (Bảo mật HTTPS Cloudflare) |
| **Giao diện chính** | Tab **🛠️ Bảo Dưỡng Khuôn** (`data-tab="moldmaintenance"`) |
| **Thư mục Web App** | `C:\Users\415\Desktop\ComponetlifeApp\ComponentLife` |
| **Logic Frontend** | `ComponentLife/js/mold-maintenance.js` |
| **Giao diện HTML** | `ComponentLife/index.html` (chứa modal thêm khuôn, container `#moldMaintenanceWorkspace`) |
| **Dữ liệu Khuôn Master**| `ComponentLife/data/mold-maintenance-data.json` (254 khuôn chuẩn từ Excel) |
| **Cloud Worker Backend** | `ComponetlifeApp/cloud/worker.mjs` & `cloud/tms-crawler.mjs` |
| **Thư mục Crawler Local** | `c:\Users\415\Desktop\cào dữ liệu` |
| **File Excel Gốc** | `đếm số shot và tiến hành bảo dưỡng khuôn.xlsx` (Master MMFD-I-F-022.01) |

---

## 2. QUY CHUẨN NGHIỆP VỤ BẢO DƯỠNG KHUÔN (SOP)

Theo quy định SOP và hình ảnh tài liệu kỹ thuật xưởng đúc:

1. **Chu kỳ bảo dưỡng thông thường (Tiêu chuẩn):**
   * **800.000 shot (800K):** Bắt buộc hạ khuôn, bảo dưỡng định kỳ và đo lại kích thước linh kiện ruột khuôn (core pins) theo *Mục III - Hướng dẫn đo kích thước linh kiện khuôn*.
2. **Khuôn Cấp Độ Cao (High-Impact Item):**
   * Ngoài mốc 800K, **350.000 ~ 400.000 shot (350K~400K)** bắt buộc phải bảo dưỡng dự phòng trước (Preventive Maintenance).
3. **Mốc Đại Tu (3.000.000 shot - 3M):**
   * Bảo dưỡng tổng thể toàn bộ khuôn. Khi chạy lại phải lấy mẫu thử và đánh giá toàn bộ kích thước bản vẽ (như đánh giá sản phẩm mới).
   * Sau mốc 3M, mỗi 800K tiếp theo vẫn bảo dưỡng và đánh giá lại các bước quan trọng trên bản vẽ.
4. **Mốc Cận Vòng Đời & Thanh Lý (4.500.000 ~ 5.000.000 shot - 4.5M~5M):**
   * Khi đạt **4.5M shot**: Bắt buộc làm báo cáo gửi JP HQ (Trụ sở Nhật Bản) xin phương án xử lý (thay mới khuôn hoặc các biện pháp cần thiết).
   * Khi chạm **5M shot**: Hết vòng đời an toàn cho sản xuất.
5. **Cơ chế tính Mốc 1..5 vs Tổng Vòng Đời:**
   * **Mốc 1 đến Mốc 5:** Đếm số shot tích lũy trong năm hiện tại (**2026**). Reset theo từng năm.
   * **Tổng Vòng Đời (`total_life`):** Tích lũy trọn đời khuôn xuyên suốt từ các năm trước cộng dồn với năm nay.

---

## 3. CẤU TRÚC FILE EXCEL & QUY TẮC BÓC TÁCH DỮ LIỆU SẠCH (ZERO-JUNK)

File Excel `đếm số shot và tiến hành bảo dưỡng khuôn.xlsx` gồm nhiều sheet:
* `Shot count`, `Shot count 1`, `Shot count 2`, `Shot count 3`, `Shot count 3 `, `HIGH IMPACT ITEM 1 `.

### ⚠️ Cảnh báo cấu trúc bẫy trong Excel:
* Trong mỗi sheet, danh sách khuôn thật nằm từ **dòng 6 đến dòng 52 (hoặc dòng 62/80)**.
* Ngay sau dòng khuôn cuối cùng luôn là dòng chữ:  
  `Note : Safety limits to automatic machines will alarm...`
* **Từ dòng 53/81 trở xuống** là bảng kế hoạch lịch bảo dưỡng năm (chứa các mã `32CAV`, `8CAV`, `FA06001`, `30-Jan`...).
* **Quy tắc trích xuất sạch:**
  1. Chỉ đọc các dòng có `Mã khuôn` hợp lệ bắt đầu bằng chữ cái (`H...`, `MF...`, `FA...`).
  2. Dừng ngay lập tức khi gặp chuỗi `Note : Safety limits` hoặc `MOLD NAME & CAV`.
  3. Bỏ qua hoàn toàn các dòng header phụ `TÊN KHUÔN/CAVITY`, `Item Name`, hoặc chỉ chứa số cavity `/^\d+CAV$/i`.
  4. Kết quả trích xuất chuẩn xác: **254 khuôn master** duy nhất.

---

## 4. BẢN ĐỒ GIAO DIỆN & TÍNH NĂNG TRÊN DASHBOARD

Giao diện gồm 2 Subtab đồng bộ:

### 4.1. Bảng 🎯 Mold (Bảo Dưỡng Theo Khuôn)
* **Tiêu đề:** `🎯 Mold` (Bảo Dưỡng Theo Khuôn).
* **Bộ lọc:** Lọc theo Trạng thái mốc (`Tất cả`, `Cần bảo dưỡng`, `Cảnh báo`, `An toàn`) và Phân loại khuôn (`Tiêu chuẩn 800K`, `High-Impact 350K~400K`).
* **Cột mặc định hiển thị (Gọn gàng, vừa màn hình):**
  1. `STT`
  2. `MÃ KHUÔN (MOLD NO)`
  3. `DÒNG SẢN PHẨM (SERIES)`
  4. `MÁY ĐANG ÉP` (Live TMS hoặc badge `Trong kho`)
  5. `CHU KỲ` (Mốc 1..5)
  6. `SỐ SHOT CHU KỲ`
  7. `TRẠNG THÁI`
  8. `MỐC 1` .. `MỐC 5` (Kèm checkbox `✅ Đã chốt`)
  9. `TỔNG SHOT` (Vòng đời tích lũy)
  10. `NOTE (GHI CHÚ)` (Ô input tự lưu ghi chú)
  11. `[+]` (Nút mở Popover thêm/ẩn cột)
* **Các cột mặc định ẩn (Mở qua nút `[+]`):**
  * `Tiêu chuẩn (tier)`
  * `Mốc Plan (SOP)`
  * `Tiến độ chạm mốc (%)`

### 4.2. Bảng ⚡ Machine (Theo Dõi Shot Theo Máy Ép)
* **Tiêu đề:** `⚡ Machine` (Xem Shot Theo Máy).
* **Danh sách:** Live **44 máy ép** tại xưởng (`F3-1` đến `S10-8`).
* **Cột dữ liệu:** `Mã Máy` | `Mã Khuôn Gá Trên Máy` | `Số Shot Trong Ngày` | `Mốc 1` | `Mốc 2` | `Mốc 3` | `Tổng Shot` | `Note`.
* **Bộ lọc ngày:** Cho phép xem số shot lùi lại Hôm qua (Hôm trước) hoặc bất kỳ ngày nào trong tháng.

### 4.3. Thanh công cụ đầu trang
* **Timer Auto Refresh:** Lựa chọn `Tắt`, `15 phút`, `30 phút`, `1 giờ`. Đặt cạnh nút **Export Excel**.
* **Nút 🔄 Refresh:** Bấm để kích hoạt quét và cập nhật số shot mới nhất ngay lập tức.
* **Nút 📥 Export Excel:** Xuất toàn bộ bảng ra file chuẩn định dạng Excel `MMFD-I-F-022.01`.
* **Thêm Khuôn Mới:** Khi đăng nhập tài khoản `Admin` hoặc `Staff`, có nút thêm khuôn mới đầy đủ thông tin vào hệ thống.

---

## 5. TÍCH HỢP TMS SMART & VẤN ĐỀ AN NINH MẠNG (TREND MICRO)

### 5.1. Các Endpoint TMS Smart nội bộ
* **Đăng nhập:** `POST http://iriso.tmssmart.vn/api/v1/users/login` (Tài khoản xưởng: `toan1827 / 123450`)
* **Danh sách 44 máy:** `GET http://iriso.tmssmart.vn/api/v1/machineInformations/?offset=0&limit=100`
* **Checklist sản xuất ngày:** `GET http://iriso.tmssmart.vn/api/v1/dailyMachineChecklists/?offset=0&limit=300&dateOfManufacture={ISO_DATE}`
* **Thông số cảm biến máy:** `GET http://iriso.tmssmart.vn/api/v1/injectionDashboards/getSpec?machineNo={CODE}`

### 5.2. Nguyên nhân bị Trend Micro Worry-Free chặn & Quy tắc phòng ngừa
* **Nguyên nhân:**
  * Server TMS chạy giao thức `http://` (cổng 80) trong mạng nội bộ LAN (`10.217.1.182`), không có SSL/HTTPS quốc tế.
  * Khi script cào dữ liệu chạy từ máy trạm cá nhân, việc gửi hàng loạt request liên tiếp trong vài giây kích hoạt bộ lọc **Behavior Monitoring & Web Reputation** của Trend Micro trên máy tính.
  * Trend Micro đánh nhãn `iriso.tmssmart.vn` là **`Rating: Untested / Unrated`** và tự động chặn cục bộ trên máy đó.
* **Quy tắc phòng ngừa (Best Practice):**
  1. **Không chạy script crawler dồn dập từ máy trạm:** Việc cào định kỳ phải để Cloud Worker hoặc Server dịch vụ thực hiện với rate-limiting (delay 1-2s giữa các request).
  2. **Giải pháp mở khóa:** Nhờ IT thêm `iriso.tmssmart.vn` vào **Approved URL List (Whitelist)** của Trend Micro Worry-Free.
  3. **Người dùng cuối:** Truy cập xem dữ liệu qua link Cloudflare HTTPS `https://componetlife.vuductho-th.workers.dev/` an toàn tuyệt đối, không bao giờ bị chặn.

---

## 6. QUY TRÌNH DEPLOY LÊN CLOUDFLARE WORKERS

Mỗi khi chỉnh sửa mã nguồn Frontend (`ComponentLife`) hoặc Backend (`cloud`):

1. **Đồng bộ file từ thư mục phát triển sang thư mục deploy:**
   ```powershell
   Copy-Item -Path "C:\Users\415\Desktop\ComponetlifeApp\ComponentLife\js\mold-maintenance.js" -Destination "C:\Users\415\Desktop\ComponetlifeApp\.cloud-publish\assets\js\mold-maintenance.js" -Force
   ```
2. **Kiểm tra cú pháp JS:**
   ```powershell
   node --check "C:\Users\415\Desktop\ComponetlifeApp\ComponentLife\js\mold-maintenance.js"
   ```
3. **Thực thi Deploy:**
   ```powershell
   cd "C:\Users\415\Desktop\ComponetlifeApp"
   npx wrangler deploy
   ```
4. **Kiểm tra trực tiếp sau Deploy:**
   ```powershell
   cd "c:\Users\415\Desktop\cào dữ liệu"
   node check-prod.mjs
   ```
   *(Script sẽ tự động khởi động Edge không đầu, chụp ảnh màn hình bảng Mold, Popover `[+]`, và bảng Machine để xác thực không có lỗi JS hay rác bảng).*

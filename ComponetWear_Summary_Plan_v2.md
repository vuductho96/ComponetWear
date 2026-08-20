# ComponetWear — Summary Plan

## 1. Mục tiêu

ComponetWear là hệ thống đơn giản để:

- Quản lý danh sách linh kiện theo khuôn.
- Thu thập Shot Number của khuôn.
- Thu thập lịch sử thay linh kiện.
- Tính tuổi thọ thực tế của linh kiện.
- Từ lịch sử thay nhiều lần, suy ra Design Life.
- Xuất báo cáo Excel tùy biến.

Không xây thành CMMS/ERP. Ưu tiên đơn giản, ổn định, dễ chạy nội bộ.

---

## 2. Kiến trúc

```text
Excel nguồn
   ↓
auto_sync_excel.ps1
   ↓
Raw JSON
   ↓
calculate_engine.ps1
   ↓
Component State
   ↓
Web UI
   ↓
Report Builder → Excel
```

### 3 PS1 chính

```text
ComponentLife.ps1
    → Localhost Web Server / API / runtime

auto_sync_excel.ps1
    → Đọc Excel, normalize dữ liệu, cập nhật raw JSON

calculate_engine.ps1
    → Tính toàn bộ Component Life / KPI
```

Không tách thêm PS1 khi chưa cần thiết.

---

## 3. Nguồn dữ liệu

ComponetWear sử dụng **toàn bộ thông tin** từ 2 file Excel nguồn. Không bỏ các cột hoặc thông tin có giá trị chỉ vì hiện tại chưa dùng đến. Dữ liệu sẽ được normalize để engine có thể sử dụng về sau.

### 1. MMFD-I-F-019.02 SPP CONTROL 2026.xlsx

Lấy **toàn bộ dữ liệu có ý nghĩa** trong workbook, bao gồm nhưng không giới hạn:

- Part / Component
- Series
- Die Set / Mold
- Quantity
- Request ID
- Issue / Replacement Date
- Stock / Inventory information
- Các thông tin liên quan khác có trong các sheet

Không chỉ lấy Replacement Event.

### 2. ShootMonth_ComponentMaster.xlsx

Lấy **toàn bộ dữ liệu** trong workbook, bao gồm:

- Component Master
- Part
- Series
- Old Die Set
- New Die Set
- Mold / Die Set mapping
- Shoot Number
- Date
- Machine
- Mold Name
- Output
- Cavity / CAV
- QTY
- Các thông tin khác có trong các sheet

Không bỏ dữ liệu chỉ vì calculation engine hiện tại chưa sử dụng.

### Quy tắc mã linh kiện

Các thành phần phải được giữ/ghép thành **một mã đầy đủ**, ví dụ:

```text
CF01A/9615S/FA06001/H9615S01
```

Không tách thành các mã độc lập khi tạo identity chính của linh kiện.

Nếu dữ liệu nguồn nằm ở nhiều cột:

```text
CF01A
9615S
FA06001
H9615S01
```

thì engine tạo canonical component code:

```text
CF01A/9615S/FA06001/H9615S01
```

Mã đầy đủ này được dùng làm khóa nhận diện linh kiện xuyên suốt hệ thống.

Các thành phần gốc vẫn được giữ riêng trong raw/normalized data để không mất thông tin.

---

## 4. Raw Data

Giữ dữ liệu gốc đơn giản:

```text
data/
├── component-master.json
├── shoot-data.json
└── replacement-log.json
```

Nguyên tắc:

> Store events, calculate everything else.

Không lưu cứng các giá trị có thể tính lại.

---

## 5. Calculation Engine

`calculate_engine.ps1` là **core của ComponetWear**.

Mục tiêu chính:

> Mỗi lần linh kiện được lắp → chạy → tháo ra = 1 completed cycle.  
> Tuổi thọ của cycle = số shot từ lúc lắp đến lúc tháo.

### 5.1. Component State

Engine tạo trạng thái đầy đủ cho từng linh kiện:

```text
Component
Mold
Part
CurrentShot
TotalShot
ReplacementCount
FirstInstallDate
LastReplacementDate
CurrentLife

CycleCount
MinLife
MaxLife
AverageLife
MedianLife
RemainingLife
UsagePercent
Status
```

---

### 5.2. Tính tuổi thọ từng Cycle

Ví dụ:

```text
Cycle 1:
Lắp    → Shot 1,000,000
Tháo   → Shot 1,900,000

Life 1 = 1,900,000 - 1,000,000
       = 900,000 shots
```

Cycle tiếp theo:

```text
Cycle 2:
Lắp    → Shot 1,900,000
Tháo   → Shot 2,950,000

Life 2 = 2,950,000 - 1,900,000
       = 1,050,000 shots
```

Mỗi cycle hoàn chỉnh được lưu trong Life History.

**Cycle đang chạy chưa tháo không được đưa vào Average Life.**

Nó chỉ được tính:

```text
CurrentLife = CurrentShot - ShotAtInstallation
```

---

### 5.3. Các chỉ số lịch sử

Với các cycle đã hoàn thành:

```text
Life:
900,000
1,050,000
950,000
1,000,000
980,000
```

Engine tính:

```text
CycleCount = 5

MinLife    = 900,000
MaxLife    = 1,050,000
AverageLife = 976,000
MedianLife = 980,000
```

Trong đó:

```text
AverageLife
= SUM(All Completed Cycle Life) / CycleCount
```

Không sử dụng `(MIN + MAX) / 2` để gọi là Average.

---

### 5.4. Không sử dụng Design Life

Giai đoạn hiện tại **không luận ra, không lưu và không tự đề xuất Design Life**.

ComponetWear chỉ phản ánh dữ liệu thực tế:

```text
CycleCount
MinLife
MaxLife
AverageLife
MedianLife
CurrentLife
```

Mục tiêu:

> Thu thập dữ liệu Replacement + Shot Number → tính chính xác tuổi thọ thực tế của từng cycle.

Không tự suy diễn tuổi thọ thiết kế từ dữ liệu hiện có.

Nếu sau này cần xác lập Design Life, có thể bổ sung một rule/module riêng mà không ảnh hưởng Calculation Engine hiện tại.

---

### 5.5. Current Life

Cycle hiện tại chưa hoàn thành:

```text
CurrentLife
= CurrentShot - ShotAtInstallation
```

Ví dụ:

```text
ShotAtInstallation = 5,850,000
CurrentShot        = 6,200,000

CurrentLife = 350,000
```

`350,000` không được đưa vào Average/Median/Min/Max Life cho đến khi component được tháo.

---

### 5.6. Remaining Life và Usage

Giai đoạn hiện tại **không tự tính Remaining Life / Usage Percent theo Design Life**, vì hệ thống không xác lập Design Life.

Nếu sau này có một mốc chuẩn được cấu hình riêng, các chỉ số này có thể được bổ sung.

---

### 5.9. Nguyên tắc quan trọng

Calculation Engine phải **tính lại từ raw data**, không phụ thuộc vào các giá trị đã tính trước đó.

Ví dụ:

```text
Raw Shoot Data
+
Replacement History
+
Component Master
        ↓
calculate_engine.ps1
        ↓
Component State
```

Nếu sau này sửa công thức Design Life, chỉ cần chạy lại engine là có thể recalculate toàn bộ lịch sử.


---

## 6. Final Report

Báo cáo final dạng Excel, nhưng KHÔNG khóa cứng số lượng cột.

### Report Builder

UI cho phép:

- Add column
- Remove column
- Drag & drop để đổi thứ tự
- Export Excel

Ví dụ:

```text
[ STT ]          [Remove]
[ Mold ]         [Remove]
[ Component ]    [Remove]
[ Current Shot ] [Remove]
[ Design Life ]  [Remove]

[ + ADD COLUMN ]

[ EXPORT EXCEL ]
```

Bấm `+ ADD COLUMN` → chọn các field có sẵn:

```text
Total Shot
Total Replacement
Average Life
Median Life
Min Life
Max Life
Remaining Life
Usage %
Last Replacement Date
Material
Request ID
...
```

Không thích cột nào → Remove.

---

## 7. Nguyên tắc quan trọng

### UI không tính toán

UI chỉ:

- Hiển thị
- Chọn field
- Sắp xếp field
- Export

### Calculation Engine mới là nơi tính toán

Sau này thêm KPI mới → thêm calculation vào engine.

Ví dụ:

```text
Cost Per Million Shot
Replacement Frequency
P95 Life
Life Trend
```

Không cần thay đổi database/raw data.

---

## 8. Mục tiêu cuối

ComponetWear phải đơn giản:

```text
Excel
 ↓
Sync
 ↓
Calculate
 ↓
Track Component Life
 ↓
Build Report
 ↓
Excel
```

Không cần:

- Database server
- SQLite ở giai đoạn hiện tại
- Python runtime
- Node.js
- ERP/CMMS features

PowerShell + JSON + HTML/JS là đủ.

---

## 9. Development Priority

### P0
- Ổn định Excel Sync.
- Chuẩn hóa mapping Part → Mold.
- Chuẩn hóa Replacement Event.
- Xác định chính xác cách tính Shot tại thời điểm thay.

### P1
- Tạo `calculate_engine.ps1`.
- Sinh Component State.
- Tính Life History + Replacement Count.
- Tính Design Life.

### P2
- Hoàn thiện Final Report.
- Report Builder: Add / Remove / Drag.
- Export Excel.

### P3
- Thêm KPI mới khi thực tế phát sinh.
- Logging / validation / backup nếu cần.

---

## 10. Core Philosophy

> **ComponetWear không phải hệ thống quản lý khổng lồ.**

Nó là một **Component Life Tracking Engine**:

> Thu thập Shot Number + Replacement History → tính tuổi thọ linh kiện → tạo báo cáo tùy biến.

Giữ hệ thống nhỏ, dễ sửa, dễ triển khai và có khả năng mở rộng field/report về sau.

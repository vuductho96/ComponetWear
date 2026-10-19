# Kế hoạch tích hợp Inspection Tool vào ComponentLife

Ngày kiểm tra: 19/10/2026 (Asia/Bangkok).

## Hiện trạng đã xác minh

- Website trả HTTP 200. SHA-256 của index.html, js/api.js, js/app.js, ComponentMaster.json và ba JSON shoot/replacement/stock trên cloud trùng file local tại thời điểm kiểm tra.
- wrangler.jsonc hiện chỉ deploy static assets từ ComponentLife, chưa có Worker API hay database.
- ComponentLife.ps1 có Deploy-ToCloudflareWorkers, gọi khi watcher phát hiện Excel thêm/sửa/xóa trong thư mục dự án hoặc thư mục ComponentLife (không đệ quy).
- Điều kiện tự deploy: server local đang chạy, có mạng, Node/npx và quyền Cloudflare còn hiệu lực. Chưa chạy thử deploy trong lần kiểm tra này.
- Khởi động server có sync nhưng không deploy; sửa khi server tắt rồi mở lại có thể không được đẩy lên cloud. Sửa HTML/JS/CSS/JSON trực tiếp cũng không kích hoạt watcher.
- Deploy chạy ngầm, chưa lưu exit code/log, chưa khóa chống deploy chồng, chưa retry khi lỗi.
- /api/version trên cloud trả 404. Frontend dừng heartbeat/version polling sau ba lần lỗi; người xem cần tải lại trang để nhận snapshot mới.

## Mục tiêu và kiến trúc đề xuất

Thêm tab Inspection: xem lô linh kiện, trạng thái đã/chưa đo, OK/NG, chi tiết điểm đo, KPI theo ngày/tháng/năm và xuất Excel. Bản đầu chỉ đọc trên cloud; nhập/sửa vẫn thực hiện tại máy nguồn.

Luồng: Excel trên Windows → bộ trích xuất Inspection chạy local → JSON đã chuẩn hóa → gói snapshot ComponentLife + Inspection → deploy Cloudflare → tab web đọc snapshot.

PowerShell WinForms không chạy trên Workers và không thể nhúng trực tiếp thành tab. Tách logic khỏi GUI, giữ ImportExcel cho bộ trích xuất local. Web không tự đọc được đường dẫn C:\ trên máy người dùng.

## Giai đoạn 1 — Làm chắc cơ chế cập nhật

1. Tạo tác vụ sync/publish chung: debounce, chỉ một lần deploy tại một thời điểm, xếp lượt nếu nguồn đổi trong lúc deploy; ghi log/exit code, retry có giới hạn.
2. Sync lúc khởi động, so hash với snapshot đã publish thành công; publish nếu khác. Theo dõi cả nguồn Excel, nguồn Inspection và mã giao diện; loại cache, file tạm, báo cáo xuất để tránh vòng lặp.
3. Sinh data/version.json chứa snapshotId dạng hash, generatedAt và số bản ghi. Cloud polling file này độc lập với heartbeat local; so khác hash thay vì so số tăng dần theo lần mở server.
4. Hiển thị thời điểm cập nhật và trạng thái dữ liệu. Khi đổi phiên bản dữ liệu thì nạp lại; khi đổi phiên bản mã thì đề nghị tải lại trang.
5. Chỉ xuất bản snapshot hoàn chỉnh sau khi các nguồn bắt buộc đọc thành công; giữ bản tốt gần nhất khi gặp file khóa/lỗi. Hiển thị rõ nguồn nào đang lỗi.

## Giai đoạn 2 — Tách bộ dữ liệu Inspection

Nguồn: C:\Users\415\Desktop\File đo linh kiện\InspectionTool.ps1 và các thư mục Excel đã chọn. Cấu hình thư mục rõ ràng, không quét file backup/archive/cache.

- Tách Read-InspectionFile, Extract-DimensionsFromWorksheet, logic thời gian/ca, lot và KPI thành module không phụ thuộc Controls/WinForms.
- Giữ quy tắc hiện có: Part=C5, Mold=G5, DateMeasure=N4, RawQty=N6; tiêu chuẩn A:D từ dòng 14, mẫu đo F:O; dung sai tính từ nominal và hai giá trị tolerance.
- Giữ quy tắc phân bổ Qty theo lô để tránh đếm trùng, thời gian ca/nghỉ, time-overrides và nhận diện đã/chưa đo; kiểm tra đối chiếu với ứng dụng desktop.
- Dùng ID ổn định theo đường dẫn tương đối và nguồn, không dùng Part/Mold làm khóa duy nhất. Chuẩn hóa ngày, số, null và schemaVersion.
- Tách data/inspection/summary.json, kpi.json và chi tiết từng hồ sơ để chỉ tải điểm đo khi chọn một dòng.
- Không đưa đường dẫn tuyệt đối, metadata nội bộ hay workbook gốc vào public assets. Kiểm kê assets đang publish; dùng danh sách file cho phép hoặc thư mục dist riêng.

## Giai đoạn 3 — Tab giao diện

- Nút tab Inspection và trạng thái riêng cho lọc/sắp xếp/phân trang.
- KPI: số lô, số lượng, đã/chưa đo, OK/NG, phút đã dùng/còn lại; chọn ngày/tháng/năm, ca 9h hoặc cấu hình hiện có.
- Bảng: linh kiện, khuôn, lô, ngày vào, ngày đo, số lượng, bắt đầu/kết thúc, phút/chiếc, chất lượng và ghi chú.
- Bộ lọc tìm kiếm, thời gian, nguồn linh kiện mới/tủ linh kiện, đã/chưa đo và OK/NG.
- Khi chọn dòng, xem nominal/tolerance/giới hạn, từng mẫu đo, sai lệch và đánh dấu NG; tùy chọn chỉ hiện NG.
- Xuất bảng đang lọc, KPI và chi tiết bằng ExcelJS đã có. Các nút mở file/thư mục Windows chỉ áp dụng ở local; cloud dùng tải file nếu giai đoạn sau có lưu trữ và phân quyền.
- Chat hỏi đáp dữ liệu/PDF đưa sang giai đoạn sau; phiên bản đầu ưu tiên dữ liệu đo và KPI chính xác.

## Giai đoạn 4 — Kiểm chứng và nghiệm thu

- Đối chiếu số hồ sơ/lô/số lượng, điểm NG và KPI với desktop trên cùng tập nguồn, cùng ca và cùng bộ lọc.
- Kiểm tra giá trị đúng biên dung sai, thiếu ngày, nhiều file cùng lô, trùng Part khác khuôn, file khóa và dữ liệu không hợp lệ.
- Thử thêm/sửa/xóa Excel; thay đổi khi server tắt rồi mở lại; mất mạng, lỗi deploy và hai thay đổi liên tiếp.
- Sau publish, kiểm tra snapshotId cloud trùng local và trang đang mở tự nhận dữ liệu mới; kiểm tra tab khác không bị ảnh hưởng.
- Kiểm tra máy tính/điện thoại, xuất Excel và thời gian tải; tải chi tiết theo yêu cầu.

## Mở rộng nếu cần chỉnh sửa từ xa

Thêm Worker API, đăng nhập/phân quyền, database và nhật ký thay đổi. Dùng local agent xác thực để đồng bộ hai chiều với Excel, xử lý xung đột và xác nhận ghi thành công. Có thể thêm R2 cho workbook/PDF nếu cần xem/tải từ xa. Không cần phần này cho bản dashboard chỉ đọc.

## Thứ tự triển khai

1. Sync/publish và version cloud hoạt động tin cậy.
2. Bộ trích xuất Inspection + đối chiếu desktop.
3. Tab Inspection + KPI + chi tiết + xuất Excel.
4. Kiểm thử toàn luồng, duyệt bản local rồi publish.

Phạm vi lần làm việc này: kiểm tra read-only và lập kế hoạch; chưa thay mã ứng dụng, chưa chạy InspectionTool GUI, chưa deploy.

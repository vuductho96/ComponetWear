/* UI text only. Measurements, input values, file names and stored records are never rewritten. */
(() => {
  'use strict';
  const languages = ['vi', 'en', 'ja', 'zh'];
  const storageKey = 'componetwear_language';
  const entries = [
    ['Ngôn ngữ','Language','言語','语言'],
    ['Tổng Quan','Overview','概要','总览'],
    ['Theo Dõi Tháng','Monthly Tracking','月次管理','月度跟踪'],
    ['Quản Lý Linh Kiện','Components','部品管理','零件管理'],
    ['Phân Tích & Biểu Đồ','Analytics & Charts','分析・グラフ','分析与图表'],
    ['Đo linh kiện','Inspection','部品測定','零件测量'],
    ['Tổng Quan Sản Xuất','Production Overview','生産概要','生产总览'],
    ['Bảng Theo Dõi Tháng','Monthly Tracking','月次管理表','月度跟踪表'],
    ['Quản Lý Linh Kiện & Tuổi Thọ','Components & Service Life','部品・寿命管理','零件与寿命管理'],
    ['Phân Tích & Biểu Đồ Tiêu Hao','Consumption Analytics','消耗分析・グラフ','消耗分析与图表'],
    ['Navigation','Navigation','メニュー','导航'],
    ['Hệ Thống Trực Tuyến','System Online','システム稼働中','系统在线'],
    ['Chế độ tối','Dark mode','ダークモード','深色模式'],
    ['Chế độ sáng','Light mode','ライトモード','浅色模式'],
    ['Chuyển chế độ Sáng / Tối','Switch light / dark mode','ライト・ダーク切替','切换浅色／深色模式'],
    ['Thu nhỏ / Mở rộng thanh bên','Collapse / expand sidebar','サイドバーを折りたたむ／展開','收起／展开侧栏'],
    ['Tổng quan thông số & cảnh báo (Overview)','Overview and alerts','概要・警告','总览与警报'],
    ['Bảng theo dõi dữ liệu theo ngày (Month Sheet)','Daily data by month','月別の日次データ','按月查看每日数据'],
    ['Bảng điều khiển quản lý tổng hợp (Unified Dashboard)','Component management dashboard','部品管理ダッシュボード','零件管理看板'],
    ['Biểu đồ phân tích & cảnh báo tuổi thọ (Analytics)','Service life analytics and alerts','寿命分析・警告','寿命分析与警报'],
    ['Kết quả đo và bản vẽ linh kiện','Inspection results and drawings','測定結果・部品図面','测量结果与零件图纸'],
    ['Tìm nhanh Part, Mold, Series...','Search Part, Mold, Series...','部品・金型・シリーズを検索...','搜索零件、模具、系列...'],
    ['Xóa tìm kiếm','Clear search','検索をクリア','清除搜索'],
    ['Lọc theo năm','Filter by year','年で絞り込み','按年份筛选'],
    ['Lọc theo tháng','Filter by month','月で絞り込み','按月份筛选'],
    ['Lọc theo ngày','Filter by day','日で絞り込み','按日期筛选'],
    ['Import Excel','Import Excel','Excelを取込','导入Excel'],
    ['Export Excel','Export Excel','Excelを出力','导出Excel'],
    ['Xuất báo cáo Excel','Export Excel report','Excelレポートを出力','导出Excel报表'],
    ['Kéo thả hoặc chọn file Excel (.xlsx)','Drop or select an Excel file (.xlsx)','Excelファイルを選択またはドロップ','拖放或选择Excel文件'],
    ['Xóa Dữ Liệu','Clear Data','データを消去','清除数据'],
    ['Tổng Linh Kiện Theo Dõi','Tracked Components','管理対象部品数','跟踪零件总数'],
    ['Trong danh mục master','In the master list','マスタ登録数','主数据目录'],
    ['Tổng Sản Lượng Dập (Shots)','Total Production (Shots)','総プレス数（ショット）','冲压总产量（模次）'],
    ['Sản lượng kỳ đã chọn','Output for selected period','選択期間の生産数','所选期间产量'],
    ['Tổng Lượt Thay Thế','Total Replacements','交換総回数','更换总次数'],
    ['Trong năm được chọn','In selected year','選択年の合計','所选年份'],
    ['Tuổi Thọ TB Chu Kỳ (Shots)','Average Cycle Life (Shots)','平均サイクル寿命（ショット）','平均周期寿命（模次）'],
    ['Từ các chu kỳ hoàn chỉnh','From completed cycles','完了サイクルから算出','基于完整周期'],
    ['Cảnh Báo Tồn Kho & Tuổi Thọ','Stock & Service Life Alerts','在庫・寿命アラート','库存与寿命警报'],
    ['Top Linh Kiện Thay Thế Nhiều Nhất','Most Replaced Components','交換回数の多い部品','更换最多的零件'],
    ['Top 5 Part List Thay Ra Nhiều Nhất','Top 5 Replaced Parts','交換回数上位5部品','更换最多的前5种零件'],
    ['Thống kê 5 mã linh kiện có số lần thay thế nhiều nhất tính theo năm','Five most replaced parts by year','年間交換回数の多い上位5部品','按年份统计更换次数最多的5种零件'],
    ['Đến Quản Lý','Manage Components','部品管理へ','进入管理'],
    ['Cảnh báo quan trọng:','Important alerts:','重要な警告：','重要警报：'],
    ['Gợi ý nhanh:','Quick tips:','ヒント：','快捷提示：'],
    ['Tất cả','All','すべて','全部'],
    ['Tất cả các năm','All years','すべての年','全部年份'],
    ['Chi tiết','Details','詳細','详情'],
    ['Chưa có','None yet','未登録','暂无'],
    ['Chưa có chu kỳ','No cycles yet','サイクルなし','暂无周期'],
    ['Khuôn:','Mold:','金型：','模具：'],
    ['thay thế','replacements','交換','更换'],
    ['Loại','Type','種別','类型'],
    ['Lượt thay','Replacements','交換回数','更换次数'],
    ['Lượt Thay','Replacements','交換回数','更换次数'],
    ['Số lượng (Pcs)','Quantity (Pcs)','数量（個）','数量（件）'],
    ['TÊN KHUÔN','MOLD','金型名','模具名称'],
    ['LƯỢT THAY','REPLACEMENTS','交換回数','更换次数'],
    ['SỐ LƯỢNG (PCS)','QUANTITY (PCS)','数量（個）','数量（件）'],
    ['ĐỘ MÒN (%)','WEAR (%)','摩耗率（%）','磨损率（%）'],
    ['Tổng Pcs','Total Pcs','総数（個）','总数（件）'],
    ['TB Shot','Avg Shots','平均ショット','平均模次'],
    ['Shot HT','Current Shots','現在のショット','当前模次'],
    ['Part','Part','部品','零件'],
    ['Part Name','Part Name','部品名','零件名称'],
    ['Mold','Mold','金型','模具'],
    ['Series','Series','シリーズ','系列'],
    ['Mold / Series','Mold / Series','金型／シリーズ','模具／系列'],
    ['Mold + Series','Mold + Series','金型・シリーズ','模具和系列'],
    ['Stock','Stock','在庫','库存'],
    ['Min Stock','Min Stock','最低在庫','最低库存'],
    ['Standard Stock','Standard Stock','基準在庫','标准库存'],
    ['Status','Status','状態','状态'],
    ['Date','Date','日付','日期'],
    ['Qty Used','Qty Used','使用数量','使用数量'],
    ['Replace Time','Replacements','交換回数','更换次数'],
    ['Avg Shot','Avg Shots','平均ショット','平均模次'],
    ['Current Shot','Current Shots','現在のショット','当前模次'],
    ['Min Shot','Min Shots','最小ショット','最小模次'],
    ['Max Shot','Max Shots','最大ショット','最大模次'],
    ['Tất cả năm','All years','すべての年','全部年份'],
    ['Tất cả tháng','All months','すべての月','全部月份'],
    ['Tất cả ngày','All days','すべての日','全部日期'],
    ['Tất cả Series','All series','全シリーズ','全部系列'],
    ['Tất cả khuôn','All molds','全金型','全部模具'],
    ['Tất cả linh kiện','All components','全部品','全部零件'],
    ['Tất cả kết quả','All results','すべての結果','全部结果'],
    ['Tất cả nguồn','All sources','すべての区分','全部来源'],
    ['Tất cả điểm','All points','すべての測定点','全部测量点'],
    ['Chỉ điểm NG','NG points only','NG点のみ','仅NG测量点'],
    ['Lên đầu','Back to top','先頭へ','返回顶部'],
    ['Đóng','Close','閉じる','关闭'],
    ['Đóng (Esc)','Close (Esc)','閉じる（Esc）','关闭（Esc）'],
    ['Hủy','Cancel','キャンセル','取消'],
    ['Hủy bỏ','Cancel','キャンセル','取消'],
    ['Mặc định','Default','標準','默认'],
    ['Tùy chỉnh cột hiển thị','Customize columns','表示列を設定','自定义显示列'],
    ['Thêm / Ẩn cột hiển thị','Show / hide columns','列の表示・非表示','显示／隐藏列'],
    ['Thêm hoặc ẩn cột dữ liệu','Show or hide data columns','データ列の表示・非表示','显示或隐藏数据列'],
    ['Chọn các trường dữ liệu hiển thị trên Dashboard','Choose dashboard columns','表示する項目を選択','选择看板显示字段'],
    ['Tự động lưu vào trình duyệt','Saved in your browser','ブラウザーに自動保存','自动保存在浏览器中'],
    ['Chi Tiết Linh Kiện','Component Details','部品詳細','零件详情'],
    ['Toàn bộ thông tin tồn kho, tuổi thọ dập và lịch sử thay thế','Stock, service life and replacement history','在庫・寿命・交換履歴','库存、冲压寿命和更换历史'],
    ['Mã Khuôn Cũ (Old Die Set)','Old Die Set','旧金型番号','旧模具编号'],
    ['Mã Khuôn Mới (New Die Set)','New Die Set','新金型番号','新模具编号'],
    ['Tồn Kho Hiện Tại (Stock)','Current Stock','現在庫','当前库存'],
    ['Mức Min An Toàn (Min Stock)','Minimum Safety Stock','安全在庫下限','最低安全库存'],
    ['Trạng Thái Cảnh Báo (Status)','Alert Status','警告状態','警报状态'],
    ['Tiến Độ Mòn (%)','Wear Progress (%)','摩耗進行度（%）','磨损进度（%）'],
    ['Số Chu Kỳ Hoàn Chỉnh','Completed Cycles','完了サイクル数','完整周期数'],
    ['Chưa thay thực tế','No replacement yet','交換実績なし','尚未更换'],
    ['Xem chi tiết năm','View yearly details','年別詳細を表示','查看年度详情'],
    ['Avg Shot (Tuổi thọ trung bình)','Average Life (Shots)','平均寿命（ショット）','平均寿命（模次）'],
    ['Current Shot (Số shot hiện tại)','Current Shots','現在のショット数','当前模次'],
    ['Max Shot (Chu kỳ dài nhất)','Longest Cycle (Shots)','最長サイクル','最长周期（模次）'],
    ['Min Shot (Chu kỳ ngắn nhất)','Shortest Cycle (Shots)','最短サイクル','最短周期（模次）'],
    ['Cycle (Các chu kỳ shot thực tế)','Actual Shot Cycles','実績ショットサイクル','实际模次周期'],
    ['Last Replacement (Lần thay cuối)','Last Replacement','最終交換日','上次更换'],
    ['Replace Time (Số lượt thay)','Replacement Count','交換回数','更换次数'],
    ['Qty Used (Tổng linh kiện thay Pcs)','Parts Used (Pcs)','交換部品総数（個）','更换零件总数（件）'],
    ['Top 10 Linh Kiện Thay Nhiều Nhất','Top 10 Replaced Components','交換回数上位10部品','更换最多的前10种零件'],
    ['Chi Tiết Top 10 Linh Kiện Tiêu Hao','Top 10 Consumption Details','消耗部品上位10件の詳細','消耗最多的前10种零件详情'],
    ['(So sánh Số lượt thay & Tổng linh kiện thay Pcs)','(Replacement count vs. parts used)','（交換回数と交換部品数の比較）','（更换次数与更换零件总数对比）'],
    ['Tìm linh kiện, khuôn, tên file hoặc lô…','Search part, mold, file or lot…','部品・金型・ファイル・ロットを検索…','搜索零件、模具、文件或批次…'],
    ['Tìm hồ sơ đo','Search inspection records','測定記録を検索','搜索测量记录'],
    ['Lọc kết quả đo','Filter inspection results','測定結果で絞り込み','筛选测量结果'],
    ['Lọc nguồn linh kiện','Filter component source','部品区分で絞り込み','筛选零件来源'],
    ['Lọc tháng hồ sơ','Filter record month','記録月で絞り込み','筛选记录月份'],
    ['NG — Không đạt','NG — Failed','NG — 不合格','NG — 不合格'],
    ['OK — Đạt','OK — Passed','OK — 合格','OK — 合格'],
    ['Chưa đo','Not measured','未測定','未测量'],
    ['Thiếu dung sai','Missing tolerances','公差未設定','缺少公差'],
    ['Kết quả đo và bản vẽ theo từng hồ sơ.','Inspection results and drawings by record.','記録ごとの測定結果と図面。','按记录查看测量结果和图纸。'],
    ['· Bản vẽ chỉ xem · Tải kết quả Excel','· View-only drawings · Download Excel results','· 図面は閲覧のみ · 測定結果をExcel出力','· 图纸仅供查看 · 下载Excel结果'],
    ['Danh sách hồ sơ kiểm tra','Inspection Records','検査記録一覧','检验记录列表'],
    ['Danh sách hồ sơ đo','Measurement Records','測定記録一覧','测量记录列表'],
    ['Mới nhất → Cũ nhất · Chọn hàng để xem','Newest → Oldest · Select a row to view','新しい順 · 行を選択して表示','从新到旧 · 选择行查看'],
    ['Xem nhanh kích thước điểm đo','Measurement Preview','測定値プレビュー','测量尺寸预览'],
    ['Chọn một linh kiện trên bảng','Select a component above','一覧から部品を選択','请在列表中选择零件'],
    ['Kích thước, dung sai và kết quả từng mẫu sẽ hiển thị tại đây.','Dimensions, tolerances and sample results appear here.','寸法・公差・各サンプルの結果を表示します。','此处显示尺寸、公差和各样本结果。'],
    ['Bản vẽ đối chiếu','Reference Drawing','照合図面','对照图纸'],
    ['Chỉ xem','View only','閲覧のみ','仅查看'],
    ['Chọn hồ sơ trong bảng để xem bản vẽ liên quan.','Select a record to view its drawing.','記録を選択して関連図面を表示します。','选择记录以查看相关图纸。'],
    ['Có bản vẽ','Drawing available','図面あり','有图纸'],
    ['Chưa có bản vẽ','No drawing','図面なし','暂无图纸'],
    ['Không có hồ sơ phù hợp bộ lọc.','No records match the filters.','条件に一致する記録はありません。','没有符合筛选条件的记录。'],
    ['Hồ sơ chưa có giá trị đo.','This record has no measured values.','測定値がありません。','此记录暂无测量值。'],
    ['Không có mẫu phù hợp bộ lọc.','No samples match the filters.','条件に一致するサンプルはありません。','没有符合筛选条件的样本。'],
    ['Đang tải điểm đo…','Loading measurements…','測定値を読み込み中…','正在加载测量值…'],
    ['Đang tải hồ sơ đo…','Loading inspection records…','測定記録を読み込み中…','正在加载测量记录…'],
    ['Đang tải bản vẽ…','Loading drawing…','図面を読み込み中…','正在加载图纸…'],
    ['Thử lại','Retry','再試行','重试'],
    ['Bỏ lọc / sắp xếp','Clear filter / sorting','絞り込み・並べ替えを解除','清除筛选／排序'],
    ['Từ thấp đến cao','Ascending','昇順','升序'],
    ['Từ cao đến thấp','Descending','降順','降序'],
    ['Tất cả giá trị','All values','すべての値','全部值'],
    ['Bỏ lọc cột này','Clear column filter','列の絞り込みを解除','清除此列筛选'],
    ['Vừa khung','Fit','全体表示','适应窗口'],
    ['Vị trí tiếp →','Next location →','次の位置 →','下一位置 →'],
    ['· Đã tìm thấy','· Found','· 検出済み','· 已找到'],
    ['Bấm dòng Point bên trái để tìm bước trên bản vẽ.','Click a Point row to locate it on the drawing.','左の測定点を選択して図面上の位置を表示。','点击左侧测量点行以定位图纸位置。'],
    ['Point này chưa có số bước để tìm trên bản vẽ.','This point has no drawing step number.','図面のステップ番号がありません。','此测量点没有图纸步骤编号。'],
    ['Hồ sơ này chưa có bản vẽ.','This record has no drawing.','この記録に図面はありません。','此记录暂无图纸。'],
    ['Kéo để pan · Cuộn chuột để zoom tại con trỏ · Double-click để phóng to.','Drag to pan · Scroll to zoom at cursor · Double-click to zoom in.','ドラッグで移動 · ホイールで拡大縮小 · ダブルクリックで拡大。','拖动平移 · 滚轮按光标位置缩放 · 双击放大。'],
    ['Bản vẽ ghép theo tên và thư mục. Kiểm tra mã trước khi đối chiếu.','Drawings matched by name and folder. Check the part code before comparing.','名前とフォルダーで図面を照合。部品番号を確認してください。','按文件名和文件夹匹配图纸，请先核对零件编号。'],
    ['LK mới về','New arrivals','新規入荷部品','新到零件'],
    ['Đo tủ LK thay thế','Replacement stock inspection','交換用在庫部品の測定','替换备件测量'],
    ['Hồ sơ','Record','記録','记录'],
    ['File hồ sơ','Record file','記録ファイル','记录文件'],
    ['Chất lượng','Quality','品質','质量'],
    ['↑ Thấp → cao','↑ Ascending','↑ 昇順','↑ 升序'],
    ['↓ Cao → thấp','↓ Descending','↓ 降序','↓ 降序'],
    ['Chỉ hiện giá trị','Show only this value','指定値のみ表示','仅显示指定值'],
    ['Bỏ lọc / sắp xếp cột này','Clear this column filter / sort','この列の絞り込み・並べ替えを解除','清除此列筛选／排序'],
    ['(Trống)','(Empty)','（空欄）','（空）'],
    ['Bản vẽ liên quan','Related drawing','関連図面','相关图纸'],
    ['Đang mở bản vẽ…','Opening drawing…','図面を開いています…','正在打开图纸…'],
    ['Bản xem chưa sẵn sàng. Hãy tải lại trang sau khi đồng bộ.','Preview is not ready. Refresh after syncing.','プレビューの準備ができていません。同期後に再読込してください。','预览尚未就绪，请同步后刷新。'],
    ['Không tải được bản xem. Hãy thử lại hoặc tải lại trang.','Could not load preview. Retry or refresh the page.','プレビューを読込できません。再試行または再読込してください。','无法加载预览，请重试或刷新页面。'],
    ['Linh kiện','Component','部品','零件'],
    ['Khuôn','Mold','金型','模具'],
    ['Tháng','Month','月','月份'],
    ['Ngày đo','Measurement date','測定日','测量日期'],
    ['Nguồn','Source','区分','来源'],
    ['Kết quả','Result','結果','结果'],
    ['Điểm / Mẫu','Points / Samples','測定点／サンプル','测量点／样本'],
    ['Bản vẽ','Drawing','図面','图纸'],
    ['Point','Point','測定点','测量点'],
    ['Nominal','Nominal','呼び寸法','公称尺寸'],
    ['Sample','Sample','サンプル','样本'],
    ['Actual','Actual','実測値','实测值'],
    ['Result','Result','結果','结果'],
    ['Tol (−)','Tol (−)','公差（−）','公差（−）'],
    ['Tol (+)','Tol (+)','公差（+）','公差（+）'],
    ['Toàn màn hình','Fullscreen','全画面表示','全屏'],
    ['Thoát toàn màn hình','Exit fullscreen','全画面を終了','退出全屏'],
    ['Mở riêng ↗','Open separately ↗','別画面で開く ↗','单独打开 ↗'],
    ['OCR bản vẽ','Drawing OCR','図面OCR','图纸OCR'],
    ['Chế độ OCR','OCR mode','OCRモード','OCR模式'],
    ['File chỉ trong trình duyệt · Refresh để xóa','Files stay in this browser · Refresh to clear','ファイルはブラウザー内のみ · 再読込で消去','文件仅存于浏览器 · 刷新即清除'],
    ['Mở tab để khởi động Dimension OCR.','Open this tab to start Dimension OCR.','タブを開いてDimension OCRを開始。','打开此标签页启动Dimension OCR。'],
    ['Đang mở Dimension OCR…','Opening Dimension OCR…','Dimension OCRを起動中…','正在打开Dimension OCR…'],
    ['Dimension OCR · Beta — nhận dạng kích thước bản vẽ','Dimension OCR · Beta — drawing dimension recognition','Dimension OCR · ベータ — 図面寸法認識','Dimension OCR · 测试版 — 图纸尺寸识别'],
    ['DimensionOCR — công cụ nhận dạng kích thước Beta','DimensionOCR — Beta dimension recognition tool','DimensionOCR — 寸法認識ツール（ベータ）','DimensionOCR — 尺寸识别工具（测试版）'],
    ['Mở bản vẽ','Open drawing','図面を開く','打开图纸'],
    ['Xóa bản vẽ','Remove drawing','図面を削除','移除图纸'],
    ['Nhận dạng','Extract numbers','数値を抽出','识别尺寸'],
    ['Tải bản vẽ PNG','Download drawing PNG','図面PNGを保存','下载图纸PNG'],
    ['Hiện vùng OCR','Detection boxes','検出枠を表示','显示识别框'],
    ['Kết quả nhận dạng','Extracted numbers','抽出結果','识别结果'],
    ['Xóa kết quả','Clear results','結果を消去','清除结果'],
    ['Tải kết quả CSV','Download CSV','CSVを保存','下载CSV结果'],
    ['Sao chép','Copy numbers','数値をコピー','复制数值'],
    ['Chọn','Use','選択','选择'],
    ['Giá trị','Value','値','数值'],
    ['Chỉ lưu trong RAM trình duyệt · Refresh sẽ xóa bản vẽ và kết quả.','Stored in browser RAM only · Refresh clears drawings and results.','ブラウザーのRAM内のみ · 再読込で図面と結果を消去。','仅存于浏览器内存 · 刷新会清除图纸和结果。'],
    ['Open a technical drawing','Open a technical drawing','技術図面を開く','打开工程图纸'],
    ['Drop a PDF or image here to get started.','Drop a PDF or image here to get started.','PDFまたは画像をここにドロップ。','将PDF或图片拖放到此处开始。'],
    ['Browse files','Browse files','ファイルを選択','选择文件'],
    ['Your results will appear here','Your results will appear here','認識結果をここに表示','识别结果将显示在此处'],
    ['Extract a drawing to review its numbers','Extract a drawing to review its numbers','図面を認識して数値を確認','识别图纸以查看尺寸数值'],
    ['and tolerances.','and tolerances.','と公差を確認します。','和公差。'],
    ['No drawing loaded','No drawing loaded','図面未読込','未加载图纸'],
    ['Fit width','Fit width','幅に合わせる','适应宽度'],
    ['Fit','Fit','全体表示','适应窗口'],
    ['Pan','Pan','移動','平移'],
    ['Crop OCR','Crop OCR','範囲OCR','区域OCR'],
    ['Settings','Settings','設定','设置'],
    ['Page','Page','ページ','页'],
    ['Parser','Parser','解析','解析'],
    ['Xác Nhận Xóa','Confirm deletion','削除を確認','确认删除'],
    ['Xác Nhận Xóa Lượt Thay Thế','Confirm replacement deletion','交換記録の削除を確認','确认删除更换记录'],
    ['Lý do xóa','Reason for deletion','削除理由','删除原因'],
    ['Nhập lý do xóa...','Enter a reason...','削除理由を入力...','请输入删除原因...'],
    ['Nhập nhầm ngày','Incorrect date','日付の誤入力','日期输入错误'],
    ['Nhập trùng dữ liệu','Duplicate entry','重複データ','重复数据'],
    ['Hủy yêu cầu thay','Cancel replacement request','交換依頼を取消','取消更换申请'],
    ['Vui lòng nhập lý do xóa để lưu vào nhật ký kiểm soát','Enter a reason for the audit log','監査記録用の削除理由を入力してください','请输入删除原因以记录审计日志'],
    ['Tiến Hành Xóa','Delete','削除する','执行删除'],
    ['Xóa Dữ Liệu JSON Lưu Trữ','Clear stored JSON data','保存済みJSONデータを消去','清除已存JSON数据'],
    ['Chọn loại dữ liệu JSON bạn muốn làm sạch','Choose the data to clear','消去するデータを選択','选择要清除的数据类型'],
    ['1. Dữ liệu Shot Number (Sản lượng dập)','1. Shot / production data','1. ショット数・生産数データ','1. 模次／冲压产量数据'],
    ['2. Dữ liệu Lần Thay Thế (Replace Time Log)','2. Replacement history','2. 交換履歴','2. 更换历史记录'],
    ['3. Xóa Cả Hai (Shot Number & Lần Thay Thế)','3. Clear both datasets','3. 両方のデータを消去','3. 清除两类数据'],
    ['Làm trống toàn bộ cả 2 file','Clear both files','両方のファイルを空にする','清空两个文件'],
    ['Đang tải tháng...','Loading month...','月次データを読込中...','正在加载月份...']
  ];
  const dictionary = new Map(entries.map(row => [row[0], row]));
  // Existing tools include English UI; share the same translations without touching their data.
  for (const row of entries) if (!dictionary.has(row[1])) dictionary.set(row[1], row);
  let language = 'vi';
  try { const saved = localStorage.getItem(storageKey); if (languages.includes(saved)) language = saved; } catch { /* Storage is optional. */ }
  const memory = new WeakMap(), documents = new Map();
  const attributes = ['title', 'placeholder', 'aria-label'];
  const ignored = 'script,style,textarea,datalist,svg,canvas,[contenteditable="true"],[data-i18n-ignore]';
  const rules = [
      [/^Năm (\d{4})$/, ['Năm $1','Year $1','$1年','$1年']],
      [/^Trong năm (\d{4})$/, ['Trong năm $1','In $1','$1年','$1年']],
      [/^Tháng (\d{1,2})-(\d{4})$/, ['Tháng $1-$2','Month $1-$2','$2年$1月','$2年$1月']],
      [/^([\d.,]+) lượt$/, ['$1 lượt','$1 times','$1回','$1次']],
      [/^Tồn kho dưới mức an toàn: (.+)$/, ['Tồn kho dưới mức an toàn: $1','Below safety stock: $1','安全在庫不足：$1','低于安全库存：$1']],
      [/^Tồn kho: (\d+) pcs \(Thiếu (\d+) pcs so với định mức (\d+) pcs\)$/, ['Tồn kho: $1 pcs (Thiếu $2 pcs so với định mức $3 pcs)','Stock: $1 pcs ($2 below target of $3 pcs)','在庫：$1個（基準$3個に対し$2個不足）','库存：$1件（低于标准$3件，缺少$2件）']],
      [/^· Series: (.+) · TB: Chưa có chu kỳ$/, ['· Series: $1 · TB: Chưa có chu kỳ','· Series: $1 · Avg: No cycles yet','· シリーズ：$1 · 平均：サイクルなし','· 系列：$1 · 平均：暂无周期']],
      [/^([\d.,]+) hồ sơ · Cập nhật (.+)$/, ['$1 hồ sơ · Cập nhật $2','$1 records · Updated $2','$1件 · 更新 $2','$1条记录 · 更新于 $2']],
      [/^Xem kết quả (.+)$/, ['Xem kết quả $1','View results $1','$1 の結果を表示','查看结果 $1']],
      [/^Mẫu (\d+): bấm để tìm Point (\d+) trên bản vẽ$/, ['Mẫu $1: bấm để tìm Point $2 trên bản vẽ','Sample $1: click to locate Point $2','サンプル$1：クリックして測定点$2を表示','样本$1：点击定位测量点$2']],
      [/^(LK mới về|Đo tủ LK thay thế) · (.+)$/, [null, null, null, null]],
      [/^Tháng (\d{1,2})$/, ['Tháng $1','Month $1','$1月','$1月']],
      [/^Ngày (\d{1,2})$/, ['Ngày $1','Day $1','$1日','$1日']],
      [/^Trang (\d+\s*\/\s*\d+)(.*)$/, ['Trang $1$2','Page $1$2','ページ $1$2','第 $1 页$2']],
      [/^· Trang (\d+)$/, ['· Trang $1','· Page $1','· ページ $1','· 第 $1 页']],
      [/^· Vị trí (\d+\/\d+)$/, ['· Vị trí $1','· Location $1','· 位置 $1','· 位置 $1']],
      [/^Xem thêm (\d+) hồ sơ (\(.+\))$/, ['Xem thêm $1 hồ sơ $2','Show $1 more records $2','さらに$1件表示 $2','再显示$1条记录 $2']],
      [/^(\d+) điểm · (\d+) mẫu ·$/, ['$1 điểm · $2 mẫu ·','$1 points · $2 samples ·','$1点 · $2サンプル ·','$1个测量点 · $2个样本 ·']],
      [/^Đang hiện (\d+) \/ (\d+) mẫu$/, ['Đang hiện $1 / $2 mẫu','Showing $1 / $2 samples','$1 / $2サンプル表示','显示 $1 / $2 个样本']],
      [/^Lọc và sắp xếp (.+)$/, ['Lọc và sắp xếp $1','Filter and sort $1','$1 の絞り込み・並べ替え','筛选和排序 $1']],
      [/^Lọc \/ Sắp xếp (.+)$/, ['Lọc / Sắp xếp $1','Filter / Sort $1','$1 の絞り込み・並べ替え','筛选／排序 $1']],
      [/^Đang tìm Point (\d+)…$/, ['Đang tìm Point $1…','Finding Point $1…','測定点$1を検索中…','正在查找测量点$1…']]
    ];
  function t(text) {
    const value = String(text), trimmed = value.trim();
    const entry = dictionary.get(trimmed);
    if (entry) return value.replace(trimmed, entry[languages.indexOf(language)]);
    for (const [pattern, templates] of rules) {
      if (templates[0] === null && pattern.test(trimmed)) {
        const match = trimmed.match(pattern);
        return value.replace(trimmed, t(match[1]) + ' · ' + match[2]);
      }
      if (pattern.test(trimmed)) return value.replace(trimmed, trimmed.replace(pattern, templates[languages.indexOf(language)]));
    }
    return value;
  }
  function rewrite(node, key, read, write) {
    let state = memory.get(node);
    if (!state) { state = {}; memory.set(node, state); }
    const current = read(), previous = state[key];
    const source = previous && previous.rendered === current ? previous.source : current;
    const rendered = t(source);
    state[key] = { source, rendered };
    if (rendered !== current) write(rendered);
  }
  function translate(root) {
    if (root.nodeType === 3) {
      // Options without explicit values otherwise change their submitted/filter value when translated.
      const option = root.parentElement;
      if (option?.tagName === 'OPTION' && !option.hasAttribute('value')) option.value = option.textContent;
      if (root.parentElement && !root.parentElement.closest(ignored)) rewrite(root, 'text', () => root.nodeValue, value => { root.nodeValue = value; });
      return;
    }
    if (root.nodeType !== 1 || root.closest(ignored)) return;
    for (const attr of attributes) if (root.hasAttribute(attr)) rewrite(root, attr, () => root.getAttribute(attr), value => root.setAttribute(attr, value));
    for (const child of root.childNodes) translate(child);
  }
  function observe(doc) {
    if (!doc.body || documents.has(doc)) return;
    doc.documentElement.lang = language;
    translate(doc.body);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') for (const node of record.addedNodes) translate(node);
        else translate(record.target);
      }
    });
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
    documents.set(doc, observer);
  }
  function setLanguage(next) {
    if (!languages.includes(next)) return;
    language = next;
    try { localStorage.setItem(storageKey, language); } catch { /* Private mode still works for this visit. */ }
    for (const [doc, observer] of documents) {
      if (doc !== document && !doc.defaultView?.frameElement?.isConnected) { observer.disconnect(); documents.delete(doc); continue; }
      doc.documentElement.lang = language; translate(doc.body);
    }
    const select = document.getElementById('languageSelect');
    if (select) select.value = language;
    document.dispatchEvent(new CustomEvent('languagechange', { detail: { language } }));
  }
  function init() {
    observe(document);
    const select = document.getElementById('languageSelect');
    if (select) { select.value = language; select.addEventListener('change', () => setLanguage(select.value)); }
    const frame = document.getElementById('dimensionOcrFrame');
    frame?.addEventListener('load', () => { try { if (frame.contentDocument) observe(frame.contentDocument); } catch { /* Only same-origin tools are translated. */ } });
  }
  window.ComponentLifeLanguage = { t, set: setLanguage, get: () => language };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

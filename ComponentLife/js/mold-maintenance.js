/**
 * ==============================================================================
 * MOLD MAINTENANCE MODULE (ComponetWear Manufacturing Intelligence)
 * - 1 Sheet Theo Ngày / 1 Sheet Theo Tháng
 * - Dấu [+] thêm/ẩn trường (Mặc định ẩn: Trạng thái, Dòng SP, Tiêu chuẩn, Cavity)
 * - Hiển thị Số Shot chạy trong ngày & Tổng Shot luôn
 * - Bộ lọc Ngày / Tháng / Năm
 * - Xuất Excel 2 Sheet đồng nhất với giao diện Web
 * ==============================================================================
 */

window.MoldMaintenance = (function() {
  let rawData = null;
  let currentSubTab = 'molds'; // 'molds' (Ưu tiên show Bảng 1: Toàn bộ khuôn & Mốc 800K / High-Impact 350K~400K) | 'machines' (Bảng 2: Live 44 máy)
  let filterText = '';
  let filterTier = 'all'; // 'all' | 'high_impact' | 'standard'
  let filterStatus = 'all'; // 'all' | 'due' | 'warning' | 'safe' | 'running'
  const initialToday = new Date();
  let selectedYear = String(initialToday.getFullYear());
  let selectedMonth = String(initialToday.getMonth() + 1).padStart(2, '0');
  let selectedDay = String(initialToday.getDate()).padStart(2, '0');
  let initialized = false;

  // Cấu hình Lazy Loading (tối đa 30 dòng / 1 lần tải)
  const PAGE_SIZE = 20;
  let moldVisibleLimit = PAGE_SIZE;
  let machineVisibleLimit = PAGE_SIZE;
  let isLazyLoading = false;

  function loadMoreMolds() {
    if (isLazyLoading) return;
    isLazyLoading = true;
    moldVisibleLimit += PAGE_SIZE;
    renderTable();
    setTimeout(() => { isLazyLoading = false; }, 150);
  }

  function showAllMolds() {
    moldVisibleLimit = 99999;
    renderTable();
  }

  function loadMoreMachines() {
    if (isLazyLoading) return;
    isLazyLoading = true;
    machineVisibleLimit += PAGE_SIZE;
    renderTable();
    setTimeout(() => { isLazyLoading = false; }, 150);
  }

  function showAllMachines() {
    machineVisibleLimit = 99999;
    renderTable();
  }

  function setupLazyObserver() {
    setTimeout(() => {
      const sentinel = document.getElementById('mmLazySentinel');
      if (!sentinel) return;
      if (window._mmLazyObserver) {
        window._mmLazyObserver.disconnect();
        window._mmLazyObserver = null;
      }
      window._mmLazyObserver = new IntersectionObserver((entries) => {
        if (entries[0] && entries[0].isIntersecting && !isLazyLoading) {
          if (currentSubTab === 'molds') {
            const list = getFilteredMolds();
            if (moldVisibleLimit < list.length) {
              loadMoreMolds();
            }
          } else {
            const list = getFilteredRecords();
            if (machineVisibleLimit < list.length) {
              loadMoreMachines();
            }
          }
        }
      }, { rootMargin: '300px' });
      window._mmLazyObserver.observe(sentinel);
    }, 60);
  }

  // Cấu hình cột hiển thị mặc định:
  // Ẩn: machineStatus, series, tier, cavity, cycleTime, prodOutput
  // Hiện: dailyShots, m1, m2, m3, totalLife
  // Cấu hình cột hiển thị mặc định Sheet Machine (đồng nhất cùng 1 kiểu với Sheet Mold):
  // Mặc định hiện: status, totalLife, m1..m5
  // Mặc định ẩn: dailyShots, prodOutput, prodScrap, series, tier, cavity, cycleTime, machineStatus, note
  const STORAGE_KEY = 'mm_machine_col_prefs_v8';
  let colPrefs = {
    status: false,        // Trạng thái: Mặc định HIỆN
    totalLife: true,     // Tổng vòng đời: Mặc định HIỆN
    totalYear: true,     // Tổng số shot trong năm 2026: Mặc định HIỆN
    dailyShots: false,   // Số shot trong ngày: Mặc định ẨN (bật qua dấu +)
    prodOutput: false,   // Sản lượng OK: Mặc định ẨN
    prodScrap: false,    // Phế phẩm NG: Mặc định ẨN
    series: false,       // Dòng sản phẩm: Mặc định ẨN
    tier: false,         // Tiêu chuẩn: Mặc định ẨN
    cavity: false,       // Số cavity: Mặc định ẨN
    cycleTime: false,    // Chu kỳ ép (s): Mặc định ẨN
    machineStatus: false,// Trạng thái máy: Mặc định ẨN
    note: false          // Ghi chú: Mặc định ẨN
  };

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) Object.assign(colPrefs, JSON.parse(saved));
    if (colPrefs.totalYear === undefined) colPrefs.totalYear = true;
  } catch (e) {}

  const MOLD_STORAGE_KEY = 'mm_mold_col_prefs_v10';
  let moldColPrefs = {
    lastYear: true,    // Số shot còn lại năm trước (Last Year carryover): Mặc định HIỆN
    months: true,      // 12 cột tháng (T1..T12): Mặc định HIỆN (như bảng SHOT COUNT MONITOR PER MONTH)
    status: false,     // Trạng thái: Mặc định ẨN
    totalLife: true,   // Tổng vòng đời: Mặc định HIỆN
    totalYear: true,   // Tổng năm: Mặc định HIỆN
    series: false,     // Dòng sản phẩm: Mặc định ẨN (bật qua dấu +)
    tier: false,       // Tiêu chuẩn: Mặc định ẨN
    machine: false,    // Máy đang ép: Mặc định ẨN
    cycle: false,      // Chu kỳ: Mặc định ẨN
    curShots: false,   // Số shot chu kỳ: Mặc định ẨN
    plan: false,       // Mốc plan: Mặc định ẨN
    progress: false,   // Tiến độ: Mặc định ẨN
    note: false        // Ghi chú: Mặc định ẨN
  };

  const MOLD_PDF_KEY = 'mm_milestone_pdfs_v2';
  const MOLD_MILESTONE_NOTES_KEY = 'mm_milestone_notes_v2';

  try {
    const savedM = localStorage.getItem(MOLD_STORAGE_KEY);
    if (savedM) Object.assign(moldColPrefs, JSON.parse(savedM));
    if (moldColPrefs.totalYear === undefined) moldColPrefs.totalYear = true;
    if (moldColPrefs.lastYear === undefined) moldColPrefs.lastYear = true;
  } catch (e) {}

  function saveMoldColPrefs() {
    try {
      localStorage.setItem(MOLD_STORAGE_KEY, JSON.stringify(moldColPrefs));
    } catch (e) {}
  }

  function saveColPrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(colPrefs));
    } catch (e) {}
  }

  // Format số nguyên (tự động làm tròn số nguyên không lấy phần thập phân lẻ, ví dụ 8.8 làm tròn thành 9)
  function formatNum(num) {
    if (num === null || num === undefined || isNaN(num) || num === 0) return '-';
    return Math.round(Number(num)).toLocaleString('vi-VN');
  }

  function formatK(num) {
    if (!num || num === 0) return '-';
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toLocaleString('vi-VN');
  }

  // Khởi tạo
  let autoSyncTimer = null;
  function startAutoSync() {
    if (autoSyncTimer) clearInterval(autoSyncTimer);
    autoSyncTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/tms/data?v=' + Date.now());
        if (!res.ok) return;
        const fresh = await res.json();
        if (fresh && fresh.lastUpdated && (!rawData || fresh.lastUpdated !== rawData.lastUpdated || fresh.totalShotsToday !== rawData.totalShotsToday)) {
          console.log('[AUTO-SYNC] Cập nhật số shot mới từ TMS Smart:', fresh.lastUpdated);
          rawData = fresh;
          window._moldMaintenanceData = rawData;
          renderKPIs();
          renderTable();
        }
      } catch (e) {}
    }, 60000);
  }

  async function refreshData(showIndicator = true) {
    const btn = document.getElementById('btnRefreshTms');
    const txt = document.getElementById('txtRefreshTms');
    if (btn && showIndicator) {
      btn.disabled = true;
      if (txt) txt.textContent = 'Đang đồng bộ...';
    }
    try {
      const res = await fetch('/api/tms/data?v=' + Date.now());
      if (res.ok) {
        rawData = await res.json();
        window._moldMaintenanceData = rawData;
        renderKPIs();
        renderTable();
        if (txt) txt.textContent = 'Đã cập nhật!';
        setTimeout(() => { if (txt) txt.textContent = 'Đồng bộ TMS'; }, 2000);
      }
    } catch (e) {
      if (txt) txt.textContent = 'Lỗi đồng bộ';
      setTimeout(() => { if (txt) txt.textContent = 'Đồng bộ TMS'; }, 2000);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function init() {
    console.log('[MOLD MAINTENANCE] Initializing module...');
    const container = document.getElementById('moldMaintenanceWorkspace');
    if (!container) return;

    // Đóng column picker khi click ngoài
    if (!initialized) document.addEventListener('click', (e) => {
      const menu = document.getElementById('mmColPickerMenu');
      const btn = document.getElementById('btnMmColPicker');
      if (menu && !menu.classList.contains('hidden')) {
        if (!menu.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
          menu.classList.add('hidden');
        }
      }
    });
    initialized = true;

    try {
      let res = await fetch('/api/tms/data?v=' + Date.now());
      if (!res.ok || res.status === 404) {
        res = await fetch('data/mold-maintenance-data.json?v=' + Date.now());
      }
      if (!res.ok) throw new Error('Không thể tải dữ liệu bảo dưỡng khuôn');
      rawData = await res.json();
      window._moldMaintenanceData = rawData;
      populateDateFilters();
      updateToolbarVisibility();
      // Xóa triệt để mọi autofill email do trình duyệt tự ý điền vào ô tìm kiếm
      const clearSearchAutofill = () => {
        const s = document.getElementById('mmSearchInput');
        if (s && (s.value.includes('@') || s.value.includes('.com') || !filterText)) {
          s.value = '';
          filterText = '';
        }
      };
      clearSearchAutofill();
      setTimeout(clearSearchAutofill, 200);
      setTimeout(clearSearchAutofill, 600);
      setTimeout(clearSearchAutofill, 1200);
      renderAll();
      startAutoSync();
    } catch (err) {
      console.warn('[MOLD MAINTENANCE] Load JSON error:', err.message);
      renderError(err.message);
    }
  }

  // Chuyển đổi giữa 2 Bảng: Bảng 1 (Toàn bộ khuôn & Mốc plan) vs Bảng 2 (Live 44 máy)
  function switchTab(tabName) {
    currentSubTab = tabName;
    moldVisibleLimit = PAGE_SIZE;
    machineVisibleLimit = PAGE_SIZE;
    const btnMolds = document.getElementById('btnTabMolds');
    const btnMach = document.getElementById('btnTabMachines');
    if (btnMolds) btnMolds.classList.toggle('active', tabName === 'molds');
    if (btnMach) btnMach.classList.toggle('active', tabName === 'machines');
    const s = document.getElementById('mmSearchInput');
    if (s && (s.value.includes('@') || s.value.includes('.com'))) {
      s.value = '';
      filterText = '';
    }
    updateToolbarVisibility();
    renderTable();
  }

  function updateToolbarVisibility() {
    const statusWrap = document.getElementById('mmStatusFilterWrap');
    const dateWrap = document.getElementById('mmDateFiltersWrap');

    // Luôn ẩn bộ lọc 'Tất cả trạng thái mốc' và luôn hiện bộ lọc Năm, Tháng, Ngày cho cả Sheet Mold và Sheet Machine
    if (statusWrap) statusWrap.style.display = 'none';
    if (dateWrap) dateWrap.style.display = 'flex';
  }

  function onStatusFilterChange() {
    const sel = document.getElementById('mmStatusSelect');
    filterStatus = sel ? sel.value : 'all';
    moldVisibleLimit = PAGE_SIZE;
    machineVisibleLimit = PAGE_SIZE;
    renderTable();
  }

  // Cấu hình Timer tự động cào TMS mặc định 15 phút đồng bộ cùng Cloud
  const TIMER_STORAGE_KEY = 'mm_timer_mins_v2';
  let timerMinutes = parseInt(localStorage.getItem(TIMER_STORAGE_KEY)) || 15;
  if (timerMinutes < 15) timerMinutes = 15; // Mức an toàn nhất (tránh spam API)

  function setupAutoSyncTimer() {
    if (window._moldMaintenanceInterval) {
      clearInterval(window._moldMaintenanceInterval);
      window._moldMaintenanceInterval = null;
    }
  }

  function onTimerChange(val) {
    let mins = parseInt(val) || 30;
    if (mins < 15) mins = 15; // Minimum ở mức an toàn nhất
    timerMinutes = mins;
    try {
      localStorage.setItem(TIMER_STORAGE_KEY, String(mins));
    } catch (e) {}
    setupAutoSyncTimer();
  }

  function renderError(msg) {
    const tableDiv = document.getElementById('mmTableContainer');
    if (tableDiv) {
      tableDiv.innerHTML = `<div style="padding:40px; text-align:center; color:#e03131;">
        <h3>⚠️ Đang tải hoặc chưa nạp được dữ liệu</h3>
        <p>${msg}</p>
        <button class="mm-btn mm-btn-primary" onclick="MoldMaintenance.init()">Thử Lại</button>
      </div>`;
    }
  }

  // Điền dữ liệu vào bộ lọc ngày tháng năm
  function populateDateFilters() {
    const yearSel = document.getElementById('mmYearSelect');
    const monthSel = document.getElementById('mmMonthSelect');
    const today = new Date();
    selectedYear = String(today.getFullYear());
    selectedMonth = String(today.getMonth() + 1).padStart(2, '0');
    selectedDay = String(today.getDate()).padStart(2, '0');
    if (yearSel) yearSel.innerHTML = [today.getFullYear(), today.getFullYear() - 1].map(y => `<option value="${y}">Năm ${y}</option>`).join('');
    if (monthSel) monthSel.innerHTML = Array.from({ length: 12 }, (_, idx) => {
      const month = String(idx + 1).padStart(2, '0');
      return `<option value="${month}">Tháng ${month}</option>`;
    }).join('');
    if (yearSel) yearSel.value = selectedYear;
    if (monthSel) monthSel.value = selectedMonth;
    updateDaySelectOptions();
  }

  function updateDaySelectOptions() {
    const daySel = document.getElementById('mmDaySelect');
    if (!daySel) return;
    const today = new Date();
    const curYear = today.getFullYear();
    const curMonth = today.getMonth() + 1;
    const curDay = today.getDate();
    const selYearNum = parseInt(selectedYear, 10);
    const selMonthNum = parseInt(selectedMonth, 10);

    const dayCount = new Date(selYearNum, selMonthNum, 0).getDate();
    let opts = '<option value="all">Tất cả ngày</option>';
    for (let d = 1; d <= dayCount; d++) {
      const dayStr = String(d).padStart(2, '0');
      const isToday = selYearNum === curYear && selMonthNum === curMonth && d === curDay;
      const isYesterday = selYearNum === curYear && selMonthNum === curMonth && d === (curDay - 1);
      const isFuture = (selYearNum > curYear) ||
                       (selYearNum === curYear && selMonthNum > curMonth) ||
                       (selYearNum === curYear && selMonthNum === curMonth && d > curDay);

      let label = `Ngày ${dayStr}`;
      if (isToday) label += ' (Hôm nay)';
      else if (isYesterday) label += ' (Hôm qua)';
      else if (isFuture) label += ' (Chưa chạy)';

      opts += `<option value="${dayStr}" ${isFuture ? 'style="color:#94a3b8;"' : ''}>${label}</option>`;
    }
    daySel.innerHTML = opts;
    daySel.value = selectedDay;
  }

  // Cào & Đồng bộ dữ liệu TMS An Toàn (Mô phỏng thao tác người thật, chống Trend Micro lock)
  let lastManualSyncTime = 0;
  const MANUAL_COOLDOWN_MS = 60000; // 60s cooldown an toàn giữa các lần bấm tay

  function updateSyncProgress(percent, title, detail) {
    const card = document.getElementById('mmSyncProgressCard');
    const bar = document.getElementById('mmSyncProgressBar');
    const pct = document.getElementById('mmSyncPercent');
    const titleEl = document.getElementById('mmSyncStepTitle');
    const detailEl = document.getElementById('mmSyncSubDetail');

    if (card) card.style.display = 'block';
    if (bar) bar.style.width = percent + '%';
    if (pct) pct.textContent = percent + '%';
    if (titleEl) titleEl.textContent = title;
    if (detailEl && detail) detailEl.textContent = detail;
  }

  function hideSyncProgress(delayMs = 2500) {
    setTimeout(() => {
      const card = document.getElementById('mmSyncProgressCard');
      if (card) {
        card.style.opacity = '0';
        card.style.transition = 'opacity 0.5s ease';
        setTimeout(() => {
          card.style.display = 'none';
          card.style.opacity = '1';
        }, 500);
      }
    }, delayMs);
  }

  async function syncTms(isManual = false) {
    const btn = document.getElementById('btnRefreshTms') || document.getElementById('btnSyncTms');
    const icon = document.getElementById('refreshTmsIcon') || document.getElementById('syncTmsIcon');
    const textEl = document.getElementById('refreshTmsText');
    const statusText = document.getElementById('mmSyncStatusText');

    const now = Date.now();
    if (isManual && (now - lastManualSyncTime < MANUAL_COOLDOWN_MS)) {
      const waitSec = Math.ceil((MANUAL_COOLDOWN_MS - (now - lastManualSyncTime)) / 1000);
      if (statusText) {
        statusText.textContent = `⏳ Đang trong thời gian giãn cách an toàn Trend Micro. Vui lòng thử lại sau ${waitSec}s.`;
        statusText.style.color = '#ea580c';
      }
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.classList.add('loading');
      if (icon) icon.textContent = '⏳';
      if (textEl) textEl.textContent = 'Đang quét...';
    }

    updateSyncProgress(15, 'Đang xác thực bảo mật TMS Smart...', 'Mô phỏng phiên làm việc trình duyệt an toàn (Anti-WAF)');

    try {
      if (isManual) lastManualSyncTime = Date.now();

      // Bước 1: Gọi Cloud sync có bảo vệ Trend Micro
      const auth = window.ComponentAuth;
      updateSyncProgress(40, 'Đang quét danh sách 44 máy ép & ca sản xuất...', 'Giãn cách batch request tránh quá tải máy chủ TMS');

      const syncRes = await fetch('/api/tms/sync', {
        method: 'POST',
        headers: { 'X-CSRF-Token': auth?.csrf || '' },
        cache: 'no-store'
      });
      if (!syncRes.ok) throw new Error(`Đồng bộ TMS thất bại (HTTP ${syncRes.status})`);
      const syncResult = await syncRes.json();
      if (!syncResult.success) throw new Error(syncResult.note || 'TMS đang bảo trì hoặc mạng bận, giữ dữ liệu cũ');

      updateSyncProgress(75, 'Đang đối soát sản lượng hôm nay & hôm qua...', 'Tính toán số shot, cavity và mốc kiểm soát');

      let res = await fetch('/api/tms/data?v=' + Date.now());
      if (!res.ok || res.status === 404) {
        res = await fetch('data/mold-maintenance-data.json?v=' + Date.now());
      }
      if (res.ok) {
        rawData = await res.json();
        window._moldMaintenanceData = rawData;
        renderAll();
        if (typeof renderOverviewTab === 'function') {
          try { renderOverviewTab(); } catch (e) {}
        }
      }

      updateSyncProgress(100, '✅ Hoàn tất đồng bộ dữ liệu TMS an toàn!', 'Dữ liệu 44 máy và toàn bộ khuôn đã được cập nhật mới nhất.');
      hideSyncProgress(3000);

      const nowStr = new Date().toLocaleTimeString('vi-VN');
      const timerSel = document.getElementById('mmTimerSelect');
      if (timerSel) {
        timerSel.title = `Lần đồng bộ gần nhất: ${nowStr} (Tự động mỗi ${timerMinutes} phút)`;
      }
      if (statusText) {
        statusText.textContent = `✅ Đã đồng bộ an toàn TMS lúc ${nowStr} (44 máy ép)`;
        statusText.style.color = '#16a34a';
      }
    } catch (err) {
      console.error('[TMS SYNC ERROR]', err);
      updateSyncProgress(100, '⚠️ Đã dừng quét: ' + err.message, 'Hệ thống tự động bảo toàn bản dữ liệu gần nhất để tránh gián đoạn.');
      hideSyncProgress(4000);
      if (statusText) {
        statusText.textContent = `⚠️ Đang hiển thị bản dữ liệu gần nhất: ${err.message}`;
        statusText.style.color = '#ea580c';
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('loading');
        if (icon) icon.textContent = '🔄';
        if (textEl) textEl.textContent = 'Refresh TMS';
      }
    }
  }

  // Render toàn bộ
  function renderAll() {
    if (!rawData) return;
    renderKPIs();
    renderTable();
  }

  // Render KPI
  function renderKPIs() {
    const kpiFleet = document.getElementById('mmKpiFleet');
    const kpiShots = document.getElementById('mmKpiShots');
    const kpiOutput = document.getElementById('mmKpiOutput');
    const kpiProgress = document.getElementById('mmKpiProgress');

    const totalProdYesterday = (rawData.records || []).reduce((a, b) => a + (b.yesterdayProdOutputPcs || 0), 0);
    const totalShotsYesterday = (rawData.records || []).reduce((a, b) => a + (b.yesterdayShots || 0), 0);
    const totalProdToday = (rawData.records || []).reduce((a, b) => a + (b.todayProdOutputPcs || 0), 0);
    const totalShotsToday = (rawData.records || []).reduce((a, b) => a + (b.todayShots || 0), 0);

    if (kpiFleet) {
      kpiFleet.innerHTML = `
        <div class="mm-kpi-icon blue">🏭</div>
        <div class="mm-kpi-details">
          <span class="mm-kpi-label">Máy Đang Chạy</span>
          <div class="mm-kpi-val">${rawData.runningMachines} / ${rawData.totalMachines} máy</div>
          <span class="mm-kpi-sub">TMS Smart Real-time</span>
        </div>
      `;
    }

    if (kpiShots) {
      kpiShots.innerHTML = `
        <div class="mm-kpi-icon green">⚡</div>
        <div class="mm-kpi-details">
          <span class="mm-kpi-label">Hôm Qua (${new Date(Date.now() - 86400000).toLocaleDateString('vi-VN')}): Số Shot</span>
          <div class="mm-kpi-val" style="color:#15803d;">${formatNum(totalShotsYesterday)} shots</div>
          <span class="mm-kpi-sub">Sản lượng: ${formatNum(totalProdYesterday)} pcs</span>
        </div>
      `;
    }

    if (kpiOutput) {
      kpiOutput.innerHTML = `
        <div class="mm-kpi-icon purple">📦</div>
        <div class="mm-kpi-details">
          <span class="mm-kpi-label">Hôm Nay (${new Date().toLocaleDateString('vi-VN')}): Số Shot</span>
          <div class="mm-kpi-val" style="color:#7c3aed;">${formatNum(totalShotsToday)} shots</div>
          <span class="mm-kpi-sub">Sản lượng: ${formatNum(totalProdToday)} pcs</span>
        </div>
      `;
    }

    if (kpiProgress) {
      const urgentCount = rawData.urgentCount || 0;
      const warningCount = rawData.warningCount || 0;
      const safeCount = rawData.safeCount || 0;
      const kpiColor = urgentCount > 0 ? '#dc2626' : (warningCount > 0 ? '#d97706' : '#16a34a');
      const iconClass = urgentCount > 0 ? 'red' : (warningCount > 0 ? 'amber' : 'green');
      const displayVal = urgentCount > 0 ? `${urgentCount} khẩn cấp` : (warningCount > 0 ? `${warningCount} cảnh báo` : 'Tất cả an toàn');
      kpiProgress.innerHTML = `
        <div class="mm-kpi-icon ${iconClass}">🛠️</div>
        <div class="mm-kpi-details">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="mm-kpi-label">Khuôn Cần Bảo Dưỡng</span>
            <span style="cursor:pointer; font-size:11px; color:#64748b; background:#f1f5f9; padding:1px 6px; border-radius:4px;" title="Quy chuẩn SOP: Chuẩn 800K | High-Impact 350K~400K | Đại tu 3M, 4.5M, 5M" onclick="alert('QUY CHUẨN MỐC BẢO DƯỠNG (SOP):\n• Khuôn Tiêu Chuẩn: Bảo dưỡng mỗi 800K shot\n• Khuôn High-Impact: Đo dự phòng 350K~400K shot\n• Mốc Đại Tu: 3.000K shot\n• Giới Hạn Vòng Đời: 4.5M ~ 5M shot')">ℹ️ SOP</span>
          </div>
          <div class="mm-kpi-val" style="color:${kpiColor};">${displayVal}</div>
          <span class="mm-kpi-sub">${urgentCount} chạm mốc • ${warningCount} cảnh báo sớm (${safeCount} an toàn)</span>
        </div>
      `;
    }
  }

  // Toggle Column Picker Popover
  function toggleColPicker(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('mmColPickerMenu');
    if (!menu) return;
    const isHidden = menu.classList.contains('hidden');
    if (isHidden) {
      renderColPickerCheckboxes();
      menu.classList.remove('hidden');
    } else {
      menu.classList.add('hidden');
    }
  }

  function renderColPickerCheckboxes() {
    const listEl = document.getElementById('mmColPickerList');
    if (!listEl) return;
    
    if (currentSubTab === 'molds') {
      const moldFields = [
        { key: 'lastYear', label: 'Số shot còn lại năm trước (Last Year)', defaultOff: false },
        { key: 'months', label: '12 Tháng trong năm (T1 -> T12)', defaultOff: false },
        { key: 'status', label: 'Trạng thái (An toàn / Cần bảo dưỡng)', defaultOff: false },
        { key: 'totalYear', label: 'Tổng Năm', defaultOff: false },
        { key: 'totalLife', label: 'Tổng số Shot (Tổng vòng đời)', defaultOff: false },
        { key: 'curShots', label: 'Số Shot chu kỳ hiện tại', defaultOff: true },
        { key: 'series', label: 'Dòng sản phẩm (Series)', defaultOff: true },
        { key: 'machine', label: 'Máy đang ép (hoặc Trong kho)', defaultOff: true },
        { key: 'cycle', label: 'Chu kỳ hiện tại (Mốc 1..5)', defaultOff: true },
        { key: 'tier', label: 'Tiêu chuẩn (High-Impact / Tiêu chuẩn)', defaultOff: true },
        { key: 'plan', label: 'Mốc Plan (SOP)', defaultOff: true },
        { key: 'progress', label: 'Tiến độ chạm mốc & cảnh báo', defaultOff: true },
        { key: 'note', label: 'Note (Ghi chú)', defaultOff: true }
      ];

      listEl.innerHTML = moldFields.map(f => {
        const isChecked = moldColPrefs[f.key] !== false;
        return `
          <label class="mm-cpm-item" style="display:flex; align-items:center; gap:8px; padding:6px 4px; font-size:12.5px; cursor:pointer;">
            <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="MoldMaintenance.onMoldColPrefChange('${f.key}', this.checked)" style="accent-color:#0284c7; cursor:pointer; width:15px; height:15px;">
            <span style="font-weight:${isChecked ? '700' : '500'}; color:${isChecked ? '#0f172a' : '#64748b'};">${f.label}</span>
          </label>
        `;
      }).join('');
    } else {
      const fields = [
        { key: 'status', label: 'Trạng thái (An toàn / Cần bảo dưỡng)', defaultOff: false },
        { key: 'totalYear', label: 'Tổng Năm', defaultOff: false },
        { key: 'totalLife', label: 'Tổng số Shot (Tổng vòng đời)', defaultOff: false },
        { key: 'dailyShots', label: 'Số Shot chạy trong ngày', defaultOff: true },
        { key: 'prodOutput', label: 'Sản lượng OK trong ngày (Pcs)', defaultOff: true },
        { key: 'prodScrap', label: 'Phế phẩm NG trong ngày (Pcs)', defaultOff: true },
        { key: 'series', label: 'Dòng sản phẩm (Series)', defaultOff: true },
        { key: 'tier', label: 'Tiêu chuẩn (High-Impact / Tiêu chuẩn)', defaultOff: true },
        { key: 'cavity', label: 'Số Cavity', defaultOff: true },
        { key: 'cycleTime', label: 'Chu kỳ ép (CT s)', defaultOff: true },
        { key: 'machineStatus', label: 'Trạng thái máy (Running / Stop)', defaultOff: true },
        { key: 'note', label: 'Note (Ghi chú)', defaultOff: true }
      ];

      listEl.innerHTML = fields.map(f => {
        const isChecked = colPrefs[f.key] !== false;
        return `
          <label class="mm-cpm-item" style="display:flex; align-items:center; gap:8px; padding:6px 4px; font-size:12.5px; cursor:pointer;">
            <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="MoldMaintenance.onColPrefChange('${f.key}', this.checked)" style="accent-color:#0284c7; cursor:pointer; width:15px; height:15px;">
            <span style="font-weight:${isChecked ? '700' : '500'}; color:${isChecked ? '#0f172a' : '#64748b'};">${f.label}</span>
          </label>
        `;
      }).join('');
    }
  }

  function onMoldColPrefChange(key, val) {
    moldColPrefs[key] = val;
    saveMoldColPrefs();
    renderTable();
  }

  function onColPrefChange(key, val) {
    colPrefs[key] = val;
    saveColPrefs();
    renderTable();
  }

  function resetDefaultCols() {
    if (currentSubTab === 'molds') {
      moldColPrefs = {
        status: true,
        totalLife: true,
        curShots: false,
        series: false,
        tier: false,
        machine: false,
        cycle: false,
        plan: false,
        progress: false,
        note: false
      };
      saveMoldColPrefs();
    } else {
      colPrefs = {
        status: true,
        totalLife: true,
        dailyShots: false,
        prodOutput: false,
        prodScrap: false,
        series: false,
        tier: false,
        cavity: false,
        cycleTime: false,
        machineStatus: false,
        note: false
      };
      saveColPrefs();
    }
    renderColPickerCheckboxes();
    renderTable();
  }

  // Lọc dữ liệu theo text, tiêu chuẩn (High-Impact vs Thường) và trạng thái mốc
  function getFilteredRecords() {
    if (!rawData || !rawData.records) return [];
    const list = rawData.records.filter(r => {
      const q = filterText.toLowerCase();
      const masterMold = (rawData.excelMasterMolds || []).find(m => 
        (m.mold || '').toUpperCase() === (r.moldNo || '').toUpperCase() ||
        (m.oldMold && m.oldMold.toUpperCase() === (r.moldNo || '').toUpperCase())
      );
      const oldCode = (masterMold?.oldMold || '').toLowerCase();
      const matchText = !q || 
        (r.machineNo && r.machineNo.toLowerCase().includes(q)) ||
        (r.moldNo && r.moldNo.toLowerCase().includes(q)) ||
        (oldCode && oldCode.includes(q)) ||
        (r.productRunning && r.productRunning.toLowerCase().includes(q)) ||
        (r.series && r.series.toLowerCase().includes(q));

      let matchTier = true;
      if (filterTier === 'high_impact') {
        matchTier = r.isHighImpact === true || (r.tier && r.tier.toLowerCase().includes('high'));
      } else if (filterTier === 'standard') {
        matchTier = !r.isHighImpact && (!r.tier || !r.tier.toLowerCase().includes('high'));
      }

      let matchStatus = true;
      if (filterStatus && filterStatus !== 'all') {
        const isHigh = r.isHighImpact || masterMold?.is_high_impact || false;
        const totalLife = Math.max(Number(r.totalLifeShots) || 0, Number(masterMold?.total_life) || 0);
        const curShots = Number(r.currentCycleShots || r.m1_800k || 0);
        const evalData = computeMoldPlanAndStatus(isHigh, curShots, totalLife);
        if (filterStatus === 'due') matchStatus = evalData.status === 'due';
        else if (filterStatus === 'warning') matchStatus = evalData.status === 'warning';
        else if (filterStatus === 'safe') matchStatus = evalData.status === 'safe';
        else if (filterStatus === 'running') matchStatus = r.machineStatus === 'Running';
        else if (filterStatus === 'life_alert') matchStatus = Boolean(evalData.lifeAlert);
      }

      return matchText && matchTier && matchStatus;
    });

    // Luôn hiển thị báo đỏ từ trên xuống (Đỏ -> Vàng -> An toàn)
    list.sort((a, b) => {
      const getPriority = (r) => {
        const masterMold = (rawData.excelMasterMolds || []).find(m => 
          (m.mold || '').toUpperCase() === (r.moldNo || '').toUpperCase() ||
          (m.oldMold && m.oldMold.toUpperCase() === (r.moldNo || '').toUpperCase())
        );
        const isHigh = r.isHighImpact || masterMold?.is_high_impact || false;
        const totalLife = Math.max(Number(r.totalLifeShots) || 0, Number(masterMold?.total_life) || 0);
        const curShots = Number(r.currentCycleShots || r.m1_800k || 0);
        const evalData = computeMoldPlanAndStatus(isHigh, curShots, totalLife);
        if (evalData.status === 'due') return 1;
        if (evalData.status === 'warning') return 2;
        return 3;
      };
      const pA = getPriority(a);
      const pB = getPriority(b);
      if (pA !== pB) return pA - pB;
      return (Number(b.currentCycleShots || b.m1_800k || 0)) - (Number(a.currentCycleShots || a.m1_800k || 0));
    });

    return list;
  }

  function onTierFilterChange() {
    const sel = document.getElementById('mmTierSelect');
    filterTier = sel ? sel.value : 'all';
    moldVisibleLimit = PAGE_SIZE;
    machineVisibleLimit = PAGE_SIZE;
    renderTable();
  }

  // Tính toán mốc kế hoạch và trạng thái theo SOP chuẩn (Tiêu chuẩn 800K, High-Impact 350K~400K, Vòng đời 3M/4.5M/5M)
  function computeMoldPlanAndStatus(isHigh, curShots, totalLife) {
    let plan = 800000;
    let planDisplay = '800.000';
    let percent = 0;
    let remaining = 0;
    let status = 'safe';
    let statusText = 'An Toàn';
    let statusClass = 'running';

    if (isHigh) {
      // Hàng High-Impact (Khuôn Cấp Độ Cao):
      // Bắt buộc bảo dưỡng dự phòng ở mốc 350K ~ 400K shot trước khi đến mốc 800K
      plan = 400000;
      planDisplay = '350K ~ 400K';
      percent = Math.min(100, Math.round((curShots / 400000) * 100));
      remaining = 350000 - curShots;

      if (curShots >= 400000) {
        status = 'due';
        statusText = 'BẮT BUỘC BD DỰ PHÒNG (≥400K)';
        statusClass = 'danger';
      } else if (curShots >= 350000) {
        status = 'warning';
        statusText = 'ĐẾN HẠN ĐO DỰ PHÒNG';
        statusClass = 'warning';
      } else if (curShots >= 315000) { // 90% của 350K
        status = 'warning';
        statusText = 'SẮP ĐẾN HẠN DỰ PHÒNG';
        statusClass = 'warning';
      }
    } else {
      // Tiêu chuẩn thường:
      // Mốc 800.000 shot kết hợp đo lại kích thước linh kiện ruột khuôn & bảo dưỡng
      plan = 800000;
      planDisplay = '800.000';
      percent = Math.min(100, Math.round((curShots / 800000) * 100));
      remaining = 800000 - curShots;

      if (curShots >= 800000) {
        status = 'due';
        statusText = 'CẦN BẢO DƯỠNG & ĐO (≥800K)';
        statusClass = 'danger';
      } else if (curShots >= 720000) { // 90% của 800K
        status = 'warning';
        statusText = 'SẮP CHẠM MỐC (≥90%)';
        statusClass = 'warning';
      }
    }

    // Cảnh báo Vòng Đời Lớn theo chuẩn SOP (3M, 4.5M, 5M)
    let lifeAlert = '';
    let lifeAlertText = '';
    let lifeBadgeHtml = ''; // Bỏ dòng chữ/badge cảnh báo bên dưới tổng vòng đời theo yêu cầu
    if (totalLife >= 5000000) {
      lifeAlert = 'over_5m';
      lifeAlertText = 'Vòng đời >5M: Hết hạn sử dụng';
    } else if (totalLife >= 4500000) {
      lifeAlert = 'hq_report';
      lifeAlertText = 'Đạt ≥4.5M: Báo cáo JP HQ để xử lý / thay khuôn';
    } else if (totalLife >= 3000000) {
      lifeAlert = 'eval_3m';
      lifeAlertText = 'Đủ 3M: Bảo dưỡng tổng thể & đánh giá lại toàn bộ bản vẽ';
    }

    return {
      plan,
      planDisplay,
      percent,
      remaining,
      status,
      statusText,
      statusClass,
      lifeAlert,
      lifeAlertText,
      lifeBadgeHtml
    };
  }


  // Local storage cache for mold custom notes & closed milestones
  const MOLD_NOTES_KEY = 'mm_mold_custom_notes_v1';
  const MOLD_CLOSED_KEY = 'mm_mold_closed_milestones_v1';

  function getMoldNotesMap() {
    try {
      return JSON.parse(localStorage.getItem(MOLD_NOTES_KEY) || '{}');
    } catch (e) { return {}; }
  }

  function getClosedMilestonesMap() {
    try {
      return JSON.parse(localStorage.getItem(MOLD_CLOSED_KEY) || '{}');
    } catch (e) { return {}; }
  }

  async function updateMoldNote(moldNo, newNote) {
    const moldCode = String(moldNo).trim().toUpperCase();
    const map = getMoldNotesMap();
    map[moldCode] = newNote.trim();
    try { localStorage.setItem(MOLD_NOTES_KEY, JSON.stringify(map)); } catch (e) {}

    // Update in memory
    if (rawData && rawData.excelMasterMolds) {
      const target = rawData.excelMasterMolds.find(m => (m.mold || '').toUpperCase() === moldCode);
      if (target) target.note = newNote.trim();
    }

    // Sync to Cloudflare D1
    try {
      if (typeof ComponentAuth !== 'undefined' && ComponentAuth.canAddMold()) {
        const response = await fetch('/api/molds/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.ComponentAuth?.csrf || '' },
          body: JSON.stringify({ mold: moldCode, note: newNote.trim() })
        });
        if (!response.ok) throw new Error(`Không lưu được ghi chú (HTTP ${response.status})`);
      }
    } catch (err) {
      const status = document.getElementById('mmSyncStatusText');
      if (status) { status.textContent = `⚠️ Ghi chú đang lưu cục bộ; đồng bộ máy chủ lỗi: ${err.message}`; status.style.color = '#ea580c'; }
    }
  }

  // Quản lý file PDF đính kèm theo mốc bảo dưỡng

  const MOLD_DETAILS_KEY = 'mm_milestone_details_v2';

  function getMilestoneDetailsMap() {
    try {
      return JSON.parse(localStorage.getItem(MOLD_DETAILS_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function getMilestoneDetail(moldNo, num) {
    const code = String(moldNo || '').trim().toUpperCase();
    const map = getMilestoneDetailsMap();
    if (map[code] && map[code][num]) return map[code][num];
    if (rawData && rawData.excelMasterMolds) {
      const item = rawData.excelMasterMolds.find(m => (m.mold || '').toUpperCase() === code);
      if (item && item.milestoneDetails && item.milestoneDetails[num]) return item.milestoneDetails[num];
    }
    const pdf = getMilestonePdf(moldNo, num);
    if (pdf && pdf.date) {
      return { date: pdf.date, tech: 'KTV Bảo Dưỡng', pdf };
    }
    return null;
  }

  function saveMilestoneDetail(moldNo, num, detailObj) {
    const code = String(moldNo || '').trim().toUpperCase();
    const map = getMilestoneDetailsMap();
    if (!map[code]) map[code] = {};
    if (detailObj) {
      map[code][num] = detailObj;
    } else {
      delete map[code][num];
    }
    try {
      localStorage.setItem(MOLD_DETAILS_KEY, JSON.stringify(map));
    } catch (e) {}

    if (rawData && rawData.excelMasterMolds) {
      const item = rawData.excelMasterMolds.find(m => (m.mold || '').toUpperCase() === code);
      if (item) {
        if (!item.milestoneDetails) item.milestoneDetails = {};
        if (detailObj) item.milestoneDetails[num] = detailObj;
        else delete item.milestoneDetails[num];
      }
    }
  }

  // Format tên mold: ưu tiên tên khuôn mới (VD: H9637S15), giữ mã cũ & series trong tooltip
  function formatMoldTripletHtml(newMold, oldMold, series) {
    const n = String(newMold || '-').trim();
    const o = (oldMold && String(oldMold).trim() !== '-' && String(oldMold).trim() !== n) ? String(oldMold).trim() : (String(oldMold || '-').trim());
    const s = String(series || '-').trim();
    const primary = (n !== '-' && n !== 'null' && n !== 'undefined') ? n : (o !== '-' ? o : (s !== '-' ? s : '-'));
    return `
      <div style="font-weight:700; color:#0f172a; font-size:15px; font-family:monospace; letter-spacing:0.2px;" title="${o !== '-' ? 'Mã cũ: ' + o : ''}${s !== '-' ? ' | ' + s : ''}">
        ${primary}
      </div>
    `;
  }

  // Legend màu cảnh báo mốc 1 - mốc 8 & tổng năm
  function getMilestoneLegendHtml() {
    return `
      <div class="mm-milestone-legend" style="display:flex; align-items:center; flex-wrap:wrap; gap:10px; padding:7px 14px; background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:12px; font-size:12.5px; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
        <span style="font-weight:800; color:#0f172a; display:inline-flex; align-items:center; gap:5px;">
          <span>🎯</span> Quy Ước Mốc:
        </span>
        <span style="display:inline-flex; align-items:center; gap:5px; color:#15803d; font-weight:700; background:#f0fdf4; padding:3px 9px; border-radius:5px; border:1px solid #bbf7d0;">
          <span style="width:9px; height:9px; border-radius:50%; background:#22c55e; display:inline-block;"></span>
          Mốc 1 - 5: Trong năm (~800K/lần)
        </span>
        <span style="display:inline-flex; align-items:center; gap:5px; color:#0f172a; font-weight:700; background:#f1f5f9; padding:3px 9px; border-radius:5px; border:1px solid #cbd5e1;" title="Năm 2026 = Mốc 1 + Mốc 2 + Mốc 3 + Mốc 4 + Mốc 5">
          <span>📊</span> Tổng Năm: = Mốc 1 + ... + Mốc 5
        </span>
        <span style="display:inline-flex; align-items:center; gap:6px; color:#0369a1; font-weight:700; background:#f0f9ff; padding:3px 9px; border-radius:5px; border:1px solid #bae6fd;" title="Các mốc SOP đánh giá tuổi thọ dựa trên Tổng Vòng Đời qua các năm">
          <span>⭐</span> Mốc Vòng Đời: Mốc 6 (3M) • Mốc 7 (4.5M) • Mốc 8 (5M)
        </span>
      </div>
    `;
  }

  // Render ô Mốc Vòng Đời lớn (Mốc 6: 3M, Mốc 7: 4.5M, Mốc 8: 5M)
  // Các mốc này được kích hoạt và đánh giá dựa trên TỔNG VÒNG ĐỜI (tất cả các năm cộng lại), chỉ cần nút chốt gọn gàng
  function renderLifeMilestoneCell(moldKey, num, targetLimit, totalLife, isDone) {
    const detail = getMilestoneDetail(moldKey, num);
    const pdfData = detail?.pdf || getMilestonePdf(moldKey, num);
    const dateDisplay = detail?.date ? (detail.date.includes('-') ? detail.date.split('-').reverse().join('/') : detail.date) : '';
    const hasReached = (Number(totalLife) || 0) >= targetLimit;

    let cellBg = '#f8fafc';
    let btnBorder = '1px solid #cbd5e1';
    let btnBg = '#ffffff';
    let btnColor = '#64748b';

    const labelStr = num === 6 ? '3M' : (num === 7 ? '4.5M' : '5M');

    if (isDone) {
      cellBg = '#f0fdf4';
      btnBorder = '1px solid #86efac';
      btnBg = '#dcfce7';
      btnColor = '#15803d';
    } else if (hasReached) {
      if (num === 6) {
        cellBg = '#f0f9ff';
        btnBorder = '1px solid #7dd3fc';
        btnBg = '#e0f2fe';
        btnColor = '#0369a1';
      } else if (num === 7) {
        cellBg = '#fffbeb';
        btnBorder = '1px solid #fcd34d';
        btnBg = '#fef3c7';
        btnColor = '#b45309';
      } else {
        cellBg = '#fef2f2';
        btnBorder = '1px solid #fca5a5';
        btnBg = '#fee2e2';
        btnColor = '#b91c1c';
      }
    }

    return `
      <td class="text-center font-mono" style="background:${cellBg}; vertical-align:middle; padding:8px 6px;">
        <div style="display:inline-flex; align-items:center; justify-content:center; gap:4px;">
          <button type="button" onclick="MoldMaintenance.openMilestoneModal('${moldKey}', ${num}, ${!isDone})" 
            style="cursor:pointer; border:${btnBorder}; background:${btnBg}; color:${btnColor}; border-radius:5px; padding:4px 10px; font-size:13px; font-weight:${isDone ? '800' : '700'}; display:inline-flex; align-items:center; gap:3px;"
            title="${isDone ? 'Bấm để mở lại mốc này (yêu cầu mật khẩu 1234)' : `Bấm để chốt mốc ${labelStr} (yêu cầu mật khẩu 1234)`}">
            <span style="font-size:12px;">${isDone ? '☑' : '☐'}</span>
            <span>${isDone ? 'Đã chốt' : 'Chốt'}</span>
          </button>
          ${pdfData ? `
            <a href="javascript:void(0)" onclick="MoldMaintenance.viewMilestonePdf('${moldKey}', ${num})" 
              style="color:#0284c7; font-size:14px; font-weight:700; text-decoration:none; display:inline-flex; align-items:center;" title="Xem file PDF đính kèm: ${pdfData.name || 'Biên bản'}">
              📄
            </a>
          ` : ''}
        </div>
        ${isDone && (dateDisplay || detail?.tech) ? `
          <div style="font-size:10.5px; line-height:1.2; margin-top:3px; color:#15803d; font-weight:600;" title="Bảo dưỡng ngày ${dateDisplay} bởi ${detail?.tech || ''}">
            ${dateDisplay ? `<div>📅 ${dateDisplay}</div>` : ''}
            ${detail?.tech ? `<div style="color:#0284c7; font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:85px; margin:0 auto;">👤 ${detail.tech}</div>` : ''}
          </div>
        ` : ''}
      </td>
    `;
  }

  function getMilestonePdfsMap() {
    try {
      return JSON.parse(localStorage.getItem(MOLD_PDF_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function getMilestonePdf(moldNo, num) {
    const code = String(moldNo || '').trim().toUpperCase();
    const map = getMilestonePdfsMap();
    if (map[code] && map[code][num]) return map[code][num];
    if (rawData && rawData.excelMasterMolds) {
      const item = rawData.excelMasterMolds.find(m => (m.mold || '').toUpperCase() === code);
      if (item && item.milestonePdfs && item.milestonePdfs[num]) return item.milestonePdfs[num];
    }
    return null;
  }

  function saveMilestonePdf(moldNo, num, pdfObj) {
    const code = String(moldNo || '').trim().toUpperCase();
    const map = getMilestonePdfsMap();
    if (!map[code]) map[code] = {};
    if (pdfObj) {
      map[code][num] = pdfObj;
    } else {
      delete map[code][num];
    }
    try {
      localStorage.setItem(MOLD_PDF_KEY, JSON.stringify(map));
    } catch (e) {}

    if (rawData && rawData.excelMasterMolds) {
      const item = rawData.excelMasterMolds.find(m => (m.mold || '').toUpperCase() === code);
      if (item) {
        if (!item.milestonePdfs) item.milestonePdfs = {};
        if (pdfObj) item.milestonePdfs[num] = pdfObj;
        else delete item.milestonePdfs[num];
      }
    }
  }

  function viewMilestonePdf(moldNo, num) {
    const pdfData = getMilestonePdf(moldNo, num);
    if (!pdfData || !pdfData.dataUrl) {
      alert('Không tìm thấy tệp PDF đính kèm hoặc dữ liệu tệp chưa sẵn sàng.');
      return;
    }
    try {
      const arr = pdfData.dataUrl.split(',');
      const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'application/pdf';
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const blob = new Blob([u8arr], { type: mime });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    } catch (err) {
      console.error('Error opening PDF:', err);
      window.open(pdfData.dataUrl, '_blank');
    }
  }

  // Mini Window: Mở hộp thoại xác thực chốt mốc bảo dưỡng (MK: 1234 + Upload PDF)
  let activeMilestoneAuth = null; // { moldNo, milestoneNum, isClosing }

  function openMilestoneModal(moldNo, milestoneNum, isClosing) {
    activeMilestoneAuth = { moldNo: String(moldNo).trim(), milestoneNum: Number(milestoneNum), isClosing: Boolean(isClosing) };
    const modal = document.getElementById('mmMilestoneAuthModal');
    if (!modal) return;

    const icon = document.getElementById('mmAuthModalIcon');
    const title = document.getElementById('mmAuthModalTitle');
    const subtitle = document.getElementById('mmAuthModalSubtitle');
    const desc = document.getElementById('mmAuthModalDesc');
    const passInput = document.getElementById('mmAuthPasswordInput');
    const passErr = document.getElementById('mmAuthPassError');
    const existingPdfBox = document.getElementById('mmAuthExistingPdfInfo');
    const existingPdfName = document.getElementById('mmAuthExistingPdfName');
    const existingPdfLink = document.getElementById('mmAuthExistingPdfLink');
    const pdfFileInput = document.getElementById('mmAuthPdfFileInput');
    const noteInput = document.getElementById('mmAuthNoteInput');
    const confirmBtn = document.getElementById('mmAuthConfirmBtn');

    if (icon) icon.textContent = isClosing ? '🔒' : '🔓';
    if (title) title.textContent = isClosing ? 'Xác Nhận Chốt Bảo Dưỡng Mốc' : 'Xác Nhận Mở Lại Mốc Bảo Dưỡng';
    if (subtitle) {
      let mLabel = `Mốc ${milestoneNum} (800.000 shots)`;
      if (milestoneNum === 6) mLabel = `Mốc 6 (3.000.000 shots - 3M SOP)`;
      else if (milestoneNum === 7) mLabel = `Mốc 7 (4.500.000 shots - 4.5M HQ)`;
      else if (milestoneNum === 8) mLabel = `Mốc 8 (5.000.000 shots - 5M Chạm trần)`;
      subtitle.innerHTML = `Khuôn: <b style="color:#0284c7;">${moldNo}</b> | <span style="color:#1d4ed8; font-weight:700;">${mLabel}</span>`;
    }
    if (desc) {
      let mText = `Mốc ${milestoneNum}`;
      if (milestoneNum === 6) mText = `Mốc 6 (3.000.000 shots - Đánh giá mòn thân khuôn)`;
      else if (milestoneNum === 7) mText = `Mốc 7 (4.500.000 shots - Báo cáo HQ phê duyệt)`;
      else if (milestoneNum === 8) mText = `Mốc 8 (5.000.000 shots - Chạm trần tuổi thọ 5M)`;
      desc.innerHTML = isClosing
        ? `Xác nhận khuôn <b>${moldNo}</b> đã hoàn tất kiểm tra và bảo dưỡng định kỳ <b>${mText}</b>. Trạng thái sẽ được tích xanh hoàn thành.`
        : `Xác nhận <b>Mở lại ${mText}</b> của khuôn <b>${moldNo}</b> (Hủy trạng thái đã chốt để bảo dưỡng hoặc đếm lại shot).`;
    }
    if (confirmBtn) {
      confirmBtn.textContent = isClosing ? 'Chốt Hoàn Thành' : 'Mở Lại Mốc';
      confirmBtn.style.background = isClosing ? '#16a34a' : '#ea580c';
    }

    if (passInput) passInput.value = '1234';
    if (passErr) passErr.style.display = 'none';

    // File PDF đính kèm nếu đã có
    const existingPdf = getMilestonePdf(moldNo, milestoneNum);
    if (existingPdfBox) {
      if (existingPdf) {
        existingPdfBox.style.display = 'flex';
        if (existingPdfName) existingPdfName.textContent = `Tệp đã lưu: ${existingPdf.name} (${Math.round((existingPdf.size || 0) / 1024)} KB)`;
        if (existingPdfLink) {
          existingPdfLink.onclick = () => viewMilestonePdf(moldNo, milestoneNum);
        }
      } else {
        existingPdfBox.style.display = 'none';
      }
    }
    if (pdfFileInput) pdfFileInput.value = '';

    if (noteInput) {
      const notesMap = getMoldNotesMap();
      noteInput.value = notesMap[moldNo.toUpperCase()] || '';
    }

    // Điền ngày bảo dưỡng và ai bảo dưỡng
    const dateInput = document.getElementById('mmAuthDateInput');
    const techInput = document.getElementById('mmAuthTechInput');
    const existingDetail = getMilestoneDetail(moldNo, milestoneNum);
    if (dateInput) {
      dateInput.value = existingDetail?.date || new Date().toISOString().slice(0, 10);
    }
    if (techInput) {
      techInput.value = existingDetail?.tech || (window.ComponentAuth?.user?.fullName || window.ComponentAuth?.user?.username || '');
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    setTimeout(() => {
      if (passInput) passInput.focus();
    }, 80);
  }

  function closeMilestoneModal() {
    activeMilestoneAuth = null;
    const modal = document.getElementById('mmMilestoneAuthModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  async function confirmMilestoneAuth() {
    if (!activeMilestoneAuth) return;
    const { moldNo, milestoneNum, isClosing } = activeMilestoneAuth;

    const passInput = document.getElementById('mmAuthPasswordInput');
    const passErr = document.getElementById('mmAuthPassError');
    const confirmBtn = document.getElementById('mmAuthConfirmBtn');
    const pass = (passInput ? passInput.value : '').trim();

    // Mật khẩu xác thực: mặc định 1234. Cho phép để trống (tự hiểu là mặc định 1234) hoặc nhập đúng 1234
    if (pass && pass !== '1234') {
      if (passErr) passErr.style.display = 'block';
      if (passInput) {
        passInput.focus();
        passInput.select();
      }
      return;
    }

    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Đang xử lý...';
    }

    try {
      // Đọc file PDF đính kèm nếu người dùng có chọn
      const pdfFileInput = document.getElementById('mmAuthPdfFileInput');
      let newPdfObj = null;
      if (pdfFileInput && pdfFileInput.files && pdfFileInput.files[0]) {
        const file = pdfFileInput.files[0];
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = err => reject(err);
            reader.readAsDataURL(file);
          });
          newPdfObj = {
            name: file.name,
            size: file.size,
            dataUrl,
            date: new Date().toLocaleDateString('vi-VN')
          };
          saveMilestonePdf(moldNo, milestoneNum, newPdfObj);
        } catch (err) {
          console.warn('Error reading PDF file:', err);
        }
      }

      // Ghi chú đính kèm nếu có
      const noteInput = document.getElementById('mmAuthNoteInput');
      if (noteInput && noteInput.value.trim()) {
        try { await updateMoldNote(moldNo, noteInput.value.trim()); } catch (e) {}
      }

      const dateInput = document.getElementById('mmAuthDateInput');
      const techInput = document.getElementById('mmAuthTechInput');
      const dateVal = dateInput?.value || new Date().toISOString().slice(0, 10);
      const techVal = (techInput?.value || '').trim() || 'KTV Bảo Dưỡng';
      const noteVal = (noteInput ? noteInput.value : '').trim();
      const existingPdf = getMilestonePdf(moldNo, milestoneNum);

      const detailObj = {
        date: dateVal,
        tech: techVal,
        note: noteVal,
        pdf: newPdfObj || existingPdf || null,
        closedAt: new Date().toISOString()
      };
      if (isClosing) {
        saveMilestoneDetail(moldNo, milestoneNum, detailObj);
      } else {
        saveMilestoneDetail(moldNo, milestoneNum, null);
      }

      // Thực hiện chốt / mở chốt mốc
      await toggleMilestoneCheck(moldNo, milestoneNum, isClosing, detailObj);

      closeMilestoneModal();
    } catch (err) {
      console.error('Lỗi khi chốt mốc:', err);
      alert('Không thể hoàn tất chốt mốc: ' + (err?.message || err));
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = isClosing ? 'Chốt Hoàn Thành' : 'Mở Lại Mốc';
      }
    }
  }

  async function toggleMilestoneCheck(moldNo, milestoneNum, isChecked, optionalDetail) {
    const moldCode = String(moldNo).trim().toUpperCase();
    const map = getClosedMilestonesMap();
    if (!map[moldCode]) map[moldCode] = [];

    const num = Number(milestoneNum);
    if (isChecked) {
      if (!map[moldCode].includes(num)) map[moldCode].push(num);
    } else {
      map[moldCode] = map[moldCode].filter(x => x !== num);
    }
    try { localStorage.setItem(MOLD_CLOSED_KEY, JSON.stringify(map)); } catch (e) {}

    // Update in memory
    if (rawData && rawData.excelMasterMolds) {
      const target = rawData.excelMasterMolds.find(m => (m.mold || '').toUpperCase() === moldCode);
      if (target) {
        target.completedMilestones = map[moldCode];
        if (!target.milestoneDetails) target.milestoneDetails = {};
        if (isChecked && optionalDetail) {
          target.milestoneDetails[num] = optionalDetail;
          if (optionalDetail.pdf) {
            if (!target.milestonePdfs) target.milestonePdfs = {};
            target.milestonePdfs[num] = optionalDetail.pdf;
          }
        } else if (!isChecked) {
          delete target.milestoneDetails[num];
        }
      }
    }

    // Re-render table smoothly
    renderTable();

    // Sync to Cloudflare D1
    try {
      const payload = {
        mold: moldCode,
        completedMilestones: map[moldCode]
      };
      if (isChecked && optionalDetail) {
        payload.milestoneDetails = { [num]: optionalDetail };
        if (optionalDetail.pdf) {
          payload.milestonePdfs = { [num]: { name: optionalDetail.pdf.name, size: optionalDetail.pdf.size, date: optionalDetail.pdf.date } };
        }
      }
      const response = await fetch('/api/molds/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.ComponentAuth?.csrf || '' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`Không lưu được mốc bảo dưỡng (HTTP ${response.status})`);
    } catch (err) {
      console.warn('Sync milestone err:', err);
    }
  }

  // Danh mục toàn bộ khuôn hợp nhất (Master 455 khuôn + Khuôn trên máy live + Khuôn thêm mới)
  function getAllUnifiedMolds() {
    if (!rawData) return [];
    const liveByMold = {};
    (rawData.records || []).forEach(r => {
      if (r.moldNo) liveByMold[r.moldNo.toUpperCase()] = r;
    });

    // Merge any locally added custom molds
    try {
      const customMolds = JSON.parse(localStorage.getItem('mm_custom_molds') || '[]');
      if (Array.isArray(customMolds) && customMolds.length > 0) {
        if (!rawData.excelMasterMolds) rawData.excelMasterMolds = [];
        customMolds.forEach(cm => {
          const cCode = (cm.mold || '').toUpperCase();
          if (!rawData.excelMasterMolds.some(m => (m.mold || '').toUpperCase() === cCode)) {
            rawData.excelMasterMolds.unshift(cm);
          }
        });
      }
    } catch (e) {}

    // 1. Tổng hợp số shot thời gian thực theo từng khuôn từ rawData.records (dailyHistory + todayShots)
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    const curMonthKey = 'M' + curMonth;
    const todayYmd = curYear + '-' + String(curMonth).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    const liveShotsByMold = {};
    (rawData.records || []).forEach(r => {
      const dh = r.dailyHistory || {};
      Object.keys(dh).forEach(dateStr => {
        const it = dh[dateStr];
        if (!it || !it.shots) return;
        const mCode = (it.moldNo || r.moldNo || '').toUpperCase().trim();
        if (!mCode || mCode === '-') return;
        const parts = dateStr.split('-');
        if (parts.length === 3 && parseInt(parts[0], 10) === curYear) {
          const mo = parseInt(parts[1], 10);
          const mKey = 'M' + mo;
          if (!liveShotsByMold[mCode]) liveShotsByMold[mCode] = {};
          liveShotsByMold[mCode][mKey] = (liveShotsByMold[mCode][mKey] || 0) + it.shots;
        }
      });

      const todayShots = Number(r.todayShots) || 0;
      const moldToday = (r.moldNo || '').toUpperCase().trim();
      if (todayShots > 0 && moldToday && moldToday !== '-') {
        if (!dh[todayYmd] || !dh[todayYmd].shots) {
          if (!liveShotsByMold[moldToday]) liveShotsByMold[moldToday] = {};
          liveShotsByMold[moldToday][curMonthKey] = (liveShotsByMold[moldToday][curMonthKey] || 0) + todayShots;
        }
      }
    });

    const allMoldsMap = {};
    (rawData.excelMasterMolds || []).forEach(m => {
      const code = (m.mold || '').toUpperCase().trim();
      if (!code || code === '-' || code.length < 3) return;
      if (code.includes('TÊN KHUÔN') || code.includes('MOLD NAME') || code.includes('ITEM NAME') || /^\d+CAV$/i.test(code) || code.length > 25 || code.includes('LƯU Ý') || code.includes('YÊU CẦU') || code.includes('BỘ PHẬN') || code.includes('NHỰA ĐÚC')) return;
      const oldCode = (m.oldMold || m.old_name || '').toUpperCase().trim();
      const newCode = (m.newMold || m.new_name || '').toUpperCase().trim();
      const live = liveByMold[code] || 
        (oldCode && oldCode !== '-' ? liveByMold[oldCode] : null) || 
        (newCode && newCode !== '-' ? liveByMold[newCode] : null);
      const isHigh = m.is_high_impact || (live ? live.isHighImpact : false);
      const notesMap = getMoldNotesMap();
      const closedMap = getClosedMilestonesMap();

      const moldLiveShots = liveShotsByMold[code] || 
        (oldCode && oldCode !== '-' ? liveShotsByMold[oldCode] : null) || 
        (newCode && newCode !== '-' ? liveShotsByMold[newCode] : null);

      const monthlyHistory = { ...(m.monthlyHistory || (live ? live.monthlyHistory : null) || {}) };
      if (moldLiveShots) {
        Object.keys(moldLiveShots).forEach(mKey => {
          const mNum = parseInt(mKey.replace('M', ''), 10);
          if (mNum >= 11 || !monthlyHistory[mKey] || Number(monthlyHistory[mKey]) === 0) {
            monthlyHistory[mKey] = moldLiveShots[mKey];
          }
        });
      }

      const novLiveShots = Math.round(Number(monthlyHistory.M11 || moldLiveShots?.M11 || 0));

      let m1 = Math.round(m.m1_800k || (live ? live.m1_800k : 0));
      let m2 = Math.round(m.m2_800k || (live ? live.m2_800k : 0));
      let m3 = Math.round(m.m3_800k || (live ? live.m3_800k : 0));
      let m4 = Math.round(m.m4_800k || 0);
      let m5 = Math.round(m.m5_800k || 0);

      // Last year remaining shots (số shot dở dang của chu kỳ cuối năm ngoái chuyển sang)
      let lastYearRemaining = Math.round(Number(m.lastYearRemaining || m.lastYearShot || live?.lastYearRemaining || live?.lastYearShot || 0));
      if (!lastYearRemaining && (code === 'H9637S15' || (m.mold || '').toUpperCase() === 'H9637S15')) {
        lastYearRemaining = 548806;
      }
      if (!lastYearRemaining && m1 > 0 && monthlyHistory) {
        const earlyYearShots = (monthlyHistory.M1 || 0) + (monthlyHistory.M2 || 0) + (monthlyHistory.M3 || 0);
        if (earlyYearShots > 0 && m1 > earlyYearShots && (m1 - earlyYearShots) > 50000) {
          lastYearRemaining = Math.round(m1 - earlyYearShots);
        }
      }

      let totalYearFromMonths = 0;
      for (let i = 1; i <= 12; i++) {
        totalYearFromMonths += Math.round(Number(monthlyHistory['M' + i]) || 0);
      }

      // Infer past closed milestones if not explicitly set in localStorage
      let closedMilestones = closedMap[code];
      if (!closedMilestones) {
        closedMilestones = [];
        if (m3 > 0) {
          closedMilestones.push(1, 2);
        } else if (m2 > 0) {
          closedMilestones.push(1);
        }
        const pastLife = Number(m.totalShotLastYear || m.lastYearShot || 0);
        if (pastLife >= 5000000) {
          closedMilestones.push(6, 7, 8);
        } else if (pastLife >= 4500000) {
          closedMilestones.push(6, 7);
        } else if (pastLife >= 3000000) {
          closedMilestones.push(6);
        }
      }

      // Tự động xác định mốc hiện tại không giới hạn
      let currentCycleNum = 1;
      while (closedMilestones.includes(currentCycleNum)) {
        currentCycleNum++;
      }

      // Cập nhật số shot của mốc chưa chốt đang chạy với số shot live tháng 11
      if (currentCycleNum === 1) {
        m1 = Math.max(m1, m1 + novLiveShots, (Number(lastYearRemaining) || 0) + totalYearFromMonths);
      } else if (currentCycleNum === 2) {
        if (m2 === 0) {
          m2 = Math.max(0, totalYearFromMonths - m1);
        } else {
          m2 += novLiveShots;
        }
      } else if (currentCycleNum === 3) {
        if (m3 === 0) {
          m3 = Math.max(0, totalYearFromMonths - m1 - m2);
        } else {
          m3 += novLiveShots;
        }
      } else if (currentCycleNum === 4) {
        if (m4 === 0) {
          m4 = Math.max(0, totalYearFromMonths - m1 - m2 - m3);
        } else {
          m4 += novLiveShots;
        }
      } else if (currentCycleNum === 5) {
        if (m5 === 0) {
          m5 = Math.max(0, totalYearFromMonths - m1 - m2 - m3 - m4);
        } else {
          m5 += novLiveShots;
        }
      }

      const totalYear = m1 + m2 + m3 + m4 + m5;
      const baseLife = Math.max(Number(m.total_life) || 0, Number(live?.totalLifeShots) || 0);
      const totalLife = Math.round(baseLife + (baseLife > 0 ? novLiveShots : 0));

      const isDone6 = (closedMilestones || []).includes(6);
      const isDone7 = (closedMilestones || []).includes(7);
      const isDone8 = (closedMilestones || []).includes(8);
      const m6 = Math.round(m.m6 || (isDone6 ? 3000000 : (totalLife >= 3000000 ? 3000000 : (totalLife >= 2850000 ? totalLife : 0))));
      const m7 = Math.round(m.m7 || (isDone7 ? 4500000 : (totalLife >= 4500000 ? 4500000 : (totalLife >= 4300000 ? totalLife : 0))));
      const m8 = Math.round(m.m8 || (isDone8 ? 5000000 : (totalLife >= 5000000 ? 5000000 : (totalLife >= 4800000 ? totalLife : 0))));
      const moldNote = notesMap[code] || m.note || (live ? live.note : '') || '';

      let cycleName = 'Mốc ' + currentCycleNum;
      let curShots = 0;
      if (currentCycleNum === 1) curShots = m1;
      else if (currentCycleNum === 2) curShots = m2;
      else if (currentCycleNum === 3) curShots = m3;
      else if (currentCycleNum === 4) curShots = m4;
      else if (currentCycleNum === 5) curShots = m5;
      else {
        curShots = totalLife > 0 ? (totalLife % 800000) : 0;
      }
      if (live && Number.isFinite(Number(live.currentCycleShots))) {
        curShots = Math.max(curShots, Math.round(Number(live.currentCycleShots)));
      }
      if (curShots === 0 && currentCycleNum > 1 && totalLife > 0) {
        curShots = totalLife % 800000;
      }

      const evalData = computeMoldPlanAndStatus(isHigh, curShots, totalLife);

      allMoldsMap[code] = {
        totalShotLastYear: Math.round(Number(m.totalShotLastYear || m.total_life || live?.totalLifeShots || 0)),
        lastYearRemaining,
        monthlyHistory,
        mold: m.mold,
        oldMold: m.oldMold || m.old_name || '-',
        newMold: m.newMold || m.new_name || '-',
        series: m.series || (live ? live.series : '-'),
        isHighImpact: isHigh,
        tier: isHigh ? 'High-Impact' : 'Tiêu Chuẩn',
        machineNo: live ? live.machineNo : '-',
        planMilestone: evalData.plan,
        planDisplay: evalData.planDisplay,
        cycleName,
        curShots,
        percent: evalData.percent,
        remaining: evalData.remaining,
        status: evalData.status,
        statusText: evalData.statusText,
        statusClass: evalData.statusClass,
        lifeAlert: evalData.lifeAlert,
        lifeAlertText: evalData.lifeAlertText,
        lifeBadgeHtml: evalData.lifeBadgeHtml,
        m1,
        m2,
        m3,
        m4,
        m5,
        totalYear,
        m6,
        m7,
        m8,
        totalLife,
        note: moldNote,
        closedMilestones,
        currentCycleNum
      };
    });

    // Bổ sung các khuôn trên 44 máy live nếu chưa có trong master (tránh trùng lặp với mã cũ / mã mới)
    (rawData.records || []).forEach(r => {
      if (!r.moldNo) return;
      const code = r.moldNo.toUpperCase().trim();
      let existing = allMoldsMap[code];
      if (!existing) {
        existing = Object.values(allMoldsMap).find(m => 
          (m.oldMold && m.oldMold.toUpperCase().trim() === code) ||
          (m.newMold && m.newMold.toUpperCase().trim() === code)
        );
      }

      if (existing) {
        existing.machineNo = r.machineNo;
        if (Number.isFinite(Number(r.totalLifeShots))) {
          existing.totalLife = Math.max(existing.totalLife || 0, Math.round(Number(r.totalLifeShots)));
        }
      } else {
        const isHigh = r.isHighImpact || false;
        const m1 = Math.round(r.m1_800k || 0);
        const m2 = Math.round(r.m2_800k || 0);
        const m3 = Math.round(r.m3_800k || 0);
        const totalLife = Math.round(r.totalLifeShots || 0);

        let cycleName = 'Mốc 1';
        let curShots = m1;
        if (m3 > 0) {
          cycleName = 'Mốc 3';
          curShots = m3;
        } else if (m2 > 0) {
          cycleName = 'Mốc 2';
          curShots = m2;
        }

        const evalData = computeMoldPlanAndStatus(isHigh, curShots, totalLife);

        allMoldsMap[code] = {
          mold: r.moldNo,
          oldMold: '-',
          newMold: r.moldNo,
          series: r.series || '-',
          isHighImpact: isHigh,
          tier: isHigh ? 'High-Impact' : 'Tiêu Chuẩn',
          machineNo: r.machineNo,
          planMilestone: evalData.plan,
          planDisplay: evalData.planDisplay,
          cycleName,
          curShots,
          percent: evalData.percent,
          remaining: evalData.remaining,
          status: evalData.status,
          statusText: evalData.statusText,
          statusClass: evalData.statusClass,
          lifeAlert: evalData.lifeAlert,
          lifeAlertText: evalData.lifeAlertText,
          lifeBadgeHtml: evalData.lifeBadgeHtml,
          m1,
          m2,
          m3,
          totalLife
        };
      }
    });

    return Object.values(allMoldsMap);
  }

  // Hàm đánh giá các mốc bảo dưỡng CHƯA CHỐT mà đã đến hạn hoặc sắp đến hạn
  function getUnclosedDueInfo(m) {
    if (!m) return { tier: 3, maxRatio: 0, highestVal: 0 };
    const closed = Array.isArray(m.closedMilestones) ? m.closedMilestones : [];
    const isHigh = Boolean(m.isHighImpact);

    let bestTier = 3; // 1: Đến hạn / Quá hạn (val >= targetLimit), 2: Sắp đến hạn (val >= warnLimit), 3: An toàn / Đã chốt
    let maxRatio = 0;
    let highestVal = 0;

    for (let c = 1; c <= 8; c++) {
      const isDone = closed.includes(c);
      if (isDone) continue; // ĐÃ CHỐT -> Bỏ qua

      let val = 0;
      if (c === 1) val = m.m1;
      else if (c === 2) val = m.m2;
      else if (c === 3) val = m.m3;
      else if (c === 4) val = m.m4;
      else if (c === 5) val = m.m5;
      else if (c === m.currentCycleNum) val = m.curShots;
      else val = m['m' + c] || 0;

      val = Number(val) || 0;
      if (val <= 0) continue;

      let targetLimit = 800000;
      let warnLimit = 750000;
      if (isHigh && c <= 5) {
        targetLimit = 400000;
        warnLimit = 350000;
      } else if (c === 6) {
        targetLimit = 3000000;
        warnLimit = 2850000;
      } else if (c === 7) {
        targetLimit = 4500000;
        warnLimit = 4300000;
      } else if (c === 8) {
        targetLimit = 5000000;
        warnLimit = 4800000;
      }

      const ratio = val / targetLimit;
      if (ratio > maxRatio) {
        maxRatio = ratio;
        highestVal = val;
      }

      if (val >= targetLimit) {
        bestTier = 1; // ĐẾN HẠN / QUÁ HẠN CHƯA CHỐT (ĐỎ)
      } else if (val >= warnLimit && bestTier > 1) {
        bestTier = 2; // SẮP ĐẾN HẠN CHƯA CHỐT (VÀNG / CAM)
      }
    }

    // Nếu trạng thái tổng thể tính theo chu kỳ đang chạy báo due/warning mà chu kỳ đó chưa chốt
    if (m.status === 'due' && !closed.includes(m.currentCycleNum || 1)) {
      bestTier = 1;
    } else if (m.status === 'warning' && bestTier > 1 && !closed.includes(m.currentCycleNum || 1)) {
      bestTier = 2;
    }

    return { tier: bestTier, maxRatio, highestVal };
  }

  function getFilteredMolds() {
    const list = getAllUnifiedMolds();
    const q = filterText.toLowerCase();

    const filtered = list.filter(m => {
      const matchText = !q ||
        (m.mold && m.mold.toLowerCase().includes(q)) ||
        (m.oldMold && m.oldMold.toLowerCase().includes(q)) ||
        (m.series && m.series.toLowerCase().includes(q)) ||
        (m.machineNo && m.machineNo.toLowerCase().includes(q));

      let matchTier = true;
      if (filterTier === 'high_impact') matchTier = m.isHighImpact === true;
      else if (filterTier === 'standard') matchTier = !m.isHighImpact;

      let matchStatus = true;
      if (filterStatus === 'due') matchStatus = m.status === 'due';
      else if (filterStatus === 'warning') matchStatus = m.status === 'warning';
      else if (filterStatus === 'safe') matchStatus = m.status === 'safe';
      else if (filterStatus === 'running') matchStatus = m.machineNo !== '-';
      else if (filterStatus === 'life_alert') matchStatus = Boolean(m.lifeAlert);

      return matchText && matchTier && matchStatus;
    });

    // Hàm xác định mức độ ưu tiên của khuôn có mốc CHƯA CHỐT mà đã đến hạn hoặc sắp đến hạn
    // Tier 1: ĐẾN HẠN / QUÁ HẠN CHƯA CHỐT (ĐỎ: val >= 800K hoặc >= 400K với High-Impact)
    // Tier 2: SẮP ĐẾN HẠN CHƯA CHỐT (VÀNG/CAM: val >= 750K hoặc >= 350K với High-Impact)
    // Tier 3: AN TOÀN HOẶC ĐÃ CHỐT
    filtered.sort((a, b) => {
      const infoA = getUnclosedDueInfo(a);
      const infoB = getUnclosedDueInfo(b);

      // Ưu tiên 1: Đưa mấy con chưa chốt mà đến hạn (Tier 1 & Tier 2) lên trên đầu bảng
      if (infoA.tier !== infoB.tier) {
        return infoA.tier - infoB.tier;
      }

      // Trong cùng nhóm Tier 1 hoặc Tier 2: Ưu tiên con có tỷ lệ % chạm mốc cao nhất lên trước
      if (infoA.tier <= 2) {
        if (infoB.maxRatio !== infoA.maxRatio) {
          return infoB.maxRatio - infoA.maxRatio;
        }
      }

      // Nhóm Tier 3 (An toàn / Đã chốt): Duy trì logic ưu tiên khuôn có sản lượng thực tế trong tháng
      const histA = a.monthlyHistory || {};
      const histB = b.monthlyHistory || {};
      const m11A = Number(histA.M11 || 0) + (a.machineNo !== '-' ? Number(a.curShots || 0) : 0);
      const m11B = Number(histB.M11 || 0) + (b.machineNo !== '-' ? Number(b.curShots || 0) : 0);
      const hasShotsA = (m11A > 0 || (Number(a.curShots) || 0) > 0) ? 1 : 0;
      const hasShotsB = (m11B > 0 || (Number(b.curShots) || 0) > 0) ? 1 : 0;
      if (hasShotsA !== hasShotsB) return hasShotsB - hasShotsA;
      if (m11A !== m11B) return m11B - m11A;

      return (Number(b.curShots) || 0) - (Number(a.curShots) || 0);
    });

    return filtered;
  }

  // ============================================================================
  // BẢNG 1 (ƯU TIÊN SHOW): TOÀN BỘ KHUÔN & TRẠNG THÁI CHẠM MỐC PLAN 800K / 350K~400K
  // ============================================================================
  function renderMoldsOverviewSheet(container) {
    const all = getAllUnifiedMolds();
    const list = getFilteredMolds();
    const totalCount = list.length;
    const visibleList = list.slice(0, moldVisibleLimit);

    // Determine max milestone number across all molds (minimum 8: Mốc 1-5 800K, Mốc 6 3M, Mốc 7 4.5M, Mốc 8 5M)
    let maxMilestoneCols = 8;
    all.forEach(m => {
      (m.closedMilestones || []).forEach(n => {
        if (n >= maxMilestoneCols) maxMilestoneCols = n + 1;
      });
      if (m.currentCycleNum && m.currentCycleNum > maxMilestoneCols) {
        maxMilestoneCols = m.currentCycleNum;
      }
    });

    let monthHeaders = '';
    if (moldColPrefs.months !== false) {
      for (let mIdx = 1; mIdx <= 12; mIdx++) {
        const mKey = 'T' + mIdx;
        monthHeaders += `<th class="text-center" style="background:#f8fafc; color:#1e3a8a; min-width:72px; font-size:12.5px; border-left:1px solid #e2e8f0;" title="Số shot tháng ${mIdx}/2026">${mKey}</th>`;
      }
    }

    let lastYearHeader = '';
    if (moldColPrefs.lastYear !== false) {
      lastYearHeader = `<th class="text-right" style="background:#fef2f2; color:#b91c1c; min-width:105px; font-size:12.5px; border-left:1px solid #fee2e2;" title="Số shot dở dang của chu kỳ cuối năm ngoái chuyển sang (Last Year Carryover)">Last Year (Còn lại)</th>`;
    }

    let milestoneHeaders = '';
    for (let c = 1; c <= 8; c++) {
      let colTitle = `Mốc ${c}`;
      if (c === 6) colTitle = 'Mốc 6 (3M)';
      else if (c === 7) colTitle = 'Mốc 7 (4.5M)';
      else if (c === 8) colTitle = 'Mốc 8 (5M)';
      milestoneHeaders += `<th class="text-center" style="background:#eff6ff; color:#1d4ed8; min-width:88px;" title="${colTitle} - Tích xanh khi hoàn thành">${colTitle}</th>`;
    }
    if (moldColPrefs.totalYear !== false) {
      milestoneHeaders += `<th class="text-right font-bold" style="background:#f1f5f9; color:#0f172a; min-width:105px;" title="Tổng số shot của các mốc trong năm">Tổng Năm</th>`;
    }

    let html = `
      ${getMilestoneLegendHtml()}
      <div style="overflow-x:auto;">
        <table class="mm-table">
          <thead>
            <tr>
              <th style="min-width:130px;">Tên Khuôn</th>
              ${moldColPrefs.series ? '<th>Dòng Sản Phẩm (Series)</th>' : ''}
              ${moldColPrefs.tier ? '<th class="text-center">Tiêu Chuẩn</th>' : ''}
              ${moldColPrefs.machine ? '<th class="text-center">Máy Đang Ép</th>' : ''}
              ${moldColPrefs.cycle ? '<th class="text-center">Chu Kỳ</th>' : ''}
              ${moldColPrefs.curShots ? '<th class="text-right" style="background:#f0fdf4; color:#15803d;">Số Shot Chu Kỳ</th>' : ''}
              ${moldColPrefs.plan ? '<th class="text-right">Mốc Plan</th>' : ''}
              ${moldColPrefs.progress ? '<th style="min-width:140px;">Tiến Độ</th>' : ''}
              ${moldColPrefs.status ? '<th class="text-center">Trạng Thái</th>' : ''}
              ${lastYearHeader}
              ${monthHeaders}
              ${milestoneHeaders}
              ${moldColPrefs.totalLife ? '<th class="text-right font-bold" style="background:#f8fafc; color:#0f172a;">Tổng Vòng Đời</th>' : ''}
              ${moldColPrefs.note ? '<th style="min-width:180px;">Note (Ghi Chú)</th>' : ''}
              <th class="text-center" style="width:40px; padding:0; background:#f1f5f9;">
                <button type="button" class="mm-btn-col-toggle" onclick="MoldMaintenance.toggleColPicker(event)" title="Thêm hoặc ẩn cột tuỳ chọn" style="width:100%; height:100%; border:none; background:transparent; font-weight:bold; font-size:16px; color:#0284c7; cursor:pointer;">+</button>
              </th>
            </tr>
          </thead>
          <tbody>
    `;

    if (list.length === 0) {
      html += `<tr><td colspan="20" style="text-align:center; padding:30px; color:#888;">Không tìm thấy khuôn nào phù hợp với bộ lọc.</td></tr>`;
    } else {
      visibleList.forEach((m, idx) => {
        const isRunning = m.machineNo !== '-';
        let barColor = '#16a34a';
        if (m.status === 'due') barColor = '#e11d48';
        else if (m.status === 'warning') barColor = '#f59e0b';

        const renderMilestoneCell = (num, shotVal) => {
          const isDone = (m.closedMilestones || []).includes(num);
          const detail = getMilestoneDetail(m.mold, num);
          const pdfData = detail?.pdf || getMilestonePdf(m.mold, num);
          const val = Number(shotVal) || 0;

          let cellBg = '#eff6ff';
          let textColor = '#1e293b';
          let btnBorder = '1px solid #cbd5e1';
          let btnBg = '#ffffff';
          let btnColor = '#475569';
          let warningTag = '';

          let targetLimit = 800000;
          let warnLimit = 750000;
          if (m.isHighImpact && num <= 5) {
            targetLimit = 400000;
            warnLimit = 350000;
          } else if (num === 6) {
            targetLimit = 3000000;
            warnLimit = 2850000;
          } else if (num === 7) {
            targetLimit = 4500000;
            warnLimit = 4300000;
          } else if (num === 8) {
            targetLimit = 5000000;
            warnLimit = 4800000;
          }

          if (isDone) {
            cellBg = '#f0fdf4';
            textColor = '#15803d';
            btnBorder = '1px solid #86efac';
            btnBg = '#dcfce7';
            btnColor = '#15803d';
          } else if (val >= targetLimit) {
            cellBg = '#fff1f2';
            textColor = '#e11d48';
            btnBorder = '1px solid #f43f5e';
            btnBg = '#ffe4e6';
            btnColor = '#be123c';
            warningTag = '';
          } else if (val >= warnLimit) {
            cellBg = '#fffbeb';
            textColor = '#b45309';
            btnBorder = '1px solid #f59e0b';
            btnBg = '#fef3c7';
            btnColor = '#b45309';
            warningTag = '';
          } else if (val > 0) {
            cellBg = '#f0fdf4';
            textColor = '#15803d';
            btnBorder = '1px solid #cbd5e1';
            btnBg = '#ffffff';
            btnColor = '#475569';
          } else {
            cellBg = '#f8fafc';
            textColor = '#94a3b8';
            btnBorder = '1px solid #e2e8f0';
            btnBg = '#f8fafc';
            btnColor = '#94a3b8';
          }

          const dateDisplay = detail?.date ? (detail.date.includes('-') ? detail.date.split('-').reverse().join('/') : detail.date) : '';

          return `
            <td class="text-center font-mono" style="background:${cellBg}; vertical-align:middle; padding:8px 6px;">
              <div style="font-size:16.5px; font-weight:${val > 0 ? '800' : '500'}; color:${textColor};">
                ${val > 0 ? formatNum(val) : '-'}
              </div>
              ${warningTag}
              <div style="display:inline-flex; align-items:center; justify-content:center; gap:4px; margin-top:4px;">
                <button type="button" onclick="MoldMaintenance.openMilestoneModal('${m.mold}', ${num}, ${!isDone})" 
                  style="cursor:pointer; border:${btnBorder}; background:${btnBg}; color:${btnColor}; border-radius:5px; padding:4px 10px; font-size:13.5px; font-weight:${isDone ? '800' : '700'}; display:inline-flex; align-items:center; gap:3px;"
                  title="${isDone ? 'Bấm để mở lại mốc này (yêu cầu mật khẩu 1234)' : 'Bấm để chốt hoàn thành mốc (yêu cầu mật khẩu 1234)'}">
                  <span style="font-size:13px;">${isDone ? '☑' : '☐'}</span>
                  <span>${isDone ? 'Đã chốt' : 'Chốt'}</span>
                </button>
                ${pdfData ? `
                  <a href="javascript:void(0)" onclick="MoldMaintenance.viewMilestonePdf('${m.mold}', ${num})" 
                    style="color:#0284c7; font-size:14px; font-weight:700; text-decoration:none; display:inline-flex; align-items:center;" title="Xem file PDF đính kèm: ${pdfData.name || 'Biên bản'}">
                    📄
                  </a>
                ` : ''}
              </div>
              ${isDone && (dateDisplay || detail?.tech) ? `
                <div style="font-size:10.5px; line-height:1.2; margin-top:3px; color:#15803d; font-weight:600;" title="Bảo dưỡng ngày ${dateDisplay} bởi ${detail?.tech || ''}">
                  ${dateDisplay ? `<div>📅 ${dateDisplay}</div>` : ''}
                  ${detail?.tech ? `<div style="color:#0284c7; font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:85px; margin:0 auto;">👤 ${detail.tech}</div>` : ''}
                </div>
              ` : ''}
            </td>
          `;
        };

        let lastYearCell = '';
        if (moldColPrefs.lastYear !== false) {
          const lyVal = m.lastYearRemaining || 0;
          lastYearCell = `
            <td class="text-right font-mono" style="font-size:13px; font-weight:700; color:${lyVal > 0 ? '#b91c1c' : '#94a3b8'}; background:#fff5f5; vertical-align:middle; padding:8px 8px; border-left:1px solid #fee2e2;" title="Số shot dở dang của chu kỳ cuối năm ngoái chuyển sang">
              ${lyVal > 0 ? formatNum(lyVal) : '-'}
            </td>
          `;
        }

        let milestoneCells = '';
        let monthCells = '';
        if (moldColPrefs.months !== false) {
          const hist = m.monthlyHistory || {};
          for (let mIdx = 1; mIdx <= 12; mIdx++) {
            const rawM = hist['M' + mIdx] || hist[String(mIdx)] || hist[String(mIdx).padStart(2, '0')];
            const mVal = rawM ? Math.round(Number(rawM)) : 0;
            monthCells += `
              <td class="text-right font-mono" style="font-size:13px; color:${mVal > 0 ? '#1e293b' : '#94a3b8'}; vertical-align:middle; padding:8px 6px; border-left:1px solid #f1f5f9;">
                ${mVal > 0 ? formatNum(mVal) : '-'}
              </td>
            `;
          }
        }

        for (let c = 1; c <= 8; c++) {
          let val = 0;
          if (c === 1) val = m.m1;
          else if (c === 2) val = m.m2;
          else if (c === 3) val = m.m3;
          else if (c === 4) val = m.m4;
          else if (c === 5) val = m.m5;
          else if (c === m.currentCycleNum) val = m.curShots;
          else if ((m.closedMilestones || []).includes(c)) val = m['m' + c] || 0;
          milestoneCells += renderMilestoneCell(c, val);
        }

        if (moldColPrefs.totalYear !== false) {
          const totYear = (m.m1 || 0) + (m.m2 || 0) + (m.m3 || 0) + (m.m4 || 0) + (m.m5 || 0);
          milestoneCells += `
            <td class="text-right font-mono font-bold" style="background:#f8fafc; color:#0f172a; font-size:15px; vertical-align:middle; padding:8px 8px;" title="Tổng số shot của các mốc trong năm">
              ${totYear > 0 ? formatNum(totYear) : '-'}
            </td>
          `;
        }

        const displayMoldName = (m.newMold && m.newMold !== '-' && m.newMold !== 'null') ? m.newMold : (m.oldMold && m.oldMold !== '-' ? m.oldMold : m.mold);

        html += `
          <tr style="${m.status === 'due' ? 'background:#fff1f2;' : (m.status === 'warning' ? 'background:#fffbeb;' : '')}">
            <td class="font-mono" style="vertical-align:middle; padding:8px 10px;">
              <div style="font-weight:700; color:#0f172a; font-size:15px; letter-spacing:0.2px;" title="${m.oldMold && m.oldMold !== '-' ? 'Mã cũ: ' + m.oldMold : ''}${m.series && m.series !== '-' ? ' | ' + m.series : ''}">
                ${displayMoldName}
              </div>
            </td>
            ${moldColPrefs.series ? `<td><div style="font-weight:600; color:#334155; font-size:14px;">${m.series}</div></td>` : ''}
            ${moldColPrefs.tier ? `
              <td class="text-center">
                <span class="mm-type-badge ${m.isHighImpact ? 'high-impact' : 'standard'}" style="font-size:12px;">
                  ${m.isHighImpact ? 'High-Impact' : 'Tiêu Chuẩn'}
                </span>
              </td>
            ` : ''}
            ${moldColPrefs.machine ? `
              <td class="text-center font-bold font-mono">
                ${isRunning 
                  ? `<span style="display:inline-block; padding:3px 9px; border-radius:5px; background:#dcfce7; color:#15803d; font-size:13px; font-weight:700;">⚡ ${m.machineNo}</span>` 
                  : `<span style="color:#94a3b8; font-size:13px;">Trong kho</span>`}
              </td>
            ` : ''}
            ${moldColPrefs.cycle ? `<td class="text-center font-mono font-bold" style="color:#4338ca; font-size:13.5px;">${m.cycleName}</td>` : ''}
            ${moldColPrefs.curShots ? `
              <td class="text-right font-mono" style="background:#f0fdf4; font-weight:700; color:#15803d; font-size:14.5px;">
                ${formatNum(m.curShots)}
              </td>
            ` : ''}
            ${moldColPrefs.plan ? `<td class="text-right font-mono" style="color:#475569; font-weight:600; font-size:13.5px;">${m.planDisplay}</td>` : ''}
            ${moldColPrefs.progress ? `
              <td>
                <div style="display:flex; align-items:center; gap:8px;">
                  <div style="flex:1; height:8px; background:#e2e8f0; border-radius:4px; overflow:hidden;">
                    <div style="width:${m.percent}%; height:100%; background:${barColor}; border-radius:4px;"></div>
                  </div>
                  <span class="font-mono" style="font-size:12px; font-weight:700; color:#334155; min-width:34px; text-align:right;">${m.percent}%</span>
                </div>
                <div style="font-size:11px; color:#64748b; margin-top:2px;">
                  ${m.isHighImpact 
                    ? (m.curShots >= 400000 
                        ? `<span style="color:#e11d48; font-weight:600;">Vượt ${formatNum(m.curShots - 400000)} shot</span>` 
                        : (m.curShots >= 350000 
                            ? `<span style="color:#d97706; font-weight:600;">Trong hạn dự phòng (350K-400K)</span>` 
                            : `Còn ${formatNum(350000 - m.curShots)} shot`))
                    : (m.remaining > 0 
                        ? `Còn ${formatNum(m.remaining)} shot` 
                        : `<span style="color:#e11d48; font-weight:600;">Vượt ${formatNum(Math.abs(m.remaining))} shot</span>`)
                  }
                </div>
              </td>
            ` : ''}
            ${moldColPrefs.status ? `
              <td class="text-center">
                <span class="mm-status-pill ${m.statusClass}" style="font-size:13px; font-weight:700; padding:4px 10px;">
                  <span class="dot"></span>
                  <span>${m.statusText}</span>
                </span>
              </td>
            ` : ''}
            ${lastYearCell}
            ${monthCells}
            ${milestoneCells}
            ${moldColPrefs.totalLife ? `
              <td class="text-right font-mono font-bold" style="background:#f8fafc; color:#0f172a; font-size:15px;">
                ${formatNum(m.totalLife)}
                
              </td>
            ` : ''}
            ${moldColPrefs.note ? `
              <td>
                <input type="text" value="${m.note || ''}" placeholder="Ghi chú..." onchange="MoldMaintenance.updateMoldNote('${m.mold}', this.value)" style="width:100%; font-size:13px; padding:5px 8px; border:1px solid #cbd5e1; border-radius:4px; outline:none; background:#ffffff;" title="Nhập ghi chú và nhấn Enter để lưu">
              </td>
            ` : ''}
            <td style="background:#f8fafc;"></td>
          </tr>
        `;
      });
    }

    html += `</tbody></table></div>`;

    if (totalCount > 0) {
      html += `
        <div style="margin-top:16px; padding:12px 18px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
          <div style="font-size:14px; font-weight:700; color:#334155;">
            Đang hiển thị <span style="color:#0284c7; font-weight:800;">1 - ${Math.min(moldVisibleLimit, totalCount)}</span> trên tổng số <span style="color:#0f172a; font-weight:800;">${totalCount}</span> khuôn
            ${moldVisibleLimit < totalCount ? `<span style="font-weight:normal; color:#64748b; margin-left:8px;">(Cuộn xuống để tự động tải thêm 30)</span>` : `<span style="color:#15803d; font-weight:700; margin-left:8px;">✓ Đã hiển thị tất cả</span>`}
          </div>
          ${moldVisibleLimit < totalCount ? `
            <div style="display:flex; align-items:center; gap:8px;">
              <button type="button" onclick="MoldMaintenance.loadMoreMolds()" class="mm-btn" style="padding:6px 14px; background:#0284c7; color:#fff; border:none; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer;">
                ⬇ Tải thêm 20 khuôn
              </button>
              <button type="button" onclick="MoldMaintenance.showAllMolds()" class="mm-btn" style="padding:6px 14px; background:#ffffff; color:#334155; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer;">
                Xem tất cả (${totalCount})
              </button>
            </div>
          ` : ''}
        </div>
        ${moldVisibleLimit < totalCount ? `<div id="mmLazySentinel" style="height:25px; margin-top:5px;"></div>` : ''}
      `;
    }

    container.innerHTML = html;
  }

  // Render Table: Ưu tiên show Bảng 1 (molds) hoặc Bảng 2 (machines)
  function renderTable() {
    const container = document.getElementById('mmTableContainer');
    if (!container) return;
    if (currentSubTab === 'molds') {
      renderMoldsOverviewSheet(container);
    } else {
      renderDailySheet(container);
    }
    setupLazyObserver();
  }

  // ============================================================================
  // SHEET 1: THEO MÁY (ĐỒNG NHẤT CÙNG 1 KIỂU VỚI SHEET MOLD)
  // Mặc định: STT, Mã Máy, Mã Khuôn, Trạng Thái, Mốc 1..5, Tổng Vòng Đời, [+]
  // Tùy chọn (dấu +): Số shot ngày, Sản lượng, Phế phẩm, Series, Tiêu chuẩn, Cavity, CT, Note
  // ============================================================================
  function renderDailySheet(container) {
    const list = getFilteredRecords();
    const totalCount = list.length;
    const visibleList = list.slice(0, machineVisibleLimit);
    const dayLabel = selectedDay === 'all' ? 'Tất cả các ngày' : `Ngày ${selectedDay}/${selectedMonth}/${selectedYear}`;
    const todayNow = new Date();
    const curYearNow = todayNow.getFullYear();
    const curMonthNow = todayNow.getMonth() + 1;
    const curDayNow = todayNow.getDate();
    const selYearNumHead = parseInt(selectedYear, 10);
    const selMonthNumHead = parseInt(selectedMonth, 10);
    const selDayNumHead = selectedDay === 'all' ? 0 : parseInt(selectedDay, 10);
    const isFutureSelection = (selYearNumHead > curYearNow) ||
                              (selYearNumHead === curYearNow && selMonthNumHead > curMonthNow) ||
                              (selYearNumHead === curYearNow && selMonthNumHead === curMonthNow && selDayNumHead > curDayNow);

    let html = `
      ${getMilestoneLegendHtml()}
      <div style="overflow-x:auto;">
        <table class="mm-table">
          <thead>
            <tr>
              <th class="text-center">Mã Máy</th>
              <th style="min-width:120px;">Tên Khuôn</th>
              ${colPrefs.series ? '<th>Dòng Sản Phẩm (Series)</th>' : ''}
              ${colPrefs.tier ? '<th class="text-center">Tiêu Chuẩn</th>' : ''}
              ${colPrefs.cavity ? '<th class="text-center">Cavity</th>' : ''}
              ${colPrefs.cycleTime ? '<th class="text-center">CT (s)</th>' : ''}
              ${colPrefs.prodOutput ? '<th class="text-right">Sản Lượng OK (Pcs)</th>' : ''}
              ${colPrefs.prodScrap ? '<th class="text-right" style="color:#e11d48;">Phế Phẩm NG (Pcs)</th>' : ''}
              ${colPrefs.dailyShots ? `<th class="text-right" style="background:#f0fdf4; color:#15803d; font-size:14px;" title="Chuẩn SOP: Số Shot = (Sản Lượng + Phế Phẩm) / Cavity">Số Shot Ngày ${selectedDay === 'all' ? 'Tổng' : selectedDay}${isFutureSelection ? ' (Chưa chạy)' : ''}</th>` : ''}
              ${colPrefs.status ? '<th class="text-center">Trạng Thái</th>' : ''}
              <th class="text-center" style="background:#eff6ff; color:#1d4ed8; min-width:88px;" title="Mốc 1 (800K) - Chu kỳ bảo dưỡng định kỳ trong năm">Mốc 1</th>
              <th class="text-center" style="background:#eff6ff; color:#1d4ed8; min-width:88px;" title="Mốc 2 (800K) - Chu kỳ bảo dưỡng định kỳ trong năm">Mốc 2</th>
              <th class="text-center" style="background:#eff6ff; color:#1d4ed8; min-width:88px;" title="Mốc 3 (800K) - Chu kỳ bảo dưỡng định kỳ trong năm">Mốc 3</th>
              <th class="text-center" style="background:#eff6ff; color:#1d4ed8; min-width:88px;" title="Mốc 4 (800K) - Chu kỳ bảo dưỡng định kỳ trong năm">Mốc 4</th>
              <th class="text-center" style="background:#eff6ff; color:#1d4ed8; min-width:88px;" title="Mốc 5 (800K) - Chu kỳ bảo dưỡng định kỳ trong năm">Mốc 5</th>
              <th class="text-center" style="background:#eff6ff; color:#1d4ed8; min-width:88px;" title="Mốc 6 (3.000.000 shots SOP) - Đánh giá mòn thân khuôn dựa trên Tổng Vòng Đời">Mốc 6 (3M)</th>
              <th class="text-center" style="background:#eff6ff; color:#1d4ed8; min-width:88px;" title="Mốc 7 (4.500.000 shots SOP) - Iriso HQ phê duyệt phương án dựa trên Tổng Vòng Đời">Mốc 7 (4.5M)</th>
              <th class="text-center" style="background:#eff6ff; color:#1d4ed8; min-width:88px;" title="Mốc 8 (5.000.000 shots SOP) - Chạm trần tuổi thọ 5M dựa trên Tổng Vòng Đời">Mốc 8 (5M)</th>
              ${colPrefs.totalYear !== false ? '<th class="text-right font-bold" style="background:#f1f5f9; color:#0f172a; min-width:105px;" title="Tổng số shot của các mốc trong năm">Tổng Năm</th>' : ''}
              ${colPrefs.totalLife ? '<th class="text-right font-bold" style="background:#f8fafc; color:#0f172a;">Tổng Vòng Đời</th>' : ''}
              ${colPrefs.machineStatus ? '<th class="text-center">Trạng Thái Máy</th>' : ''}
              ${colPrefs.note ? '<th style="min-width:160px;">Note</th>' : ''}
              <th class="text-center" style="width:40px; padding:0; background:#f1f5f9;">
                <button type="button" class="mm-btn-col-toggle" onclick="MoldMaintenance.toggleColPicker(event)" title="Thêm hoặc ẩn cột tuỳ chọn" style="width:100%; height:100%; border:none; background:transparent; font-weight:bold; font-size:16px; color:#0284c7; cursor:pointer;">+</button>
              </th>
            </tr>
          </thead>
          <tbody>
    `;

    if (list.length === 0) {
      html += `<tr><td colspan="20" style="text-align:center; padding:30px; color:#888;">Không tìm thấy máy hoặc khuôn nào phù hợp với bộ lọc.</td></tr>`;
    } else {
      visibleList.forEach((r, idx) => {
        const isRunning = r.machineStatus === 'Running';
        const moldKey = String(r.moldNo || '').trim().toUpperCase();

        const masterMold = (rawData.excelMasterMolds || []).find(m => 
          (m.mold || '').toUpperCase() === moldKey ||
          (m.oldMold && m.oldMold.toUpperCase() === moldKey) ||
          (m.newMold && m.newMold.toUpperCase() === moldKey)
        );
        const oldMold = masterMold?.oldMold || '-';
        const isHigh = r.isHighImpact || masterMold?.is_high_impact || false;
        const totalLife = Math.max(Number(r.totalLifeShots) || 0, Number(masterMold?.total_life) || 0);

        const closedMap = getClosedMilestonesMap();
        let closedMilestones = closedMap[moldKey] || masterMold?.completedMilestones || [];

        const m1 = Math.round(r.m1_800k || masterMold?.m1_800k || 0);
        const m2 = Math.round(r.m2_800k || masterMold?.m2_800k || 0);
        const m3 = Math.round(r.m3_800k || masterMold?.m3_800k || 0);
        const m4 = Math.round(masterMold?.m4_800k || 0);
        const m5 = Math.round(masterMold?.m5_800k || 0);
        const isDone6 = closedMilestones.includes(6);
        const isDone7 = closedMilestones.includes(7);
        const isDone8 = closedMilestones.includes(8);
        const m6 = Math.round(masterMold?.m6 || (isDone6 ? 3000000 : (totalLife >= 3000000 ? 3000000 : (totalLife >= 2850000 ? totalLife : 0))));
        const m7 = Math.round(masterMold?.m7 || (isDone7 ? 4500000 : (totalLife >= 4500000 ? 4500000 : (totalLife >= 4300000 ? totalLife : 0))));
        const m8 = Math.round(masterMold?.m8 || (isDone8 ? 5000000 : (totalLife >= 5000000 ? 5000000 : (totalLife >= 4800000 ? totalLife : 0))));

        let currentCycleNum = 1;
        while (closedMilestones.includes(currentCycleNum)) currentCycleNum++;

        let curShots = 0;
        if (currentCycleNum === 1) curShots = m1;
        else if (currentCycleNum === 2) curShots = m2;
        else if (currentCycleNum === 3) curShots = m3;
        else if (currentCycleNum === 4) curShots = m4;
        else if (currentCycleNum === 5) curShots = m5;
        else curShots = totalLife > 0 ? (totalLife % 800000) : 0;
        if (Number.isFinite(Number(r.currentCycleShots))) curShots = Math.round(Number(r.currentCycleShots));

        const evalData = computeMoldPlanAndStatus(isHigh, curShots, totalLife);
        
        let dayShots = 0;
        let dayProd = 0;
        let dayScrap = 0;
        const today = new Date();
        const curYear = today.getFullYear();
        const curMonth = today.getMonth() + 1;
        const curDay = today.getDate();
        const todayKey = String(curDay).padStart(2, '0');
        const yesterday = new Date(today.getTime() - 86400000);
        const yesterdayKey = String(yesterday.getDate()).padStart(2, '0');

        const selYearNum = parseInt(selectedYear, 10);
        const selMonthNum = parseInt(selectedMonth, 10);
        const selDayNum = selectedDay === 'all' ? 0 : parseInt(selectedDay, 10);

        const isFutureDate = (selYearNum > curYear) ||
                             (selYearNum === curYear && selMonthNum > curMonth) ||
                             (selYearNum === curYear && selMonthNum === curMonth && selDayNum > curDay);

        if (isFutureDate) {
          // Ngày trong tương lai (chưa chạy) -> Tuyệt đối không có số shot
          dayShots = 0;
          dayProd = 0;
          dayScrap = 0;
        } else if (selectedYear === String(curYear) && selectedMonth === String(curMonth).padStart(2, '0') && selectedDay === todayKey) {
          dayShots = r.todayShots || 0;
          dayProd = r.todayProdOutputPcs || 0;
          dayScrap = r.todayScrapPcs || 0;
        } else if (selectedYear === String(yesterday.getFullYear()) && selectedMonth === String(yesterday.getMonth() + 1).padStart(2, '0') && selectedDay === yesterdayKey) {
          dayShots = r.yesterdayShots || 0;
          dayProd = r.yesterdayProdOutputPcs || 0;
          dayScrap = r.yesterdayScrapPcs || 0;
        } else if (selectedDay === 'all') {
          dayShots = (r.yesterdayShots || 0) + (r.todayShots || 0);
          dayProd = (r.yesterdayProdOutputPcs || 0) + (r.todayProdOutputPcs || 0);
          dayScrap = (r.yesterdayScrapPcs || 0) + (r.todayScrapPcs || 0);
        } else {
          const entry = (r.dailyMonthData && r.dailyMonthData[selectedDay]) || {};
          dayShots = entry.shots || 0;
          dayProd = entry.prodOutput || 0;
          dayScrap = entry.scrap || 0;
        }

        const renderMilestoneCell = (num, shotVal) => {
          const isDone = closedMilestones.includes(num);
          const detail = getMilestoneDetail(r.moldNo, num);
          const pdfData = detail?.pdf || getMilestonePdf(r.moldNo, num);
          const val = Number(shotVal) || 0;

          let cellBg = '#eff6ff';
          let textColor = '#1e293b';
          let btnBorder = '1px solid #cbd5e1';
          let btnBg = '#ffffff';
          let btnColor = '#475569';
          let warningTag = '';

          let targetLimit = 800000;
          let warnLimit = 750000;
          if (r.isHighImpact && num <= 5) {
            targetLimit = 400000;
            warnLimit = 350000;
          } else if (num === 6) {
            targetLimit = 3000000;
            warnLimit = 2850000;
          } else if (num === 7) {
            targetLimit = 4500000;
            warnLimit = 4300000;
          } else if (num === 8) {
            targetLimit = 5000000;
            warnLimit = 4800000;
          }

          if (isDone) {
            cellBg = '#f0fdf4';
            textColor = '#15803d';
            btnBorder = '1px solid #86efac';
            btnBg = '#dcfce7';
            btnColor = '#15803d';
          } else if (val >= targetLimit) {
            cellBg = '#fff1f2';
            textColor = '#e11d48';
            btnBorder = '1px solid #f43f5e';
            btnBg = '#ffe4e6';
            btnColor = '#be123c';
            warningTag = '';
          } else if (val >= warnLimit) {
            cellBg = '#fffbeb';
            textColor = '#b45309';
            btnBorder = '1px solid #f59e0b';
            btnBg = '#fef3c7';
            btnColor = '#b45309';
            warningTag = '';
          } else if (val > 0) {
            cellBg = '#f0fdf4';
            textColor = '#15803d';
            btnBorder = '1px solid #cbd5e1';
            btnBg = '#ffffff';
            btnColor = '#475569';
          } else {
            cellBg = '#f8fafc';
            textColor = '#94a3b8';
            btnBorder = '1px solid #e2e8f0';
            btnBg = '#f8fafc';
            btnColor = '#94a3b8';
          }

          const dateDisplay = detail?.date ? (detail.date.includes('-') ? detail.date.split('-').reverse().join('/') : detail.date) : '';

          return `
            <td class="text-center font-mono" style="background:${cellBg}; vertical-align:middle; padding:8px 6px;">
              <div style="font-size:16.5px; font-weight:${val > 0 ? '800' : '500'}; color:${textColor};">
                ${val > 0 ? formatNum(val) : '-'}
              </div>
              ${warningTag}
              <div style="display:inline-flex; align-items:center; justify-content:center; gap:4px; margin-top:4px;">
                <button type="button" onclick="MoldMaintenance.openMilestoneModal('${r.moldNo}', ${num}, ${!isDone})" 
                  style="cursor:pointer; border:${btnBorder}; background:${btnBg}; color:${btnColor}; border-radius:5px; padding:4px 10px; font-size:13.5px; font-weight:${isDone ? '800' : '700'}; display:inline-flex; align-items:center; gap:3px;"
                  title="${isDone ? 'Bấm để mở lại mốc này (yêu cầu mật khẩu 1234)' : 'Bấm để chốt hoàn thành mốc (yêu cầu mật khẩu 1234)'}">
                  <span style="font-size:13px;">${isDone ? '☑' : '☐'}</span>
                  <span>${isDone ? 'Đã chốt' : 'Chốt'}</span>
                </button>
                ${pdfData ? `
                  <a href="javascript:void(0)" onclick="MoldMaintenance.viewMilestonePdf('${r.moldNo}', ${num})" 
                    style="color:#0284c7; font-size:14px; font-weight:700; text-decoration:none; display:inline-flex; align-items:center;" title="Xem file PDF đính kèm: ${pdfData.name || 'Biên bản'}">
                    📄
                  </a>
                ` : ''}
              </div>
              ${isDone && (dateDisplay || detail?.tech) ? `
                <div style="font-size:10.5px; line-height:1.2; margin-top:3px; color:#15803d; font-weight:600;" title="Bảo dưỡng ngày ${dateDisplay} bởi ${detail?.tech || ''}">
                  ${dateDisplay ? `<div>📅 ${dateDisplay}</div>` : ''}
                  ${detail?.tech ? `<div style="color:#0284c7; font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:85px; margin:0 auto;">👤 ${detail.tech}</div>` : ''}
                </div>
              ` : ''}
            </td>
          `;
        };

        let milestoneCells = '';
        for (let c = 1; c <= 8; c++) {
          let val = 0;
          if (c === 1) val = m1;
          else if (c === 2) val = m2;
          else if (c === 3) val = m3;
          else if (c === 4) val = m4;
          else if (c === 5) val = m5;
          else if (c === currentCycleNum) val = curShots;
          else if (closedMilestones.includes(c)) val = (c === 1 ? m1 : (c === 2 ? m2 : (c === 3 ? m3 : (c === 4 ? m4 : (c === 5 ? m5 : 0))))) || 0;
          milestoneCells += renderMilestoneCell(c, val);
        }

        if (colPrefs.totalYear !== false) {
          const totYear = m1 + m2 + m3 + m4 + m5;
          milestoneCells += `
            <td class="text-right font-mono font-bold" style="background:#f8fafc; color:#0f172a; font-size:15px; vertical-align:middle; padding:8px 8px;" title="Tổng số shot của các mốc trong năm 2026">
              ${totYear > 0 ? formatNum(totYear) : '-'}
            </td>
          `;
        }

        const mDisplay = (r.newMold && r.newMold !== '-') ? r.newMold : (masterMold?.newMold && masterMold.newMold !== '-' ? masterMold.newMold : (oldMold && oldMold !== '-' ? oldMold : r.moldNo));

        html += `
          <tr style="${evalData.status === 'due' ? 'background:#fff1f2;' : (evalData.status === 'warning' ? 'background:#fffbeb;' : '')}">
            <td class="text-center font-bold font-mono">
              <span style="color:#0284c7; font-size:16px; font-weight:800;">${r.machineNo}</span>
            </td>
            <td class="font-mono" style="vertical-align:middle; padding:8px 10px;">
              <div style="font-weight:700; color:#0f172a; font-size:15px; letter-spacing:0.2px;" title="${oldMold && oldMold !== '-' ? 'Mã cũ: ' + oldMold : ''}${r.series ? ' | ' + r.series : ''}">
                ${mDisplay}
              </div>
            </td>
            ${colPrefs.series ? `
              <td>
                <div style="font-weight:600; color:#334155; font-size:14px;">${r.series || '-'}</div>
                <small style="color:#64748b; font-size:12px;">${r.productRunning || ''}</small>
              </td>
            ` : ''}
            ${colPrefs.tier ? `
              <td class="text-center">
                <span class="mm-type-badge ${isHigh ? 'high-impact' : 'standard'}" style="font-size:12px;">
                  ${isHigh ? 'High-Impact' : 'Tiêu Chuẩn'}
                </span>
              </td>
            ` : ''}
            ${colPrefs.cavity ? `<td class="text-center font-mono font-bold" style="color:#4338ca; font-size:13.5px;">${r.cavityStr || r.cavity}</td>` : ''}
            ${colPrefs.cycleTime ? `<td class="text-center font-mono" style="color:#64748b; font-size:13px;">${r.cycleTime ? r.cycleTime + 's' : '-'}</td>` : ''}
            ${colPrefs.prodOutput ? `<td class="text-right font-mono" style="font-size:14px;">${formatNum(dayProd)}</td>` : ''}
            ${colPrefs.prodScrap ? `<td class="text-right font-mono" style="font-size:14px; color:${dayScrap > 0 ? '#e11d48' : '#94a3b8'};">${formatNum(dayScrap)}</td>` : ''}
            ${colPrefs.dailyShots ? `
              <td class="text-right font-mono" style="background:${isFutureDate ? '#f8fafc' : '#f0fdf4'}; vertical-align:middle;">
                <div style="font-weight:700; font-size:14.5px; color:${isFutureDate ? '#94a3b8' : (dayShots > 0 ? '#15803d' : '#94a3b8')};" title="${isFutureDate ? 'Chưa chạy sản xuất (ngày tương lai)' : ''}">${dayShots > 0 ? formatNum(dayShots) : '-'}</div>
              </td>
            ` : ''}
            ${colPrefs.status ? `
              <td class="text-center">
                <span class="mm-status-pill ${evalData.statusClass}" style="font-size:13px; font-weight:700; padding:4px 10px;">
                  <span class="dot"></span>
                  <span>${evalData.statusText}</span>
                </span>
              </td>
            ` : ''}
            ${milestoneCells}
            ${colPrefs.totalLife ? `
              <td class="text-right font-mono font-bold" style="background:#f8fafc; color:#0f172a; font-size:17px;">
                ${formatNum(totalLife)}
                
              </td>
            ` : ''}
            ${colPrefs.machineStatus ? `
              <td class="text-center">
                <span class="mm-status-pill ${isRunning ? 'running' : 'stop'}" style="font-size:12.5px; font-weight:700; padding:4px 10px;">
                  <span class="dot"></span>
                  <span>${isRunning ? 'Running' : 'Stop'}</span>
                </span>
              </td>
            ` : ''}
            ${colPrefs.note ? `<td><input type="text" value="${r.note || (getMoldNotesMap()[(r.moldNo || '').toUpperCase()] || '')}" placeholder="Ghi chú..." onchange="MoldMaintenance.updateMoldNote('${r.moldNo}', this.value)" style="width:100%; font-size:13px; padding:5px 8px; border:1px solid #cbd5e1; border-radius:4px; outline:none; background:#ffffff;"></td>` : ''}
            <td style="background:#f8fafc;"></td>
          </tr>
        `;
      });
    }

    html += `</tbody></table></div>`;

    if (totalCount > 0) {
      html += `
        <div style="margin-top:16px; padding:12px 18px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
          <div style="font-size:14px; font-weight:700; color:#334155;">
            Đang hiển thị <span style="color:#0284c7; font-weight:800;">1 - ${Math.min(machineVisibleLimit, totalCount)}</span> trên tổng số <span style="color:#0f172a; font-weight:800;">${totalCount}</span> máy
            ${machineVisibleLimit < totalCount ? `<span style="font-weight:normal; color:#64748b; margin-left:8px;">(Cuộn xuống để tự động tải tiếp 30)</span>` : `<span style="color:#15803d; font-weight:700; margin-left:8px;">✓ Đã hiển thị tất cả</span>`}
          </div>
          ${machineVisibleLimit < totalCount ? `
            <div style="display:flex; align-items:center; gap:8px;">
              <button type="button" onclick="MoldMaintenance.loadMoreMachines()" class="mm-btn" style="padding:6px 14px; background:#0284c7; color:#fff; border:none; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer;">
                ⬇ Tải thêm 20 máy
              </button>
              <button type="button" onclick="MoldMaintenance.showAllMachines()" class="mm-btn" style="padding:6px 14px; background:#ffffff; color:#334155; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer;">
                Xem tất cả (${totalCount})
              </button>
            </div>
          ` : ''}
        </div>
        ${machineVisibleLimit < totalCount ? `<div id="mmLazySentinel" style="height:25px; margin-top:5px;"></div>` : ''}
      `;
    }

    container.innerHTML = html;
  }


  // ============================================================================
  // SHEET 2: THEO THÁNG (MA TRẬN NGÀY 01..31 & MỐC 1, 2, 3 - CHUẨN MMFD-I-F-022.01)
  // ============================================================================
  function renderMonthlySheet(container) {
    const list = rawData.excelMasterMolds || [];
    if (list.length === 0) {
      container.innerHTML = `<div style="padding:30px; text-align:center;">Đang tải danh mục ma trận tháng...</div>`;
      return;
    }

    const q = filterText.toLowerCase();
    const filteredMolds = list.filter(m => {
      return !q || m.mold.toLowerCase().includes(q) || m.series.toLowerCase().includes(q);
    });

    const dayCols = [];
    const today = new Date();
    const curYear = today.getFullYear();
    const curMonth = today.getMonth() + 1;
    const curDay = today.getDate();
    const curYesterday = new Date(today.getTime() - 86400000).getDate();
    const selYearNum = parseInt(selectedYear, 10);
    const selMonthNum = parseInt(selectedMonth, 10);
    const dayCount = new Date(selYearNum, selMonthNum, 0).getDate();

    for (let d = 1; d <= dayCount; d++) {
      const dKey = String(d).padStart(2, '0');
      const isYesterday = (selYearNum === curYear && selMonthNum === curMonth && d === curYesterday);
      const isToday = (selYearNum === curYear && selMonthNum === curMonth && d === curDay);
      const isFuture = (selYearNum > curYear) ||
                       (selYearNum === curYear && selMonthNum > curMonth) ||
                       (selYearNum === curYear && selMonthNum === curMonth && d > curDay);

      let thStyle = 'font-size:11px; padding:6px 3px; text-align:center; min-width:36px;';
      let label = dKey;
      if (isYesterday) {
        thStyle += 'background:#e2e8f0; color:#0f172a; font-weight:900;';
        label = `${dKey}<br><span style="font-size:9px; color:#475569;">H.Qua</span>`;
      } else if (isToday) {
        thStyle += 'background:#bbf7d0; color:#15803d; font-weight:900;';
        label = `${dKey}<br><span style="font-size:9px; color:#166534;">H.Nay</span>`;
      } else if (isFuture) {
        thStyle += 'background:#f8fafc; color:#94a3b8; font-weight:500;';
        label = `${dKey}<br><span style="font-size:8px; color:#94a3b8;">Chưa</span>`;
      }
      dayCols.push({ day: dKey, style: thStyle, label, isYesterday, isToday, isFuture });
    }

    let html = `
      <div style="margin-bottom:12px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
        <div style="font-size:13.5px; font-weight:700; color:#1e293b;">
          🗓️ Sheet 2: Ma Trận Kiểm Soát Số Shot &amp; Sản Lượng Theo Ngày Trên Tháng (Tháng ${selectedMonth}/${selectedYear})
        </div>
        <div style="font-size:12px; color:#64748b; display:flex; align-items:center; gap:12px;">
          <span><span style="display:inline-block; width:12px; height:12px; background:#e2e8f0; border-radius:2px; vertical-align:middle;"></span> Ngày ${String(curYesterday).padStart(2, '0')} (Hôm qua)</span>
          <span><span style="display:inline-block; width:12px; height:12px; background:#bbf7d0; border-radius:2px; vertical-align:middle;"></span> Ngày ${String(curDay).padStart(2, '0')} (Hôm nay)</span>
          <span><span style="display:inline-block; width:12px; height:12px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:2px; vertical-align:middle;"></span> Chưa chạy</span>
        </div>
      </div>

      <div style="overflow-x:auto;">
        <table class="mm-table mm-grid-table" style="font-size:12px;">
          <thead>
            <tr>
              <th style="min-width:110px;">Mã Khuôn (Mold)</th>
              <th style="min-width:100px;">Series</th>
              <th class="text-center" style="min-width:55px;">Máy</th>
              <th class="text-center" style="min-width:85px;">Type</th>
              <th style="min-width:90px; background:#f8fafc;">Loại</th>
              ${dayCols.map(c => `<th style="${c.style}">${c.label}</th>`).join('')}
              <th class="text-right" style="min-width:70px; background:#f8fafc; font-weight:bold;">Tổng Tháng</th>
              <th class="text-right" style="min-width:75px; background:#eff6ff;">Mốc 1 (800K-1)</th>
              <th class="text-right" style="min-width:75px; background:#eff6ff;">Mốc 2 (800K-2)</th>
              <th class="text-right" style="min-width:75px; background:#eff6ff;">Mốc 3 (800K-3)</th>
              <th class="text-right font-bold" style="min-width:85px; background:#f1f5f9;" title="Năm 2026 = Mốc 1 + Mốc 2 + Mốc 3">Tổng Năm</th>
              <th class="text-right font-bold" style="min-width:85px;">Tổng Vòng Đời</th>
            </tr>
          </thead>
          <tbody>
    `;

    filteredMolds.slice(0, 80).forEach((m) => {
      const daily = m.dailyMonthData || {};
      const activeMachine = m.machineNo || '-';

      let monthTotalProd = 0;
      let monthTotalShots = 0;
      for (let d = 1; d <= 31; d++) {
        const dKey = String(d).padStart(2, '0');
        const entry = daily[dKey] || { prodOutput: 0, shots: 0 };
        monthTotalProd += (entry.prodOutput || 0);
        monthTotalShots += (entry.shots || 0);
      }

      html += `
        <tr style="border-top:1px solid #cbd5e1;">
          <td rowspan="2" class="font-bold font-mono" style="vertical-align:middle; color:#0f172a; background:#ffffff;">${m.mold}</td>
          <td rowspan="2" style="vertical-align:middle; color:#334155; font-size:11.5px; background:#ffffff;">${m.series}</td>
          <td rowspan="2" class="text-center font-mono font-bold" style="vertical-align:middle; color:#0284c7; background:#ffffff;">${activeMachine}</td>
          <td rowspan="2" class="text-center" style="vertical-align:middle; background:#ffffff;">
            <span class="mm-type-badge ${m.is_high_impact ? 'high-impact' : 'standard'}">
              ${m.is_high_impact ? 'High-Impact' : 'Tiêu Chuẩn'}
            </span>
          </td>
          <td style="font-weight:600; color:#334155; background:#f8fafc;">📦 Sản Lượng</td>
          ${dayCols.map(c => {
            const entry = c.isFuture ? { prodOutput: 0 } : (daily[c.day] || { prodOutput: 0 });
            const val = entry.prodOutput || 0;
            const bg = c.isToday ? 'background:#f0fdf4;' : (c.isYesterday ? 'background:#f1f5f9;' : (c.isFuture ? 'background:#f8fafc; color:#94a3b8;' : ''));
            return `<td class="text-right font-mono" style="font-size:11px; ${bg}">${c.isFuture ? '-' : formatK(val)}</td>`;
          }).join('')}
          <td class="text-right font-mono font-bold" style="background:#f8fafc;">${formatK(monthTotalProd)}</td>
          <td rowspan="2" class="text-right font-mono" style="vertical-align:middle; background:#eff6ff; font-weight:700;">${formatNum(m.m1_800k)}</td>
          <td rowspan="2" class="text-right font-mono" style="vertical-align:middle; background:#eff6ff;">${formatNum(m.m2_800k)}</td>
          <td rowspan="2" class="text-right font-mono" style="vertical-align:middle; background:#eff6ff;">${formatNum(m.m3_800k)}</td>
          <td rowspan="2" class="text-right font-mono font-bold" style="vertical-align:middle; background:#f8fafc; color:#0f172a;" title="Tổng số shot năm 2026">${formatNum((m.m1_800k || 0) + (m.m2_800k || 0) + (m.m3_800k || 0))}</td>
          <td rowspan="2" class="text-right font-mono font-bold" style="vertical-align:middle; color:#0f172a;">${formatNum(m.total_life)}</td>
        </tr>
        <tr style="border-bottom:2px solid #e2e8f0; background:#fcfdfe;">
          <td style="font-weight:700; color:#15803d; background:#f0fdf4;">⚡ Số Shot</td>
          ${dayCols.map(c => {
            const entry = c.isFuture ? { shots: 0 } : (daily[c.day] || { shots: 0 });
            const val = entry.shots || 0;
            const bg = c.isToday ? 'background:#dcfce7; color:#166534; font-weight:700;' : (c.isYesterday ? 'background:#e2e8f0; color:#0f172a; font-weight:700;' : (c.isFuture ? 'background:#f8fafc; color:#94a3b8;' : ''));
            return `<td class="text-right font-mono" style="font-size:11px; ${bg}">${c.isFuture ? '-' : formatK(val)}</td>`;
          }).join('')}
          <td class="text-right font-mono font-bold" style="background:#f0fdf4; color:#15803d;">${formatK(monthTotalShots)}</td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
  }

  // ============================================================================
  // XUẤT EXCEL CHUẨN TEMPLATE MMFD-I-F-022.01 (ĐẾM SỐ SHOT & BẢO DƯỠNG KHUÔN)
  // GỒM 2 SHEET CHÍNH: KHUÔN TIÊU CHUẨN & KHUÔN HIGH IMPACT (CÓ KẾ HOẠCH BẢO DƯỠNG)
  // ============================================================================
    // Ảnh Legend PNG chuẩn 100% (350k ~ 400K | 750k ~ 800K | 2900~3000K)
  const LEGEND_PNG_BASE64 = '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';

    // 3 Dấu Control (ORIGINAL / INTERNAL USE / CONTROLLED) nhúng vào Remark Bảng 2
  const CONTROL_STAMPS_BASE64 = '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CSiBx4OASqkElIASUAJKQAkoASWgBJTAHQioA+AOgPSyElACjwMBlVEJKAEloASUgBJQAkpACSiBOxFQB8CdCOl1JaAEHn0CKqESUAJKQAkoASWgBJSAElACdySgDoA7ItIISkAJPOoEVD4loASUgBJQAkpACSgBJaAE7kxAHQB3ZqQxlIASeLQJqHRKQAkoASWgBJSAElACSkAJ3AUBdQDcBSSNogSUwKNMQGVTAkpACSgBJaAElIASUAJK4G4IqAPgbihpHCWgBB5dAiqZElACSkAJKAEloASUgBJQAndFQB0Ad4VJIykBJfCoElC5lIASUAJKQAkoASWgBJSAErg7AuoAuDtOGksJKIFHk4BKpQSUgBJQAkpACSgBJaAElMBdElAHwF2C0mhKQAk8igRUJiWgBJSAElACSkAJKAEloATuloA6AO6WlMZTAkrg0SOgEikBJaAElIASUAJKQAkoASVw1wTUAXDXqDSiElACjxoBlUcJKAEloASUgBJQAkpACSiBuyegDoC7Z6UxlYASeLQIqDRKQAkoASWgBJSAElACSkAJ7ICAOgB2AEujKgEl8CgRUFmUgBJQAkpACSgBJaAElIAS2AkBdQDshJbGVQJK4NEhoJIoASWgBJSAElACSkAJKAElsCMC6gDYES6NrASUwKNCQOVQAkpACSgBJaAElIASUAJKYGcE1AGwM14aWwkogUeDgEqhBJSAElACSkAJKAEloASUwA4JqANgh8A0uhJQAo8CAZVBCSgBJaAElIASUAJKQAkogZ0SUAfATolpfCWgBH56AiqBElACSkAJKAEloASUgBJQAjsmoA6AHSPTBEpACfzUBLR8JaAElIASUAJKQAkoASWgBHZOQB0AO2emKZSAEvhpCWjpSkAJKAEloASUgBJQAkpACdwDAXUA3AM0TaIElMBPSUDLVgJKQAkoASWgBJSAElACSuBeCKgD4F6oaRoloAR+OgJashJQAkpACSgBJaAElIASUAL3REAdAPeETRMpASXwUxHQcpWAElACSkAJKAEloASUgBK4NwLqALg3bppKCSiBn4aAlqoElIASUAJKQAkoASWgBJTAPRJQB8A9gtNkSkAJ/BQEtEwloASUgBJQAkpACSgBJaAE7pWAOgDulZymUwJK4OET0BKVgBJQAkpACSgBJaAElIASuGcC6gC4Z3SaUAkogYdNQMtTAkpACSgBJaAElIASUAJK4N4JqAPg3tlpSiWgBB4uAS1NCSgBJaAElIASUAJKQAkogfsgoA6A+4CnSZWAEniYBLQsJaAElIASUAJKQAkoASWgBO6HgDoA7oeeplUCSuDhEdCSlIASUAJKQAkoASWgBJSAErgvAuoAuC98mlgJKIGHRUDLUQJKQAkoASWgBJSAElACSuD+CKgD4P74aWoloAQeDgEtRQkoASWgBJSAElACSkAJKIH7JKAOgPsEqMmVgBJ4GAS0DCWgBJSAElACSkAJKAEloATul4A6AO6XoKZXAkrgwRPQEpSAElACSkAJKAEloASUgBK4bwLqALhvhJqBElACD5qA5q8ElIASUAJKQAkoASWgBJTA/RNQB8D9M9QclIASeLAENHcloASUgBJQAkpACSgBJaAEdoGAOgB2AaJmoQSUwIMkoHkrASWgBJSAElACSkAJKAElsBsE1AGwGxQ1DyWgBB4cAc1ZCSgBJaAElIASUAJKQAkogV0hoA6AXcGomSgBJfCgCGi+SkAJKAEloASUgBJQAkpACewOAXUA7A5HzUUJKIEHQ0BzVQJKQAkoASWgBJSAElACSmCXCKgDYJdAajZKQAk8CAKapxJQAkpACSgBJaAElIASUAK7RUAdALtFUvNRAkpg9wlojkpACSgBJaAElIASUAJKQAnsGgF1AOwaSs1ICSiB3Sag+SkBJaAElIASUAJKQAkoASWwewTUAbB7LDUnJaAEdpeA5qYElIASUAJKQAkoASWgBJTALhJQB8AuwtSslIAS2E0CmpcSUAJKQAkoASWgBJSAElACu0lAHQC7SVPzUgJKYPcIaE5KQAkoASWgBJSAElACSkAJ7CoBdQDsKk7NTAkogd0ioPkoASWgBJSAElACSkAJKAElsLsE1AGwuzw1NyWgBHaHgOaiBJSAElACSkAJKAEloASUwC4TUAfALgPV7JSAEtgNApqHElACSkAJKAEloASUgBJQArtNQB0Au01U81MCSuD+CWgOSkAJKAEloASUgBJQAkpACew6AXUA7DpSzVAJKIH7JaDplYASUAJKQAkoASWgBJSAEth9AuoA2H2mmqMSUAL3R0BTKwEloASUgBJQAkpACSgBJfAACKgD4AFA1SyVwE9BoFwu/zPDx49/KGsdyspA9Vh1QHVAdUB14LY68P/6KeYa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';

    // Ảnh Legend PNG chuẩn Bảng 2 (Kế hoạch bảo dưỡng: PLAN 300K..350K | FINISH 400K | PLAN 700K..750K | FINISH 800K | PLAN 2800..2900K | FINISH 3000K)
  const T2_LEGEND_PNG_BASE64 = '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';

  // Ảnh Legend PNG chuẩn Sheet Khuôn Tiêu Chuẩn (750k ~ 800K | OVER - 800K đỏ | 2900~3000K)
  const STD_LEGEND_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAABAAAAABACAYAAACECgX8AAAQAElEQVR4AezdB7wlSVU/8PrN7gLiAuvfjKKroqICrmKOg0hQUFayxCUnJcruEgxkySw5SUZEJAiIoIAEcw6ICWURMUsOC8vu/PvbPee9njv3vvdm5r0Jj3qfOdPd1VWnTp0651enTve9d8++/tc10DXQNbD7NXDl1v+6BroGuga6BroGdlgDw3J60kAnd9rXdbCv66D7wXFpAyfv2WEc7Oy7BroGuga6BroGuga6BroGugY+WzTw6mGgF3ZqXQet66D7wfFoA+3CngAYLLP/6xroGuga6BroGuga6BroGuga6BroGuga6BrY1RoYBtcTAIMS+r+uga6BroGuga6BroGuga6BroGuga6BroGugd2sAWPrCQBa6NQ10DXQNdA10DXQNdA10DXQNdA10DXQNdA1sHs1MI6sJwBGNfT/uga6BroGjj8N7Nu379SBrtxpX9fBvq6D7geftTZwheMPnbtEXQNdA10DJ6IGJpl7AmDSQ/+/a6BroGvgeNTAdw1C/U2n1nXQug66H3zW2sDjh7nv/7oGuga6BroGjlQD+9v3BMB+RfRD10DXQNdA10DXQNdA10DXQNdA10DXQNdA18Bu1ECNqScAShP92DXQNdA10DXQNdA10DXQNdA10DXQNdA10DWw+zSwNqKeAFhTRT/pGuga6BroGuga6BroGuga6BroGuga6BroGthtGlgfT08ArOuin3UNdA10DXQNdA10DXQNdA10DXQNdA10DXQN7C4NzEazQQJg36xaPz12GujzcOx033vuGuga6BroGuga6BroGuga6BroGugaOLE1MJd+gwSAap8e/vvQQP830Ac6taOpg48N+r5ooAzU/3UNdA10DXQNdA10DXQNdA2cyBrYd9G+dvEFF7WLP9lpR3Rw4cWt9edmJ7KLdNl3TgMHcN4gAWDz+W9D5TcM9LKBfm2gV3ZqO6mDVwz6ffl++sPh+NGB+r+uga6BroGuga6BroGuga6BE10DF33sM+2T53+8ffwfP9o+8e6B/rnTJ7ZDB/806HGgT//nBe1iSYAT3VC6/F0D266BAxlukAC4cKj59wM9f6DzOrWjoYMn7dfzU4fjawb64ED9X9dA10DXQNdA10DXQNdA18CJroHPfOTC9vG//0j76F99sH3s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';

  // Dữ liệu lịch sử kế hoạch bảo dưỡng nhúng trực tiếp (260 khuôn từ file gốc, tránh lỗi 403 Forbidden và chạy offline)
  const EMBEDDED_PLAN_HISTORY = {"FA06001":{"sheet":"Shot count","item":"FA06001","mold":"FA06001","cavity":"32CAV","months":{"T1":{"milestone":"800K","date":"30/01/2026"}}},"FA06002":{"sheet":"Shot count","item":"FA06002","mold":"FA06002","cavity":"32CAV","months":{"T2":{"milestone":"800K","date":"27/02/2026"},"T9":{"milestone":"800K","date":"27/09/2026"}}},"H9615S03":{"sheet":"Shot count","item":"FA06003","mold":"H9615S03","cavity":"32CAV","months":{"T4":{"milestone":"800K","date":"29/04/2026"}}},"FA06004":{"sheet":"Shot count","item":"FA06004","mold":"FA06004","cavity":"32CAV","months":{"T3":{"milestone":"800K","date":"28/03/2026"}}},"M081":{"sheet":"Shot count","item":"M081","mold":"M081","cavity":"8CAV","months":{}},"M082":{"sheet":"Shot count","item":"M082","mold":"M082","cavity":"8CAV","months":{"T10":{"milestone":"PLAN","date":"800K"}}},"M088":{"sheet":"Shot count","item":"M088","mold":"M088","cavity":"8CAV","months":{}},"M089":{"sheet":"Shot count","item":"M089","mold":"M089","cavity":"8CAV","months":{}},"YG060501":{"sheet":"Shot count","item":"YG060501","mold":"YG060501","cavity":"8CAV","months":{}},"YG08062":{"sheet":"Shot count","item":"YG08062","mold":"YG08062","cavity":"16CAV","months":{}},"YG001":{"sheet":"Shot count","item":"YG001 (03~30)","mold":"YG001","cavity":"8CAV","months":{}},"YG002":{"sheet":"Shot count","item":"YG002 (31~40)","mold":"YG002","cavity":"8CAV","months":{}},"YG08027":{"sheet":"Shot count","item":"YG08027","mold":"YG08027","cavity":"4CAV","months":{}},"M07139":{"sheet":"Shot count","item":"M07139","mold":"M07139","cavity":"16CAV","months":{}},"M00125":{"sheet":"Shot count","item":"M00125","mold":"M00125","cavity":"8CAV","months":{}},"M03059":{"sheet":"Shot count","item":"M03059","mold":"M03059","cavity":"16CAV","months":{}},"YG08031":{"sheet":"Shot count","item":"YG08031","mold":"YG08031","cavity":"8CAV","months":{}},"YG06015":{"sheet":"Shot count","item":"YG06015","mold":"YG06015","cavity":"8CAV","months":{}},"F08008":{"sheet":"Shot count","item":"F08008","mold":"F08008","cavity":"4CAV","months":{}},"IR-216":{"sheet":"Shot count","item":"IR-216-6372C","mold":"IR-216","cavity":"4CAV","months":{}},"6302B":{"sheet":"Shot count","item":"6302B","mold":"6302B","cavity":"4CAV","months":{}},"6302B-01":{"sheet":"Shot count","item":"6302B-01","mold":"6302B-01","cavity":"4CAV","months":{}},"IRSV-001":{"sheet":"Shot count","item":"IRSV-001 (6302B)","mold":"IRSV-001","cavity":"4CAV","months":{}},"IRSV-002":{"sheet":"Shot count","item":"IRSV-002 (9110/15B)","mold":"IRSV-002","cavity":"8CAV","months":{}},"IR-227":{"sheet":"Shot count","item":"IR-227-9111S","mold":"IR-227","cavity":"4CAV","months":{"T7":{"milestone":"800K","date":"24/07/2026"}}},"IR-228":{"sheet":"Shot count","item":"IR-228-9111B","mold":"IR-228","cavity":"4CAV","months":{"T1":{"milestone":"3000K","date":"12/01/2026"},"T7":{"milestone":"800K","date":"11/07/2026"}}},"YG13015":{"sheet":"Shot count","item":"YG13015 (13040B)","mold":"YG13015","cavity":"4CAV","months":{}},"M6764":{"sheet":"Shot count","item":"M6764 (9432C)","mold":"M6764","cavity":"4CAV","months":{}},"M0341":{"sheet":"Shot count","item":"M0341-9970B","mold":"M0341","cavity":"4CAV","months":{}},"M0342":{"sheet":"Shot count","item":"M0342-9971B","mold":"M0342","cavity":"4CAV","months":{}},"M0563":{"sheet":"Shot count","item":"M0563-9971B","mold":"M0563","cavity":"4CAV","months":{}},"IR-194":{"sheet":"Shot count","item":"IR-194 (9610S-4~14P)","mold":"IR-194","cavity":"8CAV","months":{}},"IR-195":{"sheet":"Shot count","item":"IR-195 (9610S-15~30P)","mold":"IR-195","cavity":"8CAV","months":{}},"IR-196":{"sheet":"Shot count","item":"IR-196 (9611S-4~14P)","mold":"IR-196","cavity":"8CAV","months":{}},"IR-197":{"sheet":"Shot count","item":"IR-197 (9611S-15~30P)","mold":"IR-197","cavity":"8CAV","months":{"T10":{"milestone":"PLAN","date":"800K"}}},"H9637S13":{"sheet":"Shot count","item":"IR-324 (9637S-6~34P)","mold":"H9637S13","cavity":"8CAV","months":{"T9":{"milestone":"800K","date":"16/09/2026"}}},"IR-325":{"sheet":"Shot count","item":"IR-325 (9637C-6~34P)","mold":"IR-325","cavity":"8CAV","months":{"T3":{"milestone":"800K","date":"26/03/2026"}}},"M0845":{"sheet":"Shot count","item":"M0845 (18005S)","mold":"M0845","cavity":"4CAV","months":{"T8":{"milestone":"800K","date":"16/08/2026"}}},"M0846":{"sheet":"Shot count","item":"M0846 (13036B)","mold":"M0846","cavity":"4CAV","months":{}},"M0850":{"sheet":"Shot count","item":"M0850 (13037B)","mold":"M0850","cavity":"4CAV","months":{}},"M0883":{"sheet":"Shot count","item":"M0883 (18011S)","mold":"M0883","cavity":"4CAV","months":{}},"IR-209":{"sheet":"Shot count","item":"IR-209 (9662S)","mold":"IR-209","cavity":"8CAV","months":{}},"M0894":{"sheet":"Shot count","item":"M0894 (18013S)","mold":"M0894","cavity":"2CAV","months":{}},"M0895":{"sheet":"Shot count","item":"M0895 (18013C)","mold":"M0895","cavity":"2CAV","months":{}},"M0899":{"sheet":"Shot count","item":"M0899 (13043B)","mold":"M0899","cavity":"2CAV","months":{"T1":{"milestone":"800K","date":"22/01/2026"}}},"M0907":{"sheet":"Shot count","item":"M0907 (18012S)","mold":"M0907","cavity":"2CAV","months":{}},"M0975":{"sheet":"Shot count","item":"M0975 (18015C)","mold":"M0975","cavity":"4CAV","months":{"T1":{"milestone":"800K","date":"25/01/2026"}}},"M0949":{"sheet":"Shot count 1","item":"M0949 (11001S)","mold":"M0949","cavity":"2CAV","months":{}},"M0950":{"sheet":"Shot count 1","item":"M0950 (11002S)","mold":"M0950","cavity":"2CAV","months":{}},"M0951":{"sheet":"Shot count 1","item":"M0951 (11001B)","mold":"M0951","cavity":"2CAV","months":{}},"M0952":{"sheet":"Shot count 1","item":"M0952 (11002B)","mold":"M0952","cavity":"2CAV","months":{}},"M0953":{"sheet":"Shot count 1","item":"M0953 (11001C)","mold":"M0953","cavity":"4CAV","months":{}},"M0954":{"sheet":"Shot count 1","item":"M0954 (11002C)","mold":"M0954","cavity":"4CAV","months":{"T1":{"milestone":"800K","date":"28/01/2026"}}},"M03030":{"sheet":"Shot count 1","item":"M03030 (9492B)","mold":"M03030","cavity":"4CAV","months":{}},"IR-022":{"sheet":"Shot count 1","item":"IR-022 (9633C)","mold":"IR-022","cavity":"8CAV","months":{}},"H9664C01":{"sheet":"Shot count 1","item":"M1147 (9664C)","mold":"H9664C01","cavity":"4CAV","months":{"T7":{"milestone":"800K","date":"27/07/2026"}}},"M1086":{"sheet":"Shot count 1","item":"M1086 (13036B-10)","mold":"M1086","cavity":"4CAV","months":{"T6":{"milestone":"800K","date":"30/06/2026"}}},"M4154":{"sheet":"Shot count 1","item":"M4154 (9209B)","mold":"M4154","cavity":"4CAV","months":{}},"M4394":{"sheet":"Shot count 1","item":"M4394 (9218B)","mold":"M4394","cavity":"4CAV","months":{}},"M0945":{"sheet":"Shot count 1","item":"M0945 (9665C-H5/6-B/C)","mold":"M0945","cavity":"8CAV","months":{}},"M0808":{"sheet":"Shot count 1","item":"M0808 (10106C-H5A)","mold":"M0808","cavity":"2CAV","months":{}},"M0807":{"sheet":"Shot count 1","item":"M0807 (10106C-H5B)","mold":"M0807","cavity":"2CAV","months":{}},"M1039":{"sheet":"Shot count 1","item":"M1039 (10109C-H5L)","mold":"M1039","cavity":"4CAV","months":{}},"M0794":{"sheet":"Shot count 1","item":"M0794 (10109C-H5G)","mold":"M0794","cavity":"4CAV","months":{}},"M111":{"sheet":"Shot count 1","item":"M111 (9224B)","mold":"M111","cavity":"4CAV","months":{}},"M112":{"sheet":"Shot count 1","item":"M112 (10109C-H5J)","mold":"M112","cavity":"4CAV","months":{}},"H9687C03":{"sheet":"Shot count 1","item":"M0946 (9687C-H6C/D)","mold":"H9687C03","cavity":"8CAV","months":{}},"M0234":{"sheet":"Shot count 1","item":"M0234 (9686C-H8B/D)","mold":"M0234","cavity":"8CAV","months":{}},"M0364":{"sheet":"Shot count 1","item":"M0364 (9686C-H8B/D)","mold":"M0364","cavity":"8CAV","months":{}},"M0233":{"sheet":"Shot count 1","item":"M0233 (9686C-H8A/C)","mold":"M0233","cavity":"8CAV","months":{}},"M0824":{"sheet":"Shot count 1","item":"M0824 (9686C-H8A/C)","mold":"M0824","cavity":"8CAV","months":{}},"M1135":{"sheet":"Shot count 1","item":"M1135 (13057B)","mold":"M1135","cavity":"4CAV","months":{}},"IRSV-003":{"sheet":"Shot count 1","item":"IRSV-003 (9615S)","mold":"IRSV-003","cavity":"16CAV","months":{"T10":{"milestone":"PLAN","date":"800K"}}},"H9615S06":{"sheet":"Shot count 1","item":"IRSV-004 (9615S)","mold":"H9615S06","cavity":"16CAV","months":{"T10":{"milestone":"PLAN","date":"800K"}}},"IRSV-005":{"sheet":"Shot count 1","item":"IRSV-005 (9637C)","mold":"IRSV-005","cavity":"8CAV","months":{"T3":{"milestone":"800K","date":"28/03/2026"}}},"IRSV-006":{"sheet":"Shot count 1","item":"IRSV-006 (9637S)","mold":"IRSV-006","cavity":"8CAV","months":{"T4":{"milestone":"800K","date":"26/04/2026"}}},"IRSV-007":{"sheet":"Shot count 1","item":"IRSV-007 (9637C)","mold":"IRSV-007","cavity":"8CAV","months":{"T2":{"milestone":"800K","date":"28/02/2026"},"T8":{"milestone":"800K","date":"11/08/2026"}}},"H9637S15":{"sheet":"Shot count 1","item":"IRSV-008 (9637S)","mold":"H9637S15","cavity":"8CAV","months":{"T3":{"milestone":"800K","date":"03/03/2026"},"T6":{"milestone":"800K","date":"25/06/2026"}}},"IRSV-009":{"sheet":"Shot count 1","item":"IRSV-009 (9637C)","mold":"IRSV-009","cavity":"8CAV","months":{"T6":{"milestone":"800K","date":"25/06/2026"}}},"IRSV-010":{"sheet":"Shot count 1","item":"IRSV-010 (9637S)","mold":"IRSV-010","cavity":"8CAV","months":{}},"M1058":{"sheet":"Shot count 1","item":"M1058 (10106B-E1C/D)","mold":"M1058","cavity":"1CAV","months":{}},"IR-378":{"sheet":"Shot count 1","item":"IR-378 (10106B-E1G/H)","mold":"IR-378","cavity":"1CAV","months":{}},"M0799":{"sheet":"Shot count 1","item":"M0799 (10106C-E1A)","mold":"M0799","cavity":"1CAV","months":{"T7":{"milestone":"800K","date":"18/07/2026"}}},"M0800":{"sheet":"Shot count 1","item":"M0800(10106B-E1E/F)","mold":"M0800","cavity":"1CAV","months":{"T7":{"milestone":"3M SHOT","date":"10/07/2026"}}},"M1078":{"sheet":"Shot count 1","item":"M1078 (10121S-E1A/B)","mold":"M1078","cavity":"2CAV","months":{}},"M1079":{"sheet":"Shot count 1","item":"M1079 (10121S-E1C/D)","mold":"M1079","cavity":"2CAV","months":{}},"ID-225":{"sheet":"Shot count 1","item":"ID-225 (13007B)","mold":"ID-225","cavity":"4CAV","months":{}},"IR-0802":{"sheet":"Shot count 1","item":"IR-0802 (9134S)","mold":"IR-0802","cavity":"2CAV","months":{}},"M1250":{"sheet":"Shot count 1","item":"M1250 (9162S)","mold":"M1250","cavity":"1CAV","months":{}},"IR-356":{"sheet":"Shot count 1","item":"IR-356 (13056B)","mold":"IR-356","cavity":"2CAV","months":{}},"M1308":{"sheet":"Shot count 1","item":"M1308 (13073B)","mold":"M1308","cavity":"4CAV","months":{"T1":{"milestone":"800K","date":"29/01/2026"}}},"M1173":{"sheet":"Shot count 1","item":"M1173 (13055B)","mold":"M1173","cavity":"4CAV","months":{}},"M12157":{"sheet":"Shot count 1","item":"M12157 (10113C)","mold":"M12157","cavity":"4CAV","months":{}},"YG09002":{"sheet":"Shot count 1","item":"YG09002 (6361B)","mold":"YG09002","cavity":"2CAV","months":{}},"MF0001":{"sheet":"Shot count 2","item":"MF0001 (18023S)","mold":"MF0001","cavity":"4CAV","months":{}},"H18023C01":{"sheet":"Shot count 2","item":"MF0002 (18023C)","mold":"H18023C01","cavity":"4CAV","months":{}},"MF0003":{"sheet":"Shot count 2","item":"MF0003 (18023E)","mold":"MF0003","cavity":"4CAV","months":{"T1":{"milestone":"800K","date":"12/01/2026"}}},"IR-371":{"sheet":"Shot count 2","item":"IR-371 (11603S-D1E)","mold":"IR-371","cavity":"8CAV","months":{"T6":{"milestone":"800K","date":"30/06/2026"}}},"M0740":{"sheet":"Shot count 2","item":"M0740 (10109C-H5D)","mold":"M0740","cavity":"4CAV","months":{}},"M0793":{"sheet":"Shot count 2","item":"M0793 (10109C-H5H)","mold":"M0793","cavity":"4CAV","months":{}},"H10109C09":{"sheet":"Shot count 2","item":"M0909 (10109C-H5K)","mold":"H10109C09","cavity":"4CAV","months":{}},"M1063":{"sheet":"Shot count 2","item":"M1063 (13051B)","mold":"M1063","cavity":"4CAV","months":{}},"M12105":{"sheet":"Shot count 2","item":"M12105 (10110C-H5C)","mold":"M12105","cavity":"4CAV","months":{}},"M1269":{"sheet":"Shot count 2","item":"M1269 (13037B-E1B)","mold":"M1269","cavity":"4CAV","months":{"T10":{"milestone":"PLAN","date":"800K"}}},"M1355":{"sheet":"Shot count 2","item":"M1355 (13075B)","mold":"M1355","cavity":"2CAV","months":{}},"IR-286":{"sheet":"Shot count 2","item":"IR-286 (9640S)","mold":"IR-286","cavity":"8CAV","months":{}},"M15001":{"sheet":"Shot count 2","item":"M15001 (9640S)","mold":"M15001","cavity":"8CAV","months":{}},"IR-9983":{"sheet":"Shot count 2","item":"IR-9983 (9983C)","mold":"IR-9983","cavity":"2CAV","months":{}},"M0289":{"sheet":"Shot count 2","item":"M0289 (9708B)","mold":"M0289","cavity":"4CAV","months":{}},"MF00488":{"sheet":"Shot count 2","item":"MF00488(10109C-H5C)","mold":"MF00488","cavity":"8CAV","months":{"T10":{"milestone":"800K","date":"24/10/2026"}}},"IR-367":{"sheet":"Shot count 2","item":"IR-367 (11502S)","mold":"IR-367","cavity":"8CAV","months":{}},"H11603S03":{"sheet":"Shot count 2","item":"IR-393 (11603S)","mold":"H11603S03","cavity":"8CAV","months":{"T6":{"milestone":"800K","date":"30/06/2026"}}},"M1446":{"sheet":"Shot count 2","item":"M1446 (9115S-E1A)","mold":"M1446","cavity":"8CAV","months":{}},"IRSV-011":{"sheet":"Shot count 2","item":"IRSV-011 (9611S)","mold":"IRSV-011","cavity":"8CAV","months":{}},"IRSV-012":{"sheet":"Shot count 2","item":"IRSV-012 (9610S)","mold":"IRSV-012","cavity":"8CAV","months":{}},"IRSV-013":{"sheet":"Shot count 2","item":"IRSV-013 (9611S)","mold":"IRSV-013","cavity":"8CAV","months":{}},"IRSV-014":{"sheet":"Shot count 2","item":"IRSV-014 (9610S)","mold":"IRSV-014","cavity":"8CAV","months":{}},"IRSV-015":{"sheet":"Shot count 2","item":"IRSV-015 (10116B)","mold":"IRSV-015","cavity":"4CAV","months":{}},"IRSV-016":{"sheet":"Shot count 2","item":"IRSV-016 (9687C)","mold":"IRSV-016","cavity":"8CAV","months":{"T9":{"milestone":"800K","date":"26/09/2026"}}},"YG09018":{"sheet":"Shot count 2","item":"YG09018 (9953B)","mold":"YG09018","cavity":"4CAV","months":{}},"M1394":{"sheet":"Shot count 2","item":"M1394 (12003S-E1A-74)","mold":"M1394","cavity":"4CAV","months":{"T1":{"milestone":"800K","date":"20/01/2026"}}},"H12003S03":{"sheet":"Shot count 2","item":"M1494 (12003S)","mold":"H12003S03","cavity":"8CAV","months":{}},"ID-163":{"sheet":"Shot count 2","item":"ID-163 (10109C-E1A/B)","mold":"ID-163","cavity":"2CAV","months":{}},"ID-264":{"sheet":"Shot count 2","item":"ID-264(13046B)","mold":"ID-264","cavity":"2CAV","months":{}},"ID-278":{"sheet":"Shot count 2","item":"ID-278(13046B)","mold":"ID-278","cavity":"2CAV","months":{}},"IR-0903":{"sheet":"Shot count 2","item":"IR-0903 (9820S)","mold":"IR-0903","cavity":"2CAV","months":{}},"IR-362":{"sheet":"Shot count 2","item":"IR-362 (11603S)","mold":"IR-362","cavity":"8CAV","months":{"T5":{"milestone":"800K","date":"11/05/2026"}}},"H12003C03":{"sheet":"Shot count 2","item":"M1393 (12003C-E1A)","mold":"H12003C03","cavity":"4CAV","months":{}},"H12003C04":{"sheet":"Shot count 2","item":"M1493 (12003C-E1A)","mold":"H12003C04","cavity":"8CAV","months":{}},"M1363":{"sheet":"Shot count 2","item":"M1363 (13042B-H5B-12)","mold":"M1363","cavity":"4CAV","months":{}},"M1616":{"sheet":"Shot count 2","item":"M1616(9685C-H6A-06)","mold":"M1616","cavity":"8CAV","months":{"T6":{"milestone":"800K","date":"10/06/2026"}}},"M1471":{"sheet":"Shot count 2","item":"M1471 (9685C-H8A-4~18)","mold":"M1471","cavity":"8CAV","months":{"T7":{"milestone":"800K","date":"30/07/2026"}}},"M1472":{"sheet":"Shot count 2","item":"M1472 (9685C-H8B-19~35)","mold":"M1472","cavity":"8CAV","months":{}},"M09098":{"sheet":"Shot count 2","item":"M09098 (9957B)","mold":"M09098","cavity":"4CAV","months":{}},"YW-001":{"sheet":"Shot count 2","item":"YW-001 (12001S)","mold":"YW-001","cavity":"8CAV","months":{}},"YW-002":{"sheet":"Shot count 2","item":"YW-002 (12001C)","mold":"YW-002","cavity":"8CAV","months":{}},"M1229":{"sheet":"Shot count 2","item":"M1229 (13066B)","mold":"M1229","cavity":"2CAV","months":{"T7":{"milestone":"800K","date":"26/07/2026"}}},"M1253":{"sheet":"Shot count 2","item":"M1253 (9178S)","mold":"M1253","cavity":"4CAV","months":{}},"M09101":{"sheet":"Shot count 2","item":"M09101 (9958B)","mold":"M09101","cavity":"2CAV","months":{}},"M1458":{"sheet":"Shot count 2","item":"M1458 (13078B)","mold":"M1458","cavity":"4CAV","months":{"T1":{"milestone":"800K","date":"29/01/2026"}}},"M1459":{"sheet":"Shot count 2","item":"M1459 (13078C)","mold":"M1459","cavity":"4CAV","months":{"T10":{"milestone":"PLAN","date":"800K"}}},"M03042":{"sheet":"Shot count 2","item":"M03042 (9199S)","mold":"M03042","cavity":"4CAV","months":{}},"M1564":{"sheet":"Shot count 2","item":"M1564 (13080B)","mold":"M1564","cavity":"2CAV","months":{}},"M1617":{"sheet":"Shot count 2","item":"M1617 (13084B)","mold":"M1617","cavity":"2CAV","months":{}},"M1618":{"sheet":"Shot count 2","item":"M1618 (13085B)","mold":"M1618","cavity":"4CAV","months":{}},"H10109C12":{"sheet":"Shot count 2","item":"M1633 (10109C-H5C)","mold":"H10109C12","cavity":"4CAV","months":{"T2":{"milestone":"800K","date":"28/02/2026"}}},"M1487":{"sheet":"Shot count 2","item":"M1487 (13036B-E1B-24)","mold":"M1487","cavity":"4CAV","months":{}},"IRSV-017":{"sheet":"Shot count 2","item":"IRSV-017 (10116B)","mold":"IRSV-017","cavity":"4CAV","months":{}},"IRSV-018":{"sheet":"Shot count 2","item":"IRSV-018 (10109C-H5G)","mold":"IRSV-018","cavity":"4CAV","months":{}},"IRSV-019":{"sheet":"Shot count 2","item":"IRSV-019 (9665C)","mold":"IRSV-019","cavity":"8CAV","months":{}},"M1603":{"sheet":"Shot count 3","item":"M1603 (10106C-E1C/D)","mold":"M1603","cavity":"2CAV","months":{"T2":{"milestone":"800K","date":"28/02/2026"},"T8":{"milestone":"800K","date":"17/08/2026"}}},"MF0009":{"sheet":"Shot count 3","item":"MF0009 (13080B-H5B-08)","mold":"MF0009","cavity":"2CAV","months":{}},"MF00028":{"sheet":"Shot count 3","item":"MF00028 (13096B)","mold":"MF00028","cavity":"2CAV","months":{}},"MX-16006":{"sheet":"Shot count 3","item":"MX-16006 (6134B)","mold":"MX-16006","cavity":"4CAV","months":{}},"M1604":{"sheet":"Shot count 3","item":"M1604(10106B-E1J/K)","mold":"M1604","cavity":"2CAV","months":{}},"M1605":{"sheet":"Shot count 3","item":"M1605(10106B-E1L/M)","mold":"M1605","cavity":"2CAV","months":{}},"M1606":{"sheet":"Shot count 3","item":"M1606(10106B-E1N/P)","mold":"M1606","cavity":"2CAV","months":{}},"MF00102":{"sheet":"Shot count 3","item":"MF00102(13077B)","mold":"MF00102","cavity":"4CAV","months":{"T2":{"milestone":"800K","date":"27/02/2026"}}},"YW003":{"sheet":"Shot count 3","item":"YW003 (11001S)","mold":"YW003","cavity":"4CAV","months":{}},"YW004":{"sheet":"Shot count 3","item":"YW004 (11002S)","mold":"YW004","cavity":"4CAV","months":{}},"YW005":{"sheet":"Shot count 3","item":"YW005 (11001B)","mold":"YW005","cavity":"4CAV","months":{}},"YW006":{"sheet":"Shot count 3","item":"YW006 (11002B)","mold":"YW006","cavity":"4CAV","months":{}},"M1033":{"sheet":"Shot count 3","item":"M1033 (9162S)","mold":"M1033","cavity":"8CAV","months":{}},"MF00197":{"sheet":"Shot count 3","item":"MF00197 (9827S)","mold":"MF00197","cavity":"4CAV","months":{}},"MF00201":{"sheet":"Shot count 3","item":"MF00201 (18006S)","mold":"MF00201","cavity":"2CAV","months":{}},"MF00196":{"sheet":"Shot count 3","item":"MF00196 (9827B)","mold":"MF00196","cavity":"4CAV","months":{}},"M00217":{"sheet":"Shot count 3","item":"M00217(9947B)","mold":"M00217","cavity":"8CAV","months":{}},"MF00300":{"sheet":"Shot count 3","item":"MF00300(18038C)","mold":"MF00300","cavity":"4CAV","months":{}},"MF00301":{"sheet":"Shot count 3","item":"MF00301(18038E)","mold":"MF00301","cavity":"4CAV","months":{}},"MF00302":{"sheet":"Shot count 3","item":"MF00302(18038S)","mold":"MF00302","cavity":"4CAV","months":{}},"IRSV-023":{"sheet":"Shot count 3","item":"IRSV-023(12003C)","mold":"IRSV-023","cavity":"4CAV","months":{"T2":{"milestone":"800K","date":"27/02/2026"}}},"H12003S04":{"sheet":"Shot count 3","item":"MF00321(12003S)","mold":"H12003S04","cavity":"4CAV","months":{"T10":{"milestone":"PLAN","date":"800K"}}},"H11603S04":{"sheet":"Shot count 3","item":"IRSV-021(11603S)","mold":"H11603S04","cavity":"8CAV","months":{"T2":{"milestone":"800K","date":"28/02/2026"},"T8":{"milestone":"3000K","date":"28/08/2026"},"T9":{"milestone":"800K","date":"21/09/2026"}}},"MF00307":{"sheet":"Shot count 3","item":"MF00307(10141S)","mold":"MF00307","cavity":"2CAV","months":{"T10":{"milestone":"800K","date":"14/10/2026"}}},"H10141C01":{"sheet":"Shot count 3","item":"MF00308(10141C)","mold":"H10141C01","cavity":"2CAV","months":{"T3":{"milestone":"800K+3000K","date":"15/03/2026"},"T9":{"milestone":"800K","date":"22/09/2026"}}},"MF00392":{"sheet":"Shot count 3","item":"MF00392(10116B-H5B)","mold":"MF00392","cavity":"4CAV","months":{}},"MF00344":{"sheet":"Shot count 3","item":"MF00344(10121S-E1G)","mold":"MF00344","cavity":"2CAV","months":{}},"MF00319":{"sheet":"Shot count 3","item":"MF00319(10110C-H5C)","mold":"MF00319","cavity":"4CAV","months":{"T5":{"milestone":"800K","date":"12/05/2026"}}},"IRSV-022":{"sheet":"Shot count 3","item":"IRSV-022(9220A)","mold":"IRSV-022","cavity":"8CAV","months":{}},"IRSV-024":{"sheet":"Shot count 3","item":"IRSV-024(9637C-H5C)","mold":"IRSV-024","cavity":"8CAV","months":{}},"IRSV-025":{"sheet":"Shot count 3","item":"IRSV-025(12003C)","mold":"IRSV-025","cavity":"8CAV","months":{}},"IRSV-026":{"sheet":"Shot count 3","item":"IRSV-026(12003S)","mold":"IRSV-026","cavity":"4CAV","months":{"T5":{"milestone":"800K","date":"30/05/2026"}}},"IRSV-027":{"sheet":"Shot count 3","item":"IRSV-027(9827B)","mold":"IRSV-027","cavity":"4CAV","months":{"T3":{"milestone":"800K","date":"29/03/2026"}}},"IRSV-028":{"sheet":"Shot count 3","item":"IRSV-028(9827S)","mold":"IRSV-028","cavity":"4CAV","months":{"T1":{"milestone":"800K","date":"17/01/2026"},"T7":{"milestone":"3000K","date":"15/07/2026"}}},"IRSV-029":{"sheet":"Shot count 3","item":"IRSV-029(9637S)","mold":"IRSV-029","cavity":"8CAV","months":{"T9":{"milestone":"800K","date":"25/09/2026"}}},"IRSV-030":{"sheet":"Shot count 3","item":"IRSV-030(10109C-H5D)","mold":"IRSV-030","cavity":"4CAV","months":{}},"IRSV-031":{"sheet":"Shot count 3","item":"IRSV-031(10109C-E1A)","mold":"IRSV-031","cavity":"2CAV","months":{}},"H10109C05":{"sheet":"Shot count 3","item":"IRSV-032(10109C-H5C)","mold":"H10109C05","cavity":"4CAV","months":{}},"IRSV-035":{"sheet":"Shot count 3","item":"IRSV-035(18013S)","mold":"IRSV-035","cavity":"4CAV","months":{}},"IRSV-036":{"sheet":"Shot count 3","item":"IRSV-036(18013C)","mold":"IRSV-036","cavity":"4CAV","months":{}},"IRSV-040":{"sheet":"Shot count 3","item":"IRSV-040(9615S)","mold":"IRSV-040","cavity":"8CAV","months":{"T2":{"milestone":"800K","date":"10/02/2026"},"T8":{"milestone":"3000K","date":"28/08/2026"},"T10":{"milestone":"800K","date":"04/10/2026"}}},"MF00298":{"sheet":"Shot count 3","item":"MF00298(10109C-E1A/B)","mold":"MF00298","cavity":"2CAV","months":{}},"MF00534":{"sheet":"Shot count 3","item":"MF00534(13077B)","mold":"MF00534","cavity":"4CAV","months":{"T5":{"milestone":"3000K","date":"31/05/2026"},"T10":{"milestone":"PLAN","date":"800K"}}},"IRSV-042":{"sheet":"Shot count 3","item":"IRSV-042(9686C)","mold":"IRSV-042","cavity":"8CAV","months":{}},"IRSV-043":{"sheet":"Shot count 3","item":"IRSV-043(9690S)","mold":"IRSV-043","cavity":"16CAV","months":{}},"IRSV-044":{"sheet":"Shot count 3","item":"IRSV-044(9690S)","mold":"IRSV-044","cavity":"16CAV","months":{}},"IRSV-047":{"sheet":"Shot count 3","item":"IRSV-047(9697C)","mold":"IRSV-047","cavity":"8CAV","months":{}},"H9827C09":{"sheet":"Shot count 3","item":"IRSV-050(9827C)","mold":"H9827C09","cavity":"8CAV","months":{"T7":{"milestone":"3000K","date":"22/07/2026"}}},"MF00560":{"sheet":"HIGH IMPACT ITEM 1 ","item":"MF00560(10109B-E1AA/B)","mold":"MF00560","cavity":"4CAV","months":{}},"MF00606":{"sheet":"Shot count 3","item":"MF00606(10128S-E1E)","mold":"MF00606","cavity":"4CAV","months":{}},"MF00776":{"sheet":"Shot count 3","item":"MF00776(10128B-E1B-60)","mold":"MF00776","cavity":"4CAV","months":{}},"MF00777":{"sheet":"Shot count 3","item":"MF00777(10128C-E1A/B-60)","mold":"MF00777","cavity":"4CAV","months":{}},"MF00778":{"sheet":"Shot count 3","item":"MF00778(10128S-E1A/F-60)","mold":"MF00778","cavity":"4CAV","months":{}},"MF00792":{"sheet":"Shot count 3","item":"MF00792(10106B-E1L/M)","mold":"MF00792","cavity":"2CAV","months":{}},"MF00805":{"sheet":"Shot count 3","item":"MF00805(10106S-E1C)","mold":"MF00805","cavity":"2CAV","months":{"T4":{"milestone":"800K","date":"14/04/2026"},"T9":{"milestone":"800K","date":"30/09/2026"}}},"MF00806":{"sheet":"Shot count 3","item":"MF00806(10106C-H5B)","mold":"MF00806","cavity":"4CAV","months":{}},"H10116B06":{"sheet":"Shot count 3","item":"MF00907(10116B-H5B-30)","mold":"H10116B06","cavity":"4CAV","months":{"T5":{"milestone":"3000K","date":"31/05/2026"}}},"MF00849":{"sheet":"Shot count 3","item":"MF00849(13080B-H5B-08)","mold":"MF00849","cavity":"4CAV","months":{"T7":{"milestone":"800K","date":"24/07/2026"}}},"MF00863":{"sheet":"Shot count 3","item":"MF00863(10106S-E1C-160)","mold":"MF00863","cavity":"4CAV","months":{}},"MF00864":{"sheet":"Shot count 3","item":"MF00864(10106C-E1*-160)","mold":"MF00864","cavity":"4CAV","months":{}},"MF00873":{"sheet":"Shot count 3","item":"MF00873(18023S-E1B-08)","mold":"MF00873","cavity":"4CAV","months":{}},"MF00874":{"sheet":"Shot count 3","item":"MF00874(18023C-E1B-08)","mold":"MF00874","cavity":"4CAV","months":{}},"MF00875":{"sheet":"Shot count 3","item":"MF00875(18023E-E1B-08)","mold":"MF00875","cavity":"4CAV","months":{}},"MF00948":{"sheet":"Shot count 3","item":"MF00948(10106B-E1l/M)","mold":"MF00948","cavity":"4CAV","months":{"T2":{"milestone":"800K","date":"28/02/2026"}}},"MF00930":{"sheet":"Shot count 3","item":"MF00930(10106B-E1J/K)","mold":"MF00930","cavity":"4CAV","months":{"T4":{"milestone":"800K","date":"19/04/2026"}}},"IR-215":{"sheet":"HIGH IMPACT ITEM 1 ","item":"IR-215-6372S","mold":"IR-215","cavity":"4CAV","months":{}},"M7467":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M7467 (9926C-A1C )","mold":"M7467","cavity":"2CAV","months":{}},"M-7054":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M-7054-9926B","mold":"M-7054","cavity":"2CAV","months":{}},"M-7154":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M-7154-9926C-A1B","mold":"M-7154","cavity":"1CAV","months":{}},"M-7056":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M-7056-9926C-A1A","mold":"M-7056","cavity":"4CAV","months":{}},"M-7448":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M-7448 (9926B)","mold":"M-7448","cavity":"2CAV","months":{}},"M-7569":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M-7569 (9926C-A1D)","mold":"M-7569","cavity":"2CAV","months":{}},"M7806":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M7806 (9926B-A1C/D)","mold":"M7806","cavity":"4CAV","months":{}},"M0900":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M0900 (13042B)","mold":"M0900","cavity":"4CAV","months":{}},"M1148":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M1148 (9664S)","mold":"M1148","cavity":"2CAV","months":{}},"M1149":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M1149 (9665S)","mold":"M1149","cavity":"2CAV","months":{"T6":{"milestone":"400K","date":"25/06/2026"}}},"ID-187":{"sheet":"HIGH IMPACT ITEM 1 ","item":"ID-187 (9687S-E1E/F/G/H)","mold":"ID-187","cavity":"8CAV","months":{}},"M0974":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M0974 (18015S)","mold":"M0974","cavity":"4CAV","months":{"T1":{"milestone":"800K","date":"29/01/2026"},"T8":{"milestone":"400K","date":"12/08/2026"}}},"M1457":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M1457 (13018B)","mold":"M1457","cavity":"4CAV","months":{}},"IR-021":{"sheet":"HIGH IMPACT ITEM 1 ","item":"IR-021 (9633S)","mold":"IR-021","cavity":"4CAV","months":{}},"IRSV-020":{"sheet":"HIGH IMPACT ITEM 1 ","item":"IRSV-020 (9687S)","mold":"IRSV-020","cavity":"8CAV","months":{}},"MF00174":{"sheet":"HIGH IMPACT ITEM 1 ","item":"MF00174(10128S-H5A)","mold":"MF00174","cavity":"4CAV","months":{}},"MF00176":{"sheet":"HIGH IMPACT ITEM 1 ","item":"MF00176 (10128B-H5B)","mold":"MF00176","cavity":"4CAV","months":{"T5":{"milestone":"3000K","date":"28/05/2026"}}},"YW001":{"sheet":"HIGH IMPACT ITEM 1 ","item":"YW001 (12001S)","mold":"YW001","cavity":"8CAV","months":{}},"ID-164":{"sheet":"HIGH IMPACT ITEM 1 ","item":"ID-164 (9709B)","mold":"ID-164","cavity":"4CAV","months":{}},"M03029":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M03029 (9492B)","mold":"M03029","cavity":"4CAV","months":{"T10":{"milestone":"Plan","date":"800k"}}},"M0798":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M0798 (10106S-E1C)","mold":"M0798","cavity":"1CAV","months":{}},"M1591":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M1591 (13086B)","mold":"M1591","cavity":"2CAV","months":{}},"M7938":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M7938 (13067B)","mold":"M7938","cavity":"4CAV","months":{}},"MF00222":{"sheet":"HIGH IMPACT ITEM 1 ","item":"MF00222 (10109S-E1B)","mold":"MF00222","cavity":"2CAV","months":{}},"H10109B18":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M1202(10109B-E1AE/AF)","mold":"H10109B18","cavity":"2CAV","months":{}},"M1663":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M1663 (10109B-E1A/B)","mold":"M1663","cavity":"2CAV","months":{}},"M1088":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M1088 (10109B-E1AC/D)","mold":"M1088","cavity":"2CAV","months":{}},"H10109B14":{"sheet":"HIGH IMPACT ITEM 1 ","item":"IRSV-033(10109B-E1L/M)","mold":"H10109B14","cavity":"2CAV","months":{"T5":{"milestone":"800K","date":"28/05/2026"}}},"IRSV-034":{"sheet":"HIGH IMPACT ITEM 1 ","item":"IRSV-034(10109B-E1AA)","mold":"IRSV-034","cavity":"2CAV","months":{}},"IRSV-037":{"sheet":"HIGH IMPACT ITEM 1 ","item":"IRSV-037(10109B-E1R/S)","mold":"IRSV-037","cavity":"2CAV","months":{"T2":{"milestone":"400K","date":"28/02/2026"},"T7":{"milestone":"3000K","date":"28/07/2026"},"T10":{"milestone":"Plan","date":"800k"}}},"IRSV-038":{"sheet":"HIGH IMPACT ITEM 1 ","item":"IRSV-038(10109S-E1E)","mold":"IRSV-038","cavity":"2CAV","months":{"T4":{"milestone":"800K","date":"16/04/2026"},"T9":{"milestone":"800K","date":"30/09/2026"}}},"IRSV-039":{"sheet":"HIGH IMPACT ITEM 1 ","item":"IRSV-039(10109S-E1F)","mold":"IRSV-039","cavity":"2CAV","months":{"T5":{"milestone":"400K","date":"14/05/2026"}}},"IRSV-041":{"sheet":"HIGH IMPACT ITEM 1 ","item":"IRSV-041(10109B-E1A/B)","mold":"IRSV-041","cavity":"2CAV","months":{"T10":{"milestone":"Plan","date":"800k"}}},"IRSV-048":{"sheet":"HIGH IMPACT ITEM 1 ","item":"IRSV-048(9697S)","mold":"IRSV-048","cavity":"8CAV","months":{}},"MF00521":{"sheet":"HIGH IMPACT ITEM 1 ","item":"MF00521(10128S-H5C)","mold":"MF00521","cavity":"4CAV","months":{"T8":{"milestone":"400K","date":"27/08/2026"}}},"H10128E01":{"sheet":"HIGH IMPACT ITEM 1 ","item":"MF00175 (10128E)","mold":"H10128E01","cavity":"4CAV","months":{"T6":{"milestone":"400K","date":"26/06/2026"}}},"H10128C01":{"sheet":"HIGH IMPACT ITEM 1 ","item":"MF00177 (10128C-H5A)","mold":"H10128C01","cavity":"4CAV","months":{"T2":{"milestone":"800K","date":"28/02/2026"}}},"H10128E02":{"sheet":"HIGH IMPACT ITEM 1 ","item":"MF00178 (10128E)","mold":"H10128E02","cavity":"4CAV","months":{"T9":{"milestone":"400K","date":"23/09/2026"}}},"M0876":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M0876(10109B-E1N)","mold":"M0876","cavity":"4CAV","months":{}},"MF00561":{"sheet":"HIGH IMPACT ITEM 1 ","item":"MF00561(10109B-E1G/H)","mold":"MF00561","cavity":"4CAV","months":{}},"H10109S15":{"sheet":"HIGH IMPACT ITEM 1 ","item":"MF00545(10109S-E1B)","mold":"H10109S15","cavity":"2CAV","months":{}},"MF00909":{"sheet":"HIGH IMPACT ITEM 1 ","item":"MF00909(10109S-E1A)","mold":"MF00909","cavity":"4CAV","months":{}},"M0229":{"sheet":"HIGH IMPACT ITEM 1 ","item":"M0229(9665S)","mold":"M0229","cavity":"8CAV","months":{"T5":{"milestone":"800K","date":"22/05/2026"}}},"H9687S06":{"sheet":"HIGH IMPACT ITEM 1 ","item":"MF00929(9687S)","mold":"H9687S06","cavity":"8CAV","months":{"T1":{"milestone":"400K","date":"29/01/2026"}}}};


  async function exportExcel() {
    const btn = document.getElementById('btnExportReport') || document.getElementById('btnExportExcel') || document.getElementById('btnExportMoldExcel');
    const oldBtnText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ Đang xuất Excel...</span>';
    }

    try {
      if (typeof ExcelJS === 'undefined') {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'js/exceljs.min.js';
          s.onload = resolve;
          s.onerror = () => {
            const s2 = document.createElement('script');
            s2.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
            s2.onload = resolve;
            s2.onerror = reject;
            document.head.append(s2);
          };
          document.head.append(s);
        });
      }

      // Nạp dữ liệu lịch sử kế hoạch bảo dưỡng từ JSON (ưu tiên nhúng trực tiếp để luôn có dữ liệu chuẩn, có fallback fetch)
      let planHistory = { ...EMBEDDED_PLAN_HISTORY };
      try {
        const planResp = await fetch('data/maintenance_plan_history.json?v=' + Date.now());
        if (planResp.ok) {
          const fetched = await planResp.json();
          planHistory = { ...planHistory, ...fetched };
        }
      } catch (e) {
        console.warn('[PLAN HISTORY FETCH WARN]', e);
      }

      const wb = new ExcelJS.Workbook();
      wb.creator = 'IRISO ELECTRONICS VIETNAM CO., LTD';
      wb.lastModifiedBy = (window.ComponentAuth?.user?.fullName || window.ComponentAuth?.user?.username || 'Iriso Engineering');
      wb.created = new Date();
      wb.modified = new Date();

      const allMolds = getAllUnifiedMolds();
      const recordsByMold = {};
      (rawData?.records || []).forEach(r => {
        if (r.moldNo) recordsByMold[r.moldNo.toUpperCase()] = r;
      });

      // Sắp xếp ưu tiên: Khuôn có số shot thực tế trong tháng (M11 / live TMS) lên trên,
      // tiếp theo là tổng số shot trong năm, các khuôn ít hoặc không có shot (vd 500410) cho xuống dưới
      const sortMoldsByActivity = (list) => {
        return [...list].sort((a, b) => {
          const infoA = getUnclosedDueInfo(a);
          const infoB = getUnclosedDueInfo(b);
          if (infoA.tier !== infoB.tier) return infoA.tier - infoB.tier;
          if (infoA.tier <= 2 && infoB.maxRatio !== infoA.maxRatio) {
            return infoB.maxRatio - infoA.maxRatio;
          }

          const histA = a.monthlyHistory || {};
          const histB = b.monthlyHistory || {};
          const liveA = recordsByMold[(a.mold || '').toUpperCase()];
          const liveB = recordsByMold[(b.mold || '').toUpperCase()];
          const liveShotsA = liveA ? (Number(liveA.todayShots || 0) + Number(liveA.yesterdayShots || 0)) : 0;
          const liveShotsB = liveB ? (Number(liveB.todayShots || 0) + Number(liveB.yesterdayShots || 0)) : 0;
          const m11A = Math.round((histA.M11 || 0) + liveShotsA);
          const m11B = Math.round((histB.M11 || 0) + liveShotsB);

          let yearA = 0, yearB = 0;
          for (let i = 1; i <= 12; i++) {
            yearA += (i === 11 ? m11A : Math.round(histA['M' + i] || 0));
            yearB += (i === 11 ? m11B : Math.round(histB['M' + i] || 0));
          }

          // 1. Ưu tiên khuôn có phát sinh shot thực tế trong tháng hiện tại (M11 / live)
          const hasCurrentA = m11A > 0 ? 1 : 0;
          const hasCurrentB = m11B > 0 ? 1 : 0;
          if (hasCurrentA !== hasCurrentB) return hasCurrentB - hasCurrentA;
          if (hasCurrentA && hasCurrentB && m11A !== m11B) return m11B - m11A;

          // 2. Ưu tiên khuôn có tổng shot thực tế phát sinh trong các tháng năm 2026
          const hasYearA = yearA > 0 ? 1 : 0;
          const hasYearB = yearB > 0 ? 1 : 0;
          if (hasYearA !== hasYearB) return hasYearB - hasYearA;
          if (yearA !== yearB) return yearB - yearA;

          // 3. Ưu tiên khuôn có tổng shot lũy kế / vòng đời > 0
          const lifeA = Number(a.totalLife || a.totalYear || 0);
          const lifeB = Number(b.totalLife || b.totalYear || 0);
          if (lifeA !== lifeB) return lifeB - lifeA;

          // 4. Các khuôn không có số shot nào (như 500410) sắp xếp theo mã khuôn
          return (a.mold || '').localeCompare(b.mold || '');
        });
      };

      const standardMolds = sortMoldsByActivity(allMolds.filter(m => !m.isHighImpact));
      const highImpactMolds = sortMoldsByActivity(allMolds.filter(m => !!m.isHighImpact));

      // Logo IRISO chính hãng dạng Base64 nhúng trực tiếp
      const IRISO_LOGO_BASE64 = "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";
      let logoImageId = null;
      try {
        logoImageId = wb.addImage({
          base64: IRISO_LOGO_BASE64,
          extension: 'jpeg'
        });
      } catch (e) {}

      function buildUnifiedSheet(ws, sheetTitle, isHighImpact, moldsList) {
        ws.views = [{ showGridLines: true }];
        ws.pageSetup = {
          orientation: 'landscape',
          paperSize: 8, // A3 Landscape chuẩn ISO template
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          margins: { left: 0.4, right: 0.4, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
          horizontalCentered: true
        };
        const maxShot = '800K';

        // Độ rộng cột chuẩn 100% theo template gốc MMFD-I-F-022.01
        ws.getColumn(1).width = 30; // Col A: Mold Name/Series
        ws.getColumn(2).width = 18; // Col B: Mold Name
        ws.getColumn(3).width = 16; // Col C: Total Shot Last Year (Hiển thị)
        ws.getColumn(3).hidden = false;
        ws.getColumn(4).width = 14; // Col D: Last Year Remaining (Hiển thị)
        ws.getColumn(4).hidden = false;

        for (let col = 5; col <= 16; col++) {
          ws.getColumn(col).width = 13.5; // Col E-P: Jan to Dec
        }
        for (let col = 17; col <= 21; col++) {
          ws.getColumn(col).width = 15; // Col Q-U: Milestones (Vàng chanh)
        }
        ws.getColumn(22).width = 18; // Col V: Total Shot Monitor (Xanh dương nhạt)

        // Nhúng Logo IRISO góc phải trên cùng
        if (logoImageId !== null) {
          try {
            ws.addImage(logoImageId, {
              tl: { col: 17.5, row: 0.15 },
              ext: { width: 230, height: 42 }
            });
          } catch (e) {}
        }

        // 1. Tiêu đề Form ISO (A1:P1 cho Tiêu đề, Q1:V1 cho Tên Công Ty & Logo)
        ws.mergeCells('A1:P1');
        const t1 = ws.getCell('A1');
        const isoTitle = isHighImpact ? 'HIGH IMPACT MOLD DIE NUMBER OF SHOTS RECORD\n' : 'MOLD DIE NUMBER OF SHOTS RECORD\n';
        t1.value = {
          richText: [
            { font: { bold: true, size: 15, name: 'Arial', color: { argb: 'FF000000' } }, text: isoTitle },
            { font: { bold: true, italic: true, size: 12, name: 'Arial', color: { argb: 'FF1E293B' } }, text: 'Báo Cáo Kiểm Soát Số Shot Của Khuôn\n' },
            { font: { bold: false, size: 9.5, name: 'Arial', color: { argb: 'FF475569' } }, text: '( MMFD-I-F-022.01 )' }
          ]
        };
        t1.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        t1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        ws.mergeCells('Q1:V1');
        const cLogoCell = ws.getCell('Q1');
        cLogoCell.value = 'IRISO ELECTRONICS VIETNAM CO., LTD\n';
        cLogoCell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
        cLogoCell.alignment = { horizontal: 'right', vertical: 'bottom', wrapText: true };
        cLogoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        ws.getRow(1).height = 68;

        // 2. Banner "Total Shot Count Management" (A2:V3 gộp 2 dòng với nền xanh lá nhạt #C6EFCE và chữ đỏ tươi đậm)
        ws.mergeCells('A2:V3');
        const t2 = ws.getCell('A2');
        t2.value = ` Total Shot Count Management ( Maximum of  ${maxShot} shot ) / Tổng số shot cần kiểm tra ( Nhiều nhất của ${maxShot}  shot ) `;
        t2.font = { name: 'Arial', size: 11.5, bold: true, color: { argb: 'FFC00000' } };
        t2.alignment = { horizontal: 'center', vertical: 'middle' };
        t2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
        ws.getRow(2).height = 18;
        ws.getRow(3).height = 18;

        // 3. Headers Bảng 1 (Dòng 4 & Dòng 5)
        ws.mergeCells('A4:A5');
        const hA = ws.getCell('A4');
        hA.value = 'Mold Name/Series\r\n\r\nTên Khuôn/Tên hàng';
        hA.font = { name: 'Arial', size: 10, bold: true };
        hA.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        hA.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        ws.mergeCells('B4:B5');
        const hB = ws.getCell('B4');
        hB.value = 'Mold Name';
        hB.font = { name: 'Arial', size: 10, bold: true };
        hB.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        hB.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        // C4:C5 gộp: Total Shot Last Year / Số shot còn lại
        ws.mergeCells('C4:C5');
        const hC = ws.getCell('C4');
        hC.value = 'Total Shot\r\nLast Year\r\n\r\nSố shot còn lại';
        hC.font = { name: 'Arial', size: 9.5, bold: true };
        hC.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        hC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        // D4: Last Year / Năm trước
        const hD4 = ws.getCell('D4');
        hD4.value = 'Last Year\r\nNăm trước';
        hD4.font = { name: 'Arial', size: 9.5, bold: true };
        hD4.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        hD4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        // D5: 800K (hoặc 400K) chữ ĐỎ TƯƠI ĐẬM
        const hD5 = ws.getCell('D5');
        hD5.value = maxShot;
        hD5.font = { name: 'Arial', size: 10.5, bold: true, color: { argb: 'FFFF0000' } };
        hD5.alignment = { horizontal: 'center', vertical: 'middle' };
        hD5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        // Nhóm 12 tháng E4:P4
        ws.mergeCells('E4:P4');
        const hM = ws.getCell('E4');
        hM.value = 'SHOT COUNT MONITOR PER MONTH\r\nSố shot kiểm soát theo tháng';
        hM.font = { name: 'Arial', size: 10.5, bold: true };
        hM.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        hM.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        const monthNames = ['Jan-26', 'Feb-26', 'Mar-26', 'Apr-26', 'May-26', 'Jun-26', 'Jul-26', 'Aug-26', 'Sep-26', 'Oct-26', 'Nov-26', 'Dec-26'];
        for (let m = 1; m <= 12; m++) {
          const colLetter = String.fromCharCode(68 + m);
          const c = ws.getCell(colLetter + '5');
          c.value = monthNames[m - 1];
          c.font = { name: 'Arial', size: 10, bold: true };
          c.alignment = { horizontal: 'center', vertical: 'middle' };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        }

        // Cột Mốc Q to U (NỀN VÀNG CHUẨN #FFFF00, CHỮ ĐEN ĐẬM CHUẨN MẪU (800K)-1 .. (800K)-5)
        const milestoneHeaders = ['(800K)-1', '(800K)-2', '(800K)-3', '(800K)-4', '(800K)-5'];

        ['Q', 'R', 'S', 'T', 'U'].forEach((col, idx) => {
          const c4 = ws.getCell(col + '4');
          c4.value = 'Shot Monitor\r\nSố lượng shot';
          c4.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF000000' } };
          c4.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          c4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };

          const c5 = ws.getCell(col + '5');
          c5.value = milestoneHeaders[idx];
          c5.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF000000' } };
          c5.alignment = { horizontal: 'center', vertical: 'middle' };
          c5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        });

        // Cột Tổng V4:V5 (NỀN XANH DƯƠNG NHẠT #BDD7EE)
        ws.mergeCells('V4:V5');
        const hV = ws.getCell('V4');
        hV.value = 'Total Shot  Monitor\r\nTổng số shot ';
        hV.font = { name: 'Arial', size: 10.5, bold: true, color: { argb: 'FF1E3A8A' } };
        hV.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        hV.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } };

        ws.getRow(4).height = 26;
        ws.getRow(5).height = 24;

        // Kẻ viền cho tiêu đề Bảng 1
        for (let r = 4; r <= 5; r++) {
          const row = ws.getRow(r);
          for (let c = 1; c <= 22; c++) {
            row.getCell(c).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
          }
        }

        // Định dạng số chuẩn Accounting template: 0 hiển thị dấu gạch ngang "-"
        const numAccountingFmt = '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)';

        let curRow = 6;
        moldsList.forEach(m => {
          const row = ws.getRow(curRow);
          row.height = 20;
          const hist = m.monthlyHistory || {};

          const liveRec = recordsByMold[(m.mold || '').toUpperCase()];
          const liveShots = liveRec ? (Number(liveRec.todayShots || 0) + Number(liveRec.yesterdayShots || 0)) : 0;
          const m11Val = Math.round((hist.M11 || 0) + (liveShots > 0 ? liveShots : 0));

          let colAVal = '';
          const cleanSeries = (m.series || '').replace(/-\*\*$/, '').trim();
          if (m.oldMold && m.oldMold !== '-') {
            if (m.oldMold.includes('(')) {
              colAVal = m.oldMold;
            } else if (cleanSeries && cleanSeries !== '-') {
              const strippedSeries = cleanSeries.replace(/^\(+|\)+$/g, '').trim();
              colAVal = strippedSeries ? `${m.oldMold} (${strippedSeries})` : m.oldMold;
            } else {
              colAVal = m.oldMold;
            }
          } else {
            colAVal = cleanSeries || m.mold;
          }

          const sumMonths = [hist.M1, hist.M2, hist.M3, hist.M4, hist.M5, hist.M6, hist.M7, hist.M8, hist.M9, hist.M10, m11Val, hist.M12]
            .reduce((a, b) => a + (Number(b) || 0), 0);
          const cVal = (m.totalShotLastYear !== undefined && m.totalShotLastYear !== null && m.totalShotLastYear !== '')
            ? Number(m.totalShotLastYear)
            : Math.max(0, Number(m.totalLife || m.total_life || 0) - sumMonths);
          const totalLifeAccum = Math.round(cVal + sumMonths);

          row.getCell('A').value = colAVal;
          row.getCell('B').value = m.mold;
          row.getCell('C').value = Math.round(cVal);
          row.getCell('D').value = Math.round(Number(m.lastYearRemaining || 0));

          // 12 Tháng: gán số nguyên, numFmt sẽ tự động render 0 thành "-"
          row.getCell('E').value = Math.round(hist.M1 || 0);
          row.getCell('F').value = Math.round(hist.M2 || 0);
          row.getCell('G').value = Math.round(hist.M3 || 0);
          row.getCell('H').value = Math.round(hist.M4 || 0);
          row.getCell('I').value = Math.round(hist.M5 || 0);
          row.getCell('J').value = Math.round(hist.M6 || 0);
          row.getCell('K').value = Math.round(hist.M7 || 0);
          row.getCell('L').value = Math.round(hist.M8 || 0);
          row.getCell('M').value = Math.round(hist.M9 || 0);
          row.getCell('N').value = Math.round(hist.M10 || 0);
          row.getCell('O').value = m11Val;
          row.getCell('P').value = Math.round(hist.M12 || 0);

          // 5 Cột Mốc Q đến U
          const mValues = [
            Math.round(m.m1_800k || m.m1 || 0),
            Math.round(m.m2_800k || m.m2 || 0),
            Math.round(m.m3_800k || m.m3 || 0),
            Math.round(m.m4_800k || m.m4 || 0),
            Math.round(m.m5_800k || m.m5 || 0)
          ];

          const closed = m.closedMilestones || [];
          ['Q', 'R', 'S', 'T', 'U'].forEach((col, idx) => {
            const val = mValues[idx];
            const cell = row.getCell(col);
            const mNum = idx + 1;
            const isDone = closed.includes(mNum);

            if (val > 0) {
              cell.value = val;
              // Highlight màu chuẩn theo Legend: Vàng 750k-800K, Đỏ OVER - 800K, Cam 350k-400K, Tím 2900-3000K
              let cellFill = null;
              let fontColor = 'FF000000';
              if (isHighImpact) {
                if (val >= 2900000) {
                  cellFill = 'FFD8B4FE';
                } else if (val >= 750000) {
                  cellFill = 'FFFFFF00';
                } else if (val >= 350000) {
                  cellFill = 'FFFFC000';
                }
              } else {
                if (val >= 2900000) {
                  cellFill = 'FFD8B4FE';
                } else if (val > 800000) {
                  cellFill = 'FFFF0000';
                  fontColor = 'FFFFFFFF';
                } else if (val >= 750000) {
                  cellFill = 'FFFFFF00';
                }
              }
              if (cellFill) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cellFill } };
              }
              cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: fontColor } };

              if (isDone) {
                const detail = getMilestoneDetail(m.mold, mNum);
                const noteText = detail ? `${maxShot}\n${detail.date || ''}\nKTV: ${detail.tech || ''}\n${detail.note || ''}` : `${maxShot}\nĐã bảo dưỡng`;
                cell.note = {
                  texts: [{ font: { bold: true, size: 10, name: 'Calibri' }, text: noteText }]
                };
              }
            } else {
              cell.value = null; // để trống cho sạch như template
            }
          });

          // Total Shot Monitor (V) - Tổng vòng đời khuôn các năm
          row.getCell('V').value = { formula: `SUM(E${curRow}:P${curRow})+C${curRow}`, result: totalLifeAccum };

          row.eachCell({ includeEmpty: true }, (cell, colNum) => {
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
              bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
              left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
              right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
            };
            if (colNum === 1) {
              cell.alignment = { horizontal: 'left', vertical: 'middle' };
              cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
            } else if (colNum === 2) {
              cell.alignment = { horizontal: 'center', vertical: 'middle' };
              cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
            } else if (colNum === 3) {
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
              cell.font = { name: 'Arial', size: 9.5, color: { argb: 'FF0F172A' } };
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
              cell.numFmt = numAccountingFmt;
            } else if (colNum === 4) {
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
              cell.font = { name: 'Arial', size: 9.5, color: { argb: 'FF0F172A' } };
              cell.numFmt = numAccountingFmt;
            } else if (colNum === 22) {
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
              cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
              cell.numFmt = numAccountingFmt;
            } else {
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
              cell.numFmt = numAccountingFmt;
              if (!cell.font) cell.font = { name: 'Arial', size: 9.5 };
            }
          });

          curRow++;
        });

        // Bật AutoFilter trên toàn bộ bảng 1 (từ dòng 5 đến dòng cuối của bảng 1)
        ws.autoFilter = `A5:V${curRow - 1}`;

        // Chừa 1 dòng trống trước dòng Legend (giống hệt template)
        curRow += 1;
        const legRow = curRow;
        ws.getRow(legRow).height = 26;

        // Thiết lập viền chuẩn cho toàn bộ dòng Legend
        for (let c = 1; c <= 22; c++) {
          ws.getRow(legRow).getCell(c).border = {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'medium', color: { argb: 'FF000000' } },
            left: c === 1 ? { style: 'medium', color: { argb: 'FF000000' } } : undefined,
            right: c === 22 ? { style: 'medium', color: { argb: 'FF000000' } } : undefined
          };
        }

        // Chữ chú thích bên trái (Cột A đến I)
        ws.mergeCells(`A${legRow}:I${legRow}`);
        const noteCell = ws.getCell(`A${legRow}`);
        noteCell.value = 'Note : Safety limits to automatic machines will alarm .\r\nChú Ý : Giới hạn an toàn để máy tự động thông tin .';
        noteCell.font = { name: 'Arial', size: 9.5, italic: true, bold: true, color: { argb: 'FF000000' } };
        noteCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

        // Nhúng ảnh Legend dạng PNG nổi chuẩn 100% khớp ảnh người dùng cung cấp (Cột J đến S)
        try {
          const legImgBase64 = isHighImpact ? LEGEND_PNG_BASE64 : STD_LEGEND_PNG_BASE64;
          const legendImgId = wb.addImage({
            base64: legImgBase64,
            extension: 'png'
          });
          ws.addImage(legendImgId, {
            tl: { col: 9.1, row: (legRow - 1) + 0.15 },
            br: { col: 19.0, row: (legRow - 1) + 0.85 },
            editAs: 'oneCell'
          });
        } catch (imgErr) {
          console.warn('Lỗi chèn ảnh Legend PNG:', imgErr);
        }

        curRow = legRow + 2;

        // Thêm ngắt trang chuẩn (Page Break) để Bảng 1 nằm trọn Page 1, Bảng 2 nằm trọn Page 2
        try {
          ws.getRow(curRow - 1).addPageBreak();
        } catch (e) {
          console.warn('Page break error:', e);
        }

        // ============================================================================
        // BẢNG 2: MAINTENANCE PLAN PER MOLD / Kế Hoạch Bảo Dưỡng (Chuẩn 100% KẾ HOẠCH BẢO DƯỠNG.PDF)
        // ============================================================================
        ws.mergeCells(`A${curRow}:A${curRow + 1}`);
        const hT2Item = ws.getCell(`A${curRow}`);
        hT2Item.value = 'Item Name\r\nTên Sản Phẩm';
        hT2Item.font = { name: 'Arial', size: 10, bold: true };
        hT2Item.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        hT2Item.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FFFF' } }; // CYAN CHUẨN

        // Cột B đến D gộp lại cho Mold Name & Cav (khớp cột B, C, D của Bảng 1)
        ws.mergeCells(`B${curRow}:D${curRow + 1}`);
        const hT2Mold = ws.getCell(`B${curRow}`);
        hT2Mold.value = 'Mold Name & Cav\r\nTên Khuôn/Cavity';
        hT2Mold.font = { name: 'Arial', size: 10, bold: true };
        hT2Mold.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        hT2Mold.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FFFF' } };

        // Cột E đến V: Tiêu đề bảng kế hoạch bảo dưỡng (hàng trên)
        ws.mergeCells(`E${curRow}:V${curRow}`);
        const hT2Plan = ws.getCell(`E${curRow}`);
        hT2Plan.value = 'MAINTENANCE PLAN PER MOLD / Kế Hoạch Bảo Dưỡng';
        hT2Plan.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0F172A' } };
        hT2Plan.alignment = { horizontal: 'center', vertical: 'middle' };
        hT2Plan.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FFFF' } };

        ws.getRow(curRow).height = 24;
        ws.getRow(curRow + 1).height = 22;

        // 12 Tháng: từ Cột E đến P (thẳng hàng chuẩn 100% với 12 tháng của Bảng 1 ở trên!)
        for (let m = 1; m <= 12; m++) {
          const colL = String.fromCharCode(68 + m); // E to P
          const c = ws.getCell(`${colL}${curRow + 1}`);
          c.value = monthNames[m - 1];
          c.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1E40AF' } };
          c.alignment = { horizontal: 'center', vertical: 'middle' };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: m % 2 === 1 ? 'FFE0F2FE' : 'FFCCFFFF' } };
        }

        // Cột Q đến V: Remark (hàng 2)
        ws.mergeCells(`Q${curRow + 1}:V${curRow + 1}`);
        const hT2Remark = ws.getCell(`Q${curRow + 1}`);
        hT2Remark.value = 'Remark';
        hT2Remark.font = { name: 'Arial', size: 10, bold: true };
        hT2Remark.alignment = { horizontal: 'center', vertical: 'middle' };
        hT2Remark.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FFFF' } };

        // Đóng viền mỏng toàn bộ ô header Bảng 2
        for (let r = curRow; r <= curRow + 1; r++) {
          for (let c = 1; c <= 22; c++) {
            ws.getRow(r).getCell(c).border = {
              top: { style: 'thin', color: { argb: 'FF94A3B8' } },
              bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
              left: { style: 'thin', color: { argb: 'FF94A3B8' } },
              right: { style: 'thin', color: { argb: 'FF94A3B8' } }
            };
          }
        }

        curRow += 2;
        const t2DataStart = curRow;

        // Nhúng 3 dấu kiểm soát (CONTROL STAMPS) chuẩn vào khu vực Remark của Bảng 2
        try {
          const stampsImgId = wb.addImage({
            base64: CONTROL_STAMPS_BASE64,
            extension: 'png'
          });
          ws.addImage(stampsImgId, {
            tl: { col: 16.3, row: (t2DataStart - 1) + 0.5 },
            br: { col: 21.7, row: (t2DataStart - 1) + 12.5 },
            editAs: 'oneCell'
          });
        } catch (stampErr) {
          console.warn('Lỗi chèn 3 dấu control vào Remark:', stampErr);
        }

        const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        function formatDisplayDate(val) {
          if (!val) return '';
          if (val === '800K' || val === '400K' || val === '3000K' || val === 'PLAN') return val;
          if (typeof val === 'number') {
            const utc_days = Math.floor(val - 25569);
            const d = new Date(utc_days * 86400 * 1000);
            return d.getDate() + '-' + monthNamesShort[d.getMonth()];
          }
          const str = String(val).trim();
          if (str.includes('-')) {
            const parts = str.split('-');
            if (parts.length === 3) {
              const day = parseInt(parts[2], 10);
              const m = parseInt(parts[1], 10) - 1;
              if (m >= 0 && m < 12) return day + '-' + monthNamesShort[m];
            }
          }
          if (str.includes('/')) {
            const parts = str.split('/');
            if (parts.length >= 2) {
              const day = parseInt(parts[0], 10);
              const m = parseInt(parts[1], 10) - 1;
              if (m >= 0 && m < 12) return day + '-' + monthNamesShort[m];
            }
          }
          return str;
        }

        // Đổ danh sách kế hoạch bảo dưỡng (mỗi khuôn 2 dòng: Dòng 1 Mốc/Shot, Dòng 2 Ngày)
        moldsList.forEach(m => {
          const moldCode = (m.mold || '').toUpperCase().trim();
          const oldCode = (m.oldMold && m.oldMold !== '-') ? m.oldMold.toUpperCase().trim() : '';
          const newCode = (m.newMold && m.newMold !== '-') ? m.newMold.toUpperCase().trim() : '';
          
          let planItem = {};
          if (oldCode && planHistory[oldCode]) planItem = planHistory[oldCode];
          else if (moldCode && planHistory[moldCode]) planItem = planHistory[moldCode];
          else if (newCode && planHistory[newCode]) planItem = planHistory[newCode];
          else {
            const sMatch = (m.series || '').match(/^([^(]+)/);
            if (sMatch && planHistory[sMatch[1].trim().toUpperCase()]) {
              planItem = planHistory[sMatch[1].trim().toUpperCase()];
            }
          }

          let colAVal = '';
          const cleanSeries = (m.series || '').replace(/-\**$/, '').trim();
          if (m.oldMold && m.oldMold !== '-') {
            if (m.oldMold.includes('(')) {
              colAVal = m.oldMold;
            } else if (cleanSeries && cleanSeries !== '-') {
              const strippedSeries = cleanSeries.replace(/^\(+|\)+$/g, '').trim();
              colAVal = strippedSeries ? `${m.oldMold} (${strippedSeries})` : m.oldMold;
            } else {
              colAVal = m.oldMold;
            }
          } else {
            colAVal = cleanSeries || m.mold;
          }

          const r1 = ws.getRow(curRow);
          const r2 = ws.getRow(curRow + 1);
          r1.height = 18;
          r2.height = 18;

          // Cột A: Tên sản phẩm / Item Name (gộp 2 dòng, chữ đỏ đậm như PDF mẫu)
          ws.mergeCells(`A${curRow}:A${curRow + 1}`);
          const cItem = ws.getCell(`A${curRow}`);
          cItem.value = planItem.item || colAVal;
          cItem.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFCC0000' } };
          cItem.alignment = { horizontal: 'center', vertical: 'middle' };

          // Cột B-D: Dòng 1 Tên khuôn, Dòng 2 Cavity
          ws.mergeCells(`B${curRow}:D${curRow}`);
          const cMold = ws.getCell(`B${curRow}`);
          cMold.value = planItem.mold || ((m.oldMold && m.oldMold !== '-') ? m.oldMold : m.mold);
          cMold.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF000000' } };
          cMold.alignment = { horizontal: 'center', vertical: 'middle' };

          ws.mergeCells(`B${curRow + 1}:D${curRow + 1}`);
          const cCav = ws.getCell(`B${curRow + 1}`);
          const cavStr = planItem.cavity || (m.cavity ? (String(m.cavity).toUpperCase().includes('CAV') ? m.cavity : m.cavity + 'CAV') : '4CAV');
          cCav.value = cavStr;
          cCav.font = { name: 'Arial', size: 9, bold: false, color: { argb: 'FF000000' } };
          cCav.alignment = { horizontal: 'center', vertical: 'middle' };

          // Tháng 1 đến 12 (Cột E đến P)
          for (let mIdx = 1; mIdx <= 12; mIdx++) {
            const colLetter = String.fromCharCode(68 + mIdx); // E to P
            const mKey = 'T' + mIdx;
            const cellShot = r1.getCell(colLetter);
            const cellDate = r2.getCell(colLetter);

            let milestoneVal = '';
            let dateVal = '';

            // 1. Dữ liệu lịch sử từ file Excel gốc (những lần đã bảo dưỡng trong file gốc)
            if (planItem && planItem.months && planItem.months[mKey]) {
              milestoneVal = planItem.months[mKey].milestone || '';
              dateVal = planItem.months[mKey].date || '';
            }

            // 2. Dữ liệu chốt mốc bảo dưỡng THỰC TẾ trên Web (CHỈ lấy khi KTV thực sự chốt trên web có ngày cụ thể)
            const detailsMap = getMilestoneDetailsMap();
            const moldDetails = (oldCode && detailsMap[oldCode]) ? detailsMap[oldCode] : detailsMap[moldCode];
            if (moldDetails) {
              Object.keys(moldDetails).forEach(mNumStr => {
                const detail = moldDetails[mNumStr];
                if (detail && detail.date) {
                  let mMonth = 0;
                  const dStr = String(detail.date).trim();
                  if (dStr.includes('-')) {
                    const parts = dStr.split('-');
                    if (parts.length >= 2) mMonth = parseInt(parts[1], 10);
                  } else if (dStr.includes('/')) {
                    const parts = dStr.split('/');
                    if (parts.length >= 2) mMonth = parseInt(parts[1], 10);
                  }
                  if (mMonth === mIdx) {
                    const mNum = parseInt(mNumStr, 10);
                    milestoneVal = mNum >= 6 ? '3000K' : (isHighImpact ? '400K' : '800K');
                    dateVal = dStr;
                  }
                }
              });
            }

            // Định dạng hiển thị ngày chuẩn d-mmm (VD: 28-Jan, 25-Jun, 3-Nov)
            const dispDate = formatDisplayDate(dateVal);

            if (milestoneVal) {
              cellShot.value = milestoneVal;
              cellShot.alignment = { horizontal: 'center', vertical: 'middle' };
              cellShot.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF000000' } };

              // Tô màu nền hoàn thành khớp 100% Chú giải (Legend) ở cuối trang
              let fillColor = 'FFFFFF00'; // Vàng FINISH 800K
              if (milestoneVal.includes('400K')) fillColor = 'FFFFC000'; // Cam vàng FINISH 400K
              else if (milestoneVal.includes('3000K')) fillColor = 'FFD8B4FE'; // Tím FINISH 3000K
              else if (milestoneVal.includes('PLAN')) fillColor = 'FFFFE699'; // Cam nhạt PLAN

              cellShot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
            }

            if (dispDate) {
              cellDate.value = dispDate;
              cellDate.alignment = { horizontal: 'center', vertical: 'middle' };
              cellDate.font = { name: 'Arial', size: 8.5, bold: true, color: { argb: 'FF000000' } };

              let fillColor = 'FFFFFF00';
              if (milestoneVal.includes('400K')) fillColor = 'FFFFC000';
              else if (milestoneVal.includes('3000K')) fillColor = 'FFD8B4FE';
              else if (milestoneVal.includes('PLAN')) fillColor = 'FFFFE699';

              cellDate.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
            }
          }

          // Cột Q đến V: Remark (gộp 2 dòng)
          ws.mergeCells(`Q${curRow}:V${curRow + 1}`);
          const cRemark = ws.getCell(`Q${curRow}`);
          cRemark.value = m.note || planItem?.note || '';
          cRemark.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
          cRemark.font = { name: 'Arial', size: 9 };

          // Border: Đường nét đứt (dotted) ở giữa dòng 1 và dòng 2, viền nét liền mỏng bao quanh
          for (let c = 1; c <= 22; c++) {
            r1.getCell(c).border = {
              top: { style: 'thin', color: { argb: 'FF94A3B8' } },
              left: { style: 'thin', color: { argb: 'FF94A3B8' } },
              right: { style: 'thin', color: { argb: 'FF94A3B8' } },
              bottom: { style: 'dotted', color: { argb: 'FF94A3B8' } }
            };
            r2.getCell(c).border = {
              top: { style: 'dotted', color: { argb: 'FF94A3B8' } },
              left: { style: 'thin', color: { argb: 'FF94A3B8' } },
              right: { style: 'thin', color: { argb: 'FF94A3B8' } },
              bottom: { style: 'thin', color: { argb: 'FF94A3B8' } }
            };
          }

          curRow += 2;
        });

        curRow += 2;

        // ============================================================================
        // FOOTER: CHÚ Ý & KHỐI BẢNG CHÚ GIẢI (LEGEND) CHUẨN 100% PDF VÀ TEMPLATE
        // ============================================================================
        const noteRow = curRow;
        ws.mergeCells(`A${noteRow}:F${noteRow + 1}`);
        const fNote = ws.getCell(`A${noteRow}`);
        fNote.value = 'Note : Information of Schedule and result of maintenance .\r\nChú Ý : Thông tin về kế hoạch và kết quả bảo dưỡng.';
        fNote.font = { name: 'Arial', size: 9.5, italic: true, bold: true, color: { argb: 'FF1E293B' } };
        fNote.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        ws.getRow(noteRow).height = 20;
        ws.getRow(noteRow + 1).height = 20;

// Đóng viền khối chú giải và chèn ảnh Legend PNG nổi cạnh Note (Cột G đến R)
        for (let r = noteRow; r <= noteRow + 1; r++) {
          for (let c = 1; c <= 18; c++) {
            ws.getRow(r).getCell(c).border = {
              top: { style: 'thin', color: { argb: 'FF94A3B8' } },
              bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
              left: { style: 'thin', color: { argb: 'FF94A3B8' } },
              right: { style: 'thin', color: { argb: 'FF94A3B8' } }
            };
          }
        }

        // Nhúng ảnh Legend Bảng 2 dạng PNG nổi cạnh mục Note
        try {
          const t2LegImgId = wb.addImage({
            base64: T2_LEGEND_PNG_BASE64,
            extension: 'png'
          });
          ws.addImage(t2LegImgId, {
            tl: { col: 6.2, row: (noteRow - 1) + 0.3 },
            br: { col: 18.0, row: (noteRow - 1) + 1.7 },
            editAs: 'oneCell'
          });
        } catch (imgErr) {
          console.warn('Lỗi chèn ảnh Legend Table 2:', imgErr);
        }

        curRow = noteRow + 3;

        // ============================================================================
        // BẢNG REVISION & CHỮ KÝ PHÊ DUYỆT (REV BOX & SIGNATURES CHUẨN 100% PDF)
        // ============================================================================
        ws.mergeCells(`A${curRow}:C${curRow}`);
        ws.getCell(`A${curRow}`).value = 'Rev.No';
        ws.mergeCells(`D${curRow}:G${curRow}`);
        ws.getCell(`D${curRow}`).value = 'Issue Date';
        ws.mergeCells(`H${curRow}:R${curRow}`);
        ws.getCell(`H${curRow}`).value = 'Details';
        ws.mergeCells(`S${curRow}:T${curRow}`);
        ws.getCell(`S${curRow}`).value = 'Operator by';
        ws.mergeCells(`U${curRow}:V${curRow}`);
        ws.getCell(`U${curRow}`).value = 'Check by';

        const revHRow = ws.getRow(curRow);
        revHRow.height = 20;
        ['A', 'D', 'H', 'S', 'U'].forEach(col => {
          const c = revHRow.getCell(col);
          c.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
          c.alignment = { horizontal: 'center', vertical: 'middle' };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        });

        // Hàng revision 0
        ws.mergeCells(`A${curRow + 1}:C${curRow + 1}`);
        ws.getCell(`A${curRow + 1}`).value = '0';
        ws.mergeCells(`D${curRow + 1}:G${curRow + 1}`);
        ws.getCell(`D${curRow + 1}`).value = '9-Jun-18';
        ws.mergeCells(`H${curRow + 1}:R${curRow + 1}`);
        ws.getCell(`H${curRow + 1}`).value = 'Initital';

        // 3 hàng revision trống
        for (let r = curRow + 2; r <= curRow + 4; r++) {
          ws.mergeCells(`A${r}:C${r}`);
          ws.mergeCells(`D${r}:G${r}`);
          ws.mergeCells(`H${r}:R${r}`);
        }

        // Chữ ký Người thao tác & Người kiểm tra (gộp 4 hàng chuẩn PDF)
        ws.mergeCells(`S${curRow + 1}:T${curRow + 4}`);
        const cOp = ws.getCell(`S${curRow + 1}`);
        cOp.value = 'Mr. Thao\r\nEng.Technicial\r\n(Vũ Đức Thọ)';
        cOp.font = { name: 'Arial', size: 9.5, bold: true };
        cOp.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

        ws.mergeCells(`U${curRow + 1}:V${curRow + 4}`);
        const cChk = ws.getCell(`U${curRow + 1}`);
        cChk.value = 'Mr. Toan\r\nSectional Chief\r\n(Nguyễn Văn Toàn)';
        cChk.font = { name: 'Arial', size: 9.5, bold: true };
        cChk.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

        for (let r = curRow + 1; r <= curRow + 4; r++) {
          ws.getRow(r).height = 18;
          ['A', 'D', 'H'].forEach(col => {
            const cell = ws.getRow(r).getCell(col);
            cell.font = { name: 'Arial', size: 9, bold: false };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          });
        }

        // Đóng viền mỏng toàn bộ bảng Revision & Chữ ký
        for (let r = curRow; r <= curRow + 4; r++) {
          for (let c = 1; c <= 22; c++) {
            ws.getRow(r).getCell(c).border = {
              top: { style: 'thin', color: { argb: 'FF94A3B8' } },
              bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
              left: { style: 'thin', color: { argb: 'FF94A3B8' } },
              right: { style: 'thin', color: { argb: 'FF94A3B8' } }
            };
          }
        }
      }

      // TẠO SHEET 1: KHUÔN TIÊU CHUẨN
      const wsStandard = wb.addWorksheet('Khuôn Tiêu Chuẩn');
      buildUnifiedSheet(wsStandard, 'Khuôn Tiêu Chuẩn', false, standardMolds);

      // TẠO SHEET 2: KHUÔN HIGH IMPACT
      const wsHighImpact = wb.addWorksheet('Khuôn High Impact');
      buildUnifiedSheet(wsHighImpact, 'Khuôn High Impact', true, highImpactMolds);

      // ========================================================================
      // SHEET 3: SẢN XUẤT LIVE 44 MÁY ÉP TMS
      // ========================================================================
      const ws3 = wb.addWorksheet('San xuat 44 may TMS');
      ws3.views = [{ showGridLines: true }];

      ws3.mergeCells('A1:O1');
      const titleCell3 = ws3.getCell('A1');
      titleCell3.value = `BÁO CÁO GIÁM SÁT SẢN LƯỢNG & SỐ SHOT REAL-TIME 44 MÁY ÉP (TMS SMART)`;
      titleCell3.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
      titleCell3.alignment = { horizontal: 'center', vertical: 'middle' };
      ws3.getRow(1).height = 30;

      const headers3 = [
        'STT', 'Mã Máy', 'Trạng Thái', 'Mã Khuôn (Mold No)', 'Tên Sản Phẩm', 'Cavity', 'Cycle Time (s)',
        'Sản Lượng Hôm Nay', 'NG Máy Hôm Nay', 'NG Screening (Ngoại quan)', 'Số Chứng Từ', 'Số Shot Hôm Nay',
        'Sản Lượng Hôm Qua', 'NG Máy Hôm Qua', 'Số Shot Hôm Qua'
      ];
      const hRow3 = ws3.addRow(headers3);
      hRow3.height = 24;
      hRow3.eachCell(cell => {
        cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF0F172A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      });

      (rawData?.records || []).forEach((r, idx) => {
        const row = ws3.addRow([
          idx + 1,
          r.machineNo,
          r.machineStatus,
          r.moldNo,
          r.series,
          r.cavityStr || r.cavity,
          r.cycleTime || 0,
          Math.round(r.todayProdOutputPcs || 0),
          Math.round(r.todayMachineNg || r.todayScrapPcs || 0),
          Math.round(r.todayScreeningNg || 0),
          r.todayDocNo || '-',
          Math.round(r.todayShots || 0),
          Math.round(r.yesterdayProdOutputPcs || 0),
          Math.round(r.yesterdayMachineNg || r.yesterdayScrapPcs || 0),
          Math.round(r.yesterdayShots || 0)
        ]);
        row.height = 19;
        row.eachCell((cell, colNum) => {
          cell.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
          cell.font = { name: 'Calibri', size: 10 };
          if ([1, 2, 3, 4, 6, 11].includes(colNum)) cell.alignment = { horizontal: 'center', vertical: 'middle' };
          else if ([7, 8, 9, 10, 12, 13, 14, 15].includes(colNum)) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '#,##0';
          }
        });
      });

      // Xuất file
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const todayStr = new Date().toISOString().slice(0, 10);
      a.download = `MMFD-I-F-022.01_Dem_So_Shot_Va_Bao_Duong_Khuon_${todayStr}.xlsx`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[EXPORT EXCEL ERROR]', err);
      alert(`Không thể tạo báo cáo Excel MMFD-I-F-022.01: ${err.message}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = oldBtnText;
      }
    }
  }

  // Chuyển đổi Sub-Tab
  function setSubTab(tabName) {
    currentSubTab = tabName;
    document.querySelectorAll('.mm-subtab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subtab === tabName);
    });
    renderTable();
  }

  // Xử lý bộ lọc (Chặn triệt để autofill email từ trình duyệt)
  function onSearchInput(val) {
    moldVisibleLimit = PAGE_SIZE;
    machineVisibleLimit = PAGE_SIZE;
    if (val && (val.includes('@') || val.includes('.com'))) {
      const s = document.getElementById('mmSearchInput');
      if (s) s.value = '';
      filterText = '';
      renderTable();
      return;
    }
    filterText = (val || '').trim();
    renderTable();
  }

  function onDateFilterChange() {
    moldVisibleLimit = PAGE_SIZE;
    machineVisibleLimit = PAGE_SIZE;
    const y = document.getElementById('mmYearSelect')?.value;
    const m = document.getElementById('mmMonthSelect')?.value;
    const d = document.getElementById('mmDaySelect')?.value;
    const prevYear = selectedYear;
    const prevMonth = selectedMonth;
    if (y) selectedYear = y;
    if (m) selectedMonth = m;
    if (d) selectedDay = d;
    if (prevYear !== selectedYear || prevMonth !== selectedMonth) {
      updateDaySelectOptions();
    }
    renderTable();
  }


  // ============================================================================
  // QUẢN LÝ THÊM MOLD MỚI (DÀNH CHO ADMIN VÀ STAFF)
  // ============================================================================
    function openAddMoldModal() {
    // Kiểm tra quyền: chỉ Admin hoặc Staff mới được thêm khuôn
    if (typeof ComponentAuth !== 'undefined' && !ComponentAuth.canAddMold()) {
      alert('Bạn cần đăng nhập với quyền Admin hoặc Staff để thêm khuôn mới.');
      return;
    }

    const modal = document.getElementById('mmAddMoldModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      const moldNoInput = document.getElementById('newMoldNo');
      if (moldNoInput) {
        setTimeout(() => moldNoInput.focus(), 50);
      }
      const st = document.getElementById('newMoldStatus');
      if (st) st.style.display = 'none';
    }
  }

  function closeAddMoldModal() {
    const modal = document.getElementById('mmAddMoldModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
    const form = document.getElementById('mmAddMoldForm');
    if (form) form.reset();
  }

  // Lắng nghe phím ESC để đóng modal
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('mmAddMoldModal');
        if (modal && modal.style.display !== 'none' && !modal.classList.contains('hidden')) {
          closeAddMoldModal();
        }
        const authModal = document.getElementById('mmMilestoneAuthModal');
        if (authModal && authModal.style.display !== 'none' && !authModal.classList.contains('hidden')) {
          closeMilestoneModal();
        }
        const colMenu = document.getElementById('mmColPickerMenu');
        if (colMenu && !colMenu.classList.contains('hidden')) {
          colMenu.classList.add('hidden');
        }
      }
    });
  }

  async function submitAddMold(event) {
    if (event) event.preventDefault();
    const moldNo = (document.getElementById('newMoldNo')?.value || '').trim().toUpperCase();
    const series = (document.getElementById('newMoldSeries')?.value || '').trim();
    const tier = document.getElementById('newMoldTier')?.value;
    const isHighImpact = tier === 'high_impact';
    const cavity = Number(document.getElementById('newMoldCavity')?.value) || 4;
    const machineNo = (document.getElementById('newMoldMachine')?.value || '').trim() || '-';
    const m1 = Math.round(Number(document.getElementById('newMoldM1')?.value) || 0);
    const totalLife = Math.round(Number(document.getElementById('newMoldTotalLife')?.value) || 0);
    const note = (document.getElementById('newMoldNote')?.value || '').trim();

    const statusEl = document.getElementById('newMoldStatus');
    const submitBtn = document.getElementById('btnSubmitNewMold');

    if (!moldNo || !series) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = '#fee2e2';
        statusEl.style.color = '#991b1b';
        statusEl.textContent = 'Vui lòng nhập đầy đủ Mã Khuôn và Dòng Sản Phẩm!';
      }
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Đang lưu...';
    }

    const newMoldObj = {
      mold: moldNo,
      series: series,
      is_high_impact: isHighImpact,
      total_last_year: 0,
      rem_last_year: 0,
      months: { M1: 0, M2: 0, M3: 0, M4: 0, M5: 0, M6: 0, M7: 0, M8: 0, M9: 0, M10: 0, M11: 0, M12: 0 },
      m1_800k: m1,
      m2_800k: 0,
      m3_800k: 0,
      total_life: totalLife,
      machineNo: machineNo,
      cavity: cavity,
      note: note,
      createdAt: new Date().toISOString(),
      createdBy: window.ComponentAuth?.user?.username || 'user'
    };

    try {
      // 1. Thử gửi lên API Cloudflare Worker (/api/molds/create)
      try {
        const auth = window.ComponentAuth;
        const res = await fetch('/api/molds/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': auth?.csrf || ''
          },
          body: JSON.stringify(newMoldObj)
        });
        if (res.ok) {
          const resData = await res.json();
          console.log('[ADD MOLD SUCCESS ON SERVER]', resData);
        }
      } catch (err) {
        console.warn('[ADD MOLD LOCAL FALLBACK]', err);
      }

      // 2. Lưu vào localStorage để persist ngay lập tức
      try {
        const stored = JSON.parse(localStorage.getItem('mm_custom_molds') || '[]');
        const existingIdx = stored.findIndex(x => (x.mold || '').toUpperCase() === moldNo);
        if (existingIdx >= 0) stored[existingIdx] = newMoldObj;
        else stored.unshift(newMoldObj);
        localStorage.setItem('mm_custom_molds', JSON.stringify(stored));
      } catch (e) {}

      // 3. Cập nhật vào rawData trong bộ nhớ
      if (!rawData) rawData = { excelMasterMolds: [], records: [] };
      if (!rawData.excelMasterMolds) rawData.excelMasterMolds = [];
      const memIdx = rawData.excelMasterMolds.findIndex(x => (x.mold || '').toUpperCase() === moldNo);
      if (memIdx >= 0) rawData.excelMasterMolds[memIdx] = newMoldObj;
      else rawData.excelMasterMolds.unshift(newMoldObj);

      // Re-render
      renderAll();
      if (typeof renderOverviewTab === 'function') {
        try { renderOverviewTab(); } catch (e) {}
      }

      closeAddMoldModal();
      alert(`✅ Đã thêm thành công khuôn ${moldNo} vào hệ thống kiểm soát!`);
    } catch (err) {
      console.error('[ADD MOLD ERROR]', err);
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = '#fee2e2';
        statusEl.style.color = '#991b1b';
        statusEl.textContent = 'Lỗi lưu khuôn: ' + err.message;
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 Lưu Khuôn Mới';
      }
    }
  }

  return {
    init,
    switchTab,
    setSubTab: switchTab,
    onStatusFilterChange,
    onSearchInput,
    onDateFilterChange,
    onTierFilterChange,
    toggleColPicker,
    onColPrefChange,
    onColToggle: onColPrefChange,
    resetDefaultCols,
    onTimerChange,
    syncTms,
    exportExcel,
    renderAll,
    getData: () => rawData,
    openAddMoldModal,
    closeAddMoldModal,
    submitAddMold,
    getAllUnifiedMolds,
    updateMoldNote,
    toggleMilestoneCheck,
    onMoldColPrefChange,
    openMilestoneModal,
    closeMilestoneModal,
    confirmMilestoneAuth,
    viewMilestonePdf,
    getMilestonePdf,
    loadMoreMolds,
    showAllMolds,
    loadMoreMachines,
    showAllMachines,
    refreshData
  };
})();

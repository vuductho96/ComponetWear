/* export-excel.js — Excel Exporter System
   - Tab 'chart' (Biểu Đồ): Professional Executive 3-Sheet Report (01_REPORT, 02_COMPONENT_SUMMARY, 03_REPLACEMENT_LOG)
   - Other tabs ('month', 'stock', 'report'): Standard Component_Life_Tracking.xlsx with dynamic cycles
*/
'use strict';

function exportExcelFull() {
  if (currentActiveTab === "chart") {
    return exportProfessionalReportExcel();
  }
  return exportStandardLifeTrackingExcel();
}

async function exportProfessionalReportExcel() {
  if ((!db.replacements || !db.replacements.length) && (!db.shoot || !db.shoot.length) && (!masterData || !masterData.length)) {
    return msg("Hãy nạp dữ liệu trước khi xuất Excel.", true);
  }

  // Ensure ExcelJS is available, auto-load if missing
  if (typeof ExcelJS === 'undefined') {
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/exceljs.min.js';
        s.onload = resolve;
        s.onerror = () => {
          const s2 = document.createElement('script');
          s2.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
          s2.onload = resolve;
          s2.onerror = reject;
          document.head.appendChild(s2);
        };
        document.head.appendChild(s);
      });
    } catch (e) {
      console.warn("[EXPORT] Could not load ExcelJS, falling back to standard export:", e);
      return exportStandardLifeTrackingExcel();
    }
  }

  console.log("%c[EXPORT] Starting Professional Excel Report Export (Chart Tab)...", "color:#4f46e5; font-weight:bold; font-size:13px;");
  msg("Đang tạo báo cáo Excel chuyên nghiệp (01_REPORT, 02_SUMMARY, 03_LOG)...", false, 3000);

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ComponetWear';
    wb.lastModifiedBy = 'ComponetWear Engine';
    wb.created = new Date();
    wb.modified = new Date();

    // 1. EXTRACT ACTIVE FILTER STATE
    const ymFilter = typeof selectedMonth === 'function' ? selectedMonth() : '';
    const yFilter = typeof selectedYear === 'function' ? selectedYear() : '';
    const dFilter = typeof selectedDay === 'function' ? selectedDay() : '';
    const globalQ = $("globalSearch") ? $("globalSearch").value.trim() : '';

    let periodLabel = "All Historical Data";
    let filePeriodSlug = "All";
    if (dFilter) {
      periodLabel = formatDateDisplay(dFilter);
      filePeriodSlug = dFilter;
    } else if (ymFilter) {
      const [y, m] = ymFilter.split('-');
      const monthNamesEng = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      periodLabel = `${monthNamesEng[parseInt(m, 10) - 1] || m}-${y}`;
      filePeriodSlug = ymFilter;
    } else if (yFilter) {
      periodLabel = `Year ${yFilter}`;
      filePeriodSlug = yFilter;
    }

    const moldFilterLabel = globalQ || "All";
    const seriesFilterLabel = "All";
    const partFilterLabel = "All";
    const generatedTimestamp = formatDateTimeDisplay(new Date());

    // 2. INDEX SHOOT & REPLACEMENT DATA
    // A. Full Shoot Index (Unfiltered by date to accurately compute full cycle shots)
    const shootsByMold = new Map();
    (db.shoot || []).forEach(s => {
      if (!s.Date || !s.Output || Number(s.Output) <= 0) return;
      const d = String(s.DieSet || '').toLowerCase().trim();
      const p = String(s.Part || '').toLowerCase().trim();
      if (d) { if (!shootsByMold.has(d)) shootsByMold.set(d, []); shootsByMold.get(d).push(s); }
      if (p && p !== d) { if (!shootsByMold.has(p)) shootsByMold.set(p, []); shootsByMold.get(p).push(s); }
    });

    // B. Filtered Replacements for the selected scope
    const repsByPartMold = new Map();
    const allFilteredReplacements = [];
    (db.replacements || []).forEach(r => {
      const lbl = String(r.Label || '').trim();
      if (!r.ReplaceDate || lbl === '-' || lbl === '0' || lbl === '·') return;
      if (dFilter && r.ReplaceDate !== dFilter) return;
      else if (ymFilter && !r.ReplaceDate.startsWith(ymFilter)) return;
      else if (!ymFilter && yFilter && !r.ReplaceDate.startsWith(yFilter)) return;

      const p = String(r.Part || '').toLowerCase().trim();
      const d = String(r.DieSet || r.NewDieSet || r.OldDieSet || '').toLowerCase().trim();
      const key = `${p}|${d}`;
      if (!repsByPartMold.has(key)) repsByPartMold.set(key, []);
      repsByPartMold.get(key).push(r);

      const master = typeof findMasterItem === 'function' ? findMasterItem(r.Part, r.DieSet || r.NewDieSet || r.OldDieSet, r.Series) : null;
      const s = r.Series || (master ? master.Series : '');
      const o = (master ? master.OldDieSet : '') || r.OldDieSet || r.DieSet || '';
      const n = (master ? master.NewDieSet : '') || r.NewDieSet || r.DieSet || '';
      r.moldSeries = typeof formatMoldSeriesDisplay === 'function' ? formatMoldSeriesDisplay(s, o, n, false) : (s ? `${s}/${n}` : n);

      allFilteredReplacements.push(r);
    });

    // C. All Historical Replacements for baseline lifecycle calculation
    const allHistRepsByPartMold = new Map();
    (db.replacements || []).forEach(r => {
      const lbl = String(r.Label || '').trim();
      if (!r.ReplaceDate || lbl === '-' || lbl === '0' || lbl === '·') return;
      const p = String(r.Part || '').toLowerCase().trim();
      const d = String(r.DieSet || r.NewDieSet || r.OldDieSet || '').toLowerCase().trim();
      const key = `${p}|${d}`;
      if (!allHistRepsByPartMold.has(key)) allHistRepsByPartMold.set(key, []);
      allHistRepsByPartMold.get(key).push(r);
    });

    // 3. COMPUTE COMPONENT-LEVEL METRICS (Matches Calculation Engine)
    const allParts = typeof getPartsToRender === 'function' ? getPartsToRender() : [];
    const componentsData = [];
    let totalReplacementEvents = 0;
    let totalReplacementQuantityPcs = 0;
    let totalCompletedCyclesCount = 0;
    let totalCompletedCycleShotsSum = 0;
    const moldPcsMap = new Map();
    const monthlyTrendMap = new Map();

    allParts.forEach((item, index) => {
      const part = item.part;
      const series = item.series || '-';
      const moldNew = item.moldNew || item.moldOld || item.part;
      const moldOld = item.moldOld || '';
      const moldName = (moldNew || moldOld || series || '').trim();
      const moldSeries = typeof formatMoldSeriesDisplay === 'function' ? formatMoldSeriesDisplay(series, moldOld, moldNew, false) : `${series} / ${moldName}`;

      const pLower = part.toLowerCase().trim();
      const dNewLower = (moldNew || '').toLowerCase().trim();
      const dOldLower = (moldOld || '').toLowerCase().trim();

      let allShoots = [];
      if (dNewLower && shootsByMold.has(dNewLower)) allShoots.push(...shootsByMold.get(dNewLower));
      if (dOldLower && dOldLower !== dNewLower && shootsByMold.has(dOldLower)) allShoots.push(...shootsByMold.get(dOldLower));
      if (pLower && shootsByMold.has(pLower) && !allShoots.length) allShoots.push(...shootsByMold.get(pLower));

      const shootSet = new Set(), sortedShoots = [];
      allShoots.sort((a, b) => (a.Date || '').localeCompare(b.Date || '')).forEach(s => {
        const sk = `${s.Date}|${s.Output}|${s.DieSet}`;
        if (!shootSet.has(sk)) { shootSet.add(sk); sortedShoots.push(s); }
      });

      const k1 = `${pLower}|${dNewLower}`, k2 = `${pLower}|${dOldLower}`;
      let allReps = [];
      if (repsByPartMold.has(k1)) allReps.push(...repsByPartMold.get(k1));
      if (k2 !== k1 && repsByPartMold.has(k2)) allReps.push(...repsByPartMold.get(k2));

      const repSet = new Set(), sortedReps = [];
      allReps.sort((a, b) => (a.ReplaceDate || '').localeCompare(b.ReplaceDate || '')).forEach(r => {
        const rk = `${r.ReplaceDate}|${r.RequestId || ''}|${r.Label}`;
        if (!repSet.has(rk)) { repSet.add(rk); sortedReps.push(r); }
      });

      // Get all historical reps for cycle calculation
      let histReps = [];
      if (allHistRepsByPartMold.has(k1)) histReps.push(...allHistRepsByPartMold.get(k1));
      if (k2 !== k1 && allHistRepsByPartMold.has(k2)) histReps.push(...allHistRepsByPartMold.get(k2));
      const histRepSet = new Set(), sortedHistReps = [];
      histReps.sort((a, b) => (a.ReplaceDate || '').localeCompare(b.ReplaceDate || '')).forEach(r => {
        const rk = `${r.ReplaceDate}|${r.RequestId || ''}|${r.Label}`;
        if (!histRepSet.has(rk)) { histRepSet.add(rk); sortedHistReps.push(r); }
      });

      const totalLifetimeShots = sortedShoots.reduce((sum, s) => sum + (Number(s.Output) || 0), 0);
      const replacementCount = sortedReps.length;
      const totalPartsReplacedPcs = sortedReps.reduce((sum, r) => sum + (Number(r.Label) || 1), 0);

      totalReplacementEvents += replacementCount;
      totalReplacementQuantityPcs += totalPartsReplacedPcs;

      if (totalPartsReplacedPcs > 0 && moldName) {
        moldPcsMap.set(moldName, (moldPcsMap.get(moldName) || 0) + totalPartsReplacedPcs);
      }

      // Build Monthly Trend
      sortedReps.forEach(r => {
        const ym = r.ReplaceDate ? r.ReplaceDate.slice(0, 7) : '';
        if (ym) {
          const qty = Number(r.Label) || 1;
          monthlyTrendMap.set(ym, (monthlyTrendMap.get(ym) || 0) + qty);
        }
      });

      // Calculate completed cycles across full historical shoot records
      const cycles = [];
      if (sortedHistReps.length > 1) {
        for (let i = 0; i < sortedHistReps.length - 1; i++) {
          const cN = sortedShoots.filter(s => s.Date >= sortedHistReps[i].ReplaceDate && s.Date < sortedHistReps[i + 1].ReplaceDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0);
          if (cN > 0) cycles.push(cN);
        }
      }

      totalCompletedCyclesCount += cycles.length;
      cycles.forEach(c => { totalCompletedCycleShotsSum += c; });

      const averageShotLife = cycles.length > 0 ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : (totalLifetimeShots > 0 ? totalLifetimeShots : null);
      const medianLife = cycles.length > 0 ? calculateMedian(cycles) : (totalLifetimeShots > 0 ? totalLifetimeShots : null);
      const minShotLife = cycles.length > 0 ? Math.min(...cycles) : (totalLifetimeShots > 0 ? totalLifetimeShots : null);
      const maxShotLife = cycles.length > 0 ? Math.max(...cycles) : (totalLifetimeShots > 0 ? totalLifetimeShots : null);
      const currentShotCount = sortedHistReps.length > 0 ? sortedShoots.filter(s => s.Date >= sortedHistReps[sortedHistReps.length - 1].ReplaceDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0) : (totalLifetimeShots > 0 ? totalLifetimeShots : null);
      const lastRepDate = sortedHistReps.length > 0 ? sortedHistReps[sortedHistReps.length - 1].ReplaceDate : null;

      componentsData.push({
        part,
        series,
        moldName,
        moldSeries,
        replacementCount,
        totalPartsReplacedPcs,
        cycleCount: cycles.length,
        averageShotLife,
        medianLife,
        minShotLife,
        maxShotLife,
        currentShotCount,
        totalLifetimeShots,
        lastReplacementDate: lastRepDate,
        cycles
      });
    });

    // Sort components: Highest Replacement Quantity (PCS) first, then Replacement Count, then Part Name
    componentsData.sort((a, b) => {
      if (b.totalPartsReplacedPcs !== a.totalPartsReplacedPcs) return b.totalPartsReplacedPcs - a.totalPartsReplacedPcs;
      if (b.replacementCount !== a.replacementCount) return b.replacementCount - a.replacementCount;
      return a.part.localeCompare(b.part, undefined, { numeric: true, sensitivity: 'base' });
    });

    const top10Components = componentsData.filter(c => c.totalPartsReplacedPcs > 0).slice(0, 10);
    const overallAverageLife = totalCompletedCyclesCount > 0 ? Math.round(totalCompletedCycleShotsSum / totalCompletedCyclesCount) : null;

    // =========================================================================
    // 1. TRY NATIVE EXCEL EXPORT (True Dynamic OpenXML Chart linked to Cells)
    // =========================================================================
    try {
      const payload = {
        periodLabel,
        moldFilter: moldFilterLabel,
        generatedAt: generatedTimestamp,
        top10: top10Components,
        components: componentsData,
        replacements: allFilteredReplacements
      };

      const res = await fetch('/api/export-report-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const cType = res.headers.get('content-type') || '';
        if (cType.includes('spreadsheet') || cType.includes('octet-stream')) {
          const blob = await res.blob();
          const fileName = sanitizeFilename(`ComponentWear_Report_${filePeriodSlug}.xlsx`);
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(link.href);

          console.log(`%c[EXPORT] SUCCESS (Native Dynamic OpenXML Chart): ${fileName}`, "color:#059669; font-weight:bold; font-size:13px;");
          msg(`<b>Xuất báo cáo Excel thành công!</b><br>Biểu đồ động Excel tự động thay đổi khi sửa bảng số liệu.<br>File: <code>${esc(fileName)}</code>`, false, 8000);
          return;
        }
      }
    } catch (backendErr) {
      console.log("[EXPORT] Backend native export not reachable, generating via browser ExcelJS engine...", backendErr);
    }

    // ==========================================
    // 2. FALLBACK: IN-BROWSER EXCELJS EXPORTER
    // ==========================================
    const ws1 = wb.addWorksheet('01_REPORT', {
      views: [{ showGridLines: false }],
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9, // A4
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
        margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
      }
    });

    // Set Column Widths for 01_REPORT
    ws1.columns = [
      { width: 4 },   // A: Margin
      { width: 8 },   // B: Rank
      { width: 16 },  // C: Component / Part
      { width: 18 },  // D: Mold Name
      { width: 14 },  // E: Series
      { width: 14 },  // F: Lượt Thay
      { width: 16 },  // G: Số Lượng (Pcs)
      { width: 15 },  // H: TB Shot / Chu Kỳ
      { width: 13 },  // I: Min Shot
      { width: 13 },  // J: Max Shot
      { width: 15 },  // K: Shot HT
      { width: 16 },  // L: Lần Thay Cuối
      { width: 4 }    // M: Margin
    ];

    // Header Block
    ws1.mergeCells('B2:L2');
    const titleCell = ws1.getCell('B2');
    titleCell.value = 'TOP 10 LINH KIỆN THAY NHIỀU NHẤT';
    titleCell.font = { name: 'Segoe UI', size: 15, bold: true, color: { argb: 'FF1E293B' } };
    titleCell.alignment = { vertical: 'middle' };
    ws1.getRow(2).height = 24;

    // Generate Full-Width Top 10 Combo Chart (Cột: Số lượt thay, Dây: Số lượng Pcs)
    const chartRowStart = 4;
    const chartRowEnd = 19;

    try {
      const comboChartImgBase64 = generateTop10ComboChartBase64(top10Components);
      if (comboChartImgBase64) {
        const imgId = wb.addImage({ base64: comboChartImgBase64, extension: 'png' });
        ws1.addImage(imgId, {
          tl: { col: 1, row: chartRowStart - 1 },
          br: { col: 12, row: chartRowEnd }
        });
      }
    } catch (chartErr) {
      console.warn("[EXPORT] Canvas chart rendering fallback:", chartErr);
    }

    // Set chart row heights
    for (let r = chartRowStart; r <= chartRowEnd; r++) {
      ws1.getRow(r).height = 18;
    }

    // Section Header: Summary Table
    const tableHeaderRow = chartRowEnd + 2;
    ws1.getRow(tableHeaderRow - 1).height = 20;
    ws1.mergeCells(`B${tableHeaderRow - 1}:L${tableHeaderRow - 1}`);
    const tblTitle = ws1.getCell(`B${tableHeaderRow - 1}`);
    tblTitle.value = 'BẢNG CHI TIẾT TOP 10 LINH KIỆN THAY NHIỀU NHẤT';
    tblTitle.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF1E293B' } };
    tblTitle.alignment = { vertical: 'middle' };

    // Table Headers
    const summaryHeaders = [
      { col: 'B', label: 'Top', align: 'center' },
      { col: 'C', label: 'Mã Linh Kiện', align: 'left' },
      { col: 'D', label: 'Tên Khuôn', align: 'left' },
      { col: 'E', label: 'Series', align: 'center' },
      { col: 'F', label: 'Lượt Thay', align: 'right' },
      { col: 'G', label: 'Số Lượng (Pcs)', align: 'right' },
      { col: 'H', label: 'TB Shot / CK', align: 'right' },
      { col: 'I', label: 'Min Shot', align: 'right' },
      { col: 'J', label: 'Max Shot', align: 'right' },
      { col: 'K', label: 'Shot HT', align: 'right' },
      { col: 'L', label: 'Lần Thay Cuối', align: 'center' }
    ];

    ws1.getRow(tableHeaderRow).height = 20;
    summaryHeaders.forEach(h => {
      const cell = ws1.getCell(`${h.col}${tableHeaderRow}`);
      cell.value = h.label;
      cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.alignment = { horizontal: h.align, vertical: 'middle' };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin', color: { argb: 'FF334155' } }, right: { style: 'thin', color: { argb: 'FF334155' } } };
    });

    // Populate Top 10 Summary Rows
    let curRow = tableHeaderRow + 1;
    if (top10Components.length === 0) {
      ws1.mergeCells(`B${curRow}:L${curRow}`);
      const emptyCell = ws1.getCell(`B${curRow}`);
      emptyCell.value = 'Không có dữ liệu thay thế trong kỳ lọc được chọn.';
      emptyCell.font = { name: 'Segoe UI', size: 9.5, italic: true, color: { argb: 'FF64748B' } };
      emptyCell.alignment = { horizontal: 'center', vertical: 'middle' };
      ws1.getRow(curRow).height = 22;
      curRow++;
    } else {
      top10Components.forEach((r, idx) => {
        ws1.getRow(curRow).height = 18;
        const isZebra = idx % 2 === 1;
        const rowBgColor = isZebra ? 'FFF8FAFC' : 'FFFFFFFF';

        const rowValues = [
          { col: 'B', val: idx + 1, align: 'center', numFmt: '0' },
          { col: 'C', val: r.part, align: 'left', bold: true },
          { col: 'D', val: r.moldName, align: 'left' },
          { col: 'E', val: r.series, align: 'center' },
          { col: 'F', val: r.replacementCount, align: 'right', numFmt: '#,##0' },
          { col: 'G', val: r.totalPartsReplacedPcs, align: 'right', bold: true, numFmt: '#,##0' },
          { col: 'H', val: r.averageShotLife !== null ? r.averageShotLife : 'N/A', align: 'right', numFmt: r.averageShotLife !== null ? '#,##0' : undefined },
          { col: 'I', val: r.minShotLife !== null ? r.minShotLife : 'N/A', align: 'right', numFmt: r.minShotLife !== null ? '#,##0' : undefined },
          { col: 'J', val: r.maxShotLife !== null ? r.maxShotLife : 'N/A', align: 'right', numFmt: r.maxShotLife !== null ? '#,##0' : undefined },
          { col: 'K', val: r.currentShotCount !== null ? r.currentShotCount : 'N/A', align: 'right', numFmt: r.currentShotCount !== null ? '#,##0' : undefined },
          { col: 'L', val: r.lastReplacementDate ? formatDateDisplay(r.lastReplacementDate) : 'N/A', align: 'center' }
        ];

        rowValues.forEach(v => {
          const cell = ws1.getCell(`${v.col}${curRow}`);
          cell.value = v.val;
          cell.font = { name: 'Segoe UI', size: 9, bold: !!v.bold, color: { argb: 'FF0F172A' } };
          cell.alignment = { horizontal: v.align, vertical: 'middle' };
          if (v.numFmt) cell.numFmt = v.numFmt;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBgColor } };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
          };
        });

        curRow++;
      });
    }

    // Key Observations Block
    curRow += 1;
    ws1.mergeCells(`B${curRow}:L${curRow}`);
    const obsHeader = ws1.getCell(`B${curRow}`);
    obsHeader.value = 'KEY OBSERVATIONS';
    obsHeader.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF1E293B' } };
    ws1.getRow(curRow).height = 18;
    curRow++;

    const observations = generateFactualObservations(top10Components, moldPcsMap, totalReplacementQuantityPcs, totalReplacementEvents, overallAverageLife);
    observations.forEach(obs => {
      ws1.mergeCells(`B${curRow}:L${curRow}`);
      const obsCell = ws1.getCell(`B${curRow}`);
      obsCell.value = `•  ${obs}`;
      obsCell.font = { name: 'Segoe UI', size: 9, color: { argb: 'FF334155' } };
      obsCell.alignment = { vertical: 'middle' };
      ws1.getRow(curRow).height = 16;
      curRow++;
    });

    // Report Footer
    curRow += 1;
    ws1.mergeCells(`B${curRow}:L${curRow}`);
    const footerCell = ws1.getCell(`B${curRow}`);
    footerCell.value = `DATA SOURCE: SPP Control + Shoot Data  |  REPORT PERIOD: ${periodLabel}  |  FILTER: Mold: ${moldFilterLabel}, Series: ${seriesFilterLabel}  |  GENERATED BY: ComponetWear at ${generatedTimestamp}`;
    footerCell.font = { name: 'Segoe UI', size: 8, italic: true, color: { argb: 'FF94A3B8' } };
    footerCell.alignment = { vertical: 'middle' };
    ws1.getRow(curRow).height = 14;

    // ==========================================
    // SHEET 2: 02_COMPONENT_SUMMARY (Full Dataset)
    // ==========================================
    const ws2 = wb.addWorksheet('02_COMPONENT_SUMMARY', {
      views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
    });

    const summaryColumns = [
      { header: 'No.', key: 'no', width: 8 },
      { header: 'Mã Linh Kiện (Part)', key: 'part', width: 16 },
      { header: 'Khuôn (Series/Old/New)', key: 'moldSeries', width: 28 },
      { header: 'Số Lượt Thay', key: 'replacementCount', width: 14 },
      { header: 'Số Lượng (Pcs)', key: 'totalPartsReplacedPcs', width: 16 },
      { header: 'Số Chu Kỳ', key: 'cycleCount', width: 14 },
      { header: 'TB Shot / CK', key: 'averageShotLife', width: 16 },
      { header: 'Min Shot', key: 'minShotLife', width: 14 },
      { header: 'Max Shot', key: 'maxShotLife', width: 14 },
      { header: 'Shot HT', key: 'currentShotCount', width: 16 },
      { header: 'Tổng Shot Tích Lũy', key: 'totalLifetimeShots', width: 18 },
      { header: 'Lần Thay Cuối', key: 'lastReplacementDate', width: 18 }
    ];

    ws2.columns = summaryColumns;

    // Header Styling
    ws2.getRow(1).height = 22;
    ws2.getRow(1).eachCell((cell, colNum) => {
      cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.alignment = { horizontal: colNum >= 4 && colNum <= 11 ? 'right' : 'center', vertical: 'middle' };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF0F172A' } } };
    });

    // Populate Rows
    componentsData.forEach((c, idx) => {
      const row = ws2.addRow({
        no: idx + 1,
        part: c.part,
        moldSeries: c.moldSeries || `${c.series || '-'}/${c.moldName || ''}`,
        replacementCount: c.replacementCount,
        totalPartsReplacedPcs: c.totalPartsReplacedPcs,
        cycleCount: c.cycleCount,
        averageShotLife: c.averageShotLife !== null ? c.averageShotLife : 'N/A',
        minShotLife: c.minShotLife !== null ? c.minShotLife : 'N/A',
        maxShotLife: c.maxShotLife !== null ? c.maxShotLife : 'N/A',
        currentShotCount: c.currentShotCount !== null ? c.currentShotCount : 'N/A',
        totalLifetimeShots: c.totalLifetimeShots > 0 ? c.totalLifetimeShots : 0,
        lastReplacementDate: c.lastReplacementDate ? formatDateDisplay(c.lastReplacementDate) : 'N/A'
      });

      row.height = 18;
      row.eachCell((cell, colNum) => {
        cell.font = { name: 'Segoe UI', size: 9, color: { argb: 'FF0F172A' } };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        if (colNum >= 4 && colNum <= 11 && typeof cell.value === 'number') {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else if (colNum === 1 || colNum === 12) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      });
    });

    ws2.autoFilter = { from: 'A1', to: `L${componentsData.length + 1}` };

    // ==========================================
    // SHEET 3: 03_REPLACEMENT_LOG (Audit Trail)
    // ==========================================
    const ws3 = wb.addWorksheet('03_REPLACEMENT_LOG', {
      views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
    });

    const logColumns = [
      { header: 'No.', key: 'no', width: 8 },
      { header: 'Ngày Thay', key: 'date', width: 16 },
      { header: 'Mã Linh Kiện (Part)', key: 'part', width: 16 },
      { header: 'Khuôn (Series/Old/New)', key: 'moldSeries', width: 28 },
      { header: 'Số Lượng (Pcs)', key: 'qty', width: 16 },
      { header: 'Mã Yêu Cầu (Req ID)', key: 'reqId', width: 16 },
      { header: 'Ghi Chú / Serial', key: 'label', width: 22 }
    ];

    ws3.columns = logColumns;

    ws3.getRow(1).height = 22;
    ws3.getRow(1).eachCell((cell, colNum) => {
      cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.alignment = { horizontal: colNum === 5 ? 'right' : 'center', vertical: 'middle' };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF0F172A' } } };
    });

    allFilteredReplacements.sort((a, b) => (b.ReplaceDate || '').localeCompare(a.ReplaceDate || '')).forEach((r, idx) => {
      const qty = Number(r.Label) || 1;
      const row = ws3.addRow({
        no: idx + 1,
        date: r.ReplaceDate ? formatDateDisplay(r.ReplaceDate) : 'N/A',
        part: r.Part || '',
        moldSeries: r.moldSeries || `${r.Series || ''}/${r.DieSet || ''}`,
        qty: qty,
        reqId: r.RequestId || '',
        label: r.Label || ''
      });

      row.height = 18;
      row.eachCell((cell, colNum) => {
        cell.font = { name: 'Segoe UI', size: 9, color: { argb: 'FF0F172A' } };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        if (colNum === 5) {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else if (colNum === 1 || colNum === 2 || colNum === 6) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      });
    });

    ws3.autoFilter = { from: 'A1', to: `G${allFilteredReplacements.length + 1}` };

    // 4. WRITE BUFFER AND TRIGGER DOWNLOAD
    const fileName = sanitizeFilename(`ComponentWear_Report_${filePeriodSlug}.xlsx`);
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    
    // Browser download anchor
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    console.log(`%c[EXPORT] SUCCESS: ${fileName} (${componentsData.length} components, ${allFilteredReplacements.length} logs)`, "color:#059669; font-weight:bold; font-size:13px;");
    msg(`<b>Xuất báo cáo Excel thành công!</b><br>File: <code>${esc(fileName)}</code><br>Gồm 3 Sheet: 01_REPORT, 02_COMPONENT_SUMMARY, 03_REPLACEMENT_LOG`, false, 8000);
  } catch (err) {
    console.error("[EXPORT] ERROR:", err);
    msg(`Lỗi khi tạo file Excel: ${err.message}`, true, 8000);
  }
}

// ===== HELPER: GENERATE EXACT TOP 10 COMBO CHART IMAGE (CỘT: LƯỢT THAY & DÂY: SỐ LƯỢNG PCS) =====
function generateTop10ComboChartBase64(top10) {
  if (!top10 || top10.length === 0) return null;
  const canvas = document.createElement('canvas');
  const W = 880, H = 340;
  canvas.width = W * 2; // 2x resolution for crisp print
  canvas.height = H * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  // Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Top-Right Clean Legend
  const legendX = W - 280;
  const legendY = 14;
  
  // Legend Item 1: Cột (Lượt thay)
  ctx.fillStyle = '#4F46E5';
  roundRect(ctx, legendX, legendY, 12, 10, 3);
  ctx.fill();
  ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#475569';
  ctx.textAlign = 'left';
  ctx.fillText('Lượt thay', legendX + 16, legendY + 9);

  // Legend Item 2: Dây (Số lượng Pcs)
  const l2X = legendX + 105;
  ctx.strokeStyle = '#EF4444';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(l2X, legendY + 5);
  ctx.lineTo(l2X + 22, legendY + 5);
  ctx.stroke();

  ctx.fillStyle = '#EF4444';
  ctx.beginPath();
  ctx.arc(l2X + 11, legendY + 5, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#DC2626';
  ctx.textAlign = 'left';
  ctx.fillText('Số lượng (Pcs)', l2X + 28, legendY + 9);

  const items = top10.slice(0, 10);
  const maxRep = Math.max(...items.map(r => Number(r.replacementCount) || 1), 4);
  const maxPcs = Math.max(...items.map(r => Number(r.totalPartsReplacedPcs) || 1), 5);

  const padL = 55, padR = 55, padT = 46, padB = 48;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const stepX = plotW / items.length;
  const colW = Math.min(48, Math.max(24, stepX * 0.52));

  // Grid Lines & Dual Y-Axes Labels
  ctx.strokeStyle = '#F1F5F9';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

  for (let s = 0; s <= 4; s++) {
    const yG = padT + (plotH / 4) * s;
    ctx.beginPath();
    ctx.moveTo(padL, yG);
    ctx.lineTo(W - padR, yG);
    ctx.stroke();

    const valL = Math.round(maxRep - (maxRep / 4) * s);
    const valR = Math.round(maxPcs - (maxPcs / 4) * s);

    // Left Y Axis (Lượt thay - Blue)
    ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#4F46E5';
    ctx.textAlign = 'right';
    ctx.fillText(valL.toString(), padL - 8, yG + 3.5);

    // Right Y Axis (Pcs - Red)
    ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#DC2626';
    ctx.textAlign = 'left';
    ctx.fillText(valR.toString(), W - padR + 8, yG + 3.5);
  }
  ctx.setLineDash([]);

  // Draw Columns (Số lượt thay)
  const linePoints = [];
  items.forEach((r, i) => {
    const rep = Number(r.replacementCount) || 0;
    const pcs = Number(r.totalPartsReplacedPcs) || 0;

    const cx = padL + i * stepX + stepX / 2;
    const xCol = cx - colW / 2;
    const hCol = (rep / maxRep) * plotH;
    const yCol = padT + (plotH - hCol);

    const yLine = padT + plotH - (pcs / maxPcs) * plotH;
    linePoints.push({ x: cx, y: yLine, pcs });

    // Solid fill for column
    ctx.fillStyle = '#4F46E5';
    roundRect(ctx, xCol, yCol, colW, hCol, 4);
    ctx.fill();

    // Column Top Value Label
    ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#4F46E5';
    ctx.textAlign = 'center';
    ctx.fillText(rep.toString(), cx, yCol - 6);

    // X-Axis Line 1: Part Name
    ctx.font = 'bold 11.5px "Segoe UI", Arial, monospace';
    ctx.fillStyle = '#0F172A';
    ctx.textAlign = 'center';
    ctx.fillText(r.part, cx, H - 24);

    // X-Axis Line 2: Mold Name
    ctx.font = 'bold 9.5px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#64748B';
    ctx.textAlign = 'center';
    ctx.fillText(r.moldName, cx, H - 10);
  });

  // Draw Connecting Red Line
  ctx.strokeStyle = '#EF4444';
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  linePoints.forEach((pt, i) => {
    if (i === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  });
  ctx.stroke();

  // Draw Dots & Pcs Value Labels
  linePoints.forEach(pt => {
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();

    ctx.font = 'bold 10.5px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#DC2626';
    ctx.textAlign = 'center';
    ctx.fillText(pt.pcs.toString(), pt.x, pt.y - 8);
  });

  return canvas.toDataURL('image/png').split(',')[1];
}

// Helper: Canvas Rounded Rectangle
function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// Helper: Factual Observations Generator
function generateFactualObservations(top10, moldPcsMap, totalQty, totalEvents, overallAvgLife) {
  const obs = [];
  if (top10.length > 0 && top10[0].totalPartsReplacedPcs > 0) {
    const top1 = top10[0];
    obs.push(`Part ${top1.part} recorded the highest replacement volume in the selected scope with ${top1.totalPartsReplacedPcs.toLocaleString()} pcs consumed across ${top1.replacementCount.toLocaleString()} maintenance events.`);
  }

  if (moldPcsMap.size > 0) {
    const sortedMolds = Array.from(moldPcsMap.entries()).sort((a, b) => b[1] - a[1]);
    const topMold = sortedMolds[0];
    obs.push(`Mold ${topMold[0]} accounted for the largest maintenance activity, with a cumulative total of ${topMold[1].toLocaleString()} replacement pcs.`);
  }

  if (overallAvgLife) {
    obs.push(`Across all completed cycles in the scope, the fleet achieved an average life of ${overallAvgLife.toLocaleString()} shots per cycle.`);
  } else if (totalQty > 0) {
    obs.push(`A total of ${totalQty.toLocaleString()} pieces were consumed across ${totalEvents.toLocaleString()} replacement occurrences.`);
  }

  if (obs.length === 0) {
    obs.push('No maintenance replacements or completed cycles recorded for the selected filter parameters.');
  }

  return obs.slice(0, 3);
}

// Helper: Median calculation
function calculateMedian(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Helper: Sanitize Filename
function sanitizeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_');
}

// Helper: Format Date for Display (21-Aug-2026)
function formatDateDisplay(dStr) {
  if (!dStr) return '';
  const d = new Date(dStr);
  if (isNaN(d.getTime())) return dStr;
  const day = String(d.getDate()).padStart(2, '0');
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = monthNames[d.getMonth()];
  const y = d.getFullYear();
  return `${day}-${m}-${y}`;
}

// Helper: Format DateTime for Display (21-Aug-2026 14:45)
function formatDateTimeDisplay(d) {
  if (!d) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = monthNames[d.getMonth()];
  const y = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day}-${m}-${y} ${hh}:${mm}`;
}

// ===== STANDARD EXCEL EXPORT (FOR VIEW / STOCK / REPORT TABS) =====
function exportStandardLifeTrackingExcel() {
  if ((!db.replacements || !db.replacements.length) && (!db.shoot || !db.shoot.length) && (!masterData || !masterData.length)) {
    return msg("Hãy nạp dữ liệu trước khi xuất Excel.", true);
  }
  if (typeof XLSX === 'undefined') return msg("Thư viện SheetJS chưa sẵn sàng.", true);

  console.log("%c[EXPORT] Starting standard Component_Life_Tracking export...", "color:#4f46e5; font-weight:bold;");

  const wb = XLSX.utils.book_new();

  // Get active filters from UI toolbar
  const ymFilter = typeof selectedMonth === 'function' ? selectedMonth() : '';
  const yFilter = typeof selectedYear === 'function' ? selectedYear() : '';
  const dFilter = typeof selectedDay === 'function' ? selectedDay() : '';

  // Index Shoots and Replacements with date filtering if active
  const shootsByMold = new Map();
  (db.shoot || []).forEach(s => {
    if (!s.Date || !s.Output || Number(s.Output) <= 0) return;
    if (dFilter && s.Date !== dFilter) return;
    else if (ymFilter && !s.Date.startsWith(ymFilter)) return;
    else if (!ymFilter && yFilter && !s.Date.startsWith(yFilter)) return;

    const d = String(s.DieSet || '').toLowerCase().trim();
    const p = String(s.Part || '').toLowerCase().trim();
    if (d) { if (!shootsByMold.has(d)) shootsByMold.set(d, []); shootsByMold.get(d).push(s); }
    if (p && p !== d) { if (!shootsByMold.has(p)) shootsByMold.set(p, []); shootsByMold.get(p).push(s); }
  });

  const repsByPartMold = new Map();
  (db.replacements || []).forEach(r => {
    const lbl = String(r.Label || '').trim();
    if (!r.ReplaceDate || lbl === '-' || lbl === '0' || lbl === '·') return;
    if (dFilter && r.ReplaceDate !== dFilter) return;
    else if (ymFilter && !r.ReplaceDate.startsWith(ymFilter)) return;
    else if (!ymFilter && yFilter && !r.ReplaceDate.startsWith(yFilter)) return;

    const p = String(r.Part || '').toLowerCase().trim();
    const d = String(r.DieSet || r.NewDieSet || r.OldDieSet || '').toLowerCase().trim();
    const key = `${p}|${d}`;
    if (!repsByPartMold.has(key)) repsByPartMold.set(key, []);
    repsByPartMold.get(key).push(r);
  });

  // getPartsToRender applies Global Search, Part, Mold, Series filters
  const allParts = typeof getPartsToRender === 'function' ? getPartsToRender() : [];

  let maxCyclesFound = 3;
  const rowsData = [];

  allParts.forEach((item, index) => {
    const part = item.part;
    const series = item.series || '-';
    const moldNew = item.moldNew || item.moldOld || item.part;
    const moldOld = item.moldOld || '';
    
    const moldSeries = typeof formatMoldSeriesDisplay === 'function' ? formatMoldSeriesDisplay(series, moldOld, moldNew, false) : `${series} / ${moldNew}`;

    const pLower = part.toLowerCase().trim();
    const dNewLower = (moldNew || '').toLowerCase().trim();
    const dOldLower = (moldOld || '').toLowerCase().trim();

    let allShoots = [];
    if (dNewLower && shootsByMold.has(dNewLower)) allShoots.push(...shootsByMold.get(dNewLower));
    if (dOldLower && dOldLower !== dNewLower && shootsByMold.has(dOldLower)) allShoots.push(...shootsByMold.get(dOldLower));
    if (pLower && shootsByMold.has(pLower) && !allShoots.length) allShoots.push(...shootsByMold.get(pLower));

    const shootSet = new Set(), sortedShoots = [];
    allShoots.sort((a, b) => (a.Date || '').localeCompare(b.Date || '')).forEach(s => {
      const sk = `${s.Date}|${s.Output}|${s.DieSet}`;
      if (!shootSet.has(sk)) { shootSet.add(sk); sortedShoots.push(s); }
    });

    const k1 = `${pLower}|${dNewLower}`, k2 = `${pLower}|${dOldLower}`;
    let allReps = [];
    if (repsByPartMold.has(k1)) allReps.push(...repsByPartMold.get(k1));
    if (k2 !== k1 && repsByPartMold.has(k2)) allReps.push(...repsByPartMold.get(k2));

    const repSet = new Set(), sortedReps = [];
    allReps.sort((a, b) => (a.ReplaceDate || '').localeCompare(b.ReplaceDate || '')).forEach(r => {
      const rk = `${r.ReplaceDate}|${r.RequestId || ''}|${r.Label}`;
      if (!repSet.has(rk)) { repSet.add(rk); sortedReps.push(r); }
    });

    const totalLifetimeShots = sortedShoots.reduce((sum, s) => sum + (Number(s.Output) || 0), 0);
    const replacementCount = sortedReps.length;
    const totalPartsReplacedPcs = sortedReps.reduce((sum, r) => sum + (Number(r.Label) || 1), 0);

    const cycles = [];
    if (replacementCount > 0) {
      const c1 = sortedShoots.filter(s => s.Date < sortedReps[0].ReplaceDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0);
      if (c1 > 0) cycles.push(c1);
      for (let i = 0; i < sortedReps.length - 1; i++) {
        const cN = sortedShoots.filter(s => s.Date >= sortedReps[i].ReplaceDate && s.Date < sortedReps[i + 1].ReplaceDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0);
        if (cN > 0) cycles.push(cN);
      }
    }

    if (cycles.length > maxCyclesFound) maxCyclesFound = cycles.length;

    const averageShotLife = cycles.length > 0 ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : (totalLifetimeShots > 0 ? totalLifetimeShots : '');
    const minShotLife = cycles.length > 0 ? Math.min(...cycles) : '';
    const maxShotLife = cycles.length > 0 ? Math.max(...cycles) : '';
    const currentShotCount = replacementCount > 0 ? sortedShoots.filter(s => s.Date >= sortedReps[sortedReps.length - 1].ReplaceDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0) : (totalLifetimeShots > 0 ? totalLifetimeShots : '');

    rowsData.push({
      no: 0,
      part,
      moldSeries,
      replacementCount: replacementCount > 0 ? replacementCount : '',
      totalPartsReplacedPcs: totalPartsReplacedPcs > 0 ? totalPartsReplacedPcs : '',
      averageShotLife,
      minShotLife,
      maxShotLife,
      currentShotCount,
      cycles
    });
  });

  // Prioritize sorting descending by replacement count
  rowsData.sort((a, b) => {
    const repA = Number(a.replacementCount) || 0;
    const repB = Number(b.replacementCount) || 0;
    if (repB !== repA) return repB - repA;
    const pcsA = Number(a.totalPartsReplacedPcs) || 0;
    const pcsB = Number(b.totalPartsReplacedPcs) || 0;
    if (pcsB !== pcsA) return pcsB - pcsA;
    return a.part.localeCompare(b.part, undefined, { numeric: true, sensitivity: 'base' });
  });

  rowsData.forEach((r, idx) => { r.no = idx + 1; });

  const excelRows = rowsData.map(r => {
    const rowObj = {
      "No.": r.no,
      "Part Name": r.part,
      "Mold + Series": r.moldSeries,
      "Lượt Thay": r.replacementCount,
      "Tổng Pcs": r.totalPartsReplacedPcs,
      "TB Shot": r.averageShotLife,
      "Min Shot": r.minShotLife,
      "Max Shot": r.maxShotLife,
      "Shot HT": r.currentShotCount
    };
    for (let c = 1; c <= maxCyclesFound; c++) {
      rowObj[`Cycle ${c}`] = (r.cycles && r.cycles[c - 1] !== undefined) ? r.cycles[c - 1] : '';
    }
    return rowObj;
  });

  const ws = XLSX.utils.json_to_sheet(excelRows);
  const cols = [
    { wch: 6 },   // No.
    { wch: 14 },  // Part Name
    { wch: 28 },  // Mold + Series
    { wch: 12 },  // Lượt Thay
    { wch: 12 },  // Tổng Pcs
    { wch: 14 },  // TB Shot
    { wch: 12 },  // Min Shot
    { wch: 12 },  // Max Shot
    { wch: 14 },  // Shot HT
  ];
  for (let c = 1; c <= maxCyclesFound; c++) {
    cols.push({ wch: 14 });
  }
  ws['!cols'] = cols;
  XLSX.utils.book_append_sheet(wb, ws, "Component Life");

  const fileName = `Component_Life_Tracking.xlsx`;
  XLSX.writeFile(wb, fileName);
  console.log(`%c[EXPORT] DONE! File: ${fileName} (${excelRows.length} rows, ${maxCyclesFound} cycles)`, "color:#059669; font-weight:bold; font-size:13px;");
  msg(`<b>Đã xuất báo cáo theo bộ lọc thành công!</b><br>File: <code>${esc(fileName)}</code> (${excelRows.length} linh kiện, ${maxCyclesFound} cycles)`, false, 8000);
}

// ===== IMPORT EXCEL =====
function parseSheetMatrix(ws, type) {
  if (typeof XLSX === 'undefined') return [];
  console.log(`%c[IMPORT] parseSheetMatrix type=${type}`, "color:#d97706;");
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, cellDates: true, raw: true });
  if (!matrix || matrix.length < 2) { console.log("%c[IMPORT] Matrix too small", "color:#ef4444;"); return []; }
  const headers = (matrix.shift() || []).map(h => norm(String(h || "")));
  console.log(`%c[IMPORT] Headers: ${headers.join(', ')}`, "color:#6b7280;");
  const find = (...names) => headers.findIndex(header => names.includes(header));

  if (type === "shoot") {
    const dateIndex = find("date", "ngay", "month");
    const dieIndex = find("dieset", "moldname", "khuon", "mold", "moldnew", "olddieset");
    const partIndex = find("part", "partname", "tenlinhkien", "ten");
    const outputIndex = find("output", "shootnumber", "shoot", "pcs", "outputpcs", "shotcount");
    console.log(`%c[IMPORT] Shoot columns: date=${dateIndex}, die=${dieIndex}, part=${partIndex}, output=${outputIndex}`, "color:#6b7280;");
    if (dateIndex < 0 || outputIndex < 0) { console.log("%c[IMPORT] ERROR: Missing date or output column", "color:#ef4444;"); return []; }
    const shootMap = new Map();
    matrix.forEach(row => {
      if (!row || !row.length) return;
      const pName = partIndex >= 0 ? String(row[partIndex] || "").trim() : "";
      let die = dieIndex >= 0 ? String(row[dieIndex] || "").trim() : "";
      if (!die && pName) { const m = masterData.find(x => x.PartName && x.PartName.toLowerCase() === pName.toLowerCase()); if (m) die = m.NewDieSet || m.OldDieSet; }
      const isoDate = toIso(row[dateIndex]);
      const outVal = Number(String(row[outputIndex] || "0").replace(/,/g, ""));
      if (!isoDate || (!die && !pName) || isNaN(outVal) || outVal <= 0) return;
      const key = isoDate + "|" + pName + "|" + (die || pName);
      const existing = shootMap.get(key) || { Date: isoDate, Part: pName, DieSet: die || pName || "Unknown", Output: 0 };
      existing.Output += outVal; shootMap.set(key, existing);
    });
    console.log(`%c[IMPORT] Shoot parsed: ${shootMap.size} unique records`, "color:#059669;");
    return Array.from(shootMap.values());
  }

  const partIndex = find("part", "partname", "ten");
  const seriesIndex = find("series", "masolinhkien");
  const dieIndex = find("dieset", "moldname", "khuon", "mold");
  const dateIndex = find("replacedate", "ngaythay", "date");
  const labelIndex = find("code", "lot", "serial", "replacement", "linhkien", "component");
  console.log(`%c[IMPORT] Replacement columns: part=${partIndex}, series=${seriesIndex}, die=${dieIndex}, date=${dateIndex}, label=${labelIndex}`, "color:#6b7280;");
  if ([partIndex, seriesIndex, dieIndex, dateIndex].some(i => i < 0)) return [];
  const results = matrix.map(row => {
    if (!row || !row.length) return null;
    return { Part: String(row[partIndex] || "").trim(), Series: String(row[seriesIndex] || "").trim(), DieSet: String(row[dieIndex] || "").trim(), ReplaceDate: toIso(row[dateIndex]), Label: labelIndex >= 0 ? String(row[labelIndex] || "").trim() : "" };
  }).filter(row => row && row.Part && row.DieSet && row.ReplaceDate);
  console.log(`%c[IMPORT] Replacement parsed: ${results.length} records`, "color:#059669;");
  return results;
}

function importExcelFile(file) {
  if (!file) return;
  console.log(`%c[IMPORT] === Importing file: ${file.name} (${(file.size/1024).toFixed(1)}KB) ===`, "color:#4f46e5; font-weight:bold; font-size:13px;");
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'json') { console.log("%c[IMPORT] JSON backup file", "color:#6b7280;"); return; }
  if (typeof XLSX === 'undefined') { msg("SheetJS chua san sang.", true); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      console.log(`%c[IMPORT] File read: ${data.length} bytes`, "color:#6b7280;");
      const workbook = XLSX.read(data, { type: 'array', cellDates: false, raw: false });
      console.log(`%c[IMPORT] Sheets found: ${workbook.SheetNames.join(', ')}`, "color:#0284c7;");
      const messages = [];

      // Parse Shoot sheet
      const shootSheetName = workbook.SheetNames.find(n => /shoot/i.test(n));
      if (shootSheetName) {
        console.log(`%c[IMPORT] Processing shoot sheet: ${shootSheetName}`, "color:#d97706;");
        const rows = parseSheetMatrix(workbook.Sheets[shootSheetName], 'shoot');
        if (rows.length > 0) {
          db.shoot = rows.sort((a, b) => a.Date.localeCompare(b.Date) || a.DieSet.localeCompare(b.DieSet));
          db.rawShoot = JSON.parse(JSON.stringify(db.shoot));
          messages.push(`Shoot Data: ${rows.length.toLocaleString()} dong`);
          console.log(`%c[IMPORT] Shoot loaded: ${rows.length} records`, "color:#059669;");
        }
      }

      // Parse Master sheet
      const masterSheetName = workbook.SheetNames.find(n => /master|partlist/i.test(n));
      if (masterSheetName) {
        console.log(`%c[IMPORT] Processing master sheet: ${masterSheetName}`, "color:#d97706;");
        const csvText = XLSX.utils.sheet_to_csv(workbook.Sheets[masterSheetName]);
        const list = parseMasterCsv(csvText);
        if (list.length > 0) { updateMasterData(list); messages.push(`Master: ${list.length} linh kien`); console.log(`%c[IMPORT] Master loaded: ${list.length}`, "color:#059669;"); }
      }

      if (messages.length === 0) { msg(`Khong tim thay du lieu hop le trong file ${esc(file.name)}.`, true); return; }

      save(); populatePartList(); buildMonthOptions(); rebuild(false); renderMonth(); renderStockTable(); renderMetrics();
      console.log(`%c[IMPORT] === Import complete! ===`, "color:#059669; font-weight:bold; font-size:13px;");
      msg(`Da nap: ${esc(file.name)}<br>` + messages.join("<br>"), false, 8500);
    } catch (err) { console.error("[IMPORT] ERROR:", err); msg(`Loi: ${err.message}`, true); }
  };
  reader.readAsArrayBuffer(file);
}

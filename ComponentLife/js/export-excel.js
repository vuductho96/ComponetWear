/* export-excel.js — Tab-Aware Excel Exporter System
   - Tab 'month' (View): Month View Matrix Excel (Replacements & Shoots by day)
   - Tab 'stock' (Dashboard): Unified Dashboard Excel with active column configuration
   - Tab 'chart' (Analytics): Professional Executive 3-Sheet Report (01_REPORT, 02_COMPONENT_SUMMARY, 03_REPLACEMENT_LOG)
*/
'use strict';

function exportExcelFull() {
  if (currentActiveTab === "chart" || currentActiveTab === "analytics") {
    return exportProfessionalReportExcel();
  }
  if (currentActiveTab === "month" || currentActiveTab === "view") {
    return exportMonthViewExcel();
  }
  return exportStandardLifeTrackingExcel();
}

function exportMonthViewExcel() {
  if ((!db.replacements || !db.replacements.length) && (!db.shoot || !db.shoot.length)) {
    return msg("Hãy nạp dữ liệu trước khi xuất Excel.", true);
  }

  const ym = typeof selectedMonth === 'function' ? selectedMonth() : '';
  const ySel = typeof selectedYear === 'function' ? selectedYear() : '';
  
  let days = 31;
  let filePeriodSlug = "All";

  if (ym) {
    const [y, m] = ym.split("-").map(Number);
    days = new Date(y, m, 0).getDate();
    filePeriodSlug = ym;
  } else if (ySel) {
    filePeriodSlug = ySel;
  }

  // Build replacement and shoot maps
  const repByPartMold = new Map();
  (db.replacements || []).forEach(r => {
    const lbl = String(r.Label || "").trim();
    if (!r.ReplaceDate || lbl === "-" || lbl === "0" || lbl === "·") return;
    if (ym && monthKey(r.ReplaceDate) !== ym) return;
    if (ySel && !r.ReplaceDate.startsWith(ySel)) return;

    const rPart = String(r.Part || "").toLowerCase().trim();
    const rDie = String(r.DieSet || r.NewDieSet || r.OldDieSet || "").toLowerCase().trim();
    const keys = [`${rPart}|${rDie}`];
    const master = typeof findMasterItem === 'function' ? findMasterItem(rPart, rDie, r.Series) : null;
    if (master) {
      if (master.NewDieSet) keys.push(`${rPart}|${String(master.NewDieSet).toLowerCase().trim()}`);
      if (master.OldDieSet) keys.push(`${rPart}|${String(master.OldDieSet).toLowerCase().trim()}`);
    }
    keys.forEach(k => {
      if (!repByPartMold.has(k)) repByPartMold.set(k, []);
      repByPartMold.get(k).push(r);
    });
  });

  const shootByMold = new Map();
  (db.shoot || []).forEach(row => {
    if (!row.Date || !row.Output || Number(row.Output) <= 0) return;
    if (ym && monthKey(row.Date) !== ym) return;
    if (ySel && !row.Date.startsWith(ySel)) return;
    const rDie = String(row.DieSet || "").toLowerCase().trim();
    if (rDie) {
      if (!shootByMold.has(rDie)) shootByMold.set(rDie, []);
      shootByMold.get(rDie).push(row);
    }
  });

  const allPartsList = typeof getPartsToRender === 'function' ? getPartsToRender('month') : [];

  // Sort parts with replacements first
  allPartsList.sort((a, b) => {
    const pA = (a.part || '').toLowerCase(), dNewA = (a.moldNew || a.moldOld || '').toLowerCase();
    const pB = (b.part || '').toLowerCase(), dNewB = (b.moldNew || b.moldOld || '').toLowerCase();
    const countA = (repByPartMold.get(`${pA}|${dNewA}`) || []).length;
    const countB = (repByPartMold.get(`${pB}|${dNewB}`) || []).length;
    if ((countA > 0) !== (countB > 0)) return countB > 0 ? 1 : -1;
    if (countA !== countB) return countB - countA;
    return a.part.localeCompare(b.part, undefined, { numeric: true, sensitivity: 'base' });
  });

  const excelRows = [];
  allPartsList.forEach((item, idx) => {
    const dieSet = item.moldNew || item.moldOld || item.part;
    const partName = item.part;
    const seriesVal = item.series || (typeof getSeriesForPart === 'function' ? getSeriesForPart(partName, dieSet) : "-") || "-";
    const moldCombined = item.moldCombined || (typeof formatMoldDisplay === 'function' ? formatMoldDisplay(item.moldOld, item.moldNew || dieSet) : dieSet);
    const pLower = String(partName || "").toLowerCase().trim();
    const dLower = String(dieSet || "").toLowerCase().trim();

    const rawReps = repByPartMold.get(`${pLower}|${dLower}`) || [];
    const replacementMap = new Map();
    rawReps.forEach(row => {
      const dayNum = Number(row.ReplaceDate.slice(8, 10));
      const val = Number(String(row.Label || "").trim().replace(/,/g, "")) || 1;
      const existing = replacementMap.get(dayNum) || { day: dayNum, totalQty: 0 };
      existing.totalQty += val;
      replacementMap.set(dayNum, existing);
    });

    const rawShoots = shootByMold.get(dLower) || [];
    const shootMap = new Map();
    rawShoots.forEach(row => {
      const dayNum = Number(row.Date.slice(8, 10));
      const existing = shootMap.get(dayNum) || { Output: 0 };
      existing.Output += (Number(row.Output) || 0);
      shootMap.set(dayNum, existing);
    });

    const displayShootMap = new Map();
    shootMap.forEach((valObj, dayNum) => {
      if (valObj.Output > 0) displayShootMap.set(dayNum, valObj.Output);
    });

    replacementMap.forEach((repItem, repDay) => {
      if (displayShootMap.has(repDay)) {
        const valToShift = displayShootMap.get(repDay);
        if (valToShift > 0) {
          displayShootMap.delete(repDay);
          displayShootMap.set(repDay + 1, (displayShootMap.get(repDay + 1) || 0) + valToShift);
        }
      }
    });

    let totalReplacementPcs = 0;
    replacementMap.forEach(repItem => { totalReplacementPcs += repItem.totalQty; });
    const totalShoot = Array.from(displayShootMap.values()).reduce((sum, val) => sum + (Number(val) || 0), 0);

    // Row 1: Replacement
    const repRow = {
      "No.": idx + 1,
      "Part": partName,
      "Series": seriesVal,
      "Mold / DieSet": moldCombined,
      "Type": "Replacement (Pcs)"
    };
    for (let d = 1; d <= days; d++) {
      const repItem = replacementMap.get(d);
      repRow[`D${String(d).padStart(2, '0')}`] = repItem ? repItem.totalQty : "";
    }
    repRow["Total"] = totalReplacementPcs > 0 ? totalReplacementPcs : "";
    excelRows.push(repRow);

    // Row 2: Shoot
    const shootRow = {
      "No.": "",
      "Part": partName,
      "Series": seriesVal,
      "Mold / DieSet": moldCombined,
      "Type": "Shoot (Output)"
    };
    for (let d = 1; d <= days; d++) {
      const out = displayShootMap.get(d);
      shootRow[`D${String(d).padStart(2, '0')}`] = out > 0 ? out : "";
    }
    shootRow["Total"] = totalShoot > 0 ? totalShoot : "";
    excelRows.push(shootRow);
  });

  const ws = XLSX.utils.json_to_sheet(excelRows);
  if (excelRows.length > 0) {
    const colKeys = Object.keys(excelRows[0]);
    ws['!cols'] = colKeys.map(k => {
      if (k === 'No.') return { wch: 6 };
      if (k === 'Part') return { wch: 14 };
      if (k === 'Series') return { wch: 10 };
      if (k === 'Mold / DieSet') return { wch: 24 };
      if (k === 'Type') return { wch: 18 };
      if (k === 'Total') return { wch: 10 };
      return { wch: 6 };
    });
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Month_View");

  const fileName = `ComponetWear_View_${filePeriodSlug}.xlsx`;
  XLSX.writeFile(wb, fileName);
  console.log(`%c[EXPORT:MONTH] DONE! File: ${fileName} (${excelRows.length} rows)`, "color:#059669; font-weight:bold;");
  msg(`<b>Đã xuất file Excel theo dõi ngày/tháng thành công!</b><br>File: <code>${esc(fileName)}</code>`, false, 8000);
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

      let res = null;
      try {
        res = await fetch('/api/export-report-excel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(payload)
        });
      } catch (e1) {
        try {
          res = await fetch('http://127.0.0.1:8787/api/export-report-excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(payload)
          });
        } catch (e2) {}
      }

      if (res && res.ok) {
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
          msg(`<b>Xuất báo cáo Excel thành công!</b><br>Biểu đồ vẽ trực tiếp từ bảng số liệu thật (True Dynamic Excel Chart).<br>File: <code>${esc(fileName)}</code>`, false, 8000);
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

    // Header Block with dynamic period
    const formattedPeriod = formatReportPeriodTitle(periodLabel);
    ws1.mergeCells('B2:L2');
    const titleCell = ws1.getCell('B2');
    titleCell.value = `TOP 10 LINH KIỆN THAY NHIỀU NHẤT - ${formattedPeriod}`;
    titleCell.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FF1E293B' } };
    titleCell.alignment = { vertical: 'middle' };
    ws1.getRow(2).height = 24;

    // Set row heights for chart placement (Rows 4 to 20)
    const chartRowStart = 4;
    const chartRowEnd = 20;
    for (let r = chartRowStart; r <= chartRowEnd; r++) {
      ws1.getRow(r).height = 18;
    }

    // Section Header: Summary Table with dynamic period
    const tableHeaderRow = chartRowEnd + 2;
    ws1.getRow(tableHeaderRow - 1).height = 20;
    ws1.mergeCells(`B${tableHeaderRow - 1}:L${tableHeaderRow - 1}`);
    const tblTitle = ws1.getCell(`B${tableHeaderRow - 1}`);
    tblTitle.value = `BẢNG CHI TIẾT TOP 10 LINH KIỆN THAY NHIỀU NHẤT (${formattedPeriod})`;
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

    // ==========================================
    // SHEET 2: 02_COMPONENT_SUMMARY (Only Components with Replacements)
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

    // Populate Rows: ONLY components that have recorded replacements in the active scope
    const replacedComponents = componentsData.filter(c => (Number(c.replacementCount) || 0) > 0 || (Number(c.totalPartsReplacedPcs) || 0) > 0);

    replacedComponents.forEach((c, idx) => {
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

    ws2.autoFilter = { from: 'A1', to: `L${replacedComponents.length + 1}` };

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

    // ==========================================
    // SHEET 4: 04_FULL_COMPONENTS (Full Fleet Scope)
    // ==========================================
    const ws4 = wb.addWorksheet('04_FULL_COMPONENTS', {
      views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
    });

    ws4.columns = summaryColumns;

    ws4.getRow(1).height = 22;
    ws4.getRow(1).eachCell((cell, colNum) => {
      cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.alignment = { horizontal: colNum >= 4 && colNum <= 11 ? 'right' : 'center', vertical: 'middle' };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF0F172A' } } };
    });

    // Smart Sort: Active replaced components first, then active shots/cycles, pure N/A pushed to bottom
    const sortedFullComponents = [...componentsData].sort((a, b) => {
      const repA = (Number(a.replacementCount) || 0) + (Number(a.totalPartsReplacedPcs) || 0);
      const repB = (Number(b.replacementCount) || 0) + (Number(b.totalPartsReplacedPcs) || 0);
      const actA = (Number(a.currentShotCount) || 0) > 0 || (Number(a.totalLifetimeShots) || 0) > 0 || (Number(a.cycleCount) || 0) > 0;
      const actB = (Number(b.currentShotCount) || 0) > 0 || (Number(b.totalLifetimeShots) || 0) > 0 || (Number(b.cycleCount) || 0) > 0;

      const scoreA = repA > 0 ? 3 : (actA ? 2 : 1);
      const scoreB = repB > 0 ? 3 : (actB ? 2 : 1);

      if (scoreA !== scoreB) return scoreB - scoreA;
      if (scoreA === 3) {
        if (repA !== repB) return repB - repA;
      } else if (scoreA === 2) {
        const shotDiff = (Number(b.currentShotCount) || 0) - (Number(a.currentShotCount) || 0);
        if (shotDiff !== 0) return shotDiff;
      }
      return (a.part || '').localeCompare(b.part || '', undefined, { numeric: true, sensitivity: 'base' });
    });

    sortedFullComponents.forEach((c, idx) => {
      const row = ws4.addRow({
        no: idx + 1,
        part: c.part,
        moldSeries: c.moldSeries || `${c.series || '-'}/${c.moldName || ''}`,
        replacementCount: c.replacementCount || 0,
        totalPartsReplacedPcs: c.totalPartsReplacedPcs || 0,
        cycleCount: c.cycleCount || 0,
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

    ws4.autoFilter = { from: 'A1', to: `L${sortedFullComponents.length + 1}` };

    // 5. WRITE BUFFER, INJECT TRUE OPENXML DYNAMIC EXCEL CHART AND TRIGGER DOWNLOAD
    const fileName = sanitizeFilename(`ComponentWear_Report_${filePeriodSlug}.xlsx`);
    const rawBuffer = await wb.xlsx.writeBuffer();
    const finalBuffer = await injectOpenXMLChartIntoExcelBuffer(rawBuffer, top10Components, formattedPeriod);
    const blob = new Blob([finalBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    
    // Browser download anchor
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    console.log(`%c[EXPORT] SUCCESS (Native OpenXML Chart): ${fileName} (${componentsData.length} components, ${allFilteredReplacements.length} logs)`, "color:#059669; font-weight:bold; font-size:13px;");
    msg(`<b>Xuất báo cáo Excel thành công!</b><br>Biểu đồ vẽ trực tiếp từ bảng số liệu thật (True Dynamic Excel Chart).<br>File: <code>${esc(fileName)}</code><br>Gồm 4 Sheet: 01_REPORT, 02_COMPONENT_SUMMARY, 03_REPLACEMENT_LOG, 04_FULL_COMPONENTS`, false, 8000);
  } catch (err) {
    console.error("[EXPORT] ERROR:", err);
    msg(`Lỗi khi tạo file Excel: ${err.message}`, true, 8000);
  }
}

// ===== PURE CLIENT-SIDE OPENXML DYNAMIC CHART INJECTOR (ZERO IMAGE / 100% TRUE EXCEL CHART) =====
async function injectOpenXMLChartIntoExcelBuffer(xlsxBuffer, top10Items, periodTitle) {
  if (typeof JSZip === 'undefined' && (typeof window === 'undefined' || !window.JSZip)) {
    console.warn("[EXPORT] JSZip not loaded, returning original buffer");
    return xlsxBuffer;
  }
  const ZipConstructor = typeof JSZip !== 'undefined' ? JSZip : window.JSZip;

  try {
    const zip = await ZipConstructor.loadAsync(xlsxBuffer);
    const headerRow = 22;
    const startRow = 23;
    const items = Array.isArray(top10Items) ? top10Items : [];
    const count = Math.max(1, items.length);
    const endRow = startRow + count - 1;

    let strPts = `<ptCount val="${items.length}"/>`;
    let valFPts = `<ptCount val="${items.length}"/>`;
    let valGPts = `<ptCount val="${items.length}"/>`;

    items.forEach((item, i) => {
      strPts += `<pt idx="${i}"><v>${escapeXmlStr(item.part || '')}</v></pt>`;
      valFPts += `<pt idx="${i}"><v>${Number(item.replacementCount) || 0}</v></pt>`;
      valGPts += `<pt idx="${i}"><v>${Number(item.totalPartsReplacedPcs) || 0}</v></pt>`;
    });

    const fullChartTitle = `TOP 10 LINH KIỆN THAY NHIỀU NHẤT - ${periodTitle || 'BÁO CÁO'}`;

    // 1. Exact OpenXML Chart XML matching user reference layout
    const chartXml = `<chartSpace xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <style val="10"/>
  <chart>
    <title>
      <tx>
        <rich>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:pPr><a:defRPr sz="1300" b="1"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill></a:defRPr></a:pPr>
            <a:r>
              <a:rPr lang="vi-VN" sz="1300" b="1"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill></a:rPr>
              <a:t>${escapeXmlStr(fullChartTitle)}</a:t>
            </a:r>
          </a:p>
        </rich>
      </tx>
      <layout/>
    </title>
    <plotArea>
      <layout/>
      <barChart>
        <barDir val="col"/>
        <grouping val="clustered"/>
        <ser>
          <idx val="0"/>
          <order val="0"/>
          <tx><strRef><f>'01_REPORT'!$F$${headerRow}</f><strCache><ptCount val="1"/><pt idx="0"><v>Lượt Thay</v></pt></strCache></strRef></tx>
          <spPr>
            <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
          </spPr>
          <cat>
            <strRef>
              <f>'01_REPORT'!$C$${startRow}:$C$${endRow}</f>
              <strCache>${strPts}</strCache>
            </strRef>
          </cat>
          <val>
            <numRef>
              <f>'01_REPORT'!$F$${startRow}:$F$${endRow}</f>
              <numCache><formatCode>#,##0</formatCode>${valFPts}</numCache>
            </numRef>
          </val>
        </ser>
        <gapWidth val="140"/>
        <axId val="10"/>
        <axId val="100"/>
      </barChart>
      <lineChart>
        <grouping val="standard"/>
        <ser>
          <idx val="1"/>
          <order val="1"/>
          <tx><strRef><f>'01_REPORT'!$G$${headerRow}</f><strCache><ptCount val="1"/><pt idx="0"><v>Số Lượng (Pcs)</v></pt></strCache></strRef></tx>
          <spPr>
            <a:ln w="31750"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></a:ln>
          </spPr>
          <marker>
            <symbol val="circle"/>
            <size val="5"/>
            <spPr>
              <a:solidFill><a:srgbClr val="C00000"/></a:solidFill>
              <a:ln w="9525"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></a:ln>
            </spPr>
          </marker>
          <val>
            <numRef>
              <f>'01_REPORT'!$G$${startRow}:$G$${endRow}</f>
              <numCache><formatCode>#,##0</formatCode>${valGPts}</numCache>
            </numRef>
          </val>
          <smooth val="1"/>
        </ser>
        <dLbls>
          <showLegendKey val="0"/>
          <showVal val="1"/>
          <showCatName val="0"/>
          <showSerName val="0"/>
          <showPercent val="0"/>
          <dLblPos val="t"/>
          <txPr>
            <a:bodyPr/>
            <a:lstStyle/>
            <a:p><a:pPr><a:defRPr sz="900" b="1"><a:solidFill><a:srgbClr val="900000"/></a:solidFill></a:defRPr></a:pPr></a:p>
          </txPr>
        </dLbls>
        <axId val="10"/>
        <axId val="200"/>
      </lineChart>
      <catAx>
        <axId val="10"/>
        <scaling><orientation val="minMax"/></scaling>
        <axPos val="b"/>
        <majorTickMark val="none"/>
        <minorTickMark val="none"/>
        <tickLblPos val="nextTo"/>
        <crossAx val="100"/>
        <lblOffset val="100"/>
        <txPr>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="1E293B"/></a:solidFill></a:defRPr></a:pPr></a:p>
        </txPr>
      </catAx>
      <valAx>
        <axId val="100"/>
        <scaling><orientation val="minMax"/></scaling>
        <axPos val="l"/>
        <majorGridlines>
          <spPr>
            <a:ln w="9525"><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln>
          </spPr>
        </majorGridlines>
        <majorTickMark val="none"/>
        <minorTickMark val="none"/>
        <crossAx val="10"/>
        <crosses val="autoZero"/>
      </valAx>
      <valAx>
        <axId val="200"/>
        <scaling><orientation val="minMax"/></scaling>
        <axPos val="r"/>
        <majorTickMark val="none"/>
        <minorTickMark val="none"/>
        <crossAx val="10"/>
        <crosses val="max"/>
      </valAx>
    </plotArea>
    <legend>
      <legendPos val="b"/>
      <layout/>
      <txPr>
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p><a:pPr><a:defRPr sz="900"/></a:pPr></a:p>
      </txPr>
    </legend>
    <plotVisOnly val="1"/>
    <dispBlanksAs val="gap"/>
  </chart>
</chartSpace>`;
    zip.file('xl/charts/chart1.xml', chartXml);

    // 2. Exact OpenXML Drawing XML (Ample height so component names and labels render crisply)
    const drawingXml = `<wsDr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><oneCellAnchor><from><col>1</col><colOff>0</colOff><row>3</row><rowOff>0</rowOff></from><ext cx="9800000" cy="4100000" /><graphicFrame><nvGraphicFramePr><cNvPr id="1" name="Chart 1" /><cNvGraphicFramePr /></nvGraphicFramePr><xfrm /><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1" /></a:graphicData></a:graphic></graphicFrame><clientData /></oneCellAnchor></wsDr>`;
    zip.file('xl/drawings/drawing1.xml', drawingXml);

    // 3. Exact Drawing Rels
    const drawingRelsXml = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="/xl/charts/chart1.xml" Id="rId1" /></Relationships>`;
    zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml);

    // 4. Exact Sheet1 Rels
    const sheet1RelsContent = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawing1.xml" Id="rId1" /></Relationships>`;
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', sheet1RelsContent);

    // 5. Update Sheet1 XML (Drawing MUST be placed at the very end before </worksheet>)
    const sheet1File = zip.file('xl/worksheets/sheet1.xml');
    if (sheet1File) {
      let s1 = await sheet1File.async('text');
      s1 = s1.replace(/<drawing[^>]*\/>/g, '');
      s1 = s1.replace('</worksheet>', '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1" /></worksheet>');
      zip.file('xl/worksheets/sheet1.xml', s1);
    }

    // 6. Content Types
    const ctFile = zip.file('[Content_Types].xml');
    if (ctFile) {
      let ct = await ctFile.async('text');
      if (!ct.includes('/xl/charts/chart1.xml')) {
        const extra = `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml" /><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml" /></Types>`;
        ct = ct.replace('</Types>', extra);
        zip.file('[Content_Types].xml', ct);
      }
    }

    const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    return arrayBuffer;
  } catch (injectErr) {
    console.warn("[EXPORT] OpenXML chart injection fallback to raw buffer:", injectErr);
    return xlsxBuffer;
  }
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

// Helper: Format Period Title for Professional Reports
function formatReportPeriodTitle(periodLabel) {
  if (!periodLabel || periodLabel === 'All') return 'TẤT CẢ THỜI GIAN';
  const mMatch = String(periodLabel).match(/^([A-Za-z]{3})-(\d{4})$/);
  if (mMatch) {
    const monthNames = { 'Jan':'01', 'Feb':'02', 'Mar':'03', 'Apr':'04', 'May':'05', 'Jun':'06', 'Jul':'07', 'Aug':'08', 'Sep':'09', 'Oct':'10', 'Nov':'11', 'Dec':'12' };
    const mNum = monthNames[mMatch[1]] || mMatch[1];
    return `THÁNG ${mNum}/${mMatch[2]}`;
  }
  const isoMatch = String(periodLabel).match(/^(\d{4})-(\d{2})$/);
  if (isoMatch) {
    return `THÁNG ${isoMatch[2]}/${isoMatch[1]}`;
  }
  if (/^\d{4}$/.test(String(periodLabel))) {
    return `NĂM ${periodLabel}`;
  }
  return String(periodLabel).toUpperCase();
}

// Helper: XML string escape
function escapeXmlStr(str) {
  return String(str || '').replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
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

  // Index ALL historical shoot data
  const shootsByMold = new Map();
  (db.shoot || []).forEach(s => {
    if (!s.Date || !s.Output || Number(s.Output) <= 0) return;

    const d = String(s.DieSet || '').toLowerCase().trim();
    const p = String(s.Part || '').toLowerCase().trim();
    if (d) { if (!shootsByMold.has(d)) shootsByMold.set(d, []); shootsByMold.get(d).push(s); }
    if (p && p !== d) { if (!shootsByMold.has(p)) shootsByMold.set(p, []); shootsByMold.get(p).push(s); }
  });

  // Index 1: All historical replacements; Index 2: Period filtered replacements
  const allHistoricalReps = new Map();
  const periodReps = new Map();

  (db.replacements || []).forEach(r => {
    const lbl = String(r.Label || '').trim();
    if (!r.ReplaceDate || lbl === '-' || lbl === '0' || lbl === '·') return;

    const p = String(r.Part || '').toLowerCase().trim();
    const d = String(r.DieSet || r.NewDieSet || r.OldDieSet || '').toLowerCase().trim();
    const key = `${p}|${d}`;

    if (!allHistoricalReps.has(key)) allHistoricalReps.set(key, []);
    allHistoricalReps.get(key).push(r);

    const inPeriod = (!dFilter || r.ReplaceDate === dFilter) &&
                     (!ymFilter || r.ReplaceDate.startsWith(ymFilter)) &&
                     (!yFilter || ymFilter || r.ReplaceDate.startsWith(yFilter));
    if (inPeriod) {
      if (!periodReps.has(key)) periodReps.set(key, []);
      periodReps.get(key).push(r);
    }
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
    const k1 = `${pLower}|${dNewLower}`, k2 = `${pLower}|${dOldLower}`;

    // Period replacements (for period Replace Time & Qty Used)
    let periodRepsList = [];
    if (periodReps.has(k1)) periodRepsList.push(...periodReps.get(k1));
    if (k2 !== k1 && periodReps.has(k2)) periodRepsList.push(...periodReps.get(k2));

    const repSet = new Set(), sortedPeriodReps = [];
    periodRepsList.sort((a, b) => (a.ReplaceDate || '').localeCompare(b.ReplaceDate || '')).forEach(r => {
      const rk = `${r.ReplaceDate}|${r.RequestId || ''}|${r.Label}`;
      if (!repSet.has(rk)) { repSet.add(rk); sortedPeriodReps.push(r); }
    });

    const replacementCount = sortedPeriodReps.length;
    const totalPartsReplacedPcs = sortedPeriodReps.reduce((sum, r) => sum + (Number(r.Label) || 1), 0);

    // All-time historical replacements (for absolute latest replacement date & cycles)
    let allHistoryRepsList = [];
    if (allHistoricalReps.has(k1)) allHistoryRepsList.push(...allHistoricalReps.get(k1));
    if (k2 !== k1 && allHistoricalReps.has(k2)) allHistoryRepsList.push(...allHistoricalReps.get(k2));

    const allRepSet = new Set(), sortedHistoryReps = [];
    allHistoryRepsList.sort((a, b) => (a.ReplaceDate || '').localeCompare(b.ReplaceDate || '')).forEach(r => {
      const rk = `${r.ReplaceDate}|${r.RequestId || ''}|${r.Label}`;
      if (!allRepSet.has(rk)) { allRepSet.add(rk); sortedHistoryReps.push(r); }
    });

    // All historical shoots sorted by date
    let allShoots = [];
    if (dNewLower && shootsByMold.has(dNewLower)) allShoots.push(...shootsByMold.get(dNewLower));
    if (dOldLower && dOldLower !== dNewLower && shootsByMold.has(dOldLower)) allShoots.push(...shootsByMold.get(dOldLower));
    if (pLower && shootsByMold.has(pLower) && !allShoots.length) allShoots.push(...shootsByMold.get(pLower));

    const shootSet = new Set(), sortedShoots = [];
    allShoots.sort((a, b) => (a.Date || '').localeCompare(b.Date || '')).forEach(s => {
      const sk = `${s.Date}|${s.Output}|${s.DieSet}`;
      if (!shootSet.has(sk)) { shootSet.add(sk); sortedShoots.push(s); }
    });

    const totalLifetimeShots = sortedShoots.reduce((sum, s) => sum + (Number(s.Output) || 0), 0);

    const cycles = [];
    if (sortedHistoryReps.length > 0) {
      const c1 = sortedShoots.filter(s => s.Date < sortedHistoryReps[0].ReplaceDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0);
      if (c1 > 0) cycles.push(c1);
      for (let i = 0; i < sortedHistoryReps.length - 1; i++) {
        const cN = sortedShoots.filter(s => s.Date >= sortedHistoryReps[i].ReplaceDate && s.Date < sortedHistoryReps[i + 1].ReplaceDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0);
        if (cN > 0) cycles.push(cN);
      }
    }

    if (cycles.length > maxCyclesFound) maxCyclesFound = cycles.length;

    const averageShotLife = cycles.length > 0 ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : (totalLifetimeShots > 0 ? totalLifetimeShots : '');
    const minShotLife = cycles.length > 0 ? Math.min(...cycles) : '';
    const maxShotLife = cycles.length > 0 ? Math.max(...cycles) : '';

    // CURRENT SHOT: ALWAYS calculated from absolute latest replacement date up to the present date!
    const absoluteLastRepDate = sortedHistoryReps.length > 0 ? sortedHistoryReps[sortedHistoryReps.length - 1].ReplaceDate : null;
    const currentShotCount = absoluteLastRepDate
      ? sortedShoots.filter(s => s.Date >= absoluteLastRepDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0)
      : (totalLifetimeShots > 0 ? totalLifetimeShots : '');

    const st = typeof getStockItem === 'function' ? getStockItem(part, moldNew) : {};
    const masterItem = typeof findMasterItem === 'function' ? findMasterItem(part, moldNew, series) : null;
    const stock = Number(st.stock !== undefined ? st.stock : (masterItem ? masterItem.StockLeft : 0)) || 0;
    let minStock = (st && st.minStock !== undefined) ? Number(st.minStock) || 1 : (masterItem && masterItem.StandardStock !== undefined ? Number(masterItem.StandardStock) || 1 : 1);
    const lastRepDate = absoluteLastRepDate || '';

    rowsData.push({
      no: 0,
      part,
      series,
      moldNew,
      moldOld,
      moldSeries,
      stock,
      minStock,
      status: statusLabel,
      replacementCount: replacementCount > 0 ? replacementCount : '',
      totalPartsReplacedPcs: totalPartsReplacedPcs > 0 ? totalPartsReplacedPcs : '',
      averageShotLife,
      minShotLife,
      maxShotLife,
      currentShotCount,
      lastRepDate,
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

  const visibleCols = typeof getDashboardVisibleCols === 'function' ? getDashboardVisibleCols() : DEFAULT_DASHBOARD_COLS;

  const excelRows = rowsData.map(r => {
    const rowObj = {
      "No.": r.no,
      "Part": r.part,
      "Mold / Series": r.moldSeries
    };

    if (visibleCols.timesCount) rowObj["Replace Time"] = r.replacementCount;
    if (visibleCols.used) rowObj["Qty Used"] = r.totalPartsReplacedPcs;
    if (visibleCols.avgShot) rowObj["Avg Shot"] = r.averageShotLife;
    if (visibleCols.currentShot) rowObj["Current Shot"] = r.currentShotCount;
    if (visibleCols.minShot) rowObj["Min Shot"] = r.minShotLife;
    if (visibleCols.maxShot) rowObj["Max Shot"] = r.maxShotLife;
    if (visibleCols.minMaxShot) rowObj["Min - Max Shot"] = (r.minShotLife && r.maxShotLife) ? `${r.minShotLife} - ${r.maxShotLife}` : '';
    if (visibleCols.wearPercent) {
      const pct = r.averageShotLife > 0 ? Math.min(100, Math.round((r.currentShotCount / r.averageShotLife) * 100)) : 0;
      rowObj["Tiến Độ Mòn (%)"] = `${pct}%`;
    }
    if (visibleCols.cycleCount) rowObj["Số Chu Kỳ"] = r.cycles ? r.cycles.length : 0;
    if (visibleCols.cycles) {
      for (let c = 1; c <= maxCyclesFound; c++) {
        rowObj[`Cycle ${c}`] = (r.cycles && r.cycles[c - 1] !== undefined) ? r.cycles[c - 1] : '';
      }
    }
    if (visibleCols.lastRepDate) rowObj["Last Replacement"] = r.lastRepDate || '';
    if (visibleCols.stock) rowObj["Tồn Kho"] = r.stock;
    if (visibleCols.minStock) rowObj["Mức Min"] = r.minStock;
    if (visibleCols.status) rowObj["Trạng Thái"] = r.status;
    if (visibleCols.moldOld) rowObj["Mã Khuôn Cũ"] = r.moldOld || '';
    if (visibleCols.moldNew) rowObj["Mã Khuôn Mới"] = r.moldNew || '';
    return rowObj;
  });

  const ws = XLSX.utils.json_to_sheet(excelRows);
  if (excelRows.length > 0) {
    const colKeys = Object.keys(excelRows[0]);
    ws['!cols'] = colKeys.map(k => {
      if (k === 'No.') return { wch: 6 };
      if (k === 'Part') return { wch: 14 };
      if (k === 'Mold / Series') return { wch: 28 };
      if (k === 'Trạng Thái') return { wch: 14 };
      if (k === 'Lần Thay Cuối') return { wch: 14 };
      if (k.startsWith('Cycle')) return { wch: 13 };
      return { wch: 12 };
    });
  }
  XLSX.utils.book_append_sheet(wb, ws, "Dashboard");

  const fileName = `Component_Life_Dashboard.xlsx`;
  XLSX.writeFile(wb, fileName);
  console.log(`%c[EXPORT] DONE! File: ${fileName} (${excelRows.length} rows, dynamic columns based on Dashboard)`, "color:#059669; font-weight:bold; font-size:13px;");
  msg(`<b>Đã xuất báo cáo Dashboard thành công!</b><br>File: <code>${esc(fileName)}</code> (${excelRows.length} linh kiện, đồng bộ cột Dashboard)`, false, 8000);
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

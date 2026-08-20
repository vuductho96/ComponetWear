/* export-excel.js - Single Unified Excel export: Component_Life_Tracking.xlsx */
'use strict';

function exportExcelFull() {
  if ((!db.replacements || !db.replacements.length) && (!db.shoot || !db.shoot.length) && (!masterData || !masterData.length)) {
    return msg("Hay nap du lieu truoc khi xuat Excel.", true);
  }
  if (typeof XLSX === 'undefined') return msg("Thu vien SheetJS chua san sang.", true);
  if (currentActiveTab === "builder") return exportBuilderReport();

  console.log("%c[EXPORT] Starting Component_Life_Tracking export with active filters...", "color:#4f46e5; font-weight:bold;");

  const wb = XLSX.utils.book_new();

  // Get active filters from UI toolbar
  const ymFilter = selectedMonth(); // e.g. "2026-08"
  const yFilter = selectedYear();   // e.g. "2026"
  const dFilter = selectedDay();    // e.g. "2026-08-15"

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
  const allParts = getPartsToRender();

  let maxCyclesFound = 3;
  const rowsData = [];

  allParts.forEach((item, index) => {
    const part = item.part;
    const series = item.series || '-';
    const moldNew = item.moldNew || item.moldOld || item.part;
    const moldOld = item.moldOld || '';
    
    let partCode = `${part}/${series}/${moldOld || '-'}/${moldNew || '-'}`;
    if (moldOld && moldNew && moldOld.toLowerCase() === moldNew.toLowerCase()) {
      partCode = `${part}/${series}/${moldNew}`;
    } else if (!moldOld || !moldNew) {
      partCode = `${part}/${series}/${moldNew || moldOld || '-'}`;
    }

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

    // Dynamic cycles - NO LIMIT of 3 (supports unlimited tracking)
    if (cycles.length > maxCyclesFound) maxCyclesFound = cycles.length;

    const averageShotLife = cycles.length > 0 ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : (totalLifetimeShots > 0 ? totalLifetimeShots : '');
    const minShotLife = cycles.length > 0 ? Math.min(...cycles) : '';
    const maxShotLife = cycles.length > 0 ? Math.max(...cycles) : '';
    const currentShotCount = replacementCount > 0 ? sortedShoots.filter(s => s.Date >= sortedReps[sortedReps.length - 1].ReplaceDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0) : (totalLifetimeShots > 0 ? totalLifetimeShots : '');

    rowsData.push({
      no: index + 1,
      partCode,
      replacementCount: replacementCount > 0 ? replacementCount : '',
      totalPartsReplacedPcs: totalPartsReplacedPcs > 0 ? totalPartsReplacedPcs : '',
      averageShotLife,
      minShotLife,
      maxShotLife,
      currentShotCount,
      cycles
    });
  });

  const excelRows = rowsData.map(r => {
    const rowObj = {
      "No.": r.no,
      "Part Code": r.partCode,
      "Total Replacement Count": r.replacementCount,
      "Total Parts Replaced (pcs)": r.totalPartsReplacedPcs,
      "Average Shot Life": r.averageShotLife,
      "Min. Shot Life": r.minShotLife,
      "Max. Shot Life": r.maxShotLife,
      "Current Shot Count": r.currentShotCount
    };
    for (let c = 1; c <= maxCyclesFound; c++) {
      rowObj[`Cycle ${c} Shot`] = (r.cycles && r.cycles[c - 1] !== undefined) ? r.cycles[c - 1] : '';
    }
    return rowObj;
  });

  const ws = XLSX.utils.json_to_sheet(excelRows);
  const cols = [
    { wch: 6 },   // No.
    { wch: 34 },  // Part Code
    { wch: 25 },  // Total Replacement Count
    { wch: 28 },  // Total Parts Replaced (pcs)
    { wch: 18 },  // Average Shot Life
    { wch: 15 },  // Min. Shot Life
    { wch: 15 },  // Max. Shot Life
    { wch: 18 },  // Current Shot Count
  ];
  for (let c = 1; c <= maxCyclesFound; c++) {
    cols.push({ wch: 15 });
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

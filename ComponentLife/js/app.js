/* app.js — Application initialization, tab switching, render functions for Month/Stock/Wear/Report */
/* Detailed debug logging at every rendering & interaction step */
'use strict';

// ===== RENDER MONTH TABLE =====
function renderMonth() {
  console.log("%c[RENDER:MONTH] renderMonth START", "color:#0284c7; font-weight:bold;");
  const t0 = performance.now();
  const ym = selectedMonth(), ySel = selectedYear(), selDayStr = selectedDay();
  const selDayNum = selDayStr ? parseInt(selDayStr, 10) : 0;
  let days = 31;
  let timeLabel = "";
  if (ym) {
    const [year, month] = ym.split("-").map(Number);
    days = new Date(year, month, 0).getDate();
    timeLabel = `Tháng ${month}-${year}`;
    if (selDayNum) timeLabel += ` (Ngày ${selDayNum})`;
    if ($("sheetTitle")) $("sheetTitle").textContent = `${monthNames[month - 1]} ${year}`;
  } else if (ySel) {
    timeLabel = `Tất Cả Tháng — Năm ${ySel}`;
    if (selDayNum) timeLabel += ` (Ngày ${selDayNum})`;
    if ($("sheetTitle")) $("sheetTitle").textContent = `Tất Cả Tháng - Năm ${ySel}`;
  } else {
    timeLabel = "Tất Cả Các Tháng";
    if ($("sheetTitle")) $("sheetTitle").textContent = "Tất Cả Các Tháng";
  }

  if ($("viewMonthText")) $("viewMonthText").textContent = timeLabel;

  $("dayHead").innerHTML = `<tr><th class="col-part">Part list</th><th class="col-series">Series</th><th class="col-mold">Mold</th><th class="col-type">Loại</th>` +
    Array.from({ length: days }, (_, i) => {
      const dNum = i + 1, isSelected = selDayNum === dNum;
      const style = isSelected ? 'style="background:#2563eb;color:#ffffff;font-weight:900;border-radius:4px;"' : '';
      return `<th ${style}>${String(dNum).padStart(2, "0")}</th>`;
    }).join("") + `<th class="col-total">Total</th></tr>`;

  const allPartsList = getPartsToRender();
  if (allPartsList.length === 0) {
    $("dayBody").innerHTML = `<tr><td colspan="${days + 5}" style="text-align:center; padding:20px; color:var(--muted);">Chưa có dữ liệu linh kiện.</td></tr>`;
    renderMetrics();
    console.log("%c[RENDER:MONTH] No parts to render", "color:#6b7280;");
    return;
  }

  // Pre-index replacements & shoots
  const repByPartMold = new Map();
  (db.replacements || []).forEach(r => {
    if (!r.ReplaceDate) return;
    if (ym && monthKey(r.ReplaceDate) !== ym) return;
    if (ySel && !r.ReplaceDate.startsWith(ySel)) return;
    const rPart = String(r.Part || "").toLowerCase().trim();
    const rDie = String(r.DieSet || "").toLowerCase().trim();
    const keys = [`${rPart}|${rDie}`];
    const master = findMasterItem(rPart, rDie, r.Series);
    if (master) {
      if (master.NewDieSet) keys.push(`${rPart}|${String(master.NewDieSet).toLowerCase().trim()}`);
      if (master.OldDieSet) keys.push(`${rPart}|${String(master.OldDieSet).toLowerCase().trim()}`);
    }
    keys.forEach(k => { if (!repByPartMold.has(k)) repByPartMold.set(k, []); repByPartMold.get(k).push(r); });
  });

  const shootByMold = new Map();
  (db.shoot || []).forEach(row => {
    if (!row.Date) return;
    if (ym && monthKey(row.Date) !== ym) return;
    if (ySel && !row.Date.startsWith(ySel)) return;
    const rDie = String(row.DieSet || "").toLowerCase().trim();
    if (rDie) { if (!shootByMold.has(rDie)) shootByMold.set(rDie, []); shootByMold.get(rDie).push(row); }
  });

  // Sort: parts with replacements first
  allPartsList.sort((a, b) => {
    const pA = (a.part || '').toLowerCase(), dNewA = (a.moldNew || a.moldOld || '').toLowerCase();
    const pB = (b.part || '').toLowerCase(), dNewB = (b.moldNew || b.moldOld || '').toLowerCase();
    const countA = (repByPartMold.get(`${pA}|${dNewA}`) || []).length;
    const countB = (repByPartMold.get(`${pB}|${dNewB}`) || []).length;
    if ((countA > 0) !== (countB > 0)) return countB > 0 ? 1 : -1;
    if (countA !== countB) return countB - countA;
    return a.part.localeCompare(b.part, undefined, { numeric: true, sensitivity: 'base' });
  });

  const hasFilter = ($("globalSearch") && $("globalSearch").value.trim()) || ($("part") && $("part").value.trim()) || ($("mold") && $("mold").value.trim()) || ($("series") && $("series").value.trim());
  const limit = hasFilter ? allPartsList.length : _monthRenderLimit;
  const partsList = allPartsList.slice(0, limit);

  let bodyHtml = "";
  partsList.forEach(item => {
    const dieSet = item.moldNew || item.moldOld || item.part, partName = item.part;
    const seriesVal = item.series || getSeriesForPart(partName, dieSet) || "-";
    const moldCombined = item.moldCombined || formatMoldDisplay(item.moldOld, item.moldNew || dieSet);
    const pLower = String(partName || "").toLowerCase().trim(), dLower = String(dieSet || "").toLowerCase().trim();

    const rawReps = repByPartMold.get(`${pLower}|${dLower}`) || [];
    const replacementMap = new Map();
    rawReps.forEach(row => {
      const dayNum = Number(row.ReplaceDate.slice(8, 10));
      const val = Number(String(row.Label || "").trim().replace(/,/g, "")) || 1;
      const existing = replacementMap.get(dayNum) || { day: dayNum, totalQty: 0, rows: [] };
      existing.totalQty += val; existing.rows.push(row); replacementMap.set(dayNum, existing);
    });

    const rawShoots = shootByMold.get(dLower) || [];
    const shootMap = new Map();
    rawShoots.forEach(row => {
      const dayNum = Number(row.Date.slice(8, 10));
      const existing = shootMap.get(dayNum) || { Date: row.Date, Part: partName, DieSet: dieSet, Output: 0 };
      existing.Output += (Number(row.Output) || 0); shootMap.set(dayNum, existing);
    });

    const displayShootMap = new Map();
    shootMap.forEach((valObj, dayNum) => { if (valObj.Output > 0) displayShootMap.set(dayNum, valObj.Output); });
    replacementMap.forEach((repItem, repDay) => {
      if (displayShootMap.has(repDay)) {
        const valToShift = displayShootMap.get(repDay);
        if (valToShift > 0) { displayShootMap.delete(repDay); displayShootMap.set(repDay + 1, (displayShootMap.get(repDay + 1) || 0) + valToShift); }
      }
    });

    let totalReplacementPcs = 0;
    replacementMap.forEach(repItem => { totalReplacementPcs += repItem.totalQty; });
    const totalShoot = Array.from(displayShootMap.values()).reduce((sum, val) => sum + (Number(val) || 0), 0);

    const makeCell = (day, rowType) => {
      const date = ym ? `${ym}-${String(day).padStart(2, "0")}` : `${ySel || new Date().getFullYear()}-01-${String(day).padStart(2, "0")}`;
      const cellYear = ym ? Number(ym.split("-")[0]) : (ySel ? Number(ySel) : new Date().getFullYear());
      const cellMonth = ym ? Number(ym.split("-")[1]) : 1;
      const weekend = [0, 6].includes(new Date(cellYear, cellMonth - 1, day).getDay());
      const isSelectedDay = selDayNum === day;
      const dayStyle = isSelectedDay ? 'style="background:rgba(37,99,235,0.12);border:1.5px solid #2563eb;font-weight:bold;"' : '';

      if (rowType === "replacement") {
        const repItem = replacementMap.get(day);
        const value = repItem ? repItem.totalQty : "-";
        const cls = repItem ? "cell replacement" : "cell empty";
        return `<td><div class="${cls}${weekend ? " weekend" : ""}" ${dayStyle} contenteditable="false" data-type="replacement" data-date="${date}" data-dieset="${esc(dieSet)}" data-part="${esc(partName)}">${esc(value)}</div></td>`;
      }
      const rawVal = displayShootMap.get(day) || 0;
      const displayVal = rawVal > 0 ? formatShootDisplay(rawVal) : "·";
      const cls = rawVal > 0 ? "cell has-output" : "cell zero";
      return `<td><div class="${cls}${weekend ? " weekend" : ""}" ${dayStyle} contenteditable="false" data-type="shoot" data-date="${date}" data-dieset="${esc(dieSet)}" data-part="${esc(partName)}" title="${formatShootHover(rawVal)}">${esc(displayVal)}</div></td>`;
    };

    bodyHtml += `<tr><td class="col-part" rowspan="2"><b>${esc(partName)}</b></td><td class="col-series" rowspan="2"><span class="app-badge-series">${esc(seriesVal)}</span></td><td class="col-mold" rowspan="2" title="${esc(moldCombined)}"><b>${esc(moldCombined)}</b></td><td class="col-type">Replacement</td>${Array.from({ length: days }, (_, i) => makeCell(i + 1, "replacement")).join("")}<td class="col-total"><div class="cell col-total-val" style="color:var(--amber-text);background:var(--amber-light);">${totalReplacementPcs > 0 ? totalReplacementPcs : '-'}</div></td></tr><tr><td class="col-type">Shoot</td>${Array.from({ length: days }, (_, i) => makeCell(i + 1, "shoot")).join("")}<td class="col-total"><div class="cell col-total-val">${formatShootDisplay(totalShoot)}</div></td></tr>`;
  });

  $("dayBody").innerHTML = bodyHtml;
  renderMetrics();
  updateGlobalPaginationDock('month', limit, allPartsList.length, () => { _monthRenderLimit += 30; renderMonth(); }, () => { _monthRenderLimit = allPartsList.length; renderMonth(); });
  const elapsed = Math.round(performance.now() - t0);
  console.log(`%c[RENDER:MONTH] renderMonth DONE in ${elapsed}ms: ${partsList.length}/${allPartsList.length} rows rendered`, "color:#0284c7;");
}

// Global tracking for expanded Dashboard rows
window._expandedDashboardRows = window._expandedDashboardRows || new Set();

window.toggleColumnPicker = function(evt) {
  if (evt) evt.stopPropagation();
  const menu = document.getElementById("colPickerMenu");
  const btn = document.getElementById("btnColPicker");
  if (!menu) return;
  const isHidden = menu.classList.contains("hidden");
  if (isHidden) {
    if (btn) {
      const rect = btn.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.top = `${rect.bottom + 6}px`;
      menu.style.right = `${Math.max(16, window.innerWidth - rect.right)}px`;
      menu.style.zIndex = '999999';
    }
    menu.classList.remove("hidden");
  } else {
    menu.classList.add("hidden");
  }
};

window.onColCheckboxChange = function(cb) {
  const colKey = cb.dataset.col;
  const cols = getDashboardVisibleCols();
  cols[colKey] = cb.checked;
  saveDashboardVisibleCols(cols);
  renderStockTable();
};

window.resetDefaultDashboardCols = function() {
  saveDashboardVisibleCols({ ...DEFAULT_DASHBOARD_COLS });
  renderStockTable();
  const menu = document.getElementById("colPickerMenu");
  if (menu) menu.classList.add("hidden");
};

// Close column picker on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('#colPickerMenu') && !e.target.closest('#btnColPicker') && !e.target.closest('.th-add-col')) {
    const menu = document.getElementById("colPickerMenu");
    if (menu && !menu.classList.contains("hidden")) menu.classList.add("hidden");
  }
});

window.toggleDashboardRowDetail = function(rowId, evt) {
  if (evt) {
    if (evt.target && (evt.target.tagName === 'INPUT' || evt.target.tagName === 'SELECT' || evt.target.tagName === 'BUTTON')) return;
    evt.stopPropagation();
  }
  if (_expandedDashboardRows.has(rowId)) {
    _expandedDashboardRows.delete(rowId);
  } else {
    _expandedDashboardRows.add(rowId);
  }
  const rowEl = document.getElementById(`row_${rowId}`);
  const detailEl = document.getElementById(`detail_${rowId}`);
  const isExpanded = _expandedDashboardRows.has(rowId);
  if (rowEl) rowEl.classList.toggle("is-expanded", isExpanded);
  if (detailEl) detailEl.classList.toggle("hidden", !isExpanded);
};

// Dashboard sorting state & helper
window._dashboardSort = window._dashboardSort || { key: null, order: 'desc' };

window.handleDashboardSort = function(colKey) {
  if (_dashboardSort.key === colKey) {
    if (_dashboardSort.order === 'desc') {
      _dashboardSort.order = 'asc';
    } else {
      _dashboardSort.key = null; // reset to default
      _dashboardSort.order = 'desc';
    }
  } else {
    _dashboardSort.key = colKey;
    const isTextCol = ['part', 'moldSeries', 'moldOld', 'moldNew'].includes(colKey);
    _dashboardSort.order = isTextCol ? 'asc' : 'desc';
  }
  renderStockTable();
};

function renderSortTh(colKey, label, align = 'center', minWidth = null, extraTitle = '') {
  const isSorted = _dashboardSort.key === colKey;
  const isAsc = isSorted && _dashboardSort.order === 'asc';
  const isDesc = isSorted && _dashboardSort.order === 'desc';

  let iconSvg;
  if (isAsc) {
    iconSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10L8 6L12 10"/></svg>`;
  } else if (isDesc) {
    iconSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6L8 10L12 6"/></svg>`;
  } else {
    iconSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6L8 10L12 6"/></svg>`;
  }

  const sortTitle = isSorted ? (isAsc ? 'Đang sắp xếp: Tăng dần (▲)' : 'Đang sắp xếp: Giảm dần (▼)') : `Lọc / Sắp xếp ${label}`;

  const style = [];
  if (minWidth) style.push(`min-width:${minWidth}`);
  const styleAttr = style.length ? `style="${style.join(';')}"` : '';
  const alignCls = align === 'right' ? 'align-right' : (align === 'left' ? 'align-left' : 'align-center');

  return `
    <th class="sortable-th ${isSorted ? 'is-sorted' : ''}" ${styleAttr} onclick="handleDashboardSort('${colKey}')" title="${extraTitle || sortTitle}">
      <div class="th-header-cell ${alignCls}">
        <span class="th-label">${label}</span>
        <span class="th-sort-icon-wrap" aria-hidden="true">${iconSvg}</span>
      </div>
    </th>
  `;
}

// ===== RENDER DASHBOARD (STOCK & LIFETIME TRACKING) =====
function renderStockTable() {
  console.log("%c[RENDER:DASHBOARD] renderStockTable START", "color:#0284c7; font-weight:bold;");
  const t0 = performance.now();
  const allParts = getPartsToRender('stock');
  const currentYm = selectedMonth(), currentDay = selectedDay(), currentYear = selectedYear();
  if ($("stockNote")) {
    if (currentYm) { const [y, m] = currentYm.split("-").map(Number); $("stockNote").innerHTML = `Thống kê tổng hợp <b>tháng ${monthNames[m-1]} ${y}</b>`; }
    else if (currentYear) { $("stockNote").innerHTML = `Thống kê tổng hợp <b>năm ${currentYear}</b>`; }
    else { $("stockNote").innerHTML = `Thống kê tổng hợp <b>tất cả thời gian</b>`; }
  }

  const cols = getDashboardVisibleCols();

  // Sync checkboxes in colPickerMenu
  document.querySelectorAll('#colPickerMenu input[data-col]').forEach(input => {
    const k = input.dataset.col;
    if (cols[k] !== undefined) input.checked = !!cols[k];
  });

  // Calculate active extra count
  const extraCount = Object.keys(cols).filter(k => !DEFAULT_DASHBOARD_COLS[k] && cols[k]).length;
  if ($("colActiveBadge")) {
    $("colActiveBadge").textContent = extraCount > 0 ? `+${extraCount} cột` : 'Mặc định';
  }

  // 1. Index ALL historical replacements (unfiltered by year) to find absolute latest replacement date & full cycles
  const allHistoricalReps = new Map();
  // 2. Index filtered replacements (by active year/month/day filter) for period Replace Time & Qty Used metrics
  const periodReps = new Map();

  (db.replacements || []).forEach(r => {
    const lbl = String(r.Label || "").trim();
    const repDate = String(r.ReplaceDate || "").trim();
    if (!repDate || lbl === "-" || lbl === "0" || lbl === "·") return;

    const val = Number(lbl.replace(/,/g, "")) || 1;
    const reqId = String(r.RequestId || "").trim();
    const p = String(r.Part || "").toLowerCase().trim();
    const dList = [r.DieSet, r.NewDieSet, r.OldDieSet].map(d => String(d || "").toLowerCase().trim()).filter(Boolean);
    const uniqueDies = [...new Set(dList)];
    if (!uniqueDies.length && p) uniqueDies.push(p);

    const evObj = { date: repDate, qty: val, requestId: reqId };

    // Store in all-time historical map
    uniqueDies.forEach(d => {
      const key = `${p}|${d}`;
      if (!allHistoricalReps.has(key)) allHistoricalReps.set(key, []);
      allHistoricalReps.get(key).push(evObj);
    });

    // Store in period-filtered map
    const inPeriod = (!currentYm || monthKey(repDate) === currentYm) &&
                     (!currentYear || currentYm || repDate.startsWith(currentYear)) &&
                     (!currentDay || repDate.slice(8, 10) === currentDay);
    if (inPeriod) {
      uniqueDies.forEach(d => {
        const key = `${p}|${d}`;
        if (!periodReps.has(key)) periodReps.set(key, []);
        periodReps.get(key).push(evObj);
      });
    }
  });

  // Index ALL historical shoot production data (unfiltered)
  const shootsByMold = new Map();
  (db.shoot || []).forEach(s => {
    if (!s.Date || Number(s.Output) <= 0) return;
    const d = String(s.DieSet || '').toLowerCase().trim();
    const p = String(s.Part || '').toLowerCase().trim();
    if (d) { if (!shootsByMold.has(d)) shootsByMold.set(d, []); shootsByMold.get(d).push(s); }
    if (p && p !== d) { if (!shootsByMold.has(p)) shootsByMold.set(p, []); shootsByMold.get(p).push(s); }
  });

  let totalCount = 0, safeCount = 0, warningCount = 0, criticalCount = 0, replacedCount = 0;
  const processedList = allParts.map(item => {
    const part = item.part;
    const series = item.series || "-";
    const moldNew = item.moldNew || item.moldOld || item.part;
    const moldOld = item.moldOld || "";
    
    const moldSeries = formatMoldSeriesDisplay(series, moldOld, moldNew, false);
    const moldSeriesHtml = formatMoldSeriesDisplay(series, moldOld, moldNew, true);

    const st = getStockItem(part, moldNew);
    const masterItem = findMasterItem(part, moldNew, series);
    const stock = Number(st.stock !== undefined ? st.stock : (masterItem ? masterItem.StockLeft : 0)) || 0;
    let minStock = (st && st.minStock !== undefined) ? Number(st.minStock) || 1 : (masterItem && masterItem.StandardStock !== undefined ? Number(masterItem.StandardStock) || 1 : 1);

    const pLower = String(part || "").toLowerCase().trim();
    const dNewLower = String(moldNew || "").toLowerCase().trim();
    const dOldLower = String(moldOld || "").toLowerCase().trim();
    const k1 = `${pLower}|${dNewLower}`, k2 = `${pLower}|${dOldLower}`;

    // Period events (for Replace Time & Qty Used in the active filter period)
    const periodEvents = [];
    const periodEventSet = new Set();
    [...(periodReps.get(k1) || []), ...(periodReps.get(k2) || [])].forEach(ev => {
      const ek = `${ev.date}|${ev.requestId}|${ev.qty}`;
      if (!periodEventSet.has(ek)) {
        periodEventSet.add(ek);
        periodEvents.push(ev);
      }
    });
    periodEvents.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const used = periodEvents.reduce((sum, ev) => sum + (Number(ev.qty) || 0), 0);
    if (used > 0) replacedCount++;
    let status = 'SAFE';
    if (stock <= 0) { status = 'CRITICAL'; criticalCount++; } else if (stock < minStock) { status = 'WARNING'; warningCount++; } else { safeCount++; }
    totalCount++;

    // ALL-TIME historical events (for absolute latest replacement date & lifetime cycles)
    const allHistoryEvents = [];
    const allHistorySet = new Set();
    [...(allHistoricalReps.get(k1) || []), ...(allHistoricalReps.get(k2) || [])].forEach(ev => {
      const ek = `${ev.date}|${ev.requestId}|${ev.qty}`;
      if (!allHistorySet.has(ek)) {
        allHistorySet.add(ek);
        allHistoryEvents.push(ev);
      }
    });
    allHistoryEvents.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    // ALL historical shoots sorted by date
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
    if (allHistoryEvents.length > 0) {
      const c1 = sortedShoots.filter(s => s.Date < allHistoryEvents[0].date).reduce((sum, s) => sum + (Number(s.Output) || 0), 0);
      if (c1 > 0) cycles.push(c1);
      for (let i = 0; i < allHistoryEvents.length - 1; i++) {
        const cN = sortedShoots.filter(s => s.Date >= allHistoryEvents[i].date && s.Date < allHistoryEvents[i + 1].date).reduce((sum, s) => sum + (Number(s.Output) || 0), 0);
        if (cN > 0) cycles.push(cN);
      }
    }

    const averageShotLife = cycles.length > 0 ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : (totalLifetimeShots > 0 ? totalLifetimeShots : 0);
    const minShotLife = cycles.length > 0 ? Math.min(...cycles) : (totalLifetimeShots > 0 ? totalLifetimeShots : 0);
    const maxShotLife = cycles.length > 0 ? Math.max(...cycles) : (totalLifetimeShots > 0 ? totalLifetimeShots : 0);

    // CURRENT SHOT: ALWAYS calculated from the absolute latest replacement date up to the present date
    const absoluteLastRepDate = allHistoryEvents.length > 0 ? allHistoryEvents[allHistoryEvents.length - 1].date : null;
    const currentShotCount = absoluteLastRepDate
      ? sortedShoots.filter(s => s.Date >= absoluteLastRepDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0)
      : totalLifetimeShots;

    return {
      part, series, moldNew, moldOld, moldSeries, moldSeriesHtml,
      stock, minStock, used, timesCount: periodEvents.length, events: periodEvents, status,
      cycles, averageShotLife, minShotLife, maxShotLife, currentShotCount, lastRepDate: absoluteLastRepDate || '-'
    };
  });

  const maxCyclesFound = Math.max(1, ...processedList.map(r => (r.cycles ? r.cycles.length : 0)));

  // Generate Table Header HTML dynamically with top-down sort icons
  let colSpanCount = 3; // #, Part, Mold/Series
  let headColsHtml = `
    <th style="width:45px;text-align:center;">#</th>
    ${renderSortTh('part', 'Part', 'left', '90px')}
    ${renderSortTh('moldSeries', 'Mold / Series', 'left', '160px')}
  `;
  if (cols.timesCount) { headColsHtml += renderSortTh('timesCount', 'Replace Time', 'center', null, 'Lọc theo số lượt thay thế'); colSpanCount++; }
  if (cols.used) { headColsHtml += renderSortTh('used', 'Qty Used', 'center', null, 'Lọc theo tổng linh kiện thay (Pcs)'); colSpanCount++; }
  if (cols.avgShot) { headColsHtml += renderSortTh('avgShot', 'Avg Shot', 'right', null, 'Lọc theo tuổi thọ trung bình'); colSpanCount++; }
  if (cols.currentShot) { headColsHtml += renderSortTh('currentShot', 'Current Shot', 'right', null, 'Lọc theo số shot dập hiện tại'); colSpanCount++; }
  if (cols.minShot) { headColsHtml += renderSortTh('minShot', 'Min Shot', 'right'); colSpanCount++; }
  if (cols.maxShot) { headColsHtml += renderSortTh('maxShot', 'Max Shot', 'right'); colSpanCount++; }
  if (cols.minMaxShot) { headColsHtml += renderSortTh('maxShot', 'Min - Max Shot', 'center'); colSpanCount++; }
  if (cols.wearPercent) { headColsHtml += renderSortTh('wearPercent', 'Tiến Độ Mòn (%)', 'center'); colSpanCount++; }
  if (cols.cycleCount) { headColsHtml += renderSortTh('cycleCount', 'Số Chu Kỳ', 'center'); colSpanCount++; }
  if (cols.cycles) {
    for (let c = 1; c <= maxCyclesFound; c++) {
      headColsHtml += renderSortTh(`cycle_${c}`, `Cycle ${c}`, 'right', null, `Lọc theo số shot chu kỳ ${c}`);
      colSpanCount++;
    }
  }
  if (cols.lastRepDate) { headColsHtml += renderSortTh('lastRepDate', 'Last Replacement', 'center'); colSpanCount++; }
  if (cols.stock) { headColsHtml += renderSortTh('stock', 'Tồn Kho', 'center'); colSpanCount++; }
  if (cols.minStock) { headColsHtml += renderSortTh('minStock', 'Mức Min', 'center'); colSpanCount++; }
  if (cols.status) { headColsHtml += renderSortTh('status', 'Trạng Thái', 'center'); colSpanCount++; }
  if (cols.moldOld) { headColsHtml += renderSortTh('moldOld', 'Khuôn Cũ', 'left', '110px'); colSpanCount++; }
  if (cols.moldNew) { headColsHtml += renderSortTh('moldNew', 'Khuôn Mới', 'left', '110px'); colSpanCount++; }

  // Final Column: ＋ Add Column in Table Header
  headColsHtml += `
    <th class="th-add-col" style="width:38px; text-align:center; padding:0;" title="Thêm hoặc ẩn các cột hiển thị">
      <button type="button" class="btn-th-add-col" id="btnColPicker" onclick="toggleColumnPicker(event)" title="Thêm / Ẩn cột">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5V12.5M3.5 8H12.5"/></svg>
      </button>
    </th>
  `;
  colSpanCount++;

  const theadEl = document.querySelector('#dashboardTable thead');
  if (theadEl) theadEl.innerHTML = `<tr>${headColsHtml}</tr>`;

  processedList.sort((a, b) => {
    if ((a.used > 0) !== (b.used > 0)) return b.used > 0 ? 1 : -1;
    return a.part.localeCompare(b.part, undefined, { numeric: true, sensitivity: 'base' });
  });

  if ($("cntAll")) $("cntAll").textContent = totalCount.toLocaleString();
  if ($("cntReplaced")) $("cntReplaced").textContent = replacedCount.toLocaleString();
  if ($("cntSafe")) $("cntSafe").textContent = safeCount.toLocaleString();
  if ($("cntWarning")) $("cntWarning").textContent = warningCount.toLocaleString();
  if ($("cntCritical")) $("cntCritical").textContent = criticalCount.toLocaleString();

  let filtered = [...processedList];
  if ($("chkAll") || $("chkCritical") || $("chkWarning") || $("chkSafe") || $("chkReplaced")) {
    const isAllChecked = $("chkAll") ? $("chkAll").checked : false;
    const isCriticalChecked = $("chkCritical") ? $("chkCritical").checked : true;
    const isWarningChecked = $("chkWarning") ? $("chkWarning").checked : true;
    const isSafeChecked = $("chkSafe") ? $("chkSafe").checked : true;
    const isReplacedChecked = $("chkReplaced") ? $("chkReplaced").checked : false;

    if (!isAllChecked) {
      filtered = processedList.filter(x => {
        if (isReplacedChecked && x.used > 0) return true;
        if (isCriticalChecked && x.status === 'CRITICAL') return true;
        if (isWarningChecked && x.status === 'WARNING') return true;
        if (isSafeChecked && x.status === 'SAFE') return true;
        return false;
      });
    }
  }

  // Apply column header sorting
  if (_dashboardSort && _dashboardSort.key) {
    const k = _dashboardSort.key;
    const isAsc = _dashboardSort.order === 'asc';
    filtered.sort((a, b) => {
      let valA, valB;
      if (k === 'part') { valA = a.part || ''; valB = b.part || ''; }
      else if (k === 'moldSeries') { valA = a.moldSeries || ''; valB = b.moldSeries || ''; }
      else if (k === 'timesCount') { valA = a.timesCount || 0; valB = b.timesCount || 0; }
      else if (k === 'used') { valA = a.used || 0; valB = b.used || 0; }
      else if (k === 'avgShot') { valA = a.averageShotLife || 0; valB = b.averageShotLife || 0; }
      else if (k === 'currentShot') { valA = a.currentShotCount || 0; valB = b.currentShotCount || 0; }
      else if (k === 'minShot') { valA = a.minShotLife || 0; valB = b.minShotLife || 0; }
      else if (k === 'maxShot') { valA = a.maxShotLife || 0; valB = b.maxShotLife || 0; }
      else if (k === 'stock') { valA = a.stock || 0; valB = b.stock || 0; }
      else if (k === 'minStock') { valA = a.minStock || 0; valB = b.minStock || 0; }
      else if (k === 'cycleCount') { valA = (a.cycles || []).length; valB = (b.cycles || []).length; }
      else if (k.startsWith('cycle_')) {
        const cIdx = parseInt(k.replace('cycle_', ''), 10) - 1;
        valA = (a.cycles && a.cycles[cIdx] !== undefined) ? a.cycles[cIdx] : 0;
        valB = (b.cycles && b.cycles[cIdx] !== undefined) ? b.cycles[cIdx] : 0;
      }
      else if (k === 'wearPercent') {
        valA = a.averageShotLife > 0 ? (a.currentShotCount / a.averageShotLife) : 0;
        valB = b.averageShotLife > 0 ? (b.currentShotCount / b.averageShotLife) : 0;
      }
      else if (k === 'status') {
        const weight = { 'CRITICAL': 3, 'WARNING': 2, 'SAFE': 1 };
        valA = weight[a.status] || 0; valB = weight[b.status] || 0;
      }
      else if (k === 'lastRepDate') {
        valA = (a.events && a.events.length > 0) ? a.events[a.events.length - 1].date : '';
        valB = (b.events && b.events.length > 0) ? b.events[b.events.length - 1].date : '';
      }
      else if (k === 'moldOld') { valA = a.moldOld || ''; valB = b.moldOld || ''; }
      else if (k === 'moldNew') { valA = a.moldNew || ''; valB = b.moldNew || ''; }
      else { valA = a[k] || 0; valB = b[k] || 0; }

      if (typeof valA === 'string' && typeof valB === 'string') {
        const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
        return isAsc ? cmp : -cmp;
      }
      const numA = Number(valA) || 0, numB = Number(valB) || 0;
      return isAsc ? numA - numB : numB - numA;
    });
  } else {
    // Default sort: items with replacements first, then alphabet by part
    filtered.sort((a, b) => {
      if ((a.used > 0) !== (b.used > 0)) return b.used > 0 ? 1 : -1;
      return a.part.localeCompare(b.part, undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  const hasFilter = ($("globalSearch") && $("globalSearch").value.trim()) || ($("part") && $("part").value.trim());
  const limit = hasFilter ? filtered.length : _stockRenderLimit;
  const visibleList = filtered.slice(0, limit);

  if ($("stockRows")) {
    if (!visibleList.length) {
      $("stockRows").innerHTML = `<tr><td colspan="${colSpanCount}" style="text-align:center;padding:28px;color:var(--muted);">Không có linh kiện nào phù hợp.</td></tr>`;
    } else {
      let rowsHtml = "";
      visibleList.forEach((row, idx) => {
        const rowId = `dash_${idx}_${String(row.part).replace(/[^a-zA-Z0-9]/g, '_')}_${String(row.moldNew || row.moldOld).replace(/[^a-zA-Z0-9]/g, '_')}`;
        const isExpanded = _expandedDashboardRows.has(rowId);
        const statusBadge = row.status === 'CRITICAL' 
          ? `<span class="badge-stock critical" title="Tồn kho = 0 (Hết hàng)">🔴 URGENT</span>` 
          : (row.status === 'WARNING' 
            ? `<span class="badge-stock warning" title="Tồn kho < Min (Cần đặt hàng)">🟡 NEED ORDER</span>` 
            : `<span class="badge-stock safe" title="Tồn kho ≥ Min (Đủ an toàn)">🟢 NO NEED</span>`);

        let rowCellsHtml = `
          <td style="text-align:center;color:var(--ink-muted);font-weight:600;">${idx + 1}</td>
          <td style="font-weight:800;color:var(--ink-dark);"><span style="font-family:monospace;background:#f8fafc;padding:3px 7px;border-radius:4px;border:1px solid #e2e8f0;color:#0f172a;">${esc(row.part)}</span></td>
          <td style="font-weight:600;color:#475569;"><span style="font-family:monospace;background:#f1f5f9;padding:2px 6px;border-radius:4px;">${row.moldSeriesHtml || esc(row.moldSeries)}</span></td>
        `;
        if (cols.timesCount) {
          rowCellsHtml += `<td style="text-align:center;font-weight:700;">${row.timesCount > 0 ? `<span class="stock-pill-count">${row.timesCount}</span>` : '-'}</td>`;
        }
        if (cols.used) {
          rowCellsHtml += `<td style="text-align:center;font-weight:700;">${row.used > 0 ? `<b style="color:#7c3aed;">${row.used}</b>` : '-'}</td>`;
        }
        if (cols.avgShot) {
          rowCellsHtml += `<td style="text-align:right;font-weight:700;color:#0369a1;">${row.averageShotLife > 0 ? row.averageShotLife.toLocaleString() : '-'}</td>`;
        }
        if (cols.currentShot) {
          rowCellsHtml += `<td style="text-align:right;font-weight:700;color:#0f172a;">${row.currentShotCount > 0 ? row.currentShotCount.toLocaleString() : '-'}</td>`;
        }
        if (cols.minShot) {
          rowCellsHtml += `<td style="text-align:right;font-size:12.5px;color:#059669;font-weight:600;">${row.minShotLife ? row.minShotLife.toLocaleString() : '-'}</td>`;
        }
        if (cols.maxShot) {
          rowCellsHtml += `<td style="text-align:right;font-size:12.5px;color:#d97706;font-weight:600;">${row.maxShotLife ? row.maxShotLife.toLocaleString() : '-'}</td>`;
        }
        if (cols.minMaxShot) {
          rowCellsHtml += `<td style="text-align:center;font-size:12px;color:#475569;">${row.minShotLife && row.maxShotLife ? `${row.minShotLife.toLocaleString()} - ${row.maxShotLife.toLocaleString()}` : '-'}</td>`;
        }
        if (cols.wearPercent) {
          const pct = row.averageShotLife > 0 ? Math.min(100, Math.round((row.currentShotCount / row.averageShotLife) * 100)) : 0;
          const barColor = pct >= 90 ? '#dc2626' : (pct >= 70 ? '#d97706' : '#059669');
          rowCellsHtml += `<td style="text-align:center;"><div style="display:inline-flex;align-items:center;gap:6px;"><div style="width:45px;height:7px;background:#e2e8f0;border-radius:4px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:${barColor};"></div></div><b style="font-size:11.5px;color:${barColor};">${pct}%</b></div></td>`;
        }
        if (cols.cycleCount) {
          rowCellsHtml += `<td style="text-align:center;font-weight:700;color:#64748b;">${row.cycles ? row.cycles.length : 0}</td>`;
        }
        if (cols.cycles) {
          for (let c = 1; c <= maxCyclesFound; c++) {
            const val = (row.cycles && row.cycles[c - 1] !== undefined) ? Number(row.cycles[c - 1]).toLocaleString() : '-';
            rowCellsHtml += `<td style="text-align:right; font-weight:600; color:#0f172a; font-size:12.5px;">${val}</td>`;
          }
        }
        if (cols.lastRepDate) {
          const lastDate = row.events.length > 0 ? row.events[row.events.length - 1].date : '-';
          rowCellsHtml += `<td style="text-align:center;font-size:12px;color:#475569;font-weight:600;">${lastDate}</td>`;
        }
        if (cols.stock) {
          rowCellsHtml += `<td style="text-align:center;font-weight:800;color:${row.stock <= 0 ? '#dc2626' : (row.stock < row.minStock ? '#d97706' : '#0f172a')}; font-size:14.5px;">${row.stock}</td>`;
        }
        if (cols.minStock) {
          rowCellsHtml += `<td style="text-align:center;font-weight:600;color:#64748b; font-size:13.5px;">${row.minStock}</td>`;
        }
        if (cols.status) {
          rowCellsHtml += `<td style="text-align:center;">${statusBadge}</td>`;
        }
        if (cols.moldOld) {
          rowCellsHtml += `<td style="font-family:monospace;color:#475569;font-size:12.5px;">${esc(row.moldOld || '-')}</td>`;
        }
        if (cols.moldNew) {
          rowCellsHtml += `<td style="font-family:monospace;color:#166534;font-size:12.5px;font-weight:700;">${esc(row.moldNew || '-')}</td>`;
        }
        rowCellsHtml += `<td class="td-add-col" style="padding:0; width:38px;"></td>`;

        rowsHtml += `
          <tr id="row_${rowId}" class="dashboard-main-row">
            ${rowCellsHtml}
          </tr>
        `;
      });
      $("stockRows").innerHTML = rowsHtml;
    }
    updateGlobalPaginationDock('stock', limit, filtered.length, () => { _stockRenderLimit += 40; renderStockTable(); }, () => { _stockRenderLimit = filtered.length; renderStockTable(); });
  }
  const elapsed = Math.round(performance.now() - t0);
  console.log(`%c[RENDER:DASHBOARD] renderStockTable DONE in ${elapsed}ms: ${visibleList.length}/${filtered.length} rows (Total: ${totalCount}, Critical: ${criticalCount}, Warning: ${warningCount}, Safe: ${safeCount})`, "color:#0284c7;");
}



// ===== TAB SWITCHING =====
function switchTab(name) {
  console.log(`%c[TAB] Switched to tab: "${name}"`, "color:#7c3aed; font-weight:bold; font-size:13px;");
  const isDashboard = (name === "stock" || name === "dashboard" || name === "report");
  currentActiveTab = isDashboard ? "stock" : name;
  document.querySelectorAll(".tab").forEach(tab => {
    const tName = tab.dataset.tab;
    const active = (tName === name) || (isDashboard && (tName === "stock" || tName === "dashboard"));
    tab.classList.toggle("active", active);
  });
  if ($("monthTab")) $("monthTab").classList.toggle("hidden", name !== "month");
  if ($("stockTab")) $("stockTab").classList.toggle("hidden", !isDashboard);
  if ($("reportTab")) $("reportTab").classList.toggle("hidden", true);
  if ($("chartTab")) $("chartTab").classList.toggle("hidden", name !== "chart");
  if ($("viewMonthIndicator")) $("viewMonthIndicator").classList.toggle("hidden", name !== "month");
  if ($("stockFilterBar")) $("stockFilterBar").classList.toggle("hidden", !isDashboard);
  renderMetrics();
  if (name === "month") renderMonth();
  else if (isDashboard) renderStockTable();
  else if (name === "chart") renderChartsTab();
}

function onDateFilterChange(evt) {
  console.log(`%c[FILTER] Date filter changed by ${evt?.target?.id || 'code'}`, "color:#6b7280;");
  if (evt && evt.target) {
    const id = evt.target.id;
    if (id === "yearPick") {
      const y = $("yearPick").value;
      if (y && $("monthPick")) {
        const currYm = $("monthPick").value;
        if (!currYm.startsWith(y)) {
          const matchOpt = Array.from($("monthPick").options).find(opt => opt.value.startsWith(y));
          if (matchOpt) $("monthPick").value = matchOpt.value;
        }
      }
    } else if (id === "monthPick") {
      const ym = $("monthPick").value;
      if (ym && ym.length >= 4 && $("yearPick")) {
        const y = ym.slice(0, 4);
        if (Array.from($("yearPick").options).some(opt => opt.value === y)) $("yearPick").value = y;
      }
    }
  }
  renderActiveTabOnly();
}

// ===== GLOBAL SEARCH =====
let _searchRAF = null;
function toggleClearBtn() {
  const btn = $("clearSearchBtn"), inp = $("globalSearch");
  if (btn && inp) btn.style.display = inp.value.trim() ? "inline-flex" : "none";
}

function clearGlobalSearch() {
  const inp = $("globalSearch");
  if (inp) { inp.value = ""; onGlobalSearchInput(); toggleClearBtn(); inp.focus(); }
}

function onGlobalSearchInput() {
  toggleClearBtn();
  if ($("part")) $("part").value = "";
  if ($("series")) $("series").value = "";
  if ($("dieSet")) $("dieSet").value = "";
  if ($("mold")) $("mold").value = "";
  if (_searchRAF) cancelAnimationFrame(_searchRAF);
  _searchRAF = requestAnimationFrame(() => renderActiveTabOnly());
}

function autoFillPart() {
  if (!$("part")) return;
  const rawVal = $("part").value.trim();
  if (!rawVal) { renderMonth(); renderMetrics(); return; }
  const lowerVal = rawVal.toLowerCase(), nVal = normKey(rawVal);
  const matches = masterData.filter(x => (x.PartName && x.PartName.toLowerCase() === lowerVal) || (x.PartName && normKey(x.PartName) === nVal));
  if (matches.length === 1) {
    const match = matches[0];
    if (match.Series && $("series")) $("series").value = match.Series;
    if (match.OldDieSet && $("dieSet")) $("dieSet").value = match.OldDieSet;
    if (match.NewDieSet && $("mold")) $("mold").value = match.NewDieSet;
  }
  renderMonth(); renderMetrics();
}

function autoFillMold() {
  if (!$("mold")) return;
  const rawVal = $("mold").value.trim();
  if (!rawVal) { renderMonth(); renderMetrics(); return; }
  const lowerVal = rawVal.toLowerCase(), nVal = normKey(rawVal);
  let match = masterData.find(x => (x.NewDieSet && x.NewDieSet.toLowerCase() === lowerVal) || (x.NewDieSet && normKey(x.NewDieSet) === nVal));
  if (!match) match = masterData.find(x => (x.OldDieSet && x.OldDieSet.toLowerCase() === lowerVal) || (x.OldDieSet && normKey(x.OldDieSet) === nVal));
  if (match) { 
    if ($("series")) $("series").value = match.Series || ""; 
    if ($("dieSet")) $("dieSet").value = match.OldDieSet || ""; 
  }
  renderMonth(); renderMetrics();
}

// ===== INITIALIZATION =====
function initApp() {
  console.log("%c[BOOT] ========== initApp START ==========", "color:#7c3aed; font-weight:bold; font-size:15px;");
  // Tab click handlers
  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));

  // Context filter handlers
  ["part", "series", "dieSet", "mold"].forEach(id => {
    if ($(id)) $(id).addEventListener("change", () => { renderMonth(); renderMetrics(); });
  });
  ["input", "change"].forEach(evt => {
    if ($("part")) $("part").addEventListener(evt, autoFillPart);
    if ($("mold")) $("mold").addEventListener(evt, autoFillMold);
  });
  ["yearPick", "monthPick", "dayPick"].forEach(id => {
    if ($(id)) $(id).addEventListener("change", onDateFilterChange);
  });

  // Global search
  if ($("globalSearch")) $("globalSearch").addEventListener("input", onGlobalSearchInput);
  if ($("globalSearch")) $("globalSearch").value = "";
  if ($("part")) $("part").value = "";
  if ($("series")) $("series").value = "";
  if ($("dieSet")) $("dieSet").value = "";
  if ($("mold")) $("mold").value = "";

  // Table cell editing delegation
  if ($("dayBody")) {
    $("dayBody").addEventListener("focusout", event => {
      const cell = event.target.closest(".cell[contenteditable='true']");
      if (cell) updateCell(cell);
    });
    $("dayBody").addEventListener("keydown", event => {
      if (event.key === "Enter") {
        const cell = event.target.closest(".cell[contenteditable='true']");
        if (cell) { event.preventDefault(); cell.blur(); }
      }
    });
  }

  // Delete reason modal enter key
  if ($("deleteReasonText")) {
    $("deleteReasonText").addEventListener("keydown", function(e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); confirmDeleteReplacement(); }
    });
  }

  // Drag & Drop for Excel files
  window.addEventListener('dragover', (e) => { e.preventDefault(); if ($("cbDropZone")) $("cbDropZone").classList.add("cb-drag-over"); });
  window.addEventListener('dragleave', (e) => { if (e.relatedTarget === null && $("cbDropZone")) $("cbDropZone").classList.remove("cb-drag-over"); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if ($("cbDropZone")) $("cbDropZone").classList.remove("cb-drag-over");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) importExcelFile(e.dataTransfer.files[0]);
  });

  // Start engines
  console.log("%c[BOOT] Initializing ScreenFitEngine, Heartbeat, DataLoader...", "color:#6b7280;");
  initScreenFitEngine();
  initHeartbeat();
  loadAllDataFromSource();
  console.log("%c[BOOT] ========== initApp DONE ==========", "color:#7c3aed; font-weight:bold; font-size:15px;");
}

// Run on DOM ready
initApp();

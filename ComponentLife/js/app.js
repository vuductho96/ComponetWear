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

// ===== RENDER STOCK TABLE =====
function renderStockTable() {
  console.log("%c[RENDER:STOCK] renderStockTable START", "color:#0284c7; font-weight:bold;");
  const t0 = performance.now();
  const allParts = getPartsToRender('stock');
  const currentYm = selectedMonth(), currentDay = selectedDay(), currentYear = selectedYear();
  if ($("stockNote")) {
    if (currentYm) { const [y, m] = currentYm.split("-").map(Number); $("stockNote").innerHTML = `Thống kê thay thế <b>tháng ${monthNames[m-1]} ${y}</b>`; }
    else if (currentYear) { $("stockNote").innerHTML = `Thống kê thay thế <b>năm ${currentYear}</b>`; }
    else { $("stockNote").innerHTML = `Thống kê thay thế <b>tất cả thời gian</b>`; }
  }

  // Index replacements with normalized keys (matching both OldDieSet, NewDieSet, DieSet)
  const repsByPartMold = new Map();
  (db.replacements || []).forEach(r => {
    const lbl = String(r.Label || "").trim();
    const repDate = String(r.ReplaceDate || "").trim();
    if (!repDate || lbl === "-" || lbl === "0" || lbl === "·") return;
    if (currentYm && monthKey(repDate) !== currentYm) return;
    if (!currentYm && currentYear && !repDate.startsWith(currentYear)) return;
    if (currentDay && repDate.slice(8, 10) !== currentDay) return;

    const val = Number(lbl.replace(/,/g, "")) || 1;
    const reqId = String(r.RequestId || "").trim();
    const p = String(r.Part || "").toLowerCase().trim();
    const dList = [r.DieSet, r.NewDieSet, r.OldDieSet].map(d => String(d || "").toLowerCase().trim()).filter(Boolean);
    const uniqueDies = [...new Set(dList)];
    if (!uniqueDies.length && p) uniqueDies.push(p);

    const evObj = { date: repDate, qty: val, requestId: reqId };
    uniqueDies.forEach(d => {
      const key = `${p}|${d}`;
      if (!repsByPartMold.has(key)) repsByPartMold.set(key, []);
      repsByPartMold.get(key).push(evObj);
    });
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

    const allEvents = [];
    const eventSet = new Set();
    const k1 = `${pLower}|${dNewLower}`, k2 = `${pLower}|${dOldLower}`;
    [...(repsByPartMold.get(k1) || []), ...(repsByPartMold.get(k2) || [])].forEach(ev => {
      const ek = `${ev.date}|${ev.requestId}|${ev.qty}`;
      if (!eventSet.has(ek)) {
        eventSet.add(ek);
        allEvents.push(ev);
      }
    });

    allEvents.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const used = allEvents.reduce((sum, ev) => sum + (Number(ev.qty) || 0), 0);
    if (used > 0) replacedCount++;
    let status = 'SAFE';
    if (stock <= 0) { status = 'CRITICAL'; criticalCount++; } else if (stock < minStock) { status = 'WARNING'; warningCount++; } else { safeCount++; }
    totalCount++;
    return { part, series, moldNew, moldOld, moldSeries, moldSeriesHtml, stock, minStock, used, timesCount: allEvents.length, events: allEvents, status };
  });

  processedList.sort((a, b) => { if ((a.used > 0) !== (b.used > 0)) return b.used > 0 ? 1 : -1; return a.part.localeCompare(b.part, undefined, { numeric: true, sensitivity: 'base' }); });

  if ($("cntAll")) $("cntAll").textContent = totalCount.toLocaleString();
  if ($("cntReplaced")) $("cntReplaced").textContent = replacedCount.toLocaleString();
  if ($("cntSafe")) $("cntSafe").textContent = safeCount.toLocaleString();
  if ($("cntWarning")) $("cntWarning").textContent = warningCount.toLocaleString();
  if ($("cntCritical")) $("cntCritical").textContent = criticalCount.toLocaleString();

  const isAllChecked = $("chkAll") ? $("chkAll").checked : false;
  const isCriticalChecked = $("chkCritical") ? $("chkCritical").checked : true;
  const isWarningChecked = $("chkWarning") ? $("chkWarning").checked : true;
  const isSafeChecked = $("chkSafe") ? $("chkSafe").checked : true;
  const isReplacedChecked = $("chkReplaced") ? $("chkReplaced").checked : false;

  let filtered = isAllChecked ? processedList : processedList.filter(x => {
    if (isReplacedChecked && x.used > 0) return true;
    if (isCriticalChecked && x.status === 'CRITICAL') return true;
    if (isWarningChecked && x.status === 'WARNING') return true;
    if (isSafeChecked && x.status === 'SAFE') return true;
    return false;
  });

  const hasFilter = ($("globalSearch") && $("globalSearch").value.trim()) || ($("part") && $("part").value.trim());
  const limit = hasFilter ? filtered.length : _stockRenderLimit;
  const visibleList = filtered.slice(0, limit);

  if ($("stockRows")) {
    if (!visibleList.length) {
      $("stockRows").innerHTML = `<tr><td colspan="11" style="text-align:center;padding:28px;color:var(--muted);">Không có linh kiện nào phù hợp.</td></tr>`;
    } else {
      $("stockRows").innerHTML = visibleList.map((row, idx) => {
        const statusBadge = row.status === 'CRITICAL' ? `<span class="badge-stock critical">🔴 URGENT</span>` : (row.status === 'WARNING' ? `<span class="badge-stock warning">🟡 NEED ORDER</span>` : `<span class="badge-stock safe">🟢 NO NEED</span>`);
        const datesHtml = row.events.length > 0 ? row.events.map((ev, i) => { const dp = (ev.date || '').split('-'); return `<span class="date-chip" title="Lần ${i+1}">${dp.length === 3 ? `${dp[2]}/${dp[1]}` : ev.date}</span>`; }).join(' ') : '-';
        const qtyHtml = row.events.length > 0 ? row.events.map(ev => `<span class="qty-chip">${ev.qty} pcs</span>`).join(' ') : '-';
        const reqHtml = row.events.length > 0 ? row.events.map(ev => ev.requestId ? `<span class="date-chip" style="background:#f1f5f9;color:#334155;font-weight:700;">#${esc(ev.requestId)}</span>` : '').filter(Boolean).join(' ') || '-' : '-';
        return `<tr>
          <td style="text-align:center;color:var(--ink-muted);font-weight:600;">${idx + 1}</td>
          <td style="font-weight:800;color:var(--ink-dark);"><span style="font-family:monospace;background:#f8fafc;padding:3px 7px;border-radius:4px;border:1px solid #e2e8f0;color:#0f172a;">${esc(row.part)}</span></td>
          <td style="font-weight:600;color:#475569;"><span style="font-family:monospace;background:#f1f5f9;padding:2px 6px;border-radius:4px;">${row.moldSeriesHtml || esc(row.moldSeries)}</span></td>
          <td style="text-align:center;font-weight:600;color:#64748b;">${row.minStock}</td>
          <td style="text-align:center;font-weight:800;color:${row.stock <= 0 ? '#dc2626' : '#0f172a'};">${row.stock}</td>
          <td style="text-align:center;font-weight:700;">${row.used > 0 ? `<b style="color:#7c3aed;">${row.used}</b>` : '-'}</td>
          <td style="text-align:center;font-weight:700;">${row.timesCount > 0 ? `<span class="stock-pill-count">${row.timesCount}</span>` : '-'}</td>
          <td style="font-size:12px;">${datesHtml}</td>
          <td style="font-size:12px;">${qtyHtml}</td>
          <td style="font-size:12px;">${reqHtml}</td>
          <td style="text-align:center;">${statusBadge}</td>
        </tr>`;
      }).join("");
    }
    updateGlobalPaginationDock('stock', limit, filtered.length, () => { _stockRenderLimit += 40; renderStockTable(); }, () => { _stockRenderLimit = filtered.length; renderStockTable(); });
  }
  const elapsed = Math.round(performance.now() - t0);
  console.log(`%c[RENDER:STOCK] renderStockTable DONE in ${elapsed}ms: ${visibleList.length}/${filtered.length} rows (Total: ${totalCount}, Critical: ${criticalCount}, Warning: ${warningCount}, Safe: ${safeCount})`, "color:#0284c7;");
}



// ===== TAB SWITCHING =====
function switchTab(name) {
  console.log(`%c[TAB] Switched to tab: "${name}"`, "color:#7c3aed; font-weight:bold; font-size:13px;");
  currentActiveTab = name;
  document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.tab === name));
  if ($("monthTab")) $("monthTab").classList.toggle("hidden", name !== "month");
  if ($("stockTab")) $("stockTab").classList.toggle("hidden", name !== "stock");
  if ($("reportTab")) $("reportTab").classList.toggle("hidden", name !== "report");
  if ($("viewMonthIndicator")) $("viewMonthIndicator").classList.toggle("hidden", name !== "month");
  if ($("stockFilterBar")) $("stockFilterBar").classList.toggle("hidden", name !== "stock");
  renderMetrics();
  if (name === "month") renderMonth();
  else if (name === "stock") renderStockTable();
  else if (name === "report") renderComponentLifeReport();
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

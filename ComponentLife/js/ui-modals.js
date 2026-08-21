/* ui-modals.js — Modal logic for Top5, Delete confirmation, and table cell editing */
/* Detailed debug logging at every interaction and modification step */
'use strict';

// ===== TOP 5 MODAL =====
function onTop5ModalYearChange(newYear) {
  console.log(`%c[TOP5] Year changed to: "${newYear}"`, "color:#0284c7;");
  if ($("yearPick")) { $("yearPick").value = newYear; onDateFilterChange({ target: $("yearPick") }); }
  else renderMetrics();
  openTop5Modal(newYear);
}

function openTop5Modal(overrideYear = null) {
  const modal = $("top5Modal"), body = $("top5ModalBody"), summary = $("top5ModalSummary"), badgeYear = $("top5BadgeYear"), yearSelect = $("top5ModalYearSelect");
  if (!modal || !body) return;
  const activeYear = overrideYear !== null ? overrideYear : (selectedYear() || (selectedMonth() ? selectedMonth().slice(0, 4) : ""));
  console.log(`%c[TOP5] openTop5Modal for year: "${activeYear || 'ALL'}"`, "color:#4f46e5; font-weight:bold;");

  if (yearSelect) {
    const yearsFound = new Set([2026]);
    (db.replacements || []).forEach(r => { if (r.ReplaceDate && r.ReplaceDate.length >= 4) { const y = parseInt(r.ReplaceDate.slice(0, 4), 10); if (y) yearsFound.add(y); } });
    (db.shoot || []).forEach(r => { if (r.Date && r.Date.length >= 4) { const y = parseInt(r.Date.slice(0, 4), 10); if (y) yearsFound.add(y); } });
    yearSelect.innerHTML = `<option value="">Tất cả năm</option>` + [...yearsFound].sort((a, b) => b - a).map(y => `<option value="${y}" ${String(activeYear) === String(y) ? 'selected' : ''}>Năm ${y}</option>`).join("");
  }
  if (badgeYear) badgeYear.textContent = activeYear ? `Năm ${activeYear}` : "Tất cả các năm";

  const summaryList = result.summary || [];
  const { counts, partCounts, totalRepsInYear } = getReplacementsByYear(activeYear);
  const rankedList = summaryList.map(item => {
    const pdKey = (String(item.Part || "").trim() + "|" + String(item.DieSet || "").trim()).toLowerCase();
    const pKey = String(item.Part || "").trim().toLowerCase();
    return { ...item, YearlyReplacements: counts.get(pdKey) || (pKey ? partCounts.get(pKey) : 0) || 0 };
  });
  const top5 = rankedList.filter(s => s.YearlyReplacements > 0).sort((a, b) => b.YearlyReplacements - a.YearlyReplacements).slice(0, 5);

  if (top5.length === 0) {
    body.innerHTML = `<div style="text-align:center; padding:36px 10px; color:var(--ink-muted);"><div style="font-size:36px; margin-bottom:10px;">📦</div><div style="font-weight:700; font-size:14px; color:var(--ink);">Không có dữ liệu thay thế ${activeYear ? `trong năm ${activeYear}` : ''}</div></div>`;
    if (summary) summary.textContent = `Tổng số: 0 linh kiện thay thế ${activeYear ? `năm ${activeYear}` : ''}`;
    modal.classList.remove("hidden"); return;
  }

  const maxReps = top5[0].YearlyReplacements || 1;
  const top5TotalReps = top5.reduce((sum, r) => sum + r.YearlyReplacements, 0);
  const top5Pct = totalRepsInYear > 0 ? Math.round((top5TotalReps / totalRepsInYear) * 100) : 0;
  const rankIcons = ["🥇 #1", "🥈 #2", "🥉 #3", "#4", "#5"];
  const rankClasses = ["top5-rank-1", "top5-rank-2", "top5-rank-3", "top5-rank-other", "top5-rank-other"];

  body.innerHTML = top5.map((item, idx) => {
    const pct = Math.max(10, Math.round((item.YearlyReplacements / maxReps) * 100));
    const avgLifeFormatted = item.AverageShots > 0 ? (item.AverageShots >= 1000 ? (item.AverageShots / 1000).toLocaleString('en-US', {maximumFractionDigits: 1}) + 'k shots' : item.AverageShots + ' shots') : '-';
    const totalShotsFormatted = item.TotalShots > 0 ? (item.TotalShots >= 1000000 ? (item.TotalShots / 1000000).toFixed(2) + 'M' : item.TotalShots >= 1000 ? Math.round(item.TotalShots / 1000) + 'k' : item.TotalShots) : '0';
    return `<div class="top5-card-item"><div class="top5-rank-badge ${rankClasses[idx]}"><span style="font-size:${idx < 3 ? '13px' : '12px'};">${rankIcons[idx]}</span></div><div class="top5-part-info"><div class="top5-part-title"><span>Part: ${item.Part}</span><span style="font-size:11px; font-weight:600; padding:1px 6px; border-radius:4px; background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe;">${item.DieSet || 'Mold'}</span></div><div class="top5-part-meta"><span>Series: <b>${item.Series || '-'}</b></span> · <span>Tuổi thọ TB: <b>${avgLifeFormatted}</b></span> · <span>Tổng shot: <b>${totalShotsFormatted}</b></span></div></div><div class="top5-stat-col"><div class="top5-rep-count">${item.YearlyReplacements.toLocaleString()} <span style="font-size:11px; font-weight:600; color:var(--ink-muted);">lần</span></div><div class="top5-progress-wrap" title="${pct}%"><div class="top5-progress-fill" style="width: ${pct}%;"></div></div></div><div><button class="top5-filter-btn" onclick="filterByTop5Part('${item.Part}')" title="Lọc và xem chi tiết">🔍 Xem chi tiết</button></div></div>`;
  }).join("");

  if (summary) summary.innerHTML = `Top 5 chiếm <b>${top5TotalReps.toLocaleString()}</b> lượt thay (<b>${top5Pct}%</b> trên tổng ${totalRepsInYear.toLocaleString()} lượt)`;
  modal.classList.remove("hidden");
  console.log(`%c[TOP5] Rendered ${top5.length} items (Total in year: ${totalRepsInYear})`, "color:#059669;");
}

function closeTop5Modal() { const modal = $("top5Modal"); if (modal) modal.classList.add("hidden"); }

function filterByTop5Part(partCode) {
  if (!partCode) return;
  console.log(`%c[TOP5] Filtering by part: ${partCode}`, "color:#0284c7;");
  closeTop5Modal();
  const searchInp = $("globalSearch");
  if (searchInp) { searchInp.value = partCode; onGlobalSearchInput(); searchInp.focus(); }
  msg(`Đang lọc dữ liệu theo Part: ${partCode}`);
}

// ===== DELETE REPLACEMENT MODAL =====
let _pendingDeletion = null;

function openDeleteReasonModal() {
  if (!_pendingDeletion) return;
  const modal = $("deleteReasonModal"), infoEl = $("deleteTargetInfo"), reasonInp = $("deleteReasonText");
  if (!modal) return;
  console.log(`%c[DELETE:MODAL] Request deletion for ${_pendingDeletion.partName} (${_pendingDeletion.dieSet}) at ${_pendingDeletion.date}`, "color:#ef4444; font-weight:bold;");
  if (infoEl) {
    infoEl.innerHTML = `<div>Mã Part: <b style="color:#0f172a;">${esc(_pendingDeletion.partName)}</b></div><div>Khuôn (DieSet): <b style="color:#1d4ed8;">${esc(_pendingDeletion.dieSet)}</b></div><div>Ngày thay thế: <b style="color:#b45309;">${esc(_pendingDeletion.date)}</b></div><div>Lượt thay / Qty cũ: <b style="color:#dc2626;">${esc(_pendingDeletion.oldVal)}</b></div>`;
  }
  if (reasonInp) { reasonInp.value = ""; reasonInp.style.borderColor = "var(--border)"; setTimeout(() => reasonInp.focus(), 150); }
  modal.classList.remove("hidden");
}

function setQuickDeleteReason(reason) {
  const reasonInp = $("deleteReasonText");
  if (reasonInp) { reasonInp.value = reason; reasonInp.style.borderColor = "var(--border)"; reasonInp.focus(); }
}

function cancelDeleteReplacement() {
  const modal = $("deleteReasonModal");
  if (modal) modal.classList.add("hidden");
  if (_pendingDeletion && _pendingDeletion.cell) _pendingDeletion.cell.textContent = _pendingDeletion.oldVal;
  _pendingDeletion = null;
  console.log("%c[DELETE] Canceled deletion", "color:#6b7280;");
}

function confirmDeleteReplacement() {
  if (!_pendingDeletion) return;
  const reasonInp = $("deleteReasonText");
  const reason = reasonInp ? reasonInp.value.trim() : "";
  if (!reason) {
    if (reasonInp) { reasonInp.style.borderColor = "#dc2626"; reasonInp.focus(); }
    return alert("Vui lòng nhập lý do xóa lượt thay thế để ghi nhận vào nhật ký kiểm soát!");
  }
  const { date, dieSet, partName, oldVal } = _pendingDeletion;
  console.log(`%c[DELETE] Confirmed deletion: ${partName} (${dieSet}) on ${date} (Reason: ${reason})`, "color:#ef4444; font-weight:bold;");
  db.deletionLogs = db.deletionLogs || [];
  db.deletionLogs.push({ id: "DEL-" + Date.now(), Part: partName, DieSet: dieSet, ReplaceDate: date, Label: oldVal, Reason: reason, DeletedAt: new Date().toISOString() });
  db.replacements = (db.replacements || []).filter(row => {
    const sameDate = row.ReplaceDate === date;
    const rDie = String(row.DieSet || "").toLowerCase().trim();
    const rPart = String(row.Part || "").toLowerCase().trim();
    const sameDieOrPart = (dieSet && rDie === dieSet.toLowerCase().trim()) || (partName && (rPart === partName.toLowerCase().trim() || rDie === partName.toLowerCase().trim()));
    return !(sameDate && sameDieOrPart);
  });
  db.replacements.sort((a, b) => a.ReplaceDate.localeCompare(b.ReplaceDate));
  const modal = $("deleteReasonModal");
  if (modal) modal.classList.add("hidden");
  _pendingDeletion = null;
  save(); rebuild(false); renderActiveTabOnly();
  msg(`✅ Đã xóa lượt thay ngày ${date} của linh kiện ${partName} (${dieSet}). Lý do: ${reason}`);
}

// ===== CELL EDITING =====
function isReplacementDate(dateStr, dieSet, partName) {
  const dDie = String(dieSet || "").toLowerCase().trim();
  const pPart = String(partName || "").toLowerCase().trim();
  return (db.replacements || []).some(row => {
    if (row.ReplaceDate !== dateStr) return false;
    const rDie = String(row.DieSet || "").toLowerCase().trim();
    const rPart = String(row.Part || "").toLowerCase().trim();
    const lbl = String(row.Label || "").trim();
    const isValid = lbl && lbl !== "-" && lbl !== "0" && lbl !== "·";
    return isValid && ((dDie && rDie === dDie) || (pPart && (rPart === pPart || rDie === pPart)));
  });
}

function clearRawShootForDateAndShiftChain(dateStr, dieSet, partName) {
  const dDie = String(dieSet || "").toLowerCase().trim();
  const pPart = String(partName || "").toLowerCase().trim();
  const isTargetRow = row => { const rDie = String(row.DieSet || "").toLowerCase().trim(); return (dDie && rDie === dDie) || (pPart && rDie === pPart); };
  db.shoot = db.shoot.filter(row => !(row.Date === dateStr && isTargetRow(row)));
  db.rawShoot = (db.rawShoot || []).filter(row => !(row.Date === dateStr && isTargetRow(row)));
  let curr = dateStr;
  while (true) {
    const prev = getPrevDateStr(curr);
    if (!isReplacementDate(prev, dieSet, partName)) break;
    db.shoot = db.shoot.filter(row => !(row.Date === prev && isTargetRow(row)));
    db.rawShoot = (db.rawShoot || []).filter(row => !(row.Date === prev && isTargetRow(row)));
    curr = prev;
  }
}

function updateCell(cell) {
  const type = cell.dataset.type, date = cell.dataset.date;
  const dieSet = cell.dataset.dieset || activeDieSet();
  const partName = cell.dataset.part || getContext().part || "Unknown";
  const oldVal = (cell.dataset.oldVal !== undefined ? cell.dataset.oldVal : cell.textContent).trim();
  const text = cell.textContent.trim();

  console.log(`%c[CELL:EDIT] type=${type}, date=${date}, part=${partName}, dieSet=${dieSet}, old="${oldVal}", new="${text}"`, "color:#d97706;");

  if (!date || date.startsWith("-")) { cell.textContent = oldVal; return msg("Vui lòng chọn tháng/năm cụ thể trước khi chỉnh sửa ô.", true); }
  if (!dieSet) { cell.textContent = oldVal; return msg("Cần chọn linh kiện hoặc nhập Mold trước khi sửa.", true); }

  if (type === "shoot") {
    const value = parseShootValue(text);
    clearRawShootForDateAndShiftChain(date, dieSet, partName);
    if (value > 0) { db.shoot.push({ Date: date, DieSet: dieSet, Output: value }); db.rawShoot.push({ Date: date, DieSet: dieSet, Output: value }); }
    db.shoot.sort((a, b) => a.Date.localeCompare(b.Date) || a.DieSet.localeCompare(b.DieSet));
    save(); rebuild(false); renderActiveTabOnly();
    console.log(`%c[CELL:EDIT] Updated shoot for ${dieSet} on ${date}: ${value}`, "color:#059669;");
    return;
  }

  const wasReplacement = oldVal && oldVal !== "-" && oldVal !== "0" && oldVal !== "·";
  const cleanVal = text.trim();
  const isNewReplacement = cleanVal && cleanVal !== "-" && cleanVal !== "0" && cleanVal !== "·";

  if (wasReplacement && !isNewReplacement) {
    _pendingDeletion = { cell, date, dieSet, partName, oldVal, newText: text };
    openDeleteReasonModal(); return;
  }

  if (isNewReplacement) {
    db.replacements = (db.replacements || []).filter(row => {
      const sameDate = row.ReplaceDate === date;
      const rDie = String(row.DieSet || "").toLowerCase().trim();
      const rPart = String(row.Part || "").toLowerCase().trim();
      const sameDieOrPart = (dieSet && rDie === dieSet.toLowerCase().trim()) || (partName && (rPart === partName.toLowerCase().trim() || rDie === partName.toLowerCase().trim()));
      return !(sameDate && sameDieOrPart);
    });
    db.replacements.push({ Part: partName, Series: getSeriesForPart(partName, dieSet) || getContext().series || "", DieSet: dieSet, ReplaceDate: date, Label: cleanVal });
    db.replacements.sort((a, b) => a.ReplaceDate.localeCompare(b.ReplaceDate));
    save(); rebuild(false); renderActiveTabOnly();
    console.log(`%c[CELL:EDIT] Updated replacement for ${partName} (${dieSet}) on ${date}: ${cleanVal}`, "color:#059669;");
    msg(`✅ Đã cập nhật lượt thay thế linh kiện ${partName} (${dieSet}) ngày ${date}: ${cleanVal} lượt.`);
    return;
  }

  cell.textContent = "-"; cell.classList.remove("replacement"); cell.classList.add("empty");
}

// ===== Stock filter controls =====
function toggleStockCheckboxAll(allChk) {
  const isChecked = allChk ? allChk.checked : false;
  if ($("chkCritical")) $("chkCritical").checked = isChecked;
  if ($("chkWarning")) $("chkWarning").checked = isChecked;
  if ($("chkSafe")) $("chkSafe").checked = isChecked;
  if ($("chkReplaced")) $("chkReplaced").checked = false;
  updateStockFilterBtnClasses(); renderStockTable();
}

function toggleStockStatusCheckbox() {
  const isCritical = $("chkCritical") ? $("chkCritical").checked : false;
  const isWarning = $("chkWarning") ? $("chkWarning").checked : false;
  const isSafe = $("chkSafe") ? $("chkSafe").checked : false;
  if ($("chkAll")) $("chkAll").checked = isCritical && isWarning && isSafe;
  updateStockFilterBtnClasses(); renderStockTable();
}

function updateStockFilterBtnClasses() {
  [{ chk: "chkAll", lbl: "stockFilterAllLabel" }, { chk: "chkReplaced", lbl: "stockFilterReplacedLabel" }, { chk: "chkCritical", lbl: "stockFilterCriticalLabel" }, { chk: "chkWarning", lbl: "stockFilterWarningLabel" }, { chk: "chkSafe", lbl: "stockFilterSafeLabel" }].forEach(item => {
    const c = $(item.chk), l = $(item.lbl);
    if (c && l) l.classList.toggle("active", c.checked);
  });
}

function updateStockQty(part, dieSet, delta) {
  const item = getStockItem(part, dieSet);
  item.stock = Math.max(0, (Number(item.stock) || 0) + delta);
  const master = findMasterItem(part, dieSet);
  if (master) { const p = (part || '').trim(); if (master.OldDieSet) _stockData[`${p}|${master.OldDieSet.trim()}`] = item; if (master.NewDieSet) _stockData[`${p}|${master.NewDieSet.trim()}`] = item; }
  console.log(`%c[STOCK:QTY] Updated stock for ${part}|${dieSet}: ${item.stock} (delta: ${delta})`, "color:#0284c7;");
  saveStockData(); renderStockTable();
}

function toggleWearCheckboxAll(masterCb) {
  const isChecked = masterCb.checked;
  [$('chkWearCritical'), $('chkWearWarning'), $('chkWearSafe')].forEach(chk => { if (chk) chk.checked = isChecked; });
  updateWearFilterLabels(); renderWearTable();
}

function toggleWearStatusCheckbox() {
  const allChecked = [$('chkWearCritical'), $('chkWearWarning'), $('chkWearSafe')].every(chk => chk && chk.checked);
  if ($('chkWearAll')) $('chkWearAll').checked = allChecked;
  updateWearFilterLabels(); renderWearTable();
}

function updateWearFilterLabels() {
  if ($('wearFilterAllLabel') && $('chkWearAll')) $('wearFilterAllLabel').classList.toggle('active', $('chkWearAll').checked);
  if ($('wearFilterCriticalLabel') && $('chkWearCritical')) $('wearFilterCriticalLabel').classList.toggle('active', $('chkWearCritical').checked);
  if ($('wearFilterWarningLabel') && $('chkWearWarning')) $('wearFilterWarningLabel').classList.toggle('active', $('chkWearWarning').checked);
  if ($('wearFilterSafeLabel') && $('chkWearSafe')) $('wearFilterSafeLabel').classList.toggle('active', $('chkWearSafe').checked);
}

// ===== CLEAR JSON DATA MODAL =====
function openClearDataModal() {
  console.log("%c[MODAL] openClearDataModal", "color:#dc2626; font-weight:bold;");
  const modal = $("clearDataModal");
  if (modal) modal.classList.remove("hidden");
}

function closeClearDataModal() {
  console.log("%c[MODAL] closeClearDataModal", "color:#6b7280;");
  const modal = $("clearDataModal");
  if (modal) modal.classList.add("hidden");
}

async function confirmClearJsonData() {
  const selectedRadio = document.querySelector('input[name="clearJsonType"]:checked');
  const clearType = selectedRadio ? selectedRadio.value : 'all';
  
  let label = "toàn bộ dữ liệu (Shot và Lần thay)";
  if (clearType === 'shoot') label = "dữ liệu Shot Number (sản lượng dập hàng ngày)";
  else if (clearType === 'replacements') label = "dữ liệu Lần Thay Thế (replace time log)";

  const confirmed = window.confirm(`⚠️ XÁC NHẬN LẦN CUỐI:\n\nBạn có chắc chắn muốn xóa ${label.toUpperCase()} trong file JSON không?\n\n(Dữ liệu JSON lưu trữ sẽ bị làm trống. Bạn có thể nạp lại bất kỳ lúc nào từ file Excel gốc).`);
  if (!confirmed) return;

  try {
    msg("⏳ Đang tiến hành xóa dữ liệu JSON...", false);
    const res = await fetch(`/api/clear-json?type=${clearType}`);
    const data = await res.json();
    
    if (clearType === 'shoot' || clearType === 'all') {
      db.shoot = [];
      db.rawShoot = [];
    }
    if (clearType === 'replacements' || clearType === 'all') {
      db.replacements = [];
    }
    
    invalidatePartsCache();
    closeClearDataModal();
    renderActiveTabOnly();
    renderMetrics();
    msg(`✅ <b>Đã xóa thành công:</b> ${label}!`, false, 5000);
  } catch (err) {
    console.error("Lỗi khi xóa JSON:", err);
    msg("❌ Lỗi kết nối khi xóa dữ liệu JSON.", true);
  }
}

// ===== COMPONENT FULL DETAILS MODAL / DRAWER =====
function openComponentDetailModal(partName, moldNew, moldOld, seriesVal) {
  const modal = $("componentDetailModal");
  const titleEl = $("detailModalTitle");
  const subtitleEl = $("detailModalSubtitle");
  const bodyEl = $("detailModalBody");
  if (!modal || !bodyEl) return;

  const pLower = String(partName || '').toLowerCase().trim();
  const dNewLower = String(moldNew || '').toLowerCase().trim();
  const dOldLower = String(moldOld || '').toLowerCase().trim();

  // 1. Traceability & Master Item
  const masterItem = typeof findMasterItem === 'function' ? findMasterItem(partName, moldNew || moldOld, seriesVal) : null;
  const finalSeries = seriesVal || (masterItem ? masterItem.Series : '') || '-';
  const finalOld = moldOld || (masterItem ? masterItem.OldDieSet : '') || '-';
  const finalNew = moldNew || (masterItem ? masterItem.NewDieSet : '') || '-';
  const fullCode = `${finalSeries}/${finalOld}/${finalNew}`;

  // 2. Inventory & Stock
  const st = typeof getStockItem === 'function' ? getStockItem(partName, moldNew || moldOld) : {};
  const stock = Number(st.stock !== undefined ? st.stock : (masterItem ? masterItem.StockLeft : 0)) || 0;
  const minStock = Number(st.minStock !== undefined ? st.minStock : (masterItem ? masterItem.StandardStock : 1)) || 1;
  const status = stock <= 0 ? 'CRITICAL' : (stock < minStock ? 'WARNING' : 'SAFE');
  const statusBadge = status === 'CRITICAL' 
    ? `<span class="badge-stock critical" style="font-size:12px;padding:3px 8px;font-weight:700;">🔴 URGENT</span>` 
    : (status === 'WARNING' 
      ? `<span class="badge-stock warning" style="font-size:12px;padding:3px 8px;font-weight:700;">🟡 NEED ORDER</span>` 
      : `<span class="badge-stock safe" style="font-size:12px;padding:3px 8px;font-weight:700;">🟢 NO NEED</span>`);

  // 3. Shoots & Replacements
  let allShoots = [];
  (db.shoot || []).forEach(s => {
    if (!s.Date || !s.Output || Number(s.Output) <= 0) return;
    const d = String(s.DieSet || '').toLowerCase().trim();
    if ((dNewLower && d === dNewLower) || (dOldLower && d === dOldLower)) allShoots.push(s);
  });
  allShoots.sort((a, b) => (a.Date || '').localeCompare(b.Date || ''));

  let allReps = [];
  (db.replacements || []).forEach(r => {
    if (!r.ReplaceDate) return;
    const p = String(r.Part || '').toLowerCase().trim();
    const d = String(r.DieSet || r.NewDieSet || r.OldDieSet || '').toLowerCase().trim();
    if (p === pLower && ((dNewLower && d === dNewLower) || (dOldLower && d === dOldLower))) {
      allReps.push(r);
    }
  });
  allReps.sort((a, b) => (a.ReplaceDate || '').localeCompare(b.ReplaceDate || ''));

  const totalShoots = allShoots.reduce((sum, s) => sum + (Number(s.Output) || 0), 0);
  const totalRepsCount = allReps.length;
  const totalUsedPcs = allReps.reduce((sum, r) => sum + (Number(r.Label) || 1), 0);

  // Cycles calculation
  const cycles = [];
  if (allReps.length > 0) {
    const c1 = allShoots.filter(s => s.Date < allReps[0].ReplaceDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0);
    if (c1 > 0) cycles.push(c1);
    for (let i = 0; i < allReps.length - 1; i++) {
      const cN = allShoots.filter(s => s.Date >= allReps[i].ReplaceDate && s.Date < allReps[i + 1].ReplaceDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0);
      if (cN > 0) cycles.push(cN);
    }
  }

  const avgShot = cycles.length > 0 ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : (totalShoots > 0 ? totalShoots : 0);
  const minShot = cycles.length > 0 ? Math.min(...cycles) : 0;
  const maxShot = cycles.length > 0 ? Math.max(...cycles) : 0;
  const currentShot = allReps.length > 0 ? allShoots.filter(s => s.Date >= allReps[allReps.length - 1].ReplaceDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0) : totalShoots;
  const wearPct = avgShot > 0 ? Math.min(100, Math.round((currentShot / avgShot) * 100)) : 0;

  if (titleEl) titleEl.innerHTML = `Linh Kiện: <span style="color:#2563eb; font-family:monospace; background:#eff6ff; padding:2px 8px; border-radius:6px; border:1px solid #bfdbfe;">${esc(partName)}</span>`;
  if (subtitleEl) subtitleEl.textContent = `Mã khuôn & Series: ${fullCode}`;

  bodyEl.innerHTML = `
    <!-- Section 1: INVENTORY & STOCK -->
    <div class="detail-section-box">
      <div class="detail-section-title">
        <span>📦 1. INVENTORY (Quản Lý Tồn Kho)</span>
        <div style="margin-left:auto;">${statusBadge}</div>
      </div>
      <div class="detail-kpi-grid">
        <div class="detail-kpi-card">
          <span class="detail-kpi-label">Tồn Kho Hiện Tại</span>
          <span class="detail-kpi-val" style="color:${stock <= 0 ? '#dc2626' : (stock < minStock ? '#d97706' : '#0f172a')}; font-size:17px;">${stock} pcs</span>
        </div>
        <div class="detail-kpi-card">
          <span class="detail-kpi-label">Mức Min An Toàn</span>
          <span class="detail-kpi-val" style="color:#64748b; font-size:17px;">${minStock} pcs</span>
        </div>
        <div class="detail-kpi-card">
          <span class="detail-kpi-label">Cần Đặt Bổ Sung</span>
          <span class="detail-kpi-val" style="color:${stock < minStock ? '#dc2626' : '#059669'}; font-size:17px;">${Math.max(0, minStock - stock)} pcs</span>
        </div>
      </div>
    </div>

    <!-- Section 2: COMPONENT LIFE -->
    <div class="detail-section-box">
      <div class="detail-section-title">
        <span>⚡ 2. COMPONENT LIFE (Tuổi Thọ &amp; Chu Kỳ Dập)</span>
        <span style="margin-left:auto; font-size:12px; color:var(--ink-muted); font-weight:600;">Tiến độ mòn: <b style="color:${wearPct >= 90 ? '#dc2626' : (wearPct >= 70 ? '#d97706' : '#059669')}">${wearPct}%</b></span>
      </div>
      <div class="detail-kpi-grid" style="grid-template-columns: repeat(4, 1fr);">
        <div class="detail-kpi-card">
          <span class="detail-kpi-label">Shot Hiện Tại</span>
          <span class="detail-kpi-val" style="color:#2563eb;">${currentShot > 0 ? currentShot.toLocaleString() : '0'}</span>
        </div>
        <div class="detail-kpi-card">
          <span class="detail-kpi-label">Tuổi Thọ TB</span>
          <span class="detail-kpi-val" style="color:#0284c7;">${avgShot > 0 ? avgShot.toLocaleString() : '-'}</span>
        </div>
        <div class="detail-kpi-card">
          <span class="detail-kpi-label">Min Shot</span>
          <span class="detail-kpi-val" style="color:#059669;">${minShot > 0 ? minShot.toLocaleString() : '-'}</span>
        </div>
        <div class="detail-kpi-card">
          <span class="detail-kpi-label">Max Shot</span>
          <span class="detail-kpi-val" style="color:#d97706;">${maxShot > 0 ? maxShot.toLocaleString() : '-'}</span>
        </div>
      </div>

      <!-- Cycles Mini Table -->
      <div style="margin-top:10px;">
        <div style="font-size:12px; font-weight:700; color:var(--ink-secondary); margin-bottom:6px;">Danh sách chu kỳ đã hoàn thành (${cycles.length} chu kỳ):</div>
        <table class="detail-mini-table">
          <thead>
            <tr>
              <th style="width:70px; text-align:center;">Chu Kỳ</th>
              <th style="text-align:right;">Sản Lượng Dập (Shots)</th>
              <th style="text-align:center;">Đánh Giá So Với TB</th>
            </tr>
          </thead>
          <tbody>
            ${cycles.length > 0 ? cycles.map((cVal, i) => {
              const diff = avgShot > 0 ? Math.round(((cVal - avgShot) / avgShot) * 100) : 0;
              const diffBadge = diff > 10 ? `<span style="color:#059669; font-weight:700;">+${diff}% (Bền tốt)</span>` : (diff < -10 ? `<span style="color:#dc2626; font-weight:700;">${diff}% (Mòn sớm)</span>` : `<span style="color:#64748b;">Chuẩn (~TB)</span>`);
              return `<tr><td style="text-align:center; font-weight:700;">Cycle ${i + 1}</td><td style="text-align:right; font-weight:700; color:#0f172a;">${cVal.toLocaleString()}</td><td style="text-align:center;">${diffBadge}</td></tr>`;
            }).join('') : `<tr><td colspan="3" style="text-align:center; color:#94a3b8; padding:10px;">Đang chạy chu kỳ đầu tiên. Chưa phát sinh đủ 2 lần thay để chốt chu kỳ.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Section 3: REPLACEMENT HISTORY -->
    <div class="detail-section-box">
      <div class="detail-section-title">
        <span>🔄 3. REPLACEMENT HISTORY (Lịch Sử Thay Thế)</span>
        <span style="margin-left:auto; font-size:12px; color:var(--ink-muted); font-weight:600;">Tổng: <b>${totalRepsCount}</b> lượt (<b>${totalUsedPcs}</b> pcs)</span>
      </div>
      <div style="max-height:180px; overflow-y:auto; border:1px solid var(--border); border-radius:6px;">
        <table class="detail-mini-table">
          <thead>
            <tr>
              <th style="width:45px; text-align:center;">Lần</th>
              <th>Ngày Thay</th>
              <th style="text-align:center;">Số Lượng (Pcs)</th>
              <th>Mã Phiếu / Request ID</th>
            </tr>
          </thead>
          <tbody>
            ${allReps.length > 0 ? allReps.map((r, i) => `
              <tr>
                <td style="text-align:center; font-weight:700; color:#64748b;">${i + 1}</td>
                <td><span style="font-family:monospace; font-weight:700;">📅 ${r.ReplaceDate}</span></td>
                <td style="text-align:center;"><b style="color:#7c3aed;">${r.Label || 1} pcs</b></td>
                <td>${r.RequestId ? `<span style="font-family:monospace; background:#f1f5f9; padding:2px 6px; border-radius:4px; font-weight:700; font-size:11px;">#${esc(r.RequestId)}</span>` : '<span style="color:#94a3b8;">-</span>'}</td>
              </tr>
            `).join('') : `<tr><td colspan="4" style="text-align:center; color:#94a3b8; padding:12px;">Chưa có lịch sử thay thế nào được ghi nhận.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Section 4: TRACEABILITY -->
    <div class="detail-section-box">
      <div class="detail-section-title">
        <span>🔍 4. TRACEABILITY (Truy Xuất Nguồn Gốc)</span>
      </div>
      <div class="detail-trace-grid">
        <div class="detail-trace-item"><span>Mã Part:</span> <b style="color:#0f172a; font-family:monospace;">${esc(partName)}</b></div>
        <div class="detail-trace-item"><span>Series / Dòng Máy:</span> <b style="color:#0284c7; font-family:monospace;">${esc(finalSeries)}</b></div>
        <div class="detail-trace-item"><span>Mã Khuôn Cũ:</span> <b style="color:#475569; font-family:monospace;">${esc(finalOld)}</b></div>
        <div class="detail-trace-item"><span>Mã Khuôn Mới:</span> <b style="color:#166534; font-family:monospace;">${esc(finalNew)}</b></div>
        <div class="detail-trace-item" style="grid-column: 1 / -1;"><span>Chuỗi Định Danh Đầy Đủ:</span> <b style="color:#0f172a; font-family:monospace; background:#f1f5f9; padding:3px 8px; border-radius:4px;">${esc(fullCode)}</b></div>
      </div>
    </div>
  `;

  modal.classList.remove("hidden");
}

function closeComponentDetailModal() {
  const modal = $("componentDetailModal");
  if (modal) modal.classList.add("hidden");
}

window.addEventListener("keydown", function(e) {
  if (e.key === "Escape") { closeTop5Modal(); cancelDeleteReplacement(); closeClearDataModal(); closeComponentDetailModal(); }
});


/* ui-render.js — All UI rendering (Plan §7: UI only displays, selects, sorts, exports) */
/* Detailed debug logging at every calculation and rendering stage */
'use strict';

// ===== REBUILD (cycle calculation in frontend for backward compat) =====
function rebuild(showMessage = true) {
  console.log("%c[REBUILD] === STAGE: rebuild START ===", "color:#7c3aed; font-weight:bold; font-size:13px;");
  const t0 = performance.now();
  invalidatePartsCache();
  const cycles = [];
  const errors = [];
  const groups = {};

  const validReps = db.replacements.filter(row => {
    const lbl = String(row.Label || "").trim();
    return lbl && lbl !== "-" && lbl !== "0" && lbl !== "·";
  });
  console.log(`%c[REBUILD] 1. Filtered valid replacements: ${validReps.length} / ${(db.replacements||[]).length}`, "color:#0284c7;");

  validReps.forEach(row => {
    const part = (row.Part || "").trim();
    const dieSet = (row.DieSet || "").trim();
    const key = part ? (part + "|" + dieSet) : dieSet;
    (groups[key] ||= []).push(row);
  });
  console.log(`%c[REBUILD] 2. Formed ${Object.keys(groups).length} replacement groups`, "color:#0284c7;");

  // Index shoot data by DieSet and Part for fast O(1) lookups
  const shootsByDie = new Map();
  const shootsByPart = new Map();
  (db.shoot || []).forEach(row => {
    if (!row.Output || Number(row.Output) <= 0) return;
    const rPart = String(row.Part || "").toLowerCase().trim();
    const rDie = String(row.DieSet || "").toLowerCase().trim();
    if (rDie) {
      let list = shootsByDie.get(rDie);
      if (!list) { list = []; shootsByDie.set(rDie, list); }
      list.push(row);
    }
    if (rPart && rPart !== rDie) {
      let list = shootsByPart.get(rPart);
      if (!list) { list = []; shootsByPart.set(rPart, list); }
      list.push(row);
    }
  });

  // Helper to retrieve matched shoots for a part and dieSet
  function getMatchedShoots(partName, dieSetName) {
    const p = String(partName || "").toLowerCase().trim();
    const d = String(dieSetName || "").toLowerCase().trim();
    const seen = new Set();
    const matched = [];

    const addShoots = (list) => {
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const sk = `${s.Date}|${s.Output}|${s.DieSet}`;
        if (!seen.has(sk)) {
          seen.add(sk);
          matched.push(s);
        }
      }
    };

    if (d && shootsByDie.has(d)) addShoots(shootsByDie.get(d));
    if (p && shootsByPart.has(p)) addShoots(shootsByPart.get(p));

    return matched.sort((a, b) => (a.Date || '').localeCompare(b.Date || ''));
  }

  Object.entries(groups).forEach(([key, events]) => {
    events.sort((a, b) => a.ReplaceDate.localeCompare(b.ReplaceDate));
    const parts = key.split("|");
    const part = parts.length > 1 ? parts[0] : (events[0].Part || "");
    const dieSet = parts.length > 1 ? parts[1] : parts[0];
    let series = events.find(e => e.Series && e.Series.trim())?.Series || $("series").value.trim();
    if (!series) series = getSeriesForPart(part, dieSet);

    const shots = getMatchedShoots(part, dieSet);
    if (!shots.length) return;

    const firstRepDate = events[0].ReplaceDate;
    const totalBefore = shots.filter(row => row.Date < firstRepDate).reduce((sum, row) => sum + (Number(row.Output) || 0), 0);
    if (totalBefore > 0) {
      cycles.push({ Part: part, Series: series, DieSet: dieSet, StartDate: shots[0].Date, EndDate: firstRepDate, CycleShots: totalBefore });
    }

    for (let i = 0; i < events.length - 1; i++) {
      const start = events[i].ReplaceDate;
      const end = events[i + 1].ReplaceDate;
      if (end <= start) continue;
      const total = shots.filter(row => row.Date >= start && row.Date < end).reduce((sum, row) => sum + (Number(row.Output) || 0), 0);
      if (total > 0) {
        cycles.push({ Part: part, Series: series, DieSet: dieSet, StartDate: start, EndDate: end, CycleShots: total });
      }
    }
  });
  console.log(`%c[REBUILD] 3. Calculated completed cycles: ${cycles.length}`, "color:#059669; font-weight:bold;");

  // Pre-index cycles by part and dieSet
  const cyclesByPart = new Map();
  const cyclesByDie = new Map();
  cycles.forEach(c => {
    const cP = String(c.Part || "").toLowerCase().trim();
    const cD = String(c.DieSet || "").toLowerCase().trim();
    if (cP) {
      let list = cyclesByPart.get(cP);
      if (!list) { list = []; cyclesByPart.set(cP, list); }
      list.push(c);
    }
    if (cD) {
      let list = cyclesByDie.get(cD);
      if (!list) { list = []; cyclesByDie.set(cD, list); }
      list.push(c);
    }
  });

  // Pre-index replacements by part and dieSet
  const repsByPart = new Map();
  const repsByDie = new Map();
  validReps.forEach(r => {
    const rP = String(r.Part || "").toLowerCase().trim();
    const rD = String(r.DieSet || "").toLowerCase().trim();
    if (rP) {
      let list = repsByPart.get(rP);
      if (!list) { list = []; repsByPart.set(rP, list); }
      list.push(r);
    }
    if (rD) {
      let list = repsByDie.get(rD);
      if (!list) { list = []; repsByDie.set(rD, list); }
      list.push(r);
    }
  });

  const partsToRender = getPartsToRender();
  const rawSummaryList = [];

  partsToRender.forEach(item => {
    const part = item.part;
    const dieSet = item.moldNew || item.moldOld || item.part;
    const series = getSeriesForPart(part, dieSet) || item.series || "-";

    const pLower = String(part || "").toLowerCase().trim();
    const dLower = String(dieSet || "").toLowerCase().trim();

    // Match cycles using index
    const matchedCycleSet = new Set();
    const matchedCycles = [];
    const addCycle = (c) => {
      if (!matchedCycleSet.has(c)) {
        matchedCycleSet.add(c);
        matchedCycles.push(c);
      }
    };
    if (pLower && cyclesByPart.has(pLower)) cyclesByPart.get(pLower).forEach(addCycle);
    if (dLower && cyclesByDie.has(dLower)) cyclesByDie.get(dLower).forEach(addCycle);

    const cycleValues = matchedCycles.map(c => c.CycleShots);
    const completedCount = matchedCycles.length;

    const matchedShoots = getMatchedShoots(part, dieSet);
    const totalShots = matchedShoots.reduce((sum, r) => sum + (Number(r.Output) || 0), 0);

    // Match replacements using index
    const repEventSet = new Set();
    const partRepEvents = [];
    const addRep = (r) => {
      if (!repEventSet.has(r)) {
        repEventSet.add(r);
        partRepEvents.push(r);
      }
    };
    if (pLower && repsByPart.has(pLower)) repsByPart.get(pLower).forEach(addRep);
    if (dLower && repsByDie.has(dLower)) repsByDie.get(dLower).forEach(addRep);
    partRepEvents.sort((a, b) => (a.ReplaceDate || '').localeCompare(b.ReplaceDate || ''));

    const repCount = partRepEvents.length;
    const repCumulativeShots = partRepEvents.map(e => matchedShoots.filter(r => r.Date < e.ReplaceDate).reduce((sum, r) => sum + (Number(r.Output) || 0), 0));

    const totalCycleLife = cycleValues.reduce((a, b) => a + b, 0);
    const avgLife = completedCount > 0 ? Math.round(totalCycleLife / completedCount) : 0;
    const minShots = cycleValues.length > 0 ? Math.min(...cycleValues) : 0;
    const maxShots = cycleValues.length > 0 ? Math.max(...cycleValues) : 0;

    rawSummaryList.push({
      Part: part, Series: series, DieSet: dieSet,
      CompletedCycles: completedCount, TotalShots: totalShots, TotalReplacements: repCount,
      MinShots: minShots, MaxShots: maxShots, AverageShots: avgLife, RepCumulativeShots: repCumulativeShots
    });
  });

  result = { cycles, summary: rawSummaryList, errors };
  renderMetrics();
  const elapsed = Math.round(performance.now() - t0);
  console.log(`%c[REBUILD] === rebuild DONE in ${elapsed}ms: ${rawSummaryList.length} components, ${cycles.length} cycles ===`, "color:#7c3aed; font-weight:bold; font-size:13px;");
  if (showMessage) msg(`Đã phân tích ${rawSummaryList.length} linh kiện (${cycles.length} cycle hoàn chỉnh).`);
}

// ===== METRICS =====
function getReplacementsByYear(targetYear = "") {
  const counts = new Map(), partCounts = new Map();
  let totalRepsInYear = 0;
  (db.replacements || []).forEach(r => {
    const lbl = String(r.Label || "").trim();
    if (!lbl || lbl === "-" || lbl === "0" || lbl === "·") return;
    const repDate = String(r.ReplaceDate || "").trim();
    if (!repDate) return;
    if (targetYear && !repDate.startsWith(targetYear)) return;
    totalRepsInYear++;
    const p = String(r.Part || "").trim().toLowerCase();
    const d = String(r.DieSet || "").trim().toLowerCase();
    const pdKey = (p + "|" + d);
    counts.set(pdKey, (counts.get(pdKey) || 0) + 1);
    if (p) partCounts.set(p, (partCounts.get(p) || 0) + 1);
  });
  return { counts, partCounts, totalRepsInYear };
}

function renderMetrics() {
  const summaryList = result.summary || [];
  const totalPartsCount = summaryList.length;
  const currentYear = selectedYear() || (selectedMonth() ? selectedMonth().slice(0, 4) : "");
  const { counts, partCounts, totalRepsInYear } = getReplacementsByYear(currentYear);

  const partsWithCycles = summaryList.filter(s => s.CompletedCycles > 0);
  const avgLifeVal = partsWithCycles.length > 0 ? Math.round(partsWithCycles.reduce((sum, r) => sum + r.AverageShots, 0) / partsWithCycles.length) : 0;

  const rankedList = summaryList.map(item => {
    const pdKey = (String(item.Part || "").trim() + "|" + String(item.DieSet || "").trim()).toLowerCase();
    const pKey = String(item.Part || "").trim().toLowerCase();
    return { ...item, YearlyReplacements: counts.get(pdKey) || (pKey ? partCounts.get(pKey) : 0) || 0 };
  });

  const sortedByRep = rankedList.filter(s => s.YearlyReplacements > 0).sort((a, b) => b.YearlyReplacements - a.YearlyReplacements);
  const top5Parts = sortedByRep.slice(0, 5);
  window._top5Parts = top5Parts;
  window._top5Year = currentYear;
  const topPart = top5Parts.length > 0 ? top5Parts[0] : null;

  if ($("totalPartsVal")) $("totalPartsVal").textContent = totalPartsCount.toLocaleString();
  if ($("totalReplacementsVal")) $("totalReplacementsVal").textContent = totalRepsInYear.toLocaleString();
  if ($("avgLifeVal")) $("avgLifeVal").textContent = avgLifeVal > 0 ? (avgLifeVal >= 1000 ? Math.round(avgLifeVal / 1000) + "k" : avgLifeVal) : "-";
  if ($("overviewRepsSub")) $("overviewRepsSub").textContent = currentYear ? `Trong năm ${currentYear}` : "Tất cả các năm";

  // Calculate Output shots for current period
  const ymFilter = selectedMonth(), yFilter = selectedYear();
  let totalOutput = 0;
  (db.shoot || []).forEach(s => {
    if (!s.Date || !s.Output) return;
    if (ymFilter && monthKey(s.Date) !== ymFilter) return;
    if (yFilter && !s.Date.startsWith(yFilter)) return;
    totalOutput += (Number(s.Output) || 0);
  });
  if ($("totalOutputShotsVal")) $("totalOutputShotsVal").textContent = totalOutput > 0 ? totalOutput.toLocaleString() : "0";

  if ($("mostReplacedVal")) {
    if (topPart) {
      $("mostReplacedVal").textContent = `#1: ${topPart.Part} (${topPart.DieSet})`;
      if ($("mostReplacedSub")) $("mostReplacedSub").innerHTML = `<b>${topPart.YearlyReplacements} lần</b>${currentYear ? ' (' + currentYear + ')' : ''} · Xem Top 5 ▾`;
    } else {
      $("mostReplacedVal").textContent = "Chưa có";
      if ($("mostReplacedSub")) $("mostReplacedSub").textContent = currentYear ? `0 lượt (Năm ${currentYear})` : "0 lượt thay";
    }
  }
  console.log(`%c[METRICS] Year: "${currentYear || 'ALL'}" | Parts: ${totalPartsCount} | TotalReps: ${totalRepsInYear} | AvgLife: ${avgLifeVal} | Top: ${topPart ? `${topPart.Part} (${topPart.YearlyReplacements} reps)` : 'None'}`, "color:#6b7280;");
}

// ===== OVERVIEW TAB (V3 Dashboard) =====
function renderOverviewTab() {
  console.log("%c[RENDER:OVERVIEW] renderOverviewTab START", "color:#0284c7; font-weight:bold;");
  renderMetrics();

  // Populate Top 5 list in Overview
  const topListEl = $("overviewTopList");
  if (topListEl) {
    const top5 = window._top5Parts || [];
    if (top5.length === 0) {
      topListEl.innerHTML = `
        <div style="text-align:center; padding:28px 14px; color:var(--ink-muted);">
          <div style="font-size:13px; font-weight:600;">Chưa ghi nhận lượt thay thế nào trong kỳ đã chọn.</div>
        </div>
      `;
    } else {
      topListEl.innerHTML = top5.map((item, idx) => {
        const rankClass = idx === 0 ? 'top-1' : (idx === 1 ? 'top-2' : (idx === 2 ? 'top-3' : 'top-other'));
        const avgLifeFormatted = item.AverageShots > 0 ? `${item.AverageShots.toLocaleString()} shots` : 'Chưa có chu kỳ';
        return `
          <div class="overview-rank-item" onclick="openComponentDetailByName('${esc(item.Part)}', '${esc(item.DieSet)}', '${esc(item.Series || '')}')" title="Bấm để xem chi tiết linh kiện">
            <div class="rank-badge ${rankClass}">#${idx + 1}</div>
            <div class="rank-item-info">
              <div class="rank-item-part">${esc(item.Part)}</div>
              <div class="rank-item-sub">Khuôn: <b>${esc(item.DieSet || '-')}</b> · Series: ${esc(item.Series || '-')} · TB: ${avgLifeFormatted}</div>
            </div>
            <div class="rank-item-metric">
              <div class="rank-rep-count">${item.YearlyReplacements.toLocaleString()} lượt</div>
              <div class="rank-rep-label">thay thế</div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Populate Inventory & Wear Alerts in Overview
  const alertsListEl = $("overviewAlertsList");
  if (alertsListEl) {
    const alerts = [];
    
    // 1. Stock deficits
    (masterData || []).forEach(m => {
      const partName = m.PartName;
      const mold = m.NewDieSet || m.OldDieSet || '';
      const stockItem = typeof getStockItem === 'function' ? getStockItem(partName, mold) : {};
      const stock = Number(stockItem.stock !== undefined ? stockItem.stock : m.StockLeft) || 0;
      const minStock = Number(stockItem.minStock !== undefined ? stockItem.minStock : m.StandardStock) || 0;

      if (minStock > 0 && stock <= 0) {
        alerts.push({
          severity: 'critical',
          title: `Hết hàng tồn kho: ${partName}`,
          desc: `Tồn kho: 0 pcs (Định mức tối thiểu: ${minStock} pcs) - Mã khuôn: ${mold || '-'}`,
          part: partName,
          mold: mold
        });
      } else if (minStock > 0 && stock < minStock) {
        alerts.push({
          severity: 'warning',
          title: `Tồn kho dưới mức an toàn: ${partName}`,
          desc: `Tồn kho: ${stock} pcs (Thiếu ${minStock - stock} pcs so với định mức ${minStock} pcs)`,
          part: partName,
          mold: mold
        });
      }
    });

    // 2. High shot wear ratio vs average life
    const summaryList = result.summary || [];
    summaryList.forEach(s => {
      if (s.AverageShots > 0 && s.CurrentShot && s.CurrentShot >= s.AverageShots) {
        alerts.push({
          severity: 'warning',
          title: `Linh kiện vượt chu kỳ TB: ${s.Part}`,
          desc: `Đã dập ${s.CurrentShot.toLocaleString()} shots (Tuổi thọ TB: ${s.AverageShots.toLocaleString()} shots)`,
          part: s.Part,
          mold: s.DieSet
        });
      }
    });

    if (alerts.length === 0) {
      alertsListEl.innerHTML = `
        <div style="text-align:center; padding:28px 14px; color:var(--emerald-text); background:var(--emerald-light); border-radius:var(--radius-sm); border:1px solid var(--emerald-border);">
          <div style="font-weight:700; font-size:13.5px;">Hệ Thống Vận Hành An Toàn</div>
          <div style="font-size:12px; margin-top:3px; opacity:0.9;">Tất cả linh kiện đang ở mức tồn kho và chu kỳ dập ổn định.</div>
        </div>
      `;
    } else {
      alertsListEl.innerHTML = alerts.slice(0, 5).map(a => `
        <div class="overview-alert-card ${a.severity}" onclick="openComponentDetailByName('${esc(a.part)}', '${esc(a.mold)}')" style="cursor:pointer;" title="Bấm để xem chi tiết">
          <div style="font-size:16px;">${a.severity === 'critical' ? '🔴' : '🟡'}</div>
          <div style="flex:1; min-width:0;">
            <div style="font-weight:700; font-size:13px;">${esc(a.title)}</div>
            <div style="font-size:11.5px; opacity:0.85; margin-top:1px;">${esc(a.desc)}</div>
          </div>
          <button type="button" class="btn-expand-detail" style="flex-shrink:0;">Chi tiết</button>
        </div>
      `).join('');
    }
  }
}

// ===== GLOBAL PAGINATION DOCK =====
function updateGlobalPaginationDock(tabName, currentLimit, totalCount, moreCallback, allCallback) {
  const dock = $('globalPaginationDock');
  const label = $('gpdCountText');
  if (!dock || !label) return;
  if (totalCount > currentLimit) {
    window.gpdMoreAction = moreCallback;
    window.gpdAllAction = allCallback;
    const nextStep = (tabName === 'month' ? 30 : 40);
    label.innerHTML = `<b>${currentLimit}</b> / ${totalCount.toLocaleString()}`;
    if ($('gpdBtnMore')) { $('gpdBtnMore').innerHTML = `+${nextStep}`; $('gpdBtnMore').style.display = 'inline-flex'; }
    if ($('gpdBtnAll')) { $('gpdBtnAll').innerHTML = `Tất cả`; $('gpdBtnAll').style.display = 'inline-flex'; }
    dock.style.display = 'flex';
  } else {
    window.gpdMoreAction = null; window.gpdAllAction = null;
    if (totalCount > 0) {
      label.innerHTML = `<b>${totalCount.toLocaleString()}</b> / ${totalCount.toLocaleString()}`;
      if ($('gpdBtnMore')) $('gpdBtnMore').style.display = 'none';
      if ($('gpdBtnAll')) $('gpdBtnAll').style.display = 'none';
      dock.style.display = 'flex';
    } else { dock.style.display = 'none'; }
  }
}

function scrollToTopActiveTable() {
  const curTab = currentActiveTab;
  let container = null;
  if (curTab === 'month') container = document.querySelector('#monthTab .sheet');
  else if (curTab === 'stock') container = document.querySelector('#stockTab .summary-box');
  else if (curTab === 'report') container = document.querySelector('#reportTab .summary-box');
  if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== RENDER ACTIVE TAB =====
function renderActiveTabOnly() {
  const activeTab = currentActiveTab || "month";
  console.log(`%c[RENDER] renderActiveTabOnly -> "${activeTab}"`, "color:#0284c7; font-weight:bold;");
  renderMetrics();
  if (activeTab === "overview") renderOverviewTab();
  else if (activeTab === "month") renderMonth();
  else if (activeTab === "stock") renderStockTable();
  else if (activeTab === "report") renderComponentLifeReport();
  else if (activeTab === "chart") renderChartsTab();
  else if (activeTab === "inspection") renderInspectionTab();
  else if (activeTab === "dimensionocr") initDimensionOcr();
}

// ===== RENDER COMPONENT LIFE REPORT TAB =====
function renderComponentLifeReport() {
  console.log("%c[RENDER:REPORT] renderComponentLifeReport START", "color:#0284c7; font-weight:bold;");
  if (!$("reportTable") || !$("reportRows")) return;

  const ymFilter = selectedMonth();
  const yFilter = selectedYear();
  const dFilter = selectedDay();

  // Index Shoots and Replacements with date filtering
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

  const allParts = getPartsToRender();

  let maxCyclesFound = 3;
  const rowsData = [];

  allParts.forEach((item, index) => {
    const part = item.part;
    const series = item.series || '-';
    const moldNew = item.moldNew || item.moldOld || item.part;
    const moldOld = item.moldOld || '';
    
    const moldSeries = formatMoldSeriesDisplay(series, moldOld, moldNew, false);
    const moldSeriesHtml = formatMoldSeriesDisplay(series, moldOld, moldNew, true);

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

    const averageShotLife = cycles.length > 0 ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : '';
    const minShotLife = cycles.length > 0 ? Math.min(...cycles) : '';
    const maxShotLife = cycles.length > 0 ? Math.max(...cycles) : '';
    const currentShotCount = replacementCount > 0 ? sortedShoots.filter(s => s.Date >= sortedReps[sortedReps.length - 1].ReplaceDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0) : (totalLifetimeShots > 0 ? totalLifetimeShots : '');

    rowsData.push({
      no: 0,
      part,
      moldSeries,
      moldSeriesHtml,
      replacementCount: replacementCount > 0 ? replacementCount : '',
      totalPartsReplacedPcs: totalPartsReplacedPcs > 0 ? totalPartsReplacedPcs : '',
      averageShotLife,
      minShotLife,
      maxShotLife,
      currentShotCount,
      cycles
    });
  });

  // Always prioritize sorting descending by replacement count (Số lần thay từ cao đến thấp)
  rowsData.sort((a, b) => {
    const repA = Number(a.replacementCount) || 0;
    const repB = Number(b.replacementCount) || 0;
    if (repB !== repA) return repB - repA;
    const pcsA = Number(a.totalPartsReplacedPcs) || 0;
    const pcsB = Number(b.totalPartsReplacedPcs) || 0;
    if (pcsB !== pcsA) return pcsB - pcsA;
    return a.part.localeCompare(b.part, undefined, { numeric: true, sensitivity: 'base' });
  });

  // Reassign sequential 1-based row numbers
  rowsData.forEach((r, idx) => { r.no = idx + 1; });

  // Render Table Header with dynamic cycle headers (Ultra-compact titles)
  let headHtml = `<tr>
    <th style="width:45px;text-align:center;">#</th>
    <th style="min-width:85px;">Part Name</th>
    <th style="min-width:160px;">Mold + Series</th>
    <th style="text-align:center;" title="Tổng lượt thay linh kiện">Lượt Thay</th>
    <th style="text-align:center;" title="Tổng linh kiện thay thế (Pcs)">Tổng Pcs</th>
    <th style="text-align:right;" title="Tuổi thọ shot trung bình">TB Shot</th>
    <th style="text-align:right;" title="Tuổi thọ shot nhỏ nhất">Min Shot</th>
    <th style="text-align:right;" title="Tuổi thọ shot lớn nhất">Max Shot</th>
    <th style="text-align:right;" title="Số shot đang chạy hiện tại">Shot HT</th>`;
  for (let c = 1; c <= maxCyclesFound; c++) {
    headHtml += `<th style="text-align:right;" title="Chu kỳ ${c}">Cycle ${c}</th>`;
  }
  headHtml += `</tr>`;
  if ($("reportHead")) $("reportHead").innerHTML = headHtml;

  const hasFilter = ($("globalSearch") && $("globalSearch").value.trim()) || ($("part") && $("part").value.trim()) || ($("mold") && $("mold").value.trim()) || ($("series") && $("series").value.trim());
  const limit = hasFilter ? rowsData.length : _reportRenderLimit;
  const visibleRows = rowsData.slice(0, limit);

  if (visibleRows.length === 0) {
    if ($("reportRows")) $("reportRows").innerHTML = `<tr><td colspan="${9 + maxCyclesFound}" style="text-align:center; padding:24px; color:var(--muted);">Không tìm thấy linh kiện nào phù hợp.</td></tr>`;
    updateGlobalPaginationDock('report', 0, 0, null, null);
    return;
  }

  let bodyHtml = "";
  visibleRows.forEach(r => {
    bodyHtml += `<tr>
      <td style="text-align:center;color:var(--ink-muted);font-weight:600;">${r.no}</td>
      <td style="font-weight:800;color:var(--ink-dark);"><span style="font-family:monospace;background:#f8fafc;padding:3px 7px;border-radius:4px;border:1px solid #e2e8f0;color:#0f172a;">${esc(r.part)}</span></td>
      <td style="font-weight:600;color:#475569;"><span style="font-family:monospace;background:#f1f5f9;padding:2px 6px;border-radius:4px;">${r.moldSeriesHtml || esc(r.moldSeries)}</span></td>
      <td style="text-align:center;font-weight:700;color:#2563eb;">${r.replacementCount !== '' ? r.replacementCount : '-'}</td>
      <td style="text-align:center;font-weight:700;color:#7c3aed;">${r.totalPartsReplacedPcs !== '' ? r.totalPartsReplacedPcs : '-'}</td>
      <td style="text-align:right;font-weight:700;color:#059669;">${r.averageShotLife !== '' ? Number(r.averageShotLife).toLocaleString() : '-'}</td>
      <td style="text-align:right;color:var(--ink-muted);">${r.minShotLife !== '' ? Number(r.minShotLife).toLocaleString() : '-'}</td>
      <td style="text-align:right;color:var(--ink-muted);">${r.maxShotLife !== '' ? Number(r.maxShotLife).toLocaleString() : '-'}</td>
      <td style="text-align:right;font-weight:800;color:#d97706;">${r.currentShotCount !== '' ? Number(r.currentShotCount).toLocaleString() : '-'}</td>`;
    for (let c = 1; c <= maxCyclesFound; c++) {
      const cVal = (r.cycles && r.cycles[c - 1] !== undefined) ? r.cycles[c - 1] : '';
      bodyHtml += `<td style="text-align:right;font-family:monospace;">${cVal !== '' ? Number(cVal).toLocaleString() : '-'}</td>`;
    }
    bodyHtml += `</tr>`;
  });

  if ($("reportRows")) $("reportRows").innerHTML = bodyHtml;

  updateGlobalPaginationDock('report', limit, rowsData.length,
    () => { _reportRenderLimit += 40; renderComponentLifeReport(); },
    () => { _reportRenderLimit = rowsData.length; renderComponentLifeReport(); }
  );
}

// ===== RENDER CHARTS & ANALYTICS TAB =====
let _chartSortCol = 'replacementCount'; // default sort column
let _chartSortAsc = false; // default: high to low (descending)

function toggleChartSort(col) {
  if (_chartSortCol === col) {
    _chartSortAsc = !_chartSortAsc;
  } else {
    _chartSortCol = col;
    _chartSortAsc = false; // Always start high to low (top to low)
  }
  renderChartsTab();
}

function getSortIndicator(col) {
  if (_chartSortCol === col) {
    return _chartSortAsc
      ? `<span class="sort-tri active asc" title="Sắp xếp: Thấp đến Cao (Bấm để đổi)">▲</span>`
      : `<span class="sort-tri active desc" title="Sắp xếp: Cao đến Thấp (Bấm để đổi)">▼</span>`;
  }
  return `<span class="sort-tri inactive" title="Bấm để lọc từ Cao đến Thấp">▽</span>`;
}

// --- RENDER CHARTS TAB ---
function renderChartsTab() {
  const chartTab = $("chartTab");
  if (!chartTab || chartTab.classList.contains("hidden")) return;

  const ymFilter = selectedMonth();
  const yFilter = selectedYear();
  const dFilter = selectedDay();

  // Index Shoots and Replacements with date filtering
  const shootsByMold = new Map();
  // A. Full Shoot Index (Unfiltered by date to accurately compute full cycle shots)
  (db.shoot || []).forEach(s => {
    if (!s.Date || !s.Output || Number(s.Output) <= 0) return;
    const d = String(s.DieSet || '').toLowerCase().trim();
    const p = String(s.Part || '').toLowerCase().trim();
    if (d) { if (!shootsByMold.has(d)) shootsByMold.set(d, []); shootsByMold.get(d).push(s); }
    if (p && p !== d) { if (!shootsByMold.has(p)) shootsByMold.set(p, []); shootsByMold.get(p).push(s); }
  });

  // B. Filtered Replacements for the selected scope
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

  const allParts = getPartsToRender();
  const rowsData = [];

  allParts.forEach(item => {
    const part = item.part;
    const series = item.series || '-';
    const moldNew = item.moldNew || item.moldOld || item.part;
    const moldOld = item.moldOld || '';
    const moldSeries = formatMoldSeriesDisplay(series, moldOld, moldNew, false);

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

    const cycles = [];
    if (sortedHistReps.length > 1) {
      for (let i = 0; i < sortedHistReps.length - 1; i++) {
        const cN = sortedShoots.filter(s => s.Date >= sortedHistReps[i].ReplaceDate && s.Date < sortedHistReps[i + 1].ReplaceDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0);
        if (cN > 0) cycles.push(cN);
      }
    }

    const averageShotLife = cycles.length > 0 ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : '';
    const minShotLife = cycles.length > 0 ? Math.min(...cycles) : '';
    const maxShotLife = cycles.length > 0 ? Math.max(...cycles) : '';
    const currentShotCount = sortedHistReps.length > 0 ? sortedShoots.filter(s => s.Date >= sortedHistReps[sortedHistReps.length - 1].ReplaceDate).reduce((sum, s) => sum + (Number(s.Output) || 0), 0) : (totalLifetimeShots > 0 ? totalLifetimeShots : '');

    const moldName = (moldNew || moldOld || series || '').trim();

    rowsData.push({
      part,
      series,
      moldName,
      moldSeries,
      replacementCount,
      totalPartsReplacedPcs,
      averageShotLife,
      minShotLife,
      maxShotLife,
      currentShotCount,
      cycles
    });
  });

  // Dynamic Sorting by user chosen column
  rowsData.sort((a, b) => {
    let valA, valB;
    if (_chartSortCol === 'wearRate') {
      const avgA = Number(a.averageShotLife) || 0, curA = Number(a.currentShotCount) || 0;
      const avgB = Number(b.averageShotLife) || 0, curB = Number(b.currentShotCount) || 0;
      valA = avgA > 0 ? (curA / avgA) : 0;
      valB = avgB > 0 ? (curB / avgB) : 0;
    } else {
      valA = a[_chartSortCol];
      valB = b[_chartSortCol];
    }

    if (_chartSortCol === 'part' || _chartSortCol === 'moldName' || _chartSortCol === 'series') {
      const cmp = String(valA || '').localeCompare(String(valB || ''), undefined, { numeric: true, sensitivity: 'base' });
      return _chartSortAsc ? cmp : -cmp;
    } else {
      const numA = Number(valA) || 0;
      const numB = Number(valB) || 0;
      if (numB !== numA) {
        return _chartSortAsc ? numA - numB : numB - numA;
      }
      return a.part.localeCompare(b.part, undefined, { numeric: true, sensitivity: 'base' });
    }
  });

  // Pick top 10 items based on active sort
  let top10 = [];
  if (_chartSortCol === 'replacementCount' || _chartSortCol === 'totalPartsReplacedPcs') {
    const active = rowsData.filter(r => (Number(r[_chartSortCol]) || 0) > 0);
    top10 = (active.length > 0 ? active : rowsData).slice(0, 10);
  } else {
    top10 = rowsData.slice(0, 10);
  }

  // Render Main Focused Chart: Top 10 Column (Lượt thay) & Line (Pcs thay)
  renderChartTopReplaced(top10);
  renderTop10DetailTable(top10);
}

// --- MAIN COMBO CHART: TOP 10 CỘT (LƯỢT THAY) & DÂY (SỐ LƯỢNG PCS) ---
function renderChartTopReplaced(topList) {
  const container = $("chartTopReplaced");
  if (!container) return;
  if (!topList || topList.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--ink-muted);font-size:13.5px;padding:36px 0;">Không có dữ liệu thay thế trong kỳ lọc được chọn.</div>`;
    return;
  }

  const items = topList.slice(0, 10);
  const maxRep = Math.max(...items.map(r => Number(r.replacementCount) || 1), 4);
  const maxPcs = Math.max(...items.map(r => Number(r.totalPartsReplacedPcs) || 1), 5);

  const W = 860, H = 220, padL = 46, padR = 46, padT = 34, padB = 38;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const stepX = plotW / items.length;
  const colW = Math.min(30, Math.max(16, stepX * 0.40));

  let colsSvg = "";
  let dotsSvg = "";
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

    colsSvg += `
      <!-- Column: Số lượt thay -->
      <rect x="${xCol.toFixed(1)}" y="${yCol.toFixed(1)}" width="${colW}" height="${hCol.toFixed(1)}" rx="3.5" fill="#3b82f6" fill-opacity="0.9">
        <title>${esc(r.part)} (${esc(r.moldName)}): ${rep} lượt thay ra, ${pcs} pcs</title>
      </rect>
      <!-- X-Axis Labels -->
      <text x="${cx.toFixed(1)}" y="${(H - 18)}" text-anchor="middle" font-size="11.5" font-weight="800" font-family="monospace" fill="#0f172a">${esc(r.part)}</text>
      <text x="${cx.toFixed(1)}" y="${(H - 5)}" text-anchor="middle" font-size="9.5" font-weight="600" fill="#64748b">${esc(r.moldName)}</text>
    `;
  });

  let lineD = "";
  linePoints.forEach((pt, i) => {
    lineD += (i === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`);
    const badgeW = String(pt.pcs).length > 2 ? 26 : 20;
    const badgeH = 14;

    dotsSvg += `
      <!-- Line point dot -->
      <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4" fill="#7c3aed" stroke="#ffffff" stroke-width="1.8">
        <title>Tổng số lượng thay: ${pt.pcs} pcs</title>
      </circle>
      <!-- Opaque white badge pill preventing collision -->
      <rect x="${(pt.x - badgeW / 2).toFixed(1)}" y="${(pt.y - 17).toFixed(1)}" width="${badgeW}" height="${badgeH}" rx="3" fill="#ffffff" stroke="#c4b5fd" stroke-width="1"/>
      <text x="${pt.x.toFixed(1)}" y="${(pt.y - 6.5).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="800" fill="#7c3aed">${pt.pcs}</text>
    `;
  });

  let gridSvg = "";
  for (let step = 0; step <= 4; step++) {
    const yG = padT + (plotH / 4) * step;
    const valL = Math.round(maxRep - (maxRep / 4) * step);
    const valR = Math.round(maxPcs - (maxPcs / 4) * step);
    gridSvg += `
      <line x1="${padL}" y1="${yG.toFixed(1)}" x2="${W - padR}" y2="${yG.toFixed(1)}" stroke="#f1f5f9" stroke-width="1" stroke-dasharray="3,3"/>
      <text x="${padL - 8}" y="${(yG + 3.5).toFixed(1)}" text-anchor="end" font-size="10.5" font-weight="700" fill="#2563eb">${valL}</text>
      <text x="${W - padR + 8}" y="${(yG + 3.5).toFixed(1)}" text-anchor="start" font-size="10.5" font-weight="700" fill="#7c3aed">${valR}</text>
    `;
  }

  const svgHtml = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-height:220px;height:auto;display:block;overflow:visible;">
      <!-- Clean Top-Right Legend -->
      <g transform="translate(${W - padR - 210}, 10)">
        <rect x="0" y="0" width="10" height="9" rx="2" fill="#3b82f6"/>
        <text x="14" y="8" font-size="10.5" font-weight="700" fill="#475569">Lượt thay</text>
        <line x1="82" y1="4.5" x2="102" y2="4.5" stroke="#7c3aed" stroke-width="2"/>
        <circle cx="92" cy="4.5" r="3" fill="#7c3aed" stroke="#ffffff" stroke-width="1"/>
        <text x="110" y="8" font-size="10.5" font-weight="700" fill="#7c3aed">Số lượng (Pcs)</text>
      </g>

      ${gridSvg}
      ${colsSvg}
      <!-- Connecting Line -->
      <path d="${lineD}" fill="none" stroke="#7c3aed" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dotsSvg}
    </svg>
  `;

  container.innerHTML = svgHtml;
}

// --- RENDER TOP 10 DETAIL TABLE ---
function renderTop10DetailTable(topList) {
  const thead = $("top10TableHead");
  if (thead) {
    thead.innerHTML = `
      <tr>
        <th style="width:50px; text-align:center;">#</th>
        <th class="sortable-th" onclick="toggleChartSort('part')" style="min-width:110px; text-align:left;">
          PART NAME ${getSortIndicator('part')}
        </th>
        <th class="sortable-th" onclick="toggleChartSort('moldName')" style="min-width:140px; text-align:left;">
          TÊN KHUÔN ${getSortIndicator('moldName')}
        </th>
        <th class="sortable-th" onclick="toggleChartSort('replacementCount')" style="text-align:center; color:#4f46e5;" title="Số lượt thay ra">
          LƯỢT THAY ${getSortIndicator('replacementCount')}
        </th>
        <th class="sortable-th" onclick="toggleChartSort('totalPartsReplacedPcs')" style="text-align:center; color:#dc2626;" title="Tổng số linh kiện thay thế">
          SỐ LƯỢNG (PCS) ${getSortIndicator('totalPartsReplacedPcs')}
        </th>
        <th class="sortable-th" onclick="toggleChartSort('averageShotLife')" style="text-align:center;" title="Tuổi thọ shot trung bình các chu kỳ">
          TB SHOT ${getSortIndicator('averageShotLife')}
        </th>
        <th class="sortable-th" onclick="toggleChartSort('currentShotCount')" style="text-align:center;" title="Số shot đang chạy hiện tại">
          SHOT HT ${getSortIndicator('currentShotCount')}
        </th>
        <th class="sortable-th" onclick="toggleChartSort('wearRate')" style="text-align:center;" title="Mức độ hao mòn hiện tại">
          ĐỘ MÒN (%) ${getSortIndicator('wearRate')}
        </th>
      </tr>
    `;
  }

  const tbody = $("top10TableRows");
  if (!tbody) return;
  if (!topList || topList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--ink-muted);padding:24px;">Không có dữ liệu thay thế trong kỳ lọc.</td></tr>`;
    return;
  }

  let html = "";
  topList.forEach((r, idx) => {
    const rep = Number(r.replacementCount) || 0;
    const pcs = Number(r.totalPartsReplacedPcs) || 0;
    const avg = Number(r.averageShotLife) || 0;
    const cur = Number(r.currentShotCount) || 0;
    const wearPct = avg > 0 && cur > 0 ? Math.round((cur / avg) * 100) : 0;

    const wearBadgeBg = wearPct >= 95 ? '#fee2e2' : (wearPct >= 80 ? '#fef3c7' : '#d1fae5');
    const wearBadgeColor = wearPct >= 95 ? '#b91c1c' : (wearPct >= 80 ? '#b45309' : '#047857');
    const wearStatusText = wearPct >= 95 ? '🔴 Cần thay' : (wearPct >= 80 ? '🟡 Cận hạn' : '🟢 An toàn');

    html += `
      <tr>
        <td style="text-align:center;font-weight:800;color:var(--ink-muted);">#${idx + 1}</td>
        <td style="font-weight:800;font-family:monospace;color:var(--ink-dark);">${esc(r.part)}</td>
        <td style="color:#475569;font-weight:700;">${esc(r.moldName)}</td>
        <td style="text-align:center;font-weight:800;color:#4f46e5;font-size:13.5px;">${rep} lượt</td>
        <td style="text-align:center;font-weight:800;color:#dc2626;font-size:13.5px;">${pcs} pcs</td>
        <td style="text-align:center;font-weight:700;color:#059669;">${avg > 0 ? avg.toLocaleString() : '-'}</td>
        <td style="text-align:center;font-weight:700;color:#0284c7;">${cur > 0 ? cur.toLocaleString() : '-'}</td>
        <td style="text-align:center;">
          ${wearPct > 0 ? `<span style="background:${wearBadgeBg};color:${wearBadgeColor};padding:3px 8px;border-radius:6px;font-weight:800;font-size:12px;" title="${wearStatusText}">${wearPct}%</span>` : `<span style="color:#94a3b8;">-</span>`}
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}



// ===== BUILD MONTH OPTIONS =====
function buildMonthOptions(preferredYm = null) {
  console.log("%c[DATE] buildMonthOptions", "color:#6b7280;");
  const select = $("monthPick"), yearSelect = $("yearPick"), daySelect = $("dayPick");
  const today = new Date(), currentYear = today.getFullYear(), startYear = 2026;
  let minYear = startYear, maxYear = Math.max(currentYear + 15, startYear + 15);
  const yearsFound = new Set([currentYear, 2026]);

  [...db.shoot, ...db.replacements.map(row => ({ Date: row.ReplaceDate }))].forEach(row => {
    if (row.Date && row.Date.length >= 4) {
      const y = parseInt(row.Date.slice(0, 4), 10);
      if (y) { yearsFound.add(y); if (y < minYear) minYear = y; if (y > maxYear) maxYear = y; }
    }
  });

  if (yearSelect) {
    const currY = yearSelect.value;
    yearSelect.innerHTML = `<option value="">Tất cả năm</option>` + [...yearsFound].sort((a, b) => b - a).map(y => `<option value="${y}">Năm ${y}</option>`).join("");
    if (currY && yearsFound.has(Number(currY))) yearSelect.value = currY;
  }
  if (daySelect) {
    const currD = daySelect.value;
    let dayHtml = `<option value="">Tất cả ngày</option>`;
    for (let d = 1; d <= 31; d++) dayHtml += `<option value="${String(d).padStart(2, "0")}">Ngày ${String(d).padStart(2, "0")}</option>`;
    daySelect.innerHTML = dayHtml;
    if (currD) daySelect.value = currD;
  }

  const months = new Set();
  for (let y = minYear; y <= maxYear; y++) for (let m = 1; m <= 12; m++) months.add(`${y}-${String(m).padStart(2, "0")}`);
  if (select) {
    select.innerHTML = `<option value="">Tất cả tháng</option>` + [...months].sort().map(ym => {
      const [year, month] = ym.split("-").map(Number);
      return `<option value="${ym}">${monthNames[month - 1]} ${year}</option>`;
    }).join("");

    if (preferredYm && months.has(preferredYm)) {
      select.value = preferredYm;
    } else {
      const repMonths = [...new Set(db.replacements.map(r => r.ReplaceDate ? r.ReplaceDate.slice(0, 7) : "").filter(Boolean))];
      const shootMonths = [...new Set(db.shoot.map(r => r.Date ? r.Date.slice(0, 7) : "").filter(Boolean))];
      const allDataMonths = [...new Set([...shootMonths, ...repMonths])].sort();
      const latestDataMonth = allDataMonths.length ? allDataMonths[allDataMonths.length - 1] : "";
      const systemYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
      if (db.shoot.some(r => r.Date && r.Date.startsWith(systemYm))) select.value = systemYm;
      else if (latestDataMonth && months.has(latestDataMonth)) select.value = latestDataMonth;
      else select.value = months.has(systemYm) ? systemYm : "2026-08";
    }
  }
  if (select && select.value && select.value.length >= 4 && yearSelect && !yearSelect.value) yearSelect.value = select.value.slice(0, 4);
}

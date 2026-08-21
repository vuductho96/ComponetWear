/* state.js — Global state management (Plan §7: UI does NOT calculate) */
'use strict';

const KEY = "componentLifeData";

let db = {
  shoot: [],
  rawShoot: [],
  replacements: [],
  deletionLogs: []
};

let result = { cycles: [], summary: [], errors: [] };
let masterData = [];
let _stockData = {};
let _stockFilter = 'all';
let _masterLookupMap = null;
let _allPartsCache = null;
let currentActiveTab = "month";
let _currentDataVersion = null;

// Render limits
let _monthRenderLimit = 30;
let _stockRenderLimit = 40;
let _wearRenderLimit = 35;
let _reportRenderLimit = 40;

// ===== UNIFIED DASHBOARD COLUMN CONFIGURATION & SCHEMA =====
const DASHBOARD_COLUMNS_SCHEMA = {
  // HISTORY / ANALYSIS (Default Visible)
  timesCount:   { id: 'timesCount',   label: 'Replace Time',         group: 'HISTORY_ANALYSIS', default: true,  align: 'center', desc: 'Số lượt thay thế linh kiện (Replace Time)' },
  used:         { id: 'used',         label: 'Qty Used',             group: 'HISTORY_ANALYSIS', default: true,  align: 'center', desc: 'Tổng số linh kiện đã thay ra (Qty Used / Pcs)' },

  // COMPONENT LIFE (Default Visible: avgShot, currentShot)
  avgShot:      { id: 'avgShot',      label: 'Avg Shot',             group: 'COMPONENT_LIFE',   default: true,  align: 'right',  desc: 'Tuổi thọ trung bình theo các chu kỳ dập' },
  currentShot:  { id: 'currentShot',  label: 'Current Shot',         group: 'COMPONENT_LIFE',   default: true,  align: 'right',  desc: 'Số Shot dập đã chạy của chu kỳ hiện tại' },
  minShot:      { id: 'minShot',      label: 'Min Shot',             group: 'COMPONENT_LIFE',   default: false, align: 'right',  desc: 'Chu kỳ dập ngắn nhất từng ghi nhận' },
  maxShot:      { id: 'maxShot',      label: 'Max Shot',             group: 'COMPONENT_LIFE',   default: false, align: 'right',  desc: 'Chu kỳ dập dài nhất từng ghi nhận' },
  minMaxShot:   { id: 'minMaxShot',   label: 'Min - Max Shot',       group: 'COMPONENT_LIFE',   default: false, align: 'center', desc: 'Khoảng dao động tuổi thọ Min đến Max' },
  wearPercent:  { id: 'wearPercent',  label: 'Tiến Độ Mòn (%)',      group: 'COMPONENT_LIFE',   default: false, align: 'center', desc: 'Tỷ lệ % Shot hiện tại so với tuổi thọ trung bình' },
  cycleCount:   { id: 'cycleCount',   label: 'Số Chu Kỳ',            group: 'COMPONENT_LIFE',   default: false, align: 'center', desc: 'Số lượng chu kỳ thay thế hoàn chỉnh' },
  cycles:       { id: 'cycles',       label: 'Cycle (Các chu kỳ shot)', group: 'COMPONENT_LIFE', default: false, align: 'right',  desc: 'Tự động hiển thị các cột Cycle 1, Cycle 2, Cycle 3... theo số chu kỳ thực tế' },
  lastRepDate:  { id: 'lastRepDate',  label: 'Last Replacement',     group: 'COMPONENT_LIFE',   default: false, align: 'center', desc: 'Ngày phát sinh lượt thay thế gần nhất' },

  // INVENTORY (Optional Add-on)
  stock:        { id: 'stock',        label: 'Tồn Kho (Stock)',      group: 'INVENTORY',        default: false, align: 'center', desc: 'Số lượng tồn kho thực tế hiện tại' },
  minStock:     { id: 'minStock',     label: 'Mức Min (Min Stock)',  group: 'INVENTORY',        default: false, align: 'center', desc: 'Mức tồn kho an toàn tối thiểu' },
  status:       { id: 'status',       label: 'Trạng Thái (Status)', group: 'INVENTORY',        default: false, align: 'center', desc: 'Cảnh báo mức tồn kho: Urgent / Need Order / No Need' },

  // TRACEABILITY (Optional Add-on)
  moldOld:      { id: 'moldOld',      label: 'Mã Khuôn Cũ',          group: 'TRACEABILITY',     default: false, align: 'left',   desc: 'Mã khuôn gốc ban đầu (Old Die Set)' },
  moldNew:      { id: 'moldNew',      label: 'Mã Khuôn Mới',         group: 'TRACEABILITY',     default: false, align: 'left',   desc: 'Mã khuôn chuẩn hóa mới (New Die Set)' }
};

const DEFAULT_DASHBOARD_COLS = Object.keys(DASHBOARD_COLUMNS_SCHEMA).reduce((acc, k) => {
  acc[k] = DASHBOARD_COLUMNS_SCHEMA[k].default;
  return acc;
}, {});

const DASHBOARD_COLS_STORAGE_KEY = 'componetwear_dashboard_visible_cols_v3';

function getDashboardVisibleCols() {
  try {
    const saved = localStorage.getItem(DASHBOARD_COLS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return Object.assign({}, DEFAULT_DASHBOARD_COLS, parsed);
    }
  } catch (e) {
    console.warn('[STATE] Error reading dashboard column visibility from localStorage:', e);
  }
  return Object.assign({}, DEFAULT_DASHBOARD_COLS);
}

function saveDashboardVisibleCols(cols) {
  try {
    localStorage.setItem(DASHBOARD_COLS_STORAGE_KEY, JSON.stringify(cols));
  } catch (e) {
    console.warn('[STATE] Error saving dashboard column visibility to localStorage:', e);
  }
}

// Global pagination dock callbacks
window.gpdMoreAction = null;
window.gpdAllAction = null;

function invalidatePartsCache() {
  _allPartsCache = null;
}

function selectedYear() {
  return $("yearPick") ? $("yearPick").value : "";
}

function selectedMonth() {
  return $("monthPick") ? $("monthPick").value : "";
}

function selectedDay() {
  return $("dayPick") ? $("dayPick").value : "";
}

function getContext() {
  return {
    part: $("part") ? $("part").value.trim() : "",
    series: $("series") ? $("series").value.trim() : "",
    dieSet: $("dieSet") ? $("dieSet").value.trim() : "",
    mold: $("mold") ? $("mold").value.trim() : ""
  };
}

function activeDieSet() {
  const ctx = getContext();
  return ctx.mold || ctx.dieSet;
}

// ===== Master Lookup =====
function buildMasterLookupMap() {
  _masterLookupMap = new Map();
  (masterData || []).forEach(item => {
    if (!item || !item.PartName) return;
    const p = String(item.PartName).toLowerCase().trim();
    const pN = normKey(p);
    const dNew = String(item.NewDieSet || '').toLowerCase().trim();
    const dOld = String(item.OldDieSet || '').toLowerCase().trim();
    const dNewN = normKey(dNew);
    const dOldN = normKey(dOld);
    const s = String(item.Series || '').toLowerCase().trim();
    const sN = normKey(s);
    if (p && dNew) _masterLookupMap.set(`${p}|${dNew}`, item);
    if (p && dOld) _masterLookupMap.set(`${p}|${dOld}`, item);
    if (pN && dNewN) _masterLookupMap.set(`${pN}|${dNewN}`, item);
    if (pN && dOldN) _masterLookupMap.set(`${pN}|${dOldN}`, item);
    if (p && s) _masterLookupMap.set(`${p}|series:${s}`, item);
    if (pN && sN) _masterLookupMap.set(`${pN}|series:${sN}`, item);
    if (p && !_masterLookupMap.has(p)) _masterLookupMap.set(p, item);
    if (pN && !_masterLookupMap.has(pN)) _masterLookupMap.set(pN, item);
    if (dNew && !_masterLookupMap.has(`||${dNew}`)) _masterLookupMap.set(`||${dNew}`, item);
    if (dOld && !_masterLookupMap.has(`||${dOld}`)) _masterLookupMap.set(`||${dOld}`, item);
    if (dNewN && !_masterLookupMap.has(`||${dNewN}`)) _masterLookupMap.set(`||${dNewN}`, item);
    if (dOldN && !_masterLookupMap.has(`||${dOldN}`)) _masterLookupMap.set(`||${dOldN}`, item);
  });
}

function findMasterItem(partName, dieSet, series = '') {
  if (!_masterLookupMap) buildMasterLookupMap();
  const p = String(partName || '').trim().toLowerCase();
  const d = String(dieSet || '').trim().toLowerCase();
  const s = String(series || '').trim().toLowerCase();
  const pN = normKey(p); const dN = normKey(d); const sN = normKey(s);
  if (p && d) {
    const direct = _masterLookupMap.get(`${p}|${d}`) || _masterLookupMap.get(`${pN}|${dN}`);
    if (direct) return direct;
  }
  if (p && s) {
    const bySeries = _masterLookupMap.get(`${p}|series:${s}`) || _masterLookupMap.get(`${pN}|series:${sN}`);
    if (bySeries) return bySeries;
  }
  if (d) {
    const byMold = _masterLookupMap.get(`||${d}`) || _masterLookupMap.get(`||${dN}`);
    if (byMold) return byMold;
  }
  if (p && !d && !s) {
    const byPart = _masterLookupMap.get(p) || _masterLookupMap.get(pN);
    if (byPart) return byPart;
  }
  return null;
}

function getSeriesForPart(partName, dieSet) {
  if (!partName && !dieSet) return "";
  const p = (partName || "").toLowerCase();
  const d = (dieSet || "").toLowerCase();
  const match = (masterData || []).find(x =>
    (x.PartName && x.PartName.toLowerCase() === p) &&
    ((x.NewDieSet && x.NewDieSet.toLowerCase() === d) || (x.OldDieSet && x.OldDieSet.toLowerCase() === d) || !dieSet)
  ) || (masterData || []).find(x => x.PartName && x.PartName.toLowerCase() === p);
  return match ? (match.Series || "") : "";
}

// ===== Stock helpers =====
function getStockItemKey(part, dieSet) {
  return `${(part || '').trim()}|${(dieSet || '').trim()}`;
}

function getStockItem(part, dieSet) {
  const p = (part || '').trim();
  const d = (dieSet || '').trim();
  const directKey = `${p}|${d}`;
  if (_stockData[directKey]) return _stockData[directKey];
  const master = findMasterItem(p, d);
  if (master) {
    if (master.OldDieSet && _stockData[`${p}|${master.OldDieSet.trim()}`]) return _stockData[`${p}|${master.OldDieSet.trim()}`];
    if (master.NewDieSet && _stockData[`${p}|${master.NewDieSet.trim()}`]) return _stockData[`${p}|${master.NewDieSet.trim()}`];
    const initStock = (master.StockLeft !== undefined && master.StockLeft !== null) ? Number(master.StockLeft) : 0;
    const initMin = (master.StandardStock !== undefined && master.StandardStock !== null) ? Number(master.StandardStock) : 1;
    const stockObj = { stock: initStock, minStock: initMin, series: master.Series || '' };
    _stockData[directKey] = stockObj;
    if (master.OldDieSet) _stockData[`${p}|${master.OldDieSet.trim()}`] = stockObj;
    if (master.NewDieSet) _stockData[`${p}|${master.NewDieSet.trim()}`] = stockObj;
    return stockObj;
  }
  _stockData[directKey] = { stock: 0, minStock: 1 };
  return _stockData[directKey];
}

// ===== Parts List Cache =====
function buildAllPartsCache() {
  const partsMap = new Map();

  const knownNewByOld = new Map();
  const knownOldByNew = new Map();
  (masterData || []).forEach(item => {
    const o = String(item.OldDieSet || "").trim();
    const n = String(item.NewDieSet || "").trim();
    if (o && n && o.toLowerCase() !== n.toLowerCase()) {
      knownNewByOld.set(o.toLowerCase(), n);
      knownOldByNew.set(n.toLowerCase(), o);
    }
  });

  // 1. Master data items
  (masterData || []).forEach(item => {
    if (isValidPartName(item.PartName)) {
      const p = String(item.PartName).trim();
      let mOld = String(item.OldDieSet || "").trim();
      let mNew = String(item.NewDieSet || "").trim();
      const s = String(item.Series || "").trim();

      if ((!mNew || mNew.toLowerCase() === mOld.toLowerCase()) && knownNewByOld.has(mOld.toLowerCase())) {
        mNew = knownNewByOld.get(mOld.toLowerCase());
      }
      if ((!mOld || mOld.toLowerCase() === mNew.toLowerCase()) && knownOldByNew.has(mNew.toLowerCase())) {
        mOld = knownOldByNew.get(mNew.toLowerCase());
      }

      const key = `${p}|${mOld}|${mNew}`;
      if (!partsMap.has(key)) {
        partsMap.set(key, {
          part: p,
          series: s,
          moldOld: mOld,
          moldNew: mNew || mOld,
          moldCombined: formatMoldDisplay(mOld, mNew)
        });
      }
    }
  });

  // 2. Shoot items (Only add if an explicit valid part name exists and is not equal to mold)
  (db.shoot || []).forEach(s => {
    const mold = String(s.DieSet || "").trim();
    const part = String(s.Part || "").trim();
    if (part && isValidPartName(part) && mold && part.toLowerCase() !== mold.toLowerCase()) {
      const master = findMasterItem(part, mold, s.Series);
      const mOld = master ? String(master.OldDieSet || mold).trim() : mold;
      const mNew = master ? String(master.NewDieSet || mold).trim() : mold;
      const seriesVal = master ? (master.Series || s.Series || "-") : (s.Series || "-");
      const key = `${part}|${mOld}|${mNew}`;
      if (!partsMap.has(key)) {
        partsMap.set(key, {
          part,
          series: seriesVal,
          moldOld: mOld,
          moldNew: mNew,
          moldCombined: formatMoldDisplay(mOld, mNew)
        });
      }
    }
  });

  // 3. Replacement items (Only add if part is valid and not equal to mold)
  (db.replacements || []).forEach(r => {
    const rawMold = String(r.DieSet || r.NewDieSet || r.OldDieSet || "").trim();
    const part = String(r.Part || "").trim();
    if (part && isValidPartName(part) && (!rawMold || part.toLowerCase() !== rawMold.toLowerCase())) {
      const master = findMasterItem(part, rawMold, r.Series);
      const mOld = master ? String(master.OldDieSet || r.OldDieSet || rawMold).trim() : String(r.OldDieSet || rawMold).trim();
      const mNew = master ? String(master.NewDieSet || r.NewDieSet || rawMold).trim() : String(r.NewDieSet || rawMold).trim();
      const seriesVal = master ? (master.Series || r.Series || "-") : (r.Series || "-");
      const key = `${part}|${mOld}|${mNew}`;
      if (!partsMap.has(key)) {
        partsMap.set(key, {
          part,
          series: seriesVal,
          moldOld: mOld,
          moldNew: mNew,
          moldCombined: formatMoldDisplay(mOld, mNew)
        });
      }
    }
  });

  _allPartsCache = Array.from(partsMap.values());
}

function getPartsToRender(forTab = "") {
  const globalQuery = $("globalSearch") ? $("globalSearch").value.trim().toLowerCase() : "";
  const activeP = $("part") ? $("part").value.trim().toLowerCase() : "";
  const activeM = $("mold") ? $("mold").value.trim().toLowerCase() : "";
  const activeS = $("series") ? $("series").value.trim().toLowerCase() : "";
  if (!_allPartsCache) buildAllPartsCache();
  let list = _allPartsCache;
  if (globalQuery) {
    const q = globalQuery;
    let matched = list.filter(x => isSmartMatch(x.part, q) || isSmartMatch(x.moldNew, q) || isSmartMatch(x.moldOld, q) || isSmartMatch(x.moldCombined, q) || isSmartMatch(x.series, q));
    matched.sort((a, b) => {
      const getRank = (item) => {
        const p = (item.part || "").toLowerCase();
        if (p === q) return 1; if (p.startsWith(q)) return 2;
        const pTokens = p.split(/[\s\-_/.]+/);
        if (pTokens.some(tok => tok === q || tok.startsWith(q))) return 3;
        const mComb = (item.moldCombined || "").toLowerCase();
        if (mComb === q) return 4; if (mComb.startsWith(q) || isSmartMatch(mComb, q)) return 5;
        const mNew = (item.moldNew || "").toLowerCase();
        if (mNew === q) return 6; if (mNew.startsWith(q) || isSmartMatch(mNew, q)) return 7;
        const mOld = (item.moldOld || "").toLowerCase();
        if (mOld === q) return 8; if (mOld.startsWith(q) || isSmartMatch(mOld, q)) return 9;
        const s = (item.series || "").toLowerCase();
        if (s === q || s.startsWith(q) || isSmartMatch(s, q)) return 10;
        return 99;
      };
      const rA = getRank(a), rB = getRank(b);
      if (rA !== rB) return rA - rB;
      return a.part.localeCompare(b.part, undefined, { numeric: true, sensitivity: 'base' });
    });
    return matched;
  }
  if (activeP) list = list.filter(x => isSmartMatch(x.part, activeP));
  if (activeM) list = list.filter(x => isSmartMatch(x.moldCombined, activeM) || isSmartMatch(x.moldNew, activeM) || isSmartMatch(x.moldOld, activeM));
  if (activeS) list = list.filter(x => isSmartMatch(x.series, activeS));
  return list.sort((a, b) => a.part.localeCompare(b.part, undefined, { numeric: true, sensitivity: 'base' }));
}

/* api.js — API calls, data save/sync, import/export data (Plan §7: UI does not calculate) */
'use strict';

function save() {
  try {
    const rawList = Array.isArray(db.rawShoot) ? db.rawShoot : (db.shoot || []);
    const toSave = { shoot: rawList, rawShoot: rawList, replacements: db.replacements || [], deletionLogs: db.deletionLogs || [] };
    localStorage.setItem(KEY, JSON.stringify(toSave));
    localStorage.setItem("componentLifeDeletionLogs", JSON.stringify(db.deletionLogs || []));
    console.log(`%c[SAVE] localStorage saved: shoot=${rawList.length}, replacements=${(db.replacements||[]).length}, deletions=${(db.deletionLogs||[]).length}`, "color:#059669;");
  } catch (e) { console.error("[SAVE] ERROR:", e); }
  syncToJsonFiles();
}

async function syncToJsonFiles() {
  try {
    if (db.replacements !== undefined) {
      fetch("/api/import/replacements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: db.replacements || [] }) }).catch(() => {});
    }
    if (Array.isArray(db.rawShoot)) {
      fetch("/api/import/shoot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: db.rawShoot }) }).catch(() => {});
    }
    if (Array.isArray(masterData) && masterData.length > 0) {
      fetch("/api/import/master", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: masterData }) }).catch(() => {});
    }
    if (typeof _stockData === 'object' && _stockData && Object.keys(_stockData).length > 0) {
      fetch("/api/import/stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stockData: _stockData }) }).catch(() => {});
    }
  } catch (e) {}
}

function saveStockData() {
  try { localStorage.setItem("componentLifeStockData", JSON.stringify(_stockData)); } catch (e) {}
  syncStockToBackend();
}

async function syncStockToBackend() {
  try { fetch("/api/import/stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stockData: _stockData }) }).catch(() => {}); } catch (e) {}
}

async function updateBackend() {
  const btn = $("updateBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = "⏳ Đang cập nhật..."; }
  try {
    const baseShoot = Array.isArray(db.rawShoot) ? db.rawShoot : (db.shoot || []);
    const res = await fetch("/api/update", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ rawShoot: baseShoot, replacements: db.replacements })
    });
    if (!res.ok) throw Error("Server error: " + res.statusText);
    const data = await res.json();
    if (data.shoot && Array.isArray(data.shoot)) db.shoot = data.shoot.sort((a, b) => a.Date.localeCompare(b.Date) || a.DieSet.localeCompare(b.DieSet));
    if (data.replacements && Array.isArray(data.replacements)) db.replacements = data.replacements.sort((a, b) => a.ReplaceDate.localeCompare(b.ReplaceDate));
    save(); rebuild(false); renderMonth(); renderMetrics(); renderStockTable();
    msg(`✅ Backend đã tính toán và cập nhật thành công! (${(data.cycles || []).length} cycle hoàn chỉnh)`);
  } catch (err) {
    msg("Lỗi kết nối Backend: " + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "🔄 Update (Test Backend)"; }
  }
}

async function loadMasterData() {
  console.log("%c[DATA] === STAGE: loadMasterData ===", "color:#4f46e5; font-weight:bold;");
  const cacheBust = "?t=" + Date.now();
  try {
    const res = await fetch("ComponentMaster.json" + cacheBust, { cache: "no-store" });
    console.log(`%c[DATA] ComponentMaster.json response: ${res.status} ${res.statusText}`, "color:#6b7280;");
    if (res.ok) {
      const remoteList = await res.json();
      if (Array.isArray(remoteList) && remoteList.length > 0) {
        masterData = [];
        _masterLookupMap = null;
        updateMasterData(remoteList);
        console.log(`%c[DATA] Master loaded: ${remoteList.length} items`, "color:#059669;");
        return;
      }
    }
  } catch (e) { console.warn("[DATA] Could not fetch ComponentMaster.json:", e); }
  populatePartList(); renderStockTable();
}

async function autoLoadShootMonth() {
  console.log("%c[DATA] === STAGE: autoLoadShootMonth ===", "color:#4f46e5; font-weight:bold;");
  const cacheBust = "?t=" + Date.now();
  try {
    const [resShoot, resRep, resStock] = await Promise.all([
      fetch("data/shoot-data.json" + cacheBust, { cache: "no-store" }).catch(() => null),
      fetch("data/replacement-log.json" + cacheBust, { cache: "no-store" }).catch(() => null),
      fetch("data/stock-data.json" + cacheBust, { cache: "no-store" }).catch(() => null)
    ]);
    if (resShoot && resShoot.ok) {
      const list = await resShoot.json();
      if (Array.isArray(list)) {
        db.rawShoot = list; db.shoot = list.sort((a, b) => (a.Date || '').localeCompare(b.Date || '') || (a.DieSet || '').localeCompare(b.DieSet || ''));
        console.log(`%c[DATA] Shoot loaded: ${list.length} records`, "color:#059669;");
        if (list.length > 0) console.log(`%c[DATA]   Sample: Date=${list[0].Date} Part=${list[0].Part} DieSet=${list[0].DieSet} Output=${list[0].Output}`, "color:#6b7280;");
      }
    } else { console.warn("[DATA] Shoot data not available"); }
    if (resRep && resRep.ok) {
      const repList = await resRep.json();
      if (Array.isArray(repList)) {
        db.replacements = repList;
        console.log(`%c[DATA] Replacements loaded: ${repList.length} records`, "color:#059669;");
        if (repList.length > 0) console.log(`%c[DATA]   Sample: Part=${repList[0].Part} DieSet=${repList[0].DieSet} Date=${repList[0].ReplaceDate} Label=${repList[0].Label}`, "color:#6b7280;");
      }
    } else { console.warn("[DATA] Replacement data not available"); }
    if (resStock && resStock.ok) {
      const stockJson = await resStock.json();
      if (stockJson && typeof stockJson === 'object' && Object.keys(stockJson).length > 0) {
        _stockData = Object.assign({}, stockJson);
        try { localStorage.setItem("componentLifeStockData", JSON.stringify(_stockData)); } catch (e) {}
        console.log(`%c[DATA] Stock loaded: ${Object.keys(stockJson).length} items`, "color:#059669;");
      }
    } else { console.warn("[DATA] Stock data not available"); }
  } catch (e) { console.error("[DATA] Error loading parallel data:", e); }
  console.log(`%c[DATA] --- Post-load state: shoot=${(db.shoot||[]).length}, reps=${(db.replacements||[]).length}, master=${(masterData||[]).length}, stock=${Object.keys(_stockData||{}).length} ---`, "color:#0284c7; font-weight:bold;");
  invalidatePartsCache(); buildMonthOptions(); rebuild(false); renderActiveTabOnly();
}

async function loadAllDataFromSource() {
  console.log("%c[BOOT] ========== loadAllDataFromSource START ==========", "color:#7c3aed; font-weight:bold; font-size:14px;");
  const t0 = performance.now();
  invalidatePartsCache();
  await loadMasterData();
  await autoLoadShootMonth();
  invalidatePartsCache();
  rebuild(false);
  renderActiveTabOnly();
  const elapsed = Math.round(performance.now() - t0);
  console.log(`%c[BOOT] ========== loadAllDataFromSource DONE (${elapsed}ms) ==========`, "color:#7c3aed; font-weight:bold; font-size:14px;");
  console.log(`%c[BOOT] Final state: shoot=${(db.shoot||[]).length}, reps=${(db.replacements||[]).length}, master=${(masterData||[]).length}, stock=${Object.keys(_stockData||{}).length}`, "color:#059669;");
}

async function checkDataVersionLoop() {
  try {
    const res = await fetch("/api/version?t=" + Date.now(), { cache: "no-store" }).then(r => r.json());
    if (res && res.version !== undefined) {
      if (_currentDataVersion === null) {
        _currentDataVersion = res.version;
      } else if (res.version > _currentDataVersion) {
        _currentDataVersion = res.version;
        msg("⚡ Đã tự động cập nhật dữ liệu mới nhất vừa lưu từ Excel!", false, 3500);
        await loadAllDataFromSource();
      }
    }
  } catch (e) {}
}

// ===== Import functions =====
function parseTable(text, type) {
  const rawLines = text.trim().split(/\r?\n/).filter(Boolean);
  if (rawLines.length < 2) throw Error("Cần header và ít nhất một dòng dữ liệu.");
  const delimiter = rawLines[0].includes("\t") ? "\t" : (rawLines[0].includes(",") ? "," : "\t");
  const rows = rawLines.map(line => line.split(delimiter));
  const headers = rows.shift().map(norm);
  const find = (...names) => headers.findIndex(header => names.includes(header));

  if (type === "shoot") {
    const dateIndex = find("date", "ngay", "month");
    const dieIndex = find("dieset", "moldname", "khuon", "mold", "moldnew", "olddieset");
    const partIndex = find("part", "partname", "tenlinhkien", "ten");
    const outputIndex = find("output", "shootnumber", "shoot", "pcs", "outputpcs", "shotcount");
    if (dateIndex < 0 || outputIndex < 0) throw Error("Header Shoot chưa đúng. Cần cột Date và Output/ShootNumber.");
    const shootMap = new Map();
    rows.forEach(row => {
      const pName = partIndex >= 0 ? String(row[partIndex] || "").trim() : "";
      let die = dieIndex >= 0 ? String(row[dieIndex] || "").trim() : "";
      if (!die && pName) {
        const m = masterData.find(x => x.PartName && x.PartName.toLowerCase() === pName.toLowerCase());
        if (m) die = m.NewDieSet || m.OldDieSet;
      }
      const isoDate = toIso(row[dateIndex]);
      const outVal = Number(String(row[outputIndex] || "0").replace(/,/g, ""));
      if (!isoDate || (!die && !pName) || isNaN(outVal) || outVal <= 0) return;
      const key = isoDate + "|" + pName + "|" + (die || pName);
      const existing = shootMap.get(key) || { Date: isoDate, Part: pName, DieSet: die || pName || "Unknown", Output: 0 };
      existing.Output += outVal;
      shootMap.set(key, existing);
    });
    return Array.from(shootMap.values());
  }

  const partIndex = find("part", "partname", "ten");
  const seriesIndex = find("series", "masolinhkien");
  const dieIndex = find("dieset", "moldname", "khuon", "mold");
  const dateIndex = find("replacedate", "ngaythay", "date");
  const labelIndex = find("code", "lot", "serial", "replacement", "linhkien", "component");
  if ([partIndex, seriesIndex, dieIndex, dateIndex].some(i => i < 0)) throw Error("Header lịch thay chưa đúng.");
  return rows.map(row => ({
    Part: String(row[partIndex] || "").trim(),
    Series: String(row[seriesIndex] || "").trim(),
    DieSet: String(row[dieIndex] || "").trim(),
    ReplaceDate: toIso(row[dateIndex]),
    Label: labelIndex >= 0 ? String(row[labelIndex] || "").trim() : ""
  })).filter(row => row.Part && row.DieSet);
}

function parseMasterCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw Error("Cần header và ít nhất một dòng dữ liệu.");
  const headers = lines.shift().split(/[,\t]/).map(norm);
  const find = (...names) => headers.findIndex(h => names.includes(h));
  const partIndex = find("partname", "part", "tenlinhkien", "ten");
  const seriesIndex = find("series", "masolinhkien");
  const oldIndex = find("olddieset", "dieset", "moldold", "khuoncu");
  const newIndex = find("newdieset", "mold", "moldnew", "khuonmoi");
  const stdIndex = find("standardstock", "standard", "tonkhotoithieu", "minstock", "dinhmuc");
  const leftIndex = find("stockleft", "ton", "tonkho", "tonhientai", "stock");
  if (partIndex < 0) throw Error("Thiếu cột PartName trong file CSV/TSV.");
  return lines.map(line => {
    const parts = line.split(/[,\t]/);
    return {
      PartName: String(parts[partIndex] || "").trim(),
      Series: seriesIndex >= 0 ? String(parts[seriesIndex] || "").trim() : "",
      OldDieSet: oldIndex >= 0 ? String(parts[oldIndex] || "").trim() : "",
      NewDieSet: newIndex >= 0 ? String(parts[newIndex] || "").trim() : "",
      StandardStock: stdIndex >= 0 ? (parseInt(parts[stdIndex], 10) || 0) : undefined,
      StockLeft: leftIndex >= 0 ? (parseInt(parts[leftIndex], 10) || 0) : undefined
    };
  }).filter(x => x.PartName);
}

function updateMasterData(newList) {
  if (!Array.isArray(newList) || !newList.length) return;
  const getMasterKey = (x) => `${(x.PartName || '').trim()}|${(x.Series || '').trim()}|${(x.OldDieSet || x.NewDieSet || '').trim()}`;
  const map = new Map();
  (masterData || []).forEach(x => { if (x.PartName) map.set(getMasterKey(x), x); });
  newList.forEach(item => {
    if (!item.PartName) return;
    map.set(getMasterKey(item), item);
    const p = item.PartName.trim();
    const std = (item.StandardStock !== undefined && item.StandardStock !== null) ? Number(item.StandardStock) : 1;
    const left = (item.StockLeft !== undefined && item.StockLeft !== null) ? Number(item.StockLeft) : 0;
    const ser = item.Series || '';
    const stObj = { stock: left, minStock: std, series: ser };
    if (item.OldDieSet) { const kOld = `${p}|${item.OldDieSet.trim()}`; if (!_stockData[kOld]) _stockData[kOld] = stObj; }
    if (item.NewDieSet) { const kNew = `${p}|${item.NewDieSet.trim()}`; if (!_stockData[kNew]) _stockData[kNew] = stObj; }
  });
  masterData = [...map.values()];
  try { localStorage.setItem("componentMasterData", JSON.stringify(masterData)); } catch (e) {}
  populatePartList(); renderStockTable(); renderMonth(); renderMetrics();
}

function populatePartList() {
  invalidatePartsCache();
  const partDatalist = $("partList");
  const moldDatalist = $("moldList");
  const searchDatalist = $("searchList");
  const parts = new Set(), molds = new Set(), allSearchItems = new Set();
  (masterData || []).forEach(item => {
    if (item.PartName) { parts.add(item.PartName); allSearchItems.add(item.PartName); }
    if (item.Series) allSearchItems.add(item.Series);
    if (item.NewDieSet) { molds.add(item.NewDieSet); allSearchItems.add(item.NewDieSet); }
    if (item.OldDieSet) { molds.add(item.OldDieSet); allSearchItems.add(item.OldDieSet); }
  });
  (db.replacements || []).forEach(item => {
    if (item.Part) { parts.add(item.Part); allSearchItems.add(item.Part); }
    if (item.Series) allSearchItems.add(item.Series);
    if (item.DieSet) { molds.add(item.DieSet); allSearchItems.add(item.DieSet); }
  });
  (db.shoot || []).forEach(item => {
    if (item.Part) { parts.add(item.Part); allSearchItems.add(item.Part); }
    if (item.DieSet) { molds.add(item.DieSet); allSearchItems.add(item.DieSet); }
  });
  if (partDatalist) partDatalist.innerHTML = [...parts].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).map(p => `<option value="${esc(p)}">`).join("");
  if (moldDatalist) moldDatalist.innerHTML = [...molds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).map(m => `<option value="${esc(m)}">`).join("");
  if (searchDatalist) searchDatalist.innerHTML = [...allSearchItems].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).slice(0, 150).map(s => `<option value="${esc(s)}">`).join("");
}

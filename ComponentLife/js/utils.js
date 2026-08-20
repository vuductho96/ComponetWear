/* utils.js — Utility functions */
'use strict';

const $ = (id) => document.getElementById(id);

const monthNames = [
  "Tháng 1","Tháng 2","Tháng 3","Tháng 4","Tháng 5","Tháng 6",
  "Tháng 7","Tháng 8","Tháng 9","Tháng 10","Tháng 11","Tháng 12"
];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function norm(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ _.-]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function monthKey(date) {
  return date ? String(date).slice(0, 7) : "";
}

function formatMoldDisplay(moldOld, moldNew) {
  const o = String(moldOld || "").trim();
  const n = String(moldNew || "").trim();
  if (o && n && o.toLowerCase() !== n.toLowerCase()) {
    return `${o}/${n}`;
  }
  return n || o || "-";
}

function formatMoldSeriesDisplay(series, moldOld, moldNew, isHtml = false) {
  const s = String(series || "-").trim();
  const o = String(moldOld || "").trim();
  const n = String(moldNew || "").trim();

  // 1. If both Old and New exist and are different (e.g. FA06001 and H9615S01)
  if (o && n && o.toLowerCase() !== n.toLowerCase()) {
    return `${s}/${o}/${n}`;
  }

  // 2. If only New exists (or mold was never renamed)
  if (n && (!o || n.toLowerCase() === o.toLowerCase()) && !/^(FA|IR|IRSV|M\d|MF|YG|YW)/i.test(n)) {
    return `${s}/${n}`;
  }

  // 3. If Old exists (or mold is an old mold code) but New is missing or equal to Old (unmapped)
  const moldToCheck = o || n;
  if (moldToCheck) {
    if (isHtml) {
      return `${s}/${moldToCheck}/<span class="badge-unmapped" style="color:#dc2626;background:#fee2e2;border:1px solid #fca5a5;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:0.3px;" title="Khuôn cũ '${esc(moldToCheck)}' chưa tìm thấy mã khuôn mới trong PartList.">🔴 Chưa Map</span>`;
    }
    return `${s}/${moldToCheck}/[🔴 Chưa Map]`;
  }

  return `${s}/-`;
}

function toIso(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return "";
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  if (!s) return "";
  if (/^\d{5,6}$/.test(s)) {
    const days = parseInt(s, 10);
    const date = new Date(Date.UTC(1899, 11, 30));
    date.setUTCDate(date.getUTCDate() + days);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  const parts = s.split(/[/-]/);
  if (parts.length === 3) {
    let p0 = parts[0].trim(), p1 = parts[1].trim(), p2 = parts[2].trim();
    if (p0.length === 4) return `${p0}-${p1.padStart(2, "0")}-${p2.padStart(2, "0")}`;
    let year = p2;
    if (year.length === 2) year = "20" + year;
    let v0 = parseInt(p0, 10), v1 = parseInt(p1, 10), nY = parseInt(year, 10);
    if (!isNaN(v0) && !isNaN(v1) && !isNaN(nY) && nY > 1900 && nY < 2100) {
      let day = v0, month = v1;
      if (v0 <= 12 && v1 > 12) { month = v0; day = v1; }
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${nY}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }
  return "";
}

function calcMedian(arr) {
  if (!arr || arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function calcStdDev(arr, mean) {
  if (!arr || arr.length < 2) return 0;
  const avg = mean !== undefined ? mean : (arr.reduce((a, b) => a + b, 0) / arr.length);
  const squareDiffs = arr.map(v => Math.pow(v - avg, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / arr.length;
  return Math.round(Math.sqrt(avgSquareDiff));
}

function formatShootDisplay(val) {
  const num = Number(val) || 0;
  if (num === 0) return "·";
  if (num < 1000) return String(num);
  if (num < 1000000) return `${Number((num / 1000).toFixed(2))}k`;
  return `${Number((num / 1000000).toFixed(2))}M`;
}

function formatShootHover(val) {
  return (Number(val) || 0).toLocaleString("en-US");
}

function parseShootValue(str) {
  let s = String(str || "").trim().toLowerCase();
  if (!s || s === "·" || s === "-") return 0;
  s = s.replace(/,/g, "");
  if (s.endsWith("k")) return Math.round(parseFloat(s.slice(0, -1)) * 1000) || 0;
  if (s.endsWith("m")) return Math.round(parseFloat(s.slice(0, -1)) * 1000000) || 0;
  return Math.round(parseFloat(s)) || 0;
}

function isValidPartName(name) {
  if (!name) return false;
  const s = String(name).trim();
  if (!s || s === '0' || s === '1' || s === '-' || s === '·' || /^(part|no|sum|stt|tổng|total|0\/0|1\/1|0\/0\/0|1\/1\/1)$/i.test(s)) return false;
  return true;
}

function isSmartMatch(text, query) {
  if (!text || !query) return false;
  const t = String(text).trim().toLowerCase();
  const q = String(query).trim().toLowerCase();
  if (t === q) return true;
  if (t.startsWith(q)) return true;
  const tokens = t.split(/[\s\-_/.]+/);
  for (const tok of tokens) {
    if (tok === q || tok.startsWith(q)) return true;
  }
  if (q.length >= 3 && t.includes(q)) return true;
  return false;
}

function getNextDateStr(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getPrevDateStr(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let _statusTimeout = null;
function msg(text, bad = false, duration = 6500) {
  const el = $("status");
  if (!el) return;
  el.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
    <div style="flex:1; line-height:1.5;">${text}</div>
    <button onclick="document.getElementById('status').style.display='none'" style="background:none; border:none; color:inherit; cursor:pointer; font-weight:bold; padding:0 2px; font-size:15px; opacity:0.75;" title="Đóng">✕</button>
  </div>`;
  el.className = "status" + (bad ? " error" : "");
  el.style.display = "block";
  clearTimeout(_statusTimeout);
  if (duration > 0) {
    _statusTimeout = setTimeout(() => { if (el) el.style.display = "none"; }, duration);
  }
}

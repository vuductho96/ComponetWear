/* Read-only inspection results and drawings. Data loads only when this tab/detail is opened. */
'use strict';
const inspectionState = { summary: null, loading: null, error: '', selected: null, dimensionIndex: null, details: new Map(), detailLoading: false, detailError: '', view: 'results', ngOnly: false, limit: 50 };
let inspectionPreview = null, inspectionPreviewPage = 1, inspectionPreviewZoom = 1, inspectionPreviewSerial = 0;
let inspectionPointFocus = null, inspectionPointRequest = 0;
const inspectionPointMaps = new Map();
let inspectionDownloadIndex = null;
async function downloadInspectionOriginal(kind, recordId = null) {
  const record = recordId ? inspectionState.summary?.records.find(item => item.id === recordId) : inspectionState.selected;
  if (!record) return;
  try {
    // Read the current index on each download so a republished original is picked up.
    const response = await fetch('data/inspection/downloads.json', { cache:'no-store' });
    if (!response.ok) throw Error('Chưa đồng bộ file gốc. Vui lòng thử lại sau khi Publish.');
    inspectionDownloadIndex = await response.json();
    const drawing = inspectionPreview || record.drawings[0];
    const entry = kind === 'excel' ? inspectionDownloadIndex.excel?.[record.id] : inspectionDownloadIndex.pdf?.[drawing?.id];
    const pattern = kind === 'excel' ? /^data\/inspection\/downloads\/[a-f0-9]{64}\.(xlsx|xlsm)$/ : /^data\/inspection\/downloads\/[a-f0-9]{64}\.pdf$/;
    if (!entry || !pattern.test(entry.url)) throw Error('Chưa có file gốc cho hồ sơ này.');
    const link = document.createElement('a');
    link.href = entry.url; link.download = kind === 'excel' ? record.file : drawing.name;
    document.body.append(link); link.click(); link.remove();
  } catch (error) { msg(inspectionEscape(error.message), true); }
}
async function downloadInspectionPackage(recordId) {
  const record = inspectionState.summary?.records.find(item => item.id === recordId);
  if (!record) return;
  if (!record.drawings.length) return downloadInspectionOriginal('excel', recordId);
  try {
    if (typeof JSZip === 'undefined') throw Error('Chưa tải được thư viện ZIP. Vui lòng tải lại trang.');
    const response = await fetch('data/inspection/downloads.json', { cache:'no-store' });
    if (!response.ok) throw Error('Chưa đồng bộ file gốc. Vui lòng thử lại sau khi Publish.');
    const index = await response.json();
    const files = [{ entry:index.excel?.[record.id], name:record.file, extension:'excel' },
      ...record.drawings.map(drawing => ({ entry:index.pdf?.[drawing.id], name:drawing.name, extension:'pdf' }))];
    const zip = new JSZip(), used = new Set();
    const names = files.map(file => {
      const name = String(file.name).replace(/[\\/]/g,'_');
      let unique = name, number = 2;
      while (used.has(unique)) unique = name.replace(/(\.[^.]+)$/, ` (${number++})$1`);
      used.add(unique); return unique;
    });
    await Promise.all(files.map(async (file, position) => {
      const pattern = file.extension === 'excel' ? /^data\/inspection\/downloads\/[a-f0-9]{64}\.(xlsx|xlsm)$/ : /^data\/inspection\/downloads\/[a-f0-9]{64}\.pdf$/;
      if (!file.entry || !pattern.test(file.entry.url)) throw Error('Chưa có đủ file gốc cho hồ sơ này.');
      const result = await fetch(file.entry.url, { cache:'force-cache' });
      if (!result.ok) throw Error('Không tải được file gốc. Vui lòng thử lại.');
      zip.file(names[position], await result.arrayBuffer(), { compression:'STORE' });
    }));
    const blob = await zip.generateAsync({ type:'blob', compression:'STORE' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = record.file.replace(/\.(xlsx|xlsm)$/i,'') + '.zip';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url),60000);
  } catch (error) { msg(inspectionEscape(error.message), true); }
}
const inspectionColumns = [
  { key: 'point', label: 'Point', value: d => d[0] },
  { key: 'nominal', label: 'Nominal', value: d => d[1] },
  { key: 'minus', label: 'Tol (−)', value: d => d[2] },
  { key: 'plus', label: 'Tol (+)', value: d => d[3] },
  { key: 'limits', label: 'LSL ~ USL', value: d => `${inspectionNumber(d[6])} ~ ${inspectionNumber(d[7])}`, sortValue: d => d[6] },
  { key: 'sample', label: 'Sample', value: d => d[4] },
  { key: 'actual', label: 'Actual', value: d => d[5] },
  { key: 'deviation', label: 'Δ', value: d => d[8] },
  { key: 'result', label: 'Result', value: d => d[9] }
];
let inspectionColumnFilters = {}, inspectionColumnSort = null;

function compareInspectionValues(a, b) {
  const number = value => typeof value === 'number' ? value : /^[-+]?\d+(?:[.,]\d+)?$/.test(String(value)) ? Number(String(value).replace(',', '.')) : NaN;
  const left = number(a), right = number(b);
  return Number.isFinite(left) && Number.isFinite(right) ? left - right : String(a ?? '').localeCompare(String(b ?? ''), 'vi', { numeric: true });
}
function inspectionVisibleDimensions(record) {
  let rows = (inspectionState.details.get(record.detailFile)?.[record.id] || []).map((d, index) => ({ d, index }));
  if (inspectionState.ngOnly) rows = rows.filter(({ d }) => d[9] === 'NG');
  rows = rows.filter(({ d }) => inspectionColumns.every(column => !(column.key in inspectionColumnFilters) || String(column.value(d) ?? '') === inspectionColumnFilters[column.key]));
  if (inspectionColumnSort) {
    const column = inspectionColumns.find(c => c.key === inspectionColumnSort.key);
    if (column) rows.sort((a, b) => inspectionColumnSort.direction * compareInspectionValues((column.sortValue || column.value)(a.d), (column.sortValue || column.value)(b.d)) || a.index - b.index);
  }
  return rows;
}
function closeInspectionColumnMenu() {
  document.getElementById('inspectionColumnMenu')?.remove();
  document.querySelectorAll('.inspection-column-filter[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
}
function resetInspectionColumns() {
  inspectionColumnFilters = {}; inspectionColumnSort = null;
  closeInspectionColumnMenu(); renderInspectionDetail();
}
function openInspectionColumnMenu(key, button) {
  const oldKey = document.getElementById('inspectionColumnMenu')?.dataset.key;
  closeInspectionColumnMenu();
  if (oldKey === key) return;
  const record = inspectionState.selected, column = inspectionColumns.find(c => c.key === key);
  if (!record || !column) return;
  const all = inspectionState.details.get(record.detailFile)?.[record.id] || [];
  const values = [...new Set(all.map(d => String(column.value(d) ?? '')))].sort(compareInspectionValues);
  const menu = document.createElement('div'); menu.id = 'inspectionColumnMenu'; menu.className = 'inspection-column-menu'; menu.dataset.key = key;
  menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Lọc và sắp xếp ' + column.label);
  menu.innerHTML = `<strong>${inspectionEscape(column.label)}</strong><button type="button" data-sort="1">↑ Thấp → cao</button><button type="button" data-sort="-1">↓ Cao → thấp</button><label for="inspectionColumnValue">Chỉ hiện giá trị</label><select id="inspectionColumnValue"><option value="all">Tất cả</option>${values.map((value, index) => `<option value="${index}" ${inspectionColumnFilters[key] === value ? 'selected' : ''}>${inspectionEscape(value || '(Trống)')}</option>`).join('')}</select><button type="button" id="inspectionColumnClear">Bỏ lọc / sắp xếp cột này</button>`;
  document.body.append(menu); button.setAttribute('aria-expanded', 'true');
  const rect = button.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, rect.bottom + menu.offsetHeight + 8 <= window.innerHeight ? rect.bottom + 4 : rect.top - menu.offsetHeight - 4) + 'px';
  menu.querySelectorAll('[data-sort]').forEach(control => control.addEventListener('click', () => {
    inspectionColumnSort = { key, direction: Number(control.dataset.sort) };
    closeInspectionColumnMenu(); renderInspectionDetail();
  }));
  menu.querySelector('select').addEventListener('change', event => {
    if (event.target.value === 'all') delete inspectionColumnFilters[key];
    else inspectionColumnFilters[key] = values[Number(event.target.value)];
    closeInspectionColumnMenu(); renderInspectionDetail();
  });
  menu.querySelector('#inspectionColumnClear').addEventListener('click', () => {
    delete inspectionColumnFilters[key];
    if (inspectionColumnSort?.key === key) inspectionColumnSort = null;
    closeInspectionColumnMenu(); renderInspectionDetail();
  });
  menu.querySelector('select').focus();
}
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#inspectionColumnMenu, .inspection-column-filter')) closeInspectionColumnMenu();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeInspectionColumnMenu(); });
window.addEventListener('resize', closeInspectionColumnMenu);
document.addEventListener('wheel', event => {
  if (!event.target.closest('#inspectionColumnMenu')) closeInspectionColumnMenu();
}, { passive: true });
function openInspectionDrawing(drawing, focus = null) {
  ++inspectionPointRequest;
  inspectionPointFocus = focus;
  inspectionPreview = drawing;
  inspectionPreviewPage = focus?.locations[focus.index].page || 1; inspectionPreviewZoom = focus ? 3 : 1;
  renderInspectionPdfPage();
  renderInspectionPointStatus();
}
function renderInspectionPdfPage() {
  const serial = ++inspectionPreviewSerial;
  const host = document.getElementById('inspectionPdf');
  const pages = inspectionPreview?.pages || [];
  if (!host) return;
  const url = pages[inspectionPreviewPage - 1];
  if (!url || !/^data\/inspection\/drawings\/[a-f0-9]{64}-v[0-9]+-p[0-9]{4}\.webp$/.test(url)) { host.innerHTML = '<div class="inspection-empty">Bản xem chưa sẵn sàng. Hãy tải lại trang sau khi đồng bộ.</div>'; return; }
  host.innerHTML = '<div class="inspection-empty">Đang mở bản vẽ…</div>';
  document.getElementById('inspectionPdfPage').textContent = 'Trang ' + inspectionPreviewPage + ' / ' + pages.length + ' · ' + Math.round(inspectionPreviewZoom * 100) + '%';
  document.getElementById('inspectionPdfPrev').disabled = inspectionPreviewPage <= 1;
  document.getElementById('inspectionPdfNext').disabled = inspectionPreviewPage >= pages.length;
  const image = new Image();
  image.onload = () => {
    if (serial !== inspectionPreviewSerial || document.getElementById('inspectionPdf') !== host) return;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const width = Math.max(100, host.clientWidth - 32) * inspectionPreviewZoom;
    canvas.style.width = Math.round(width) + 'px'; canvas.style.height = Math.round(width * image.naturalHeight / image.naturalWidth) + 'px';
    canvas.setAttribute('aria-label', 'Bản vẽ chỉ xem, trang ' + inspectionPreviewPage);
    canvas.getContext('2d').drawImage(image, 0, 0);
    canvas.title = 'Kéo để pan · Cuộn chuột để zoom · Double-click để phóng to';
    let pan = null;
    canvas.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      pan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: host.scrollLeft, top: host.scrollTop };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('is-panning');
    });
    canvas.addEventListener('pointermove', event => {
      if (!pan || event.pointerId !== pan.id) return;
      const scale = host.getBoundingClientRect().width / host.offsetWidth || 1;
      host.scrollLeft = pan.left - (event.clientX - pan.x) / scale;
      host.scrollTop = pan.top - (event.clientY - pan.y) / scale;
    });
    const stopPan = event => {
      if (!pan || event.pointerId !== pan.id) return;
      pan = null;
      canvas.classList.remove('is-panning');
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', stopPan);
    canvas.addEventListener('pointercancel', stopPan);
    canvas.addEventListener('lostpointercapture', stopPan);
    if (host._inspectionWheel) host.removeEventListener('wheel', host._inspectionWheel);
    host._inspectionWheel = event => {
      if (!host.contains(canvas) || !event.deltaY) return;
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1);
      const factor = Math.exp(-Math.max(-300, Math.min(300, pixels)) * 0.0015);
      setInspectionZoom(inspectionPreviewZoom * factor, event.clientX, event.clientY);
    };
    host.addEventListener('wheel', host._inspectionWheel, { passive: false });
    canvas.addEventListener('dblclick', event => {
      event.preventDefault();
      setInspectionZoom(inspectionPreviewZoom * 1.5, event.clientX, event.clientY);
    });
    canvas.dataset.rendered = 'true'; host.replaceChildren(canvas);
    host.scrollTo(0, 0);
    positionInspectionPoint(true);
  };
  image.onerror = () => { if (serial === inspectionPreviewSerial && document.getElementById('inspectionPdf') === host) host.innerHTML = '<div class="inspection-empty">Không tải được bản xem. Hãy thử lại hoặc tải lại trang.</div>'; };
  image.src = url;
}
function changeInspectionPdfPage(delta) { if (!inspectionPreview?.pages?.length) return; inspectionPreviewPage = Math.max(1, Math.min(inspectionPreview.pages.length, inspectionPreviewPage + delta)); renderInspectionPdfPage(); }
function setInspectionZoom(zoom, clientX, clientY) {
  const host = document.getElementById('inspectionPdf'), canvas = host?.querySelector('canvas');
  if (!canvas) return;
  const viewport = host.getBoundingClientRect(), before = canvas.getBoundingClientRect();
  const x = clientX ?? viewport.left + host.clientWidth / 2;
  const y = clientY ?? viewport.top + host.clientHeight / 2;
  const pointX = Math.max(0, Math.min(1, (x - before.left) / before.width));
  const pointY = Math.max(0, Math.min(1, (y - before.top) / before.height));
  // 100% fits the drawing width; never shrink it to a tiny page in an empty panel.
  inspectionPreviewZoom = Math.max(1, Math.min(6, zoom));
  const width = Math.round(Math.max(100, host.clientWidth - 32) * inspectionPreviewZoom);
  canvas.style.width = width + 'px';
  canvas.style.height = Math.round(width * canvas.height / canvas.width) + 'px';
  const after = canvas.getBoundingClientRect();
  const scale = viewport.width / host.offsetWidth || 1;
  host.scrollLeft += (after.left + pointX * after.width - x) / scale;
  host.scrollTop += (after.top + pointY * after.height - y) / scale;
  document.getElementById('inspectionPdfPage').textContent = 'Trang ' + inspectionPreviewPage + ' / ' + inspectionPreview.pages.length + ' · ' + Math.round(inspectionPreviewZoom * 100) + '%';
  positionInspectionPoint(false);
}
function zoomInspectionPdf(delta) { setInspectionZoom(inspectionPreviewZoom + delta); }
function fitInspectionDrawing() { setInspectionZoom(1); document.getElementById('inspectionPdf')?.scrollTo(0, 0); }

async function loadInspectionPointMap(drawing) {
  const url = drawing.pointMap;
  if (!url) return {};
  if (!/^data\/inspection\/drawings\/points-[a-f0-9]{64}-[a-f0-9]{12}\.json$/.test(url)) throw Error('Invalid point map');
  if (!inspectionPointMaps.has(url)) {
    const pending = fetch(url, { cache: 'force-cache' }).then(async response => {
      if (!response.ok) throw Error('HTTP ' + response.status);
      const data = await response.json();
      if (data.schemaVersion !== 1 || !data.points || typeof data.points !== 'object') throw Error('Invalid point map');
      const points = {};
      for (const [point, locations] of Object.entries(data.points)) {
        if (!/^\d{1,3}$/.test(point) || !Array.isArray(locations)) continue;
        points[point] = locations.filter(p => Number.isInteger(p.page) && p.page >= 1 && p.page <= drawing.pages.length &&
          [p.x, p.y, p.w, p.h].every(Number.isFinite) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 &&
          p.w > 0 && p.w < .2 && p.h > 0 && p.h < .2 && p.confidence >= .92);
      }
      return points;
    }).catch(error => { inspectionPointMaps.delete(url); throw error; });
    inspectionPointMaps.set(url, pending);
  }
  return inspectionPointMaps.get(url);
}

function renderInspectionPointStatus(message) {
  const host = document.getElementById('inspectionPointStatus');
  if (!host) return;
  if (message) { host.textContent = message; return; }
  const focus = inspectionPointFocus;
  if (!focus) { host.textContent = 'Bấm dòng Point bên trái để tìm bước trên bản vẽ.'; return; }
  host.innerHTML = `<strong>Point ${inspectionEscape(focus.point)}</strong> · Trang ${focus.locations[focus.index].page}` +
    (focus.locations.length > 1 ? ` · Vị trí ${focus.index + 1}/${focus.locations.length} <button type="button" onclick="nextInspectionPointLocation()">Vị trí tiếp →</button>` : ' · Đã tìm thấy');
}

function positionInspectionPoint(center) {
  const host = document.getElementById('inspectionPdf'), canvas = host?.querySelector('canvas');
  host?.querySelector('.inspection-point-marker')?.remove();
  const focus = inspectionPointFocus, location = focus?.locations[focus.index];
  if (!canvas || !location || focus.drawingId !== inspectionPreview?.id || location.page !== inspectionPreviewPage) return;
  const left = canvas.offsetLeft + location.x * canvas.clientWidth;
  const top = canvas.offsetTop + location.y * canvas.clientHeight;
  const marker = document.createElement('div'); marker.className = 'inspection-point-marker';
  marker.style.left = left + 'px'; marker.style.top = top + 'px';
  marker.style.width = Math.max(28, location.w * canvas.clientWidth + 12) + 'px';
  marker.style.height = Math.max(28, location.h * canvas.clientHeight + 12) + 'px';
  marker.setAttribute('aria-label', 'Vị trí Point ' + focus.point); host.append(marker);
  if (center) { host.scrollLeft = left - host.clientWidth / 2; host.scrollTop = top - host.clientHeight / 2; }
}

async function focusInspectionPoint(value, dimensionIndex = null) {
  const record = inspectionState.selected, match = /^\s*0*(\d{1,3})\s*$/.exec(String(value));
  if (!record) return;
  const point = match ? String(Number(match[1])) : '';
  const request = ++inspectionPointRequest;
  inspectionPointFocus = null; positionInspectionPoint(false);
  inspectionState.dimensionIndex = dimensionIndex;
  document.querySelectorAll('.inspection-dimensions [data-point]').forEach(row => row.classList.toggle('point-selected', dimensionIndex !== null && row.dataset.dimension === String(dimensionIndex)));
  if (!point) { renderInspectionPointStatus('Point này chưa có số bước để tìm trên bản vẽ.'); return; }
  if (!record.drawings.length) { renderInspectionPointStatus('Hồ sơ này chưa có bản vẽ.'); return; }
  renderInspectionPointStatus('Đang tìm Point ' + point + '…');
  try {
    const drawings = [...record.drawings].sort((a, b) => Number(b.id === inspectionPreview?.id) - Number(a.id === inspectionPreview?.id));
    for (const drawing of drawings) {
      const points = await loadInspectionPointMap(drawing);
      if (request !== inspectionPointRequest || inspectionState.selected?.id !== record.id) return;
      const locations = points[point];
      if (!locations?.length) continue;
      const focus = { point, locations, index: 0, drawingId: drawing.id };
      if (drawing.id !== inspectionPreview?.id) {
        document.getElementById('inspectionDrawing').value = String(record.drawings.indexOf(drawing));
        openInspectionDrawing(drawing, focus);
      } else {
        inspectionPointFocus = focus;
        if (inspectionPreviewPage !== locations[0].page || !document.querySelector('#inspectionPdf canvas')) {
          inspectionPreviewPage = locations[0].page; inspectionPreviewZoom = 3; renderInspectionPdfPage();
        } else { setInspectionZoom(3); positionInspectionPoint(true); }
        renderInspectionPointStatus();
      }
      if (window.matchMedia('(max-width: 1100px)').matches) document.getElementById('inspectionDrawingPanel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    renderInspectionPointStatus('Chưa nhận diện được số ' + point + ' trên bản vẽ. Bạn vẫn có thể pan/zoom để xem.');
  } catch (error) {
    if (request === inspectionPointRequest) renderInspectionPointStatus('Chưa tải được vị trí Point. Bấm lại dòng để thử lại.');
  }
}

function nextInspectionPointLocation() {
  if (!inspectionPointFocus) return;
  const focus = inspectionPointFocus;
  focus.index = (focus.index + 1) % focus.locations.length;
  const page = focus.locations[focus.index].page;
  if (page !== inspectionPreviewPage) { inspectionPreviewPage = page; inspectionPreviewZoom = 3; renderInspectionPdfPage(); }
  else { setInspectionZoom(3); positionInspectionPoint(true); }
  renderInspectionPointStatus();
}

function inspectionEscape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function inspectionNumber(value) { return value === null || value === undefined || value === '' ? '—' : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 6 }); }
function inspectionBadge(quality) { return `<span class="inspection-badge ${quality.toLowerCase()}">${quality === 'PENDING' ? 'Chưa đo' : quality === 'UNRATED' ? 'Thiếu dung sai' : quality}</span>`; }

async function renderInspectionTab() {
  if (!inspectionState.summary && !inspectionState.loading) {
    inspectionState.error = '';
    inspectionState.loading = fetch('data/inspection/summary.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw Error('HTTP ' + r.status); return r.json(); })
      .then(data => { if (data.schemaVersion !== 1 || !Array.isArray(data.records)) throw Error('Dữ liệu không hợp lệ'); inspectionState.summary = data; })
      .catch(e => { inspectionState.error = 'Chưa tải được dữ liệu đo: ' + e.message; })
      .finally(() => { inspectionState.loading = null; renderInspectionList(); });
  }
  renderInspectionList();
}

function inspectionFilteredRows() {
  const search = (document.getElementById('inspectionSearch')?.value || '').trim().toLocaleLowerCase('vi');
  const quality = document.getElementById('inspectionQuality')?.value || '';
  const source = document.getElementById('inspectionSource')?.value || '';
  const month = document.getElementById('inspectionMonth')?.value || '';
  return (inspectionState.summary?.records || []).filter(r => (!quality || r.quality === quality) && (!source || r.source === source) && (!month || r.month === month) && (!search || [r.part, r.mold, r.file, r.lot].join(' ').toLocaleLowerCase('vi').includes(search)))
    .sort((a, b) => inspectionRecordDate(b) - inspectionRecordDate(a) || String(b.month).localeCompare(String(a.month)) || String(a.file).localeCompare(String(b.file), 'vi', { numeric: true }) || a.id.localeCompare(b.id));
}

function inspectionRecordDate(record) {
  for (const value of [record.measuredDate, record.receivedDate]) {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value || '');
    if (match) {
      const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date.getTime();
    }
  }
  const month = /^(\d{4})-(\d{2})$/.exec(record.month || '');
  return month && Number(month[2]) >= 1 && Number(month[2]) <= 12 ? Date.UTC(Number(month[1]), Number(month[2]) - 1, 1) : -Infinity;
}

function renderInspectionList() {
  const host = document.getElementById('inspectionList');
  if (!host) return;
  if (!inspectionState.summary) {
    host.innerHTML = `<div class="inspection-empty" role="status">${inspectionEscape(inspectionState.error || 'Đang tải kết quả đo…')}${inspectionState.error ? '<br><button type="button" onclick="renderInspectionTab()">Thử lại</button>' : ''}</div>`;
    return;
  }
  const monthSelect = document.getElementById('inspectionMonth');
  if (!monthSelect.dataset.ready) {
    const months = [...new Set(inspectionState.summary.records.map(r => r.month).filter(Boolean))].sort().reverse();
    monthSelect.innerHTML = '<option value="">Tất cả tháng</option>' + months.map(m => `<option value="${inspectionEscape(m)}">${inspectionEscape(m)}</option>`).join('');
    const sources = [...new Set(inspectionState.summary.records.map(r => r.source).filter(Boolean))].sort();
    document.getElementById('inspectionSource').innerHTML = '<option value="">Tất cả nguồn</option>' + sources.map(s => `<option>${inspectionEscape(s)}</option>`).join('');
    monthSelect.dataset.ready = '1';
  }
  const rows = inspectionFilteredRows();
  document.getElementById('inspectionCount').textContent = `${rows.length.toLocaleString('vi-VN')} hồ sơ · Cập nhật ${new Date(inspectionState.summary.generatedAt).toLocaleString('vi-VN')}`;
  host.innerHTML = `<table class="inspection-register"><thead><tr><th>File hồ sơ</th><th>Part</th><th>Mold</th><th>Tháng</th><th>Ngày đo</th><th>Nguồn</th><th>Điểm / Mẫu</th><th>Chất lượng</th><th>Bản vẽ</th></tr></thead><tbody>${rows.length ? rows.slice(0, inspectionState.limit).map(r => `<tr class="inspection-record ${inspectionState.selected?.id === r.id ? 'selected' : ''}" data-inspection-id="${r.id}" tabindex="0" aria-selected="${inspectionState.selected?.id === r.id}" aria-label="Xem kết quả ${inspectionEscape(r.part)} ${inspectionEscape(r.mold)}"><td title="${inspectionEscape(r.lot)}"><div class="inspection-file-cell"><span class="inspection-file-name" title="${inspectionEscape(r.file)}">${inspectionEscape(r.file)}</span><button type="button" class="inspection-record-download" data-download-id="${r.id}" title="${r.drawings.length ? 'Tải hồ sơ gốc (Excel và PDF)' : 'Tải file Excel gốc'}" aria-label="${r.drawings.length ? 'Tải hồ sơ gốc (Excel và PDF)' : 'Tải file Excel gốc'}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/></svg></button></div></td><td><strong>${inspectionEscape(r.part)}</strong></td><td>${inspectionEscape(r.mold)}</td><td>${inspectionEscape(r.month || '—')}</td><td>${inspectionEscape(r.measuredDate || 'Chưa đo')}</td><td>${inspectionEscape(r.source)}</td><td>${r.points} / ${r.samples}</td><td>${inspectionBadge(r.quality)}${r.ngSamples ? `<small class="inspection-ng-text"> ${r.ngSamples} NG</small>` : ''}</td><td>${r.drawings.length ? 'Có bản vẽ' : 'Chưa ghép'}</td></tr>`).join('') : '<tr><td colspan="9" class="inspection-empty">Không có hồ sơ phù hợp bộ lọc.</td></tr>'}</tbody></table>`;
  if (rows.length > inspectionState.limit) host.innerHTML += `<button class="inspection-more" type="button" onclick="inspectionState.limit += 50; renderInspectionList()">Xem thêm 50 hồ sơ (${inspectionState.limit} / ${rows.length})</button>`;
  host.querySelectorAll('[data-inspection-id]').forEach(row => {
    row.addEventListener('click', () => selectInspectionRecord(row.dataset.inspectionId));
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectInspectionRecord(row.dataset.inspectionId); } });
  });
  host.querySelectorAll('.inspection-record-download').forEach(button => {
    button.addEventListener('keydown', event => { event.stopPropagation(); });
    button.addEventListener('click', async event => {
      event.stopPropagation();
      button.disabled = true;
      button.setAttribute('aria-busy','true');
      try { await downloadInspectionPackage(button.dataset.downloadId); }
      finally { button.disabled = false; button.removeAttribute('aria-busy'); }
    });
  });
}

function filterInspection() {
  inspectionState.limit = 50;
  if (inspectionState.selected && !inspectionFilteredRows().some(r => r.id === inspectionState.selected.id)) {
    inspectionState.selected = null; renderInspectionDetail();
  }
  renderInspectionList();
}

async function selectInspectionRecord(id) {
  const record = inspectionState.summary.records.find(r => r.id === id);
  if (!record) return;
  ++inspectionPointRequest; inspectionPointFocus = null;
  inspectionState.selected = record; inspectionState.dimensionIndex = null; inspectionState.view = 'results'; inspectionState.detailError = ''; inspectionState.ngOnly = false;
  inspectionColumnFilters = {}; inspectionColumnSort = null; closeInspectionColumnMenu();
  renderInspectionList();
  if (!inspectionState.details.has(record.detailFile)) {
    inspectionState.detailLoading = true;
    renderInspectionDetail();
    try {
      const response = await fetch('data/inspection/' + record.detailFile, { cache: 'no-cache' });
      if (!response.ok) throw Error('HTTP ' + response.status);
      const details = await response.json();
      if (!details || typeof details !== 'object') throw Error('Dữ liệu điểm đo không hợp lệ');
      inspectionState.details.set(record.detailFile, details);
    } catch (e) { if (inspectionState.selected?.id === id) inspectionState.detailError = e.message; }
    finally { if (inspectionState.selected?.id === id) inspectionState.detailLoading = false; }
  } else { inspectionState.detailLoading = false; }
  if (inspectionState.selected?.id === id) renderInspectionDetail();
}

function showInspectionView(view) { document.getElementById(view === 'drawings' ? 'inspectionDrawingPanel' : 'inspectionDetail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
function setInspectionNgOnly(ngOnly) { inspectionState.ngOnly = ngOnly; renderInspectionDetail(); }
function renderInspectionDrawingPanel(r) {
  const host = document.getElementById('inspectionDrawingPanel');
  if (!host) return;
  if (!r) { host.innerHTML = '<div class="inspection-panel-heading"><h3>Bản vẽ đối chiếu</h3><span class="inspection-view-only">Chỉ xem</span></div><div class="inspection-empty">Chọn hồ sơ trong bảng để xem bản vẽ liên quan.</div>'; inspectionPreview = null; inspectionPointFocus = null; ++inspectionPointRequest; ++inspectionPreviewSerial; return; }
  if (host.dataset.record === r.id) return;
  host.dataset.record = r.id;
  host.innerHTML = `<div class="inspection-panel-heading"><h3>Bản vẽ đối chiếu</h3><button type="button" class="inspection-original-download" onclick="downloadInspectionOriginal('pdf')" title="Tải file PDF gốc" ${r.drawings.length ? '' : 'disabled'}>PDF gốc ↓</button></div><div id="inspectionPointStatus" class="inspection-point-status" role="status" aria-live="polite">Bấm dòng Point bên trái để tìm bước trên bản vẽ.</div>` + (r.drawings.length ? `<div class="inspection-drawing-toolbar"><select id="inspectionDrawing" aria-label="Bản vẽ liên quan">${r.drawings.map((d,i) => `<option value="${i}">${inspectionEscape(d.name)}</option>`).join('')}</select></div><div class="inspection-pdf-controls"><button id="inspectionPdfPrev" onclick="changeInspectionPdfPage(-1)" aria-label="Trang trước" type="button">←</button><span id="inspectionPdfPage">Đang tải…</span><button id="inspectionPdfNext" onclick="changeInspectionPdfPage(1)" aria-label="Trang sau" type="button">→</button><button type="button" onclick="zoomInspectionPdf(-0.25)" aria-label="Thu nhỏ bản vẽ">−</button><button type="button" onclick="zoomInspectionPdf(0.25)" aria-label="Phóng to bản vẽ">+</button><button type="button" class="inspection-fit" onclick="fitInspectionDrawing()" aria-label="Vừa khung bản vẽ">Vừa khung</button></div><div id="inspectionPdf" class="inspection-pdf" role="region" aria-label="Bản vẽ linh kiện"></div><p class="inspection-drawing-note">Kéo để pan · Cuộn chuột để zoom tại con trỏ · Double-click để phóng to.</p>` : '<div class="inspection-empty">Chưa tìm thấy bản vẽ phù hợp với hồ sơ này.</div>');
  if (r.drawings.length) {
    const open = () => openInspectionDrawing(r.drawings[Number(document.getElementById('inspectionDrawing').value)]);
    document.getElementById('inspectionDrawing').addEventListener('change', open); open();
  }
}
function renderInspectionDetail() {
  const host = document.getElementById('inspectionDetail'), r = inspectionState.selected;
  if (!host) return;
  renderInspectionDrawingPanel(r);
  if (!r) { host.innerHTML = '<div class="inspection-panel-heading"><h3>Xem nhanh kích thước điểm đo</h3></div><div class="inspection-empty inspection-welcome"><h3>Chọn một linh kiện trên bảng</h3><p>Kích thước, dung sai và kết quả từng mẫu sẽ hiển thị tại đây.</p></div>'; const drawingHost = document.getElementById('inspectionDrawingPanel'); if (drawingHost) delete drawingHost.dataset.record; return; }
  const header = `<div class="inspection-panel-heading"><h3>Xem nhanh kích thước điểm đo</h3><div><button type="button" class="inspection-original-download" onclick="downloadInspectionOriginal('excel')" title="Tải file Excel gốc">Excel gốc ↓</button> ${inspectionBadge(r.quality)}</div></div><div class="inspection-preview-meta"><strong>${inspectionEscape(r.part)} / ${inspectionEscape(r.mold)}</strong><span>${inspectionEscape(r.source)} · ${inspectionEscape(r.measuredDate || 'Chưa đo')}</span></div><div class="inspection-result-toolbar"><span>${r.points} điểm · ${r.samples} mẫu · <b class="inspection-ng-text">${r.ngSamples} NG</b></span><div class="inspection-segment"><button type="button" class="${!inspectionState.ngOnly ? 'active' : ''}" onclick="setInspectionNgOnly(false)">Tất cả điểm</button><button type="button" class="${inspectionState.ngOnly ? 'active' : ''}" onclick="setInspectionNgOnly(true)">Chỉ điểm NG</button></div></div>`;
  if (inspectionState.detailLoading) { host.innerHTML = header + '<div class="inspection-empty" role="status">Đang tải điểm đo…</div>'; return; }
  if (inspectionState.detailError) { host.innerHTML = header + `<div class="inspection-empty">Không tải được điểm đo: ${inspectionEscape(inspectionState.detailError)}<br><button onclick="selectInspectionRecord('${r.id}')">Thử lại</button></div>`; return; }
  const dimensions = inspectionVisibleDimensions(r);
  const headings = inspectionColumns.map(column => {
    const filtered = column.key in inspectionColumnFilters, sorted = inspectionColumnSort?.key === column.key;
    return `<th scope="col" aria-sort="${sorted ? inspectionColumnSort.direction === 1 ? 'ascending' : 'descending' : 'none'}">${inspectionEscape(column.label)}<button type="button" class="inspection-column-filter ${filtered || sorted ? 'active' : ''}" data-column="${column.key}" aria-label="Lọc và sắp xếp ${inspectionEscape(column.label)}" aria-expanded="false" title="Lọc và sắp xếp ${inspectionEscape(column.label)}">${sorted ? inspectionColumnSort.direction === 1 ? '▴' : '▾' : '▾'}${filtered ? '<i></i>' : ''}</button></th>`;
  }).join('');
  const rows = dimensions.map(({ d, index }) => `<tr data-point="${inspectionEscape(d[0])}" data-dimension="${index}" tabindex="0" title="Mẫu ${inspectionEscape(d[4])}: bấm để tìm Point ${inspectionEscape(d[0])} trên bản vẽ" class="${inspectionState.dimensionIndex === index ? 'point-selected ' : ''}${d[9] === 'NG' ? 'inspection-ng-row' : ''}"><td><strong>${inspectionEscape(d[0])}</strong></td><td>${inspectionEscape(d[1])}</td><td>${inspectionEscape(d[2])}</td><td>${inspectionEscape(d[3])}</td><td>${inspectionNumber(d[6])} ~ ${inspectionNumber(d[7])}</td><td>${inspectionEscape(d[4])}</td><td class="inspection-measured">${inspectionNumber(d[5])}</td><td>${inspectionNumber(d[8])}</td><td>${inspectionBadge(d[9])}</td></tr>`).join('');
  const active = Object.keys(inspectionColumnFilters).length || inspectionColumnSort;
  const filterInfo = active ? `<div class="inspection-column-summary">Đang hiện ${dimensions.length} / ${r.samples} mẫu <button type="button" onclick="resetInspectionColumns()">Bỏ lọc / sắp xếp</button></div>` : '';
  host.innerHTML = header + filterInfo + `<div class="inspection-dimension-scroll"><table class="inspection-dimensions"><thead><tr>${headings}</tr></thead><tbody>${rows || `<tr><td colspan="9" class="inspection-empty">${r.quality === 'PENDING' ? 'Hồ sơ chưa có giá trị đo.' : 'Không có mẫu phù hợp bộ lọc.'}</td></tr>`}</tbody></table></div>`;
  host.querySelectorAll('[data-column]').forEach(button => button.addEventListener('click', () => openInspectionColumnMenu(button.dataset.column, button)));
  host.querySelectorAll('[data-point]').forEach(row => {
    const open = () => focusInspectionPoint(row.dataset.point, Number(row.dataset.dimension));
    row.addEventListener('click', open);
    row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
}

async function exportInspectionResults() {
  const rows = inspectionFilteredRows();
  if (!rows.length || typeof ExcelJS === 'undefined') return msg('Chưa có dữ liệu để xuất.', true);
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Ket qua do');
  sheet.columns = [{ header: 'Nguồn', key: 'source', width: 26 }, { header: 'Linh kiện', key: 'part', width: 18 }, { header: 'Khuôn', key: 'mold', width: 20 }, { header: 'Hồ sơ', key: 'file', width: 34 }, { header: 'Lô / Thư mục', key: 'lot', width: 52 }, { header: 'Ngày đo', key: 'measuredDate', width: 16 }, { header: 'Kết quả', key: 'quality', width: 16 }, { header: 'Điểm đo', key: 'points', width: 12 }, { header: 'Mẫu đo', key: 'samples', width: 12 }, { header: 'Mẫu NG', key: 'ngSamples', width: 12 }];
  sheet.addRows(rows); sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const selected = inspectionState.selected;
  const dimensions = selected && inspectionState.details.get(selected.detailFile)?.[selected.id];
  if (dimensions?.length) { const detail = book.addWorksheet('Chi tiet da chon'); detail.addRow(['Điểm', 'Danh nghĩa', 'Dung sai -', 'Dung sai +', 'Mẫu', 'Thực tế', 'Min', 'Max', 'Sai lệch', 'Kết quả']); dimensions.forEach(d => detail.addRow(d)); detail.getRow(1).font = { bold: true }; }
  const url = URL.createObjectURL(new Blob([await book.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = 'Ket_qua_do_linh_kien.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

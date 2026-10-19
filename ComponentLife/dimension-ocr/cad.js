import {mountPromptTemplate} from './cad-prompt-template.js';
import {mountCadSuite} from './cad-suite.js';
import {mountCodeLayout} from './cad-code-layout.js';
// import {mountGeminiPanel} from './gemini-panel.js';
import {mountLocalFreecad} from './freecad-local.js';
// import {validateProposal} from './gemini-cad.js';
import {FreeCadSketcher} from './freecad-sketcher.js';
import {extractViewFeatures, solveMultiViewGeometry} from './hybrid-cad-solver.js';
import {mountAiChat} from './freecad-ai-chat.js';
import './cad-shell.js';
import * as pdfjs from './vendor/pdf.mjs';
import {OcrClient} from './ocr-client.js';
import {CadViewer,FACE_DIRECTIONS} from './cad-viewer.js';
import {analyzeCrop,toModel,viewAxes} from './cad-geometry.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;

const $ = id => document.getElementById(id);
const status = t => $('cad-status').textContent = t;
const source = document.createElement('canvas');
const display = $('source-canvas');
const ctx = display.getContext('2d');

let pdf = null, page = 1, crops = [], selected = null, full = true, tool = 'polyline';
let zoom = 1, offset = [20, 20], gesture = null, points = [], profile = [], profileClosed = false;
let holes = [], pockets = [], built = false, mesh = null, sourceName = 'Unnamed.FCStd', cropSequence = 0;
let worker = null, sequence = 0, requests = new Map(), kernelBusy = false, ocrBusy = false;
let lastAIProposal = null, aiProposalMode = false, standalone = true, circleProfile = null;
let undoStack = [], redoStack = [], restoring = false;

const ocr = new OcrClient(status);
const viewer = new CadViewer(face => chooseFace(face));

source.width = 0;
source.height = 0;

// Initialize FreeCAD Web Sketcher
const sketcher = new FreeCadSketcher({
  canvas: display,
  getCrop: () => active(),
  onProfileChange: ({ profile: p, circle, closed, dof, summary }) => {
    profile = p;
    circleProfile = circle;
    profileClosed = closed;
    invalidate();
    updateTree();
    updateSolverStatus(closed, dof, summary);
  },
  onStatus: t => status(t),
  isStandalone: () => standalone
});

function active() {
  return crops.find(c => c.id === selected);
}

function updateSolverStatus(closed, dof, summary) {
  const badge = $('solver-badge');
  const title = $('solver-title');
  const desc = $('solver-desc');
  if (!badge) return;
  if (closed) {
    badge.className = 'solver-badge';
    title.textContent = '✓ Fully constrained / Closed profile';
    desc.textContent = summary || 'Sketch loop is closed and valid for PartDesign Pad (Extrude).';
    $('confirm-geometry').checked = true;
  } else if (profile.length > 0 || circleProfile) {
    badge.className = 'solver-badge under-constrained';
    title.textContent = `○ Under-constrained (${dof || 1} DoF)`;
    desc.textContent = summary || 'Sketch outline is not closed yet. Continue drawing to close loop.';
  } else {
    badge.className = 'solver-badge';
    title.textContent = 'Sketcher: Empty sketch';
    desc.textContent = 'Choose Line, Rect, Circle, Arc or Slot to draw on the XY plane.';
  }
}

function invalidate() {
  built = false;
  updateTree();
  if (mesh) {
    $('model-empty').hidden = false;
    $('model-empty').textContent = 'Preview is out of date · Recompute (F5)';
  }
  $('confirm-geometry').checked = false;
  document.querySelectorAll('[data-export],#export-source,#export-macro').forEach(b => b.disabled = true);
  $('model-metrics').textContent = mesh ? 'Geometry changed. Rebuild before exporting.' : '';
  draw();
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function currentCanvas() {
  return full ? source : active()?.canvas || source;
}

function fit() {
  const c = currentCanvas(), r = $('source-viewport').getBoundingClientRect();
  if (!c.width) return;
  zoom = Math.max(.22, Math.min((r.width - 30) / c.width, (r.height - 30) / c.height));
  offset = [(r.width - c.width * zoom) / 2, (r.height - c.height * zoom) / 2];
  draw();
}

function draw() {
  const r = $('source-viewport').getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
  display.width = Math.max(1, r.width * dpr);
  display.height = Math.max(1, r.height * dpr);
  ctx.scale(dpr, dpr);
  ctx.fillStyle = standalone ? '#21252b' : '#e9edf4';
  ctx.fillRect(0, 0, r.width, r.height);

  const c = currentCanvas();
  if (c.width) {
    ctx.save();
    ctx.translate(...offset);
    ctx.scale(zoom, zoom);
    ctx.fillStyle = standalone ? '#1e2227' : 'white';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(c, 0, 0);
    if (standalone && !full) drawSketchGrid(c);
    ctx.restore();
  }

  // Draw crops if full drawing view
  if (full && crops.length) {
    ctx.save();
    ctx.translate(...offset);
    ctx.scale(zoom, zoom);
    ctx.lineWidth = 1.5 / zoom;
    for (const cr of crops) {
      if (cr.page !== page) continue;
      ctx.strokeStyle = cr.id === selected ? '#2563eb' : '#149b87';
      ctx.strokeRect(cr.rect.x, cr.rect.y, cr.rect.w, cr.rect.h);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `${12 / zoom}px sans-serif`;
      ctx.fillText(cr.face || `Crop ${cr.id}`, cr.rect.x, cr.rect.y - 4 / zoom);
    }
    ctx.restore();
  }

  // Render FreeCAD Sketcher interactive geometry, constraints, and dimensions
  sketcher.render(ctx, zoom, offset, active());

  // Model overlay
  if ($('overlay').checked && mesh && active()?.mm && active()?.face) {
    drawOverlay(active());
  }

  // Draw rectangle / pocket gestures if legacy gesture active
  if (gesture?.type === 'crop' && gesture.end) {
    ctx.save();
    ctx.translate(...offset);
    ctx.scale(zoom, zoom);
    const a = gesture.start, b = gesture.end;
    ctx.fillStyle = '#2563eb20';
    ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.strokeStyle = '#2563eb';
    ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.restore();
  }

  $('source-zoom').textContent = Math.round(zoom * 100) + '%';
}

function drawOverlay(cr) {
  ctx.save();
  ctx.globalAlpha = Number($('overlay-opacity').value);
  ctx.strokeStyle = '#e84460';
  ctx.lineWidth = 1.5 / zoom;
  const e = viewer.edgePositions;
  if (!e || !viewAxes(cr.face)) return;
  const axis = viewAxes(cr.face), indices = axis.map(a => ({X:0,Y:1,Z:2}[a])), sign = (['Back','Left','Bottom'].includes(cr.face)) ? -1 : 1;
  ctx.beginPath();
  for (let i = 0; i < e.length; i += 6) {
    const p = [e[i + indices[0]] * sign, e[i + indices[1]]];
    const q = [e[i + 3 + indices[0]] * sign, e[i + 3 + indices[1]]];
    ctx.moveTo(cr.origin[0] + p[0] / cr.mm, cr.origin[1] - p[1] / cr.mm);
    ctx.lineTo(cr.origin[0] + q[0] / cr.mm, cr.origin[1] - q[1] / cr.mm);
  }
  ctx.stroke();
  ctx.restore();
}

new ResizeObserver(() => draw()).observe($('source-viewport'));

function setSketchTool(t) {
  tool = t;
  sketcher.setTool(t);
  document.querySelectorAll('[data-tool-btn]').forEach(b => {
    b.classList.toggle('active', b.dataset.toolBtn === t);
  });
  draw();
}

function setTool(t) {
  tool = t;
  points = [];
  gesture = null;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  if (!['pan', 'crop'].includes(t)) {
    if (!active()) {
      status('Select a crop first.');
      tool = 'pan';
      return;
    }
    full = false;
    fit();
  }
  draw();
}

document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => {
  if (b.dataset.tool === 'crop') {
    full = true;
    fit();
  }
  setTool(b.dataset.tool);
});

function point(e) {
  const r = display.getBoundingClientRect();
  return [(e.clientX - r.left - offset[0]) / zoom, (e.clientY - r.top - offset[1]) / zoom];
}

display.onpointerdown = e => {
  if (e.button === 1 || tool === 'pan') {
    gesture = { type: 'pan', x: e.clientX, y: e.clientY, offset: [...offset] };
  } else if (tool === 'crop') {
    gesture = { type: 'crop', start: point(e), end: point(e) };
  } else {
    // FreeCAD interactive sketcher
    sketcher.handlePointerDown(e, zoom, offset, active());
  }
  display.setPointerCapture(e.pointerId);
  draw();
};

display.onpointermove = e => {
  if (gesture?.type === 'pan') {
    offset = [gesture.offset[0] + e.clientX - gesture.x, gesture.offset[1] + e.clientY - gesture.y];
  } else if (gesture?.type === 'crop') {
    gesture.end = point(e);
  } else {
    sketcher.handlePointerMove(e, zoom, offset, active());
  }
  draw();
};

display.onpointerup = e => {
  if (gesture?.type === 'crop') {
    const a = gesture.start, b = point(e);
    const x = Math.max(0, Math.floor(Math.min(a[0], b[0])));
    const y = Math.max(0, Math.floor(Math.min(a[1], b[1])));
    const w = Math.min(source.width - x, Math.ceil(Math.abs(a[0] - b[0])));
    const h = Math.min(source.height - y, Math.ceil(Math.abs(a[1] - b[1])));
    if (w >= 10 && h >= 10) {
      const c = canvas(w, h);
      c.getContext('2d').drawImage(source, x, y, w, h, 0, 0, w, h);
      const cr = { id: ++cropSequence, canvas: c, rect: { x, y, w, h }, page, face: null, mm: null, origin: [0, h], rotation: 0, flipped: false };
      crops.push(cr);
      selectCrop(cr.id);
      $('assign-mode').checked = false;
      status('Crop added. Label it or trace directly.');
    }
  }
  gesture = null;
  draw();
};

display.onpointercancel = () => {
  gesture = null;
  draw();
};

display.onwheel = e => {
  e.preventDefault();
  const p = point(e), r = display.getBoundingClientRect();
  zoom = Math.max(.15, Math.min(20, zoom * Math.exp(-e.deltaY * .002)));
  offset = [e.clientX - r.left - p[0] * zoom, e.clientY - r.top - p[1] * zoom];
  draw();
};

function selectCrop(id) {
  switchView('sketch');
  selected = id;
  full = false;
  points = [];
  list();
  syncFields();
  fit();
  $('selected-face').textContent = active()?.face || 'Unassigned';
}

function list() {
  document.dispatchEvent(new Event('cad-crops-changed'));
  updateTree();
  const host = $('crop-list');
  if (!host) return;
  host.replaceChildren();
  for (const c of crops) {
    const row = document.createElement('div');
    row.className = 'crop-card' + (c.id === selected ? ' selected' : '');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    const thumb = canvas(c.canvas.width, c.canvas.height);
    thumb.getContext('2d').drawImage(c.canvas, 0, 0);
    const text = document.createElement('div');
    const title = document.createElement('strong');
    const info = document.createElement('small');
    title.textContent = c.face || `Crop ${c.id}`;
    info.textContent = `P${c.page} · ${c.rect.w}×${c.rect.h}px · ${c.mm ? c.mm.toFixed(4) + ' mm/px' : 'Uncalibrated'}`;
    text.append(title, info);
    const del = document.createElement('button');
    del.textContent = '×';
    del.onclick = e => {
      e.stopPropagation();
      crops = crops.filter(x => x !== c);
      if (selected === c.id) { selected = null; full = true; }
      invalidate();
      list();
      alignment();
      draw();
    };
    row.append(thumb, text, del);
    row.onclick = () => selectCrop(c.id);
    host.append(row);
  }
  viewer.mapped(crops.map(c => c.face).filter(Boolean));
  for (const b of $('view-shortcuts').children) {
    b.classList.toggle('mapped', crops.some(c => c.face === b.textContent));
  }
}

for (const face of Object.keys(FACE_DIRECTIONS)) {
  const b = document.createElement('button');
  b.textContent = face;
  b.setAttribute('aria-label', `${face} view`);
  b.onclick = () => {
    viewer.snap(FACE_DIRECTIONS[face]);
    chooseFace(face);
  };
  $('view-shortcuts').append(b);
}

function chooseFace(face) {
  if (standalone) {
    switchView('model');
    $('cube-direction').textContent = face.toUpperCase();
    return;
  }
  if ($('assign-mode').checked) {
    const c = active();
    if (!c) return status('Select a crop to assign first.');
    const other = crops.find(v => v.face === face && v !== c);
    if (other) return status(`${face} already has a crop. Unassign it first.`);
    c.face = face;
    invalidate();
    list();
    syncFields();
    $('assign-mode').checked = false;
    alignment();
    status(`Crop assigned to ${face}. Camera controls now change the view only.`);
  } else {
    const c = crops.find(c => c.face === face);
    if (c) selectCrop(c.id);
  }
  $('cube-direction').textContent = face.toUpperCase();
}

function syncFields() {
  const c = active();
  $('mm-pixel').value = c?.mm || '';
  $('origin-x').value = c?.origin[0] ?? '';
  $('origin-y').value = c?.origin[1] ?? '';
  $('selected-face').textContent = c?.face || '—';
  $('source-info').textContent = c && !full
    ? `Source: (${c.rect.x}, ${c.rect.y}) · ${c.rect.w} × ${c.rect.h}px · page ${c.page}`
    : `${source.width} × ${source.height}px · page ${page}`;
  $('calibration-info').textContent = c?.mm
    ? `Scale ${c.mm.toFixed(5)} mm / pixel. Origin and trace use the transformed crop; source rectangle stays unchanged.`
    : 'Use Scale · 2 points on a known dimension, or enter mm / pixel.';
}

for (const id of ['mm-pixel', 'origin-x', 'origin-y']) {
  $(id).oninput = () => {
    const c = active();
    if (!c) return;
    const value = Number($(id).value);
    if (!Number.isFinite(value) || (id === 'mm-pixel' && value <= 0)) {
      status('Enter a valid positive scale.');
      return;
    }
    if (id === 'mm-pixel') c.mm = value;
    else c.origin[id === 'origin-x' ? 0 : 1] = value;
    invalidate();
    syncFields();
    alignment();
  };
}

$('reference-mm').onchange = () => {
  const c = active(), v = Number($('reference-mm').value);
  if (c?.calibration && v > 0) {
    const [a, b] = c.calibration.points;
    c.mm = v / Math.hypot(a[0] - b[0], a[1] - b[1]);
    c.calibration.length = v;
    invalidate();
    syncFields();
    alignment();
  }
};

function alignment() {
  const report = [];
  for (const f of ['Front', 'Top', 'Right']) {
    const c = crops.find(c => c.face === f);
    report.push(`${c?.mm ? '✓' : '○'} ${f}: ${c ? c.mm ? 'calibrated' : 'needs scale' : 'not assigned'}`);
  }
  if (profileClosed && profile.length) {
    const xs = profile.map(p => p[0]), ys = profile.map(p => p[1]);
    report.push(`Sketch X ${(Math.max(...xs) - Math.min(...xs)).toFixed(2)} × Y ${(Math.max(...ys) - Math.min(...ys)).toFixed(2)} mm · Z ${$('model-height').value} mm`);
  }
  $('alignment-report').textContent = report.join('\n');
  list();
}

$('projection').onchange = () => {
  $('projection-layout').textContent = $('projection').value === 'third'
    ? 'Third angle: Top above Front · Right to the right.'
    : 'First angle: Top below Front · Right to the left.';
  invalidate();
};
$('projection').onchange();

$('unassign').onclick = () => {
  if (active()) {
    active().face = null;
    invalidate();
    list();
    syncFields();
    alignment();
  }
};

function transformCrop(flip) {
  const c = active();
  if (!c) return;
  const old = c.canvas, n = canvas(flip ? old.width : old.height, flip ? old.height : old.width), g = n.getContext('2d');
  if (flip) {
    g.translate(old.width, 0);
    g.scale(-1, 1);
    c.origin = [old.width - c.origin[0], c.origin[1]];
    c.flipped = !c.flipped;
  } else {
    g.translate(old.height, 0);
    g.rotate(Math.PI / 2);
    c.origin = [old.height - c.origin[1], c.origin[0]];
    c.rotation = (c.rotation + 90) % 360;
  }
  g.drawImage(old, 0, 0);
  c.canvas = n;
  invalidate();
  list();
  syncFields();
  fit();
}

$('rotate-crop').onclick = () => transformCrop(false);
$('flip-crop').onclick = () => transformCrop(true);
$('fit-source').onclick = fit;
$('show-sheet').onclick = () => { full = true; setTool('pan'); fit(); syncFields(); };
$('overlay').onchange = draw;
$('overlay-opacity').oninput = draw;
$('wireframe').onchange = e => {
  const edge = viewer.group.getObjectByName('edges');
  if (edge) edge.visible = e.target.checked;
};
$('home-view').onclick = () => {
  viewer.snap([1, -1, 1]);
  $('cube-direction').textContent = 'ISOMETRIC';
};

async function loadDrawing(file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) return status('Maximum file size is 50 MB.');
  try {
    clear();
    sourceName = file.name;
    $('drawing-name').textContent = sourceName;
    if (/\.pdf$/i.test(file.name)) {
      pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      $('cad-page').replaceChildren(...Array.from({ length: pdf.numPages }, (_, i) => new Option(i + 1, i + 1)));
      await renderPage();
    } else {
      const bitmap = await createImageBitmap(file);
      source.width = bitmap.width;
      source.height = bitmap.height;
      source.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close();
      ready();
    }
  } catch (e) {
    status('Could not open drawing: ' + e.message);
  }
}

async function renderPage() {
  page = Number($('cad-page').value);
  const p = await pdf.getPage(page), base = p.getViewport({ scale: 1 }), v = p.getViewport({ scale: Math.min(3, 3500 / Math.max(base.width, base.height)) });
  source.width = Math.ceil(v.width);
  source.height = Math.ceil(v.height);
  await p.render({ canvasContext: source.getContext('2d'), viewport: v }).promise;
  full = true;
  ready();
}

function ready() {
  updateTree();
  $('drawing-tools').open = true;
  $('source-empty').hidden = true;
  fit();
  syncFields();
  status('Drawing ready. Trace over views or crop for assisted modeling.');
}

$('cad-file').onchange = e => loadDrawing(e.target.files[0]);
$('cad-page').onchange = () => renderPage().catch(e => status(e.message));
$('from-ocr').onclick = () => parent.postMessage({ type: 'request-drawing' }, location.origin);

function clear() {
  lastAIProposal = null;
  aiProposalMode = false;
  document.dispatchEvent(new Event('cad-session-cleared'));
  $('model-height').value = 20;
  $('edge-treatment').value = 'none';
  $('edge-size').value = .5;
  sourceName = 'Unnamed.FCStd';
  standalone = true;
  circleProfile = null;
  undoStack = [];
  redoStack = [];
  worker?.terminate();
  worker = null;
  for (const p of requests.values()) p.reject(Error('Session cleared'));
  requests.clear();
  pdf?.destroy();
  pdf = null;
  source.width = 0;
  source.height = 0;
  crops = [];
  selected = null;
  profile = [];
  profileClosed = false;
  holes = [];
  pockets = [];
  mesh = null;
  sketcher.clear();
  viewer.group.children.forEach(o => { o.geometry?.dispose(); o.material?.dispose(); });
  viewer.group.clear();
  $('model-empty').hidden = false;
  $('analysis').textContent = 'Geometry candidates require review.';
  $('ocr-candidates').replaceChildren();
  $('source-empty').hidden = false;
  full = true;
  points = [];
  invalidate();
  list();
  featureList();
  draw();
}

$('reset').onclick = () => {
  clear();
  newSketch();
  status('Session cleared. New FreeCAD XY sketch initialized.');
};

$('finish-profile').onclick = () => {
  sketcher.finishCurrent();
  if (profile.length < 3 && !circleProfile) {
    status('Draw at least three vertices in a closed loop.');
    return;
  }
  profileClosed = true;
  invalidate();
  alignment();
};

$('clear-profile').onclick = () => {
  sketcher.clear();
  profile = [];
  circleProfile = null;
  profileClosed = false;
  invalidate();
  status('Sketch cleared.');
};

function featureList() {
  const host = $('features');
  if (!host) return;
  host.replaceChildren();
  for (const [kind, arr] of [['Hole', holes], ['Pocket', pockets]]) {
    arr.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'feature-row';
      const text = document.createElement('span');
      text.textContent = kind === 'Hole'
        ? `${kind} ${i + 1} · Ø${(f.radius * 2).toFixed(2)} · ${f.axis} · (${f.x.toFixed(2)}, ${f.y.toFixed(2)}, ${f.z.toFixed(2)})`
        : `Pocket ${i + 1} · ${f.size.join(' × ')} mm @ ${f.origin.join(', ')}`;
      const del = document.createElement('button');
      del.textContent = 'Remove';
      del.onclick = () => {
        arr.splice(i, 1);
        featureList();
        invalidate();
      };
      row.append(text, del);
      host.append(row);
    });
  }
}

for (const id of ['model-height', 'edge-treatment', 'edge-size']) {
  $(id).onchange = () => { invalidate(); alignment(); };
}

function spec() {
  return {
    profile,
    ...(circleProfile ? { circle: circleProfile } : {}),
    depth: Number($('model-height').value) || 20,
    holes,
    pockets,
    ...($('edge-treatment').value === 'none' ? {} : { [$('edge-treatment').value]: Number($('edge-size').value) })
  };
}

function request(type, data = {}) {
  if (!worker) {
    worker = new Worker(new URL('./cad-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'status') {
        $('kernel-status').textContent = data.message || data.text;
        return;
      }
      const p = requests.get(data.id);
      if (!p) return;
      requests.delete(data.id);
      if (data.type === 'error') p.reject(Error(data.message || data.error));
      else p.resolve(data);
    };
    worker.onerror = e => {
      for (const p of requests.values()) p.reject(Error(e.message));
      requests.clear();
      worker.terminate();
      worker = null;
    };
  }
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    requests.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...data });
  });
}

$('build-solid').onclick = async () => {
  if (kernelBusy) return;
  if (!profileClosed || profile.length < 3) {
    return status('Close a 2D sketch loop before Pad (Extrude). Use Polyline, Rectangle, Circle, Arc or Slot.');
  }
  kernelBusy = true;
  $('build-solid').disabled = true;
  status('Computing 3D solid with local OpenCascade kernel…');
  try {
    const result = await request('build', { spec: spec() });
    mesh = result.mesh;
    switchView('model');
    viewer.show(mesh);
    built = true;
    updateTree();
    document.querySelectorAll('[data-export],#export-source,#export-macro').forEach(b => b.disabled = false);
    const m = result.metrics;
    $('model-metrics').textContent = `✓ Valid solid · Volume ${m.volume.toFixed(3)} mm³\nArea ${m.area.toFixed(2)} mm² · ${mesh.triangles.length / 3} triangles`;
    $('kernel-status').textContent = 'OpenCascade · local WASM';
    $('overlay').checked = true;
    draw();
    status('Solid computed successfully! Rotate with mouse in 3D viewport.');
  } catch (e) {
    status('Build failed: ' + e.message);
    $('model-metrics').textContent = e.message;
    built = false;
  } finally {
    kernelBusy = false;
    $('build-solid').disabled = false;
  }
};

async function revolveSolid() {
  if (kernelBusy) return;
  if (!profileClosed || profile.length < 3) return status('Close a 2D sketch loop before Revolution.');
  kernelBusy = true;
  status('Revolving 2D sketch around Y-axis into rotational 3D solid…');
  try {
    const s = spec();
    s.revolve = true;
    s.revolveAxis = 'Y';
    s.revolveAngle = 360;
    const result = await request('build', { spec: s });
    mesh = result.mesh;
    switchView('model');
    viewer.show(mesh);
    built = true;
    updateTree();
    document.querySelectorAll('[data-export],#export-source,#export-macro').forEach(b => b.disabled = false);
    status('Revolution complete! 3D rotational solid created.');
  } catch (e) {
    status('Revolution failed: ' + e.message);
  } finally {
    kernelBusy = false;
  }
}

function download(blob, name) {
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

document.querySelectorAll('[data-export]').forEach(b => b.onclick = async () => {
  if (!built) return;
  try {
    const r = await request('export', { format: b.dataset.export });
    download(r.blob, `freecad-part.${b.dataset.export}`);
    status(`${b.dataset.export.toUpperCase()} file exported.`);
  } catch (e) {
    status('Export failed: ' + e.message);
  }
});

$('export-source').onclick = () => {
  if (!built) return;
  const data = { version: 1, units: 'mm', standalone, spec: spec(), source: sourceName };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'freecad-model.json');
  status('Model JSON downloaded.');
};

$('export-macro').onclick = () => {
  if (!built) return;
  download(new Blob([freecadMacro(spec())], { type: 'text/x-python' }), 'freecad-part.FCMacro');
  status('FreeCAD Macro downloaded. Run in desktop FreeCAD to edit as a native parametric body.');
};

function freecadMacro(s) {
  return `# Generated by FreeCAD Web Clone. Open and run in FreeCAD.
import FreeCAD as App, Part, Sketcher, math
from FreeCAD import Vector
import json

spec = json.loads(${JSON.stringify(JSON.stringify(s))})
doc = App.newDocument('FreeCADWebPart')
body = doc.addObject('PartDesign::Body', 'Body')
sketch = doc.addObject('Sketcher::SketchObject', 'Sketch_Profile')
body.addObject(sketch)

p = spec['profile']
if spec.get('circle'):
    c = spec['circle']
    sketch.addGeometry(Part.Circle(Vector(c['center'][0], c['center'][1], 0), Vector(0, 0, 1), c['radius']), False)
else:
    for i, a in enumerate(p):
        b = p[(i + 1) % len(p)]
        sketch.addGeometry(Part.LineSegment(Vector(a[0], a[1], 0), Vector(b[0], b[1], 0)), False)

if spec.get('revolve'):
    rev = body.newObject('PartDesign::Revolution', 'Revolution')
    rev.Profile = sketch
    rev.Angle = spec.get('revolveAngle', 360)
    rev.ReferenceAxis = (sketch, ['Y_Axis'])
    shape = rev.Shape
else:
    pad = body.newObject('PartDesign::Pad', 'Pad')
    pad.Profile = sketch
    pad.Length = spec['depth']
    doc.recompute()
    shape = pad.Shape

for i, h in enumerate(spec.get('holes', [])):
    axis = {'X': Vector(1, 0, 0), 'Y': Vector(0, 1, 0), 'Z': Vector(0, 0, 1)}[h['axis']]
    origin = Vector(h['x'], h['y'], h['z'])
    bbox = shape.BoundBox
    length = max(bbox.XLength, bbox.YLength, bbox.ZLength) * 3 + 10
    cutter = Part.makeCylinder(h['radius'], length, origin - axis * length / 2, axis)
    shape = shape.cut(cutter)
    f = body.newObject('PartDesign::Feature', 'Hole_' + str(i + 1))
    f.Shape = shape

for i, pk in enumerate(spec.get('pockets', [])):
    shape = shape.cut(Part.makeBox(*pk['size'], Vector(*pk['origin'])))
    f = body.newObject('PartDesign::Feature', 'Pocket_' + str(i + 1))
    f.Shape = shape

if spec.get('fillet', 0) > 0: shape = shape.makeFillet(spec['fillet'], shape.Edges)
if spec.get('chamfer', 0) > 0: shape = shape.makeChamfer(spec['chamfer'], shape.Edges)

final = body.newObject('PartDesign::Feature', 'FinalSolid')
final.Shape = shape
sketch.Visibility = False
doc.recompute()

if App.GuiUp:
    import FreeCADGui as Gui
    Gui.activeDocument().activeView().viewAxonometric()
    Gui.activeDocument().activeView().fitAll()
`;
}

function demo() {
  clear();
  sourceName = 'Example_Plate_Ø8.FCStd';
  $('fc-doc-name').textContent = sourceName;
  $('drawing-name').textContent = sourceName;
  const outline = [[0, 0], [60, 0], [60, 25], [35, 25], [35, 40], [0, 40]];
  profile = outline;
  profileClosed = true;
  holes = [{ axis: 'Z', x: 18, y: 18, z: 0, radius: 4 }];
  $('model-height').value = 20;

  // Load into sketcher so user can interactively draw/modify
  sketcher.loadProfile(outline);
  featureList();
  ready();
  switchView('sketch');
  status('Worked example loaded into FreeCAD Sketcher. Pad or modify directly on canvas.');
}

$('demo').onclick = demo;
$('empty-demo')?.addEventListener('click', demo);

function switchView(mode) {
  const stage = document.querySelector('.cad-stage');
  stage.dataset.mode = mode;
  $('view-sketch').classList.toggle('active', mode === 'sketch');
  $('view-solid').classList.toggle('active', mode === 'model');
  $('workbench').value = mode === 'model' ? 'model' : 'sketch';
  $('edit-state').textContent = mode === 'sketch' ? '2D Sketcher Edit' : '3D PartDesign Solid';
  document.querySelectorAll('.sketch-strip').forEach(el => el.classList.toggle('hidden-strip', mode === 'model'));
  requestAnimationFrame(() => {
    viewer.resize();
    draw();
  });
}

function drawSketchGrid(c) {
  const cr = active();
  if (!cr) return;
  const step = 10 / cr.mm;
  ctx.lineWidth = .5 / zoom;
  ctx.strokeStyle = '#2b313c';
  ctx.beginPath();
  for (let x = cr.origin[0] % step; x < c.width; x += step) {
    ctx.moveTo(x, 0); ctx.lineTo(x, c.height);
  }
  for (let y = cr.origin[1] % step; y < c.height; y += step) {
    ctx.moveTo(0, y); ctx.lineTo(c.width, y);
  }
  ctx.stroke();
}

function updateTree() {
  for (const id of ['ai-rotate', 'ai-flip']) if ($(id)) $(id).disabled = !active();
  for (const id of ['ai-pan', 'ai-crop', 'ai-full']) if ($(id)) $(id).disabled = !source.width;

  const host = $('model-tree');
  if (!host) return;

  const rows = [
    ['Application', 'folder', 0, '', () => {}],
    [sourceName || 'Unnamed.FCStd', 'file-plus', 1, '', () => switchView('sketch')],
    ['Body', 'cube', 2, 'Active', () => switchView(built ? 'model' : 'sketch')],
    ['Origin', 'axis-x', 3, 'XY_Plane', () => switchView('sketch')],
    ['Sketch', 'pencil', 3, profileClosed ? 'Closed' : profile.length ? `${profile.length} pts` : 'Empty', () => switchView('sketch')]
  ];

  if (mesh) rows.push(['Pad', 'extrude', 3, `${$('model-height').value} mm`, () => switchView('model')]);
  holes.forEach((h, i) => rows.push([`Hole ${i + 1}`, 'circle-dot', 3, `Ø${(h.radius * 2).toFixed(2)}`, () => switchView('model')]));
  pockets.forEach((p, i) => rows.push([`Pocket ${i + 1}`, 'box-align-bottom', 3, p.size.join('×'), () => switchView('model')]));
  if ($('edge-treatment').value !== 'none') {
    rows.push([$('edge-treatment').value, 'border-radius', 3, `${$('edge-size').value} mm`, () => switchView('model')]);
  }

  host.replaceChildren();
  for (const [name, icon, level, value, action] of rows) {
    const row = document.createElement('div');
    row.className = 'tree-node' + (level ? ' child' : '') + (level === 3 ? ' feature' : '') + (name === 'Body' ? ' active' : '');
    row.setAttribute('role', 'treeitem');
    row.tabIndex = 0;
    const img = document.createElement('img');
    img.src = 'vendor/cad/icons/' + icon + '.svg';
    const text = document.createElement('span');
    text.textContent = name;
    const val = document.createElement('small');
    val.textContent = value;
    row.append(img, text, val);
    row.onclick = () => {
      action();
      host.querySelectorAll('.tree-node').forEach(r => r.classList.toggle('active', r === row));
    };
    host.append(row);
  }

  const props = $('property-grid');
  if (props) {
    props.replaceChildren();
    for (const [k, v] of [
      ['Document', sourceName || 'Unnamed.FCStd'],
      ['Plane', 'XY_Plane (Base)'],
      ['Sketch Type', circleProfile ? 'Circle' : `${profile.length} Vertices`],
      ['Status', profileClosed ? 'Fully Constrained' : 'Under-constrained'],
      ['Pad Length', `${$('model-height').value} mm`],
      ['Holes', holes.length],
      ['Pockets', pockets.length],
      ['3D State', built ? 'Valid Solid' : 'Editing']
    ]) {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = k; dd.textContent = v;
      props.append(dt, dd);
    }
  }

  $('fc-doc-name').textContent = sourceName || 'Unnamed.FCStd';
  $('doc-tab-label').textContent = (sourceName || 'Unnamed.FCStd') + ' : 1';
}

function newSketch() {
  clear();
  standalone = true;
  sourceName = 'Unnamed.FCStd';
  source.width = 1600;
  source.height = 1200;
  const sCtx = source.getContext('2d');
  sCtx.fillStyle = '#21252b';
  sCtx.fillRect(0, 0, 1600, 1200);

  const c = canvas(1600, 1200);
  c.getContext('2d').drawImage(source, 0, 0);
  const cr = { id: ++cropSequence, canvas: c, rect: { x: 0, y: 0, w: 1600, h: 1200 }, page: 1, face: 'Top', mm: 0.1, origin: [800, 600], rotation: 0, flipped: false };
  crops = [cr];
  selected = cr.id;
  full = false;
  $('source-empty').hidden = true;
  selectCrop(cr.id);
  switchView('sketch');
  sketcher.clear();
  setSketchTool('polyline');
  $('confirm-geometry').checked = true;
  updateSolverStatus(false, 0, 'New XY sketch created. Choose a tool to draw directly.');
  status('New XY Sketch created. Draw with Polyline (L), Rectangle (R), Circle (C), Arc (A), Slot (S).');
  updateTree();
}

function showHelpModal() {
  const dialog = document.createElement('dialog');
  dialog.className = 'fc-modal-help';
  dialog.innerHTML = `
    <h3>📐 FreeCAD Web Shortcuts & Quick Guide</h3>
    <table>
      <tr><th>Shortcut</th><th>Action</th><th>Description</th></tr>
      <tr><td><kbd>L</kbd></td><td>Polyline</td><td>Draw continuous lines, snap to start point to close</td></tr>
      <tr><td><kbd>R</kbd></td><td>Rectangle</td><td>Draw 2-point parametric rectangle</td></tr>
      <tr><td><kbd>C</kbd></td><td>Circle</td><td>Center point + radius point</td></tr>
      <tr><td><kbd>A</kbd></td><td>3-Point Arc</td><td>Start point, end point, drag curvature</td></tr>
      <tr><td><kbd>S</kbd></td><td>Slot</td><td>Elongated rounded slot between 2 centers</td></tr>
      <tr><td><kbd>P</kbd></td><td>Polygon</td><td>Regular hexagon / polygon</td></tr>
      <tr><td><kbd>G</kbd></td><td>Construction</td><td>Toggle dashed blue construction helper lines</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Finish / Cancel</td><td>Finish current line or return to pan</td></tr>
      <tr><td><kbd>Space</kbd></td><td>Toggle 2D/3D</td><td>Switch between 2D Sketcher and 3D Solid View</td></tr>
      <tr><td><kbd>F5</kbd></td><td>Recompute</td><td>Rebuild 3D solid from current sketch</td></tr>
      <tr><td><kbd>Ctrl+Z</kbd></td><td>Undo</td><td>Undo last sketch action</td></tr>
      <tr><td><kbd>Ctrl+Y</kbd></td><td>Redo</td><td>Redo last sketch action</td></tr>
    </table>
    <div style="text-align:right;margin-top:15px"><button id="fc-close-help" class="primary" style="padding:6px 14px">Close</button></div>
  `;
  document.body.append(dialog);
  dialog.querySelector('#fc-close-help').onclick = () => dialog.close();
  dialog.onclose = () => dialog.remove();
  dialog.showModal();
}

// Global CAD Command Dispatcher
document.addEventListener('cad-command', e => {
  const cmd = e.detail;
  if (cmd === 'undo') {
    if (sketcher.undo()) return draw();
    return;
  }
  if (cmd === 'redo') {
    if (sketcher.redo()) return draw();
    return;
  }
  if (cmd === 'close-task') {
    document.querySelector('.cad-docks').classList.remove('show-tasks');
    return;
  }
  if (cmd === 'new-sketch') return newSketch();
  if (cmd === 'open') return $('cad-file').click();
  if (cmd === 'reset') return $('reset').click();
  if (cmd === 'sketch-view' || cmd === 'model-view') return switchView(cmd === 'model-view' ? 'model' : 'sketch');
  if (cmd === 'fit') {
    if (document.querySelector('.cad-stage').dataset.mode === 'model') {
      viewer.controls.reset();
      viewer.resize();
    } else fit();
    return;
  }
  if (cmd === 'iso') return $('home-view').click();
  if (cmd === 'toggle-wireframe') {
    $('wireframe').checked = !$('wireframe').checked;
    $('wireframe').dispatchEvent(new Event('change'));
    return;
  }
  if (cmd === 'clear-profile') {
    sketcher.clear();
    profile = [];
    circleProfile = null;
    profileClosed = false;
    invalidate();
    return;
  }
  if (['line', 'rectangle', 'circle', 'arc', 'slot', 'polygon'].includes(cmd)) {
    if (!source.width) newSketch();
    switchView('sketch');
    const toolMap = { line: 'polyline', rectangle: 'rectangle', circle: 'circle', arc: 'arc', slot: 'slot', polygon: 'polygon' };
    setSketchTool(toolMap[cmd] || cmd);
    return;
  }
  if (cmd === 'construction') {
    const act = sketcher.toggleConstruction();
    $('btn-construction')?.classList.toggle('active', act);
    status(act ? 'Construction Mode ON (blue dashed helper lines).' : 'Normal Geometry Mode ON.');
    draw();
    return;
  }
  if (cmd === 'grid-snap') {
    const act = sketcher.toggleGridSnap();
    $('btn-grid-snap')?.classList.toggle('active', act);
    status(act ? 'Grid snap enabled.' : 'Grid snap disabled.');
    draw();
    return;
  }
  if (cmd === 'finish') {
    sketcher.finishCurrent();
    if (profileClosed) {
      status('Sketch closed. Pad ready.');
      document.querySelector('.cad-docks').classList.add('show-tasks');
      $('build-solid').click();
    } else {
      status('Draw a closed outline before Pad.');
    }
    draw();
    return;
  }
  if (cmd === 'pad') {
    if (!profileClosed) return status('Close a sketch first before Pad. Use Polyline, Rectangle, Circle, Arc or Slot.');
    switchView('model');
    $('build-solid').click();
    return;
  }
  if (cmd === 'revolve') {
    if (!profileClosed) return status('Close a sketch first before Revolution.');
    revolveSolid();
    return;
  }
  if (cmd === 'recompute') {
    $('build-solid').click();
    return;
  }
  if (cmd === 'pocket') {
    featureDialog('pocket');
    return;
  }
  if (cmd === 'hole') {
    featureDialog('hole');
    return;
  }
  if (cmd === 'fillet' || cmd === 'chamfer') {
    $('edge-treatment').value = cmd;
    invalidate();
    $('build-solid').click();
    return;
  }
  if (cmd === 'help') {
    showHelpModal();
    return;
  }
  if (cmd === 'export-step') {
    document.querySelector('[data-export="step"]')?.click();
    return;
  }
  if (cmd === 'export-stl') {
    document.querySelector('[data-export="stl"]')?.click();
    return;
  }
  if (cmd === 'export-macro') {
    $('export-macro')?.click();
    return;
  }
  if (cmd === 'export-source') {
    $('export-source')?.click();
    return;
  }
  if (cmd === 'hybrid-reconstruct') {
    document.querySelector('.cad-docks').classList.add('show-tasks');
    $('tab-dock-chat')?.click();
    return;
  }
  if (cmd === 'analyze-crop') return runAnalyzeCurrentCrop();
  if (cmd === 'ocr-dimensions') return runOcrDimensions();
});

export async function runHybridReconstruction() {
  if (kernelBusy) return status('CAD kernel đang bận. Vui lòng chờ...');
  if (!crops.length) {
    status('Hãy mở bản vẽ kỹ thuật hoặc tạo vùng Crop hình chiếu (Top, Front, Right) trước khi dựng 3D.');
    return;
  }

  status('Đang phân tích hình học các mặt chiếu (Deterministic CV + Spatial Reasoning)…');
  document.querySelector('.cad-docks').classList.add('show-tasks');
  const taskContent = $('tasks-content');

  let aiPanel = $('hybrid-ai-panel');
  if (!aiPanel) {
    aiPanel = document.createElement('div');
    aiPanel.id = 'hybrid-ai-panel';
    taskContent.prepend(aiPanel);
  }
  aiPanel.innerHTML = `
    <div class="dock-title">🧠 Hybrid AI · 2D → 3D Reconstruction</div>
    <p class="muted">Đang phân tích ${crops.length} mặt chiếu, bóc tách biên dạng và giải hệ phương trình hình chiếu...</p>
    <div style="margin:8px 0;color:#20c997;font-size:12px;">● Đang phân tích...</div>
  `;

  try {
    const viewFeatures = crops.map(c => extractViewFeatures(c));
    const solution = solveMultiViewGeometry(viewFeatures, {
      defaultDepth: Number($('model-height').value) || 20
    });

    aiPanel.innerHTML = `
      <div class="dock-title" style="display:flex;justify-content:space-between;align-items:center;">
        <span>🧠 Hybrid AI · 2D → 3D</span>
        <span class="pill" style="background:#20c99722;color:#20c997;border:1px solid #20c997;padding:2px 6px;border-radius:3px;font-size:10px;">LOCAL PIPELINE</span>
      </div>
      <p style="margin:6px 0;font-weight:600;color:#fff;font-size:12px;">${solution.summary}</p>
      <div style="background:#1e222b;border:1px solid #363d4d;border-radius:4px;padding:8px;font-size:11px;line-height:1.5;max-height:160px;overflow-y:auto;margin-bottom:8px;">
        <strong style="color:#adb5bd;display:block;margin-bottom:4px;">Trình tự suy luận hình học:</strong>
        <ul style="margin:0;padding-left:16px;color:#d0d7de;">
          ${solution.reasoning.map(r => `<li>${r}</li>`).join('')}
        </ul>
        ${solution.assumptions.length ? `
          <strong style="color:#e0a82e;display:block;margin-top:6px;">Giả định / Phần suy đoán:</strong>
          <ul style="margin:0;padding-left:16px;color:#e0a82e;">
            ${solution.assumptions.map(a => `<li>${a}</li>`).join('')}
          </ul>
        ` : ''}
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button id="btn-re-solve" class="button" style="flex:1;">Phân tích lại</button>
        <button id="btn-edit-sketch" class="button" style="flex:1;">Sửa phác thảo 2D</button>
      </div>
    `;

    $('btn-re-solve').onclick = () => runHybridReconstruction();
    $('btn-edit-sketch').onclick = () => switchView('sketch');

    profile = solution.spec.profile;
    circleProfile = solution.spec.circle || null;
    profileClosed = true;
    holes = solution.spec.holes || [];
    pockets = solution.spec.pockets || [];
    $('model-height').value = solution.spec.depth;

    sketcher.loadProfile(profile);
    featureList();
    invalidate();
    updateTree();

    status('Biên dạng hợp lệ. Đang dựng khối 3D với OpenCascade WASM kernel…');
    if (solution.method === 'revolve') {
      await revolveSolid();
    } else {
      $('confirm-geometry').checked = true;
      await $('build-solid').onclick();
    }

    status('✓ Dựng 3D thành công bằng Hybrid AI! Mô hình đã sẵn sàng trong 3D Viewport.');
  } catch (err) {
    console.error(err);
    aiPanel.innerHTML = `
      <div class="dock-title">🧠 Hybrid AI · Thông báo</div>
      <p style="color:#ff6b6b;font-size:12px;">${err.message}</p>
      <button id="btn-retry-solve" class="button">Thử lại</button>
    `;
    $('btn-retry-solve').onclick = () => runHybridReconstruction();
    status('Lỗi suy luận hình học: ' + err.message);
  }
}

export function runAnalyzeCurrentCrop() {
  const cr = active();
  if (!cr) return status('Hãy chọn một vùng Crop hình chiếu để phân tích.');
  status(`Đang phân tích chi tiết hình học Crop #${cr.id} (${cr.face || 'Auto'})…`);
  const feat = extractViewFeatures(cr);

  $('analysis').textContent = `Crop #${cr.id} (${cr.face || 'Auto'}):\n` +
    `- Tìm thấy ${feat.outlines.length} đường bao đa giác kín (chu vi ngoài: ${feat.primaryOutline?.points.length || 0} đỉnh).\n` +
    `- Tìm thấy ${feat.circles.length} đường tròn/lỗ: ${feat.circles.map(c => `Ø${c.diameter.toFixed(1)}`).join(', ') || 'Không có'}.\n` +
    `- Kích thước bao: ${feat.bounds.width.toFixed(2)} × ${feat.bounds.height.toFixed(2)} mm.`;

  const candHost = $('ocr-candidates');
  candHost.replaceChildren();
  feat.outlines.forEach((o, i) => {
    const btn = document.createElement('button');
    btn.className = 'button';
    btn.style.margin = '2px';
    btn.textContent = `Nạp biên dạng ${i + 1} (${o.points.length} đỉnh)`;
    btn.onclick = () => {
      profile = o.points;
      profileClosed = true;
      sketcher.loadProfile(profile);
      invalidate();
      status(`Đã nạp biên dạng ${i + 1} vào 2D Sketcher.`);
    };
    candHost.append(btn);
  });

  feat.circles.forEach((c) => {
    const btn = document.createElement('button');
    btn.className = 'button';
    btn.style.margin = '2px';
    btn.textContent = `Thêm lỗ Ø${c.diameter.toFixed(1)}`;
    btn.onclick = () => {
      holes.push({ axis: 'Z', x: c.x, y: c.y, z: 0, radius: c.radius });
      featureList();
      invalidate();
      status(`Đã thêm lỗ Ø${c.diameter.toFixed(1)} tại (${c.x.toFixed(1)}, ${c.y.toFixed(1)}).`);
    };
    candHost.append(btn);
  });

  document.querySelector('.cad-docks').classList.add('show-tasks');
}

export async function runOcrDimensions() {
  const cr = active();
  if (!cr) return status('Chọn một vùng Crop để đọc kích thước.');
  status('Đang chạy OCR nhận diện số đo kích thước trên thiết bị…');
  try {
    const ocr = new OcrClient();
    const result = await ocr.extract(cr.canvas);
    status(`Đã đọc ${result.items?.length || 0} thông số kích thước từ bản vẽ.`);
    $('analysis').textContent += `\n\nKích thước phát hiện qua OCR:\n` +
      (result.items || []).map(it => `${it.text} (tin cậy: ${(it.confidence * 100).toFixed(0)}%)`).join(', ');
  } catch (e) {
    status('Lỗi OCR: ' + e.message);
  }
}

if ($('analyze')) $('analyze').onclick = runAnalyzeCurrentCrop;
if ($('ocr-dimensions')) $('ocr-dimensions').onclick = runOcrDimensions;


// Keyboard Shortcuts
document.addEventListener('keydown', e => {
  if (e.target.closest('input,select,textarea')) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(key)) {
    e.preventDefault();
    document.dispatchEvent(new CustomEvent('cad-command', { detail: key === 'y' || e.shiftKey ? 'redo' : 'undo' }));
  } else if (key === 'l') {
    document.dispatchEvent(new CustomEvent('cad-command', { detail: 'line' }));
  } else if (key === 'r') {
    document.dispatchEvent(new CustomEvent('cad-command', { detail: 'rectangle' }));
  } else if (key === 'c') {
    document.dispatchEvent(new CustomEvent('cad-command', { detail: 'circle' }));
  } else if (key === 'a') {
    document.dispatchEvent(new CustomEvent('cad-command', { detail: 'arc' }));
  } else if (key === 's') {
    document.dispatchEvent(new CustomEvent('cad-command', { detail: 'slot' }));
  } else if (key === 'p' && !e.ctrlKey) {
    document.dispatchEvent(new CustomEvent('cad-command', { detail: 'polygon' }));
  } else if (key === 'g') {
    document.dispatchEvent(new CustomEvent('cad-command', { detail: 'construction' }));
  } else if (e.key === 'F5') {
    e.preventDefault();
    document.dispatchEvent(new CustomEvent('cad-command', { detail: 'recompute' }));
  } else if (e.key === ' ') {
    e.preventDefault();
    const cur = document.querySelector('.cad-stage').dataset.mode;
    switchView(cur === 'model' ? 'sketch' : 'model');
  } else if (e.key === 'Escape') {
    sketcher.finishCurrent();
    setSketchTool('polyline');
  }
});

function featureDialog(kind) {
  const dialog = document.createElement('dialog');
  dialog.className = 'feature-dialog';
  const form = document.createElement('form');
  const title = document.createElement('h3');
  title.textContent = kind === 'hole' ? 'Parametric Hole' : 'Rectangular Pocket';
  form.append(title);
  const defs = kind === 'hole'
    ? [['axis', 'Axis', 'Z'], ['diameter', 'Diameter (mm)', 8], ['x', 'Center X (mm)', 0], ['y', 'Center Y (mm)', 0], ['z', 'Center Z (mm)', 0]]
    : [['x', 'Origin X (mm)', 0], ['y', 'Origin Y (mm)', 0], ['z', 'Origin Z (mm)', Number($('model-height').value) - 5], ['w', 'Width X (mm)', 10], ['d', 'Depth Y (mm)', 10], ['h', 'Cut height Z (mm)', 5]];
  for (const [key, text, value] of defs) {
    const label = document.createElement('label');
    label.textContent = text;
    const input = key === 'axis' ? document.createElement('select') : document.createElement('input');
    input.name = key;
    if (key === 'axis') {
      for (const axis of ['X', 'Y', 'Z']) input.append(new Option(axis, axis));
    } else {
      input.type = 'number';
      input.step = 'any';
      input.required = true;
    }
    input.value = value;
    label.append(input);
    form.append(label);
  }
  const buttons = document.createElement('div'), cancel = document.createElement('button'), apply = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => dialog.close();
  apply.type = 'submit';
  apply.textContent = 'Apply Feature';
  buttons.append(cancel, apply);
  form.append(buttons);
  form.onsubmit = e => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const nums = Object.keys(values).filter(k => k !== 'axis');
    if (nums.some(k => !Number.isFinite(Number(values[k])))) return;
    if (kind === 'hole') {
      if (Number(values.diameter) <= 0) return;
      holes.push({ axis: values.axis, x: Number(values.x), y: Number(values.y), z: Number(values.z), radius: Number(values.diameter) / 2 });
    } else {
      if (['w', 'd', 'h'].some(k => Number(values[k]) <= 0)) return;
      pockets.push({ origin: ['x', 'y', 'z'].map(k => Number(values[k])), size: ['w', 'd', 'h'].map(k => Number(values[k])) });
    }
    featureList();
    invalidate();
    dialog.close();
    status('Feature added. Pad / Recompute to update solid.');
    $('build-solid').click();
  };
  dialog.append(form);
  document.body.append(dialog);
  dialog.onclose = () => dialog.remove();
  dialog.showModal();
}

// Gemini AI crop-to-3D API temporarily disabled per user request
// (To re-enable: uncomment mountGeminiPanel, validateProposal, and button below)
/*
const extGroup = document.createElement('div');
extGroup.className = 'tool-group';
const btnGemini = document.createElement('button');
btnGemini.className = 'ai-toolbar-button';
btnGemini.title = 'AI Assistance with Gemini';
btnGemini.textContent = 'Gemini AI';
btnGemini.onclick = () => {
  document.querySelector('.cad-docks').classList.toggle('show-tasks');
  document.querySelector('.tasks-dock').scrollTop = 0;
};
extGroup.append(btnGemini);
document.querySelector('.cad-toolbar').append(extGroup);

const panel = mountGeminiPanel({
  getCrops: () => crops,
  setView: (id, face) => {
    const c = crops.find(c => c.id === id);
    if (c) c.face = face;
    list();
    syncFields();
  },
  setInclude: (id, value) => {
    const c = crops.find(c => c.id === id);
    if (c) c.aiInclude = value;
  },
  apply: applyGeminiProposal
});

export async function applyGeminiProposal(input) {
  if (kernelBusy) throw Error('CAD kernel đang bận. Thử lại sau.');
  const result = validateProposal(input);
  lastAIProposal = result;
  aiProposalMode = true;
  standalone = false;
  profile = result.spec.profile;
  circleProfile = result.spec.circle || null;
  profileClosed = true;
  holes = result.spec.holes;
  pockets = result.spec.pockets;
  $('model-height').value = result.spec.depth;
  $('edge-treatment').value = result.spec.fillet ? 'fillet' : result.spec.chamfer ? 'chamfer' : 'none';
  $('edge-size').value = result.spec.fillet || result.spec.chamfer || .5;
  for (const a of result.view_assignments) {
    const c = crops.find(c => c.id === a.crop_id);
    if (c && !c.face && a.view !== 'Unknown') c.face = a.view;
  }
  featureList();
  list();
  invalidate();
  $('confirm-geometry').checked = true;
  await $('build-solid').onclick();
  if (!built) throw Error($('cad-status').textContent);
  $('model-metrics').textContent = (result.assumptions.length || result.missing_views.length ? 'AI proposal · includes inferred geometry\n' : 'AI proposal\n') + $('model-metrics').textContent;
  status('Gemini proposal built. Review inferred features and dimensions before export.');
  return { built: true };
}
*/

const localFreecad = mountLocalFreecad({
  viewer,
  switchView,
  updateTree,
  getSketch: () => ({ profile: structuredClone(profile), circle: circleProfile ? structuredClone(circleProfile) : null, closed: profileClosed })
});

export const aiChat = mountAiChat($('ai-chat-container'), {
  freecad: localFreecad,
  viewer,
  sketcher,
  switchView,
  buildSolid: () => $('build-solid').onclick(),
  revolveSolid: () => revolveSolid(),
  getCrops: () => crops,
  updateTree,
  setProfile: (newProfile, circle, newHoles, newPockets, depth) => {
    profile = newProfile;
    circleProfile = circle;
    profileClosed = true;
    holes = newHoles;
    pockets = newPockets;
    if (depth) $('model-height').value = depth;
    sketcher.loadProfile(profile);
    featureList();
    invalidate();
    updateTree();
  }
});

// Auto-start blank FreeCAD sketch so user can immediately draw
newSketch();

mountCodeLayout();

mountCadSuite({showMesh:(mesh,engine)=>{document.querySelector('.browser-code-result').hidden=true;viewer.show(mesh);switchView('model');document.getElementById('doc-tab-label').textContent=engine+' · preview mm';}});

mountPromptTemplate();

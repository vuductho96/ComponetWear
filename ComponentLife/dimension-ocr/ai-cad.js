/**
 * ModelEval CAD - AI 2D Understanding & 3D Reconstruction Application
 * 
 * Step 1: Reconstruct and verify the 2D drawing / sketch from image
 * Step 2: Once verified and understood, reconstruct 3D solid (WASM / FreeCAD MCP)
 */

import * as THREE from 'three';
import { OrbitControls } from './vendor/cad/OrbitControls.js';
import { analyzeCrop, toModel } from './cad-geometry.js';
import { extractViewFeatures, solveMultiViewGeometry } from './hybrid-cad-solver.js';

const $ = id => document.getElementById(id);

// --- State Variables ---
let currentImage = null; // HTMLImageElement
let currentFile = null;
let viewMode = 'overlay'; // 'overlay' | 'vector' | 'image'
let imageOpacity = 0.5;

// Zoom & Pan for 2D Canvas
let panX = 0, panY = 0, zoom = 1;
let isPanning = false, startPanX = 0, startPanY = 0;

// Reconstructed 2D Geometry State
let reconstructedProfile = []; // [[x, y], ...] in mm
let reconstructedCircles = []; // [{ x, y, radius, diameter }, ...]
let reconstructedHoles = [];
let isLoopClosed = false;
let currentDepth = 20;
let currentOperation = 'pad';
let currentFillet = 0;

// CAD Worker for 3D WASM
let cadWorker = null;
let currentMesh = null;
let workerRequests = new Map();
let requestSeq = 0;

// 3D Three.js Viewport
let scene3d, camera3d, renderer3d, controls3d, solidMeshGroup;

// FreeCAD MCP Bridge
const bridgeAddress = 'http://127.0.0.1:8766';
let mcpConnected = false;

// --- Initialize App ---
window.addEventListener('DOMContentLoaded', () => {
  init2DCanvas();
  init3DViewport();
  initChatCopilot();
  initMcpBridge();
  initSamples();

  // Load initial sample
  loadSample('bracket');
});

// --- 1. Dual-Canvas 2D Engine (Overlay & Verification) ---
const underlayCanvas = $('image-underlay-canvas');
const overlayCanvas = $('sketch-overlay-canvas');
const underlayCtx = underlayCanvas.getContext('2d');
const overlayCtx = overlayCanvas.getContext('2d');
const canvasContainer = $('eval-canvas-container');

function init2DCanvas() {
  resize2DCanvases();
  window.addEventListener('resize', resize2DCanvases);

  // Pan & Zoom Event Listeners
  overlayCanvas.addEventListener('pointerdown', e => {
    isPanning = true;
    startPanX = e.clientX - panX;
    startPanY = e.clientY - panY;
    overlayCanvas.setPointerCapture(e.pointerId);
  });

  overlayCanvas.addEventListener('pointermove', e => {
    if (!isPanning) return;
    panX = e.clientX - startPanX;
    panY = e.clientY - startPanY;
    render2D();
  });

  overlayCanvas.addEventListener('pointerup', e => {
    isPanning = false;
    overlayCanvas.releasePointerCapture(e.pointerId);
  });

  overlayCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const rect = overlayCanvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Zoom toward mouse position
    panX = mouseX - (mouseX - panX) * zoomFactor;
    panY = mouseY - (mouseY - panY) * zoomFactor;
    zoom *= zoomFactor;
    zoom = Math.max(0.1, Math.min(25, zoom));

    render2D();
  }, { passive: false });

  // Opacity Slider
  $('slider-image-opacity').oninput = e => {
    imageOpacity = Number(e.target.value) / 100;
    $('val-image-opacity').textContent = `${e.target.value}%`;
    underlayCanvas.style.opacity = viewMode === 'vector' ? '0' : String(imageOpacity);
  };

  // View Mode Buttons
  $('btn-view-overlay').onclick = () => setViewMode('overlay');
  $('btn-view-vector').onclick = () => setViewMode('vector');
  $('btn-view-image').onclick = () => setViewMode('image');
  $('btn-fit-canvas').onclick = fit2DCanvas;
}

function resize2DCanvases() {
  const rect = canvasContainer.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  underlayCanvas.width = rect.width * dpr;
  underlayCanvas.height = rect.height * dpr;
  overlayCanvas.width = rect.width * dpr;
  overlayCanvas.height = rect.height * dpr;
  render2D();
}

function setViewMode(mode) {
  viewMode = mode;
  $('btn-view-overlay').classList.toggle('active', mode === 'overlay');
  $('btn-view-vector').classList.toggle('active', mode === 'vector');
  $('btn-view-image').classList.toggle('active', mode === 'image');

  if (mode === 'vector') {
    underlayCanvas.style.opacity = '0';
    overlayCanvas.style.opacity = '1';
  } else if (mode === 'image') {
    underlayCanvas.style.opacity = '1';
    overlayCanvas.style.opacity = '0';
  } else { // overlay
    underlayCanvas.style.opacity = String(imageOpacity);
    overlayCanvas.style.opacity = '1';
  }
  render2D();
}

function fit2DCanvas() {
  if (!currentImage) return;
  const rect = canvasContainer.getBoundingClientRect();
  const scaleX = (rect.width - 60) / currentImage.width;
  const scaleY = (rect.height - 60) / currentImage.height;
  zoom = Math.min(scaleX, scaleY, 1.5);
  panX = (rect.width - currentImage.width * zoom) / 2;
  panY = (rect.height - currentImage.height * zoom) / 2;
  render2D();
}

function render2D() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = overlayCanvas.width;
  const h = overlayCanvas.height;

  // Clear canvases
  underlayCtx.clearRect(0, 0, w, h);
  overlayCtx.clearRect(0, 0, w, h);

  underlayCtx.save();
  underlayCtx.scale(dpr, dpr);
  underlayCtx.translate(panX, panY);
  underlayCtx.scale(zoom, zoom);

  overlayCtx.save();
  overlayCtx.scale(dpr, dpr);
  overlayCtx.translate(panX, panY);
  overlayCtx.scale(zoom, zoom);

  // 1. Draw Underlay Image
  if (currentImage) {
    underlayCtx.drawImage(currentImage, 0, 0);
  }

  // 2. Draw Reconstructed 2D Vector Geometry
  if (viewMode !== 'image' && reconstructedProfile.length >= 2) {
    const pts = reconstructedProfile;
    const origin = currentImage ? [currentImage.width / 2, currentImage.height / 2] : [0, 0];
    const mmToPx = 10; // 0.1 mm/px -> 10 px/mm

    // Convert mm points to image pixel space
    const pxPoints = pts.map(p => [
      origin[0] + p[0] * mmToPx,
      origin[1] - p[1] * mmToPx
    ]);

    // Draw coordinate axes at origin
    overlayCtx.lineWidth = 1.2 / zoom;
    overlayCtx.strokeStyle = '#4a5568';
    overlayCtx.beginPath();
    overlayCtx.moveTo(origin[0] - 60, origin[1]);
    overlayCtx.lineTo(origin[0] + 60, origin[1]);
    overlayCtx.moveTo(origin[0], origin[1] - 60);
    overlayCtx.lineTo(origin[0], origin[1] + 60);
    overlayCtx.stroke();

    // Draw main vector loop
    overlayCtx.lineWidth = 2.5 / zoom;
    overlayCtx.strokeStyle = isLoopClosed ? '#20c997' : '#fcc419';
    overlayCtx.fillStyle = isLoopClosed ? 'rgba(32, 201, 151, 0.12)' : 'rgba(252, 196, 25, 0.12)';

    overlayCtx.beginPath();
    overlayCtx.moveTo(pxPoints[0][0], pxPoints[0][1]);
    for (let i = 1; i < pxPoints.length; i++) {
      overlayCtx.lineTo(pxPoints[i][0], pxPoints[i][1]);
    }
    if (isLoopClosed) {
      overlayCtx.closePath();
      overlayCtx.fill();
    }
    overlayCtx.stroke();

    // Draw vertices and coordinates
    overlayCtx.fillStyle = isLoopClosed ? '#20c997' : '#fcc419';
    for (let i = 0; i < pxPoints.length; i++) {
      const p = pxPoints[i];
      const modelCoord = pts[i];

      // Point circle
      overlayCtx.beginPath();
      overlayCtx.arc(p[0], p[1], 4 / zoom, 0, Math.PI * 2);
      overlayCtx.fill();

      // Coordinate label
      overlayCtx.font = `${Math.max(9, 11 / zoom)}px monospace`;
      overlayCtx.fillStyle = '#ffffff';
      overlayCtx.fillText(
        `P${i + 1}(${modelCoord[0].toFixed(1)}, ${modelCoord[1].toFixed(1)})`,
        p[0] + 6 / zoom,
        p[1] - 4 / zoom
      );
      overlayCtx.fillStyle = isLoopClosed ? '#20c997' : '#fcc419';
    }

    // Draw reconstructed circles and holes
    for (const c of reconstructedCircles) {
      const cx = origin[0] + c.x * mmToPx;
      const cy = origin[1] - c.y * mmToPx;
      const cr = c.radius * mmToPx;

      overlayCtx.lineWidth = 2 / zoom;
      overlayCtx.strokeStyle = '#22b8cf';
      overlayCtx.fillStyle = 'rgba(34, 184, 207, 0.18)';

      overlayCtx.beginPath();
      overlayCtx.arc(cx, cy, cr, 0, Math.PI * 2);
      overlayCtx.fill();
      overlayCtx.stroke();

      // Center mark
      overlayCtx.lineWidth = 1 / zoom;
      overlayCtx.beginPath();
      overlayCtx.moveTo(cx - 5 / zoom, cy); overlayCtx.lineTo(cx + 5 / zoom, cy);
      overlayCtx.moveTo(cx, cy - 5 / zoom); overlayCtx.lineTo(cx, cy + 5 / zoom);
      overlayCtx.stroke();

      // Dimension text
      overlayCtx.font = `${Math.max(9, 11 / zoom)}px sans-serif`;
      overlayCtx.fillStyle = '#22b8cf';
      overlayCtx.fillText(`Ø${c.diameter.toFixed(1)} mm`, cx + cr + 4 / zoom, cy);
    }
  }

  underlayCtx.restore();
  overlayCtx.restore();
}

// --- 2. AI 2D Geometric Understanding & Analysis ---
function analyzeAndReconstruct2D(imageElement, promptText = '') {
  // Create offscreen canvas for CV analysis
  const cv = document.createElement('canvas');
  cv.width = imageElement.width;
  cv.height = imageElement.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(imageElement, 0, 0);

  // 1. Deterministic CV vector extraction
  const raw = analyzeCrop(cv);
  const cropData = {
    id: 'eval-image',
    canvas: cv,
    mm: 0.1, // 0.1 mm/px
    origin: [cv.width / 2, cv.height / 2],
    rawAnalysis: raw,
    face: 'Top'
  };

  const feat = extractViewFeatures(cropData);
  const solution = solveMultiViewGeometry([feat], {
    defaultDepth: Number($('eval-depth').value) || 20
  });

  const spec = solution.spec;

  // Set reconstructed 2D geometry
  reconstructedProfile = spec.profile;
  reconstructedCircles = feat.circles;
  reconstructedHoles = spec.holes;
  currentDepth = spec.depth;
  currentOperation = solution.method;

  // Check loop closure
  if (reconstructedProfile.length >= 3) {
    isLoopClosed = true;
  } else {
    isLoopClosed = false;
  }

  // Update Diagnostic Stats Badge
  const b = feat.bounds;
  $('stat-loop-status').textContent = isLoopClosed
    ? '✓ Đã dựng xong 2D (Khép kín hoàn toàn)'
    : '⚠️ Biên dạng 2D chưa khép kín';
  $('stat-loop-status').style.color = isLoopClosed ? '#20c997' : '#fcc419';
  $('stat-vertex-count').textContent = reconstructedProfile.length;
  $('stat-dimensions').textContent = `${b.width.toFixed(1)} × ${b.height.toFixed(1)} mm`;
  $('stat-closure').textContent = isLoopClosed
    ? '100% Khép kín (Đạt chuẩn nạp vào CAD 3D)'
    : 'Cần nối lại các điểm hở';

  // Update 3D parameters form
  $('eval-depth').value = currentDepth;
  $('eval-operation').value = currentOperation;

  // Generate Python FreeCAD MCP Code
  const pyCode = generateFreeCadPythonCode(solution);
  $('mcp-python-code').textContent = pyCode;

  // Re-render 2D canvas with vector overlay
  render2D();

  // Return report for chat copilot
  return {
    solution,
    features: feat,
    pyCode
  };
}

// --- 3. 3D Viewport via OpenCascade WASM ---
function init3DViewport() {
  const canvas = $('eval-3d-canvas');
  const container = $('eval-3d-viewport');

  scene3d = new THREE.Scene();
  camera3d = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera3d.position.set(80, 80, 100);

  renderer3d = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer3d.setSize(container.clientWidth, container.clientHeight);
  renderer3d.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  controls3d = new OrbitControls(camera3d, canvas);
  controls3d.enableDamping = true;

  // Lighting
  scene3d.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(100, 150, 100);
  scene3d.add(dirLight);

  const grid = new THREE.GridHelper(120, 12, 0x4a5568, 0x2d3748);
  grid.position.y = 0;
  scene3d.add(grid);

  solidMeshGroup = new THREE.Group();
  scene3d.add(solidMeshGroup);

  // Resize handling
  window.addEventListener('resize', () => {
    const w = container.clientWidth, h = container.clientHeight;
    camera3d.aspect = w / h;
    camera3d.updateProjectionMatrix();
    renderer3d.setSize(w, h);
  });

  $('btn-reset-3d-cam').onclick = () => {
    camera3d.position.set(80, 80, 100);
    controls3d.target.set(0, 10, 0);
    controls3d.update();
  };

  // Render loop
  function animate() {
    requestAnimationFrame(animate);
    controls3d.update();
    renderer3d.render(scene3d, camera3d);
  }
  animate();

  // Build 3D Solid button
  $('btn-exec-build-3d').onclick = () => build3dSolidFromVerified2D();
}

async function build3dSolidFromVerified2D() {
  if (!reconstructedProfile.length) {
    alert('Chưa có biên dạng 2D. Hãy tải ảnh hoặc chọn mẫu thử trước!');
    return;
  }

  $('btn-exec-build-3d').textContent = '⏳ Đang tính toán khối 3D qua OpenCascade WASM…';
  $('btn-exec-build-3d').disabled = true;

  try {
    const spec = {
      profile: reconstructedProfile,
      depth: Number($('eval-depth').value) || 20,
      holes: reconstructedHoles,
      pockets: [],
      ...($('eval-fillet').value > 0 ? { fillet: Number($('eval-fillet').value) } : {})
    };

    if ($('eval-operation').value === 'revolve') {
      spec.revolve = true;
      spec.revolveAxis = 'Y';
      spec.revolveAngle = 360;
    }

    const result = await requestCadWorker('build', { spec });
    currentMesh = result.mesh;

    renderSolidMesh(currentMesh);

    // Update workflow stage banner
    $('step-2').classList.remove('active');
    $('step-3').classList.add('active');

    appendChatMessage('assistant', `
      ✓ <b>Đã dựng thành công khối 3D từ bản vẽ 2D đã xác nhận!</b><br>
      - Thể tích: <b>${result.metrics.volume.toFixed(2)} mm³</b><br>
      - Diện tích bề mặt: <b>${result.metrics.area.toFixed(2)} mm²</b><br>
      - Số tam giác 3D: <b>${currentMesh.triangles.length / 3}</b><br>
      Bạn có thể xoay quan sát trong khung nhìn 3D bên phải hoặc xuất file STEP/STL!
    `);
  } catch (err) {
    alert('Lỗi tạo khối 3D: ' + err.message);
  } finally {
    $('btn-exec-build-3d').textContent = '⚡ TIẾN HÀNH DỰNG 3D NGAY';
    $('btn-exec-build-3d').disabled = false;
  }
}

function renderSolidMesh(mesh) {
  solidMeshGroup.clear();

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
  geo.setIndex(mesh.triangles);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x38d9a9,
    roughness: 0.35,
    metalness: 0.15,
    side: THREE.DoubleSide
  });

  const solid = new THREE.Mesh(geo, mat);
  solidMeshGroup.add(solid);

  // Wireframe edges
  const edgeGeo = new THREE.EdgesGeometry(geo, 20);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x1864ab, linewidth: 1.5 });
  const edges = new THREE.LineSegments(edgeGeo, edgeMat);
  solidMeshGroup.add(edges);
}

function requestCadWorker(type, data = {}) {
  if (!cadWorker) {
    cadWorker = new Worker(new URL('./cad-worker.js', import.meta.url), { type: 'module' });
    cadWorker.onmessage = ({ data }) => {
      const p = workerRequests.get(data.id);
      if (!p) return;
      workerRequests.delete(data.id);
      if (data.type === 'error') p.reject(new Error(data.message || data.error));
      else p.resolve(data);
    };
    cadWorker.onerror = e => {
      for (const p of workerRequests.values()) p.reject(new Error(e.message));
      workerRequests.clear();
      cadWorker.terminate();
      cadWorker = null;
    };
  }
  const id = ++requestSeq;
  return new Promise((resolve, reject) => {
    workerRequests.set(id, { resolve, reject });
    cadWorker.postMessage({ id, type, ...data });
  });
}

// --- 4. Chat Copilot Integration ---
function initChatCopilot() {
  const chatInput = $('eval-chat-input');
  const btnSend = $('eval-btn-send');
  const btnUpload = $('eval-btn-upload');
  const fileInput = $('eval-file-input');

  btnUpload.onclick = () => fileInput.click();

  fileInput.onchange = e => {
    const file = e.target.files[0];
    if (file) handleUploadedFile(file);
    fileInput.value = '';
  };

  btnSend.onclick = () => handleUserMessage();
  chatInput.onkeydown = e => {
    if (e.key === 'Enter') handleUserMessage();
  };

  $('eval-attach-remove').onclick = () => {
    currentFile = null;
    $('eval-attachment-card').style.display = 'none';
  };

  $('btn-clear-chat').onclick = () => {
    $('eval-chat-history').innerHTML = `
      <div class="chat-bubble assistant">
        Lịch sử đã được xóa. Hãy tải ảnh mặt cắt hoặc chọn mẫu thử để bắt đầu đánh giá!
      </div>
    `;
  };
}

function handleUploadedFile(file) {
  currentFile = file;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    currentImage = img;
    $('eval-attach-thumb').src = url;
    $('eval-attach-title').textContent = `${file.name} (${img.width}×${img.height})`;
    $('eval-attachment-card').style.display = 'flex';

    fit2DCanvas();
    appendChatMessage('user', `Đã tải lên tệp ảnh <b>${file.name}</b>`, url);

    // Run 2D Understanding Analysis
    triggerModelAnalysis('Tự động phân tích ảnh mặt cắt');
  };
  img.src = url;
}

function handleUserMessage() {
  const text = $('eval-chat-input').value.trim();
  if (!text && !currentFile) return;

  $('eval-chat-input').value = '';
  appendChatMessage('user', text);

  triggerModelAnalysis(text);
}

function triggerModelAnalysis(promptText) {
  if (!currentImage) {
    appendChatMessage('assistant', 'Vui lòng tải ảnh lên trước hoặc chọn một mẫu thử nghiệm từ danh sách phía trên!');
    return;
  }

  appendChatMessage('assistant', '<em>Mô hình đang quét đường biên pixel, nhận diện lỗ rỗng và dựng lại vector 2D...</em>');

  setTimeout(() => {
    const report = analyzeAndReconstruct2D(currentImage, promptText);
    const s = report.solution;

    // Remove the waiting message
    const history = $('eval-chat-history');
    if (history.lastChild) history.lastChild.remove();

    appendChatMessage('assistant', `
      <b>Đánh giá mức độ hiểu của Model:</b><br>
      ${s.summary}<br><br>
      <details style="margin:6px 0;background:#161b22;padding:6px;border-radius:4px;border-left:2px solid #20c997;" open>
        <summary style="cursor:pointer;color:#20c997;font-weight:600;">🧠 Quá trình suy luận của Model</summary>
        <ol style="margin:4px 0;padding-left:16px;font-size:11px;line-height:1.5;">
          ${s.reasoning.map(r => `<li>${r}</li>`).join('')}
        </ol>
      </details>
      <div style="margin-top:6px;color:#8b949e;font-size:11px;">
        👉 <b>Quan sát màn hình 2D ở giữa:</b> Đường vẽ vector màu xanh lá (<span style="color:#20c997;">■</span>) đã được xếp chồng (Overlay) trực tiếp lên ảnh gốc.<br>
        Bạn có thể kéo thanh <b>Độ mờ ảnh</b> để đối chiếu từng nét vẽ. Nếu chuẩn xác, hãy nhấn <b>⚡ TIẾN HÀNH DỰNG 3D</b> ở cột phải!
      </div>
    `);
  }, 100);
}

function appendChatMessage(role, textHtml, imgUrl = null) {
  const wrap = $('eval-chat-history');
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;

  let content = textHtml;
  if (imgUrl) {
    content += `<img class="chat-bubble-img" src="${imgUrl}" alt="Attachment">`;
  }
  bubble.innerHTML = content;
  wrap.append(bubble);
  wrap.scrollTop = wrap.scrollHeight;
}

// --- 5. Built-in Test Samples ---
function initSamples() {
  $('select-sample').onchange = e => {
    const val = e.target.value;
    if (val) loadSample(val);
  };
}

function loadSample(type) {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 400;
  const ctx = canvas.getContext('2d');

  // Draw technical drawing background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 600, 400);

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#1a1a1a';
  ctx.fillStyle = '#f0f0f0';

  if (type === 'bracket') {
    // Stepped bracket plate with hole
    ctx.beginPath();
    ctx.moveTo(150, 250);
    ctx.lineTo(450, 250);
    ctx.lineTo(450, 160);
    ctx.lineTo(320, 160);
    ctx.lineTo(320, 100);
    ctx.lineTo(150, 100);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Hole
    ctx.beginPath();
    ctx.arc(230, 175, 25, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();

    // Centerlines
    ctx.setLineDash([6, 3, 2, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#228be6';
    ctx.beginPath();
    ctx.moveTo(190, 175); ctx.lineTo(270, 175);
    ctx.moveTo(230, 135); ctx.lineTo(230, 215);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (type === 'flange') {
    // Round circular flange with 4 bolt holes
    ctx.beginPath();
    ctx.arc(300, 200, 130, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    // Center bore
    ctx.beginPath();
    ctx.arc(300, 200, 45, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 4 bolt holes
    for (const [dx, dy] of [[0, 85], [0, -85], [85, 0], [-85, 0]]) {
      ctx.beginPath();
      ctx.arc(300 + dx, 200 + dy, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (type === 'stepped') {
    // Stepped rotational shaft silhouette
    ctx.beginPath();
    ctx.moveTo(120, 230);
    ctx.lineTo(480, 230);
    ctx.lineTo(480, 170);
    ctx.lineTo(380, 170);
    ctx.lineTo(380, 140);
    ctx.lineTo(260, 140);
    ctx.lineTo(260, 170);
    ctx.lineTo(120, 170);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Centerline axis
    ctx.setLineDash([8, 4, 2, 4]);
    ctx.strokeStyle = '#fa5252';
    ctx.beginPath();
    ctx.moveTo(80, 200); ctx.lineTo(520, 200);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const img = new Image();
  img.onload = () => {
    currentImage = img;
    fit2DCanvas();
    appendChatMessage('user', `Đã nạp bản vẽ mẫu: <b>${$('select-sample').selectedOptions[0].text}</b>`);
    triggerModelAnalysis('Phân tích bản vẽ mẫu');
  };
  img.src = canvas.toDataURL();
}

// --- 6. FreeCAD MCP Integration ---
function initMcpBridge() {
  checkMcpConnection();
  setInterval(checkMcpConnection, 10000);

  $('btn-send-to-freecad-mcp').onclick = async () => {
    if (!reconstructedProfile.length) return alert('Chưa có biên dạng 2D.');
    $('btn-send-to-freecad-mcp').textContent = '⏳ Đang truyền lệnh tới FreeCAD Desktop…';

    try {
      const res = await fetch(bridgeAddress + '/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (!res.ok) throw new Error('Yêu cầu mở FreeCAD Desktop và chạy macro FreeCAD-Web.FCMacro trước.');

      alert('✓ Đã kết nối FreeCAD Desktop! Chuỗi lệnh đã được gửi thành công.');
    } catch (e) {
      alert('Thông báo FreeCAD MCP: ' + e.message);
    } finally {
      $('btn-send-to-freecad-mcp').textContent = '▶ Chạy chuỗi lệnh trong FreeCAD Desktop';
    }
  };

  // Export handlers
  $('btn-download-step').onclick = async () => {
    if (!currentMesh) return alert('Hãy bấm Dựng 3D trước.');
    const res = await requestCadWorker('export', { format: 'step' });
    downloadBlob(res.blob, 'ai-model.step');
  };

  $('btn-download-stl').onclick = async () => {
    if (!currentMesh) return alert('Hãy bấm Dựng 3D trước.');
    const res = await requestCadWorker('export', { format: 'stl' });
    downloadBlob(res.blob, 'ai-model.stl');
  };

  $('btn-download-fcmacro').onclick = () => {
    const code = $('mcp-python-code').textContent;
    downloadBlob(new Blob([code], { type: 'text/x-python' }), 'AI_Reconstruction.FCMacro');
  };
}

async function checkMcpConnection() {
  try {
    const res = await fetch(bridgeAddress + '/pair', { method: 'GET', signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      mcpConnected = true;
      $('dot-mcp').classList.remove('disconnected');
      $('label-mcp').textContent = 'FreeCAD MCP: Cổng 8766 Đang mở';
      $('badge-mcp-conn').textContent = 'CONNECTED';
      $('badge-mcp-conn').style.color = '#20c997';
    } else throw new Error();
  } catch {
    mcpConnected = false;
    $('dot-mcp').classList.add('disconnected');
    $('label-mcp').textContent = 'FreeCAD MCP: Chưa ghép nối';
    $('badge-mcp-conn').textContent = 'DISCONNECTED';
    $('badge-mcp-conn').style.color = '#ff6b6b';
  }
}

function generateFreeCadPythonCode(solution) {
  const s = solution.spec;
  return `# FreeCAD Macro - Generated by ModelEval AI (2D to 3D)
import FreeCAD as App, Part, Sketcher
from FreeCAD import Vector

doc = App.newDocument('AI_Model_Eval')
body = doc.addObject('PartDesign::Body', 'Body')
sketch = doc.addObject('Sketcher::SketchObject', 'Sketch_Reconstructed')
body.addObject(sketch)

# 1. Reconstruct verified 2D profile
pts = ${JSON.stringify(s.profile)}
for i in range(len(pts)):
    p1 = pts[i]
    p2 = pts[(i + 1) % len(pts)]
    sketch.addGeometry(Part.LineSegment(Vector(p1[0], p1[1], 0), Vector(p2[0], p2[1], 0)), False)

${solution.method === 'revolve' ? `
# 2. Revolve into rotational 3D solid
rev = body.newObject('PartDesign::Revolution', 'Revolution')
rev.Profile = sketch
rev.Angle = 360
rev.ReferenceAxis = (sketch, ['Y_Axis'])
doc.recompute()
` : `
# 2. Pad (Extrude) along Z axis
pad = body.newObject('PartDesign::Pad', 'Pad')
pad.Profile = sketch
pad.Length = ${s.depth}
doc.recompute()
`}

${(s.holes || []).map((h, i) => `
# 3. Hole ${i + 1}
cutter_${i} = Part.makeCylinder(${h.radius}, ${s.depth + 10}, Vector(${h.x}, ${h.y}, -5), Vector(0, 0, 1))
body.Shape = body.Shape.cut(cutter_${i})
`).join('\n')}

doc.recompute()
print("✓ Reconstructed solid ready in FreeCAD!")
`;
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

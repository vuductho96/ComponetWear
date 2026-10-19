// FreeCAD Web Shell - Authentic FreeCAD layout with Sketcher & Part Design workbenches
const $ = id => document.getElementById(id);
const oldHeader = document.querySelector('header');
const oldMain = document.querySelector('main');
const inspector = document.querySelector('.inspector');
const sourcePane = document.querySelector('.drawing-pane');
const modelPane = document.querySelector('.model-pane');
const settings = document.querySelector('.model-settings');
const cube = $('cube-wrap');
const modelView = $('model-viewport');

const shell = document.createElement('div');
shell.id = 'cad-shell';
shell.innerHTML = `
<div class="cad-menubar">
  <div class="brand-title"><span class="fc-logo-icon">🪓</span> <strong>FreeCAD Web</strong></div>
  <button data-menu="file">File</button>
  <button data-menu="edit">Edit</button>
  <button data-menu="view">View</button>
  <button data-menu="sketch">Sketch</button>
  <button data-menu="part">Part Design</button>
  <button data-menu="ai">🧠 AI 2D→3D</button>
  <button data-menu="help">Help</button>
  <span class="document-title" id="fc-doc-name">Unnamed.FCStd</span>
  <span class="local-state" id="fc-local-status">● Web CAD Standalone</span>
</div>

<div class="cad-toolbar">
  <div class="tool-group" id="file-tools"></div>
  <div class="tool-group" id="ai-tools">
    <button data-command="hybrid-reconstruct" id="btn-hybrid-reconstruct" class="ai-toolbar-button" title="🧠 Hybrid AI: Suy luận và dựng 3D từ các mặt chiếu bản vẽ"><img src="vendor/cad/icons/cube.svg"><span style="color:#20c997;font-weight:600;margin-left:4px;">🧠 AI 2D→3D</span></button>
  </div>
  
  <div class="tool-group" id="history-group">
    <button data-command="undo" title="Undo (Ctrl+Z)" aria-label="Undo"><img src="vendor/cad/icons/arrow-back-up.svg"></button>
    <button data-command="redo" title="Redo (Ctrl+Y)" aria-label="Redo"><img src="vendor/cad/icons/arrow-forward-up.svg"></button>
  </div>

  <label class="workbench-label">Workbench 
    <select id="workbench">
      <option value="sketch">📐 Sketcher</option>
      <option value="model">🧊 Part Design</option>
    </select>
  </label>

  <div class="tool-group">
    <button data-command="fit" title="Fit all views (Ctrl+0)" aria-label="Fit all"><img src="vendor/cad/icons/focus-2.svg"></button>
    <button data-command="iso" title="Isometric 3D View" aria-label="Isometric view"><img src="vendor/cad/icons/cube.svg"></button>
  </div>

  <!-- Sketcher Workbench Toolbar Strip -->
  <div class="tool-group command-strip sketch-strip">
    <button data-command="new-sketch" title="New Sketch on XY Plane"><img src="vendor/cad/icons/file-plus.svg"><span>New Sketch</span></button>
    <button data-command="line" data-tool-btn="polyline" title="Polyline (L): Draw continuous lines"><img src="vendor/cad/icons/line.svg"><span>Line</span></button>
    <button data-command="rectangle" data-tool-btn="rectangle" title="Rectangle (R): 2-point box"><img src="vendor/cad/icons/rectangle.svg"><span>Rect</span></button>
    <button data-command="circle" data-tool-btn="circle" title="Circle (C): Center + radius"><img src="vendor/cad/icons/circle.svg"><span>Circle</span></button>
    <button data-command="arc" data-tool-btn="arc" title="3-Point Arc (A): Start, end, curvature"><img src="vendor/cad/icons/border-radius.svg"><span>Arc</span></button>
    <button data-command="slot" data-tool-btn="slot" title="Slot (S): Rounded elongated hole"><img src="vendor/cad/icons/capsule.svg"><span>Slot</span></button>
    <button data-command="polygon" data-tool-btn="polygon" title="Regular Polygon (P): Hexagon/Polygon"><img src="vendor/cad/icons/polygon.svg"><span>Polygon</span></button>
    <button data-command="construction" id="btn-construction" title="Toggle Construction Mode (G): Blue dashed lines"><img src="vendor/cad/icons/circle-half.svg"><span>Construct</span></button>
    <button data-command="grid-snap" id="btn-grid-snap" class="active" title="Toggle Grid Snap"><img src="vendor/cad/icons/grid-dots.svg"><span>Snap</span></button>
    <button data-command="finish" title="Close Sketch (Esc)" class="btn-finish-sketch"><img src="vendor/cad/icons/check.svg"><span>Close</span></button>
  </div>

  <!-- Part Design Workbench Toolbar Strip -->
  <div class="tool-group command-strip part-strip">
    <button data-command="pad" title="Pad (Extrude sketch into solid)"><img src="vendor/cad/icons/extrude.svg"><span>Pad</span></button>
    <button data-command="pocket" title="Pocket (Cut pocket into solid)"><img src="vendor/cad/icons/box-align-bottom.svg"><span>Pocket</span></button>
    <button data-command="revolve" title="Revolution (Revolve sketch around axis)"><img src="vendor/cad/icons/rotate-2.svg"><span>Revolve</span></button>
    <button data-command="hole" title="Hole (Add through or blind hole)"><img src="vendor/cad/icons/circle-dot.svg"><span>Hole</span></button>
    <button data-command="fillet" title="Fillet (Round 3D solid edges)"><img src="vendor/cad/icons/border-radius.svg"><span>Fillet</span></button>
    <button data-command="chamfer" title="Chamfer (Bevel 3D solid edges)"><img src="vendor/cad/icons/cut.svg"><span>Chamfer</span></button>
    <button data-command="recompute" title="Recompute Solid (F5)"><img src="vendor/cad/icons/refresh.svg"><span>Recompute</span></button>
  </div>
</div>

<div class="cad-docks">
  <!-- Left Dock: FreeCAD Combo View (Model Tree + Property Panel) -->
  <aside class="model-dock">
    <div class="dock-title">
      <span>Model</span>
      <button id="toggle-properties" title="Toggle property panel">Properties</button>
    </div>
    <div id="model-tree" role="tree"></div>
    <div class="property-panel">
      <div class="dock-title">Property View</div>
      <dl id="property-grid"></dl>
    </div>
    <details id="drawing-tools">
      <summary>2D Drawing Reference & Calibration</summary>
      <div id="reference-tools"></div>
    </details>
  </aside>

  <!-- Center Stage: 2D Sketcher & 3D Viewport Tabs -->
  <div class="cad-stage" data-mode="sketch">
    <div class="stage-tabs">
      <button id="view-sketch" class="active">📐 2D Sketcher</button>
      <button id="view-solid">🧊 3D Solid View</button>
      <span id="edit-state">Sketcher edit</span>
    </div>
    <div class="stage-content"></div>
    <div class="document-tabs">
      <span class="active" id="doc-tab-label">Unnamed.FCStd : 1</span>
      <span id="sketch-hint">Select a tool (Line, Rect, Circle, Arc) or draw directly on the XY grid.</span>
    </div>
  </div>

  <!-- Right Dock: FreeCAD Task Panel & AI Chat Assistant -->
  <aside class="tasks-dock">
    <div class="dock-title">
      <div class="dock-mode-tabs" style="display:flex;gap:4px;">
        <button id="tab-dock-chat" class="active" style="padding:3px 8px;font-size:11px;border-radius:4px;background:#20c997;color:#181d24;border:none;font-weight:600;cursor:pointer;">💬 AI Chat</button>
        <button id="tab-dock-tasks" style="padding:3px 8px;font-size:11px;border-radius:4px;background:#262d38;color:#adb5bd;border:none;cursor:pointer;">📋 Tasks & Solver</button>
      </div>
      <button id="tasks-close">Close Task</button>
    </div>
    <div id="ai-chat-container"></div>
    <div id="task-context" hidden>
      <div class="solver-badge" id="solver-badge">
        <span class="solver-dot"></span>
        <strong id="solver-title">Sketcher: Ready</strong>
      </div>
      <p id="solver-desc">Draw closed 2D geometry, then click Pad to create a 3D solid.</p>
    </div>
    <div id="tasks-content" hidden></div>
  </aside>
</div>

<div id="cad-menu" hidden></div>
`;

oldHeader.before(shell);
document.querySelector('.steps').hidden = true;
oldHeader.hidden = true;
oldMain.hidden = true;

const fileTools = shell.querySelector('#file-tools');
for (const id of ['cad-file', 'model-json']) {
  const label = $(id).closest('label');
  label.classList.add('compact-file');
  fileTools.append(label);
}
for (const id of ['demo', 'reset']) fileTools.append($(id));
$('demo').textContent = 'Sample';
$('reset').textContent = 'New Document';

const reference = $('reference-tools');
reference.append($('from-ocr'));
reference.append(inspector);
reference.prepend($('assign-mode').closest('label'));
inspector.querySelector('.pane-title').remove();
reference.prepend($('drawing-name'));
reference.append($('analyze'), $('ocr-dimensions'));

const stage = shell.querySelector('.stage-content');
stage.append(sourcePane, modelView, cube, $('view-shortcuts'));

const sketchDims = document.createElement('div');
sketchDims.className = 'sketch-dimensions';
sketchDims.innerHTML = `
<div class="dock-title">Parametric Dimensions</div>
<label>Width X (mm)<input id="sketch-width" type="number" min="0.001" step="any"></label>
<label>Height Y (mm)<input id="sketch-height" type="number" min="0.001" step="any"></label>
<label>Circle Ø (mm)<input id="sketch-diameter" type="number" min="0.001" step="any"></label>
<button id="apply-sketch-size">Apply Dimensions</button>
<label>Pocket depth (mm)<input id="pocket-depth" type="number" value="5" min="0.001" step="any"></label>
`;
$('tasks-content').append(sketchDims, settings);

const modelControls = modelPane.querySelector('.pane-title>div');
modelControls.className = 'viewport-actions';
stage.append(modelControls);
modelPane.remove();

const stageBar = sourcePane.querySelector('.pane-title');
stageBar.querySelector('strong')?.remove();
stageBar.classList.add('source-pagebar');
sourcePane.querySelector('.canvas-tools').classList.add('reference-canvas-tools');
$('source-empty').innerHTML = `
<h2>FreeCAD Web Workspace</h2>
<p>Create a sketch on XY plane, draw a closed profile, then Pad to generate a 3D solid.</p>
<button id="blank-start">New Sketch on XY Plane</button>
<p class="muted">Or open a 2D PDF / technical drawing blueprint to trace directly.</p>
`;

const dispatch = command => document.dispatchEvent(new CustomEvent('cad-command', { detail: command }));
shell.querySelectorAll('[data-command]').forEach(b => b.onclick = () => dispatch(b.dataset.command));
$('blank-start').onclick = () => dispatch('new-sketch');
$('view-sketch').onclick = () => dispatch('sketch-view');
$('view-solid').onclick = () => dispatch('model-view');

// Workbench switcher updates UI view & toolbars
$('workbench').onchange = () => {
  const wb = $('workbench').value;
  dispatch(wb === 'model' ? 'model-view' : 'sketch-view');
  shell.querySelectorAll('.sketch-strip').forEach(el => el.classList.toggle('hidden-strip', wb === 'model'));
};

$('tasks-close').onclick = () => dispatch('close-task');

$('tab-dock-chat').onclick = () => {
  $('tab-dock-chat').classList.add('active');
  $('tab-dock-chat').style.background = '#20c997';
  $('tab-dock-chat').style.color = '#181d24';
  $('tab-dock-tasks').classList.remove('active');
  $('tab-dock-tasks').style.background = '#262d38';
  $('tab-dock-tasks').style.color = '#adb5bd';
  $('ai-chat-container').hidden = false;
  $('task-context').hidden = true;
  $('tasks-content').hidden = true;
};
$('tab-dock-tasks').onclick = () => {
  $('tab-dock-tasks').classList.add('active');
  $('tab-dock-tasks').style.background = '#20c997';
  $('tab-dock-tasks').style.color = '#181d24';
  $('tab-dock-chat').classList.remove('active');
  $('tab-dock-chat').style.background = '#262d38';
  $('tab-dock-chat').style.color = '#adb5bd';
  $('ai-chat-container').hidden = true;
  $('task-context').hidden = false;
  $('tasks-content').hidden = false;
};

$('toggle-properties').onclick = () => {
  const panel = document.querySelector('.property-panel');
  panel.hidden = !panel.hidden;
};

// FreeCAD Menubar items
const menu = $('cad-menu');
const menus = {
  file: [
    ['New Sketch (XY Plane)', 'new-sketch'],
    ['Open Drawing Reference', 'open'],
    ['Export STEP Solid', 'export-step'],
    ['Export STL Mesh', 'export-stl'],
    ['Export FreeCAD Macro (.FCMacro)', 'export-macro'],
    ['Export Model JSON', 'export-source'],
    ['Clear Session', 'reset']
  ],
  edit: [
    ['Undo (Ctrl+Z)', 'undo'],
    ['Redo (Ctrl+Y)', 'redo'],
    ['Clear Sketch Geometry', 'clear-profile']
  ],
  view: [
    ['2D Sketcher View', 'sketch-view'],
    ['3D Solid View', 'model-view'],
    ['Fit All (Ctrl+0)', 'fit'],
    ['Isometric View', 'iso'],
    ['Toggle Wireframe Edges', 'toggle-wireframe']
  ],
  sketch: [
    ['New Sketch (XY)', 'new-sketch'],
    ['Polyline (L)', 'line'],
    ['Rectangle (R)', 'rectangle'],
    ['Circle (C)', 'circle'],
    ['3-Point Arc (A)', 'arc'],
    ['Slot (S)', 'slot'],
    ['Regular Polygon (P)', 'polygon'],
    ['Toggle Construction (G)', 'construction'],
    ['Toggle Grid Snap', 'grid-snap'],
    ['Close Sketch (Esc)', 'finish']
  ],
  part: [
    ['Pad (Extrude)', 'pad'],
    ['Pocket (Cut)', 'pocket'],
    ['Revolution (Revolve)', 'revolve'],
    ['Parametric Hole', 'hole'],
    ['Fillet 3D', 'fillet'],
    ['Chamfer 3D', 'chamfer'],
    ['Recompute Solid (F5)', 'recompute']
  ],
  ai: [
    ['🧠 Dựng 3D tự động (Hybrid AI)', 'hybrid-reconstruct'],
    ['🔍 Phân tích mặt chiếu đã chọn', 'analyze-crop'],
    ['📐 Đọc kích thước bản vẽ (Local OCR)', 'ocr-dimensions']
  ],
  help: [
    ['FreeCAD Shortcuts & Tips', 'help']
  ]
};

shell.querySelectorAll('[data-menu]').forEach(b => b.onclick = () => {
  menu.replaceChildren();
  const list = menus[b.dataset.menu] || [];
  for (const [text, cmd] of list) {
    const item = document.createElement('button');
    item.textContent = text;
    item.onclick = () => {
      menu.hidden = true;
      dispatch(cmd);
    };
    menu.append(item);
  }
  const r = b.getBoundingClientRect();
  menu.style.left = r.left + 'px';
  menu.style.top = r.bottom + 'px';
  menu.hidden = false;
});

document.addEventListener('pointerdown', e => {
  if (!e.target.closest('[data-menu],#cad-menu')) menu.hidden = true;
});

$('build-solid').textContent = 'Recompute Solid (F5)';
settings.querySelector('.section-heading strong').textContent = 'PartDesign Parameters';
settings.querySelector('.section-heading .pill')?.remove();
$('model-height').closest('label').childNodes[0].textContent = 'Pad length (mm)';
$('export-source').textContent = 'Model JSON';
$('clear-after-export').checked = false;

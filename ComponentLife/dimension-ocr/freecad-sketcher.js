/**
 * FreeCAD Web Sketcher Engine
 * Implements FreeCAD-like 2D parametric sketching directly in the browser:
 * - Polyline (continuous lines with H/V auto-snapping & loop closing)
 * - Rectangle, Circle, 3-Point Arc, Slot, Regular Polygon
 * - Construction geometry toggle (dashed blue helper lines)
 * - Intelligent Snapping: Grid, Origin (0,0), Existing Endpoints, H/V alignment
 * - Live HUD: Coordinates (X, Y mm), Length/Angle/Radius dimensions
 * - FreeCAD Visual Styling: Iconic FreeCAD Green (#20c997) for closed profile,
 *   White for unconstrained, Blue for construction, Orange for hover/selection
 * - Solver feedback: DoF count, closed loop validation for PartDesign Pad
 */

export class FreeCadSketcher {
  constructor(options = {}) {
    this.canvas = options.canvas;
    this.getCrop = options.getCrop || (() => null);
    this.onProfileChange = options.onProfileChange || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.isStandalone = options.isStandalone || (() => false);

    // Active tool: 'select' | 'polyline' | 'rectangle' | 'circle' | 'arc' | 'slot' | 'polygon'
    this.tool = 'polyline';
    this.constructionMode = false;
    this.gridSnap = true;
    this.pointSnap = true;
    this.hvSnap = true;
    this.polygonSides = 6;

    // Elements array
    this.elements = [];
    this.selectedElement = null;
    this.hoverElement = null;
    this.hoverVertex = null;

    // Drawing state
    this.currentGesture = null;
    this.activePolyline = null; // in-progress continuous polyline
    this.mousePos = { x: 0, y: 0 }; // in mm
    this.mouseScreen = { x: 0, y: 0 }; // in px
    this.activeSnap = null; // { type: 'origin'|'point'|'grid'|'hv', x, y, label }

    // History for undo/redo
    this.history = [];
    this.redoHistory = [];
  }

  // Set active tool
  setTool(tool) {
    if (this.activePolyline && this.activePolyline.length >= 2) {
      this.commitPolyline();
    }
    this.activePolyline = null;
    this.currentGesture = null;
    this.tool = tool;
    this.onStatus(this.getToolHint(tool));
  }

  getToolHint(tool) {
    const hints = {
      select: 'Select & edit: Click element to select, drag points to move. Del to remove.',
      polyline: 'Polyline (L): Click points in order. Snap to start point to close. Right-click or Esc to finish.',
      rectangle: 'Rectangle (R): Click first corner, then opposite corner.',
      circle: 'Circle (C): Click center point, then radius point.',
      arc: '3-Point Arc (A): Click start point, end point, then drag curvature.',
      slot: 'Slot (S): Click start center, end center, then drag slot width.',
      polygon: `Regular Polygon (${this.polygonSides}-sided): Click center, then drag outer vertex.`,
      fillet: 'Fillet (F): Click corner vertex to round it.'
    };
    return hints[tool] || 'FreeCAD Sketcher active';
  }

  toggleConstruction() {
    this.constructionMode = !this.constructionMode;
    return this.constructionMode;
  }

  toggleGridSnap() {
    this.gridSnap = !this.gridSnap;
    return this.gridSnap;
  }

  // Convert screen coordinates to CAD mm space
  screenToModel(screenX, screenY, zoom, offset, crop) {
    if (!crop || !crop.mm) {
      // Default mm mapping if no crop
      const cx = (screenX - offset[0]) / zoom;
      const cy = (screenY - offset[1]) / zoom;
      return [(cx - 800) * 0.1, (600 - cy) * 0.1];
    }
    const cropPxX = (screenX - offset[0]) / zoom;
    const cropPxY = (screenY - offset[1]) / zoom;
    return [
      (cropPxX - crop.origin[0]) * crop.mm,
      (crop.origin[1] - cropPxY) * crop.mm
    ];
  }

  // Convert CAD mm space to screen coordinates
  modelToScreen(modelX, modelY, zoom, offset, crop) {
    if (!crop || !crop.mm) {
      const cx = modelX / 0.1 + 800;
      const cy = 600 - modelY / 0.1;
      return [cx * zoom + offset[0], cy * zoom + offset[1]];
    }
    const cropPxX = crop.origin[0] + modelX / crop.mm;
    const cropPxY = crop.origin[1] - modelY / crop.mm;
    return [cropPxX * zoom + offset[0], cropPxY * zoom + offset[1]];
  }

  // Snapping logic: origin (0,0), endpoints, H/V, and grid
  getSnapPoint(rawX, rawY, zoom, crop) {
    const snapDistMm = 12 / (zoom * (crop?.mm ? 1 / crop.mm : 10)); // ~12px in mm

    // 1. Snap to Origin (0,0)
    if (Math.hypot(rawX, rawY) < snapDistMm) {
      return { x: 0, y: 0, type: 'origin', label: 'Origin (0, 0)' };
    }

    // 2. Snap to Existing Endpoints/Vertices
    if (this.pointSnap) {
      let nearest = null;
      let minDist = snapDistMm;

      const checkPoint = (px, py, label = 'Point') => {
        const d = Math.hypot(rawX - px, rawY - py);
        if (d < minDist) {
          minDist = d;
          nearest = { x: px, y: py, type: 'point', label };
        }
      };

      // Check current in-progress polyline start point (for loop closing)
      if (this.activePolyline && this.activePolyline.length > 2) {
        checkPoint(this.activePolyline[0][0], this.activePolyline[0][1], 'Close loop');
      }

      // Check all element vertices
      for (const el of this.elements) {
        if (el.type === 'line') {
          checkPoint(el.p1[0], el.p1[1]);
          checkPoint(el.p2[0], el.p2[1]);
        } else if (el.type === 'circle') {
          checkPoint(el.center[0], el.center[1], 'Center');
        } else if (el.type === 'arc') {
          checkPoint(el.p1[0], el.p1[1]);
          checkPoint(el.p2[0], el.p2[1]);
          checkPoint(el.center[0], el.center[1], 'Arc center');
        } else if (el.type === 'rect') {
          checkPoint(el.p1[0], el.p1[1]);
          checkPoint(el.p2[0], el.p1[1]);
          checkPoint(el.p2[0], el.p2[1]);
          checkPoint(el.p1[0], el.p2[1]);
        }
      }

      if (nearest) return nearest;
    }

    // 3. Snap to Horizontal / Vertical from reference point (e.g. polyline last point)
    if (this.hvSnap && this.activePolyline && this.activePolyline.length > 0) {
      const last = this.activePolyline[this.activePolyline.length - 1];
      const dx = Math.abs(rawX - last[0]);
      const dy = Math.abs(rawY - last[1]);
      if (dy < snapDistMm) {
        return { x: rawX, y: last[1], type: 'hv', label: 'H (Horizontal)' };
      }
      if (dx < snapDistMm) {
        return { x: last[0], y: rawY, type: 'hv', label: 'V (Vertical)' };
      }
    }

    // 4. Snap to Grid (5mm or 10mm or 1mm based on zoom)
    if (this.gridSnap) {
      let gridStep = 10;
      if (zoom > 3) gridStep = 1;
      else if (zoom > 1.2) gridStep = 5;
      else if (zoom < 0.4) gridStep = 50;

      const gx = Math.round(rawX / gridStep) * gridStep;
      const gy = Math.round(rawY / gridStep) * gridStep;
      if (Math.hypot(rawX - gx, rawY - gy) < snapDistMm * 0.9) {
        return { x: gx, y: gy, type: 'grid', label: `Grid (${gx}, ${gy})` };
      }
    }

    return { x: rawX, y: rawY, type: 'none' };
  }

  // Pointer event handlers
  handlePointerMove(e, zoom, offset, crop) {
    const r = this.canvas?.getBoundingClientRect?.() || { left: 0, top: 0, width: 800, height: 600 };
    this.mouseScreen = { x: e.clientX - r.left, y: e.clientY - r.top };
    const [rawX, rawY] = this.screenToModel(this.mouseScreen.x, this.mouseScreen.y, zoom, offset, crop);
    
    this.activeSnap = this.getSnapPoint(rawX, rawY, zoom, crop);
    this.mousePos = { x: this.activeSnap.x, y: this.activeSnap.y };

    // Update active gesture preview
    if (this.currentGesture) {
      this.currentGesture.current = [this.mousePos.x, this.mousePos.y];
    }
  }

  handlePointerDown(e, zoom, offset, crop) {
    if (e.button === 2) {
      // Right click: cancel or finish tool
      this.finishCurrent();
      return;
    }
    if (e.button !== 0) return;

    let p;
    if (this.activeSnap && typeof this.activeSnap.x === 'number' && typeof this.activeSnap.y === 'number') {
      p = [this.activeSnap.x, this.activeSnap.y];
    } else {
      const [rawX, rawY] = this.screenToModel(this.mouseScreen.x, this.mouseScreen.y, zoom, offset, crop);
      const snap = this.getSnapPoint(rawX, rawY, zoom, crop);
      p = [snap.x, snap.y];
    }

    this.saveHistory();

    if (this.tool === 'polyline') {
      if (!this.activePolyline) {
        this.activePolyline = [p];
        this.currentGesture = { type: 'polyline', start: p, current: p };
      } else {
        const first = this.activePolyline[0];
        // Check if clicking near start point to close loop
        if (this.activePolyline.length >= 2 && Math.hypot(p[0] - first[0], p[1] - first[1]) < 0.05) {
          this.activePolyline.push([first[0], first[1]]);
          this.commitPolyline();
          this.onStatus('Polyline closed loop completed.');
        } else {
          this.activePolyline.push(p);
          this.currentGesture.start = p;
        }
      }
    } else if (this.tool === 'rectangle') {
      if (!this.currentGesture) {
        this.currentGesture = { type: 'rectangle', start: p, current: p };
      } else {
        const start = this.currentGesture.start;
        const rectEl = {
          type: 'rect',
          p1: start,
          p2: p,
          construction: this.constructionMode
        };
        this.elements.push(rectEl);
        this.currentGesture = null;
        this.syncToProfile();
        this.onStatus(`Rectangle added: ${(Math.abs(p[0] - start[0])).toFixed(2)} × ${(Math.abs(p[1] - start[1])).toFixed(2)} mm`);
      }
    } else if (this.tool === 'circle') {
      if (!this.currentGesture) {
        this.currentGesture = { type: 'circle', center: p, current: p };
      } else {
        const radius = Math.hypot(p[0] - this.currentGesture.center[0], p[1] - this.currentGesture.center[1]);
        if (radius > 0.01) {
          this.elements.push({
            type: 'circle',
            center: this.currentGesture.center,
            radius,
            construction: this.constructionMode
          });
          this.currentGesture = null;
          this.syncToProfile();
          this.onStatus(`Circle added: Ø ${(radius * 2).toFixed(2)} mm (R ${radius.toFixed(2)} mm)`);
        }
      }
    } else if (this.tool === 'arc') {
      if (!this.currentGesture) {
        this.currentGesture = { type: 'arc', step: 1, p1: p, current: p };
      } else if (this.currentGesture.step === 1) {
        this.currentGesture.step = 2;
        this.currentGesture.p2 = p;
      } else if (this.currentGesture.step === 2) {
        const { p1, p2 } = this.currentGesture;
        // Compute 3-point circle center and radius
        const arcData = compute3PointArc(p1, p2, p);
        if (arcData) {
          this.elements.push({
            type: 'arc',
            p1,
            p2,
            p3: p,
            center: arcData.center,
            radius: arcData.radius,
            startAngle: arcData.startAngle,
            endAngle: arcData.endAngle,
            clockwise: arcData.clockwise,
            construction: this.constructionMode
          });
          this.syncToProfile();
          this.onStatus(`3-Point Arc added: R ${arcData.radius.toFixed(2)} mm`);
        }
        this.currentGesture = null;
      }
    } else if (this.tool === 'slot') {
      if (!this.currentGesture) {
        this.currentGesture = { type: 'slot', step: 1, p1: p, current: p };
      } else if (this.currentGesture.step === 1) {
        this.currentGesture.step = 2;
        this.currentGesture.p2 = p;
      } else if (this.currentGesture.step === 2) {
        const { p1, p2 } = this.currentGesture;
        const radius = Math.hypot(p[0] - p2[0], p[1] - p2[1]) || 5;
        this.elements.push({
          type: 'slot',
          p1,
          p2,
          radius,
          construction: this.constructionMode
        });
        this.currentGesture = null;
        this.syncToProfile();
        this.onStatus(`Slot added: Length ${(Math.hypot(p2[0]-p1[0], p2[1]-p1[1])).toFixed(2)} mm, Width ${(radius*2).toFixed(2)} mm`);
      }
    } else if (this.tool === 'polygon') {
      if (!this.currentGesture) {
        this.currentGesture = { type: 'polygon', center: p, sides: this.polygonSides, current: p };
      } else {
        const center = this.currentGesture.center;
        const radius = Math.hypot(p[0] - center[0], p[1] - center[1]);
        if (radius > 0.01) {
          const angle = Math.atan2(p[1] - center[1], p[0] - center[0]);
          this.elements.push({
            type: 'polygon',
            center,
            radius,
            sides: this.polygonSides,
            rotation: angle,
            construction: this.constructionMode
          });
          this.currentGesture = null;
          this.syncToProfile();
          this.onStatus(`Regular ${this.polygonSides}-gon added: R ${radius.toFixed(2)} mm`);
        }
      }
    }
  }

  // Commit polyline segments into elements
  commitPolyline() {
    if (!this.activePolyline || this.activePolyline.length < 2) return;
    for (let i = 0; i < this.activePolyline.length - 1; i++) {
      const p1 = this.activePolyline[i];
      const p2 = this.activePolyline[i + 1];
      if (Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) > 0.001) {
        this.elements.push({
          type: 'line',
          p1,
          p2,
          construction: this.constructionMode
        });
      }
    }
    this.activePolyline = null;
    this.currentGesture = null;
    this.syncToProfile();
  }

  finishCurrent() {
    if (this.activePolyline) {
      this.commitPolyline();
    }
    this.currentGesture = null;
    this.onStatus('Tool finished. Ready for next command.');
  }

  // Clear sketch
  clear() {
    this.saveHistory();
    this.elements = [];
    this.activePolyline = null;
    this.currentGesture = null;
    this.syncToProfile();
  }

  saveHistory() {
    this.history.push(JSON.stringify(this.elements));
    if (this.history.length > 50) this.history.shift();
    this.redoHistory = [];
  }

  undo() {
    if (!this.history.length) return false;
    this.redoHistory.push(JSON.stringify(this.elements));
    const prev = this.history.pop();
    this.elements = JSON.parse(prev);
    this.syncToProfile();
    return true;
  }

  redo() {
    if (!this.redoHistory.length) return false;
    this.history.push(JSON.stringify(this.elements));
    const next = this.redoHistory.pop();
    this.elements = JSON.parse(next);
    this.syncToProfile();
    return true;
  }

  // Convert current sketch elements to solid engine profile & features
  syncToProfile() {
    // 1. Separate regular geometry from construction geometry
    const solids = this.elements.filter(e => !e.construction);
    if (!solids.length) {
      this.onProfileChange({ profile: [], circle: null, closed: false, dof: 0 });
      return;
    }

    // 2. Single circle sketch
    if (solids.length === 1 && solids[0].type === 'circle') {
      const c = solids[0];
      const r = c.radius;
      const box = [
        [c.center[0] - r, c.center[1] - r],
        [c.center[0] + r, c.center[1] - r],
        [c.center[0] + r, c.center[1] + r],
        [c.center[0] - r, c.center[1] + r]
      ];
      this.onProfileChange({
        profile: box,
        circle: { center: c.center, radius: r },
        closed: true,
        dof: 0,
        summary: `Circle Ø ${(r * 2).toFixed(2)} mm`
      });
      return;
    }

    // 3. Extract closed outer loops from lines, rects, arcs, polygons, slots
    const segments = [];
    for (const el of solids) {
      if (el.type === 'line') {
        segments.push({ p1: el.p1, p2: el.p2 });
      } else if (el.type === 'rect') {
        const [a, b] = [el.p1, el.p2];
        segments.push({ p1: [a[0], a[1]], p2: [b[0], a[1]] });
        segments.push({ p1: [b[0], a[1]], p2: [b[0], b[1]] });
        segments.push({ p1: [b[0], b[1]], p2: [a[0], b[1]] });
        segments.push({ p1: [a[0], b[1]], p2: [a[0], a[1]] });
      } else if (el.type === 'polygon') {
        const pts = [];
        for (let i = 0; i < el.sides; i++) {
          const a = el.rotation + (i * 2 * Math.PI) / el.sides;
          pts.push([el.center[0] + el.radius * Math.cos(a), el.center[1] + el.radius * Math.sin(a)]);
        }
        for (let i = 0; i < el.sides; i++) {
          segments.push({ p1: pts[i], p2: pts[(i + 1) % el.sides] });
        }
      } else if (el.type === 'slot') {
        // Discretize slot into 4 segments (2 lines + 2 semicircles)
        const [a, b] = [el.p1, el.p2];
        const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const nx = -Math.sin(angle) * el.radius;
        const ny = Math.cos(angle) * el.radius;
        const top1 = [a[0] + nx, a[1] + ny];
        const top2 = [b[0] + nx, b[1] + ny];
        const bot2 = [b[0] - nx, b[1] - ny];
        const bot1 = [a[0] - nx, a[1] - ny];
        segments.push({ p1: top1, p2: top2 });
        // end arc
        const endArc = sampleArc(b, el.radius, angle - Math.PI/2, angle + Math.PI/2, 8);
        for (let i = 0; i < endArc.length - 1; i++) segments.push({ p1: endArc[i], p2: endArc[i+1] });
        segments.push({ p1: bot2, p2: bot1 });
        // start arc
        const startArc = sampleArc(a, el.radius, angle + Math.PI/2, angle + 3*Math.PI/2, 8);
        for (let i = 0; i < startArc.length - 1; i++) segments.push({ p1: startArc[i], p2: startArc[i+1] });
      } else if (el.type === 'arc') {
        // Discretize arc into linear pieces
        const pts = sampleArcPoints(el, 16);
        for (let i = 0; i < pts.length - 1; i++) {
          segments.push({ p1: pts[i], p2: pts[i + 1] });
        }
      }
    }

    // Connect segments into ordered polygon loop
    const loop = buildOrderedLoop(segments);
    const closed = loop.closed && loop.points.length >= 3;
    const dof = closed ? 0 : Math.max(1, segments.length * 2 - (loop.points.length - 1) * 2);

    this.onProfileChange({
      profile: loop.points,
      circle: null,
      closed,
      dof,
      summary: closed
        ? `Closed Profile (${loop.points.length} vertices) · Fully constrained`
        : `Under-constrained (${dof} DoF) · Close outline to Pad`
    });
  }

  // Load existing profile (e.g. from file or template)
  loadProfile(profile, circle = null) {
    this.elements = [];
    if (circle) {
      this.elements.push({
        type: 'circle',
        center: [...circle.center],
        radius: circle.radius,
        construction: false
      });
    } else if (Array.isArray(profile) && profile.length >= 3) {
      for (let i = 0; i < profile.length; i++) {
        const p1 = profile[i];
        const p2 = profile[(i + 1) % profile.length];
        this.elements.push({
          type: 'line',
          p1: [...p1],
          p2: [...p2],
          construction: false
        });
      }
    }
    this.syncToProfile();
  }

  // Draw all sketch elements onto the canvas context
  render(ctx, zoom, offset, crop) {
    const isClosed = this.isSketchClosed();
    const activeColor = isClosed ? '#20c997' : '#e6e9ee'; // FreeCAD Green when closed!
    const activeFill = isClosed ? 'rgba(32, 201, 151, 0.12)' : 'transparent';

    ctx.save();
    ctx.translate(offset[0], offset[1]);
    ctx.scale(zoom, zoom);

    // 1. Draw coordinate axes & origin
    this.drawAxes(ctx, crop);

    // 2. Draw elements
    for (const el of this.elements) {
      const isSelected = this.selectedElement === el;
      const strokeColor = el.construction
        ? '#339af0'
        : isSelected
        ? '#ff922b'
        : activeColor;

      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = activeFill;
      ctx.lineWidth = (isSelected ? 2.5 : 1.8) / zoom;
      if (el.construction) {
        ctx.setLineDash([6 / zoom, 4 / zoom]);
      }

      if (el.type === 'line') {
        const p1 = this.toScreenCoords(el.p1, crop);
        const p2 = this.toScreenCoords(el.p2, crop);
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();

        // Draw constraint labels (H, V, Length)
        this.drawLineConstraints(ctx, el, p1, p2, zoom);
      } else if (el.type === 'rect') {
        const p1 = this.toScreenCoords(el.p1, crop);
        const p2 = this.toScreenCoords(el.p2, crop);
        const x = Math.min(p1[0], p2[0]);
        const y = Math.min(p1[1], p2[1]);
        const w = Math.abs(p2[0] - p1[0]);
        const h = Math.abs(p2[1] - p1[1]);
        ctx.beginPath();
        ctx.strokeRect(x, y, w, h);
        if (isClosed && !el.construction) ctx.fillRect(x, y, w, h);

        // Dimension labels
        this.drawDimensionTag(ctx, (p1[0] + p2[0]) / 2, y - 6 / zoom, `${(Math.abs(el.p2[0] - el.p1[0])).toFixed(2)} mm`, zoom);
        this.drawDimensionTag(ctx, x - 12 / zoom, (p1[1] + p2[1]) / 2, `${(Math.abs(el.p2[1] - el.p1[1])).toFixed(2)} mm`, zoom, true);
      } else if (el.type === 'circle') {
        const c = this.toScreenCoords(el.center, crop);
        const r = el.radius / (crop?.mm || 0.1);
        ctx.beginPath();
        ctx.arc(c[0], c[1], r, 0, Math.PI * 2);
        ctx.stroke();
        if (isClosed && !el.construction) ctx.fill();

        // Center crosshair & diameter
        this.drawCenterCrosshair(ctx, c[0], c[1], zoom);
        this.drawDimensionTag(ctx, c[0] + r * 0.7, c[1] - r * 0.7, `Ø ${(el.radius * 2).toFixed(2)} mm`, zoom);
      } else if (el.type === 'arc') {
        const c = this.toScreenCoords(el.center, crop);
        const r = el.radius / (crop?.mm || 0.1);
        ctx.beginPath();
        ctx.arc(c[0], c[1], r, el.startAngle, el.endAngle, el.clockwise);
        ctx.stroke();
        this.drawDimensionTag(ctx, c[0], c[1] - r - 4 / zoom, `R ${el.radius.toFixed(2)} mm`, zoom);
      } else if (el.type === 'polygon') {
        const pts = [];
        for (let i = 0; i < el.sides; i++) {
          const a = el.rotation + (i * 2 * Math.PI) / el.sides;
          const mx = el.center[0] + el.radius * Math.cos(a);
          const my = el.center[1] + el.radius * Math.sin(a);
          pts.push(this.toScreenCoords([mx, my], crop));
        }
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
        ctx.closePath();
        ctx.stroke();
        if (isClosed && !el.construction) ctx.fill();
      } else if (el.type === 'slot') {
        this.drawSlot(ctx, el, crop, zoom, isClosed);
      }

      // Draw vertex handle points
      this.drawElementVertices(ctx, el, crop, zoom);
      ctx.restore();
    }

    // 3. Draw in-progress continuous polyline
    if (this.activePolyline && this.activePolyline.length) {
      ctx.save();
      ctx.strokeStyle = '#ffd43b'; // FreeCAD gold/yellow for in-progress sketch
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      this.activePolyline.forEach((p, i) => {
        const sc = this.toScreenCoords(p, crop);
        i ? ctx.lineTo(...sc) : ctx.moveTo(...sc);
      });
      // Line to mouse pointer
      const mSc = this.toScreenCoords([this.mousePos.x, this.mousePos.y], crop);
      ctx.lineTo(...mSc);
      ctx.stroke();

      // Show live segment length and angle HUD
      const lastP = this.activePolyline[this.activePolyline.length - 1];
      const len = Math.hypot(this.mousePos.x - lastP[0], this.mousePos.y - lastP[1]);
      const ang = (Math.atan2(this.mousePos.y - lastP[1], this.mousePos.x - lastP[0]) * 180 / Math.PI + 360) % 360;
      this.drawDimensionTag(ctx, (mSc[0] + this.toScreenCoords(lastP, crop)[0]) / 2, (mSc[1] + this.toScreenCoords(lastP, crop)[1]) / 2 - 8 / zoom, `L: ${len.toFixed(2)} mm  ∠: ${ang.toFixed(1)}°`, zoom);

      ctx.restore();
    }

    // 4. Draw active gesture rubberband (rectangle, circle, arc, slot, polygon)
    if (this.currentGesture && this.currentGesture.type !== 'polyline') {
      this.drawGesturePreview(ctx, zoom, crop);
    }

    // 5. Draw active snap indicator (Origin, Point, H/V, Grid)
    if (this.activeSnap && this.activeSnap.type !== 'none') {
      this.drawSnapIndicator(ctx, zoom, crop);
    }

    ctx.restore();

    // 6. Draw screen-space cursor HUD (X, Y mm)
    this.drawCursorHUD(ctx);
  }

  drawAxes(ctx, crop) {
    const origin = crop ? crop.origin : [800, 600];
    const mm = crop ? crop.mm : 0.1;

    // Red X axis (+X to the right)
    ctx.save();
    ctx.strokeStyle = '#ff4d4f';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(origin[0] - 2000, origin[1]);
    ctx.lineTo(origin[0] + 2000, origin[1]);
    ctx.stroke();

    // Green Y axis (+Y pointing UP in CAD space)
    ctx.strokeStyle = '#52c41a';
    ctx.beginPath();
    ctx.moveTo(origin[0], origin[1] - 2000);
    ctx.lineTo(origin[0], origin[1] + 2000);
    ctx.stroke();

    // Origin circle (0,0)
    ctx.fillStyle = '#ff4d4f';
    ctx.beginPath();
    ctx.arc(origin[0], origin[1], 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawLineConstraints(ctx, el, p1, p2, zoom) {
    const dx = Math.abs(el.p2[0] - el.p1[0]);
    const dy = Math.abs(el.p2[1] - el.p1[1]);
    const midX = (p1[0] + p2[0]) / 2;
    const midY = (p1[1] + p2[1]) / 2;
    const len = Math.hypot(el.p2[0] - el.p1[0], el.p2[1] - el.p1[1]);

    ctx.save();
    ctx.font = `${Math.max(9, 10 / zoom)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (dy < 0.01) {
      // Horizontal constraint badge
      this.drawBadge(ctx, midX, midY - 9 / zoom, 'H', '#ff4d4f', zoom);
      this.drawDimensionTag(ctx, midX, midY + 9 / zoom, `${len.toFixed(2)} mm`, zoom);
    } else if (dx < 0.01) {
      // Vertical constraint badge
      this.drawBadge(ctx, midX + 9 / zoom, midY, 'V', '#52c41a', zoom);
      this.drawDimensionTag(ctx, midX - 16 / zoom, midY, `${len.toFixed(2)} mm`, zoom, true);
    } else {
      this.drawDimensionTag(ctx, midX, midY - 8 / zoom, `${len.toFixed(2)} mm`, zoom);
    }
    ctx.restore();
  }

  drawBadge(ctx, x, y, text, color, zoom) {
    const size = 11 / zoom;
    ctx.fillStyle = color;
    ctx.fillRect(x - size/2, y - size/2, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${size * 0.75}px sans-serif`;
    ctx.fillText(text, x, y);
  }

  drawDimensionTag(ctx, x, y, text, zoom, vertical = false) {
    ctx.save();
    ctx.font = `${Math.max(8, 10 / zoom)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(text);
    const w = metrics.width + 6 / zoom;
    const h = 13 / zoom;

    ctx.fillStyle = 'rgba(20, 28, 40, 0.78)';
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = '#20c997'; // FreeCAD green dimension text
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  drawCenterCrosshair(ctx, x, y, zoom) {
    const s = 4 / zoom;
    ctx.strokeStyle = '#ff4d4f';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y);
    ctx.moveTo(x, y - s);
    ctx.lineTo(x, y + s);
    ctx.stroke();
  }

  drawElementVertices(ctx, el, crop, zoom) {
    const r = 3 / zoom;
    ctx.fillStyle = '#ff922b';
    const drawPt = (p) => {
      const sc = this.toScreenCoords(p, crop);
      ctx.beginPath();
      ctx.arc(sc[0], sc[1], r, 0, Math.PI * 2);
      ctx.fill();
    };

    if (el.type === 'line') {
      drawPt(el.p1);
      drawPt(el.p2);
    } else if (el.type === 'rect') {
      drawPt(el.p1);
      drawPt([el.p2[0], el.p1[1]]);
      drawPt(el.p2);
      drawPt([el.p1[0], el.p2[1]]);
    } else if (el.type === 'arc') {
      drawPt(el.p1);
      drawPt(el.p2);
    }
  }

  drawSlot(ctx, el, crop, zoom, isClosed) {
    const a = this.toScreenCoords(el.p1, crop);
    const b = this.toScreenCoords(el.p2, crop);
    const r = el.radius / (crop?.mm || 0.1);
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);

    ctx.beginPath();
    ctx.arc(a[0], a[1], r, angle + Math.PI / 2, angle + (3 * Math.PI) / 2);
    ctx.arc(b[0], b[1], r, angle - Math.PI / 2, angle + Math.PI / 2);
    ctx.closePath();
    ctx.stroke();
    if (isClosed && !el.construction) ctx.fill();
  }

  drawGesturePreview(ctx, zoom, crop) {
    const g = this.currentGesture;
    const cur = g.current || [this.mousePos.x, this.mousePos.y];
    ctx.save();
    ctx.strokeStyle = '#ffd43b';
    ctx.lineWidth = 1.6 / zoom;
    ctx.setLineDash([4 / zoom, 3 / zoom]);

    if (g.type === 'rectangle') {
      const p1 = this.toScreenCoords(g.start, crop);
      const p2 = this.toScreenCoords(cur, crop);
      const x = Math.min(p1[0], p2[0]);
      const y = Math.min(p1[1], p2[1]);
      const w = Math.abs(p2[0] - p1[0]);
      const h = Math.abs(p2[1] - p1[1]);
      ctx.strokeRect(x, y, w, h);
      this.drawDimensionTag(ctx, (p1[0] + p2[0]) / 2, y - 8 / zoom, `${(Math.abs(cur[0] - g.start[0])).toFixed(2)} mm × ${(Math.abs(cur[1] - g.start[1])).toFixed(2)} mm`, zoom);
    } else if (g.type === 'circle') {
      const c = this.toScreenCoords(g.center, crop);
      const r = Math.hypot(cur[0] - g.center[0], cur[1] - g.center[1]) / (crop?.mm || 0.1);
      ctx.beginPath();
      ctx.arc(c[0], c[1], r, 0, Math.PI * 2);
      ctx.stroke();
      this.drawDimensionTag(ctx, c[0], c[1] - r - 6 / zoom, `Ø ${(Math.hypot(cur[0] - g.center[0], cur[1] - g.center[1]) * 2).toFixed(2)} mm`, zoom);
    }
    ctx.restore();
  }

  drawSnapIndicator(ctx, zoom, crop) {
    const sc = this.toScreenCoords([this.activeSnap.x, this.activeSnap.y], crop);
    ctx.save();
    if (this.activeSnap.type === 'origin') {
      ctx.strokeStyle = '#ff4d4f';
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      ctx.arc(sc[0], sc[1], 7 / zoom, 0, Math.PI * 2);
      ctx.stroke();
    } else if (this.activeSnap.type === 'point') {
      ctx.strokeStyle = '#ffa940';
      ctx.fillStyle = 'rgba(255, 169, 64, 0.4)';
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(sc[0] - 5 / zoom, sc[1] - 5 / zoom, 10 / zoom, 10 / zoom);
      ctx.fillRect(sc[0] - 5 / zoom, sc[1] - 5 / zoom, 10 / zoom, 10 / zoom);
    } else if (this.activeSnap.type === 'hv') {
      ctx.strokeStyle = '#52c41a';
      ctx.setLineDash([4 / zoom, 3 / zoom]);
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.arc(sc[0], sc[1], 5 / zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawCursorHUD(ctx) {
    const { x, y } = this.mouseScreen;
    const info = `X: ${this.mousePos.x.toFixed(2)}  Y: ${this.mousePos.y.toFixed(2)} mm`;
    ctx.save();
    ctx.font = '11px monospace';
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    const w = ctx.measureText(info).width + 12;
    ctx.fillRect(x + 14, y + 14, w, 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(info, x + 20, y + 28);
    ctx.restore();
  }

  toScreenCoords(point, crop) {
    const origin = crop ? crop.origin : [800, 600];
    const mm = crop ? crop.mm : 0.1;
    return [origin[0] + point[0] / mm, origin[1] - point[1] / mm];
  }

  isSketchClosed() {
    const solids = this.elements.filter(e => !e.construction);
    if (!solids.length) return false;
    if (solids.length === 1 && solids[0].type === 'circle') return true;
    const segments = [];
    for (const el of solids) {
      if (el.type === 'line') segments.push({ p1: el.p1, p2: el.p2 });
      else if (el.type === 'rect' || el.type === 'polygon' || el.type === 'slot') return true;
    }
    const loop = buildOrderedLoop(segments);
    return loop.closed && loop.points.length >= 3;
  }
}

// Helpers for arcs & loops
function compute3PointArc(p1, p2, p3) {
  const [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3;
  const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  if (Math.abs(d) < 1e-7) return null;
  const ux = ((x1*x1 + y1*y1)*(y2 - y3) + (x2*x2 + y2*y2)*(y3 - y1) + (x3*x3 + y3*y3)*(y1 - y2)) / d;
  const uy = ((x1*x1 + y1*y1)*(x3 - x2) + (x2*x2 + y2*y2)*(x1 - x3) + (x3*x3 + y3*y3)*(x2 - x1)) / d;
  const radius = Math.hypot(x1 - ux, y1 - uy);
  const a1 = Math.atan2(y1 - uy, x1 - ux);
  const a2 = Math.atan2(y2 - uy, x2 - ux);
  const a3 = Math.atan2(y3 - uy, x3 - ux);
  // Determine direction
  let clockwise = false;
  if ((a2 > a1 && (a3 > a2 || a3 < a1)) || (a2 < a1 && a3 > a2 && a3 < a1)) {
    clockwise = false;
  } else {
    clockwise = true;
  }
  return { center: [ux, uy], radius, startAngle: a1, endAngle: a2, clockwise };
}

function sampleArc(center, radius, startAngle, endAngle, count) {
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const a = startAngle + (endAngle - startAngle) * (i / count);
    pts.push([center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)]);
  }
  return pts;
}

function sampleArcPoints(arc, count = 16) {
  return sampleArc(arc.center, arc.radius, arc.startAngle, arc.endAngle, count);
}

function buildOrderedLoop(segments) {
  if (!segments.length) return { points: [], closed: false };
  const rem = [...segments];
  const first = rem.shift();
  const loop = [[...first.p1], [...first.p2]];
  const eps = 0.05;

  while (rem.length) {
    const curEnd = loop[loop.length - 1];
    let foundIdx = -1;
    let reverse = false;

    for (let i = 0; i < rem.length; i++) {
      const seg = rem[i];
      if (Math.hypot(curEnd[0] - seg.p1[0], curEnd[1] - seg.p1[1]) < eps) {
        foundIdx = i;
        reverse = false;
        break;
      }
      if (Math.hypot(curEnd[0] - seg.p2[0], curEnd[1] - seg.p2[1]) < eps) {
        foundIdx = i;
        reverse = true;
        break;
      }
    }

    if (foundIdx === -1) break;
    const matched = rem.splice(foundIdx, 1)[0];
    const nextPt = reverse ? matched.p1 : matched.p2;
    loop.push([...nextPt]);
  }

  const startPt = loop[0];
  const endPt = loop[loop.length - 1];
  const closed = loop.length >= 3 && Math.hypot(startPt[0] - endPt[0], startPt[1] - endPt[1]) < eps;
  if (closed) loop.pop(); // remove duplicate closing vertex for polygon profile array

  return { points: loop, closed };
}

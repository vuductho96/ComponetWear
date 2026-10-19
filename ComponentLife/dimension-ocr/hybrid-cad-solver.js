/**
 * Hybrid Geometric CAD Solver (Deterministic CV + Spatial Reasoning)
 * 
 * Reconstructs 3D CAD models from 2D engineering drawings (Top, Front, Right, Isometric)
 * by combining computer vision feature extraction with multi-view descriptive geometry.
 */

import { analyzeCrop, toModel, viewAxes } from './cad-geometry.js';

/**
 * Calculates oriented bounding box and dimensions of a 2D point array
 */
export function computeBounds2D(points) {
  if (!points || !points.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    minX, maxX, minY, maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}

/**
 * Checks if a 2D polygon is clockwise or counter-clockwise
 */
export function polygonArea2D(points) {
  if (!points || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += (a[0] * b[1]) - (b[0] * a[1]);
  }
  return area / 2;
}

/**
 * Checks if point is inside polygon
 */
export function pointInPolygon2D(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Extracts normalized/metric features from an analyzed crop
 */
export function extractViewFeatures(crop) {
  const mm = crop.mm || 0.1;
  const origin = crop.origin || [0, 0];
  
  // If raw analysis is provided or analyze directly
  let raw = crop.rawAnalysis;
  if (!raw && crop.canvas) {
    raw = analyzeCrop(crop.canvas);
  }
  if (!raw) raw = { outlines: [], circles: [], lines: [] };

  // Convert outlines to real mm
  const outlines = (raw.outlines || []).map(o => {
    const pts = o.points.map(p => toModel(crop, p));
    const areaMm = Math.abs(polygonArea2D(pts));
    const bounds = computeBounds2D(pts);
    return { points: pts, area: areaMm, bounds };
  }).filter(o => o.points.length >= 3 && o.area > 1);

  // Convert circles to real mm
  const circles = (raw.circles || []).map(c => {
    const center = toModel(crop, [c.cx, c.cy]);
    const radius = c.r * mm;
    return {
      x: center[0],
      y: center[1],
      radius: Math.abs(radius),
      diameter: Math.abs(radius * 2)
    };
  }).filter(c => c.radius > 0.5);

  // Convert lines to real mm
  const lines = (raw.lines || []).map(l => {
    const p1 = toModel(crop, l.a);
    const p2 = toModel(crop, l.b);
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const isHorizontal = Math.abs(dy) < 1.0;
    const isVertical = Math.abs(dx) < 1.0;
    return { p1, p2, length, angle, isHorizontal, isVertical, kind: l.kind || 'line' };
  });

  // Primary outer boundary
  const primaryOutline = outlines.length ? outlines[0] : null;
  const bounds = primaryOutline ? primaryOutline.bounds : computeBounds2D([]);

  return {
    id: crop.id,
    face: crop.face || 'Auto',
    page: crop.page || 1,
    outlines,
    primaryOutline,
    circles,
    lines,
    bounds,
    aspectRatio: bounds.height > 0 ? bounds.width / bounds.height : 1
  };
}

/**
 * Automatically classifies views (Top, Front, Right, Isometric) if not assigned
 */
export function autoClassifyViews(views) {
  const unassigned = views.filter(v => !v.face || v.face === 'Auto');
  if (!unassigned.length) return views;

  // If we have 3 views, usually:
  // Top: XY (often has circles for vertical holes, or distinct perimeter)
  // Front: XZ (shares X-width with Top)
  // Right: YZ (shares Z-height with Front and Y-depth with Top)
  if (views.length >= 2) {
    // Sort views by Y-position on sheet or geometric dimensions
    for (const v of views) {
      if (!v.face || v.face === 'Auto') {
        if (v.circles.length > 0 && !views.some(x => x.face === 'Top')) {
          v.face = 'Top';
        } else if (!views.some(x => x.face === 'Front')) {
          v.face = 'Front';
        } else if (!views.some(x => x.face === 'Right')) {
          v.face = 'Right';
        } else {
          v.face = 'Top';
        }
      }
    }
  } else if (views.length === 1 && (!views[0].face || views[0].face === 'Auto')) {
    views[0].face = 'Top';
  }

  return views;
}

/**
 * Multi-view Geometric Reasoning Engine
 * Solves 3D parametric CAD spec from 2D views
 */
export function solveMultiViewGeometry(viewsInput, options = {}) {
  const reasoning = [];
  const assumptions = [];

  if (!viewsInput || !viewsInput.length) {
    throw Error('Cần ít nhất một hình chiếu (mặt cắt hoặc hình chiếu 2D) để suy luận 3D.');
  }

  // Pre-process & classify views
  const views = autoClassifyViews(viewsInput.map(v => v.outlines ? v : extractViewFeatures(v)));

  const topView = views.find(v => v.face === 'Top') || views[0];
  const frontView = views.find(v => v.face === 'Front');
  const rightView = views.find(v => v.face === 'Right');
  const isoView = views.find(v => v.face === 'Isometric');

  reasoning.push(`Xác định hình chiếu cơ sở: Mặt Bằng [Top] (Crop #${topView.id}).`);

  // 1. Detect Rotational / Cylindrical Symmetry
  let isRotational = false;
  let revolveAxis = 'Y';
  let revolveAngle = 360;

  if (topView.circles.length >= 1 && topView.outlines.length <= 1) {
    // Check if outer silhouette is circular
    const c0 = topView.circles[0];
    if (topView.primaryOutline) {
      const b = topView.primaryOutline.bounds;
      const ratio = b.height > 0 ? b.width / b.height : 1;
      if (Math.abs(ratio - 1.0) < 0.12 && Math.abs(b.width - c0.diameter) < 3.0) {
        isRotational = true;
        reasoning.push(`Phát hiện tính đối xứng tròn xoay: Biên dạng Top là hình tròn Ø${c0.diameter.toFixed(2)} mm.`);
      }
    }
  }

  // 2. Base 2D Profile
  let profile = [];
  let circleProfile = null;

  if (isRotational && topView.circles.length) {
    const c0 = topView.circles[0];
    circleProfile = { center: [c0.x, c0.y], radius: c0.radius };
    // Create bounding polygon square for circle
    const r = c0.radius;
    profile = [
      [c0.x - r, c0.y - r],
      [c0.x + r, c0.y - r],
      [c0.x + r, c0.y + r],
      [c0.x - r, c0.y + r]
    ];
    reasoning.push(`Biên dạng cơ sở: Hình tròn tâm (${c0.x.toFixed(1)}, ${c0.y.toFixed(1)}), bán kính R = ${r.toFixed(2)} mm.`);
  } else if (topView.primaryOutline && topView.primaryOutline.points.length >= 3) {
    profile = topView.primaryOutline.points.map(p => [Number(p[0].toFixed(3)), Number(p[1].toFixed(3))]);
    const b = topView.primaryOutline.bounds;
    reasoning.push(`Biên dạng bao ngoài 2D: ${profile.length} đỉnh, kích thước bao ${b.width.toFixed(2)} × ${b.height.toFixed(2)} mm.`);
  } else {
    // Fallback: rectangular bounding box
    const w = topView.bounds.width || 40, h = topView.bounds.height || 30;
    profile = [[0, 0], [w, 0], [w, h], [0, h]];
    assumptions.push('Không nhận diện được đường bao rõ ràng trên mặt Top, sử dụng hình hộp bao cơ sở.');
  }

  // 3. Extrusion Depth / Height (Z)
  let depth = Number(options.defaultDepth) || 20;

  if (frontView && frontView.bounds.height > 1) {
    depth = Number(frontView.bounds.height.toFixed(2));
    reasoning.push(`Đối chiếu mặt Đứng [Front]: Chiều cao khối theo trục Z = ${depth} mm.`);
    
    // Cross-validate X-width
    if (topView.bounds.width > 0 && Math.abs(topView.bounds.width - frontView.bounds.width) < 5.0) {
      reasoning.push(`Khớp kích thước trục X giữa Top (${topView.bounds.width.toFixed(1)} mm) và Front (${frontView.bounds.width.toFixed(1)} mm): Sai lệch < 5mm (Đạt chuẩn dóng).`);
    }
  } else if (rightView && rightView.bounds.height > 1) {
    depth = Number(rightView.bounds.height.toFixed(2));
    reasoning.push(`Đối chiếu mặt Cạnh [Right]: Chiều cao khối theo trục Z = ${depth} mm.`);
  } else {
    assumptions.push(`Không có mặt Đứng hoặc Cạnh để đo chiều cao Z, sử dụng chiều dày tiêu chuẩn Z = ${depth} mm.`);
  }

  // 4. Holes (Lỗ xuyên qua / lỗ mù)
  const holes = [];

  // Vertical holes from Top view (Z axis)
  for (const c of topView.circles) {
    // If it's the outer boundary of a cylinder, don't treat it as a hole
    if (isRotational && Math.abs(c.radius - (circleProfile?.radius || 0)) < 1.0) {
      continue;
    }

    // Check if hole is inside the outer profile
    if (pointInPolygon2D([c.x, c.y], profile) || isRotational) {
      holes.push({
        axis: 'Z',
        x: Number(c.x.toFixed(3)),
        y: Number(c.y.toFixed(3)),
        z: 0,
        radius: Number(c.radius.toFixed(3)),
        length: depth + 10 // through-hole
      });
      reasoning.push(`Phát hiện lỗ tròn trên mặt Top: Ø${c.diameter.toFixed(2)} mm tại tọa độ (${c.x.toFixed(2)}, ${c.y.toFixed(2)}) -> Đục lỗ xuyên suốt theo trục Z.`);
    }
  }

  // Horizontal holes from Front view (Y axis)
  if (frontView) {
    for (const c of frontView.circles) {
      holes.push({
        axis: 'Y',
        x: Number(c.x.toFixed(3)),
        y: 0,
        z: Number(c.y.toFixed(3)), // in Front view, Y pixel maps to Z height
        radius: Number(c.radius.toFixed(3))
      });
      reasoning.push(`Phát hiện lỗ tròn trên mặt Front: Ø${c.diameter.toFixed(2)} mm -> Đục lỗ ngang theo trục Y.`);
    }
  }

  // 5. Pockets / Notches (Rãnh khoét & bậc cắt)
  const pockets = [];

  if (frontView && frontView.outlines.length > 1) {
    // Secondary outlines in Front view represent step cuts or windows
    for (let i = 1; i < frontView.outlines.length; i++) {
      const o = frontView.outlines[i];
      const b = o.bounds;
      if (b.width > 2 && b.height > 2) {
        const pocketDepth = rightView?.bounds.width || topView.bounds.height || 20;
        pockets.push({
          origin: [Number(b.minX.toFixed(2)), 0, Number(b.minY.toFixed(2))],
          size: [Number(b.width.toFixed(2)), Number(pocketDepth.toFixed(2)), Number(b.height.toFixed(2))]
        });
        reasoning.push(`Phát hiện bậc khoét trên mặt Front: Kích thước ${b.width.toFixed(1)} × ${b.height.toFixed(1)} mm -> Tạo hốc Pocket.`);
      }
    }
  }

  // Deduce fillets / chamfers
  let fillet = 0;
  let chamfer = 0;
  if (options.fillet) fillet = Number(options.fillet);
  if (options.chamfer) chamfer = Number(options.chamfer);

  const spec = {
    profile,
    depth,
    holes,
    pockets
  };

  if (circleProfile) spec.circle = circleProfile;
  if (isRotational) {
    spec.revolve = true;
    spec.revolveAxis = revolveAxis;
    spec.revolveAngle = revolveAngle;
  }
  if (fillet > 0) spec.fillet = fillet;
  if (chamfer > 0) spec.chamfer = chamfer;

  const summary = isRotational
    ? `Khối tròn xoay (Revolve) đường kính Ø${((circleProfile?.radius || 10) * 2).toFixed(1)} mm, cao ${depth} mm, ${holes.length} lỗ.`
    : `Khối lăng trụ (Pad) biên dạng ${profile.length} đỉnh, kích thước bao ${topView.bounds.width.toFixed(1)} × ${topView.bounds.height.toFixed(1)} mm, cao ${depth} mm, ${holes.length} lỗ, ${pockets.length} hốc.`;

  return {
    success: true,
    method: isRotational ? 'revolve' : 'pad',
    summary,
    assumptions,
    reasoning,
    spec,
    metrics: {
      viewsCount: views.length,
      vertices: profile.length,
      holesCount: holes.length,
      pocketsCount: pockets.length,
      depth
    }
  };
}

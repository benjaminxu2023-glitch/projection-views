// 投影与视图 — 投影数学（纯 JS，无依赖，可在 Node 中测试）
// 坐标：X 右、Y 后、Z 上。第一角画法（GB/T 14692）：
//   物体位于 V 面之前、H 面之上、W 面之左。
//   V 面（正立投影面，主视图）：y = +P，投射方向 +Y（从前向后看）
//   H 面（水平投影面，俯视图）：z = −P，投射方向 −Z（从上向下看）
//   W 面（侧立投影面，左视图）：x = +P，投射方向 +X（从左向右看）
// 每个面有面内坐标 (u, v)，与展开后的图纸方向一致：
//   V: u = x,  v = z        H: u = x,  v = y        W: u = −y, v = z

export function makePlanes(P = 2.2, W = 3.0) {
  return {
    V: { key: 'V', name: '主视图', axis: 1, value: P, dir: [0, 1, 0], rect: [-W, P, -P, W] },
    H: { key: 'H', name: '俯视图', axis: 2, value: -P, dir: [0, 0, -1], rect: [-W, P, -W, P] },
    W: { key: 'W', name: '左视图', axis: 0, value: P, dir: [1, 0, 0], rect: [-P, W, -P, W] },
  };
}

export function toUV(plane, p) {
  switch (plane.key) {
    case 'V': return [p[0], p[2]];
    case 'H': return [p[0], p[1]];
    case 'W': return [-p[1], p[2]];
  }
  throw new Error('bad plane');
}
export function fromUV(plane, uv, offset = 0) {
  // offset > 0 表示向物体一侧（面内侧）略微抬起，避免 z-fighting
  const [u, v] = uv;
  switch (plane.key) {
    case 'V': return [u, plane.value - offset, v];
    case 'H': return [u, v, plane.value + offset];
    case 'W': return [plane.value - offset, -u, v];
  }
  throw new Error('bad plane');
}

// 正投影（平行光垂直于投影面）：把垂直于该面的坐标替换为面坐标
export function projectParallel(p, plane) {
  const q = [p[0], p[1], p[2]];
  q[plane.axis] = plane.value;
  return q;
}

// 中心投影：从光源 L 出发、经过点 p 的射线与投影面的交点。
// 要求 p 位于光源与投影面之间（0 < (p−L)·n / (plane−L)·n ≤ 1，n 为面法向分量），否则返回 null。
export function projectCentral(p, L, plane) {
  const k = plane.axis;
  const dL = plane.value - L[k]; // 光源到投影面的有向距离
  const dp = p[k] - L[k]; // 光源到点的有向距离
  if (Math.abs(dL) < 1e-12) return null; // 光源在投影面上
  if (dp * dL <= 1e-12) return null; // 点在光源后方或与光源同层：射线到不了投影面
  if (dp / dL > 1 + 1e-9) return null; // 点在投影面另一侧
  const t = dL / dp; // 放大比
  return [L[0] + (p[0] - L[0]) * t, L[1] + (p[1] - L[1]) * t, L[2] + (p[2] - L[2]) * t];
}

// 中心投影放大比：同一平行于投影面的平面上的图形，被放大 d(L,面)/d(L,点所在层)
export function enlargement(L, plane, depthCoord) {
  const dL = plane.value - L[plane.axis];
  const dp = depthCoord - L[plane.axis];
  if (dp * dL <= 0) return NaN;
  return dL / dp;
}

// ---- 欧拉旋转（与 Three.js Euler 'XYZ' 相同：M = Rx·Ry·Rz）----
export function eulerMatrix(ax, ay, az) {
  const a = Math.cos(ax), b = Math.sin(ax), c = Math.cos(ay), d = Math.sin(ay), e = Math.cos(az), f = Math.sin(az);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return [
    c * e, -c * f, d,
    af + be * d, ae - bf * d, -b * c,
    bf - ae * d, be + af * d, a * c,
  ];
}
export function transformPositions(src, m, out = new Float64Array(src.length)) {
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    out[i] = m[0] * x + m[1] * y + m[2] * z;
    out[i + 1] = m[3] * x + m[4] * y + m[5] * z;
    out[i + 2] = m[6] * x + m[7] * y + m[8] * z;
  }
  return out;
}

// Sutherland–Hodgman：二维多边形裁剪到矩形 [u0,u1]×[v0,v1]
export function clipToRect(poly, rect) {
  const [u0, u1, v0, v1] = rect;
  const edges = [
    (p) => p[0] - u0, (p) => u1 - p[0], (p) => p[1] - v0, (p) => v1 - p[1],
  ];
  let out = poly;
  for (const f of edges) {
    if (!out.length) break;
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length];
      const fa = f(a), fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
  }
  return out;
}

// 把整个三角网格投影到一个面上，返回裁剪后的二维三角形（u,v 扁平数组）
// mode: 'parallel' | 'central'
export function projectMesh(positions, plane, mode, L) {
  const out = [];
  let invalid = 0;
  const nt = positions.length / 9;
  const tri = [null, null, null];
  for (let t = 0; t < nt; t++) {
    let ok = true;
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      const p = [positions[o], positions[o + 1], positions[o + 2]];
      const q = mode === 'central' ? projectCentral(p, L, plane) : projectParallel(p, plane);
      if (!q) { ok = false; break; }
      tri[k] = toUV(plane, q);
    }
    if (!ok) { invalid++; continue; }
    const area = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]);
    if (Math.abs(area) < 1e-12) continue; // 侧面积为 0 的三角形（垂直于投影面）
    const poly = clipToRect(tri.slice(), plane.rect);
    for (let i = 1; i + 1 < poly.length; i++) out.push(poly[0][0], poly[0][1], poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]);
  }
  return { uv: out, invalid };
}

// ---- 三视图：可见/不可见线 ----
// edges: [{a,b,tris,feature}]（来自 geometry.classifyEdges），vertices/index 为焊接后的世界坐标
// 返回 { visible: [u1,v1,u2,v2,...], hidden: [...] }
export function viewLines(worldPos, vertices, edges, plane, opts = {}) {
  const d = plane.dir;
  const nt = worldPos.length / 9;
  // 面法向与观察方向
  const facing = new Float64Array(nt);
  const tu = new Float64Array(nt * 3), tv = new Float64Array(nt * 3), tdepth = new Float64Array(nt * 3);
  // depth：沿观察方向的坐标（越小越靠近观察者）
  const depthOf = (p) => p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    const A = [worldPos[o], worldPos[o + 1], worldPos[o + 2]], B = [worldPos[o + 3], worldPos[o + 4], worldPos[o + 5]], C = [worldPos[o + 6], worldPos[o + 7], worldPos[o + 8]];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    facing[t] = (nx * d[0] + ny * d[1] + nz * d[2]) / nl; // <0 朝向观察者
    [A, B, C].forEach((P, k) => { const uv = toUV(plane, P); tu[t * 3 + k] = uv[0]; tv[t * 3 + k] = uv[1]; tdepth[t * 3 + k] = depthOf(P); umin = Math.min(umin, uv[0]); umax = Math.max(umax, uv[0]); vmin = Math.min(vmin, uv[1]); vmax = Math.max(vmax, uv[1]); });
  }
  // 均匀网格加速遮挡查询
  const G = opts.grid || 48;
  const du = (umax - umin) / G || 1, dv = (vmax - vmin) / G || 1;
  const cells = Array.from({ length: G * G }, () => []);
  for (let t = 0; t < nt; t++) {
    const i3 = t * 3;
    const area = (tu[i3 + 1] - tu[i3]) * (tv[i3 + 2] - tv[i3]) - (tv[i3 + 1] - tv[i3]) * (tu[i3 + 2] - tu[i3]);
    if (Math.abs(area) < 1e-10) continue; // 侧向（垂直于投影面）的三角形不遮挡
    const a0 = Math.max(0, Math.floor((Math.min(tu[i3], tu[i3 + 1], tu[i3 + 2]) - umin) / du));
    const a1 = Math.min(G - 1, Math.floor((Math.max(tu[i3], tu[i3 + 1], tu[i3 + 2]) - umin) / du));
    const b0 = Math.max(0, Math.floor((Math.min(tv[i3], tv[i3 + 1], tv[i3 + 2]) - vmin) / dv));
    const b1 = Math.min(G - 1, Math.floor((Math.max(tv[i3], tv[i3 + 1], tv[i3 + 2]) - vmin) / dv));
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) cells[b * G + a].push(t);
  }
  const scale = Math.max(umax - umin, vmax - vmin) || 1;
  const depthEps = 1e-6 * scale + 1e-9;
  const occluded = (u, v, depth) => {
    const a = Math.min(G - 1, Math.max(0, Math.floor((u - umin) / du)));
    const b = Math.min(G - 1, Math.max(0, Math.floor((v - vmin) / dv)));
    for (const t of cells[b * G + a]) {
      const i3 = t * 3;
      const x0 = tu[i3], y0 = tv[i3], x1 = tu[i3 + 1], y1 = tv[i3 + 1], x2 = tu[i3 + 2], y2 = tv[i3 + 2];
      const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      const w0 = ((y1 - y2) * (u - x2) + (x2 - x1) * (v - y2)) / den;
      const w1 = ((y2 - y0) * (u - x2) + (x0 - x2) * (v - y2)) / den;
      const w2 = 1 - w0 - w1;
      const e = 1e-7;
      if (w0 <= e || w1 <= e || w2 <= e) continue; // 严格在三角形内部才算遮挡
      const z = w0 * tdepth[i3] + w1 * tdepth[i3 + 1] + w2 * tdepth[i3 + 2];
      if (z < depth - depthEps) return true;
    }
    return false;
  };
  const visible = [], hidden = [];
  const fe = opts.frontEps ?? 1e-6;
  for (const e of edges) {
    let draw = e.feature;
    if (!draw && e.tris.length === 2) {
      const s1 = facing[e.tris[0]] < -fe, s2 = facing[e.tris[1]] < -fe;
      draw = s1 !== s2; // 轮廓线（转向轮廓）
    }
    if (!draw) continue;
    const A = [vertices[e.a * 3], vertices[e.a * 3 + 1], vertices[e.a * 3 + 2]];
    const B = [vertices[e.b * 3], vertices[e.b * 3 + 1], vertices[e.b * 3 + 2]];
    const ua = toUV(plane, A), ub = toUV(plane, B);
    const plen = Math.hypot(ub[0] - ua[0], ub[1] - ua[1]);
    if (plen < 1e-7) continue; // 投影成点的边（垂直于投影面）
    const n = Math.max(2, Math.ceil(plen / (opts.step || 0.04)));
    const da = depthOf(A), db = depthOf(B);
    // 按采样点可见性分段
    let runStart = 0, runVis = null;
    const flush = (i0, i1, vis) => {
      const t0 = i0 / n, t1 = i1 / n;
      (vis ? visible : hidden).push(ua[0] + (ub[0] - ua[0]) * t0, ua[1] + (ub[1] - ua[1]) * t0, ua[0] + (ub[0] - ua[0]) * t1, ua[1] + (ub[1] - ua[1]) * t1);
    };
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const vis = !occluded(ua[0] + (ub[0] - ua[0]) * t, ua[1] + (ub[1] - ua[1]) * t, da + (db - da) * t);
      if (runVis === null) runVis = vis;
      else if (vis !== runVis) { flush(runStart, i, runVis); runStart = i; runVis = vis; }
    }
    flush(runStart, n, runVis);
  }
  return { visible: mergeCollinear(visible), hidden: mergeCollinear(hidden) };
}

// 合并首尾相接且共线的线段，减少碎片（虚线节奏更均匀）
function mergeCollinear(segs) {
  const out = [];
  for (let i = 0; i < segs.length; i += 4) {
    const n = out.length;
    if (n) {
      const x0 = out[n - 4], y0 = out[n - 3], x1 = out[n - 2], y1 = out[n - 1];
      const ax = segs[i], ay = segs[i + 1], bx = segs[i + 2], by = segs[i + 3];
      const cr = (x1 - x0) * (by - ay) - (y1 - y0) * (bx - ax);
      if (Math.abs(ax - x1) < 1e-9 && Math.abs(ay - y1) < 1e-9 && Math.abs(cr) < 1e-12) { out[n - 2] = bx; out[n - 1] = by; continue; }
    }
    out.push(segs[i], segs[i + 1], segs[i + 2], segs[i + 3]);
  }
  return out;
}

// 展开三视图：可见轮廓线（实线）/ 不可见轮廓线（虚线）按真实几何计算。
// 思路沿用主页面 src/views.js：把三角网格投影到视图平面，用栅格加速的“投影三角形深度比较”
// 判定棱线上每个采样点是否被挡住；在此基础上补充了：
//   1) 顶点焊接 + 共线棱分段（消除 CSG 产生的 T 形接点），按两侧面法线区分 尖棱 / 共面分割线 / 光滑过渡棱；
//   2) 光滑过渡棱只在“一侧朝向观察者、一侧背向”时画出 —— 即曲面转向轮廓线（如圆柱、孔壁的轮廓素线）；
//   3) 可见/不可见交界点用二分法细化；同一直线上实线覆盖虚线（GB 制图：可见线优先）；
//   4) 基础模型里“叠放”的组合体先做 CSG 并集，避免把埋在内部的面当成轮廓。
// 本文件只做几何计算与 SVG 输出，不依赖 DOM 之外的任何库，可在 Node 中测试。

const WELD = 1e6; // 顶点焊接精度 1e-6
const LINE_Q = 1e4; // 共线分组精度 1e-4
export const SMOOTH_DEG = 23; // 两侧面夹角小于此值视为光滑曲面上的离散棱（圆柱 28 等分=12.9°，圆环 16 等分=22.5°）
// 基础模型中标记 smooth 的回转体（母线离散较粗，如抛物面顶点处相邻母线段夹角约 23.3°）放宽到 30°
export const SMOOTH_DEG_REVOLVED = 30;
const COPLANAR_COS = Math.cos((0.02 * Math.PI) / 180); // 共面判定要严：球极附近相邻小面夹角可能只有 0.4°

// 第一角画法（GB/T 14692）：T 指向观察者；U 为画面向右，Vv 为画面向上。
export const VIEWS = {
  V: { key: 'V', label: '主视图 V 面', T: [0, -1, 0], U: [1, 0, 0], Vv: [0, 0, 1] }, // 由前向后投射
  W: { key: 'W', label: '左视图 W 面', T: [-1, 0, 0], U: [0, -1, 0], Vv: [0, 0, 1] }, // 由左向右投射
  H: { key: 'H', label: '俯视图 H 面', T: [0, 0, 1], U: [1, 0, 0], Vv: [0, 1, 0] }, // 由上向下投射
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);

function components(v, f) {
  const parent = v.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (const face of f) for (let k = 1; k < face.length; k++) { const a = find(face[0]), b = find(face[k]); if (a !== b) parent[a] = b; }
  const groups = new Map();
  for (const face of f) { const r = find(face[0]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(face); }
  return [...groups.values()];
}
function signedVolume(v, faces) {
  let s = 0;
  for (const face of faces) for (let k = 1; k + 1 < face.length; k++) s += dot3(v[face[0]], cross(v[face[k]], v[face[k + 1]])) / 6;
  return s;
}
function newell(pts) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}
// 平面多边形三角化：凸多边形扇形剖分，非凸多边形耳切法。
function triangulate(pts, n) {
  const m = pts.length;
  if (m === 3) return [[0, 1, 2]];
  let convex = true;
  for (let i = 0; i < m && convex; i++) {
    const c = cross(sub(pts[(i + 1) % m], pts[i]), sub(pts[(i + 2) % m], pts[(i + 1) % m]));
    if (dot3(c, n) < -1e-12) convex = false;
  }
  if (convex) { const t = []; for (let j = 1; j < m - 1; j++) t.push([0, j, j + 1]); return t; }
  const ax = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
  const i0 = (ax + 1) % 3, i1 = (ax + 2) % 3, sgn = n[ax] > 0 ? 1 : -1;
  const p = pts.map((q) => [q[i0], q[i1]]);
  const area2 = (a, b, c) => sgn * ((p[b][0] - p[a][0]) * (p[c][1] - p[a][1]) - (p[c][0] - p[a][0]) * (p[b][1] - p[a][1]));
  const idx = pts.map((_, i) => i), out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length], b = idx[k], c = idx[(k + 1) % idx.length];
      if (area2(a, b, c) <= 1e-14) continue;
      let inside = false;
      for (const q of idx) {
        if (q === a || q === b || q === c) continue;
        if (area2(a, b, q) >= 0 && area2(b, c, q) >= 0 && area2(c, a, q) >= 0) { inside = true; break; }
      }
      if (inside) continue;
      out.push([a, b, c]); idx.splice(k, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx.slice());
  else for (let j = 1; j < idx.length - 1; j++) out.push([idx[0], idx[j], idx[j + 1]]);
  return out;
}

// 拓扑预处理（与旋转无关，按模型缓存）。mesh = {v, f, advanced}；CSG = SolidCSG（用于叠放组合体求并）。
export function prepareModel(mesh, CSG, center = [0, 0, 1]) {
  const SMOOTH_COS = Math.cos(((mesh.smooth ? SMOOTH_DEG_REVOLVED : SMOOTH_DEG) * Math.PI) / 180);
  let v = mesh.v, f = mesh.f, unioned = false;
  if (!mesh.advanced && CSG) {
    const comps = components(v, f);
    if (comps.length > 1) {
      const solids = comps.map((faces) => CSG.fromMesh(v, signedVolume(v, faces) < 0 ? faces.map((x) => [...x].reverse()) : faces));
      const m = solids.reduce((a, b) => a.union(b)).mesh();
      v = m.v; f = m.f; unioned = true;
    }
  }
  const ids = new Map(), pos = [];
  const weld = (p) => { const k = Math.round(p[0] * WELD) + ',' + Math.round(p[1] * WELD) + ',' + Math.round(p[2] * WELD); let id = ids.get(k); if (id === undefined) { id = pos.length; ids.set(k, id); pos.push([...p]); } return id; };
  const polys = [], tris = [], triPoly = [];
  for (const face of f) {
    let ring = face.map((i) => weld(v[i]));
    ring = ring.filter((id, k) => id !== ring[(k + 1) % ring.length]);
    if (ring.length < 3) continue;
    const pts = ring.map((i) => pos[i]);
    let n = newell(pts); const l = len3(n);
    if (l < 1e-12) continue;
    n = n.map((x) => x / l);
    const pid = polys.length;
    polys.push({ ids: ring, n });
    for (const t of triangulate(pts, n)) { tris.push(ring[t[0]], ring[t[1]], ring[t[2]]); triPoly.push(pid); }
  }
  // 共线棱分组 → 在所有端点处切分（消除 T 形接点） → 统计每一小段两侧的面
  const lines = new Map();
  polys.forEach((poly, pid) => {
    const r = poly.ids;
    for (let k = 0; k < r.length; k++) {
      const a = pos[r[k]], b = pos[r[(k + 1) % r.length]];
      const d = sub(b, a), L = len3(d);
      if (L < 1e-9) continue;
      let dir = d.map((x) => x / L);
      const lead = Math.abs(dir[0]) > 1e-6 ? 0 : Math.abs(dir[1]) > 1e-6 ? 1 : 2;
      if (dir[lead] < 0) dir = dir.map((x) => -x);
      const ta = dot3(a, dir), tb = dot3(b, dir);
      const p0 = sub(a, dir.map((x) => x * ta));
      const key = [...dir, ...p0].map((x) => Math.round(x * LINE_Q)).join(',');
      let g = lines.get(key);
      if (!g) lines.set(key, (g = { dir, p0, edges: [] }));
      g.edges.push({ t0: Math.min(ta, tb), t1: Math.max(ta, tb), pid, pa: ta < tb ? a : b, pb: ta < tb ? b : a });
    }
  });
  const segs = [];
  let openSegs = 0;
  for (const g of lines.values()) {
    const bp = [];
    for (const e of g.edges) { bp.push([e.t0, e.pa], [e.t1, e.pb]); }
    bp.sort((a, b) => a[0] - b[0]);
    const ts = [];
    for (const x of bp) if (!ts.length || x[0] - ts[ts.length - 1][0] > 1e-7) ts.push(x);
    const slots = ts.slice(0, -1).map(() => []);
    for (const e of g.edges) {
      for (let k = 0; k < slots.length; k++) {
        if (ts[k][0] >= e.t0 - 1e-7 && ts[k + 1][0] <= e.t1 + 1e-7) slots[k].push(e.pid);
      }
    }
    slots.forEach((P, k) => {
      if (!P.length) return;
      const uniq = [...new Set(P)];
      let kind;
      if (uniq.length === 2) {
        const c = dot3(polys[uniq[0]].n, polys[uniq[1]].n);
        kind = c > COPLANAR_COS ? 0 : c > SMOOTH_COS ? 2 : 1;
      } else if (uniq.length === 1) { kind = 1; } else {
        let allFlat = true;
        for (let i = 1; i < uniq.length; i++) if (Math.abs(dot3(polys[uniq[0]].n, polys[uniq[i]].n)) < COPLANAR_COS) allFlat = false;
        kind = allFlat ? 0 : 1;
      }
      if (kind === 0 && uniq.length === 2) return;
      segs.push({ a: ts[k][1], b: ts[k + 1][1], P: uniq, kind });
    });
  }
  // CSG 的分割点可能偏离原棱线约 1e-5，导致极短的小段找不到另一侧的面：按距离再配对一次。
  const open = segs.filter((s) => s.P.length === 1);
  if (open.length) {
    const edgeList = [];
    polys.forEach((poly, pid) => { const r = poly.ids; for (let k = 0; k < r.length; k++) edgeList.push([pos[r[k]], pos[r[(k + 1) % r.length]], pid]); });
    const near = (m, a, b) => { const d = sub(b, a), L2 = dot3(d, d); if (L2 < 1e-18) return Infinity; const t = Math.max(0, Math.min(1, dot3(sub(m, a), d) / L2)); return len3(sub(m, [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t])); };
    for (const s of open) {
      const m = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2];
      const dir = sub(s.b, s.a), L = len3(dir);
      let best = -1, bestD = 5e-5;
      for (const [a, b, pid] of edgeList) {
        if (pid === s.P[0]) continue;
        const e = sub(b, a), el = len3(e);
        if (el < 1e-12 || Math.abs(dot3(e, dir)) < 0.98 * el * L) continue;
        const dd = near(m, a, b);
        if (dd < bestD) { bestD = dd; best = pid; }
      }
      if (best >= 0) {
        s.P.push(best);
        const c = dot3(polys[s.P[0]].n, polys[best].n);
        s.kind = c > COPLANAR_COS ? 0 : c > SMOOTH_COS ? 2 : 1;
      } else if (L < 0.02) s.kind = 0; // CSG 微小裂缝（长度 < 0.02），不画
      else openSegs++;
    }
  }
  for (let i = segs.length - 1; i >= 0; i--) if (segs[i].kind === 0) segs.splice(i, 1);
  let R = 0;
  for (const p of pos) R = Math.max(R, len3(sub(p, center)));
  return { pos, polys, tris: Int32Array.from(tris), triPoly: Int32Array.from(triPoly), segs, openSegs, unioned, R, center };
}

function viewOf(model, P, N, view, opts) {
  const { tris, segs } = model;
  const { U, Vv, T } = view;
  const nV = P.length, nT = tris.length / 3;
  const pu = new Float64Array(nV), pv = new Float64Array(nV), pd = new Float64Array(nV);
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (let i = 0; i < nV; i++) {
    pu[i] = dot3(P[i], U); pv[i] = dot3(P[i], Vv); pd[i] = dot3(P[i], T);
    umin = Math.min(umin, pu[i]); umax = Math.max(umax, pu[i]); vmin = Math.min(vmin, pv[i]); vmax = Math.max(vmax, pv[i]);
  }
  const span = Math.max(umax - umin, vmax - vmin, 1e-6);
  const G = opts.grid || 64;
  const cw = (umax - umin) / G + 1e-9, ch = (vmax - vmin) / G + 1e-9;
  const cells = Array.from({ length: G * G }, () => []);
  const area = new Float64Array(nT);
  const mask = [];
  for (let t = 0; t < nT; t++) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    const ar = (pu[b] - pu[a]) * (pv[c] - pv[a]) - (pu[c] - pu[a]) * (pv[b] - pv[a]);
    area[t] = ar;
    if (Math.abs(ar) < 1e-10 * span * span) continue; // 与投射方向平行的面投影成线，不遮挡
    if (dot3(N[model.triPoly[t]], T) > 1e-9) mask.push(ar > 0 ? [a, b, c] : [a, c, b]);
    const i0 = Math.max(0, Math.floor((Math.min(pu[a], pu[b], pu[c]) - umin) / cw)), i1 = Math.min(G - 1, Math.floor((Math.max(pu[a], pu[b], pu[c]) - umin) / cw));
    const j0 = Math.max(0, Math.floor((Math.min(pv[a], pv[b], pv[c]) - vmin) / ch)), j1 = Math.min(G - 1, Math.floor((Math.max(pv[a], pv[b], pv[c]) - vmin) / ch));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * G + i].push(t);
  }
  const epsD = (opts.depthEps ?? 1e-4) * span, epsB = -1e-9;
  function occluded(u, v, d) {
    const i = Math.min(G - 1, Math.max(0, Math.floor((u - umin) / cw))), j = Math.min(G - 1, Math.max(0, Math.floor((v - vmin) / ch)));
    const list = cells[j * G + i];
    for (let k = 0; k < list.length; k++) {
      const t = list[k], a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2], ar = area[t];
      const w0 = ((pu[b] - u) * (pv[c] - v) - (pu[c] - u) * (pv[b] - v)) / ar; if (w0 < epsB) continue;
      const w1 = ((pu[c] - u) * (pv[a] - v) - (pu[a] - u) * (pv[c] - v)) / ar; if (w1 < epsB) continue;
      const w2 = 1 - w0 - w1; if (w2 < epsB) continue;
      if (w0 * pd[a] + w1 * pd[b] + w2 * pd[c] > d + epsD) return true;
    }
    return false;
  }
  const raw = [];
  const step = span / (opts.samples || 240);
  for (const s of segs) {
    if (s.kind === 2) {
      const s1 = dot3(N[s.P[0]], T), s2 = dot3(N[s.P[1]], T);
      if (s1 > 1e-9 === s2 > 1e-9) continue; // 光滑棱不在转向轮廓上
    }
    const A = s.A, B = s.B;
    const a = [dot3(A, U), dot3(A, Vv), dot3(A, T)], b = [dot3(B, U), dot3(B, Vv), dot3(B, T)];
    const du = b[0] - a[0], dv = b[1] - a[1], dd = b[2] - a[2];
    const L = Math.hypot(du, dv);
    if (L < 1e-7 * span) continue; // 垂直于投影面的棱，投影成点
    const at = (x) => occluded(a[0] + du * x, a[1] + dv * x, a[2] + dd * x);
    const n = Math.min(400, Math.max(1, Math.ceil(L / step)));
    let start = 0, prevX = 0.5 / n, prev = at(prevX);
    for (let i = 1; i <= n; i++) {
      if (i < n) {
        const x = (i + 0.5) / n, st = at(x);
        if (st === prev) { prevX = x; continue; }
        let lo = prevX, hi = x;
        for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (at(m) === prev) lo = m; else hi = m; }
        const cut = (lo + hi) / 2;
        raw.push([a[0] + du * start, a[1] + dv * start, a[0] + du * cut, a[1] + dv * cut, prev]);
        start = cut; prev = st; prevX = x;
      } else raw.push([a[0] + du * start, a[1] + dv * start, b[0], b[1], prev]);
    }
  }
  const { visible, hidden } = cleanup(raw, span);
  const tri = new Float64Array(mask.length * 6);
  mask.forEach(([a, b, c], k) => tri.set([pu[a], pv[a], pu[b], pv[b], pu[c], pv[c]], k * 6));
  return { visible, hidden, mask: tri, bbox: [umin, vmin, umax, vmax] };
}

// 同一直线上的线段合并；可见线覆盖不可见线。
function cleanup(raw, span) {
  const groups = new Map(), tol = 1e-6 * span;
  for (const [x1, y1, x2, y2, hid] of raw) {
    let dx = x2 - x1, dy = y2 - y1; const L = Math.hypot(dx, dy); if (L < tol) continue;
    dx /= L; dy /= L;
    if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
    const off = -dy * x1 + dx * y1;
    const key = Math.round(dx * LINE_Q) + ',' + Math.round(dy * LINE_Q) + ',' + Math.round(off * LINE_Q);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { dx, dy, off, vis: [], hid: [] }));
    const t1 = dx * x1 + dy * y1, t2 = dx * x2 + dy * y2;
    (hid ? g.hid : g.vis).push([Math.min(t1, t2), Math.max(t1, t2)]);
  }
  const merge = (list) => { list.sort((a, b) => a[0] - b[0]); const out = []; for (const s of list) { const l = out[out.length - 1]; if (l && s[0] <= l[1] + tol) l[1] = Math.max(l[1], s[1]); else out.push([...s]); } return out; };
  const minus = (list, cut) => { let out = list; for (const [c0, c1] of cut) { const next = []; for (const [a, b] of out) { if (c1 <= a + tol || c0 >= b - tol) { next.push([a, b]); continue; } if (c0 > a + tol) next.push([a, c0]); if (c1 < b - tol) next.push([c1, b]); } out = next; } return out.filter(([a, b]) => b - a > tol * 10); };
  const visible = [], hidden0 = [];
  for (const g of groups.values()) {
    const p = (t) => [g.dx * t - g.dy * g.off, g.dy * t + g.dx * g.off];
    const vis = merge(g.vis), hid = minus(merge(g.hid), vis);
    for (const [a, b] of vis) visible.push([...p(a), ...p(b)]);
    for (const [a, b] of hid) hidden0.push([...p(a), ...p(b)]);
  }
  // 与实线几乎重合（不同离散化的同一条曲线、相距 < 0.15% 尺寸）的虚线部分也去掉
  const cover = 1.5e-3 * span, cell = Math.max(cover * 8, span / 64), grid = new Map();
  const gk = (i, j) => i + ',' + j;
  visible.forEach((s, idx) => {
    const i0 = Math.floor((Math.min(s[0], s[2]) - cover) / cell), i1 = Math.floor((Math.max(s[0], s[2]) + cover) / cell);
    const j0 = Math.floor((Math.min(s[1], s[3]) - cover) / cell), j1 = Math.floor((Math.max(s[1], s[3]) + cover) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = gk(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(idx); }
  });
  const covered = (x, y, hx, hy) => {
    const list = grid.get(gk(Math.floor(x / cell), Math.floor(y / cell)));
    if (!list) return false;
    for (const idx of list) {
      const s = visible[idx], dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy;
      if (Math.abs(dx * hy - dy * hx) > 0.17 * Math.sqrt(L2)) continue; // 只去掉与实线近似平行（< 10°）的重合虚线，不截短与实线相交的虚线端头
      const t = L2 ? Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / L2)) : 0;
      if (Math.hypot(x - s[0] - dx * t, y - s[1] - dy * t) < cover) return true;
    }
    return false;
  };
  const hidden = [];
  for (const s of hidden0) {
    const L = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.max(1, Math.ceil(L / (span / 600)));
    const hx = (s[2] - s[0]) / L, hy = (s[3] - s[1]) / L;
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const keep = i < n && !covered(s[0] + (s[2] - s[0]) * (i + 0.5) / n, s[1] + (s[3] - s[1]) * (i + 0.5) / n, hx, hy);
      if (keep && start < 0) start = i;
      if (!keep && start >= 0) {
        const a = start / n, b = i / n;
        if ((b - a) * L > tol * 10) hidden.push([s[0] + (s[2] - s[0]) * a, s[1] + (s[3] - s[1]) * a, s[0] + (s[2] - s[0]) * b, s[1] + (s[3] - s[1]) * b]);
        start = -1;
      }
    }
  }
  return { visible, hidden };
}

// xf：把模型点变换到世界坐标（与 3D 视图同一旋转）。返回三个视图（视图平面坐标 u,v）与展开布局。
export function computeViews(model, xf, opts = {}) {
  const P = model.pos.map(xf);
  const o = xf([0, 0, 0]);
  const N = model.polys.map((p) => sub(xf(p.n), o));
  for (const s of model.segs) { s.A = xf(s.a); s.B = xf(s.b); }
  const wc = xf(model.center);
  const gap = opts.gap ?? 0.35, off = model.R + gap;
  const S = Math.ceil((2 * off) / 0.25) * 0.25;
  // 视图平面坐标 → 展开图坐标（原点 O；X 轴向左、Z 轴向上、Y 轴分别向右和向下）
  const place = {
    V: (u, v) => [u - wc[0] - off, v - wc[2] + off],
    W: (u, v) => [u + wc[1] + off, v - wc[2] + off],
    H: (u, v) => [u - wc[0] - off, v - wc[1] - off],
  };
  const out = { S, off, wc, views: {}, world: { P, tris: model.tris } };
  for (const k of ['V', 'W', 'H']) {
    const r = viewOf(model, P, N, VIEWS[k], opts), f = place[k];
    const mapSeg = (s) => [...f(s[0], s[1]), ...f(s[2], s[3])];
    const mask = new Float64Array(r.mask.length);
    for (let i = 0; i < mask.length; i += 2) { const q = f(r.mask[i], r.mask[i + 1]); mask[i] = q[0]; mask[i + 1] = q[1]; }
    out.views[k] = { visible: r.visible.map(mapSeg), hidden: r.hidden.map(mapSeg), mask, bbox: [...f(r.bbox[0], r.bbox[1]), ...f(r.bbox[2], r.bbox[3])] };
  }
  return out;
}

// 首尾相接的小段连成折线：虚线的点划节奏不会在每个离散小段处重新开始（否则细分的圆看起来像实线）。
export function chainPolylines(list) {
  const key = (x, y) => Math.round(x * 1e5) + ',' + Math.round(y * 1e5);
  const ends = new Map(), used = new Uint8Array(list.length), out = [];
  list.forEach((s, i) => { for (const k of [key(s[0], s[1]), key(s[2], s[3])]) { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
  const next = (x, y) => { const c = ends.get(key(x, y)); if (c) for (const i of c) if (!used[i]) return i; return -1; };
  for (let i = 0; i < list.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const pl = [[list[i][0], list[i][1]], [list[i][2], list[i][3]]];
    for (const forward of [true, false]) {
      for (;;) {
        const end = forward ? pl[pl.length - 1] : pl[0], j = next(end[0], end[1]);
        if (j < 0) break;
        used[j] = 1;
        const s = list[j], same = key(s[0], s[1]) === key(end[0], end[1]), far = same ? [s[2], s[3]] : [s[0], s[1]];
        if (forward) pl.push(far); else pl.unshift(far);
      }
    }
    out.push(pl);
  }
  return out;
}

const fmt = (x) => (Math.round(x * 10000) / 10000).toString();
// 生成展开图 SVG（y 向上的展开坐标在 SVG 中取负）。
export function unfoldSVG(res, opts = {}) {
  const { S } = res, m = S * 0.12, minor = 0.25, major = 1;
  const X = (x) => fmt(x), Y = (y) => fmt(-y);
  const fs = (S * 0.052).toFixed(3);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(-S - m)} ${fmt(-S - m)} ${fmt(2 * S + 2 * m)} ${fmt(2 * S + 2 * m)}" preserveAspectRatio="xMidYMid meet" font-family="-apple-system,'PingFang SC','Noto Sans CJK SC','Microsoft YaHei',sans-serif">`;
  s += `<rect x="${fmt(-S - m)}" y="${fmt(-S - m)}" width="${fmt(2 * S + 2 * m)}" height="${fmt(2 * S + 2 * m)}" fill="#f3f5f7"/>`;
  const walls = { V: [-S, 0], W: [0, 0], H: [-S, -S] };
  for (const [k, [x0, y0]] of Object.entries(walls)) {
    s += `<rect class="wall wall-${k}" x="${X(x0)}" y="${Y(y0 + S)}" width="${fmt(S)}" height="${fmt(S)}" fill="${k === 'H' ? '#e6e7ea' : '#e2e3e6'}"/>`;
    let gm = '', gM = '';
    for (let t = minor; t < S - 1e-9; t += minor) {
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      const seg = `M${X(x0 + t)} ${Y(y0)}V${Y(y0 + S)}M${X(x0)} ${Y(y0 + t)}H${X(x0 + S)}`;
      if (isMajor) gM += seg; else gm += seg;
    }
    s += `<path d="${gm}" stroke="#f7f7f8" stroke-width="1" vector-effect="non-scaling-stroke" fill="none"/><path d="${gM}" stroke="#c3c6cc" stroke-width="1" vector-effect="non-scaling-stroke" fill="none"/>`;
  }
  const e = S + m * 0.55;
  s += `<g class="axes" stroke-width="1.6" vector-effect="non-scaling-stroke" fill="none">`;
  s += `<path d="M0 0H${X(-e)}" stroke="#d0473f" vector-effect="non-scaling-stroke"/><path d="M0 0V${Y(e)}" stroke="#3d72d9" vector-effect="non-scaling-stroke"/>`;
  s += `<path d="M0 0H${X(e)}" stroke="#2f9a4d" vector-effect="non-scaling-stroke"/><path d="M0 0V${Y(-e)}" stroke="#2f9a4d" vector-effect="non-scaling-stroke"/></g>`;
  const lab = (t, x, y, c, anchor = 'middle', size = fs, weight = 700) => `<text x="${X(x)}" y="${Y(y)}" fill="${c}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="middle">${t}</text>`;
  s += lab('X', -e - m * 0.22, 0, '#d0473f') + lab('Z', 0, e + m * 0.22, '#3d72d9') + lab('Y', e + m * 0.22, 0, '#2f9a4d') + lab('Y', 0, -e - m * 0.22, '#2f9a4d') + lab('O', m * 0.2, -m * 0.2, '#3e587e');
  const pad = S * 0.04;
  const labels = { V: [-S + pad, S - pad, 'start'], W: [S - pad, S - pad, 'end'], H: [-S + pad, -S + pad, 'start'] };
  for (const k of ['V', 'W', 'H']) {
    const v = res.views[k];
    let d = '';
    for (let i = 0; i < v.mask.length; i += 6) d += `M${X(v.mask[i])} ${Y(v.mask[i + 1])}L${X(v.mask[i + 2])} ${Y(v.mask[i + 3])}L${X(v.mask[i + 4])} ${Y(v.mask[i + 5])}Z`;
    const segPath = (list) => chainPolylines(list).map((pl) => 'M' + pl.map((q) => `${X(q[0])} ${Y(q[1])}`).join('L')).join('');
    s += `<g class="view view-${k}" data-view="${k}">`;
    s += `<path class="mask" d="${d}" fill="#f08a8f" fill-opacity="0.5" stroke="none"/>`;
    s += `<path class="hidden-lines" d="${segPath(v.hidden)}" stroke="#1d2b45" stroke-width="1.4" stroke-dasharray="5 3.5" stroke-linecap="butt" fill="none" vector-effect="non-scaling-stroke"/>`;
    s += `<path class="visible-lines" d="${segPath(v.visible)}" stroke="#1d2b45" stroke-width="2" stroke-linecap="round" fill="none" vector-effect="non-scaling-stroke"/>`;
    const [lx, ly, an] = labels[k];
    s += lab(VIEWS[k].label, lx, ly, '#3e587e', an) + '</g>';
  }
  if (opts.title) s += lab(opts.title, 0, -S - m * 0.5, '#5b6b7a', 'middle', (S * 0.045).toFixed(3), 600);
  return s + '</svg>';
}

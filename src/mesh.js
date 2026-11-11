// 多边形网格 {v, f, s?} -> 主页引擎用的三角网格（纯 JS，可在 Node 中测试）。
// 用于 geometry-76 的 176 个模型（基础网格 + SolidCSG 布尔运算结果）。
//   1) 顶点焊接（容差 WELD_EPS）；
//   2) 消除 T 形接点：BSP/CSG 会把相邻面切成不同的小段，一条棱一侧是长边、另一侧是几段短边。
//      把落在多边形边上的其它顶点插进这条边，再三角化，保证每条棱两侧各恰好一个三角形；
//   3) 三角化：凸多边形扇形剖分、非凸多边形耳切法；边上插了点的三角形改用“重心扇形”剖分；
//   4) 每个三角形带一个光滑曲面编号 tag（同一圆柱面 / 球面 / 回转面为同一编号，-1 = 平面），
//      供 solids.js 区分「曲面上的离散棱（不画，只在轮廓处画）」和「真实棱线」。

export const WELD_EPS = 1e-5;   // 焊接容差（模型单位，模型尺寸约 2~3）
export const TJ_EPS = 4e-5;     // 顶点到边的距离小于它就算落在边上（CSG 共面容差为 1e-5）
export const REPAIR_EPS = 3e-4; // 只用于开口边端点（真实特征尺寸 ≥ 0.1）
export const HOLE_MAX = 0.01;   // 自动补的小缝：周长 < 模型尺寸的 1%

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function newell(pts) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

// 平面多边形三角化：返回局部下标三元组。
export function triangulatePolygon(pts, n) {
  const m = pts.length;
  if (m === 3) return [[0, 1, 2]];
  let convex = true;
  for (let i = 0; i < m && convex; i++) {
    const c = cross(sub(pts[(i + 1) % m], pts[i]), sub(pts[(i + 2) % m], pts[(i + 1) % m]));
    if (dot(c, n) < -1e-12) convex = false;
  }
  if (convex) { const t = []; for (let j = 1; j < m - 1; j++) t.push([0, j, j + 1]); return t; }
  const ax = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
  const i0 = (ax + 1) % 3, i1 = (ax + 2) % 3, sgn = n[ax] > 0 ? 1 : -1;
  const p = pts.map((q) => [q[i0], q[i1]]);
  const area2 = (a, b, c) => sgn * ((p[b][0] - p[a][0]) * (p[c][1] - p[a][1]) - (p[c][0] - p[a][0]) * (p[b][1] - p[a][1]));
  const idx = pts.map((_, i) => i), out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 100000) {
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

// 均匀网格上的点集（焊接与“点落在边上”的查询共用）
class PointGrid {
  constructor(h) { this.h = h; this.cells = new Map(); }
  key(x, y, z) { const h = this.h; return Math.floor(x / h) + ',' + Math.floor(y / h) + ',' + Math.floor(z / h); }
  add(id, p) { const k = this.key(p[0], p[1], p[2]); let c = this.cells.get(k); if (!c) this.cells.set(k, (c = [])); c.push(id); }
  near(p, r, out) {
    const h = this.h;
    const x0 = Math.floor((p[0] - r) / h), x1 = Math.floor((p[0] + r) / h);
    const y0 = Math.floor((p[1] - r) / h), y1 = Math.floor((p[1] + r) / h);
    const z0 = Math.floor((p[2] - r) / h), z1 = Math.floor((p[2] + r) / h);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const c = this.cells.get(x + ',' + y + ',' + z); if (c) for (const id of c) out.add(id);
    }
    return out;
  }
}

// mesh: {v:[[x,y,z]...], f:[[i,j,k,...]...], s?: [tag per face]}（面为外法线方向逆时针）
// 返回 {verts:number[], tris:number[], triTag:number[], stats}
export function polygonMeshToTriangles(mesh) {
  const { v, f } = mesh;
  const tagOf = (i) => (mesh.s && mesh.s[i] != null && mesh.s[i] >= 0 ? mesh.s[i] : -1);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of v) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9);

  // 1) 焊接
  const pos = [];
  const wg = new PointGrid(WELD_EPS * 4);
  const remap = new Int32Array(v.length);
  const cand = new Set();
  for (let i = 0; i < v.length; i++) {
    const p = v[i];
    cand.clear(); wg.near(p, WELD_EPS, cand);
    let hit = -1;
    for (const j of cand) { const q = pos[j]; if (Math.abs(q[0] - p[0]) <= WELD_EPS && Math.abs(q[1] - p[1]) <= WELD_EPS && Math.abs(q[2] - p[2]) <= WELD_EPS) { hit = j; break; } }
    if (hit < 0) { hit = pos.length; pos.push([p[0], p[1], p[2]]); wg.add(hit, p); }
    remap[i] = hit;
  }
  const polys = [];
  let dropped = 0;
  f.forEach((face, fi) => {
    let ring = face.map((i) => remap[i]);
    ring = ring.filter((id, k) => id !== ring[(k + 1) % ring.length]);
    if (ring.length < 3) { dropped++; return; }
    const n = newell(ring.map((i) => pos[i]));
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-14) { dropped++; return; }
    polys.push({ ring, n: [n[0] / l, n[1] / l, n[2] / l], tag: tagOf(fi) });
  });

  // 2) T 形接点：查找落在每条多边形边内部的顶点
  const usedIds = new Set(); for (const p of polys) for (const i of p.ring) usedIds.add(i);
  const h = size / 40;
  const grid = new PointGrid(h);
  for (const i of usedIds) grid.add(i, pos[i]);
  const edgeInserts = new Map(); // "a,b" -> 有序插入点
  let inserted = 0;
  const near = new Set();
  function insertsFor(a, b) {
    const key = a + ',' + b;
    if (edgeInserts.has(key)) return edgeInserts.get(key);
    const A = pos[a], B = pos[b], d = sub(B, A), L2 = dot(d, d), L = Math.sqrt(L2);
    near.clear();
    const steps = Math.max(1, Math.ceil(L / (h / 3)));
    const r = h / 3 + TJ_EPS;
    for (let s = 0; s <= steps; s++) { const t = s / steps; grid.near([A[0] + d[0] * t, A[1] + d[1] * t, A[2] + d[2] * t], r, near); }
    const out = [];
    for (const q of near) {
      if (q === a || q === b) continue;
      const w = sub(pos[q], A);
      const t = dot(w, d) / L2;
      if (t * L <= TJ_EPS || (1 - t) * L <= TJ_EPS) continue;
      const c = cross(w, d);
      if (Math.hypot(c[0], c[1], c[2]) / L > TJ_EPS) continue;
      out.push([t, q]);
    }
    out.sort((x, y) => x[0] - y[0]);
    const ids = out.map((x) => x[1]);
    edgeInserts.set(key, ids);
    return ids;
  }

  // 3) 三角化
  const tris = [], triTag = [];
  const pushTri = (a, b, c, tag) => { tris.push(a, b, c); triTag.push(tag); };
  for (const poly of polys) {
    const ring = poly.ring, m = ring.length;
    const ins = ring.map((a, k) => insertsFor(a, ring[(k + 1) % m]));
    const local = triangulatePolygon(ring.map((i) => pos[i]), poly.n);
    for (const [i, j, k] of local) {
      // 三角形的边若是多边形的边（相邻下标），带上该边的插入点
      const sideIns = (x, y) => ((y === (x + 1) % m) ? ins[x] : (x === (y + 1) % m) ? [...ins[y]].reverse() : []);
      const e0 = sideIns(i, j), e1 = sideIns(j, k), e2 = sideIns(k, i);
      if (!e0.length && !e1.length && !e2.length) { pushTri(ring[i], ring[j], ring[k], poly.tag); continue; }
      const loop = [ring[i], ...e0, ring[j], ...e1, ring[k], ...e2];
      inserted += e0.length + e1.length + e2.length;
      const P = [pos[ring[i]], pos[ring[j]], pos[ring[k]]];
      const c = pos.length;
      pos.push([(P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3, (P[0][2] + P[1][2] + P[2][2]) / 3]);
      for (let q = 0; q < loop.length; q++) pushTri(c, loop[q], loop[(q + 1) % loop.length], poly.tag);
    }
  }

  // 4) 去掉退化三角形
  const T = [], TT = [];
  let degenerate = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    const cr = cross(sub(pos[b], pos[a]), sub(pos[c], pos[a]));
    if (Math.hypot(cr[0], cr[1], cr[2]) < 1e-14) { degenerate++; continue; }
    T.push(a, b, c); TT.push(triTag[t / 3]);
  }
  // 5) 修 CSG 裂缝：同一条棱两侧的端点偏差 1e-5 ~ 1e-4（超出焊接容差），形成细长缝或 T 形接点。
  //    只在开口边的端点之间按 REPAIR_EPS 再焊接一次，并把落在开口边上的开口端点插进去；最多 3 轮。
  const rep = repairOpenEdges(T, TT, pos, REPAIR_EPS);
  // 6) 补 CSG 微小裂缝：BSP 切分的数值误差会留下边长 1e-4 ~ 3e-3 的三角形小缝（超出焊接容差）。
  //    找出开口边组成的闭合环，周长 < HOLE_MAX * 模型尺寸的直接扇形补面；更大的开口只有整圈共面
//    （CSG 漏掉了平面上的一块多边形）才按平面多边形补，其余原样保留并计数。
  const fill = fillSmallHoles(T, pos, size * HOLE_MAX, size * 1e-5);
  for (const [a, b, c] of fill.tris) { T.push(a, b, c); TT.push(fill.tag); }
  // 只保留被三角形用到的顶点
  const keep = new Int32Array(pos.length).fill(-1);
  const verts = [];
  for (let i = 0; i < T.length; i++) { const a = T[i]; if (keep[a] < 0) { keep[a] = verts.length / 3; verts.push(pos[a][0], pos[a][1], pos[a][2]); } T[i] = keep[a]; }
  return { verts, tris: T, triTag: TT, stats: { faces: f.length, polys: polys.length, dropped, inserted, degenerate, size, repairWelded: rep.welded, repairSplit: rep.split, holesFilled: fill.filled, holeMaxPerimeter: fill.maxPerimeter, planarHolesFilled: fill.planar, planarHoleMaxPerimeter: fill.maxPlanar, holesLeft: fill.left } };
}

function openHalfEdges(T) {
  const count = new Map();
  const key = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { const kk = key(T[t + k], T[t + (k + 1) % 3]); count.set(kk, (count.get(kk) || 0) + 1); }
  const out = [];
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) if (count.get(key(T[t + k], T[t + (k + 1) % 3])) === 1) out.push([t / 3, k]);
  return out;
}
function repairOpenEdges(T, TT, pos, eps) {
  let welded = 0, split = 0;
  for (let round = 0; round < 3; round++) {
    let open = openHalfEdges(T);
    if (!open.length) break;
    // a) 开口端点之间焊接
    const bv = [...new Set(open.flatMap(([t, k]) => [T[t * 3 + k], T[t * 3 + (k + 1) % 3]]))];
    const g = new PointGrid(eps * 2), rep = new Map(), reps = [];
    for (const i of bv) {
      const c = new Set(); g.near(pos[i], eps, c);
      let hit = -1;
      for (const j of c) { const q = pos[j], p = pos[i]; if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) <= eps) { hit = j; break; } }
      if (hit < 0) { g.add(i, pos[i]); rep.set(i, i); } else { rep.set(i, hit); welded++; }
    }
    let changed = false;
    for (let i = 0; i < T.length; i++) { const r = rep.get(T[i]); if (r !== undefined && r !== T[i]) { T[i] = r; changed = true; } }
    if (changed) {
      let w = 0;
      for (let t = 0; t < T.length; t += 3) {
        const a = T[t], b = T[t + 1], c = T[t + 2];
        if (a === b || b === c || a === c) continue;
        T[w] = a; T[w + 1] = b; T[w + 2] = c; TT[w / 3] = TT[t / 3]; w += 3;
      }
      T.length = w; TT.length = w / 3;
    }
    // b) 开口端点落在另一条开口边上：把那个三角形一分为二
    open = openHalfEdges(T);
    if (!open.length) break;
    const bset = [...new Set(open.flatMap(([t, k]) => [T[t * 3 + k], T[t * 3 + (k + 1) % 3]]))];
    const g2 = new PointGrid(0.02);
    for (const i of bset) g2.add(i, pos[i]);
    const splits = new Map(); // tri -> {k, qs}
    for (const [t, k] of open) {
      const a = T[t * 3 + k], b = T[t * 3 + (k + 1) % 3];
      const A = pos[a], B = pos[b], d = sub(B, A), L2 = dot(d, d), L = Math.sqrt(L2);
      const cand = new Set();
      const steps = Math.max(1, Math.ceil(L / 0.006));
      for (let s = 0; s <= steps; s++) { const u = s / steps; g2.near([A[0] + d[0] * u, A[1] + d[1] * u, A[2] + d[2] * u], 0.004 + eps, cand); }
      const qs = [];
      for (const q of cand) {
        if (q === a || q === b) continue;
        const w = sub(pos[q], A), u = dot(w, d) / L2;
        if (u * L <= eps || (1 - u) * L <= eps) continue;
        const c = cross(w, d);
        if (Math.hypot(c[0], c[1], c[2]) / L > eps) continue;
        qs.push([u, q]);
      }
      if (qs.length && !splits.has(t)) { qs.sort((x, y) => x[0] - y[0]); splits.set(t, { k, qs: qs.map((x) => x[1]) }); }
    }
    if (!splits.size) continue;
    for (const [t, { k, qs }] of splits) {
      const a = T[t * 3 + k], b = T[t * 3 + (k + 1) % 3], c = T[t * 3 + (k + 2) % 3];
      const chain = [a, ...qs, b];
      T[t * 3] = chain[0]; T[t * 3 + 1] = chain[1]; T[t * 3 + 2] = c;
      for (let i = 1; i + 1 < chain.length; i++) { T.push(chain[i], chain[i + 1], c); TT.push(TT[t]); }
      split += qs.length;
    }
  }
  return { welded, split };
}

function fillSmallHoles(T, pos, maxPerimeter, planarTol) {
  const count = new Map();
  const key = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { const kk = key(T[t + k], T[t + (k + 1) % 3]); count.set(kk, (count.get(kk) || 0) + 1); }
  const next = new Map(); // 反向开口边 b -> [a]
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = T[t + k], b = T[t + (k + 1) % 3];
    if (count.get(key(a, b)) === 1) { let l = next.get(b); if (!l) next.set(b, (l = [])); l.push(a); }
  }
  const out = [];
  let filled = 0, left = 0, maxP = 0, planar = 0, maxPlanar = 0;
  const used = new Set();
  const dist = (a, b) => Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1], pos[a][2] - pos[b][2]);
  for (const start of next.keys()) {
    for (const first of next.get(start)) {
      if (used.has(start + '>' + first)) continue;
      const loop = [start];
      let cur = first, prev = start, ok = true, per = dist(start, first);
      used.add(start + '>' + first);
      while (cur !== start) {
        loop.push(cur);
        if (loop.length > 4096) { ok = false; break; }
        const cand = (next.get(cur) || []).filter((x) => !used.has(cur + '>' + x));
        if (!cand.length) { ok = false; break; }
        const nx = cand[0];
        used.add(cur + '>' + nx);
        per += dist(cur, nx);
        prev = cur; cur = nx;
      }
      if (!ok || loop.length < 3) { left++; continue; }
      if (per <= maxPerimeter) {
        maxP = Math.max(maxP, per);
        for (let i = 1; i + 1 < loop.length; i++) out.push([loop[0], loop[i], loop[i + 1]]);
        filled++; continue;
      }
      // 较大的开口：只有整圈都在同一平面上（CSG 漏掉了平面上的一块多边形）才补，按平面多边形三角化
      const pts = loop.map((i) => pos[i]);
      const n = newell(pts), l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-12) { left++; continue; }
      const nn = [n[0] / l, n[1] / l, n[2] / l], d0 = dot(nn, pts[0]);
      if (pts.some((p) => Math.abs(dot(nn, p) - d0) > planarTol)) { left++; continue; }
      for (const [i, j, k] of triangulatePolygon(pts, nn)) out.push([loop[i], loop[j], loop[k]]);
      planar++; maxPlanar = Math.max(maxPlanar, per);
    }
  }
  return { tris: out, filled, left, maxPerimeter: maxP, planar, maxPlanar, tag: -1 };
}

// 拓扑检查：开口边（只有一个三角形）、非流形边（≥3 个三角形）、方向不一致的边
export function meshTopology(tris) {
  const m = new Map();
  for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = tris[t + k], b = tris[t + (k + 1) % 3];
    const key = a < b ? a + ',' + b : b + ',' + a;
    let e = m.get(key); if (!e) m.set(key, (e = { n: 0, s: 0 })); e.n++; e.s += a < b ? 1 : -1;
  }
  let open = 0, nonManifold = 0, flipped = 0;
  for (const e of m.values()) { if (e.n === 1) open++; else if (e.n > 2) nonManifold++; else if (e.s !== 0) flipped++; }
  return { edges: m.size, open, nonManifold, flipped };
}

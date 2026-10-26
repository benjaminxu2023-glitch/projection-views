// 投影与视图 — 几何体构建（纯 JS，无依赖，可在 Node 中测试）
// 坐标约定：X 向右，Y 向后（远离观察者），Z 向上。单位任意，最终统一归一化到最大半尺寸 = 1。
// 每个几何体由若干封闭"部件"组成，部件是外法线朝外的三角形列表。

const TAU = Math.PI * 2;
const EPS = 1e-9;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

function triArea(a, b, c) { return len(cross(sub(b, a), sub(c, a))) / 2; }

// 多边形面（凸）→ 扇形三角化
function fan(poly, out) {
  for (let i = 1; i + 1 < poly.length; i++) out.push([poly[0], poly[i], poly[i + 1]]);
}

function regularPolygon(n, r, phase = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

function polyArea2D(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
const ccw = (p) => (polyArea2D(p) < 0 ? p.slice().reverse() : p);

// 耳切法三角化简单多边形（可凹，无洞）。返回索引三元组。
export function earClip(poly) {
  const p = ccw(poly);
  const flipped = p !== poly;
  const idx = p.map((_, i) => i);
  const tris = [];
  const isConvex = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > EPS;
  const inside = (pt, a, b, c) => {
    const d1 = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
    const d2 = (c[0] - b[0]) * (pt[1] - b[1]) - (c[1] - b[1]) * (pt[0] - b[0]);
    const d3 = (a[0] - c[0]) * (pt[1] - c[1]) - (a[1] - c[1]) * (pt[0] - c[0]);
    return d1 >= -EPS && d2 >= -EPS && d3 >= -EPS;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      const a = p[i0], b = p[i1], c = p[i2];
      if (!isConvex(a, b, c)) continue;
      let ok = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        const q = p[j];
        if ((q[0] === a[0] && q[1] === a[1]) || (q[0] === b[0] && q[1] === b[1]) || (q[0] === c[0] && q[1] === c[1])) continue;
        if (inside(q, a, b, c)) { ok = false; break; }
      }
      if (!ok) continue;
      tris.push([i0, i1, i2]);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) throw new Error('earClip failed');
  }
  tris.push([idx[0], idx[1], idx[2]]);
  const n = poly.length;
  return flipped ? tris.map((t) => t.map((i) => n - 1 - i)) : tris;
}

// 沿 Z 拉伸二维多边形（可凹）
function extrude(poly2, z0, z1) {
  const p = ccw(poly2);
  const tris = [];
  for (const [a, b, c] of earClip(p)) {
    tris.push([[...p[a], z1], [...p[b], z1], [...p[c], z1]]);
    tris.push([[...p[c], z0], [...p[b], z0], [...p[a], z0]]);
  }
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    tris.push([[...a, z0], [...b, z0], [...b, z1]]);
    tris.push([[...a, z0], [...b, z1], [...a, z1]]);
  }
  return tris;
}

// 从中心 c 出发的射线与多边形的最近交点距离（用于星形区域）
function rayPoly(c, ang, poly) {
  const d = [Math.cos(ang), Math.sin(ang)];
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const e = [b[0] - a[0], b[1] - a[1]];
    const den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-12) continue;
    const w = [a[0] - c[0], a[1] - c[1]];
    const t = (w[0] * e[1] - w[1] * e[0]) / den;
    const s = (w[0] * d[1] - w[1] * d[0]) / den;
    if (t > 1e-9 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
}

// 带一个孔的拉伸体：外轮廓与孔轮廓都需相对孔中心 c 星形
function extrudeWithHole(outer, hole, c, z0, z1) {
  const angSet = new Set();
  const addAng = (pt) => { let a = Math.atan2(pt[1] - c[1], pt[0] - c[0]); if (a < 0) a += TAU; angSet.add(+a.toFixed(12)); };
  outer.forEach(addAng); hole.forEach(addAng);
  let angs = [...angSet].sort((a, b) => a - b);
  const filled = [];
  for (let i = 0; i < angs.length; i++) {
    const a = angs[i], b = i + 1 < angs.length ? angs[i + 1] : angs[0] + TAU;
    filled.push(a);
    const steps = Math.ceil((b - a) / (TAU / 96));
    for (let k = 1; k < steps; k++) filled.push(a + ((b - a) * k) / steps);
  }
  angs = filled;
  const O = angs.map((a) => { const r = rayPoly(c, a, outer); return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]; });
  const I = angs.map((a) => { const r = rayPoly(c, a, hole); return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]; });
  const tris = [];
  const n = angs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // 顶面 / 底面环带
    tris.push([[...I[i], z1], [...O[i], z1], [...O[j], z1]], [[...I[i], z1], [...O[j], z1], [...I[j], z1]]);
    tris.push([[...O[j], z0], [...O[i], z0], [...I[i], z0]], [[...I[j], z0], [...O[j], z0], [...I[i], z0]]);
    // 外壁
    tris.push([[...O[i], z0], [...O[j], z0], [...O[j], z1]], [[...O[i], z0], [...O[j], z1], [...O[i], z1]]);
    // 孔壁（法线朝孔中心）
    tris.push([[...I[j], z0], [...I[i], z0], [...I[i], z1]], [[...I[j], z0], [...I[i], z1], [...I[j], z1]]);
  }
  return tris;
}

// 旋转体：profile 为 [r, z] 闭合回路（r>=0），绕 Z 轴
function lathe(profile, seg = 48) {
  const tris = [];
  const m = profile.length;
  const pt = (k, s) => { const [r, z] = profile[k % m]; const a = (s / seg) * TAU; return [r * Math.cos(a), r * Math.sin(a), z]; };
  for (let k = 0; k < m; k++) {
    for (let s = 0; s < seg; s++) {
      const a = pt(k, s), b = pt(k, s + 1), c = pt(k + 1, s + 1), d = pt(k + 1, s);
      tris.push([a, b, c], [a, c, d]);
    }
  }
  return tris;
}
const arc = (cx, cz, r, a0, a1, n) => { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; o.push([Math.max(0, cx + r * Math.cos(a)), cz + r * Math.sin(a)]); } return o; };

// 两个同顶点数凸多边形（3D 点）之间放样：棱柱、棱台、斜棱柱
function loft(bottom, top) {
  const tris = [];
  fan(bottom.slice().reverse(), tris);
  fan(top, tris);
  const n = bottom.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tris.push([bottom[i], bottom[j], top[j]], [bottom[i], top[j], top[i]]);
  }
  return tris;
}
function pyramid(base, apex) {
  const tris = [];
  fan(base.slice().reverse(), tris);
  for (let i = 0; i < base.length; i++) tris.push([base[i], base[(i + 1) % base.length], apex]);
  return tris;
}

// ---- 凸多面体（面列表）+ 平面切割 ----
function boxFaces(hx, hy, hz) {
  const v = (x, y, z) => [x * hx, y * hy, z * hz];
  return [
    [v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1), v(1, -1, -1)], // 底
    [v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)], // 顶
    [v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)], // 前
    [v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1)], // 后
    [v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)], // 左
    [v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1)], // 右
  ];
}
function prismFaces(poly2, z0, z1) {
  const p = ccw(poly2);
  const faces = [p.map(([x, y]) => [x, y, z0]).reverse(), p.map(([x, y]) => [x, y, z1])];
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; faces.push([[...a, z0], [...b, z0], [...b, z1], [...a, z1]]); }
  return faces;
}
function polyArea3(poly) {
  let s = [0, 0, 0];
  for (let i = 1; i + 1 < poly.length; i++) { const c = cross(sub(poly[i], poly[0]), sub(poly[i + 1], poly[0])); s = [s[0] + c[0], s[1] + c[1], s[2] + c[2]]; }
  return len(s) / 2;
}
// 保留 n·p <= d 的部分
export function clipConvex(faces, n, d) {
  const out = [];
  const cap = [];
  const dist = (p) => dot(n, p) - d;
  for (const f of faces) {
    const res = [];
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const da = dist(a), db = dist(b);
      if (da <= 1e-9) res.push(a);
      if (Math.abs(da) <= 1e-9) cap.push(a);
      if ((da < -1e-9 && db > 1e-9) || (da > 1e-9 && db < -1e-9)) {
        const t = da / (da - db);
        const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        res.push(q); cap.push(q);
      }
    }
    if (res.length >= 3 && polyArea3(res) > 1e-9) out.push(res);
  }
  // 去重并按角度排序生成截面
  const uniq = [];
  for (const p of cap) if (!uniq.some((q) => len(sub(p, q)) < 1e-7)) uniq.push(p);
  if (uniq.length >= 3) {
    const c = uniq.reduce((s, p) => [s[0] + p[0] / uniq.length, s[1] + p[1] / uniq.length, s[2] + p[2] / uniq.length], [0, 0, 0]);
    const nn = n.map((x) => x / len(n));
    const u0 = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = cross(nn, u0); const ul = len(u); const uu = u.map((x) => x / ul);
    const vv = cross(nn, uu);
    uniq.sort((p, q) => Math.atan2(dot(sub(p, c), vv), dot(sub(p, c), uu)) - Math.atan2(dot(sub(q, c), vv), dot(sub(q, c), uu)));
    if (polyArea3(uniq) > 1e-9) out.push(uniq);
  }
  return out;
}
function facesToTris(faces) { const t = []; for (const f of faces) fan(f, t); return t; }

// 坐标变换辅助
const mapTris = (tris, fn) => tris.map((t) => t.map(fn));
const yz = ([x, y, z]) => [x, z, y]; // 把在 xy 平面画的轮廓立起来（沿 Y 拉伸）
const shift = (dx, dy, dz) => ([x, y, z]) => [x + dx, y + dy, z + dz];

// ---- 45 种几何体 ----
const box = (hx, hy, hz) => facesToTris(boxFaces(hx, hy, hz));
const nPrism = (n, r, h, phase) => { const b = regularPolygon(n, r, phase); return loft(b.map(([x, y]) => [x, y, -h / 2]), b.map(([x, y]) => [x, y, h / 2])); };
const nPyramid = (n, r, h, phase) => pyramid(regularPolygon(n, r, phase).map(([x, y]) => [x, y, -h / 2]), [0, 0, h / 2]);
const nFrustum = (n, r0, r1, h, phase) => loft(regularPolygon(n, r0, phase).map(([x, y]) => [x, y, -h / 2]), regularPolygon(n, r1, phase).map(([x, y]) => [x, y, h / 2]));
const sideProfile = (poly, depth) => mapTris(extrude(poly, -depth / 2, depth / 2), yz); // 轮廓在 XZ 面，沿 Y 拉伸
const circle = (cx, cy, r, n = 48) => regularPolygon(n, r).map(([x, y]) => [x + cx, y + cy]);

export const SOLIDS = [
  // 基本体
  { id: 'cube', name: '正方体', group: '基本体', build: () => [box(1, 1, 1)] },
  { id: 'cuboid', name: '长方体', group: '基本体', build: () => [box(1.2, 0.7, 0.6)] },
  { id: 'cylinder', name: '圆柱', group: '基本体', build: () => [lathe([[0, -1], [0.8, -1], [0.8, 1], [0, 1]])] },
  { id: 'cone', name: '圆锥', group: '基本体', build: () => [lathe([[0, -1], [0.9, -1], [0, 1]])] },
  { id: 'sphere', name: '球', group: '基本体', build: () => [lathe(arc(0, 0, 1, -Math.PI / 2, Math.PI / 2, 24))] },
  // 棱柱
  { id: 'prism3', name: '正三棱柱', group: '棱柱', build: () => [nPrism(3, 1, 1.6, Math.PI / 2)] },
  { id: 'prism4', name: '正四棱柱', group: '棱柱', build: () => [nPrism(4, 0.8, 2, Math.PI / 4)] },
  { id: 'prism5', name: '正五棱柱', group: '棱柱', build: () => [nPrism(5, 1, 1.6, Math.PI / 2)] },
  { id: 'prism6', name: '正六棱柱', group: '棱柱', build: () => [nPrism(6, 1, 1.4, 0)] },
  { id: 'prism8', name: '正八棱柱', group: '棱柱', build: () => [nPrism(8, 1, 1.4, Math.PI / 8)] },
  // 棱锥
  { id: 'pyr3', name: '正三棱锥', group: '棱锥', build: () => [nPyramid(3, 1, 1.8, Math.PI / 2)] },
  { id: 'pyr4', name: '正四棱锥', group: '棱锥', build: () => [nPyramid(4, 1, 1.8, Math.PI / 4)] },
  { id: 'pyr5', name: '正五棱锥', group: '棱锥', build: () => [nPyramid(5, 1, 1.8, Math.PI / 2)] },
  { id: 'pyr6', name: '正六棱锥', group: '棱锥', build: () => [nPyramid(6, 1, 1.8, 0)] },
  { id: 'tetra', name: '正四面体', group: '棱锥', build: () => { const s = 1; const v = [[s, s, s], [s, -s, -s], [-s, s, -s], [-s, -s, s]]; return [[[v[0], v[1], v[2]], [v[0], v[3], v[1]], [v[0], v[2], v[3]], [v[1], v[3], v[2]]]]; } },
  // 棱台 / 圆台
  { id: 'frus3', name: '三棱台', group: '棱台与圆台', build: () => [nFrustum(3, 1, 0.5, 1.4, Math.PI / 2)] },
  { id: 'frus4', name: '四棱台', group: '棱台与圆台', build: () => [nFrustum(4, 1, 0.5, 1.4, Math.PI / 4)] },
  { id: 'frus5', name: '五棱台', group: '棱台与圆台', build: () => [nFrustum(5, 1, 0.5, 1.4, Math.PI / 2)] },
  { id: 'frus6', name: '六棱台', group: '棱台与圆台', build: () => [nFrustum(6, 1, 0.5, 1.4, 0)] },
  { id: 'cfrus', name: '圆台', group: '棱台与圆台', build: () => [lathe([[0, -0.7], [1, -0.7], [0.5, 0.7], [0, 0.7]])] },
  // 曲面体
  { id: 'halfcyl', name: '半圆柱', group: '曲面体', build: () => { const p = [[1, 0]]; for (let i = 1; i < 24; i++) { const a = (i / 24) * Math.PI; p.push([Math.cos(a), Math.sin(a)]); } p.push([-1, 0]); return [sideProfile(p, 1.6)]; } },
  { id: 'hemisphere', name: '半球', group: '曲面体', build: () => [lathe([[0, 0], ...arc(0, 0, 1, 0, Math.PI / 2, 12)])] },
  { id: 'torus', name: '圆环', group: '曲面体', build: () => [lathe(arc(0.68, 0, 0.32, 0, TAU, 24).slice(0, -1))] },
  { id: 'tube', name: '圆管（空心圆柱）', group: '曲面体', build: () => [lathe([[0.5, -0.9], [1, -0.9], [1, 0.9], [0.5, 0.9]])] },
  { id: 'capsule', name: '胶囊体', group: '曲面体', build: () => [lathe([...arc(0, -0.6, 0.6, -Math.PI / 2, 0, 8), ...arc(0, 0.6, 0.6, 0, Math.PI / 2, 8)])] },
  { id: 'cutcyl', name: '斜截圆柱', group: '曲面体', build: () => [facesToTris(clipConvex(prismFaces(circle(0, 0, 0.8), -1, 1), [0.45, 0, 1], 0.55))] },
  // 切割体
  { id: 'octa', name: '正八面体', group: '切割体', build: () => { const X = [1, 0, 0], x = [-1, 0, 0], Y = [0, 1, 0], y = [0, -1, 0], Z = [0, 0, 1], z = [0, 0, -1]; return [[[X, Y, Z], [Y, x, Z], [x, y, Z], [y, X, Z], [Y, X, z], [x, Y, z], [y, x, z], [X, y, z]]]; } },
  { id: 'oprism', name: '斜三棱柱', group: '切割体', build: () => { const b = regularPolygon(3, 0.9, Math.PI / 2); return [loft(b.map(([x, y]) => [x - 0.35, y - 0.15, -0.8]), b.map(([x, y]) => [x + 0.35, y + 0.15, 0.8]))]; } },
  { id: 'cornercut', name: '切角长方体', group: '切割体', build: () => [facesToTris(clipConvex(boxFaces(1.2, 0.8, 0.8), [1, -1, 1], 1.9))] },
  { id: 'slopecut', name: '斜切长方体', group: '切割体', build: () => [facesToTris(clipConvex(boxFaces(1.2, 0.8, 0.8), [0.5, 0, 1], 0.5))] },
  { id: 'chamfer', name: '倒角长方体', group: '切割体', build: () => [facesToTris(clipConvex(clipConvex(boxFaces(1.2, 0.8, 0.8), [0, -1, 1], 1.1), [0, 1, 1], 1.1))] },
  { id: 'wedge', name: '楔形块', group: '切割体', build: () => [sideProfile([[-1.2, -0.6], [1.2, -0.6], [-1.2, 0.6]], 1.4)] },
  // 组合体
  { id: 'lblock', name: 'L 形块', group: '组合体', build: () => [sideProfile([[-1, -0.8], [1, -0.8], [1, -0.2], [-0.3, -0.2], [-0.3, 0.8], [-1, 0.8]], 1.2)] },
  { id: 'tblock', name: 'T 形块', group: '组合体', build: () => [sideProfile([[-0.3, -0.8], [0.3, -0.8], [0.3, 0.3], [1, 0.3], [1, 0.8], [-1, 0.8], [-1, 0.3], [-0.3, 0.3]], 1.2)] },
  { id: 'ublock', name: 'U 形槽块', group: '组合体', build: () => [sideProfile([[-1, -0.6], [1, -0.6], [1, 0.6], [0.4, 0.6], [0.4, -0.1], [-0.4, -0.1], [-0.4, 0.6], [-1, 0.6]], 1.2)] },
  { id: 'step2', name: '两级台阶', group: '组合体', build: () => [sideProfile([[-1, -0.6], [1, -0.6], [1, 0], [0, 0], [0, 0.6], [-1, 0.6]], 1.2)] },
  { id: 'step3', name: '三级台阶', group: '组合体', build: () => [sideProfile([[-1.2, -0.6], [1.2, -0.6], [1.2, -0.2], [0.4, -0.2], [0.4, 0.2], [-0.4, 0.2], [-0.4, 0.6], [-1.2, 0.6]], 1.2)] },
  { id: 'cross', name: '十字形块', group: '组合体', build: () => [extrude([[-0.3, -1], [0.3, -1], [0.3, -0.3], [1, -0.3], [1, 0.3], [0.3, 0.3], [0.3, 1], [-0.3, 1], [-0.3, 0.3], [-1, 0.3], [-1, -0.3], [-0.3, -0.3]], -0.3, 0.3)] },
  { id: 'dovetail', name: '燕尾槽块', group: '组合体', build: () => [sideProfile([[-1.1, -0.6], [1.1, -0.6], [1.1, 0.6], [0.3, 0.6], [0.55, 0], [-0.55, 0], [-0.3, 0.6], [-1.1, 0.6]], 1.2)] },
  { id: 'vgroove', name: 'V 形槽块', group: '组合体', build: () => [sideProfile([[-1.1, -0.6], [1.1, -0.6], [1.1, 0.6], [0.55, 0.6], [0, 0], [-0.55, 0.6], [-1.1, 0.6]], 1.2)] },
  { id: 'holeblock', name: '带圆孔方块', group: '组合体', build: () => [extrudeWithHole([[-1.1, -0.8], [1.1, -0.8], [1.1, 0.8], [-1.1, 0.8]], circle(0, 0, 0.45), [0, 0], -0.5, 0.5)] },
  { id: 'sqholeblock', name: '带方孔方块', group: '组合体', build: () => [extrudeWithHole([[-1.1, -0.8], [1.1, -0.8], [1.1, 0.8], [-1.1, 0.8]], [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]], [0, 0], -0.5, 0.5)] },
  { id: 'roundplate', name: '圆头带孔板', group: '组合体', build: () => { const o = [[-1.6, -0.7], [0, -0.7]]; for (let i = 1; i < 24; i++) { const a = -Math.PI / 2 + (i / 24) * Math.PI; o.push([0.7 * Math.cos(a), 0.7 * Math.sin(a)]); } o.push([0, 0.7], [-1.6, 0.7]); return [mapTris(extrudeWithHole(o, circle(0, 0, 0.35), [0, 0], -0.25, 0.25), shift(0.45, 0, 0))]; } },
  { id: 'cylonbox', name: '圆柱叠方块', group: '组合体', build: () => [mapTris(box(1, 0.8, 0.3), shift(0, 0, -0.5)), mapTris(lathe([[0, 0], [0.55, 0], [0.55, 1.2], [0, 1.2]]), shift(0, 0, -0.2))] },
  { id: 'bearing', name: '轴承座', group: '组合体', build: () => {
    const base = mapTris(box(1.2, 0.6, 0.2), shift(0, 0, -0.7));
    const up = mapTris(extrudeWithHole([[-0.7, -0.5], [0.7, -0.5], [0.7, 0.8], [-0.7, 0.8]], circle(0, 0.2, 0.32), [0, 0.2], -0.3, 0.3), yz);
    return [base, up];
  } },
];

// ---- 网格：焊接、法线、归一化 ----
function signedVolume(tris) { let v = 0; for (const [a, b, c] of tris) v += dot(a, cross(b, c)) / 6; return v; }

export function buildSolid(id) {
  const def = SOLIDS.find((s) => s.id === id);
  if (!def) throw new Error('unknown solid ' + id);
  let parts = def.build().map((tris) => tris.filter(([a, b, c]) => triArea(a, b, c) > 1e-10));
  parts = parts.map((t) => (signedVolume(t) < 0 ? t.map(([a, b, c]) => [a, c, b]) : t));
  // 归一化：包围盒中心到原点，最大半尺寸 = 1
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const t of parts) for (const tri of t) for (const p of tri) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
  const c = [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2);
  const s = 1 / Math.max(...[0, 1, 2].map((k) => (mx[k] - mn[k]) / 2));
  const triCount = parts.reduce((n, t) => n + t.length, 0);
  const positions = new Float64Array(triCount * 9);
  const partOf = new Uint16Array(triCount);
  let o = 0, ti = 0;
  parts.forEach((t, pi) => { for (const tri of t) { for (const p of tri) for (let k = 0; k < 3; k++) positions[o++] = (p[k] - c[k]) * s; partOf[ti++] = pi; } });
  return { id, name: def.name, group: def.group, positions, partOf, parts: parts.length, ...weld(positions) };
}

// 按位置焊接顶点，得到索引（用于边邻接）
export function weld(positions) {
  const map = new Map();
  const verts = [];
  const index = new Uint32Array(positions.length / 3);
  for (let i = 0; i < index.length; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const key = Math.round(x * 1e5) + ',' + Math.round(y * 1e5) + ',' + Math.round(z * 1e5);
    let id = map.get(key);
    if (id === undefined) { id = verts.length / 3; verts.push(x, y, z); map.set(key, id); }
    index[i] = id;
  }
  return { vertices: new Float64Array(verts), index };
}

// 边邻接表：key "a_b"(a<b) → [{tri, dir}]
export function edgeAdjacency(index) {
  const edges = new Map();
  const nt = index.length / 3;
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = index[t * 3 + k], b = index[t * 3 + ((k + 1) % 3)];
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      let e = edges.get(key);
      if (!e) { e = { a: Math.min(a, b), b: Math.max(a, b), tris: [], dirs: [] }; edges.set(key, e); }
      e.tris.push(t); e.dirs.push(a < b ? 1 : -1);
    }
  }
  return [...edges.values()];
}

// 折痕法线：相邻面夹角小于 creaseDeg 时平滑
export function creasedNormals(positions, index, creaseDeg = 30) {
  const nt = positions.length / 9;
  const fn = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const p = (k) => [positions[t * 9 + k * 3], positions[t * 9 + k * 3 + 1], positions[t * 9 + k * 3 + 2]];
    const n = cross(sub(p(1), p(0)), sub(p(2), p(0)));
    const l = len(n) || 1;
    fn[t * 3] = n[0] / l; fn[t * 3 + 1] = n[1] / l; fn[t * 3 + 2] = n[2] / l;
  }
  const vt = new Map();
  for (let i = 0; i < index.length; i++) { const v = index[i]; if (!vt.has(v)) vt.set(v, []); vt.get(v).push((i / 3) | 0); }
  const cosT = Math.cos((creaseDeg * Math.PI) / 180);
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < index.length; i++) {
    const t = (i / 3) | 0;
    let s = [0, 0, 0];
    for (const u of vt.get(index[i])) {
      const c = fn[t * 3] * fn[u * 3] + fn[t * 3 + 1] * fn[u * 3 + 1] + fn[t * 3 + 2] * fn[u * 3 + 2];
      if (c >= cosT) s = [s[0] + fn[u * 3], s[1] + fn[u * 3 + 1], s[2] + fn[u * 3 + 2]];
    }
    const l = len(s) || 1;
    normals[i * 3] = s[0] / l; normals[i * 3 + 1] = s[1] / l; normals[i * 3 + 2] = s[2] / l;
  }
  return normals;
}

export function faceNormals(positions) {
  const nt = positions.length / 9;
  const fn = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    const ux = positions[o + 3] - positions[o], uy = positions[o + 4] - positions[o + 1], uz = positions[o + 5] - positions[o + 2];
    const vx = positions[o + 6] - positions[o], vy = positions[o + 7] - positions[o + 1], vz = positions[o + 8] - positions[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
  }
  return fn;
}

// 特征边（折角 > deg、开放边、非流形边），返回焊接顶点索引对 + 相邻三角形
export function classifyEdges(positions, index, featureDeg = 25) {
  const fn = faceNormals(positions);
  const cosT = Math.cos((featureDeg * Math.PI) / 180);
  return edgeAdjacency(index).map((e) => {
    let feature = e.tris.length !== 2;
    if (!feature) {
      const [t1, t2] = e.tris;
      const c = fn[t1 * 3] * fn[t2 * 3] + fn[t1 * 3 + 1] * fn[t2 * 3 + 1] + fn[t1 * 3 + 2] * fn[t2 * 3 + 2];
      feature = c < cosT;
    }
    return { a: e.a, b: e.b, tris: e.tris, feature };
  });
}

export const SOLID_COUNT = SOLIDS.length;

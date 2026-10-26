// 45 种几何体（全部免费）。每个几何体由一个或多个封闭网格组成，
// 构建后统一居中、缩放到最大尺寸 = 2（半宽 1）。
import * as THREE from '../vendor/three.module.min.js';
import { ConvexGeometry } from '../vendor/addons/ConvexGeometry.js';
import { mergeVertices, mergeGeometries, toCreasedNormals } from '../vendor/addons/BufferGeometryUtils.js';

const SEG = 48;
const TAU = Math.PI * 2;
const V2 = (a, b) => new THREE.Vector2(a, b);

// ---------- 基础构件 ----------
// 竖直（沿 Z 轴）的回转体 / 棱柱 / 棱锥：Three 的 Cylinder 默认沿 Y 轴，转到 Z 轴
function zCyl(rTop, rBottom, h, n = SEG, theta = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, n, 1, false, theta);
  g.rotateX(Math.PI / 2);
  return g;
}
function lathe(points, n = SEG) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => V2(r, y)), n);
  g.rotateX(Math.PI / 2);
  return g;
}
function shapeFrom(pts, holes = []) {
  const s = new THREE.Shape(pts.map(([a, b]) => V2(a, b)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([a, b]) => V2(a, b))));
  return s;
}
// 把二维轮廓沿厚度方向拉伸。plane：
//  'front'：轮廓画在主视图里（a 向观察者右 = -X，b 向上 = Z），沿 Y 拉伸
//  'side' ：轮廓画在左视图里（a = +Y，b = Z），沿 X 拉伸
//  'top'  ：轮廓画在俯视图里（a = X，b = Y），沿 Z 拉伸
function extrude(pts, depth, plane = 'front', holes = []) {
  const g = new THREE.ExtrudeGeometry(shapeFrom(pts, holes), { depth, bevelEnabled: false, curveSegments: SEG });
  g.translate(0, 0, -depth / 2);
  if (plane === 'front') { g.rotateX(Math.PI / 2); g.rotateZ(Math.PI); }
  else if (plane === 'side') { g.rotateX(Math.PI / 2); g.rotateZ(Math.PI / 2); }
  return g;
}
const circ = (cx, cy, r, n = SEG, a0 = 0, a1 = TAU, close = true) => {
  const out = [];
  const m = close ? n : n + 1;
  for (let i = 0; i < m; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
};
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const hull = (pts) => new ConvexGeometry(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
const at = (g, x, y, z) => { g.translate(x, y, z); return g; };
const regPrism = (n, r, h, theta) => zCyl(r, r, h, n, theta);
const regPyr = (n, r, h, theta) => zCyl(0, r, h, n, theta);
const regFrus = (n, r1, r2, h, theta) => zCyl(r2, r1, h, n, theta);

// ---------- 45 种几何体 ----------
export const SOLIDS = [
  // 基本体
  { id: 'cube', name: '正方体', group: '基本体', build: () => [box(2, 2, 2)] },
  { id: 'cuboid', name: '长方体', group: '基本体', build: () => [box(2.4, 1.4, 1.2)] },
  { id: 'cylinder', name: '圆柱', group: '基本体', build: () => [zCyl(0.8, 0.8, 2)] },
  { id: 'cone', name: '圆锥', group: '基本体', build: () => [zCyl(0, 1, 2)] },
  { id: 'sphere', name: '球', group: '基本体', build: () => [new THREE.SphereGeometry(1, SEG, 32)] },
  // 棱柱
  { id: 'prism3', name: '正三棱柱', group: '棱柱', build: () => [regPrism(3, 1, 1.8, 0)] },
  { id: 'prism4', name: '正四棱柱', group: '棱柱', build: () => [regPrism(4, 0.9, 2.2, Math.PI / 4)] },
  { id: 'prism5', name: '正五棱柱', group: '棱柱', build: () => [regPrism(5, 1, 1.6, 0)] },
  { id: 'prism6', name: '正六棱柱', group: '棱柱', build: () => [regPrism(6, 1, 1.4, Math.PI / 6)] },
  { id: 'prism8', name: '正八棱柱', group: '棱柱', build: () => [regPrism(8, 1, 1.4, Math.PI / 8)] },
  // 棱锥
  { id: 'pyr3', name: '正三棱锥', group: '棱锥', build: () => [regPyr(3, 1, 1.8, 0)] },
  { id: 'pyr4', name: '正四棱锥', group: '棱锥', build: () => [regPyr(4, 1.1, 1.8, Math.PI / 4)] },
  { id: 'pyr5', name: '正五棱锥', group: '棱锥', build: () => [regPyr(5, 1, 1.8, 0)] },
  { id: 'pyr6', name: '正六棱锥', group: '棱锥', build: () => [regPyr(6, 1, 1.8, Math.PI / 6)] },
  { id: 'tetra', name: '正四面体', group: '棱锥', build: () => { const R = 1, a = R * Math.sqrt(3); return [regPyr(3, R, a * Math.sqrt(2 / 3), 0)]; } },
  // 台体与多面体
  { id: 'frus3', name: '正三棱台', group: '台体与多面体', build: () => [regFrus(3, 1, 0.5, 1.3, 0)] },
  { id: 'frus4', name: '正四棱台', group: '台体与多面体', build: () => [regFrus(4, 1.2, 0.6, 1.2, Math.PI / 4)] },
  { id: 'frus6', name: '正六棱台', group: '台体与多面体', build: () => [regFrus(6, 1, 0.55, 1.2, Math.PI / 6)] },
  { id: 'cfrus', name: '圆台', group: '台体与多面体', build: () => [zCyl(0.55, 1, 1.4)] },
  { id: 'octa', name: '正八面体', group: '台体与多面体', build: () => [new THREE.OctahedronGeometry(1)] },
  // 回转体与曲面体
  { id: 'hemisphere', name: '半球', group: '回转体', build: () => [lathe([[0, 0], ...circ(0, 0, 1, 16, 0, Math.PI / 2, false)])] },
  { id: 'halfcyl', name: '半圆柱', group: '回转体', build: () => [extrude(circ(0, 0, 1, SEG, 0, Math.PI, false), 1.8, 'front')] },
  { id: 'torus', name: '圆环', group: '回转体', build: () => [new THREE.TorusGeometry(0.72, 0.3, 24, SEG)] },
  { id: 'tube', name: '圆管', group: '回转体', build: () => [extrude(circ(0, 0, 1), 2, 'top', [circ(0, 0, 0.55)])] },
  { id: 'capsule', name: '胶囊体', group: '回转体', build: () => { const g = new THREE.CapsuleGeometry(0.6, 1.2, 12, SEG); g.rotateX(Math.PI / 2); return [g]; } },
  { id: 'cutcyl', name: '斜截圆柱', group: '回转体', build: () => { const p = []; for (const [x, y] of circ(0, 0, 0.8)) { p.push([x, y, -1]); p.push([x, y, 0.45 + 0.45 * (x / 0.8)]); } return [hull(p)]; } },
  // 切割体
  { id: 'wedge', name: '楔形块', group: '切割体', build: () => [extrude([[-1.2, -0.6], [1.2, -0.6], [-1.2, 0.6]], 1.4, 'front')] },
  { id: 'slopecut', name: '斜切长方体', group: '切割体', build: () => [extrude([[-1.2, -0.6], [1.2, -0.6], [1.2, 0], [-1.2, 0.6]], 1.4, 'front')] },
  { id: 'cornercut', name: '切角长方体', group: '切割体', build: () => { const x = 1.2, y = 0.8, z = 0.8, c = 0.7; const p = []; for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) { if (sx === 1 && sy === 1 && sz === 1) { p.push([x - c, y, z], [x, y - c, z], [x, y, z - c]); } else p.push([sx * x, sy * y, sz * z]); } return [hull(p)]; } },
  { id: 'chamfer', name: '倒角长方体', group: '切割体', build: () => [extrude([[-0.8, -0.6], [0.8, -0.6], [0.8, 0.2], [0.4, 0.6], [-0.4, 0.6], [-0.8, 0.2]], 2.2, 'side')] },
  { id: 'ibeam', name: '工字形块', group: '切割体', build: () => [extrude([[-1, -0.9], [1, -0.9], [1, -0.55], [0.25, -0.55], [0.25, 0.55], [1, 0.55], [1, 0.9], [-1, 0.9], [-1, 0.55], [-0.25, 0.55], [-0.25, -0.55], [-1, -0.55]], 1.2, 'front')] },
  { id: 'slotplate', name: '带腰形孔板', group: '切割体', build: () => [extrude(rect(-1.3, -0.8, 1.3, 0.8), 0.45, 'top', [[...circ(0.5, 0, 0.32, 24, -Math.PI / 2, Math.PI / 2, false), ...circ(-0.5, 0, 0.32, 24, Math.PI / 2, Math.PI * 1.5, false)]])] },
  { id: 'vgroove', name: 'V 形槽块', group: '切割体', build: () => [extrude([[-1.1, -0.6], [1.1, -0.6], [1.1, 0.6], [0.55, 0.6], [0, 0], [-0.55, 0.6], [-1.1, 0.6]], 1.3, 'front')] },
  { id: 'dovetail', name: '燕尾槽块', group: '切割体', build: () => [extrude([[-1.1, -0.6], [1.1, -0.6], [1.1, 0.6], [0.3, 0.6], [0.55, 0], [-0.55, 0], [-0.3, 0.6], [-1.1, 0.6]], 1.3, 'front')] },
  // 组合体
  { id: 'lblock', name: 'L 形块', group: '组合体', build: () => [extrude([[-1, -0.8], [1, -0.8], [1, -0.2], [-0.3, -0.2], [-0.3, 0.8], [-1, 0.8]], 1.2, 'front')] },
  { id: 'tblock', name: 'T 形块', group: '组合体', build: () => [extrude([[-0.3, -0.8], [0.3, -0.8], [0.3, 0.3], [1, 0.3], [1, 0.8], [-1, 0.8], [-1, 0.3], [-0.3, 0.3]], 1.2, 'front')] },
  { id: 'ublock', name: 'U 形块', group: '组合体', build: () => [extrude([[-1, -0.6], [1, -0.6], [1, 0.6], [0.45, 0.6], [0.45, -0.1], [-0.45, -0.1], [-0.45, 0.6], [-1, 0.6]], 1.2, 'front')] },
  { id: 'step2', name: '两级台阶', group: '组合体', build: () => [extrude([[-1, -0.6], [1, -0.6], [1, 0], [0, 0], [0, 0.6], [-1, 0.6]], 1.4, 'side')] },
  { id: 'step3', name: '三级台阶', group: '组合体', build: () => [extrude([[-1.2, -0.6], [1.2, -0.6], [1.2, -0.2], [0.4, -0.2], [0.4, 0.2], [-0.4, 0.2], [-0.4, 0.6], [-1.2, 0.6]], 1.4, 'side')] },
  { id: 'cross', name: '十字形块', group: '组合体', build: () => [extrude([[-0.3, -1], [0.3, -1], [0.3, -0.3], [1, -0.3], [1, 0.3], [0.3, 0.3], [0.3, 1], [-0.3, 1], [-0.3, 0.3], [-1, 0.3], [-1, -0.3], [-0.3, -0.3]], 0.6, 'top')] },
  { id: 'holeblock', name: '带圆孔方块', group: '组合体', build: () => [extrude(rect(-1.1, -0.8, 1.1, 0.8), 1, 'front', [circ(0, 0, 0.45)])] },
  { id: 'sqhole', name: '带方孔方块', group: '组合体', build: () => [extrude(rect(-1.1, -0.8, 1.1, 0.8), 1, 'front', [rect(-0.4, -0.4, 0.4, 0.4)])] },
  { id: 'roundplate', name: '圆头带孔板', group: '组合体', build: () => [extrude([[-1.4, -0.7], [0.3, -0.7], ...circ(0.3, 0, 0.7, SEG / 2, -Math.PI / 2, Math.PI / 2, false).slice(1, -1), [0.3, 0.7], [-1.4, 0.7]], 0.45, 'top', [circ(0.3, 0, 0.32)])] },
  { id: 'cylbox', name: '圆柱叠方块', group: '组合体', build: () => [at(box(1.8, 1.8, 0.6), 0, 0, -0.6), at(zCyl(0.55, 0.55, 1.2), 0, 0, 0.3)] },
  { id: 'bearing', name: '轴承座', group: '组合体', build: () => {
    const base = at(box(2.6, 1.4, 0.35), 0, 0, -0.85);
    const up = extrude([[-0.75, 0], [0.75, 0], ...circ(0, 1.05, 0.75, SEG / 2, 0, Math.PI, false), [-0.75, 0]].filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-9), 0.6, 'front', [circ(0, 1.05, 0.4)]);
    up.translate(0, 0, -0.675);
    return [base, up];
  } },
];

export const SOLID_IDS = SOLIDS.map((s) => s.id);

// 只保留 position，焊接共点，去掉退化三角形 -> {verts, tris}
function weld(g) {
  let geo = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(geo.attributes)) if (k !== 'position') geo.deleteAttribute(k);
  geo = mergeVertices(geo, 1e-5);
  const P = geo.attributes.position.array;
  const I = geo.index.array;
  const tris = [];
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i], b = I[i + 1], c = I[i + 2];
    if (a === b || b === c || a === c) continue;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (Math.hypot(cx, cy, cz) < 1e-10) continue;
    tris.push(a, b, c);
  }
  return { verts: Array.from(P), tris };
}

const FEATURE_ANGLE = 30; // 度：两相邻面夹角大于它算作棱线

export function buildSolid(id) {
  const def = SOLIDS.find((s) => s.id === id) || SOLIDS[0];
  const parts = def.build();
  // 归一化：居中，最大尺寸 = 2
  const bb = new THREE.Box3();
  for (const p of parts) { p.computeBoundingBox(); bb.union(p.boundingBox); }
  const c = bb.getCenter(new THREE.Vector3());
  const size = bb.getSize(new THREE.Vector3());
  const s = 2 / Math.max(size.x, size.y, size.z);
  for (const p of parts) { p.translate(-c.x, -c.y, -c.z); p.scale(s, s, s); }

  // 拓扑（每个部件分别焊接，再拼在一起）
  const verts = [], tris = [], triPart = [];
  parts.forEach((p, pi) => {
    const w = weld(p);
    const off = verts.length / 3;
    verts.push(...w.verts);
    for (let i = 0; i < w.tris.length; i++) tris.push(w.tris[i] + off);
    for (let i = 0; i < w.tris.length / 3; i++) triPart.push(pi);
  });
  const nT = tris.length / 3;
  const triNormals = new Float32Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, cc = tris[t * 3 + 2] * 3;
    const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
    const vx = verts[cc] - verts[a], vy = verts[cc + 1] - verts[a + 1], vz = verts[cc + 2] - verts[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    triNormals[t * 3] = nx / l; triNormals[t * 3 + 1] = ny / l; triNormals[t * 3 + 2] = nz / l;
  }
  const edgeMap = new Map();
  for (let t = 0; t < nT; t++) {
    for (let k = 0; k < 3; k++) {
      const a = tris[t * 3 + k], b = tris[t * 3 + ((k + 1) % 3)];
      const key = a < b ? a * 1048576 + b : b * 1048576 + a;
      let e = edgeMap.get(key);
      if (!e) { e = { a: Math.min(a, b), b: Math.max(a, b), t: [], dir: [] }; edgeMap.set(key, e); }
      e.t.push(t); e.dir.push(a < b ? 1 : -1);
    }
  }
  const cosF = Math.cos((FEATURE_ANGLE * Math.PI) / 180);
  const cosFlat = Math.cos((0.5 * Math.PI) / 180);
  const edges = []; // [a, b, t1, t2, kind]  kind: 1 = 棱线, 0 = 光滑（只在轮廓处画）
  for (const e of edgeMap.values()) {
    const t1 = e.t[0], t2 = e.t.length > 1 ? e.t[1] : -1;
    let kind;
    if (t2 < 0) kind = 1;
    else {
      const d = triNormals[t1 * 3] * triNormals[t2 * 3] + triNormals[t1 * 3 + 1] * triNormals[t2 * 3 + 1] + triNormals[t1 * 3 + 2] * triNormals[t2 * 3 + 2];
      if (d >= cosFlat) continue; // 同一平面内的对角线，永远不画
      kind = d < cosF ? 1 : 0;
    }
    edges.push(e.a, e.b, t1, t2, kind);
  }

  // 渲染用几何：合并后按 30° 折痕计算法线（曲面光滑、棱角分明）
  const flat = parts.map((p) => { const q = p.index ? p.toNonIndexed() : p.clone(); for (const k of Object.keys(q.attributes)) if (k !== 'position') q.deleteAttribute(k); return q; });
  const merged = flat.length > 1 ? mergeGeometries(flat) : flat[0];
  const geometry = toCreasedNormals(merged, (FEATURE_ANGLE * Math.PI) / 180);
  geometry.computeBoundingSphere();

  // 棱线（物体上的橙色描边）
  const featureLines = [];
  for (let i = 0; i < edges.length; i += 5) if (edges[i + 4] === 1) {
    const a = edges[i] * 3, b = edges[i + 1] * 3;
    featureLines.push(verts[a], verts[a + 1], verts[a + 2], verts[b], verts[b + 1], verts[b + 2]);
  }

  return {
    id: def.id, name: def.name, group: def.group, parts: parts.length,
    geometry, verts: new Float32Array(verts), tris: new Uint32Array(tris), triPart: new Uint16Array(triPart),
    triNormals, edges: new Int32Array(edges), edgeMap, featureLines: new Float32Array(featureLines),
    radius: geometry.boundingSphere.radius + geometry.boundingSphere.center.length(),
  };
}

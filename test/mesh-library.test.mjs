// geometry-76 模型 -> 主页引擎：网格转换、棱线分类、坐标约定、URL 参数
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { buildSolidFromMesh, meshEdgeKind, MESH_TANGENT_DEG } from '../src/solids.js';
import { polygonMeshToTriangles, meshTopology } from '../src/mesh.js';
import { WALLS } from '../src/projection.js';
import { computeView } from '../src/views.js';
import { parseParams } from '../src/params.js';

const scope = vm.createContext({ console });
for (const f of ['geometry.js', 'csg.js', 'advanced.js', 'library.js']) vm.runInContext(fs.readFileSync(new URL('../geometry-76/' + f, import.meta.url), 'utf8'), scope);
const { SolidCSG, PVLibrary } = vm.runInContext('({SolidCSG, PVLibrary})', scope);
const C = SolidCSG;
const meta = (id) => ({ id, name: id, group: 'test' });
const solidOf = (s, id = 't') => buildSolidFromMesh(meta(id), s.mesh());
const deg = (s, i) => { const t1 = s.edges[i + 2], t2 = s.edges[i + 3], N = s.triNormals; return (Math.acos(Math.min(1, N[t1 * 3] * N[t2 * 3] + N[t1 * 3 + 1] * N[t2 * 3 + 1] + N[t1 * 3 + 2] * N[t2 * 3 + 2])) * 180) / Math.PI; };
const creaseLen = (s) => { let L = 0; const v = s.verts; for (let i = 0; i < s.edges.length; i += 5) if (s.edges[i + 4] === 1) { const a = s.edges[i] * 3, b = s.edges[i + 1] * 3; L += Math.hypot(v[a] - v[b], v[a + 1] - v[b + 1], v[a + 2] - v[b + 2]); } return L; };
const volume = (s) => { let V = 0; const v = s.verts, t = s.tris; for (let i = 0; i < t.length; i += 3) { const [a, b, c] = [t[i], t[i + 1], t[i + 2]].map((k) => [v[k * 3], v[k * 3 + 1], v[k * 3 + 2]]); V += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; } return V; };
const lenOf = (segs) => { let L = 0; for (let i = 0; i < segs.length; i += 4) L += Math.hypot(segs[i + 2] - segs[i], segs[i + 3] - segs[i + 1]); return L; };

test('CSG 布尔运算产生的 T 形接点被消除：带通孔方块是封闭流形、体积正确', () => {
  const s = solidOf(C.box(2, 2, 2).subtract(C.box(1, 1, 4)));
  const topo = meshTopology(s.tris);
  assert.equal(topo.open, 0); assert.equal(topo.nonManifold, 0); assert.equal(topo.flipped, 0);
  // 归一化后最大尺寸 2，原来就是 2：体积 8 - 2 = 6
  assert.ok(Math.abs(volume(s) - 6) < 1e-4, String(volume(s)));
  // 棱线总长：外框 12 条 ×2 + 孔口 8 条 ×1 + 孔壁 4 条 ×2 = 24 + 8 + 8 = 40（共面分割线一条都不画）
  assert.ok(Math.abs(creaseLen(s) - 40) < 1e-3, String(creaseLen(s)));
});

test('棱线分类：22° 缓坡斜面与顶面的交线是棱线（主页统一 30° 会丢掉它）', () => {
  // 长方体顶部用倾斜 22° 的平面切掉一角
  const cut = C.box(12, 12, 12).move(0, 0, -6).rotate(1, 22).move(0, 0, 0.6);
  const s = solidOf(C.box(2.4, 2, 2).intersect(cut));
  let found = 0;
  for (let i = 0; i < s.edges.length; i += 5) { const a = deg(s, i); if (s.edges[i + 3] >= 0 && Math.abs(a - 22) < 0.5) { assert.equal(s.edges[i + 4], 1); found++; } }
  assert.ok(found >= 1);
  assert.equal(meshEdgeKind(Math.cos((22 * Math.PI) / 180), -1, -1), 1);
});

test('棱线分类：圆柱面上的离散棱是光滑边，端面圆是棱线；主视图为矩形（2 条转向轮廓线 + 上下底）', () => {
  const s = solidOf(C.cylinder(1, 2, 1, 28));
  let smooth = 0, crease = 0;
  for (let i = 0; i < s.edges.length; i += 5) (s.edges[i + 4] === 1 ? crease++ : smooth++);
  assert.equal(crease, 56); // 上下两个 28 边形
  assert.equal(smooth, 28);
  const r = computeView(s, s.verts, s.triNormals, WALLS.V);
  // 主视图：2×2 的矩形（上下底圆投影成直线，左右两条是圆柱面的转向轮廓线），周长 8；
  // 背后半圆的虚线与前半圆的实线重合（与主页正方体一样，实线盖住虚线）
  assert.ok(Math.abs(lenOf(r.visible) - 8) < 0.05, String(lenOf(r.visible)));
});

test('棱线分类：平面与圆柱面相切处（长圆孔、腰形块）不画线', () => {
  const slot = C.box(0.8, 1.2, 1).union(C.cylinder(0.4, 1, 0.4, 28).move(0, 0.6, 0)).union(C.cylinder(0.4, 1, 0.4, 28).move(0, -0.6, 0));
  const s = solidOf(slot);
  assert.equal(meshTopology(s.tris).open, 0);
  // 俯视图应只有外轮廓（两段直线 + 两个半圆），不出现切点处的竖线：在 x = ±0.4 附近找“沿 Z 方向”的棱线
  const v = s.verts;
  for (let i = 0; i < s.edges.length; i += 5) if (s.edges[i + 4] === 1) {
    const a = s.edges[i] * 3, b = s.edges[i + 1] * 3;
    const vertical = Math.abs(v[a] - v[b]) < 1e-6 && Math.abs(v[a + 1] - v[b + 1]) < 1e-6;
    assert.ok(!vertical, '相切处出现了竖直棱线');
  }
  assert.ok(MESH_TANGENT_DEG > 360 / 28 && MESH_TANGENT_DEG < 15);
});

test('坐标约定：geometry-76（主视图从 -Y 看）转到主页引擎（主视图从 +Y 看）后三视图方位一致', () => {
  // 在 geometry-76 坐标里，长方体前面（-Y 一侧）右下方挖一个缺口：主视图右下角应能看到缺口
  const notch = C.box(2, 1, 1).subtract(C.box(0.6, 0.4, 0.4).move(0.8, -0.4, -0.4));
  const raw = notch.mesh();
  const m = { v: raw.v.map((p) => [-p[0], -p[1], p[2]]), f: raw.f, s: raw.s }; // 与 library.js 相同的映射
  const s = buildSolidFromMesh(meta('notch'), m);
  // geometry-76 点 (x, y, z) -> 主视图 (u, v) = (x, z)；左视图 (u, v) = (-y, z)；俯视图 (u, v) = (x, y)
  const p = [0.5, -0.3, 0.2], q = [-p[0], -p[1], p[2]];
  const uv = (w) => [q[0] * w.U[0] + q[1] * w.U[1] + q[2] * w.U[2], q[0] * w.V[0] + q[1] * w.V[1] + q[2] * w.V[2]];
  assert.deepEqual(uv(WALLS.V), [0.5, 0.2]);
  assert.deepEqual(uv(WALLS.W), [0.3, 0.2]);
  assert.deepEqual(uv(WALLS.H), [0.5, -0.3].map((x, i) => (i ? x : x)));
  // 缺口在前面右下角：主视图里缺口顶面的棱（geometry-76 中 z = -0.2，x 从 0.5 到 1.0）是实线
  const r = computeView(s, s.verts, s.triNormals, WALLS.V);
  const has = (segs, u0, u1, v) => { for (let i = 0; i < segs.length; i += 4) { const a = Math.min(segs[i], segs[i + 2]), b = Math.max(segs[i], segs[i + 2]); if (Math.abs(segs[i + 1] - v) < 1e-4 && Math.abs(segs[i + 3] - v) < 1e-4 && a < u0 + 1e-3 && b > u1 - 1e-3) return true; } return false; };
  assert.ok(has(r.visible, 0.5, 1.0, -0.2), '主视图右下角缺口顶棱应为实线');
  // 左视图（从 geometry-76 的 -X 方向看，画面向右 = geometry-76 的 -Y）：缺口在画面右侧（u 0.2..0.5），被左半部分实体挡住，画虚线
  const w = computeView(s, s.verts, s.triNormals, WALLS.W);
  assert.ok(has(w.hidden, 0.2, 0.5, -0.2), '左视图里缺口顶棱应为虚线');
  assert.ok(!has(w.visible, 0.2, 0.5, -0.2));
});

test('176 个模型全部能转换：外法线（体积为正）、三视图都有实线，最大尺寸归一为 2', () => {
  assert.equal(PVLibrary.items.length, 176);
  assert.equal(PVLibrary.items.filter((x) => x.advanced).length, 100);
  const leaks = [];
  for (const it of PVLibrary.items) {
    const s = buildSolidFromMesh(it, PVLibrary.mesh(it.id));
    assert.ok(volume(s) > 0.05, it.id + ' volume ' + volume(s));
    let mx = 0; for (let i = 0; i < s.verts.length; i++) mx = Math.max(mx, Math.abs(s.verts[i]));
    assert.ok(mx <= 1.0001 && mx > 0.5, it.id);
    for (const k of ['V', 'W', 'H']) assert.ok(computeView(s, s.verts, s.triNormals, WALLS[k]).visible.length > 0, it.id + k);
    assert.equal(s.meshStats.flipped, 0, it.id + ' 面朝向不一致');
    if (s.meshStats.open || s.meshStats.nonManifold) leaks.push(`${it.id}:${s.meshStats.open}/${s.meshStats.nonManifold}`);
  }
  // 已知：CSG 结果本身有少量残缺（见 README），这里锁定清单，防止回退变多
  assert.deepEqual(leaks, ['mech-015:5/1', 'mech-018:6/0', 'mech-058:0/5', 'mech-077:0/3', 'mech-099:0/11', 'mech-100:0/2']);
});

test('URL 参数：?solid / ?model（仅 geometry-76）/ unfold / views / rot / light / mode', () => {
  const ids = ['mech-001', 'cube'], L = [3.2, 0.35, 0.45];
  let s = parseParams('?solid=cube&unfold=1&views=1&rot=10,20,30&mode=central&light=4,0.1,-0.2&axes=0&shadows=0&rays=1&panel=1', { ids, defaultId: 'mech-001', allowModel: true, defaultLight: L });
  assert.deepEqual(s, { solid: 'cube', mode: 'central', views: true, rays: true, unfold: true, shadows: false, axes: false, rot: [10, 20, 30], light: [4, 0.1, -0.2], panel: true });
  assert.equal(parseParams('?model=cube', { ids, defaultId: 'mech-001', allowModel: true, defaultLight: L }).solid, 'cube');
  assert.equal(parseParams('?model=cube', { ids, defaultId: 'x', allowModel: false, defaultLight: L }).solid, 'x');
  s = parseParams('?solid=nope&rot=1,2', { ids, defaultId: 'mech-001', defaultLight: L });
  assert.equal(s.solid, 'mech-001'); assert.deepEqual(s.rot, [0, 0, 0]); assert.deepEqual(s.light, L); assert.equal(s.mode, 'ortho');
  assert.notEqual(s.light, L, '默认光源要复制一份，避免被修改');
});

test('多边形三角化：非凸多边形（L 形柱）耳切法，体积守恒、封闭', () => {
  const base = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], n = base.length;
  const v = [...base.map(([x, y]) => [x, y, 0]), ...base.map(([x, y]) => [x, y, 1])];
  const f = [Array.from({ length: n }, (_, i) => n - 1 - i), Array.from({ length: n }, (_, i) => n + i)];
  for (let i = 0; i < n; i++) f.push([i, (i + 1) % n, (i + 1) % n + n, i + n]);
  const r = polygonMeshToTriangles({ v, f });
  assert.equal(meshTopology(r.tris).open, 0);
  let V = 0; for (let i = 0; i < r.tris.length; i += 3) { const [a, b, c] = [r.tris[i], r.tris[i + 1], r.tris[i + 2]].map((k) => [r.verts[k * 3], r.verts[k * 3 + 1], r.verts[k * 3 + 2]]); V += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; }
  assert.ok(Math.abs(V - 3) < 1e-9, String(V));
});

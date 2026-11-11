// 展开三视图几何计算的单元测试（不依赖浏览器）：用 SolidCSG 现场构造已知答案的形体，核对实线/虚线。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { prepareModel, computeViews, chainPolylines } from '../geometry-76/unfold.js';

const scope = vm.createContext({ console });
for (const file of ['geometry.js', 'csg.js', 'advanced.js']) vm.runInContext(fs.readFileSync(new URL('../geometry-76/' + file, import.meta.url), 'utf8'), scope);
const { Geometry, SolidCSG } = vm.runInContext('({Geometry,SolidCSG})', scope);
const id = (p) => [...p];
const views = (mesh, xf = id) => computeViews(prepareModel(mesh, SolidCSG, [0, 0, 0]), xf);
const total = (list) => list.reduce((s, q) => s + Math.hypot(q[2] - q[0], q[3] - q[1]), 0);
// 视图平面坐标：展开图坐标减去布局偏移（见 unfold.js 的 place）
const local = (r, k, q) => {
  const [x, y] = q, o = r.off, c = r.wc;
  return k === 'V' ? [x + c[0] + o, y + c[2] - o] : k === 'W' ? [x - c[1] - o, y + c[2] - o] : [x + c[0] + o, y + c[1] + o];
};
const verticalAt = (r, k, list, u) => list.filter((q) => { const a = local(r, k, q), b = local(r, k, [q[2], q[3]]); return Math.abs(a[0] - u) < 1e-6 && Math.abs(b[0] - u) < 1e-6; });

test('长方体：三视图各 4 条实线，无虚线（背面棱与正面棱重合，实线优先）', () => {
  const r = views(SolidCSG.box(2, 1, 1.5).mesh());
  for (const k of ['V', 'W', 'H']) {
    assert.equal(r.views[k].hidden.length, 0, k);
    assert.equal(r.views[k].visible.length, 4, k);
  }
  assert.ok(Math.abs(total(r.views.V.visible) - 2 * (2 + 1.5)) < 1e-9);
  assert.ok(Math.abs(total(r.views.W.visible) - 2 * (1 + 1.5)) < 1e-9);
  assert.ok(Math.abs(total(r.views.H.visible) - 2 * (2 + 1)) < 1e-9);
});

test('竖直通孔：主/左视图中孔的转向轮廓线为两条虚线，俯视图中孔为可见圆', () => {
  const r = views(SolidCSG.box(2, 2, 1).subtract(SolidCSG.cylinder(0.3, 3)).mesh());
  for (const k of ['V', 'W']) {
    const h = r.views[k].hidden;
    assert.equal(verticalAt(r, k, h, 0.3).length + verticalAt(r, k, h, -0.3).length, h.length, k + ' 虚线都在 ±r 处');
    assert.ok(Math.abs(total(h) - 2 * 1) < 1e-6, k + ' 两条虚线各长 1（=板厚）');
  }
  assert.equal(r.views.H.hidden.length, 0);
  assert.ok(Math.abs(total(r.views.H.visible) - (8 + 2 * 28 * 0.3 * Math.sin(Math.PI / 28))) < 1e-6, '俯视图 = 外框 + 28 边形孔口');
});

test('水平横孔（沿 Y）：主视图为可见圆，俯视图与左视图中为虚线', () => {
  const r = views(SolidCSG.box(2, 2, 1.4).subtract(SolidCSG.cylinder(0.3, 3).rotate(0, 90)).mesh());
  assert.equal(r.views.V.hidden.length, 0);
  assert.ok(r.views.H.hidden.length > 0 && Math.abs(total(r.views.H.hidden) - 2 * 2) < 1e-6, '俯视图两条虚线各长 2（=板宽）');
  assert.ok(Math.abs(total(r.views.W.hidden) - 2 * 2) < 1e-6, '左视图：孔的上下两条轮廓素线');
});

test('顶面中部沿 X 贯通的槽：主视图槽底被前壁挡住画虚线，左视图槽口轮廓为实线', () => {
  // 槽沿 X 方向贯通、位于顶面中部：左视图（从左看）看到槽的端面轮廓 → 实线；主视图中槽底被前壁挡住 → 虚线
  const r = views(SolidCSG.box(2, 2, 1).subtract(SolidCSG.box(3, 0.6, 0.5).move(0, 0, 0.5)).mesh());
  const hv = r.views.V.hidden;
  assert.ok(hv.length > 0, '主视图有虚线（槽底）');
  for (const q of hv) { const a = local(r, 'V', q), b = local(r, 'V', [q[2], q[3]]); assert.ok(Math.abs(a[1] - 0.25) < 1e-6 && Math.abs(b[1] - 0.25) < 1e-6, '虚线在槽底 z=0.25'); }
  assert.ok(Math.abs(total(hv) - 2) < 1e-6, '槽底虚线贯通全长 2');
  assert.equal(r.views.W.hidden.length, 0, '左视图槽为可见轮廓');
});

test('楔形体：主视图中背后的棱为虚线', () => {
  const r = views(Geometry.create('wedge'));
  assert.equal(r.views.V.hidden.length, 1);
  assert.ok(Math.abs(total(r.views.V.hidden) - 1.8) < 1e-9, '虚线长 = 拉伸高度 1.8');
});

test('叠放组合体（圆柱 + 大圆锥）先做并集：俯视图里圆柱顶圆被圆锥底盘挡住画虚线', () => {
  const m = Geometry.create('tower');
  const r = computeViews(prepareModel(m, SolidCSG), id);
  const rad = (q) => Math.hypot(...local(r, 'H', q));
  assert.ok(r.views.H.hidden.length > 0 && r.views.H.hidden.every((q) => Math.abs(rad(q) - 0.8) < 1e-6));
  assert.ok(chainPolylines(r.views.H.hidden).length === 1, '虚线圆连成一条折线');
});

test('任意旋转后三视图仍满足长对正、高平齐、宽相等（以 3 个进阶模型为例）', () => {
  const rot = (p) => { const a = 0.7, b = -0.4; let [x, y, z] = p; [x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; [y, z] = [y * Math.cos(b) - z * Math.sin(b), y * Math.sin(b) + z * Math.cos(b)]; return [x, y, z + 1]; };
  for (const name of ['mech-001', 'mech-046', 'mech-073']) {
    const r = computeViews(prepareModel(Geometry.create(name), SolidCSG), rot);
    const box = (k) => { let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const q of [...r.views[k].visible, ...r.views[k].hidden]) b = [Math.min(b[0], q[0], q[2]), Math.min(b[1], q[1], q[3]), Math.max(b[2], q[0], q[2]), Math.max(b[3], q[1], q[3])]; return b; };
    const V = box('V'), W = box('W'), H = box('H');
    assert.ok(Math.abs(V[0] - H[0]) < 1e-6 && Math.abs(V[2] - H[2]) < 1e-6, name + ' 长对正');
    assert.ok(Math.abs(V[1] - W[1]) < 1e-6 && Math.abs(V[3] - W[3]) < 1e-6, name + ' 高平齐');
    assert.ok(Math.abs(-H[3] - W[0]) < 1e-6 && Math.abs(-H[1] - W[2]) < 1e-6, name + ' 宽相等');
  }
});

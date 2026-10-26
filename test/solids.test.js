import test from 'node:test';
import assert from 'node:assert/strict';
import { SOLIDS, buildSolid, edgeAdjacency, classifyEdges, creasedNormals } from '../src/geometry.js';
import { makePlanes, viewLines, eulerMatrix, transformPositions } from '../src/projection.js';

test('共 45 种几何体，id 与名称唯一', () => {
  assert.equal(SOLIDS.length, 45);
  assert.equal(new Set(SOLIDS.map((s) => s.id)).size, 45);
  assert.equal(new Set(SOLIDS.map((s) => s.name)).size, 45);
});

for (const s of SOLIDS) {
  test(`几何体有效：${s.name}`, () => {
    const m = buildSolid(s.id);
    assert.ok(m.positions.length >= 36, '至少 4 个三角形');
    for (const x of m.positions) assert.ok(Number.isFinite(x), '无 NaN/Infinity');
    // 包围盒：已归一化，中心在原点，最大半尺寸为 1
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], m.positions[i + k]); mx[k] = Math.max(mx[k], m.positions[i + k]); }
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(mn[k] + mx[k]) < 1e-9, '包围盒居中');
    assert.ok(Math.abs(Math.max(...mx) - 1) < 1e-9, '最大半尺寸 = 1');
    // 每个部件封闭且方向一致：每条边恰好被两个三角形以相反方向共用
    for (let part = 0; part < m.parts; part++) {
      const tris = [];
      for (let t = 0; t < m.partOf.length; t++) if (m.partOf[t] === part) tris.push(t);
      const idx = new Uint32Array(tris.length * 3);
      tris.forEach((t, i) => { idx[i * 3] = m.index[t * 3]; idx[i * 3 + 1] = m.index[t * 3 + 1]; idx[i * 3 + 2] = m.index[t * 3 + 2]; });
      for (const e of edgeAdjacency(idx)) {
        assert.equal(e.tris.length, 2, `部件 ${part} 有开放或非流形边`);
        assert.equal(e.dirs[0] + e.dirs[1], 0, `部件 ${part} 法线方向不一致`);
      }
      // 体积为正（法线朝外）
      let v = 0;
      for (const t of tris) { const o = t * 9, p = m.positions; v += (p[o] * (p[o + 4] * p[o + 8] - p[o + 5] * p[o + 7]) - p[o + 1] * (p[o + 3] * p[o + 8] - p[o + 5] * p[o + 6]) + p[o + 2] * (p[o + 3] * p[o + 7] - p[o + 4] * p[o + 6])) / 6; }
      assert.ok(v > 1e-3, '体积为正');
    }
    const n = creasedNormals(m.positions, m.index);
    for (const x of n) assert.ok(Number.isFinite(x));
  });
}

// 已知体积：校验构建出的尺寸
test('体积校验：正方体 = 8，圆柱 ≈ πr²h', () => {
  const vol = (m) => { let v = 0; const p = m.positions; for (let o = 0; o < p.length; o += 9) v += (p[o] * (p[o + 4] * p[o + 8] - p[o + 5] * p[o + 7]) - p[o + 1] * (p[o + 3] * p[o + 8] - p[o + 5] * p[o + 6]) + p[o + 2] * (p[o + 3] * p[o + 7] - p[o + 4] * p[o + 6])) / 6; return v; };
  assert.ok(Math.abs(vol(buildSolid('cube')) - 8) < 1e-9);
  // 圆柱归一化后 r=0.8, h=2；48 边形内接面积 = 0.5·n·r²·sin(2π/n)
  const n = 48, r = 0.8, h = 2;
  assert.ok(Math.abs(vol(buildSolid('cylinder')) - 0.5 * n * r * r * Math.sin((2 * Math.PI) / n) * h) < 1e-9);
});

// 三视图可见性
const planes = makePlanes(2.2, 3);
const linesOf = (id, rot = [0, 0, 0]) => {
  const m = buildSolid(id);
  const R = eulerMatrix(...rot);
  const pos = transformPositions(m.positions, R), ver = transformPositions(m.vertices, R);
  const E = classifyEdges(pos, m.index);
  return Object.fromEntries(['V', 'H', 'W'].map((k) => [k, viewLines(pos, ver, E, planes[k])]));
};
const total = (segs) => { let s = 0; for (let i = 0; i < segs.length; i += 4) s += Math.hypot(segs[i + 2] - segs[i], segs[i + 3] - segs[i + 1]); return s; };

test('三视图：正方体三面都没有虚线', () => {
  const L = linesOf('cube');
  for (const k of ['V', 'H', 'W']) { assert.equal(L[k].hidden.length, 0); assert.ok(total(L[k].visible) >= 8 - 1e-9); }
});

test('三视图：带圆孔方块——主视图、左视图有两条虚线（孔的轮廓），俯视图孔为实线圆', () => {
  const L = linesOf('holeblock');
  for (const k of ['V', 'W']) {
    const h = L[k].hidden;
    assert.equal(h.length / 4, 2, `${k} 应有 2 段虚线`);
    for (let i = 0; i < h.length; i += 4) assert.ok(Math.abs(h[i] - h[i + 2]) < 1e-9, '虚线竖直');
    const xs = [h[0], h[4]].sort((a, b) => a - b);
    assert.ok(Math.abs(xs[0] + xs[1]) < 1e-9, '对称分布');
  }
  assert.equal(L.H.hidden.length, 0);
});

test('三视图：轴承座水平孔——主视图为实线圆，俯/左视图为虚线', () => {
  const L = linesOf('bearing');
  assert.equal(L.V.hidden.length, 0);
  assert.equal(L.H.hidden.length / 4, 2);
  assert.equal(L.W.hidden.length / 4, 2);
});

test('三视图：L 形块（轮廓沿 Y 拉伸）主视图无虚线', () => {
  const L = linesOf('lblock');
  assert.equal(L.V.hidden.length, 0);
});

test('三视图：U 形槽块——俯视图无虚线，左视图槽底为虚线', () => {
  const L = linesOf('ublock');
  assert.equal(L.V.hidden.length, 0);
  assert.equal(L.H.hidden.length, 0);
  assert.ok(L.W.hidden.length > 0, '左视图看不到槽底，应为虚线');
});

test('三视图：旋转后的正方体（任意角）可见线不出现 NaN', () => {
  const L = linesOf('cube', [0.4, 0.7, -0.3]);
  for (const k of ['V', 'H', 'W']) for (const x of [...L[k].visible, ...L[k].hidden]) assert.ok(Number.isFinite(x));
});

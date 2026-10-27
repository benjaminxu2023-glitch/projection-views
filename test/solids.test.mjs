import test from 'node:test';
import assert from 'node:assert/strict';
import { SOLIDS, SOLID_IDS, buildSolid } from '../src/solids.js';
import { WALLS } from '../src/projection.js';
import { computeView } from '../src/views.js';

test('一共 45 种几何体，id 不重复', () => {
  assert.equal(SOLIDS.length, 45);
  assert.equal(new Set(SOLID_IDS).size, 45);
});

for (const id of SOLID_IDS) {
  test(`几何体 ${id} 能生成、封闭、体积为正、尺寸归一`, () => {
    const s = buildSolid(id);
    const v = s.verts, t = s.tris;
    assert.ok(t.length >= 12 && t.length % 3 === 0);
    // 封闭：每条有向边恰好有一条反向边
    const key = (a, b) => `${a},${b}`;
    const dir = new Map();
    for (let i = 0; i < t.length; i += 3) for (let j = 0; j < 3; j++) { const k = key(t[i + j], t[i + (j + 1) % 3]); dir.set(k, (dir.get(k) || 0) + 1); }
    for (const [k, n] of dir) { assert.equal(n, 1, `重复边 ${k}`); const [a, b] = k.split(','); assert.equal(dir.get(key(b, a)), 1, `开口边 ${k}`); }
    // 体积（散度定理）
    let vol = 0;
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i], t[i + 1], t[i + 2]].map((k) => [v[3 * k], v[3 * k + 1], v[3 * k + 2]]);
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    assert.ok(vol > 0.05, `体积 ${vol}`);
    let mx = 0; for (let i = 0; i < v.length; i += 3) for (let j = 0; j < 3; j++) mx = Math.max(mx, Math.abs(v[i + j]));
    assert.ok(mx <= 1.0001 && mx > 0.5, `最大半尺寸 ${mx}`);
    // 三视图都有可见线
    for (const k of ['V', 'W', 'H']) assert.ok(computeView(s, s.verts, s.triNormals, WALLS[k]).visible.length > 0);
  });
}

test('三视图虚线：正方体 4 实 4 虚（背面棱被挡住）', () => {
  const s = buildSolid('cube');
  for (const k of ['V', 'W', 'H']) {
    const r = computeView(s, s.verts, s.triNormals, WALLS[k]);
    assert.equal(r.visible.length / 4, 4, k);
    assert.equal(r.hidden.length / 4, 4, k);
  }
});

test('三视图虚线：带孔块的孔在俯视图、左视图中是虚线，球没有虚线', () => {
  const h = buildSolid('holeblock');
  const V = computeView(h, h.verts, h.triNormals, WALLS.V);
  const H = computeView(h, h.verts, h.triNormals, WALLS.H);
  assert.equal(V.hidden.length > 0, true);
  assert.ok(H.hidden.length / 4 > 4, '俯视图应有孔的虚线');
  const sp = buildSolid('sphere');
  for (const k of ['V', 'W', 'H']) assert.equal(computeView(sp, sp.verts, sp.triNormals, WALLS[k]).hidden.length, 0);
});

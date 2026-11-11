// 主页回归：45 种几何体的网格、法线、棱线和三视图（未旋转）结果与改造前（commit 26ef766）逐字节相同。
// 哈希由改造前的代码算出；如果以后有意改动主页几何体，需要同时更新这里的值。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SOLID_IDS, buildSolid } from '../src/solids.js';
import { computeView } from '../src/views.js';
import { WALLS } from '../src/projection.js';

test('主页 45 种几何体：buildSolid + computeView 结果与改造前逐字节相同', () => {
  const h = crypto.createHash('sha256');
  for (const id of SOLID_IDS) {
    const s = buildSolid(id);
    h.update(id);
    for (const a of [s.verts, s.tris, s.triNormals, s.edges, s.featureLines, s.geometry.attributes.position.array, s.geometry.attributes.normal.array]) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    for (const k of ['V', 'W', 'H']) h.update(JSON.stringify(computeView(s, s.verts, s.triNormals, WALLS[k])));
  }
  assert.equal(h.digest('hex'), 'caf8428bbaab3ee71ff712d409be6688008345bcb96dc998ab0842bb607ddd1d');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlanes, projectParallel, projectCentral, enlargement, toUV, fromUV, eulerMatrix, transformPositions, clipToRect, projectMesh } from '../src/projection.js';

const P = 2; // 用整数便于手算
const planes = makePlanes(P, 3);
const near = (a, b, eps = 1e-12) => { assert.equal(a.length, b.length); a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) <= eps, `index ${i}: ${x} vs ${b[i]}`)); };

test('正投影：V/H/W 三面坐标（手算）', () => {
  const p = [0.5, -0.3, 1.2];
  near(projectParallel(p, planes.V), [0.5, 2, 1.2]); // 主视图：去掉 y
  near(projectParallel(p, planes.H), [0.5, -0.3, -2]); // 俯视图：去掉 z
  near(projectParallel(p, planes.W), [2, -0.3, 1.2]); // 左视图：去掉 x
  near(toUV(planes.V, p), [0.5, 1.2]);
  near(toUV(planes.H, p), [0.5, -0.3]);
  near(toUV(planes.W, p), [0.3, 1.2]); // u = −y
});

test('正投影：与深度无关（同一投射线上的点投影重合）', () => {
  for (const y of [-1.5, 0, 1.9]) near(projectParallel([0.7, y, -0.4], planes.V), [0.7, 2, -0.4]);
});

test('正投影：点在投影面上时投影是它自身', () => {
  near(projectParallel([1, 2, 0.5], planes.V), [1, 2, 0.5]);
  near(projectParallel([1, 0.2, -2], planes.H), [1, 0.2, -2]);
});

test('中心投影：手算交点', () => {
  // 光源 L=(0,-4,0)，V 面 y=2。点 (1,-1,0.5)：t=(2+4)/(-1+4)=2 → (2, 2, 1)
  near(projectCentral([1, -1, 0.5], [0, -4, 0], planes.V), [2, 2, 1]);
  // 光源 L=(1,1,6)，H 面 z=-2。点 (2,0,2)：t=(-2-6)/(2-6)=2 → (3,-1,-2)
  near(projectCentral([2, 0, 2], [1, 1, 6], planes.H), [3, -1, -2]);
  // 光源 L=(-3,0,0)，W 面 x=2。点 (-0.5,1,-1)：t=5/2.5=2 → (2, 2, -2)
  near(projectCentral([-0.5, 1, -1], [-3, 0, 0], planes.W), [2, 2, -2]);
  // 非整数比例：L=(-1,-5,2)，点 (0.5,-1,0)：t=7/4 → x=-1+1.5*1.75=1.625, z=2-2*1.75=-1.5
  near(projectCentral([0.5, -1, 0], [-1, -5, 2], planes.V), [1.625, 2, -1.5]);
});

test('中心投影：投影点、原点、光源三点共线', () => {
  const L = [-2.3, -3.7, 3.1];
  for (const p of [[0.2, 0.4, -0.1], [-0.9, 0.9, 0.8], [1, -1, 1]]) {
    for (const k of ['V', 'H', 'W']) {
      const q = projectCentral(p, L, planes[k]);
      const a = [p[0] - L[0], p[1] - L[1], p[2] - L[2]], b = [q[0] - L[0], q[1] - L[1], q[2] - L[2]];
      const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      assert.ok(Math.hypot(...c) < 1e-9, '共线');
      assert.ok(Math.abs(q[planes[k].axis] - planes[k].value) < 1e-12, '落在投影面上');
    }
  }
});

test('中心投影：放大比 = 光源到面距离 / 光源到物体层距离', () => {
  const L = [0, -4, 0];
  // 平行于 V 面、位于 y=-1 的线段，长度 1 → 投影长度应为 6/3 = 2 倍
  const a = projectCentral([0, -1, 0], L, planes.V), b = projectCentral([1, -1, 0], L, planes.V);
  assert.equal(enlargement(L, planes.V, -1), 2);
  assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[2] - a[2]) - 2) < 1e-12);
  // 物体层越靠近投影面，放大越小；在面上时比值 = 1
  assert.ok(enlargement(L, planes.V, 1) < enlargement(L, planes.V, 0));
  assert.equal(enlargement(L, planes.V, 2), 1);
  // 光源无限远时趋近正投影
  const far = [0.3, -1e9, 0.2];
  const q = projectCentral([0.3, 0.5, 0.2], far, planes.V);
  assert.ok(Math.abs(q[0] - 0.3) < 1e-6 && Math.abs(q[2] - 0.2) < 1e-6);
});

test('中心投影：点在投影面上时投影是它自身', () => {
  near(projectCentral([0.4, 2, -0.6], [-1, -3, 2], planes.V), [0.4, 2, -0.6]);
});

test('中心投影：退化情况返回 null', () => {
  const pl = planes.V;
  assert.equal(projectCentral([0, 0, 0], [0, 2, 0], pl), null, '光源在投影面上');
  assert.equal(projectCentral([1, -4, 0], [0, -4, 0], pl), null, '点与光源同层（射线平行于投影面）');
  assert.equal(projectCentral([0, -5, 0], [0, -4, 0], pl), null, '点在光源后方');
  assert.equal(projectCentral([0, 3, 0], [0, -4, 0], pl), null, '点在投影面另一侧');
  assert.ok(Number.isNaN(enlargement([0, -4, 0], pl, -5)));
});

test('fromUV 与 toUV 互逆', () => {
  for (const k of ['V', 'H', 'W']) {
    const uv = [0.37, -1.21];
    near(toUV(planes[k], fromUV(planes[k], uv)), uv);
    const p = fromUV(planes[k], uv);
    assert.equal(p[planes[k].axis], planes[k].value);
  }
});

test('欧拉矩阵：90° 绕 Z 把 X 轴转到 Y 轴；正交矩阵', () => {
  const m = eulerMatrix(0, 0, Math.PI / 2);
  near([...transformPositions([1, 0, 0], m)], [0, 1, 0], 1e-12);
  const r = eulerMatrix(0.3, -1.1, 2.2);
  const t = (i, j) => r[i * 3 + j];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0; for (let k = 0; k < 3; k++) s += t(i, k) * t(j, k);
    assert.ok(Math.abs(s - (i === j ? 1 : 0)) < 1e-12);
  }
});

test('矩形裁剪', () => {
  const r = clipToRect([[0, 0], [4, 0], [0, 4]], [-1, 2, -1, 2]);
  // 三角形被裁成五边形：(0,0)(2,0)(2,2)(2,2)?(0,2)… 面积 = 4 − 0.5*0*… 直接算
  let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  assert.ok(Math.abs(a / 2 - 4) < 1e-12, '裁剪后为 2×2 正方形（斜边 x+y=4 恰好过角点 (2,2)）');
  assert.equal(clipToRect([[5, 5], [6, 5], [5, 6]], [-1, 2, -1, 2]).length, 0);
});

test('网格投影：单位正方形面片的正投影与中心投影面积', () => {
  // 位于 y=0 的正方形 [0,1]×[0,1]（xz），两三角形
  const pos = new Float64Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1]);
  const area = (uv) => { let s = 0; for (let i = 0; i < uv.length; i += 6) s += Math.abs((uv[i + 2] - uv[i]) * (uv[i + 5] - uv[i + 1]) - (uv[i + 3] - uv[i + 1]) * (uv[i + 4] - uv[i])) / 2; return s; };
  assert.ok(Math.abs(area(projectMesh(pos, planes.V, 'parallel').uv) - 1) < 1e-12);
  // 光源 y=-2，面 y=2：线性放大 2 倍 → 面积 4 倍
  const r = projectMesh(pos, planes.V, 'central', [0.5, -2, 0.5]);
  assert.equal(r.invalid, 0);
  assert.ok(Math.abs(area(r.uv) - 4) < 1e-12);
  // 该面片垂直于 H 面 → 俯视投影面积为 0（退化三角形被跳过）
  assert.equal(projectMesh(pos, planes.H, 'parallel').uv.length, 0);
  // 光源在点后方 → 计入 invalid
  assert.equal(projectMesh(pos, planes.V, 'central', [0, 0.5, 0]).invalid, 2);
});

test('欧拉矩阵与 Three.js r160 Euler("XYZ") 一致（参考值由 three@0.160.0 计算）', () => {
  const ref = [-0.266941824242, -0.366730832959, -0.891207360061, 0.927379527574, -0.349283068594, -0.134046819544, -0.262124539689, -0.862270163087, 0.433336926124];
  near(eulerMatrix(0.3, -1.1, 2.2), ref, 1e-11);
});

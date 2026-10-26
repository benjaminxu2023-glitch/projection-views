import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.min.js';
import { WALLS, projectOrtho, projectCentral, toWallUV, magnification, rotationMatrix, applyMat3, dot } from '../src/projection.js';

const close = (a, b, eps = 1e-9) => { assert.equal(a.length, b.length); a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < eps, `${a} ≠ ${b}`)); };

test('正投影：手算点 P(3,2,1)', () => {
  const P = [3, 2, 1];
  close(projectOrtho(P, WALLS.V), [3, 0, 1]);
  close(projectOrtho(P, WALLS.W), [0, 2, 1]);
  close(projectOrtho(P, WALLS.H), [3, 2, 0]);
  // 面上坐标：V 面 u = -x, v = z；W 面 u = y, v = z；H 面 u = -x, v = -y
  close(toWallUV(projectOrtho(P, WALLS.V), WALLS.V), [-3, 1]);
  close(toWallUV(projectOrtho(P, WALLS.W), WALLS.W), [2, 1]);
  close(toWallUV(projectOrtho(P, WALLS.H), WALLS.H), [-3, -2]);
});

test('正投影：长方体在三个面上的投影尺寸 = 实长（长对正、高平齐、宽相等）', () => {
  const box = []; for (const x of [1, 4]) for (const y of [2, 3.5]) for (const z of [0.5, 2.5]) box.push([x, y, z]);
  const ext = (k, i) => { const u = box.map((p) => toWallUV(projectOrtho(p, WALLS[k]), WALLS[k])[i]); return Math.max(...u) - Math.min(...u); };
  assert.equal(ext('V', 0), 3); assert.equal(ext('H', 0), 3); // 长对正
  assert.equal(ext('V', 1), 2); assert.equal(ext('W', 1), 2); // 高平齐
  assert.equal(ext('W', 0), 1.5); assert.equal(ext('H', 1), 1.5); // 宽相等
});

test('中心投影：手算 L=(2,6,3) 经 P(3,4,2) 投到 V 面 (y=0)', () => {
  // t = 6 / (6 - 4) = 3 → Q = L + 3(P - L) = (2+3, 6-6, 3-3) = (5, 0, 0)
  close(projectCentral([3, 4, 2], [2, 6, 3], WALLS.V), [5, 0, 0]);
});

test('中心投影：手算 L=(1,1,8) 经 P(2,3,4) 投到 H 面 (z=0)', () => {
  // t = 8 / (8 - 4) = 2 → Q = (1+2, 1+4, 0) = (3, 5, 0)
  close(projectCentral([2, 3, 4], [1, 1, 8], WALLS.H), [3, 5, 0]);
  close(toWallUV([3, 5, 0], WALLS.H), [-3, -5]);
});

test('中心投影：手算 L=(7,2,2) 经 P(3.5,2.5,1) 投到 W 面 (x=0)', () => {
  // t = 7 / 3.5 = 2 → Q = (0, 3, 0)
  close(projectCentral([3.5, 2.5, 1], [7, 2, 2], WALLS.W), [0, 3, 0]);
});

test('中心投影：点在光源背后时没有投影', () => {
  assert.equal(projectCentral([1, 7, 1], [2, 6, 3], WALLS.V), null);
  assert.equal(projectCentral([1, 6, 1], [2, 6, 3], WALLS.V), null);
});

test('中心投影：平行截面的放大倍数 = 光源到面 / 光源到截面', () => {
  const L = [2.5, 2.5 + 3.2, 2.1]; // V 面前方 3.2 处
  assert.ok(Math.abs(magnification(L, 2.5, WALLS.V) - 5.7 / 3.2) < 1e-12);
  // 边长 1 的正方形截面 (y=2.5) 投影后边长 = 1 × 5.7/3.2
  const a = projectCentral([2, 2.5, 1.6], L, WALLS.V), b = projectCentral([3, 2.5, 1.6], L, WALLS.V);
  assert.ok(Math.abs(Math.hypot(a[0] - b[0], a[2] - b[2]) - 5.7 / 3.2) < 1e-12);
  // 光源越远，越接近正投影
  const far = projectCentral([3, 2.5, 1.6], [2.5, 1e7, 2.1], WALLS.V);
  close(far, [3, 0, 1.6], 1e-5);
});

test('旋转矩阵与 Three.js Euler XYZ 一致、正交', () => {
  for (const [a, b, c] of [[0, 0, 0], [30, 0, 0], [0, 45, 0], [0, 0, 90], [20, -15, 35], [-170, 80, 123]]) {
    const m = rotationMatrix(a, b, c);
    const r = Math.PI / 180;
    const tm = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(a * r, b * r, c * r, 'XYZ')).elements; // 列主序
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(m[i * 3 + j] - tm[j * 4 + i]) < 1e-12);
    const p = [0.3, -1.2, 2]; assert.ok(Math.abs(Math.hypot(...applyMat3(m, p)) - Math.hypot(...p)) < 1e-12);
  }
  close(applyMat3(rotationMatrix(0, 0, 90), [1, 0, 0]), [0, 1, 0], 1e-12);
});

test('三个面的局部坐标系是右手系，N 指向物体', () => {
  for (const w of Object.values(WALLS)) {
    const c = [w.U[1] * w.V[2] - w.U[2] * w.V[1], w.U[2] * w.V[0] - w.U[0] * w.V[2], w.U[0] * w.V[1] - w.U[1] * w.V[0]];
    close(c, w.N); assert.ok(dot(w.N, [2.5, 2.5, 2.1]) > 0);
  }
});

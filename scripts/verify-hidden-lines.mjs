// 独立核对三视图虚实线（不依赖浏览器）：node scripts/verify-hidden-lines.mjs [输出 json] [模型 id…]
// 对 geometry-76 的 176 个模型（以及主页 45 种几何体），在两个姿态下调用引擎的 computeView 得到实线 / 虚线，
// 再用与 views.js 完全不同的方法核对：
//   · 可见性：在每条输出线段上取引擎采样格的中心点，从该点沿投射方向（朝观察者）发射射线，
//     用 Möller–Trumbore 算法对“全部”三角形逐个求交（只用二维包围盒做粗筛，不用 views.js 的栅格），
//     射线在 2e-3·span 以外打到任何三角形 = 被遮挡（应为虚线），否则应为实线；
//     点的投影恰好落在遮挡面轮廓上（距离 < 1e-4·span）或深度差在 0.5e-3~2e-3·span 之间的记为“临界”，单独统计；
//   · 完整性：用自己算的面法线重新判断哪些棱该画（棱线 kind=1，或光滑棱两侧面一正一背 = 转向轮廓），
//     检查每条该画的棱都被实线 + 虚线完整覆盖，不该画的棱没有输出。
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname;
const CENTER = [2.5, 2.5, 2.1]; // 与 src/app.js 相同：物体中心位置
const POSES = [[0, 0, 0], [20, -15, 35]];

async function loadAll() {
  const scope = vm.createContext({ console });
  for (const f of ['geometry.js', 'csg.js', 'advanced.js', 'library.js']) vm.runInContext(fs.readFileSync(ROOT + 'geometry-76/' + f, 'utf8'), scope);
  const L = vm.runInContext('PVLibrary', scope);
  const solids = await import(ROOT + 'src/solids.js');
  const { computeView } = await import(ROOT + 'src/views.js');
  const P = await import(ROOT + 'src/projection.js');
  return { L, solids, computeView, P };
}

function rotate(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }

function checkModel(env, solid) {
  const { computeView, P } = env;
  const out = { id: solid.id, tris: solid.tris.length / 3, samples: 0, pass: 0, fail: 0, ambiguous: 0, ambiguousCoveredByVisible: 0, missing: 0, extra: 0, edgeOnSkipped: 0, failures: [], segments: { visible: 0, hidden: 0 } };
  const T = solid.tris, nT = T.length / 3;
  for (const pose of POSES) {
    const m = P.rotationMatrix(...pose);
    const nV = solid.verts.length / 3;
    const W = new Float64Array(nV * 3);
    for (let i = 0; i < nV; i++) { const q = rotate(m, [solid.verts[i * 3], solid.verts[i * 3 + 1], solid.verts[i * 3 + 2]]); W[i * 3] = q[0] + CENTER[0]; W[i * 3 + 1] = q[1] + CENTER[1]; W[i * 3 + 2] = q[2] + CENTER[2]; }
    const WN = new Float32Array(nT * 3);
    for (let t = 0; t < nT; t++) { const q = rotate(m, [solid.triNormals[t * 3], solid.triNormals[t * 3 + 1], solid.triNormals[t * 3 + 2]]); WN.set(q, t * 3); }
    const wv32 = Float32Array.from(W); // 引擎在浏览器里用的是 Float32Array
    // 自己的面法线（由顶点重新计算，不用 triNormals）
    const myN = new Float64Array(nT * 3), myA = new Float64Array(nT);
    for (let t = 0; t < nT; t++) {
      const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
      const e1 = [W[b] - W[a], W[b + 1] - W[a + 1], W[b + 2] - W[a + 2]], e2 = [W[c] - W[a], W[c + 1] - W[a + 1], W[c + 2] - W[a + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...n) || 1; myN[t * 3] = n[0] / l; myN[t * 3 + 1] = n[1] / l; myN[t * 3 + 2] = n[2] / l; myA[t] = l;
    }
    for (const key of ['V', 'W', 'H']) {
      const wall = P.WALLS[key];
      const trace = { vis: [], hid: [] };
      const res = computeView(solid, wv32, WN, wall, trace);
      out.segments.visible += res.visible.length / 4; out.segments.hidden += res.hidden.length / 4;
      const U = wall.U, V = wall.V, N = wall.N;
      const pu = (i) => W[i * 3] * U[0] + W[i * 3 + 1] * U[1] + W[i * 3 + 2] * U[2];
      const pv = (i) => W[i * 3] * V[0] + W[i * 3 + 1] * V[1] + W[i * 3 + 2] * V[2];
      let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
      for (let i = 0; i < nV; i++) { const u = pu(i), v = pv(i); umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
      const span = Math.max(umax - umin, vmax - vmin, 1e-6);
      // 三角形二维包围盒（粗筛）
      const bb = new Float64Array(nT * 4);
      for (let t = 0; t < nT; t++) {
        const us = [pu(T[t * 3]), pu(T[t * 3 + 1]), pu(T[t * 3 + 2])], vs = [pv(T[t * 3]), pv(T[t * 3 + 1]), pv(T[t * 3 + 2])];
        bb[t * 4] = Math.min(...us); bb[t * 4 + 1] = Math.max(...us); bb[t * 4 + 2] = Math.min(...vs); bb[t * 4 + 3] = Math.max(...vs);
      }
      const T1 = 2e-3 * span, T0 = 0.5e-3 * span, DB = 1e-4 * span; // DB：点到遮挡面投影轮廓的距离小于它算临界
      function castOne(p) {
        const u0 = p[0] * U[0] + p[1] * U[1] + p[2] * U[2], v0 = p[0] * V[0] + p[1] * V[1] + p[2] * V[2];
        let band = false;
        for (let t = 0; t < nT; t++) {
          if (u0 < bb[t * 4] - 1e-6 || u0 > bb[t * 4 + 1] + 1e-6 || v0 < bb[t * 4 + 2] - 1e-6 || v0 > bb[t * 4 + 3] + 1e-6) continue;
          const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
          const e1 = [W[b] - W[a], W[b + 1] - W[a + 1], W[b + 2] - W[a + 2]], e2 = [W[c] - W[a], W[c + 1] - W[a + 1], W[c + 2] - W[a + 2]];
          const h = [N[1] * e2[2] - N[2] * e2[1], N[2] * e2[0] - N[0] * e2[2], N[0] * e2[1] - N[1] * e2[0]];
          const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
          const cr = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
          if (Math.abs(det) < 1e-6 * cr) continue; // 面与投射方向平行（侧对观察者），投影成线，不遮挡
          const inv = 1 / det;
          const s = [p[0] - W[a], p[1] - W[a + 1], p[2] - W[a + 2]];
          const bu = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) * inv;
          const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
          const bv = (N[0] * q[0] + N[1] * q[1] + N[2] * q[2]) * inv;
          const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
          const bw = 1 - bu - bv;
          if (Math.min(bu, bv, bw) < -1e-3) continue; // 明显不在三角形内
          // 投影平面上点到三角形边界的有向距离（>0 在内部）：用来识别“恰好落在遮挡面轮廓上”的临界点
          const ua = pu(T[t * 3]), va = pv(T[t * 3]), ub = pu(T[t * 3 + 1]), vb = pv(T[t * 3 + 1]), uc = pu(T[t * 3 + 2]), vc = pv(T[t * 3 + 2]);
          const sg = Math.sign((ub - ua) * (vc - va) - (uc - ua) * (vb - va)) || 1;
          const ed = (x0, y0, x1, y1) => sg * ((x1 - x0) * (v0 - y0) - (y1 - y0) * (u0 - x0)) / (Math.hypot(x1 - x0, y1 - y0) || 1);
          const dIn = Math.min(ed(ua, va, ub, vb), ed(ub, vb, uc, vc), ed(uc, vc, ua, va));
          if (dIn < 0) continue;
          if (tt > T1) return { hit: true, band: false };
          if (tt > T0) band = true;
        }
        return { hit: false, band };
      }
      // 在点周围 8 个方向各偏移 2·DB 再判断：全部被挡 = 虚线，全部不被挡 = 实线；
      // 有的挡有的不挡 = 这一点恰好落在遮挡面的投影轮廓上（例如背后的棱与前面的轮廓线重合），记为临界。
      const OFF = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
      function rayState(p) {
        let h = 0, band = false;
        for (const [du, dv] of OFF) {
          const q = [p[0] + 2 * DB * (du * U[0] + dv * V[0]), p[1] + 2 * DB * (du * U[1] + dv * V[1]), p[2] + 2 * DB * (du * U[2] + dv * V[2])];
          const r = castOne(q); if (r.hit) h++; if (r.band) band = true;
        }
        if (band && h < OFF.length) return { hidden: h > 0, sure: false };
        if (h === OFF.length) return { hidden: true, sure: true };
        if (h === 0) return { hidden: false, sure: true };
        return { hidden: h > OFF.length / 2, sure: false };
      }
      // 哪些棱该画（独立判断）
      const E = solid.edges;
      const cover = new Map();
      for (const [list, cls] of [[trace.vis, 'vis'], [trace.hid, 'hid']]) for (let i = 0; i < list.length; i += 3) {
        const e = list[i]; let c = cover.get(e); if (!c) cover.set(e, (c = [])); c.push([list[i + 1], list[i + 2], cls]);
      }
      const visibleSegs = res.visible;
      const onVisible = (u, v, skipEdge = -1) => { for (let i = 0; i < visibleSegs.length; i += 4) { if (trace.vis[(i / 4) * 3] === skipEdge) continue; const x0 = visibleSegs[i], y0 = visibleSegs[i + 1], x1 = visibleSegs[i + 2], y1 = visibleSegs[i + 3]; const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy; if (L2 < 1e-18) continue; const s = Math.max(0, Math.min(1, ((u - x0) * dx + (v - y0) * dy) / L2)); if (Math.hypot(x0 + dx * s - u, y0 + dy * s - v) < 2e-3 * span) return true; } return false; };
      for (let ei = 0; ei < E.length / 5; ei++) {
        const a = E[ei * 5], b = E[ei * 5 + 1], t1 = E[ei * 5 + 2], t2 = E[ei * 5 + 3], kind = E[ei * 5 + 4];
        let draw = kind === 1;
        let edgeOn = false;
        if (kind === 0) { const s1 = myN[t1 * 3] * N[0] + myN[t1 * 3 + 1] * N[1] + myN[t1 * 3 + 2] * N[2], s2 = myN[t2 * 3] * N[0] + myN[t2 * 3 + 1] * N[1] + myN[t2 * 3 + 2] * N[2]; draw = (s1 > 1e-9) !== (s2 > 1e-9); edgeOn = Math.abs(s1) < 1e-5 || Math.abs(s2) < 1e-5 || myA[t1] < 1e-7 || myA[t2] < 1e-7; }
        const du = pu(b) - pu(a), dv = pv(b) - pv(a), len = Math.hypot(du, dv);
        const segs = cover.get(ei) || [];
        if (len < 1e-6 * span) { if (segs.length) out.extra++; continue; }
        if (edgeOn && draw !== !!segs.length) { out.edgeOnSkipped++; continue; } // 侧面恰好与投射方向平行，或细长三角形（面积 < 1e-7，Float32 坐标下法线不稳定）：是否算轮廓取决于舍入，跳过并计数
        if (!draw) { if (segs.length) { out.extra++; if (out.failures.length < 40) out.failures.push({ pose, wall: key, edge: ei, type: 'extra' }); } continue; }
        const covered = segs.reduce((s, x) => s + (x[1] - x[0]), 0);
        if (Math.abs(covered - 1) > 1e-6) { out.missing++; if (out.failures.length < 40) out.failures.push({ pose, wall: key, edge: ei, type: 'missing', covered }); continue; }
        const n = Math.min(200, Math.max(2, Math.ceil(len / (span / 120))));
        for (const [s0, s1, cls] of segs) {
          const i0 = Math.round(s0 * n), i1 = Math.round(s1 * n) - 1;
          const picks = [...new Set([i0, Math.floor((i0 + i1) / 2), i1])].filter((i) => i >= i0 && i <= i1);
          for (const i of picks) {
            const s = (i + 0.5) / n;
            const p = [W[a * 3] + (W[b * 3] - W[a * 3]) * s, W[a * 3 + 1] + (W[b * 3 + 1] - W[a * 3 + 1]) * s, W[a * 3 + 2] + (W[b * 3 + 2] - W[a * 3 + 2]) * s];
            const r = rayState(p);
            out.samples++;
            if (!r.sure) {
              out.ambiguous++;
              if (onVisible(pu(a) + du * s, pv(a) + dv * s)) out.ambiguousCoveredByVisible++;
              continue;
            }
            const ok = (cls === 'hid') === r.hidden;
            if (ok) out.pass++;
            else {
              // 判错但同一位置已有实线：图面上看不出差别（虚线被实线覆盖），单独标注
              // 判成实线、实际应为虚线：若同一位置还有别的棱的实线（多为与遮挡面轮廓重合），图面上看不出差别
              const masked = cls === 'vis' && onVisible(pu(a) + du * s, pv(a) + dv * s, ei);
              out.fail++;
              if (out.failures.length < 40) out.failures.push({ pose, wall: key, edge: ei, type: cls === 'hid' ? 'drawn-hidden-but-visible' : 'drawn-visible-but-hidden', s: +s.toFixed(4), p: p.map((x) => +x.toFixed(4)), underVisible: cls === 'hid' && onVisible(pu(a) + du * s, pv(a) + dv * s), masked });
            }
          }
        }
      }
    }
  }
  return out;
}

if (isMainThread) {
  const outFile = process.argv[2] || '/workspace/projection-views-review/v2/hidden-line-check.json';
  const env = await loadAll();
  let ids = process.argv.slice(3);
  const all = [...env.L.items.map((x) => 'g76:' + x.id), ...env.solids.SOLID_IDS.map((x) => 'main:' + x)];
  if (!ids.length) ids = all; else ids = ids.map((x) => (x.includes(':') ? x : (env.L.has(x) ? 'g76:' + x : 'main:' + x)));
  const nW = Math.min(os.cpus().length, 7);
  const chunks = Array.from({ length: nW }, () => []);
  // 按三角形数从大到小轮流分配
  ids.forEach((id, i) => chunks[i % nW].push(id));
  const t0 = Date.now();
  const results = (await Promise.all(chunks.filter((c) => c.length).map((c) => new Promise((res, rej) => {
    const w = new Worker(new URL(import.meta.url), { workerData: c });
    w.on('message', res); w.on('error', rej);
  })))).flat();
  results.sort((a, b) => all.indexOf(a.key) - all.indexOf(b.key));
  const sum = (k, list = results) => list.reduce((s, r) => s + r[k], 0);
  const g = results.filter((r) => r.key.startsWith('g76:')), mn = results.filter((r) => r.key.startsWith('main:'));
  const summary = (list) => ({ models: list.length, samples: sum('samples', list), pass: sum('pass', list), fail: sum('fail', list), ambiguous: sum('ambiguous', list), ambiguousCoveredByVisible: sum('ambiguousCoveredByVisible', list), failMaskedByVisible: list.reduce((n, r) => n + r.failures.filter((f) => f.masked || f.underVisible).length, 0), missing: sum('missing', list), extra: sum('extra', list), edgeOnSkipped: sum('edgeOnSkipped', list), modelsAllPass: list.filter((r) => !r.fail && !r.missing && !r.extra).length });
  const report = { generated: new Date().toISOString(), poses: POSES, seconds: (Date.now() - t0) / 1000, geometry76: summary(g), main45: summary(mn), models: results };
  fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ geometry76: report.geometry76, main45: report.main45, seconds: report.seconds }, null, 1));
  for (const r of results) if (r.fail || r.missing || r.extra) console.log(r.key, 'samples', r.samples, 'fail', r.fail, 'missing', r.missing, 'extra', r.extra, 'ambiguous', r.ambiguous, JSON.stringify(r.failures.slice(0, 3)));
} else {
  const env = await loadAll();
  const out = [];
  for (const key of workerData) {
    const [src, id] = key.split(':');
    const solid = src === 'g76' ? env.solids.buildSolidFromMesh(env.L.meta(id), env.L.mesh(id)) : env.solids.buildSolid(id);
    const r = checkModel(env, solid);
    r.key = key;
    out.push(r);
  }
  parentPort.postMessage(out);
}

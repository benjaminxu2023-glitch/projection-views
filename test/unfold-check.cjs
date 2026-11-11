// 展开三视图自动化检查（Playwright）。
// 用法：NODE_PATH=/path/to/node_modules node test/unfold-check.cjs [输出目录]
//   需要先在仓库根目录起静态服务：python3 -m http.server 8876 --bind 127.0.0.1
//   环境变量 BASE 可覆盖地址（默认 http://127.0.0.1:8876/geometry-76/），ONLY=mech-001,cube 只测部分模型。
// 检查项（逐个模型）：
//   1. 切换到该模型、打开展开图后无 pageerror / console.error，SVG 中三个视图均有图形；
//   2. 尺寸对齐：长对正（V 与 H 的 X 范围）、高平齐（V 与 W 的 Z 范围）、宽相等（H 的 Y 范围与 W 的 Y 范围），
//      分别用“画出的轮廓线端点”和“投影填充三角形顶点”两套数据计算，容差 1e-6（世界单位，模型尺寸约 2.65）；
//   3. 独立隐藏线核对：不用渲染代码的投影栅格，而是在三维空间里沿投射方向做射线–三角形求交（Möller–Trumbore，
//      逐三角形暴力求交），重新判定每条棱线上采样点的可见性，再与渲染输出的实线/虚线逐点比对。
// 输出：每个模型 <编号>_<id>.svg 与 .png，report.json；mobile/ 下 390px 竖屏截图。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2] || '/workspace/projection-views-review';
const BASE = process.env.BASE || 'http://127.0.0.1:8876/geometry-76/';
fs.mkdirSync(path.join(OUT, 'mobile'), { recursive: true });

// 在页面内运行的独立核对（不调用 unfold.js 的任何遮挡判定函数）
function independentCheck() {
  const lab = window.__geometryLab, res = lab.unfold.result, model = lab.unfold.model;
  const P = res.world.P, tris = model.tris, triPoly = model.triPoly;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // 世界坐标下的面法线：由变换后三角形顶点重新计算
  const polyN = new Map();
  for (let t = 0; t < triPoly.length; t++) {
    const pid = triPoly[t];
    const a = P[tris[t * 3]], b = P[tris[t * 3 + 1]], c = P[tris[t * 3 + 2]];
    const n = cross(sub(b, a), sub(c, a)), l = Math.hypot(...n);
    if (l > 1e-12 && !polyN.has(pid)) polyN.set(pid, n.map((x) => x / l));
  }
  const views = {
    V: { T: [0, -1, 0], U: [1, 0, 0], W: [0, 0, 1], place: (u, v) => [u - res.wc[0] - res.off, v - res.wc[2] + res.off] },
    W: { T: [-1, 0, 0], U: [0, -1, 0], W: [0, 0, 1], place: (u, v) => [u + res.wc[1] + res.off, v - res.wc[2] + res.off] },
    H: { T: [0, 0, 1], U: [1, 0, 0], W: [0, 1, 0], place: (u, v) => [u - res.wc[0] - res.off, v - res.wc[1] - res.off] },
  };
  const inv = {
    V: (x, y) => [x + res.wc[0] + res.off, y + res.wc[2] - res.off],
    W: (x, y) => [x - res.wc[1] - res.off, y + res.wc[2] - res.off],
    H: (x, y) => [x + res.wc[0] + res.off, y + res.wc[1] + res.off],
  };
  const span = 2 * model.R, eps = 1e-5 * span;
  // 网格完整性：沿投射线穿过封闭实体表面的次数必为偶数；奇数说明该处 CSG 网格本身有裂缝（模型数据缺陷，不算画线错误）
  // 投射线正好擦过轮廓素线时，穿越次数会因退化而为奇数；所以不用原投射线，而是沿 4 个斜向（20°/110°/200°/290°）
  // 各偏移 1e-6 尺寸，四条偏移投射线的穿越次数都为奇数，才判定该点处网格有裂缝（模型数据缺陷）。
  function oddCrossings(k, p2) {
    const d = 1e-6 * span;
    return [20, 110, 200, 290].every((deg) => oddCrossingsAt(k, p2, d * Math.cos((deg * Math.PI) / 180), d * Math.sin((deg * Math.PI) / 180)));
  }
  function oddCrossingsAt(k, p2, du, dv) {
    const vw = views[k], uv = inv[k](p2[0], p2[1]), u = uv[0] + du, v = uv[1] + dv;
    const o = [0, 1, 2].map((j) => vw.U[j] * u + vw.W[j] * v - vw.T[j] * 100);
    const ts = [];
    for (let t = 0; t < tris.length / 3; t++) {
      const a = P[tris[t * 3]], b = P[tris[t * 3 + 1]], c = P[tris[t * 3 + 2]];
      const e1 = sub(b, a), e2 = sub(c, a), pv = cross(vw.T, e2), det = dot(e1, pv);
      if (Math.abs(det) < 1e-12) continue;
      const iv = 1 / det, tv = sub(o, a), uu = dot(tv, pv) * iv; if (uu < -1e-9 || uu > 1 + 1e-9) continue;
      const q = cross(tv, e1), vv = dot(vw.T, q) * iv; if (vv < -1e-9 || uu + vv > 1 + 1e-9) continue;
      ts.push(dot(e2, q) * iv);
    }
    ts.sort((x, y) => x - y);
    let n = 0; for (let i = 0; i < ts.length; i++) if (i === 0 || ts[i] - ts[i - 1] > 1e-7) n++;
    return n % 2 === 1;
  }
  function hit(o, d) {
    for (let t = 0; t < tris.length / 3; t++) {
      const a = P[tris[t * 3]], b = P[tris[t * 3 + 1]], c = P[tris[t * 3 + 2]];
      const e1 = sub(b, a), e2 = sub(c, a), pv = cross(d, e2), det = dot(e1, pv);
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, tv = sub(o, a), u = dot(tv, pv) * inv;
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      const q = cross(tv, e1), v = dot(d, q) * inv;
      if (v < -1e-9 || u + v > 1 + 1e-9) continue;
      if (dot(e2, q) * inv > eps) return true;
    }
    return false;
  }
  const distSeg = (p, s) => { const dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / L2)) : 0; return Math.hypot(p[0] - s[0] - dx * t, p[1] - s[1] - dy * t); };
  const near = (p, list, tol) => list.some((s) => distSeg(p, s) < tol);
  const tol = 3e-4 * span, cover = 1.6e-3 * span;
  const report = {};
  for (const k of ['V', 'W', 'H']) {
    const vw = views[k], out = res.views[k];
    const expVis = [], expHid = [], expVisCore = [], ambiguous = []; // 期望的可见 / 不可见“采样段”
    let ptsVis = [], ptsHid = [];
    for (const s of model.segs) {
      if (s.kind === 2) {
        const n1 = polyN.get(s.P[0]), n2 = polyN.get(s.P[1]);
        if (!n1 || !n2) continue;
        if (dot(n1, vw.T) > 1e-9 === dot(n2, vw.T) > 1e-9) continue;
      }
      const A = s.A, B = s.B;
      const a2 = vw.place(dot(A, vw.U), dot(A, vw.W)), b2 = vw.place(dot(B, vw.U), dot(B, vw.W));
      const L = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
      if (L < 1e-7 * span) continue;
      const n = Math.max(8, Math.ceil(L / (span / 200)));
      const st = [], pts = [];
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) / n, p3 = A.map((q, j) => q + (B[j] - q) * x);
        st.push(hit(p3.map((q, j) => q + vw.T[j] * eps), vw.T));
        pts.push([a2[0] + (b2[0] - a2[0]) * x, a2[1] + (b2[1] - a2[1]) * x]);
      }
      // 采样点之间的状态切换处、以及首末采样点到棱端点之间（各半个步长），独立方法无法分辨，记为“模糊区”
      const zone = (x0, x1) => ambiguous.push([a2[0] + (b2[0] - a2[0]) * x0, a2[1] + (b2[1] - a2[1]) * x0, a2[0] + (b2[0] - a2[0]) * x1, a2[1] + (b2[1] - a2[1]) * x1]);
      zone(0, 0.5 / n); zone(1 - 0.5 / n, 1);
      for (let i = 1; i < n; i++) if (st[i] !== st[i - 1]) zone((i - 0.5) / n, (i + 0.5) / n);
      // 连续同状态采样点组成“期望段”，两端各外延半个步长
      let i0 = 0;
      for (let i = 1; i <= n; i++) {
        if (i < n && st[i] === st[i0]) continue;
        const x0 = Math.max(0, (i0 - 0.5) / n), x1 = Math.min(1, (i + 0.5) / n);
        const seg = [a2[0] + (b2[0] - a2[0]) * x0, a2[1] + (b2[1] - a2[1]) * x0, a2[0] + (b2[0] - a2[0]) * x1, a2[1] + (b2[1] - a2[1]) * x1];
        (st[i0] ? expHid : expVis).push(seg);
        if (!st[i0] && i - i0 >= 3) { const c0 = (i0 + 1.5) / n, c1 = (i - 1.5) / n; expVisCore.push([a2[0] + (b2[0] - a2[0]) * c0, a2[1] + (b2[1] - a2[1]) * c0, a2[0] + (b2[0] - a2[0]) * c1, a2[1] + (b2[1] - a2[1]) * c1]); }
        // 远离状态切换处的点才参与比对
        for (let j = i0; j < i; j++) if ((j > i0 || i0 === 0) && (j < i - 1 || i === n)) (st[i0] ? ptsHid : ptsVis).push(pts[j]);
        i0 = i;
      }
    }
    const badV = [], badH = [], badR = [];
    // 渲染输出的每条线段按 span/200 的间距逐点核对（端点附近 1/4 步长除外）
    const fractions = (q) => { const L = Math.hypot(q[2] - q[0], q[3] - q[1]), m = Math.max(3, Math.ceil(L / (span / 200))); return Array.from({ length: m }, (_, i) => (i + 0.5) / m); };
    let visMissing = 0, hidMissing = 0, hidShownAsVisible = 0, rVisWrong = 0, rHidWrong = 0, checked = 0, skippedAmbiguous = 0;
    for (const p of ptsVis) { checked++; if (!near(p, out.visible, tol)) { visMissing++; badV.push(p); } }
    for (const p of ptsHid) {
      checked++;
      if (near(p, out.hidden, tol)) continue;
      if (near(p, out.visible, cover) && near(p, expVis, cover)) { hidShownAsVisible++; continue; } // 与可见线重合（< 0.16% 尺寸）：按制图规则实线覆盖虚线；且该处确有期望的可见线
      hidMissing++; badH.push(p);
    }
    for (const s of out.visible) for (const x of fractions(s)) { const p = [s[0] + (s[2] - s[0]) * x, s[1] + (s[3] - s[1]) * x]; if (!near(p, expVis, tol) && near(p, ambiguous, tol)) { skippedAmbiguous++; continue; } checked++; if (!near(p, expVis, tol)) { rVisWrong++; badR.push(p); } }
    const bad = [];
    for (const s of out.hidden) for (const x of fractions(s)) { const p = [s[0] + (s[2] - s[0]) * x, s[1] + (s[3] - s[1]) * x]; const L = Math.hypot(s[2] - s[0], s[3] - s[1]) || 1, dx = (s[2] - s[0]) / L * 4 * tol, dy = (s[3] - s[1]) / L * 4 * tol; /* 虚线与实线“重合”= 沿虚线方向前后两点都落在可见线上（只是交叉不算） */ const onVis = near([p[0] - dx, p[1] - dy], expVisCore, tol * 0.5) && near([p[0] + dx, p[1] + dy], expVisCore, tol * 0.5); if ((!near(p, expHid, tol) || onVis) && near(p, ambiguous, tol)) { skippedAmbiguous++; continue; } checked++; if (!near(p, expHid, tol) || onVis) { rHidWrong++; bad.push({ p, seg: s, len: Math.hypot(s[2] - s[0], s[3] - s[1]), nearExpHid: near(p, expHid, tol), nearExpVis: onVis }); } }
    // 不一致的点若位于网格裂缝处（奇数次穿越），单独计为 meshDefect
    let meshDefect = 0;
    const reclass = (list, name) => { for (const p of list) if (oddCrossings(k, p.p || p)) { meshDefect++; counts[name]--; } };
    const counts = { visMissing, hidMissing, rVisWrong, rHidWrong };
    reclass(badV, 'visMissing'); reclass(bad, 'rHidWrong'); reclass(badH, 'hidMissing'); reclass(badR, 'rVisWrong');
    ({ visMissing, hidMissing, rVisWrong, rHidWrong } = counts);
    report[k] = { checked, meshDefect, skippedAmbiguous, visMissing, hidMissing, hidShownAsVisible, rVisWrong, rHidWrong, visible: out.visible.length, hidden: out.hidden.length, bad: bad.slice(0, 4), badV: badV.slice(0, 4), badH: badH.slice(0, 4), badR: badR.slice(0, 4) };
  }
  return report;
}

function alignment() {
  const res = window.__geometryLab.unfold.result;
  const range = (k, useMask) => {
    const v = res.views[k]; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const addp = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
    if (useMask) for (let i = 0; i < v.mask.length; i += 2) addp(v.mask[i], v.mask[i + 1]);
    else for (const s of [...v.visible, ...v.hidden]) { addp(s[0], s[1]); addp(s[2], s[3]); }
    return { x0, x1, y0, y1 };
  };
  const out = {};
  for (const [name, useMask] of [['lines', false], ['mask', true]]) {
    const V = range('V', useMask), W = range('W', useMask), H = range('H', useMask);
    out[name] = {
      长对正: Math.max(Math.abs(V.x0 - H.x0), Math.abs(V.x1 - H.x1)),
      高平齐: Math.max(Math.abs(V.y0 - W.y0), Math.abs(V.y1 - W.y1)),
      宽相等: Math.max(Math.abs(-H.y1 - W.x0), Math.abs(-H.y0 - W.x1)),
      empty: [V, W, H].some((r) => !(r.x1 > r.x0) || !(r.y1 > r.y0)),
    };
  }
  // 两套数据之间也应一致（轮廓线必须包住投影区域）
  out.linesVsMask = ['V', 'W', 'H'].map((k) => { const a = range(k, false), b = range(k, true); return Math.max(Math.abs(a.x0 - b.x0), Math.abs(a.x1 - b.x1), Math.abs(a.y0 - b.y0), Math.abs(a.y1 - b.y1)); }).reduce((a, b) => Math.max(a, b));
  return out;
}

(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
  let errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.goto(BASE + '?model=cube');
  await page.waitForFunction(() => window.__geometryLab);
  await page.evaluate(() => { document.querySelector('#controls').classList.remove('open'); window.__geometryLab.unfold.set(true); });
  let catalogue = await page.evaluate(() => window.__geometryLab.catalogue.map((x) => ({ id: x.id, name: x.name, number: x.number || 0, group: x.group })));
  const total = catalogue.length;
  if (process.env.ONLY) catalogue = catalogue.filter((x) => process.env.ONLY.split(',').includes(x.id));
  let basicIndex = 0;
  const codes = new Map();
  for (const x of (await page.evaluate(() => window.__geometryLab.catalogue.map((c) => ({ id: c.id, number: c.number || 0 }))))) codes.set(x.id, x.number ? 'M' + String(x.number).padStart(3, '0') : 'B' + String(++basicIndex).padStart(3, '0'));
  const TOL = 1e-6;
  const results = [];
  for (const item of catalogue) {
    errors = [];
    const code = codes.get(item.id), file = `${code}_${item.id}`;
    const start = Date.now();
    let r = { code, id: item.id, name: item.name, group: item.group };
    try {
      await page.evaluate((id) => window.__geometryLab.selectShape(id), item.id);
      await page.waitForFunction((id) => document.querySelector('#unfold-view').dataset.ready === id + ':none:0,0,0', item.id, { timeout: 30000 });
      r.ms = Date.now() - start;
      const svg = await page.evaluate(() => document.querySelector('#unfold-view').innerHTML);
      fs.writeFileSync(path.join(OUT, file + '.svg'), svg);
      await page.locator('#unfold-view svg').screenshot({ path: path.join(OUT, file + '.png') });
      r.align = await page.evaluate(alignment);
      r.hidden = await page.evaluate(independentCheck);
      r.openSegs = await page.evaluate(() => window.__geometryLab.unfold.model.openSegs);
      r.unioned = await page.evaluate(() => window.__geometryLab.unfold.model.unioned);
    } catch (e) { errors.push('exception: ' + e.message); }
    r.errors = errors.slice();
    const a = r.align || {};
    const alignOk = a.lines && !a.lines.empty && !a.mask.empty && ['长对正', '高平齐', '宽相等'].every((k) => a.lines[k] < TOL && a.mask[k] < TOL) && a.linesVsMask < TOL;
    const hid = r.hidden ? Object.values(r.hidden) : [];
    const hidBad = hid.reduce((s, v) => s + v.visMissing + v.hidMissing + v.rVisWrong + v.rHidWrong, 0);
    r.pass = { render: r.errors.length === 0, align: !!alignOk, hidden: !!r.hidden && hidBad === 0 };
    r.hiddenMismatch = hidBad;
    results.push(r);
    console.log(`${code} ${item.id.padEnd(14)} render:${r.pass.render ? 'ok' : 'FAIL'} align:${r.pass.align ? 'ok' : 'FAIL'} hidden:${r.pass.hidden ? 'ok' : 'FAIL(' + hidBad + ')'} lines V${r.hidden?.V?.visible}/${r.hidden?.V?.hidden} W${r.hidden?.W?.visible}/${r.hidden?.W?.hidden} H${r.hidden?.H?.visible}/${r.hidden?.H?.hidden} ${r.ms}ms${r.errors.length ? ' ' + r.errors.join(' | ') : ''}`);
  }
  // 原有功能回归：3D、叠加三视图、剖切、光源模式、练习卡片、视角预设、会员弹窗、PWA 缓存
  errors = [];
  const reg = {};
  await page.goto(BASE + '?model=mech-046');
  await page.waitForFunction(() => window.__geometryLab);
  await page.waitForTimeout(500);
  reg.renderer = await page.evaluate(() => window.__geometryLab.renderer);
  const nonBlank = () => page.evaluate(() => { document.querySelector('[data-view="iso"]').click(); /* 同步重绘后立即读像素（WebGL 未开 preserveDrawingBuffer） */ const c = document.querySelector('#solid-scene'); const g = c.getContext('webgl2') || c.getContext('webgl'); if (!g) return -1; const px = new Uint8Array(4 * 64 * 64); g.readPixels(Math.floor(c.width / 2) - 32, Math.floor(c.height / 2) - 32, 64, 64, g.RGBA, g.UNSIGNED_BYTE, px); let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i]) n++; return n; });
  const steps = [
    ['section-half', () => page.click('[data-section="half"]')],
    ['section-quarter', () => page.click('[data-section="quarter"]')],
    ['section-none', () => page.click('[data-section="none"]')],
    ['point-light', () => page.click('[data-mode="point"]')],
    ['parallel-light', () => page.click('[data-mode="parallel"]')],
    ['projections-off', () => page.click('#projections')],
    ['projections-on', () => page.click('#projections')],
    ['next', () => page.click('#next')],
    ['previous', () => page.click('#previous')],
    ['view-front', () => page.click('[data-view="front"]')],
    ['view-iso', () => page.click('[data-view="iso"]')],
    ['member', async () => { await page.click('#membership-link'); await page.click('.modal-close'); }],
  ];
  for (const [name, fn] of steps) { await fn(); await page.waitForTimeout(120); reg[name] = { title: await page.evaluate(() => document.querySelector('#exercise-title').textContent), state: await page.evaluate(() => ({ section: window.__geometryLab.state.section, point: window.__geometryLab.state.point, projection: window.__geometryLab.state.projection, shape: window.__geometryLab.state.shape })) }; }
  reg.solidPixels = await nonBlank();
  await page.screenshot({ path: path.join(OUT, 'regression-3d-desktop.png') });
  // 展开图 + 剖切 + 旋转
  await page.click('[data-section="half"]');
  await page.click('#unfold-toggle');
  await page.evaluate(() => { const i = document.querySelector('#rot-2'); i.value = 35; i.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => (document.querySelector('#unfold-view').dataset.ready || '').endsWith(':half:0,0,35'), null, { timeout: 30000 });
  reg.unfoldSectionRotated = await page.evaluate(alignment);
  await page.screenshot({ path: path.join(OUT, 'regression-unfold-half-rot35-desktop.png') });
  await page.click('#unfold-toggle');
  await page.waitForTimeout(200);
  reg.backTo3d = await page.evaluate(() => ({ hidden: document.querySelector('#unfold-view').hidden, button: document.querySelector('#unfold-toggle').textContent }));
  reg.solidPixelsAfter = await nonBlank();
  reg.serviceWorker = await page.evaluate(async () => { if (!('serviceWorker' in navigator)) return 'unsupported'; await navigator.serviceWorker.ready; const keys = await caches.keys(); const c = await caches.open('geometry-lab-v4'); const req = (await c.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search); return { keys, hasUnfold: req.some((u) => u.endsWith('/geometry-76/unfold.js?v=4')), hasApp: req.some((u) => u.endsWith('/geometry-76/app.js?v=4')), count: req.length }; });
  reg.errors = errors.slice();
  const ua = reg.unfoldSectionRotated;
  reg.ok = reg.renderer && reg.solidPixels > 0 && reg.solidPixelsAfter > 0 && reg['section-half'].state.section === 'half' && reg['point-light'].state.point && !reg['projections-off'].state.projection && reg['next'].state.shape !== 'mech-046' && reg['previous'].state.shape === 'mech-046' && reg.backTo3d.hidden && ua && ['长对正', '高平齐', '宽相等'].every((k) => ua.lines[k] < 1e-6) && reg.serviceWorker.hasUnfold && reg.serviceWorker.hasApp && !reg.errors.length;
  console.log('regression', JSON.stringify(reg));
  // 390px 竖屏
  const mobileIds = (process.env.MOBILE || 'mech-001,mech-011,mech-035,mech-061,cube,tube').split(',');
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const mobErrors = [];
  mob.on('pageerror', (e) => mobErrors.push('pageerror: ' + e.message));
  mob.on('console', (m) => { if (m.type() === 'error') mobErrors.push('console.error: ' + m.text()); });
  const mobile = [];
  for (const id of mobileIds) {
    await mob.goto(BASE + '?model=' + id + '&unfold=1');
    await mob.waitForFunction((id) => document.querySelector('#unfold-view').dataset.ready === id + ':none:0,0,0', id, { timeout: 30000 });
    await mob.waitForTimeout(450);
    await mob.screenshot({ path: path.join(OUT, 'mobile', `${codes.get(id)}_${id}-390.png`) });
    const m = await mob.evaluate(() => {
      const sv = document.querySelector('#unfold-view svg').getBoundingClientRect();
      const btn = document.querySelector('#unfold-toggle').getBoundingClientRect();
      return { scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, innerWidth, svgLeft: sv.left, svgRight: sv.right, svgWidth: sv.width, buttonRight: btn.right };
    });
    m.id = id; m.ok = m.scrollWidth <= m.innerWidth && m.bodyScrollWidth <= m.innerWidth && m.svgLeft >= 0 && m.svgRight <= m.innerWidth && m.buttonRight <= m.innerWidth;
    mobile.push(m);
    console.log('mobile', id, JSON.stringify(m));
  }
  // 竖屏：打开控制台后的截图（检查控制台里的新开关不溢出）
  await mob.click('#open-controls');
  await mob.waitForTimeout(500);
  await mob.screenshot({ path: path.join(OUT, 'mobile', 'controls-open-390.png') });
  await mob.evaluate(() => document.querySelector('#unfold').scrollIntoView({ block: 'center' }));
  await mob.waitForTimeout(300);
  await mob.screenshot({ path: path.join(OUT, 'mobile', 'controls-unfold-switch-390.png') });
  const ctlOverflow = await mob.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  // 关闭展开图回到 3D
  await mob.click('#unfold-toggle');
  await mob.waitForTimeout(400);
  await mob.screenshot({ path: path.join(OUT, 'mobile', 'back-to-3d-390.png') });
  const back3d = await mob.evaluate(() => ({ hidden: document.querySelector('#unfold-view').hidden, unfold: window.__geometryLab.state.unfold }));
  await browser.close();
  const summary = {
    when: new Date().toISOString(), base: BASE, total, tested: results.length,
    renderPass: results.filter((r) => r.pass.render).length,
    alignPass: results.filter((r) => r.pass.align).length,
    hiddenPass: results.filter((r) => r.pass.hidden).length,
    allPass: results.filter((r) => r.pass.render && r.pass.align && r.pass.hidden).length,
    maxAlignError: Math.max(...results.map((r) => r.align ? Math.max(...['lines', 'mask'].flatMap((k) => ['长对正', '高平齐', '宽相等'].map((q) => r.align[k][q])), r.align.linesVsMask) : Infinity)),
    hiddenSamplesChecked: results.reduce((s, r) => s + (r.hidden ? Object.values(r.hidden).reduce((a, v) => a + v.checked, 0) : 0), 0),
    meshDefectSamples: results.flatMap((r) => r.hidden ? Object.entries(r.hidden).filter(([, v]) => v.meshDefect).map(([k, v]) => r.id + ' ' + k + ':' + v.meshDefect) : []),
    modelsWithOpenCracks: results.filter((r) => r.openSegs > 0).map((r) => r.id + ':' + r.openSegs),
    regression: reg,
    mobile, mobileErrors: mobErrors, mobileControlsNoOverflow: ctlOverflow, back3d,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ summary, results }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  const ok = summary.allPass === summary.tested && reg.ok && mobile.every((m) => m.ok) && !mobErrors.length && ctlOverflow && back3d.hidden && !back3d.unfold;
  process.exit(ok ? 0 : 1);
})();
